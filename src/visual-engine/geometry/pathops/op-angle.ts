// Copyright 2012 Google Inc.
//
// Use of this source code is governed by a BSD-style license that can
// be found in the LICENSE-skia file at the root of this repository.
//
// TypeScript port: 2026 Eugene Napryaglo.
// Source: third_party/skia/src/pathops/SkOpAngle.{h,cpp}
//         (Skia commit pinned in third_party/skia)
//
// Phase 6 chunk 3 — angle sort kernel. An OpAngle records the local
// tangent geometry on one end of a span; rings of angles at branching
// intersections are sorted clockwise by orderable() so the winding
// walker can pick the correct next segment.
//
// Curve representation: Skia uses SkDCurve (union of line/quad/conic/
// cubic) for both the divided sub-arc (fPart) and the original (fOriginalCurvePart).
// TypeScript has no value-typed unions, so we store a flat
// `pts: [Point, Point, Point, Point]` array indexed up to verb-points,
// plus a verb tag. The Skia patterns `fPart.fCurve[2] = fPart.fCurve[points]`
// (mutation by index) and `testCurve[idx]` (read by index) translate
// directly to `pts[2] = pts[points]` / `pts[idx]`.
//
// Sweep + curve flags: setCurveHullSweep computes the two sweep
// vectors and the isCurve / ordered flags directly on the OpAngle.
// fOriginalCurvePart never has sweep vectors — only fPart does.

import { Cubic } from './cubic.js';
import { Intersections } from './intersections.js';
import { Line } from './line.js';
import { LineParameters } from './line-parameters.js';
import { Point, Vector } from './point.js';
import { Quad } from './quad.js';
import {
    AlmostBequalUlps,
    AlmostEqualUlps,
    approximately_between_orderable,
    approximately_equal_orderable,
    approximately_zero,
    roughly_zero_when_compared_to,
} from './types.js';
import { OpGlobalState } from './op-global-state.js';
import {
    OpVerb,
    verbToPoints,
    type OpAngleLike,
    type OpSegmentLike,
    type OpSpanBaseLike,
} from './op-fwd.js';
import type { OpSpanBase, OpSpan } from './op-span.js';

// Import-for-side-effects: install ray-line intersection helpers used
// by endToSide / midToSide / endsIntersect.
import './quad-line-intersection.js';
import './cubic-line-intersection.js';

// ── Flat-pts curve carrier (OpAngle-internal) ────────────────────
//
// Skia's SkDCurve is a union. We replace with a 4-slot array indexed
// by [0..verbToPoints(verb)]. Slots beyond the verb are unused but
// allocated so the indices line up with Skia's union layout.

interface AngleCurve
{
    pts:    [Point, Point, Point, Point];
    verb:   OpVerb;
    weight: number;
}

function makeAngleCurve(verb: OpVerb = OpVerb.kLine, weight: number = 1): AngleCurve
{
    return {
        pts: [new Point(), new Point(), new Point(), new Point()],
        verb,
        weight,
    };
}

function copyAngleCurve(dst: AngleCurve, src: AngleCurve): void
{
    dst.verb   = src.verb;
    dst.weight = src.weight;
    for (let i = 0; i < 4; ++i)
    {
        dst.pts[i] = new Point(src.pts[i]!.fX, src.pts[i]!.fY);
    }
}

// ── Verb-dispatched ray-cast helpers ─────────────────────────────
//
// Skia uses a function table CurveIntersectRay[verb]. Mural's
// Intersections class has per-pair methods (intersectRayLineLine etc.);
// dispatch is a small switch on verb.

function curveIntersectRay(verb: OpVerb, pts: readonly Point[], _weight: number,
                            rayP0: Point, rayP1: Point, ix: Intersections): void
{
    const rayLine = new Line(rayP0, rayP1);
    switch (verb)
    {
        case OpVerb.kLine:
        {
            const seg = new Line(pts[0]!, pts[1]!);
            ix.intersectRayLineLine(seg, rayLine);
            return;
        }
        case OpVerb.kQuad:
        {
            const q = new Quad();
            q.fPts = [pts[0]!, pts[1]!, pts[2]!];
            ix.intersectRayQuadLine(q, rayLine);
            return;
        }
        case OpVerb.kCubic:
        {
            const c = new Cubic();
            c.fPts = [pts[0]!, pts[1]!, pts[2]!, pts[3]!];
            ix.intersectRayCubicLine(c, rayLine);
            return;
        }
        default:
            throw new Error(`curveIntersectRay: unsupported verb ${verb}`);
    }
}

function dPtAtT(verb: OpVerb, pts: readonly Point[], _weight: number, t: number): Point
{
    switch (verb)
    {
        case OpVerb.kLine: return new Line(pts[0]!, pts[1]!).ptAtT(t);
        case OpVerb.kQuad:
        {
            const q = new Quad();
            q.fPts = [pts[0]!, pts[1]!, pts[2]!];
            return q.ptAtT(t);
        }
        case OpVerb.kCubic:
        {
            const c = new Cubic();
            c.fPts = [pts[0]!, pts[1]!, pts[2]!, pts[3]!];
            return c.ptAtT(t);
        }
        default:
            throw new Error(`dPtAtT: unsupported verb ${verb}`);
    }
}

function dSlopeAtT(verb: OpVerb, pts: readonly Point[], _weight: number, t: number): Vector
{
    switch (verb)
    {
        case OpVerb.kLine:
        {
            return new Vector(pts[1]!.fX - pts[0]!.fX, pts[1]!.fY - pts[0]!.fY);
        }
        case OpVerb.kQuad:
        {
            const q = new Quad();
            q.fPts = [pts[0]!, pts[1]!, pts[2]!];
            return q.dxdyAtT(t);
        }
        case OpVerb.kCubic:
        {
            const c = new Cubic();
            c.fPts = [pts[0]!, pts[1]!, pts[2]!, pts[3]!];
            return c.dxdyAtT(t);
        }
        default:
            throw new Error(`dSlopeAtT: unsupported verb ${verb}`);
    }
}

// ── AngleIncludeType ─────────────────────────────────────────────

export enum AngleIncludeType
{
    kUnaryWinding = 0,
    kUnaryXor     = 1,
    kBinarySingle = 2,
    kBinaryOpp    = 3,
}

// ── OpAngle ─────────────────────────────────────────────────────

export class OpAngle implements OpAngleLike
{
    // Sub-arc covering [fStart.t(), fEnd.t()]. Skia's SkDCurveSweep
    // bundles the sub-curve + sweep vectors; we flatten directly.
    public fPart: AngleCurve = makeAngleCurve();
    // Original sub-arc — same as fPart at construction, preserved so
    // alignmentSameSide / linesOnOriginalSide can compare the
    // translated form against the source.
    public fOriginalCurvePart: AngleCurve = makeAngleCurve();
    // Two sweep vectors. For a line both equal the curve direction;
    // for a quad they're (p1-p0) and (p2-p0); for a cubic they wrap
    // through (p1-p0), (p2-p0), (p3-p0) depending on whether the
    // control-polygon turn is monotone (ordered === true).
    public fSweep: [Vector, Vector] = [new Vector(0, 0), new Vector(0, 0)];
    public fIsCurve: boolean = false;
    public fOrdered: boolean = true;

    // Used only when sorting a pair of line / line-like sections —
    // captures the tangent of the line for an analytical cross product.
    public fTangentHalf: LineParameters = new LineParameters();
    // Negative side-of-tangent of the curve's far end. Sign-only.
    public fSide: number = 0;

    public fNext: OpAngle | undefined = undefined;
    public fLastMarked: OpSpanBase | undefined = undefined;

    public fStart:       OpSpanBase | undefined = undefined;
    public fEnd:         OpSpanBase | undefined = undefined;
    public fComputedEnd: OpSpanBase | undefined = undefined;

    public fSectorMask:  number = 0;
    public fSectorStart: number = -1;
    public fSectorEnd:   number = -1;

    public fUnorderable:        boolean = false;
    public fComputeSector:      boolean = false;
    public fComputedSector:     boolean = false;
    public fCheckCoincidence:   boolean = false;
    public fTangentsAmbiguous:  boolean = false;

    public fID: number = -1;

    constructor() {}

    // SkOpAngle.cpp:973.
    public set(start: OpSpanBase, end: OpSpanBase): void
    {
        if (start === end) throw new Error('OpAngle.set: start === end');
        this.fStart = start;
        this.fEnd = end;
        this.fComputedEnd = end;
        this.fNext = undefined;
        this.fComputeSector = false;
        this.fComputedSector = false;
        this.fCheckCoincidence = false;
        this.fTangentsAmbiguous = false;
        this.setSpans();
        this.setSector();
        const state = start.globalState();
        this.fID = state.nextAngleID();
    }

    // ── Trivial getters ──────────────────────────────────────────

    public start(): OpSpanBaseLike { return this.fStart!; }
    public end():   OpSpanBaseLike { return this.fEnd!; }

    public next(): OpAngle | undefined { return this.fNext; }
    public lastMarked(): OpSpanBase | undefined
    {
        // SkOpAngle.cpp:801 — consume-on-read: returns and chases.
        if (this.fLastMarked !== undefined)
        {
            if (this.fLastMarked.chased()) return undefined;
            this.fLastMarked.setChased(true);
        }
        return this.fLastMarked;
    }
    public setLastMarked(marked: OpSpanBase): void { this.fLastMarked = marked; }

    public segment(): OpSegmentLike { return this.fStart!.segment(); }

    public tangentsAmbiguous(): boolean { return this.fTangentsAmbiguous; }
    public unorderable():       boolean { return this.fUnorderable; }
    public sectorStart():       number  { return this.fSectorStart; }
    public sectorEnd():         number  { return this.fSectorEnd; }
    public sectorMask():        number  { return this.fSectorMask; }

    public globalState(): OpGlobalState { return this.fStart!.globalState(); }

    public midT(): number
    {
        return (this.fStart!.t() + this.fEnd!.t()) / 2;
    }

    // SkOpAngle.cpp:958.
    public previous(): OpAngle
    {
        if (this.fNext === undefined)
            throw new Error('OpAngle.previous: not linked into a loop');
        let last: OpAngle = this.fNext;
        for (;;)
        {
            const next: OpAngle | undefined = last.fNext;
            if (next === undefined)
                throw new Error('OpAngle.previous: broken ring');
            if (next === this) return last;
            last = next;
        }
    }

    public loopCount(): number
    {
        let count = 0;
        const first: OpAngle = this;
        let next:    OpAngle | undefined = this;
        do
        {
            next = next!.fNext;
            ++count;
        } while (next !== undefined && next !== first);
        return count;
    }

    public loopContains(angle: OpAngle): boolean
    {
        if (this.fNext === undefined) return false;
        const first: OpAngle = this;
        let loop:    OpAngle = this;
        const tSegment = angle.fStart!.segment();
        const tStart   = angle.fStart!.t();
        const tEnd     = angle.fEnd!.t();
        do
        {
            const lSegment = loop.fStart!.segment();
            if (lSegment !== tSegment) { loop = loop.fNext!; continue; }
            const lStart = loop.fStart!.t();
            if (lStart !== tEnd) { loop = loop.fNext!; continue; }
            const lEnd = loop.fEnd!.t();
            if (lEnd === tStart) return true;
            loop = loop.fNext!;
        } while (loop !== first);
        return false;
    }

    public starter(): OpSpan { return this.fStart!.starter(this.fEnd!); }

    // ── setSpans / setSector / findSector ─────────────────────────

    // SkOpCurve.cpp:90 — compute sweep vectors + isCurve/ordered.
    private setCurveHullSweep(): void
    {
        const verb = this.fPart.verb;
        const pts  = this.fPart.pts;
        this.fOrdered = true;
        this.fSweep[0] = new Vector(pts[1]!.fX - pts[0]!.fX, pts[1]!.fY - pts[0]!.fY);
        if (verb === OpVerb.kLine)
        {
            this.fSweep[1] = new Vector(this.fSweep[0].fX, this.fSweep[0].fY);
            this.fIsCurve = false;
            return;
        }
        this.fSweep[1] = new Vector(pts[2]!.fX - pts[0]!.fX, pts[2]!.fY - pts[0]!.fY);
        let maxVal = 0;
        const n = verbToPoints(verb);
        for (let idx = 0; idx <= n; ++idx)
        {
            maxVal = Math.max(maxVal, Math.abs(pts[idx]!.fX), Math.abs(pts[idx]!.fY));
        }
        if (verb !== OpVerb.kCubic)
        {
            if (roughly_zero_when_compared_to(this.fSweep[0].fX, maxVal)
                && roughly_zero_when_compared_to(this.fSweep[0].fY, maxVal))
                {
                this.fSweep[0] = new Vector(this.fSweep[1].fX, this.fSweep[1].fY);
            }
            this.fIsCurve = this.fSweep[0].crossCheck(this.fSweep[1]) !== 0;
            return;
        }
        // Cubic branch.
        const thirdSweep = new Vector(pts[3]!.fX - pts[0]!.fX, pts[3]!.fY - pts[0]!.fY);
        if (this.fSweep[0].fX === 0 && this.fSweep[0].fY === 0)
        {
            this.fSweep[0] = new Vector(this.fSweep[1].fX, this.fSweep[1].fY);
            this.fSweep[1] = new Vector(thirdSweep.fX, thirdSweep.fY);
            if (roughly_zero_when_compared_to(this.fSweep[0].fX, maxVal)
                && roughly_zero_when_compared_to(this.fSweep[0].fY, maxVal))
                {
                this.fSweep[0] = new Vector(this.fSweep[1].fX, this.fSweep[1].fY);
                this.fPart.pts[1] = new Point(pts[3]!.fX, pts[3]!.fY);
            }
            this.fIsCurve = this.fSweep[0].crossCheck(this.fSweep[1]) !== 0;
            return;
        }
        const s1x3 = this.fSweep[0].crossCheck(thirdSweep);
        const s3x2 = thirdSweep.crossCheck(this.fSweep[1]);
        if (s1x3 * s3x2 >= 0)
        {
            this.fIsCurve = this.fSweep[0].crossCheck(this.fSweep[1]) !== 0;
            return;
        }
        const s2x1 = this.fSweep[1].crossCheck(this.fSweep[0]);
        if (s3x2 * s2x1 < 0)
        {
            this.fSweep[0] = new Vector(this.fSweep[1].fX, this.fSweep[1].fY);
            this.fOrdered = false;
        }
        this.fSweep[1] = new Vector(thirdSweep.fX, thirdSweep.fY);
        this.fIsCurve = this.fSweep[0].crossCheck(this.fSweep[1]) !== 0;
    }

    // SkOpAngle.cpp:984.
    public setSpans(): void
    {
        this.fUnorderable = false;
        this.fLastMarked  = undefined;
        if (this.fStart === undefined)
        {
            this.fUnorderable = true;
            return;
        }
        const segment = this.fStart.segment();
        const pts = segment.pts();
        const verb = segment.verb();
        // Sub-divide segment between start and end into fPart.
        this.subDivideInto(this.fPart);
        copyAngleCurve(this.fOriginalCurvePart, this.fPart);
        this.setCurveHullSweep();
        // Curve degenerated to a line — treat as line for tangent math.
        if (verb !== OpVerb.kLine && !this.fIsCurve)
        {
            const n = verbToPoints(verb);
            this.fPart.pts[1] = new Point(this.fPart.pts[n]!.fX, this.fPart.pts[n]!.fY);
            this.fOriginalCurvePart.pts[1] = new Point(this.fPart.pts[1]!.fX, this.fPart.pts[1]!.fY);
            const lineHalf = new Line(this.fPart.pts[0]!, this.fPart.pts[1]!);
            this.fTangentHalf.lineEndPoints(lineHalf);
            this.fSide = 0;
        }
        switch (verb)
        {
            case OpVerb.kLine:
            {
                if (this.fStart === this.fEnd)
                    throw new Error('OpAngle.setSpans: line start === end');
                const cP1Index = this.fStart.t() < this.fEnd!.t() ? 1 : 0;
                const lineHalf = new Line(this.fStart.pt(), pts[cP1Index]!);
                this.fTangentHalf.lineEndPoints(lineHalf);
                this.fSide = 0;
                return;
            }
            case OpVerb.kQuad:
            {
                const tangentPart = new LineParameters();
                const q = new Quad();
                q.fPts = [this.fPart.pts[0]!, this.fPart.pts[1]!, this.fPart.pts[2]!];
                tangentPart.quadEndPoints(q);
                this.fSide = -tangentPart.pointDistance(this.fPart.pts[2]!);
                return;
            }
            case OpVerb.kCubic:
            {
                const tangentPart = new LineParameters();
                const c = new Cubic();
                c.fPts = [this.fPart.pts[0]!, this.fPart.pts[1]!, this.fPart.pts[2]!, this.fPart.pts[3]!];
                tangentPart.cubicPart(c);
                this.fSide = -tangentPart.pointDistance(this.fPart.pts[3]!);
                // Inflection-aware best-side search.
                const fullCubic = new Cubic();
                fullCubic.fPts = [pts[0]!, pts[1]!, pts[2]!, pts[3]!];
                const inflTs: number[] = [0, 0, 0, 0];
                const inflCount = fullCubic.findInflections(inflTs);
                const startT = this.fStart.t();
                const endT   = this.fEnd!.t();
                const limitT = endT;
                let testCount = inflCount;
                for (let i = 0; i < testCount; ++i)
                {
                    if (!skiaBetween(startT, inflTs[i]!, limitT)) inflTs[i] = -1;
                }
                inflTs[testCount++] = startT;
                inflTs[testCount++] = endT;
                inflTs.length = testCount;
                inflTs.sort((a, b) => a - b);
                let bestSide = 0;
                const testCases = (testCount << 1) - 1;
                let i = 0;
                while (i < testCount && inflTs[i]! < 0) ++i;
                let idx = i << 1;
                for (; idx < testCases; ++idx)
                {
                    const ti = idx >> 1;
                    let testT = inflTs[ti]!;
                    if (idx & 1) testT = (testT + inflTs[ti + 1]!) / 2;
                    const pt = dPtAtT(OpVerb.kCubic, pts, segment.weight(), testT);
                    const testPart = new LineParameters();
                    const cPart = new Cubic();
                    cPart.fPts = [this.fPart.pts[0]!, this.fPart.pts[1]!,
                                  this.fPart.pts[2]!, this.fPart.pts[3]!];
                    testPart.cubicEndPoints(cPart);
                    const testSide = testPart.pointDistance(pt);
                    if (Math.abs(bestSide) < Math.abs(testSide)) bestSide = testSide;
                }
                this.fSide = -bestSide;
                return;
            }
            default:
                throw new Error(`OpAngle.setSpans: unsupported verb ${verb}`);
        }
    }

    // Helper — subdivide [start, end] into the AngleCurve. Skia's
    // SkOpSegment.subDivide writes into an SkDCurve union; we replicate
    // the flat-pts pattern here.
    private subDivideInto(out: AngleCurve): void
    {
        const segment = this.fStart!.segment();
        const verb = segment.verb();
        const pts = segment.pts();
        const startPtT = this.fStart!.ptT();
        const endPtT   = this.fEnd!.ptT();
        const startT = startPtT.fT;
        const endT   = endPtT.fT;
        out.verb = verb;
        out.weight = segment.weight();
        const n = verbToPoints(verb);
        out.pts[0] = new Point(startPtT.fPt.fX, startPtT.fPt.fY);
        out.pts[n] = new Point(endPtT.fPt.fX, endPtT.fPt.fY);
        if (verb === OpVerb.kLine) return;
        // Endpoint case — direct copy of control points.
        if ((startT === 0 || endT === 0) && (startT === 1 || endT === 1))
        {
            if (verb === OpVerb.kQuad)
            {
                out.pts[1] = new Point(pts[1]!.fX, pts[1]!.fY);
                return;
            }
            if (startT === 0)
            {
                out.pts[1] = new Point(pts[1]!.fX, pts[1]!.fY);
                out.pts[2] = new Point(pts[2]!.fX, pts[2]!.fY);
            }
            else
            {
                out.pts[1] = new Point(pts[2]!.fX, pts[2]!.fY);
                out.pts[2] = new Point(pts[1]!.fX, pts[1]!.fY);
            }
            return;
        }
        if (verb === OpVerb.kQuad)
        {
            const full = new Quad();
            full.fPts = [pts[0]!, pts[1]!, pts[2]!];
            const sub = full.subDivide(startT, endT);
            out.pts[1] = new Point(sub.fPts[1]!.fX, sub.fPts[1]!.fY);
            return;
        }
        // Cubic.
        const full = new Cubic();
        full.fPts = [pts[0]!, pts[1]!, pts[2]!, pts[3]!];
        const sub = full.subDivide(startT, endT);
        out.pts[1] = new Point(sub.fPts[1]!.fX, sub.fPts[1]!.fY);
        out.pts[2] = new Point(sub.fPts[2]!.fX, sub.fPts[2]!.fY);
    }

    // SkOpAngle.cpp:723.
    public findSector(verb: OpVerb, x: number, y: number): number
    {
        const absX = Math.abs(x);
        const absY = Math.abs(y);
        const xy = (verb === OpVerb.kLine || !AlmostEqualUlps(absX, absY)) ? absX - absY : 0;
        // sedecimant[xyAxis][yAxis][xAxis], indices via (>=0)+(>0).
        const xyI = (xy >= 0 ? 1 : 0) + (xy > 0 ? 1 : 0);
        const yI  = (y  >= 0 ? 1 : 0) + (y  > 0 ? 1 : 0);
        const xI  = (x  >= 0 ? 1 : 0) + (x  > 0 ? 1 : 0);
        const sector: number = OpAngle._sedecimant[xyI]![yI]![xI]!;
        return sector < 0 ? sector : sector * 2 + 1;
    }

    private static readonly _sedecimant: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>> = [
        // y<0           y==0           y>0
        //   x<0 x==0 x>0  x<0 x==0 x>0  x<0 x==0 x>0
        [[ 4,  3,  2], [ 7, -1, 15], [10, 11, 12]],  // abs(x) <  abs(y)
        [[ 5, -1,  1], [-1, -1, -1], [ 9, -1, 13]],  // abs(x) == abs(y)
        [[ 6,  3,  0], [ 7, -1, 15], [ 8, 11, 14]],  // abs(x) >  abs(y)
    ];

    // SkOpAngle.cpp:1074.
    public setSector(): void
    {
        if (this.fStart === undefined) { this.fUnorderable = true; return; }
        const segment = this.fStart.segment();
        const verb = segment.verb();
        this.fSectorStart = this.findSector(verb, this.fSweep[0].fX, this.fSweep[0].fY);
        if (this.fSectorStart < 0)
        {
            this._deferSector();
            return;
        }
        if (!this.fIsCurve)
        {
            this.fSectorEnd = this.fSectorStart;
            this.fSectorMask = 1 << this.fSectorStart;
            return;
        }
        if (verb === OpVerb.kLine) throw new Error('OpAngle.setSector: line marked curve');
        this.fSectorEnd = this.findSector(verb, this.fSweep[1].fX, this.fSweep[1].fY);
        if (this.fSectorEnd < 0)
        {
            this._deferSector();
            return;
        }
        if (this.fSectorEnd === this.fSectorStart && (this.fSectorStart & 3) !== 3)
        {
            this.fSectorMask = 1 << this.fSectorStart;
            return;
        }
        // Bump exact-compass-points away from the edge.
        let crossesZero = this.checkCrossesZero();
        const minSector = Math.min(this.fSectorStart, this.fSectorEnd);
        const curveBendsCCW = (this.fSectorStart === minSector) !== crossesZero;
        if ((this.fSectorStart & 3) === 3)
        {
            this.fSectorStart = (this.fSectorStart + (curveBendsCCW ? 1 : 31)) & 0x1f;
        }
        if ((this.fSectorEnd & 3) === 3)
        {
            this.fSectorEnd = (this.fSectorEnd + (curveBendsCCW ? 31 : 1)) & 0x1f;
        }
        crossesZero = this.checkCrossesZero();
        const start = Math.min(this.fSectorStart, this.fSectorEnd);
        const end   = Math.max(this.fSectorStart, this.fSectorEnd);
        if (!crossesZero)
        {
            // (uint32) -1 >> (31 - end + start) << start
            this.fSectorMask = ((0xFFFFFFFF >>> (31 - end + start)) << start) >>> 0;
        }
        else
        {
            this.fSectorMask = ((0xFFFFFFFF >>> (31 - start))
                              | ((0xFFFFFFFF << end) >>> 0)) >>> 0;
        }
    }

    private _deferSector(): void
    {
        this.fSectorStart = this.fSectorEnd = -1;
        this.fSectorMask  = 0;
        this.fComputeSector = true;
    }

    // SkOpAngle.cpp:343.
    public checkCrossesZero(): boolean
    {
        const start = Math.min(this.fSectorStart, this.fSectorEnd);
        const end   = Math.max(this.fSectorStart, this.fSectorEnd);
        return end - start > 16;
    }

    // SkOpAngle.cpp:401.
    public computeSector(): boolean
    {
        if (this.fComputedSector) return !this.fUnorderable;
        this.fComputedSector = true;
        const stepUp = this.fStart!.t() < this.fEnd!.t();
        let checkEnd: OpSpanBase | undefined = this.fEnd;
        if (checkEnd!.final() && stepUp)
        {
            this.fUnorderable = true;
            return false;
        }
        outer: while (checkEnd !== undefined)
        {
            // Walk every other span on the segment looking for a t-match.
            const other = checkEnd.segment();
            let oSpan: OpSpanBase | undefined = other.head() as unknown as OpSpanBase;
            while (oSpan !== undefined)
            {
                if (oSpan.segment() !== this.segment()) { /* skip */ }
                else if (oSpan === checkEnd) { /* skip */ }
                else if (Math.abs(oSpan.t() - checkEnd.t()) < 1e-12)
                {
                    // Approximate t-equality match — found another span at the
                    // computed checkEnd parameter; stop walking and rebuild.
                    break outer;
                }
                if (oSpan.final()) break;
                oSpan = (oSpan as OpSpan).next();
            }
            checkEnd = stepUp
                ? (checkEnd.final() ? undefined : (checkEnd as OpSpan).next())
                : checkEnd.prev();
        }
        const computedEnd: OpSpanBase | undefined = stepUp
            ? (checkEnd !== undefined ? checkEnd.prev() : (this.fEnd!.segment().head() as unknown as OpSpanBase))
            : (checkEnd !== undefined ? (checkEnd as OpSpan).next() : this.fEnd!.segment().tail() as unknown as OpSpanBase);
        if (checkEnd === this.fEnd || computedEnd === this.fEnd || computedEnd === this.fStart)
        {
            this.fUnorderable = true;
            return false;
        }
        if (computedEnd === undefined) { this.fUnorderable = true; return false; }
        if (stepUp !== (this.fStart!.t() < computedEnd.t()))
        {
            this.fUnorderable = true;
            return false;
        }
        const saveEnd = this.fEnd!;
        this.fComputedEnd = this.fEnd = computedEnd;
        this.setSpans();
        this.setSector();
        this.fEnd = saveEnd;
        return !this.fUnorderable;
    }

    // ── Comparator helpers ───────────────────────────────────────

    // SkOpAngle.cpp:230 — line-on-one-side test against a test angle's
    // curve points. Returns -1 if the test curve straddles the line,
    // 0 if the test is CW of line, 1 if CCW, -2 if degenerate.
    public lineOnOneSideOrigin(origin: Point, line: Vector, test: OpAngle, useOriginal: boolean): number
    {
        const crosses: [number, number, number] = [0, 0, 0];
        const testVerb = test.segment().verb();
        const iMax = verbToPoints(testVerb);
        const testCurve = useOriginal ? test.fOriginalCurvePart : test.fPart;
        for (let idx = 1; idx <= iMax; ++idx)
        {
            const xy1 = line.fX * (testCurve.pts[idx]!.fY - origin.fY);
            const xy2 = line.fY * (testCurve.pts[idx]!.fX - origin.fX);
            crosses[idx - 1] = AlmostBequalUlps(xy1, xy2) ? 0 : xy1 - xy2;
        }
        if (crosses[0]! * crosses[1]! < 0) return -1;
        if (testVerb === OpVerb.kCubic)
        {
            if (crosses[0]! * crosses[2]! < 0 || crosses[1]! * crosses[2]! < 0) return -1;
        }
        if (crosses[0]) return crosses[0] < 0 ? 1 : 0;
        if (crosses[1]) return crosses[1] < 0 ? 1 : 0;
        if (testVerb === OpVerb.kCubic && crosses[2]) return crosses[2] < 0 ? 1 : 0;
        return -2;
    }

    // SkOpAngle.cpp:264.
    public lineOnOneSide(test: OpAngle, useOriginal: boolean): number
    {
        if (this.fIsCurve) throw new Error('OpAngle.lineOnOneSide: this is a curve');
        if (!test.fIsCurve) throw new Error('OpAngle.lineOnOneSide: test is not a curve');
        const origin = this.fPart.pts[0]!;
        const line = new Vector(this.fPart.pts[1]!.fX - origin.fX,
                                this.fPart.pts[1]!.fY - origin.fY);
        let result = this.lineOnOneSideOrigin(origin, line, test, useOriginal);
        if (result === -2)
        {
            this.fUnorderable = true;
            result = -1;
        }
        return result;
    }

    // SkOpAngle.cpp:278.
    public linesOnOriginalSide(test: OpAngle): number
    {
        if (this.fIsCurve)      throw new Error('OpAngle.linesOnOriginalSide: this is a curve');
        if (test.fIsCurve)      throw new Error('OpAngle.linesOnOriginalSide: test is a curve');
        const origin = this.fOriginalCurvePart.pts[0]!;
        const line   = new Vector(this.fOriginalCurvePart.pts[1]!.fX - origin.fX,
                                  this.fOriginalCurvePart.pts[1]!.fY - origin.fY);
        const dots:    [number, number] = [0, 0];
        const crosses: [number, number] = [0, 0];
        for (let i = 0; i < 2; ++i)
        {
            const testPt = test.fOriginalCurvePart.pts[i]!;
            const tl = new Vector(testPt.fX - origin.fX, testPt.fY - origin.fY);
            const xy1 = line.fX * tl.fY;
            const xy2 = line.fY * tl.fX;
            dots[i]    = line.fX * tl.fX + line.fY * tl.fY;
            crosses[i] = AlmostBequalUlps(xy1, xy2) ? 0 : xy1 - xy2;
        }
        if (crosses[0]! * crosses[1]! < 0) return -1;
        if (crosses[0]) return crosses[0] < 0 ? 1 : 0;
        if (crosses[1]) return crosses[1] < 0 ? 1 : 0;
        if ((dots[0] === 0 && dots[1]! < 0) || (dots[0]! < 0 && dots[1] === 0)) return 2;
        this.fUnorderable = true;
        return -1;
    }

    // SkOpAngle.cpp:312.
    public alignmentSameSide(test: OpAngle, orderOut: { value: number }): void
    {
        if (orderOut.value < 0) return;
        if (this.fIsCurve) return;
        if (test.fIsCurve) return;
        const xOrigin = test.fPart.pts[0]!;
        const oOrigin = test.fOriginalCurvePart.pts[0]!;
        if (xOrigin.equals(oOrigin)) return;
        const iMax = verbToPoints(this.segment().verb());
        const xLine = new Vector(test.fPart.pts[1]!.fX - xOrigin.fX,
                                 test.fPart.pts[1]!.fY - xOrigin.fY);
        const oLine = new Vector(test.fOriginalCurvePart.pts[1]!.fX - oOrigin.fX,
                                 test.fOriginalCurvePart.pts[1]!.fY - oOrigin.fY);
        for (let i = 1; i <= iMax; ++i)
        {
            const testPt = this.fPart.pts[i]!;
            const dx1 = testPt.fX - xOrigin.fX, dy1 = testPt.fY - xOrigin.fY;
            const dx2 = testPt.fX - oOrigin.fX, dy2 = testPt.fY - oOrigin.fY;
            const xCross = oLine.crossCheck(new Vector(dx1, dy1));
            const oCross = xLine.crossCheck(new Vector(dx2, dy2));
            if (oCross * xCross < 0) { orderOut.value ^= 1; break; }
        }
    }

    // SkOpAngle.cpp:909.
    public oppositePlanes(rh: OpAngle): boolean
    {
        const startSpan = Math.abs(rh.fSectorStart - this.fSectorStart);
        return startSpan >= 8;
    }

    // SkOpAngle.cpp:499.
    public distEndRatio(dist: number): number
    {
        let longest = 0;
        const segment = this.segment();
        const ptCount = verbToPoints(segment.verb());
        const pts = segment.pts();
        for (let i1 = 0; i1 <= ptCount - 1; ++i1)
        {
            for (let i2 = i1 + 1; i2 <= ptCount; ++i2)
            {
                if (i1 === i2) continue;
                const dx = pts[i2]!.fX - pts[i1]!.fX;
                const dy = pts[i2]!.fY - pts[i1]!.fY;
                const lenSq = dx * dx + dy * dy;
                longest = Math.max(longest, lenSq);
            }
        }
        return Math.sqrt(longest) / dist;
    }

    // SkOpAngle.cpp:1129.
    public tangentsDiverge(rh: OpAngle, s0xt0: number): boolean
    {
        if (s0xt0 === 0) return false;
        const s = this.fSweep;
        const t = rh.fSweep;
        const s0dt0 = s[0]!.dot(t[0]!);
        if (s0dt0 === 0) return true;
        const m = s0xt0 / s0dt0;
        const sDist = s[0]!.length() * m;
        const tDist = t[0]!.length() * m;
        const useS = Math.abs(sDist) < Math.abs(tDist);
        const mFactor = Math.abs(useS ? this.distEndRatio(sDist) : rh.distEndRatio(tDist));
        this.fTangentsAmbiguous = mFactor >= 50 && mFactor < 200;
        return mFactor < 50;
    }

    // SkOpAngle.cpp:652.
    public endToSide(rh: OpAngle, insideOut: { value: boolean }): boolean
    {
        const segment = this.segment();
        const verb = segment.verb();
        const endPt = this.fEnd!.pt();
        const slopeAtEnd = dSlopeAtT(verb, segment.pts(), segment.weight(), this.fEnd!.t());
        const rayP0 = new Point(endPt.fX, endPt.fY);
        const rayP1 = new Point(endPt.fX + slopeAtEnd.fY, endPt.fY - slopeAtEnd.fX);
        const iEnd = new Intersections();
        const oppSegment = rh.segment();
        const oppVerb = oppSegment.verb();
        curveIntersectRay(oppVerb, oppSegment.pts(), oppSegment.weight(), rayP0, rayP1, iEnd);
        const closestEnd = iEnd.closestTo(rh.fStart!.t(), rh.fEnd!.t(), rayP0);
        if (closestEnd.index < 0) return false;
        const endDistSq = closestEnd.distSquared;
        if (endDistSq === 0) return false;
        // Compute max width on rh's part bounding box.
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const oppPts = verbToPoints(oppVerb);
        const curve = rh.fPart.pts;
        for (let i = 0; i <= oppPts; ++i)
        {
            if (curve[i]!.fX < minX) minX = curve[i]!.fX;
            if (curve[i]!.fY < minY) minY = curve[i]!.fY;
            if (curve[i]!.fX > maxX) maxX = curve[i]!.fX;
            if (curve[i]!.fY > maxY) maxY = curve[i]!.fY;
        }
        const maxWidth = Math.max(maxX - minX, maxY - minY);
        const endDist = Math.sqrt(endDistSq) / maxWidth;
        if (!(endDist >= 5e-12)) return false;
        const start = this.fStart!.pt();
        const oppPt = iEnd.pt(closestEnd.index);
        const vLeft = new Vector(rayP0.fX - start.fX, rayP0.fY - start.fY);
        const vRight = new Vector(oppPt.fX - start.fX, oppPt.fY - start.fY);
        const dir = vLeft.crossNoNormalCheck(vRight);
        if (dir === 0) return false;
        insideOut.value = dir < 0;
        return true;
    }

    // SkOpAngle.cpp:873.
    public midToSide(rh: OpAngle, insideOut: { value: boolean }): boolean
    {
        const segment = this.segment();
        const verb = segment.verb();
        const startPt = this.fStart!.pt();
        const endPt   = this.fEnd!.pt();
        const rayP0 = new Point((startPt.fX + endPt.fX) / 2, (startPt.fY + endPt.fY) / 2);
        const rayP1 = new Point(rayP0.fX + (endPt.fY - startPt.fY),
                                 rayP0.fY - (endPt.fX - startPt.fX));
        const iMid = new Intersections();
        curveIntersectRay(verb, segment.pts(), segment.weight(), rayP0, rayP1, iMid);
        const iOutside = iMid.mostOutside(this.fStart!.t(), this.fEnd!.t(), startPt);
        if (iOutside < 0) return false;
        const oppSegment = rh.segment();
        const oppVerb = oppSegment.verb();
        const oppMid = new Intersections();
        curveIntersectRay(oppVerb, oppSegment.pts(), oppSegment.weight(), rayP0, rayP1, oppMid);
        const oppOutside = oppMid.mostOutside(rh.fStart!.t(), rh.fEnd!.t(), startPt);
        if (oppOutside < 0) return false;
        const iPt   = iMid.pt(iOutside);
        const oppPt = oppMid.pt(oppOutside);
        const iSide   = new Vector(iPt.fX - startPt.fX,   iPt.fY - startPt.fY);
        const oppSide = new Vector(oppPt.fX - startPt.fX, oppPt.fY - startPt.fY);
        const dir = iSide.crossCheck(oppSide);
        if (dir === 0) return false;
        insideOut.value = dir < 0;
        return true;
    }

    // SkOpAngle.cpp:350.
    public checkParallel(rh: OpAngle): boolean
    {
        const sweep = this.fOrdered ? this.fSweep[0] :
            new Vector(this.fPart.pts[1]!.fX - this.fPart.pts[0]!.fX,
                       this.fPart.pts[1]!.fY - this.fPart.pts[0]!.fY);
        const tweep = rh.fOrdered ? rh.fSweep[0] :
            new Vector(rh.fPart.pts[1]!.fX - rh.fPart.pts[0]!.fX,
                       rh.fPart.pts[1]!.fY - rh.fPart.pts[0]!.fY);
        const s0xt0 = sweep.crossCheck(tweep);
        if (this.tangentsDiverge(rh, s0xt0)) return s0xt0 < 0;
        const inside = { value: false };
        if (!this.fEnd!.containsSpan(rh.fEnd!))
        {
            if (this.endToSide(rh, inside)) return inside.value;
            if (rh.endToSide(this, inside)) return !inside.value;
        }
        if (this.midToSide(rh, inside)) return inside.value;
        if (rh.midToSide(this, inside)) return !inside.value;
        // Last-resort cross check via midpoint deviation.
        const segMid = this.segment().pts();
        const segWeight = this.segment().weight();
        const m0Pt = dPtAtT(this.segment().verb(), segMid, segWeight, this.midT());
        const rhMid = rh.segment().pts();
        const rhWeight = rh.segment().weight();
        const m1Pt = dPtAtT(rh.segment().verb(), rhMid, rhWeight, rh.midT());
        const m0 = new Vector(m0Pt.fX - this.fPart.pts[0]!.fX, m0Pt.fY - this.fPart.pts[0]!.fY);
        const m1 = new Vector(m1Pt.fX - rh.fPart.pts[0]!.fX, m1Pt.fY - rh.fPart.pts[0]!.fY);
        const m0xm1 = m0.crossCheck(m1);
        if (m0xm1 === 0)
        {
            this.fUnorderable = true;
            rh.fUnorderable = true;
            return true;
        }
        return m0xm1 < 0;
    }

    // SkOpAngle.cpp:451.
    public convexHullOverlaps(rh: OpAngle): number
    {
        const s = this.fSweep, t = rh.fSweep;
        const s0xs1 = s[0]!.crossCheck(s[1]!);
        const s0xt0 = s[0]!.crossCheck(t[0]!);
        const s1xt0 = s[1]!.crossCheck(t[0]!);
        let tBetweenS = s0xs1 > 0 ? s0xt0 > 0 && s1xt0 < 0 : s0xt0 < 0 && s1xt0 > 0;
        const s0xt1 = s[0]!.crossCheck(t[1]!);
        const s1xt1 = s[1]!.crossCheck(t[1]!);
        tBetweenS = tBetweenS || (s0xs1 > 0 ? s0xt1 > 0 && s1xt1 < 0 : s0xt1 < 0 && s1xt1 > 0);
        const t0xt1 = t[0]!.crossCheck(t[1]!);
        if (tBetweenS) return -1;
        if ((s0xt0 === 0 && s1xt1 === 0) || (s1xt0 === 0 && s0xt1 === 0)) return -1;
        let sBetweenT = t0xt1 > 0 ? s0xt0 < 0 && s0xt1 > 0 : s0xt0 > 0 && s0xt1 < 0;
        sBetweenT = sBetweenT || (t0xt1 > 0 ? s1xt0 < 0 && s1xt1 > 0 : s1xt0 > 0 && s1xt1 < 0);
        if (sBetweenT) return -1;
        // All sweeps in the same half plane — pair-order determines.
        if (s0xt0 >= 0 && s0xt1 >= 0 && s1xt0 >= 0 && s1xt1 >= 0) return 0;
        if (s0xt0 <= 0 && s0xt1 <= 0 && s1xt0 <= 0 && s1xt1 <= 0) return 1;
        // Outside-sweeps > 180° — use midpoint direction.
        const m0Pt = dPtAtT(this.segment().verb(), this.segment().pts(),
                            this.segment().weight(), this.midT());
        const m1Pt = dPtAtT(rh.segment().verb(), rh.segment().pts(),
                            rh.segment().weight(), rh.midT());
        const m0 = new Vector(m0Pt.fX - this.fPart.pts[0]!.fX, m0Pt.fY - this.fPart.pts[0]!.fY);
        const m1 = new Vector(m1Pt.fX - rh.fPart.pts[0]!.fX, m1Pt.fY - rh.fPart.pts[0]!.fY);
        const m0xm1 = m0.crossCheck(m1);
        if (s0xt0 > 0 && m0xm1 > 0) return 0;
        if (s0xt0 < 0 && m0xm1 < 0) return 1;
        if (this.tangentsDiverge(rh, s0xt0)) return s0xt0 < 0 ? 1 : 0;
        return m0xm1 < 0 ? 1 : 0;
    }

    // SkOpAngle.cpp:518.
    public endsIntersect(rh: OpAngle): boolean
    {
        const lVerb = this.segment().verb();
        const rVerb = rh.segment().verb();
        const lPts = verbToPoints(lVerb);
        const rPts = verbToPoints(rVerb);
        const rays: [[Point, Point], [Point, Point]] = [
            [this.fPart.pts[0]!, rh.fPart.pts[rPts]!],
            [this.fPart.pts[0]!, this.fPart.pts[lPts]!],
        ];
        if (this.fEnd!.containsSpan(rh.fEnd!)) return this.checkParallel(rh);
        const smallTs: [number, number] = [-1, -1];
        const limited: [boolean, boolean] = [false, false];
        for (let index = 0; index < 2; ++index)
        {
            const cVerb = index ? rVerb : lVerb;
            if (cVerb === OpVerb.kLine) continue;
            const segment = index ? rh.segment() : this.segment();
            const ix = new Intersections();
            curveIntersectRay(cVerb, segment.pts(), segment.weight(),
                              rays[index]![0], rays[index]![1], ix);
            const tStart = index ? rh.fStart!.t() : this.fStart!.t();
            const computedEnd = index ? rh.fComputedEnd!.t() : this.fComputedEnd!.t();
            const tEnd = computedEnd;
            const testAscends = tStart < computedEnd;
            let t = testAscends ? 0 : 1;
            for (let i = 0; i < ix.used(); ++i)
            {
                const testT = ix.fT[0]![i]!;
                if (!approximately_between_orderable(tStart, testT, tEnd)) continue;
                if (approximately_equal_orderable(tStart, testT)) continue;
                smallTs[index] = t = testAscends ? Math.max(t, testT) : Math.min(t, testT);
                limited[index] = approximately_equal_orderable(t, tEnd);
            }
        }
        let sRayLonger = false;
        let sCept: Vector = new Vector(0, 0);
        let sCeptT = -1;
        let sIndex = -1;
        let useIntersect = false;
        for (let index = 0; index < 2; ++index)
        {
            if (smallTs[index]! < 0) continue;
            const segment = index ? rh.segment() : this.segment();
            const dPt = dPtAtT(segment.verb(), segment.pts(), segment.weight(), smallTs[index]!);
            const cept = new Vector(dPt.fX - rays[index]![0].fX, dPt.fY - rays[index]![0].fY);
            if ((index ? lPts : rPts) === 1)
            {
                const total = new Vector(rays[index]![1].fX - rays[index]![0].fX,
                                          rays[index]![1].fY - rays[index]![0].fY);
                if (cept.lengthSquared() * 2 < total.lengthSquared()) continue;
            }
            const endVec = new Vector(rays[index]![1].fX - rays[index]![0].fX,
                                      rays[index]![1].fY - rays[index]![0].fY);
            if (cept.fX * endVec.fX < 0 || cept.fY * endVec.fY < 0) continue;
            const rayDist = cept.length();
            const endDist = endVec.length();
            const rayLonger = rayDist > endDist;
            if (limited[0] && limited[1] && rayLonger)
            {
                useIntersect = true;
                sRayLonger = rayLonger;
                sCept = cept;
                sCeptT = smallTs[index]!;
                sIndex = index;
                break;
            }
            let delta = Math.abs(rayDist - endDist);
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            const curve = index ? rh.fPart : this.fPart;
            const ptCount = index ? rPts : lPts;
            for (let i = 0; i <= ptCount; ++i)
            {
                if (curve.pts[i]!.fX < minX) minX = curve.pts[i]!.fX;
                if (curve.pts[i]!.fY < minY) minY = curve.pts[i]!.fY;
                if (curve.pts[i]!.fX > maxX) maxX = curve.pts[i]!.fX;
                if (curve.pts[i]!.fY > maxY) maxY = curve.pts[i]!.fY;
            }
            const maxWidth = Math.max(maxX - minX, maxY - minY);
            delta = delta / maxWidth;
            if (delta < 4e-3 && delta > 1e-3 && !useIntersect
                && this.fIsCurve && rh.fIsCurve
                && !this.fOriginalCurvePart.pts[0]!.equals(this.fPart.pts[0]!))
            {
                const origin = rh.fOriginalCurvePart.pts[0]!;
                const count = verbToPoints(rh.segment().verb());
                const line = new Vector(rh.fOriginalCurvePart.pts[count]!.fX - origin.fX,
                                         rh.fOriginalCurvePart.pts[count]!.fY - origin.fY);
                const originalSide  = rh.lineOnOneSideOrigin(origin, line, this, true);
                if (originalSide >= 0)
                {
                    const translatedSide = rh.lineOnOneSideOrigin(origin, line, this, false);
                    if (originalSide !== translatedSide) continue;
                }
            }
            if (delta > 1e-3)
            {
                useIntersect = !useIntersect;
                if (useIntersect)
                {
                    sRayLonger = rayLonger;
                    sCept = cept;
                    sCeptT = smallTs[index]!;
                    sIndex = index;
                }
            }
        }
        if (useIntersect)
        {
            const curve = sIndex ? rh.fPart : this.fPart;
            const segment = sIndex ? rh.segment() : this.segment();
            const tStart = sIndex ? rh.fStart!.t() : this.fStart!.t();
            const midPt = dPtAtT(segment.verb(), segment.pts(), segment.weight(),
                                  tStart + (sCeptT - tStart) / 2);
            const mid = new Vector(midPt.fX - curve.pts[0]!.fX, midPt.fY - curve.pts[0]!.fY);
            const septDir = mid.crossCheck(sCept);
            if (septDir === 0) return this.checkParallel(rh);
            // sRayLonger ^ (sIndex == 0) ^ (septDir < 0)
            return (sRayLonger ? 1 : 0) ^ (sIndex === 0 ? 1 : 0) ^ (septDir < 0 ? 1 : 0) ? true : false;
        }
        return this.checkParallel(rh);
    }

    // SkOpAngle.cpp:914.
    public orderable(rh: OpAngle): number
    {
        let result: number;
        if (!this.fIsCurve)
        {
            if (!rh.fIsCurve)
            {
                const leftX = this.fTangentHalf.dx();
                const leftY = this.fTangentHalf.dy();
                const rightX = rh.fTangentHalf.dx();
                const rightY = rh.fTangentHalf.dy();
                const x_ry = leftX * rightY;
                const rx_y = rightX * leftY;
                if (x_ry === rx_y)
                {
                    if (leftX * rightX < 0 || leftY * rightY < 0) return 1;
                    this.fUnorderable = true;
                    rh.fUnorderable = true;
                    return -1;
                }
                return x_ry < rx_y ? 1 : 0;
            }
            if ((result = this.lineOnOneSide(rh, false)) >= 0) return result;
            if (this.fUnorderable || approximately_zero(rh.fSide))
            {
                this.fUnorderable = true;
                rh.fUnorderable = true;
                return -1;
            }
        }
        else if (!rh.fIsCurve)
        {
            if ((result = rh.lineOnOneSide(this, false)) >= 0) return result ? 0 : 1;
            if (rh.fUnorderable || approximately_zero(this.fSide))
            {
                this.fUnorderable = true;
                rh.fUnorderable = true;
                return -1;
            }
        }
        else if ((result = this.convexHullOverlaps(rh)) >= 0)
        {
            return result;
        }
        return this.endsIntersect(rh) ? 1 : 0;
    }

    // SkOpAngle.cpp:74.
    public after(test: OpAngle): boolean
    {
        const lh = test;
        const rh = lh.fNext!;
        if (lh === rh) throw new Error('OpAngle.after: lh === rh');
        // Translate all three to share the start point.
        copyAngleCurve(this.fPart, this.fOriginalCurvePart);
        copyAngleCurve(lh.fPart, lh.fOriginalCurvePart);
        lh.fPart.pts[0] = new Point(this.fPart.pts[0]!.fX, this.fPart.pts[0]!.fY);
        copyAngleCurve(rh.fPart, rh.fOriginalCurvePart);
        rh.fPart.pts[0] = new Point(this.fPart.pts[0]!.fX, this.fPart.pts[0]!.fY);

        if (lh.fComputeSector && !lh.computeSector()) return true;
        if (this.fComputeSector && !this.computeSector()) return true;
        if (rh.fComputeSector && !rh.computeSector()) return true;

        const ltrOverlap = ((lh.fSectorMask | rh.fSectorMask) & this.fSectorMask) !== 0;
        const lrOverlap  = (lh.fSectorMask & rh.fSectorMask) !== 0;
        let lrOrder: number;
        if (!lrOverlap)
        {
            if (!ltrOverlap)
            {
                return ((lh.fSectorEnd > rh.fSectorStart) ? 1 : 0)
                     ^ ((this.fSectorStart > lh.fSectorEnd) ? 1 : 0)
                     ^ ((this.fSectorStart > rh.fSectorStart) ? 1 : 0) ? true : false;
            }
            const lrGap = (rh.fSectorStart - lh.fSectorStart + 32) & 0x1f;
            lrOrder = lrGap > 20 ? 0 : lrGap > 11 ? -1 : 1;
        }
        else
        {
            lrOrder = lh.orderable(rh);
            if (!ltrOverlap && lrOrder >= 0) return lrOrder ? false : true;
        }
        let ltOrder: number;
        if ((lh.fSectorMask & this.fSectorMask) !== 0)
        {
            ltOrder = lh.orderable(this);
        }
        else
        {
            const ltGap = (this.fSectorStart - lh.fSectorStart + 32) & 0x1f;
            ltOrder = ltGap > 20 ? 0 : ltGap > 11 ? -1 : 1;
        }
        let trOrder: number;
        if ((rh.fSectorMask & this.fSectorMask) !== 0)
        {
            trOrder = this.orderable(rh);
        }
        else
        {
            const trGap = (rh.fSectorStart - this.fSectorStart + 32) & 0x1f;
            trOrder = trGap > 20 ? 0 : trGap > 11 ? -1 : 1;
        }
        this.alignmentSameSide(lh, { value: ltOrder });
        this.alignmentSameSide(rh, { value: trOrder });
        if (lrOrder >= 0 && ltOrder >= 0 && trOrder >= 0)
        {
            return (lrOrder ? (ltOrder & trOrder) : (ltOrder | trOrder)) !== 0;
        }
        if (ltOrder === 0 && lrOrder === 0)
        {
            return lh.oppositePlanes(this);
        }
        else if (ltOrder === 1 && trOrder === 0)
        {
            return this.oppositePlanes(rh);
        }
        else if (lrOrder === 1 && trOrder === 1)
        {
            return lh.oppositePlanes(rh);
        }
        if (this.fUnorderable || lh.fUnorderable || rh.fUnorderable)
        {
            if (!this.fIsCurve && !lh.fIsCurve && !rh.fIsCurve)
            {
                const ltShare = lh.fOriginalCurvePart.pts[0]!.equals(this.fOriginalCurvePart.pts[0]!) ? 1 : 0;
                const lrShare = lh.fOriginalCurvePart.pts[0]!.equals(rh.fOriginalCurvePart.pts[0]!) ? 1 : 0;
                const trShare = this.fOriginalCurvePart.pts[0]!.equals(rh.fOriginalCurvePart.pts[0]!) ? 1 : 0;
                if (ltShare + lrShare + trShare === 1)
                {
                    if (lrShare)
                    {
                        const ltOO = lh.linesOnOriginalSide(this);
                        const rtOO = rh.linesOnOriginalSide(this);
                        if ((rtOO ^ ltOO) === 1) return ltOO !== 0;
                    }
                    else if (trShare)
                    {
                        const tlOO = this.linesOnOriginalSide(lh);
                        const rlOO = rh.linesOnOriginalSide(lh);
                        if ((tlOO ^ rlOO) === 1) return rlOO !== 0;
                    }
                    else
                    {
                        const trOO = rh.linesOnOriginalSide(this);
                        const lrOO = lh.linesOnOriginalSide(rh);
                        if ((lrOO ^ trOO) === 1) return trOO !== 0;
                    }
                }
            }
        }
        if (lrOrder < 0)
        {
            if (ltOrder < 0) return trOrder !== 0;
            return ltOrder !== 0;
        }
        return !lrOrder;
    }

    // SkOpAngle.cpp:749.
    public insert(angle: OpAngle): boolean
    {
        if (angle.fNext !== undefined)
        {
            if (this.loopCount() >= angle.loopCount())
            {
                if (!this.merge(angle)) return true;
            }
            else if (this.fNext !== undefined)
            {
                if (!angle.merge(this)) return true;
            }
            else
            {
                angle.insert(this);
            }
            return true;
        }
        const singleton = this.fNext === undefined;
        if (singleton) this.fNext = this;
        let next: OpAngle = this.fNext!;
        if (next.fNext === this)
        {
            if (singleton || angle.after(this))
            {
                this.fNext = angle;
                angle.fNext = next;
            }
            else
            {
                next.fNext = angle;
                angle.fNext = this;
            }
            return true;
        }
        let last: OpAngle = this;
        let flipAmbiguity = false;
        for (;;)
        {
            if (last.fNext !== next) throw new Error('OpAngle.insert: ring corruption');
            const afterFlag = angle.after(last);
            const flipBit = (angle.tangentsAmbiguous() && flipAmbiguity) ? 1 : 0;
            if (((afterFlag ? 1 : 0) ^ flipBit) === 1)
            {
                last.fNext = angle;
                angle.fNext = next;
                break;
            }
            last = next;
            if (last === this)
            {
                if (flipAmbiguity) return true;
                flipAmbiguity = true;
            }
            next = next.fNext!;
        }
        return true;
    }

    // SkOpAngle.cpp:848.
    public merge(angle: OpAngle): boolean
    {
        if (this.fNext === undefined || angle.fNext === undefined)
            throw new Error('OpAngle.merge: ring not initialised');
        let working: OpAngle = angle;
        do
        {
            if (this === working) return false;
            working = working.fNext!;
        } while (working !== angle);
        do
        {
            const next: OpAngle = working.fNext!;
            working.fNext = undefined;
            this.insert(working);
            working = next;
        } while (working !== angle);
        return true;
    }

    // Test-only utility kept for legacy tests written against the
    // skeleton port. Production code now uses insert().
    public _appendTestOnly(angle: OpAngle): void
    {
        if (this.fNext === undefined)
        {
            this.fNext = angle;
            angle.fNext = this;
            return;
        }
        let tail: OpAngle = this;
        while (tail.fNext !== this) tail = tail.fNext!;
        tail.fNext = angle;
        angle.fNext = this;
    }
}

// Local between helper — Skia's `between(min, x, max)` accepts
// unordered min/max. types.ts has a between(); use it.
function skiaBetween(a: number, b: number, c: number): boolean
{
    return (a - b) * (c - b) <= 0;
}
