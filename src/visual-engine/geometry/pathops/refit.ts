// §19-deferred #2 — post-pass cleanup of boolean-op output paths.
//
// Two independent transforms compose into `refitOpPath`:
//
//   1. `collapseCollinearLines` — when Op() walks a contour that
//      includes an unsplit straight side broken by intersections at
//      interior points (a rect whose top edge gets intersected at two
//      points by an inner shape's silhouette), the output is a chain
//      of collinear `lineTo` commands. Collapse them into a single
//      lineTo to the run's final endpoint. Exact (cross-product zero
//      detection with same-direction sign check).
//
//   2. `coalesceSameOriginalCurve` — when a single input cubic gets
//      intersected at N points along its length and all N+1 sub-spans
//      survive into the output, the engine emits N+1 separate cubics.
//      Visually they trace the same parametric curve, but at the
//      output level they look like a fragmented chain. Each cubic /
//      quad carries a `CurveProvenance` (segment identity + t-range +
//      original control points) attached at emit time in
//      `OpSegment.addCurveTo`; this pass walks the output and re-fuses
//      adjacent commands whose provenance shows them as consecutive
//      sub-ranges of the same input curve. Re-uses the same
//      `Quad.subDivide` / `Cubic.subDivide` paths the engine already
//      ships.
//
// `refitOpPath` returns a new OpPath; the input is untouched. Provenance
// is dropped on the returned commands — it's a debug aid that no
// downstream consumer needs once the merge has happened.

import { Cubic } from './cubic.js';
import { OpPath, type OpPathCommand } from './op-path.js';
import { OpVerb } from './op-fwd.js';
import { Point } from './point.js';
import { Quad } from './quad.js';

const COLLINEAR_EPS = 1e-9;
const ZERO_LEN_EPS  = 1e-12;
const T_ADJACENT_EPS = 1e-9;

export function refitOpPath(p: OpPath): OpPath
{
    return coalesceSameOriginalCurve(collapseCollinearLines(p));
}

// ── pass 1: collinear-line collapse + zero-length drop ───────────────

export function collapseCollinearLines(p: OpPath): OpPath
{
    const out = new OpPath();
    out.fFillType = p.fFillType;
    let pen: Point | undefined = undefined;
    let pendingLineEnd: Point | undefined = undefined;
    let pendingLineStart: Point | undefined = undefined;

    function flushPending(): void
    {
        if (pendingLineEnd === undefined) return;
        out.fCommands.push({ verb: OpVerb.kLine, pts: [pendingLineEnd] });
        pen = pendingLineEnd;
        pendingLineEnd = undefined;
        pendingLineStart = undefined;
    }

    for (const c of p.fCommands)
    {
        switch (c.verb)
        {
            case OpVerb.kMove:
            {
                flushPending();
                out.fCommands.push({ verb: OpVerb.kMove, pts: [c.pts[0]!] });
                pen = c.pts[0]!;
                break;
            }
            case OpVerb.kLine:
            {
                const next = c.pts[0]!;
                if (pen !== undefined && pointsClose(pen, next, ZERO_LEN_EPS))
                {
                    // Zero-length segment — drop entirely.
                    break;
                }
                if (pendingLineEnd === undefined)
                {
                    pendingLineEnd   = next;
                    pendingLineStart = pen;
                    break;
                }
                // Try to merge with the pending line.
                if (pendingLineStart !== undefined
                    && collinearSameDir(pendingLineStart, pendingLineEnd, next))
                {
                    pendingLineEnd = next;
                    break;
                }
                // Different direction — flush pending, start new pending.
                flushPending();
                pendingLineEnd   = next;
                pendingLineStart = pen;
                break;
            }
            case OpVerb.kQuad:
            case OpVerb.kCubic:
            {
                flushPending();
                const copy: OpPathCommand = { verb: c.verb, pts: c.pts.slice() };
                if (c.prov !== undefined) copy.prov = c.prov;
                out.fCommands.push(copy);
                pen = c.pts[c.pts.length - 1]!;
                break;
            }
            case OpVerb.kClose:
            {
                flushPending();
                out.fCommands.push({ verb: OpVerb.kClose, pts: [] });
                pen = undefined;
                break;
            }
        }
    }
    flushPending();
    return out;
}

function pointsClose(a: Point, b: Point, eps: number): boolean
{
    const dx = a.fX - b.fX, dy = a.fY - b.fY;
    return Math.abs(dx) <= eps && Math.abs(dy) <= eps;
}

// (B-A) × (C-B) ≈ 0 AND dot product ≥ 0 → A, B, C are collinear and
// the second leg continues in the same direction (no doubling back).
function collinearSameDir(a: Point, b: Point, c: Point): boolean
{
    const ux = b.fX - a.fX, uy = b.fY - a.fY;
    const vx = c.fX - b.fX, vy = c.fY - b.fY;
    const cross = ux * vy - uy * vx;
    const dot   = ux * vx + uy * vy;
    return Math.abs(cross) <= COLLINEAR_EPS && dot >= 0;
}

// ── pass 2: same-original-curve coalescing ───────────────────────────

export function coalesceSameOriginalCurve(p: OpPath): OpPath
{
    const out = new OpPath();
    out.fFillType = p.fFillType;

    for (const c of p.fCommands)
    {
        const lastIdx = out.fCommands.length - 1;
        const last    = lastIdx >= 0 ? out.fCommands[lastIdx]! : undefined;

        if (c.prov !== undefined
            && last !== undefined
            && last.verb === c.verb
            && last.prov !== undefined
            && last.prov.seg === c.prov.seg
            && Math.abs(last.prov.tEnd - c.prov.tStart) <= T_ADJACENT_EPS)
        {
            // Same input curve, adjacent t-range. Re-derive on the
            // merged range. Output replaces `last` in-place.
            const mergedT0 = last.prov.tStart;
            const mergedT1 = c.prov.tEnd;
            const merged = subDivideFromProvenance(c.prov.sourceVerb, c.prov.sourcePts, mergedT0, mergedT1);
            const newPts: Point[] = c.verb === OpVerb.kQuad
                ? [merged[1]!, merged[2]!]
                : [merged[1]!, merged[2]!, merged[3]!];
            out.fCommands[lastIdx] = {
                verb: c.verb,
                pts:  newPts,
                prov: { ...last.prov, tEnd: mergedT1 },
            };
            continue;
        }

        const copy: OpPathCommand = { verb: c.verb, pts: c.pts.slice() };
        if (c.prov !== undefined) copy.prov = c.prov;
        out.fCommands.push(copy);
    }

    // Drop provenance from the final output — it's an internal signal
    // and no downstream consumer should depend on its shape.
    for (const c of out.fCommands) delete c.prov;
    return out;
}

// Returns the merged sub-Bezier's full control polygon: 3 points for
// quad, 4 for cubic. The first element is the new start point.
function subDivideFromProvenance(verb: OpVerb, pts: Point[], t0: number, t1: number): Point[]
{
    if (verb === OpVerb.kQuad)
    {
        // Endpoint-aligned early-out: covers the whole curve.
        if (t0 === 0 && t1 === 1) return pts.slice(0, 3);
        const q = new Quad();
        q.fPts = [pts[0]!, pts[1]!, pts[2]!];
        const sub = q.subDivide(t0, t1);
        return [sub.fPts[0]!, sub.fPts[1]!, sub.fPts[2]!];
    }
    // cubic
    if (t0 === 0 && t1 === 1) return pts.slice(0, 4);
    const c = new Cubic();
    c.fPts = [pts[0]!, pts[1]!, pts[2]!, pts[3]!];
    const sub = c.subDivide(t0, t1);
    return [sub.fPts[0]!, sub.fPts[1]!, sub.fPts[2]!, sub.fPts[3]!];
}
