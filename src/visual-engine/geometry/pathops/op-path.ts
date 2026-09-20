// Path-ops input/output representation. Skia consumes / produces an
// SkPath (verb stream + point array + optional conic weights);
// mural's equivalent is a flat OpPath: an array of "commands" where
// each command is one of move / line / quad / cubic / close, with the
// associated points stored inline.
//
// This is a deliberately minimal type — the OpEdgeBuilder consumes it
// to build the contour tree, and OpPathWriter writes it back out.
// Callers can layer their own renderer-shaped path (e.g. mural's
// PathFigure / PathGeometry) on top via a converter.

import { Point } from './point.js';
import { OpVerb } from './op-fwd.js';

// §19-deferred #2 — same-original-curve coalescing hint. Attached to
// curve commands emitted by `Op() / Simplify()` so a post-pass can fuse
// adjacent sub-spans of the same input curve back into one segment. The
// `seg` field is an opaque object reference used only for identity
// comparison; `sourcePts` is a snapshot so the post-pass doesn't have
// to reach back into the live engine state.
export interface CurveProvenance
{
    seg:        object;
    tStart:     number;
    tEnd:       number;
    sourceVerb: OpVerb;
    sourcePts:  Point[];
}

export interface OpPathCommand
{
    verb: OpVerb;        // kMove | kLine | kQuad | kCubic | kClose
    pts:  Point[];       // 1 for move, 1 for line, 2 for quad, 3 for cubic, 0 for close
    weight?: number;     // conic only (not currently in mural's port)
    prov?:   CurveProvenance;
}

export enum OpFillType
{
    kWinding = 0,
    kEvenOdd = 1,
    kInverseWinding = 2,
    kInverseEvenOdd = 3,
}

export class OpPath
{
    public fCommands: OpPathCommand[] = [];
    public fFillType: OpFillType = OpFillType.kWinding;
    // Track the last issued point so lineTo / quadTo / cubicTo can
    // omit redundant moveTos.
    private _last: Point = new Point(0, 0);
    private _hasMove: boolean = false;

    public reset(): void
    {
        this.fCommands = [];
        this._last = new Point(0, 0);
        this._hasMove = false;
    }

    public setFillType(t: OpFillType): void { this.fFillType = t; }
    public getFillType(): OpFillType { return this.fFillType; }

    public isInverseFillType(): boolean
    {
        return this.fFillType === OpFillType.kInverseEvenOdd
            || this.fFillType === OpFillType.kInverseWinding;
    }

    public toggleInverseFillType(): void
    {
        this.fFillType = (this.fFillType ^ 2) as OpFillType;
    }

    public isEmpty(): boolean
    {
        return this.fCommands.length === 0;
    }

    public moveTo(p: Point): void
    {
        this.fCommands.push({ verb: OpVerb.kMove, pts: [p] });
        this._last = p;
        this._hasMove = true;
    }

    public lineTo(p: Point): void
    {
        if (!this._hasMove) this.moveTo(new Point(0, 0));
        this.fCommands.push({ verb: OpVerb.kLine, pts: [p] });
        this._last = p;
    }

    public quadTo(c: Point, p: Point, prov?: CurveProvenance): void
    {
        if (!this._hasMove) this.moveTo(new Point(0, 0));
        const cmd: OpPathCommand = { verb: OpVerb.kQuad, pts: [c, p] };
        if (prov !== undefined) cmd.prov = prov;
        this.fCommands.push(cmd);
        this._last = p;
    }

    public cubicTo(c1: Point, c2: Point, p: Point, prov?: CurveProvenance): void
    {
        if (!this._hasMove) this.moveTo(new Point(0, 0));
        const cmd: OpPathCommand = { verb: OpVerb.kCubic, pts: [c1, c2, p] };
        if (prov !== undefined) cmd.prov = prov;
        this.fCommands.push(cmd);
        this._last = p;
    }

    public close(): void
    {
        this.fCommands.push({ verb: OpVerb.kClose, pts: [] });
        this._hasMove = false;
    }

    public getLastPt(): Point | undefined
    {
        return this._hasMove || this.fCommands.length > 0 ? this._last : undefined;
    }

    // Convenience: append another path's commands. moveTo / addPath /
    // close-merge concerns are left to the caller — this is the raw
    // "extend with the other path's commands" version.
    public addPath(other: OpPath): void
    {
        for (const c of other.fCommands)
        {
            const copy: OpPathCommand = { verb: c.verb, pts: c.pts.slice(), weight: c.weight };
            if (c.prov !== undefined) copy.prov = c.prov;
            this.fCommands.push(copy);
            if (c.pts.length > 0) this._last = c.pts[c.pts.length - 1]!;
            if (c.verb === OpVerb.kMove) this._hasMove = true;
            else if (c.verb === OpVerb.kClose) this._hasMove = false;
        }
    }

    // Reverse the path's commands so the contour is traced
    // end-to-start. Used by OpPathWriter.assemble when splicing
    // contours of mismatched orientation.
    public reverseAddPath(other: OpPath): void
    {
        if (other.fCommands.length === 0) return;
        // Find the starting point of `other` (its first move).
        let firstPt: Point | undefined = undefined;
        for (const c of other.fCommands)
        {
            if (c.verb === OpVerb.kMove) { firstPt = c.pts[0]!; break; }
        }
        if (firstPt === undefined) return;
        // Build a list of (verb, prevPt, cmd) and emit in reverse.
        const stack: Array<{ verb: OpVerb; prev: Point; cmd: OpPathCommand }> = [];
        let prev: Point = firstPt;
        for (const c of other.fCommands)
        {
            stack.push({ verb: c.verb, prev, cmd: c });
            if (c.pts.length > 0) prev = c.pts[c.pts.length - 1]!;
        }
        // Emit in reverse — last endpoint becomes our moveTo target.
        const last = stack[stack.length - 1]!;
        this.moveTo(last.cmd.pts.length > 0 ? last.cmd.pts[last.cmd.pts.length - 1]! : last.prev);
        for (let i = stack.length - 1; i >= 0; --i)
        {
            const item = stack[i]!;
            switch (item.verb)
            {
                case OpVerb.kLine:
                    this.lineTo(item.prev);
                    break;
                case OpVerb.kQuad:
                    this.quadTo(item.cmd.pts[0]!, item.prev);
                    break;
                case OpVerb.kCubic:
                    this.cubicTo(item.cmd.pts[1]!, item.cmd.pts[0]!, item.prev);
                    break;
                case OpVerb.kClose:
                case OpVerb.kMove:
                    break;
                default: break;
            }
        }
    }

    // Iterate commands as a verb / pts pair.
    public * iterate(): IterableIterator<OpPathCommand>
    {
        for (const c of this.fCommands) yield c;
    }
}
