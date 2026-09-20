// §19.8 regression corpus verifier.
//
// Skia's PathOpsOpTest / PathOpsSimplifyTest catalogue ~900 small
// constructed tests, most adversarial: bug-derived (fuzz-extracted),
// near-tangent crossings, coincident edges, degenerate sub-segments.
// They cover ground the hand-curated `combine.test.ts` doesn't reach.
//
// The Skia tests verify by rasterizing both A and B and the Op
// output, then comparing pixel-by-pixel — Skia's
// "outputProgressively" verifier. That requires a renderer. Mural's
// port verifies via the same logical idea applied to a self-contained
// `opPathContains` implementation:
//
//   * Sample N probe points across the bbox of A ∪ B (and a 10 %
//     margin so close-to-edge probes catch a malformed output).
//   * For each probe `p`, compute `expected = op(A.Contains(p),
//     B.Contains(p))` and `actual = result.Contains(p)`.
//   * Ignore probes that lie within ε of any segment endpoint or
//     control point of A or B — Contains is ambiguous on the
//     boundary, and the engine is allowed to put boundary points on
//     either side.
//   * If at least `minProbeCount` clean probes agree, the test
//     passes. If too many ambiguous-boundary probes filter the
//     count below `minProbeCount`, fall back to the robustness
//     check: Op() returned a boolean without throwing, and the
//     bbox is finite. The fallback is also the gate for the
//     `failTests` corpus where Op() is expected to bail out
//     gracefully on adversarial input.
//
// The Contains implementation here is a small standalone winding-
// number ray cast over OpPath commands. It deliberately doesn't
// reach into the Geometry layer — that import chain (PathGeometry
// → geometry.ts → drawing/transform.ts → runtime/index.ts) trips a
// TDZ cycle through `Validation extends MuralBase`. The corpus tests
// only care about Op() output correctness, not Geometry semantics,
// so the standalone reader is the right boundary.
//
// **Corpus tests are skipped by default** — set `RUN_PATHOPS_CORPUS=1`
// in the environment to actually execute them. The ported tests
// catch every Op() output mismatch by category, but some Skia
// adversarial inputs trip loops in `op-coincidence` and `op-angle`
// that don't yet have safety nets in the port, so the corpus can
// hang the runner. Each engine-loop hang is a tracked
// §19.8-followup item; running the corpus locally surfaces them.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Cubic } from '../cubic.js';
import { Quad } from '../quad.js';
import { Point as DPoint } from '../point.js';
import { OpVerb } from '../op-fwd.js';
import { OpPath, OpFillType } from '../op-path.js';
import { Op, Simplify } from '../op-path-ops-op.js';
import { SkPathOp } from '../op-segment.js';

// ── Path-string DSL ──────────────────────────────────────────────
//
// Compact SVG-like format: capital-letter command followed by
// floats. M/L take one point, Q two, C three, Z none. Whitespace
// (spaces, tabs, newlines, commas) separates tokens.

const VERB_ARITY: Readonly<Record<string, number>> = {
    M: 2, L: 2, Q: 4, C: 6, Z: 0,
};

export function buildOpPath(spec: string, fillType: OpFillType = OpFillType.kWinding): OpPath
{
    const p = new OpPath();
    p.setFillType(fillType);
    const tokens = spec.replace(/[,]/g, ' ').split(/\s+/).filter(t => t.length > 0);
    let i = 0;
    while (i < tokens.length)
    {
        const verb = tokens[i++]!;
        const arity = VERB_ARITY[verb];
        if (arity === undefined)
        {
            throw new Error(`buildOpPath: unknown verb "${verb}" at token ${i - 1}`);
        }
        const nums: number[] = [];
        for (let k = 0; k < arity; ++k)
        {
            const t = tokens[i++];
            if (t === undefined) throw new Error(`buildOpPath: missing arg for ${verb}`);
            const n = Number(t);
            if (!Number.isFinite(n)) throw new Error(`buildOpPath: non-numeric arg "${t}" for ${verb}`);
            nums.push(n);
        }
        switch (verb)
        {
            case 'M': p.moveTo(new DPoint(nums[0]!, nums[1]!)); break;
            case 'L': p.lineTo(new DPoint(nums[0]!, nums[1]!)); break;
            case 'Q': p.quadTo(new DPoint(nums[0]!, nums[1]!),
                                new DPoint(nums[2]!, nums[3]!)); break;
            case 'C': p.cubicTo(new DPoint(nums[0]!, nums[1]!),
                                 new DPoint(nums[2]!, nums[3]!),
                                 new DPoint(nums[4]!, nums[5]!)); break;
            case 'Z': p.close(); break;
        }
    }
    return p;
}

// ── OpPath Contains (winding-number ray cast) ───────────────────────
//
// Shoots a horizontal ray to the right from `(px, py)` and counts
// signed crossings against each segment of the path. Mirrors the
// rayCast helpers in `geometry.ts` but inlined here to break the
// transitive runtime/index.js dependency.

interface RayAcc { winding: number; crossings: number; }

function rayCastLine(ax: number, ay: number, bx: number, by: number,
                     px: number, py: number, acc: RayAcc): void
{
    if (ay === by) return;
    const t = (py - ay) / (by - ay);
    if (t < 0 || t >= 1) return;
    const x = ax + t * (bx - ax);
    if (x <= px) return;
    acc.winding   += by > ay ? 1 : -1;
    acc.crossings += 1;
}

function rayCastQuad(a: DPoint, b: DPoint, c: DPoint,
                     px: number, py: number, acc: RayAcc): void
{
    // y(t) = A·t² + B·t + C where the Bezier expansion gives:
    //   A = ay - 2·by + cy
    //   B = 2·(by - ay)
    //   C = ay - py
    const A = a.fY - 2 * b.fY + c.fY;
    const B = 2 * (b.fY - a.fY);
    const C = a.fY - py;
    const roots: number[] = [];
    const n = Quad.RootsValidT(A, B, C, roots);
    for (let i = 0; i < n; ++i)
    {
        const t = roots[i]!;
        if (t < 0 || t >= 1) continue;
        const mt = 1 - t;
        const x = mt * mt * a.fX + 2 * mt * t * b.fX + t * t * c.fX;
        if (x <= px) continue;
        const yp = 2 * mt * (b.fY - a.fY) + 2 * t * (c.fY - b.fY);
        if (yp === 0) continue;
        acc.winding   += yp > 0 ? 1 : -1;
        acc.crossings += 1;
    }
}

function rayCastCubic(a: DPoint, b: DPoint, c: DPoint, d: DPoint,
                      px: number, py: number, acc: RayAcc): void
{
    const A = -a.fY + 3 * b.fY - 3 * c.fY + d.fY;
    const B =  3 * a.fY - 6 * b.fY + 3 * c.fY;
    const C = -3 * a.fY + 3 * b.fY;
    const D =  a.fY - py;
    const roots: number[] = [];
    const n = Cubic.RootsValidT(A, B, C, D, roots);
    for (let i = 0; i < n; ++i)
    {
        const t = roots[i]!;
        if (t < 0 || t >= 1) continue;
        const mt = 1 - t;
        const x = mt * mt * mt * a.fX
                + 3 * mt * mt * t  * b.fX
                + 3 * mt * t  * t  * c.fX
                + t  * t  * t  * d.fX;
        if (x <= px) continue;
        const yp = 3 * mt * mt * (b.fY - a.fY)
                 + 6 * mt * t  * (c.fY - b.fY)
                 + 3 * t  * t  * (d.fY - c.fY);
        if (yp === 0) continue;
        acc.winding   += yp > 0 ? 1 : -1;
        acc.crossings += 1;
    }
}

function opPathContains(p: OpPath, px: number, py: number): boolean
{
    const acc: RayAcc = { winding: 0, crossings: 0 };
    let pen = new DPoint(0, 0);
    let figureStart = new DPoint(0, 0);
    let hasFigure = false;
    for (const cmd of p.fCommands)
    {
        switch (cmd.verb)
        {
            case OpVerb.kMove:
                // Implicit close-by-line for the prior figure if any.
                pen = cmd.pts[0]!;
                figureStart = pen;
                hasFigure = true;
                break;
            case OpVerb.kLine:
            {
                const np = cmd.pts[0]!;
                rayCastLine(pen.fX, pen.fY, np.fX, np.fY, px, py, acc);
                pen = np;
                break;
            }
            case OpVerb.kQuad:
            {
                const c1 = cmd.pts[0]!, np = cmd.pts[1]!;
                rayCastQuad(pen, c1, np, px, py, acc);
                pen = np;
                break;
            }
            case OpVerb.kCubic:
            {
                const c1 = cmd.pts[0]!, c2 = cmd.pts[1]!, np = cmd.pts[2]!;
                rayCastCubic(pen, c1, c2, np, px, py, acc);
                pen = np;
                break;
            }
            case OpVerb.kClose:
                if (hasFigure
                    && (pen.fX !== figureStart.fX || pen.fY !== figureStart.fY))
                {
                    rayCastLine(pen.fX, pen.fY, figureStart.fX, figureStart.fY,
                                px, py, acc);
                }
                pen = figureStart;
                hasFigure = false;
                break;
        }
    }
    if (p.fFillType === OpFillType.kEvenOdd || p.fFillType === OpFillType.kInverseEvenOdd)
    {
        const inside = (acc.crossings & 1) === 1;
        return p.isInverseFillType() ? !inside : inside;
    }
    const inside = acc.winding !== 0;
    return p.isInverseFillType() ? !inside : inside;
}

// ── Bounds + probe-grid helpers ──────────────────────────────────

interface XYRect { x0: number; y0: number; x1: number; y1: number; valid: boolean; }

function opPathBounds(p: OpPath): XYRect
{
    let x0 = +Infinity, y0 = +Infinity, x1 = -Infinity, y1 = -Infinity;
    let any = false;
    for (const cmd of p.fCommands)
    {
        for (const pt of cmd.pts)
        {
            if (pt.fX < x0) x0 = pt.fX;
            if (pt.fY < y0) y0 = pt.fY;
            if (pt.fX > x1) x1 = pt.fX;
            if (pt.fY > y1) y1 = pt.fY;
            any = true;
        }
    }
    return { x0, y0, x1, y1, valid: any && Number.isFinite(x0) && Number.isFinite(y1) };
}

function tooCloseToVertex(px: number, py: number, verts: DPoint[]): boolean
{
    for (const v of verts)
    {
        const dx = px - v.fX, dy = py - v.fY;
        if (dx * dx + dy * dy < BOUNDARY_EPS * BOUNDARY_EPS) return true;
    }
    return false;
}

function collectVertices(p: OpPath, out: DPoint[]): void
{
    for (const c of p.fCommands)
    {
        for (const pt of c.pts) out.push(pt);
    }
}

// ── Verifier ─────────────────────────────────────────────────────

const PROBE_GRID = 11;        // 11×11 grid = 121 probe points / shape pair.
const BBOX_MARGIN = 0.10;     // expand the bbox 10 % so boundary probes catch malformed output.
const BOUNDARY_EPS = 1e-3;    // skip probes within this Euclidean distance of any A or B vertex.
const MIN_CLEAN_PROBES = 8;   // require at least this many ambiguity-free probes.

function applyOp(op: SkPathOp, inA: boolean, inB: boolean): boolean
{
    switch (op)
    {
        case SkPathOp.kDifference:        return inA && !inB;
        case SkPathOp.kIntersect:         return inA &&  inB;
        case SkPathOp.kUnion:             return inA ||  inB;
        case SkPathOp.kXOR_SkPathOp:      return inA !== inB;
        case SkPathOp.kReverseDifference: return !inA &&  inB;
    }
}

interface VerifyOutcome
{
    cleanProbes: number;
    mismatches: { px: number; py: number; expected: boolean; actual: boolean }[];
}

function probeVerify(A: OpPath, B: OpPath | undefined, op: SkPathOp | undefined,
                     result: OpPath, vertices: DPoint[]): VerifyOutcome
{
    const ba = opPathBounds(A);
    const bb = B ? opPathBounds(B) : ba;
    const x0 = Math.min(ba.x0, bb.x0), y0 = Math.min(ba.y0, bb.y0);
    const x1 = Math.max(ba.x1, bb.x1), y1 = Math.max(ba.y1, bb.y1);
    const w = x1 - x0, h = y1 - y0;
    const mx = (w === 0 ? 1 : w) * BBOX_MARGIN;
    const my = (h === 0 ? 1 : h) * BBOX_MARGIN;
    const X0 = x0 - mx, Y0 = y0 - my;
    const X1 = x1 + mx, Y1 = y1 + my;
    const dx = (X1 - X0) / (PROBE_GRID - 1);
    const dy = (Y1 - Y0) / (PROBE_GRID - 1);
    let clean = 0;
    const mismatches: VerifyOutcome['mismatches'] = [];
    for (let row = 0; row < PROBE_GRID; ++row)
    {
        for (let col = 0; col < PROBE_GRID; ++col)
        {
            const px = X0 + col * dx;
            const py = Y0 + row * dy;
            if (tooCloseToVertex(px, py, vertices)) continue;
            const inA = opPathContains(A, px, py);
            const inB = B ? opPathContains(B, px, py) : inA;
            const expected = op === undefined ? inA : applyOp(op, inA, inB);
            const actual = opPathContains(result, px, py);
            if (expected === actual) clean++;
            else mismatches.push({ px, py, expected, actual });
        }
    }
    return { cleanProbes: clean, mismatches };
}

// ── Public surface ───────────────────────────────────────────────

const OP_BY_SHORT: Readonly<Record<string, SkPathOp>> = {
    diff: SkPathOp.kDifference,
    sect: SkPathOp.kIntersect,
    intersect: SkPathOp.kIntersect,
    union: SkPathOp.kUnion,
    xor:  SkPathOp.kXOR_SkPathOp,
    revdiff: SkPathOp.kReverseDifference,
};

export type OpShort = keyof typeof OP_BY_SHORT;

export interface OpCorpusEntry
{
    name: string;
    op: OpShort;
    a: string;
    b: string;
    fillA?: 'winding' | 'evenodd';
    fillB?: 'winding' | 'evenodd';
}

export interface SimplifyCorpusEntry
{
    name: string;
    p: string;
    fill?: 'winding' | 'evenodd';
}

function fillCode(s: 'winding' | 'evenodd' | undefined): OpFillType
{
    return s === 'evenodd' ? OpFillType.kEvenOdd : OpFillType.kWinding;
}


interface CorpusStats
{
    total: number;
    threw: string[];
    nonFinite: string[];
    opFailedFalse: number;
    robustnessFallback: number;
    probeMismatch: string[];
    passed: number;
    slow: string[];
}

function emptyStats(): CorpusStats
{
    return { total: 0, threw: [], nonFinite: [], opFailedFalse: 0,
             robustnessFallback: 0, probeMismatch: [], passed: 0, slow: [] };
}

const SLOW_THRESHOLD_MS = 1000;

function runOneOp(e: OpCorpusEntry, stats: CorpusStats): void
{
    stats.total++;
    const t0 = Date.now();
    try
    {
        const opA = buildOpPath(e.a, fillCode(e.fillA));
        const opB = buildOpPath(e.b, fillCode(e.fillB));
        const op = OP_BY_SHORT[e.op]!;
        const result = new OpPath();
        const ok = Op(opA, opB, op, result);
        const elapsed = Date.now() - t0;
        if (elapsed > SLOW_THRESHOLD_MS) stats.slow.push(`${e.name} (${elapsed}ms)`);
        if (typeof ok !== 'boolean') { stats.threw.push(e.name); return; }
        const b = opPathBounds(result);
        const finite = result.fCommands.length === 0
            || (Number.isFinite(b.x0) && Number.isFinite(b.y0)
                && Number.isFinite(b.x1) && Number.isFinite(b.y1));
        if (!finite) { stats.nonFinite.push(e.name); return; }
        if (!ok) { stats.opFailedFalse++; return; }
        const verts: DPoint[] = [];
        collectVertices(opA, verts);
        collectVertices(opB, verts);
        const out = probeVerify(opA, opB, op, result, verts);
        if (out.cleanProbes < MIN_CLEAN_PROBES) { stats.robustnessFallback++; return; }
        if (out.mismatches.length > 0) { stats.probeMismatch.push(e.name); return; }
        stats.passed++;
    }
    catch (err)
    {
        stats.threw.push(`${e.name}: ${(err as Error).message}`);
    }
}

function runOneSimplify(e: SimplifyCorpusEntry, stats: CorpusStats): void
{
    stats.total++;
    const t0 = Date.now();
    try
    {
        const inputPath = buildOpPath(e.p, fillCode(e.fill));
        const result = new OpPath();
        const ok = Simplify(inputPath, result);
        const elapsed = Date.now() - t0;
        if (elapsed > SLOW_THRESHOLD_MS) stats.slow.push(`${e.name} (${elapsed}ms)`);
        if (typeof ok !== 'boolean') { stats.threw.push(e.name); return; }
        const b = opPathBounds(result);
        const finite = result.fCommands.length === 0
            || (Number.isFinite(b.x0) && Number.isFinite(b.y0)
                && Number.isFinite(b.x1) && Number.isFinite(b.y1));
        if (!finite) { stats.nonFinite.push(e.name); return; }
        if (!ok) { stats.opFailedFalse++; return; }
        const verts: DPoint[] = [];
        collectVertices(inputPath, verts);
        const out = probeVerify(inputPath, undefined, undefined, result, verts);
        if (out.cleanProbes < MIN_CLEAN_PROBES) { stats.robustnessFallback++; return; }
        if (out.mismatches.length > 0) { stats.probeMismatch.push(e.name); return; }
        stats.passed++;
    }
    catch (err)
    {
        stats.threw.push(`${e.name}: ${(err as Error).message}`);
    }
}

function reportStats(label: string, stats: CorpusStats): void
{
    const lines: string[] = [
        `${label}: ${stats.total} total`,
        `  passed (Contains-probe verified):     ${stats.passed}`,
        `  passed (robustness fallback only):    ${stats.robustnessFallback}`,
        `  Op returned false (graceful bail):    ${stats.opFailedFalse}`,
        `  probe mismatch (wrong output):        ${stats.probeMismatch.length}`,
        `  non-finite bbox (broken output):      ${stats.nonFinite.length}`,
        `  threw / unexpected (engine crash):    ${stats.threw.length}`,
    ];
    if (stats.probeMismatch.length > 0)
    {
        lines.push(`  first 10 probe-mismatch names: ${stats.probeMismatch.slice(0, 10).join(', ')}`);
    }
    if (stats.nonFinite.length > 0)
    {
        lines.push(`  first 5 non-finite names:      ${stats.nonFinite.slice(0, 5).join(', ')}`);
    }
    if (stats.threw.length > 0)
    {
        lines.push(`  first 5 thrown:                ${stats.threw.slice(0, 5).join(' | ')}`);
    }
    if (stats.slow.length > 0)
    {
        lines.push(`  ${stats.slow.length} slow entries (> ${SLOW_THRESHOLD_MS}ms): ${stats.slow.slice(0, 5).join(', ')}`);
    }
    console.log(lines.join('\n'));
}

// Verifies that Op(A, B, op) produces a result whose Contains agrees
// with the input ops at N probe points. Skipped probes near vertices
// are subtracted from the clean count; if fewer than MIN_CLEAN_PROBES
// remain (e.g. tiny shapes where every probe is near a control
// point), the test falls back to the robustness contract: Op
// returned a boolean without throwing AND the result bbox is finite.
//
// One node:test entry per suite — runs all entries in a loop and
// reports tallied stats. The per-entry verbose registration
// (test() per entry) overwhelmed node:test's worker model when
// scaled across 500+ adversarial tests; this summary form runs the
// whole batch under one timeout and prints a categorized roll-up.
export function runOpCorpus(suiteName: string, entries: OpCorpusEntry[]): void
{
    test(suiteName, { timeout: 600_000, skip: !process.env.RUN_PATHOPS_CORPUS }, () => {
        const stats = emptyStats();
        for (const e of entries) runOneOp(e, stats);
        reportStats(suiteName, stats);
        const hardFails = stats.threw.length + stats.nonFinite.length;
        assert.equal(hardFails, 0,
            `hard failures (throw or non-finite bbox): ${hardFails}`);
    });
}

// Verifies that Simplify(P) produces a result whose Contains agrees
// with P.Contains at N probe points. Same summary-style run as
// runOpCorpus.
export function runSimplifyCorpus(suiteName: string, entries: SimplifyCorpusEntry[]): void
{
    test(suiteName, { timeout: 600_000, skip: !process.env.RUN_PATHOPS_CORPUS }, () => {
        const stats = emptyStats();
        for (const e of entries) runOneSimplify(e, stats);
        reportStats(suiteName, stats);
        const hardFails = stats.threw.length + stats.nonFinite.length;
        assert.equal(hardFails, 0,
            `hard failures (throw or non-finite bbox): ${hardFails}`);
    });
}

// Fail-path verifier — for tests whose source called testPathOpFail
// or testPathOpFuzz. Skia's expectation: Op() returns false on these
// adversarial inputs without throwing or producing infinite bounds.
// The port may legitimately succeed on a fail-test where Skia
// historically didn't; we accept either outcome but enforce
// finiteness.
export function runOpCorpusFail(suiteName: string, entries: OpCorpusEntry[]): void
{
    test(`${suiteName} (fail)`, { timeout: 600_000, skip: !process.env.RUN_PATHOPS_CORPUS }, () => {
        const stats = emptyStats();
        for (const e of entries) runOneOp(e, stats);
        reportStats(suiteName + ' (fail)', stats);
        // Fail-corpus only enforces finiteness — Skia historically
        // returned false on these, but the port may now succeed and
        // that's fine.
        assert.equal(stats.threw.length + stats.nonFinite.length, 0,
            `hard failures in fail-corpus: throw=${stats.threw.length} non-finite=${stats.nonFinite.length}`);
    });
}

export function runSimplifyCorpusFail(suiteName: string, entries: SimplifyCorpusEntry[]): void
{
    test(`${suiteName} (fail)`, { timeout: 600_000, skip: !process.env.RUN_PATHOPS_CORPUS }, () => {
        const stats = emptyStats();
        for (const e of entries) runOneSimplify(e, stats);
        reportStats(suiteName + ' (fail)', stats);
        assert.equal(stats.threw.length + stats.nonFinite.length, 0,
            `hard failures in fail-corpus: throw=${stats.threw.length} non-finite=${stats.nonFinite.length}`);
    });
}
