// Copyright 2012 Google Inc.
//
// Use of this source code is governed by a BSD-style license that can
// be found in the LICENSE-skia file at the root of this repository.
//
// TypeScript port: 2026 Eugene Napryaglo.
// Source: third_party/skia/src/pathops/SkOpSegment.{h,cpp}
//         (Skia commit pinned in third_party/skia)
//
// Phase 6 chunk 2 — segment + structural surface.
//
// A segment is one curve (line / quad / cubic; conics not yet wired in
// this port) inside a contour. It owns a sentinel head span at t=0 and
// a sentinel tail span at t=1, plus zero-or-more interior spans
// allocated by addT(). Spans form a doubly-linked list:
//
//   head (OpSpan, t=0) ↔ s_1 ↔ s_2 ↔ … ↔ s_n ↔ tail (OpSpanBase, t=1)
//
// addT(t) is the central insertion: find the right slot in t-order
// (or return an existing pt-T that already matches), allocate a new
// interior OpSpan, and splice it into the list.
//
// What this file lands:
//   * init() + addLine / addQuad / addCubic — wire pts / weight /
//     verb / bounds / parent / sentinel spans.
//   * addT() with the match / ptsDisjoint helper chain.
//   * insert() — span allocator (new OpSpan via TS gc; sets the
//     globalState's "allocated" flag for the coincidence resolver).
//   * head / tail / pts / verb / weight / count / bounds / done /
//     bumpCount / setDoneCount — trivial structural getters.
//   * ptAtT / dPtAtT / dSlopeAtT — delegate to Line / Quad / Cubic.
//   * subDivide — fills an OpCurveCarrier with the [start,end] arc.
//   * markDone / markAllDone / release / clearOne / clearAll - the
//     span lifecycle helpers needed by the winding walker.
//   * calcAngles + addStartSpan + addEndSpan — angle allocation. The
//     angle's setSpans / setSector still throw; they wire up in chunk
//     3 alongside the SkDCurveSweep port.
//   * match / ptsDisjoint — pt-T deduplication predicates.
//   * SpanSign / OppSign / setUpWinding(s) / spanToAngle — winding
//     book-keeping helpers used by the walker (callers + tests can
//     observe them; the walker itself is stubbed).
//   * joinEnds + isXor + isHorizontal / Vertical + operand getter +
//     bounds aggregate.
//
// Stubbed pending later chunks (each throws a "Phase 6 follow-up"
// error so callers don't silently rely on them):
//   * activeOp / activeAngle / activeWinding — winding walker entry.
//   * computeSum / ComputeOneSum / ComputeOneSumReverse — walker tier.
//   * findNextOp / findNextWinding / findNextXor / nextChase —
//     forward walk over the angle ring (needs OpAngle.insert which
//     needs orderable which needs the sort kernel).
//   * sortAngles — calls OpAngle.insert on each span's angle ring.
//   * markAndChaseDone / markAndChaseWinding / markAngle — chase
//     across linked segments through the angle ring.
//   * missingCoincidence / moveMultiples / moveNearby — coincidence
//     resolver entry points; need OpCoincidence to land.
//   * addCurveTo — needs OpPathWriter.
//   * rayCheck — needs OpRayHit + ray-line intersection family.
//   * addExpanded / addMissing — coincidence-resolver helpers.
//   * isClose — needs the per-verb perpendicular ray-cast tables.
//   * undoneSpan / findSortableTop / windingSpanAtT / windSum -
//     winding walker dependents.

import { Cubic } from './cubic.js';
import { Intersections } from './intersections.js';
import { Line } from './line.js';
import { Point } from './point.js';
import { Quad } from './quad.js';
import { Rect } from './rect.js';
import {
    AlmostDequalUlps,
    SK_FLOAT_EPSILON,
    precisely_equal,
    roughly_equal,
    zero_or_one,
} from './types.js';
import { OpAngle, AngleIncludeType } from './op-angle.js';
import { OpGlobalState } from './op-global-state.js';
import {
    OpPtT,
    OpSpan,
    OpSpanBase,
    OpCollapsed,
    SK_MIN_S32,
} from './op-span.js';
import {
    OpVerb,
    verbToPoints,
    type OpCoincidenceLike,
    type OpCurveCarrier,
    type OpSegmentLike,
} from './op-fwd.js';
// Side effects — install ray-line intersection helpers.
import './quad-line-intersection.js';
import './cubic-line-intersection.js';

// Forward type alias — OpContour lands later in this file.
type OpContourFwd = import('./op-contour.js').OpContour;

// SkPathOps.h — the four path-op primitives. Indexes into gActiveEdge.
export enum SkPathOp
{
    kDifference        = 0,   // mi - su
    kIntersect         = 1,   // mi & su
    kUnion             = 2,   // mi | su
    kXOR_SkPathOp      = 3,   // mi ^ su
    kReverseDifference = 4,   // su - mi (caller swaps operand)
}

// Truth tables for unary / binary edge activity. Direct port from
// SkOpSegment.cpp:34-49.
//
//   gUnaryActiveEdge[from][to]
//
//   gActiveEdge[op][miFrom][miTo][suFrom][suTo]
//
// "from" is the maxWinding side; "to" is the sumWinding side. The
// tables answer: should the walker keep this edge in the output path?
const F = false, T = true;
const gUnaryActiveEdge: ReadonlyArray<ReadonlyArray<boolean>> = [
    [F, T],
    [T, F],
];
const gActiveEdge: ReadonlyArray<ReadonlyArray<ReadonlyArray<ReadonlyArray<ReadonlyArray<boolean>>>>> = [
    [[[[F, F], [F, F]], [[T, F], [T, F]]], [[[T, T], [F, F]], [[F, T], [T, F]]]],  // mi - su
    [[[[F, F], [F, F]], [[F, T], [F, T]]], [[[F, F], [T, T]], [[F, T], [T, F]]]],  // mi & su
    [[[[F, T], [T, F]], [[T, T], [F, F]]], [[[T, F], [T, F]], [[F, F], [F, F]]]],  // mi | su
    [[[[F, T], [T, F]], [[T, F], [F, T]]], [[[T, F], [F, T]], [[F, T], [T, F]]]],  // mi ^ su
];

// ── Per-verb dispatch tables ─────────────────────────────────────
//
// Skia uses `CurvePointAtT[verb]`, `CurveDSlopeAtT[verb]`, etc.
// indexed by SkPath::Verb. We mirror with discriminated dispatch
// on OpVerb, calling out to the existing Line / Quad / Cubic
// classes.

function pointAtT(verb: OpVerb, pts: readonly Point[], _weight: number, t: number): Point
{
    switch (verb)
    {
        case OpVerb.kLine:
        {
            const ln = new Line(pts[0]!, pts[1]!);
            return ln.ptAtT(t);
        }
        case OpVerb.kQuad:
        {
            const q = new Quad(); q.fPts = [pts[0]!, pts[1]!, pts[2]!];
            return q.ptAtT(t);
        }
        case OpVerb.kCubic:
        {
            const c = new Cubic(); c.fPts = [pts[0]!, pts[1]!, pts[2]!, pts[3]!];
            return c.ptAtT(t);
        }
        default:
            throw new Error(`pointAtT: unsupported verb ${verb}`);
    }
}

function slopeAtT(verb: OpVerb, pts: readonly Point[], _weight: number, t: number):
    { x: number; y: number }
{
    switch (verb)
    {
        case OpVerb.kLine:
        {
            // Slope of a line segment is the (constant) direction
            // vector. We construct so the slope flips sign at t≈0 vs
            // t≈1 if the line is degenerate; for normal lines we just
            // return p1-p0.
            const dx = pts[1]!.fX - pts[0]!.fX;
            const dy = pts[1]!.fY - pts[0]!.fY;
            return { x: dx, y: dy };
        }
        case OpVerb.kQuad:
        {
            const q = new Quad(); q.fPts = [pts[0]!, pts[1]!, pts[2]!];
            const v = q.dxdyAtT(t);
            return { x: v.fX, y: v.fY };
        }
        case OpVerb.kCubic:
        {
            const c = new Cubic(); c.fPts = [pts[0]!, pts[1]!, pts[2]!, pts[3]!];
            const v = c.dxdyAtT(t);
            return { x: v.fX, y: v.fY };
        }
        default:
            throw new Error(`slopeAtT: unsupported verb ${verb}`);
    }
}

function isVerticalForVerb(verb: OpVerb, pts: readonly Point[], _weight: number,
                            startT: number, endT: number): boolean
{
    // Same approach Skia takes: check whether x is monotonic and
    // exhibits zero net change between startT and endT. We use the
    // segment's endpoints directly since startT / endT bracket them.
    const a = pointAtT(verb, pts, 1, startT);
    const b = pointAtT(verb, pts, 1, endT);
    return AlmostDequalUlps(a.fX, b.fX);
}

// Apex-pruning bounds helper for line segments — just min/max the two
// endpoints. Quad / Cubic call into their existing setBounds method
// (which already searches for extrema in t).
function setLineBounds(pts: readonly Point[], rect: Rect): void
{
    rect.set(pts[0]!);
    rect.add(pts[1]!);
}

// ── OpSegment ─────────────────────────────────────────────────────

export class OpSegment implements OpSegmentLike
{
    // Sentinel spans always present.
    public fHead:  OpSpan;
    public fTail:  OpSpanBase;

    public fContour: OpContourFwd | undefined = undefined;
    public fNext:    OpSegment | undefined = undefined;
    public fPrev:    OpSegment | undefined = undefined;

    public fPts:    Point[]   = [];   // not copied — caller owns
    public fBounds: Rect      = new Rect();
    public fWeight: number    = 1;
    public fCount:  number    = 0;
    public fDoneCount: number = 0;
    public fVerb:   OpVerb    = OpVerb.kMove;
    public fVisited: boolean  = false;
    public fID:     number    = 0;

    constructor()
    {
        this.fHead = new OpSpan();
        this.fTail = new OpSpanBase();
    }

    // ── Trivial getters ───────────────────────────────────────────

    public contour():     OpContourFwd | undefined { return this.fContour; }
    public globalState(): OpGlobalState           { return this.contour()!.globalState(); }
    public head():        OpSpan                  { return this.fHead; }
    public tail():        OpSpanBase              { return this.fTail; }
    public verb():        OpVerb                  { return this.fVerb; }
    public weight():      number                  { return this.fWeight; }
    public pts():         readonly Point[]        { return this.fPts; }
    public count():       number                  { return this.fCount; }
    public bounds():      Rect                    { return this.fBounds; }
    public next():        OpSegment | undefined   { return this.fNext; }
    public prev():        OpSegment | undefined   { return this.fPrev; }

    public bumpCount(): void { ++this.fCount; }

    public done(): boolean
    {
        if (this.fDoneCount > this.fCount)
            throw new Error('OpSegment.done: doneCount > count');
        return this.fDoneCount === this.fCount;
    }

    public doneByAngle(angle: OpAngle): boolean
    {
        // Mirrors Skia's `done(angle)` overload: walk to the lower-t
        // endpoint of the angle's span pair, return that OpSpan's
        // done flag.
        const start = angle.start() as unknown as OpSpanBase;
        const end   = angle.end()   as unknown as OpSpanBase;
        return start.starter(end).done();
    }

    public isHorizontal(): boolean { return this.fBounds.fTop === this.fBounds.fBottom; }
    public isVertical():   boolean { return this.fBounds.fLeft === this.fBounds.fRight; }

    public isVerticalBetween(start: OpSpanBase, end: OpSpanBase): boolean
    {
        return isVerticalForVerb(this.fVerb, this.fPts, this.fWeight, start.t(), end.t());
    }

    public setContour(contour: OpContourFwd): void { this.fContour = contour; }
    public setNext(seg: OpSegment | undefined):    void { this.fNext = seg; }
    public setPrev(seg: OpSegment | undefined):    void { this.fPrev = seg; }

    public lastPt(): Point { return this.fPts[verbToPoints(this.fVerb)]!; }

    public isXor():  boolean
    {
        const c = this.contour();
        if (c === undefined) throw new Error('OpSegment.isXor: no contour');
        return c.isXor();
    }
    public operand(): boolean
    {
        const c = this.contour();
        if (c === undefined) throw new Error('OpSegment.operand: no contour');
        return c.operand();
    }
    public oppXor(): boolean
    {
        const c = this.contour();
        if (c === undefined) throw new Error('OpSegment.oppXor: no contour');
        return c.oppXor();
    }

    public resetVisited(): void { this.fVisited = false; }

    // Skia's `visited()` is consume-on-read: returns the prior value
    // and sets the flag. Used by the coincidence resolver to skip
    // double-touched segments.
    public visited(): boolean
    {
        if (!this.fVisited)
        {
            this.fVisited = true;
            return false;
        }
        return true;
    }

    // ── Geometry delegates ────────────────────────────────────────

    public ptAtT(t: number): Point
    {
        return pointAtT(this.fVerb, this.fPts, this.fWeight, t);
    }

    public dPtAtT(t: number): Point
    {
        return this.ptAtT(t);
    }

    public dSlopeAtT(t: number): { x: number; y: number }
    {
        return slopeAtT(this.fVerb, this.fPts, this.fWeight, t);
    }

    // SkOpSegment.cpp:1624 — write the sub-arc [start, end] into
    // `edge`. The edge is a tagged carrier so callers can dispatch on
    // verb. Returns true if the caller actually needs to look at the
    // interior control points (false for lines and the "endpoints
    // already at 0 / 1" early-out).
    public subDivide(start: OpSpanBase, end: OpSpanBase, edge: { value: OpCurveCarrier }): boolean
    {
        if (start === end) throw new Error('OpSegment.subDivide: start === end');
        const startPtT = start.ptT();
        const endPtT   = end.ptT();
        const startT = startPtT.fT;
        const endT   = endPtT.fT;

        switch (this.fVerb)
        {
            case OpVerb.kLine:
            {
                const ln = new Line();
                ln.fPts = [startPtT.fPt, endPtT.fPt];
                edge.value = { verb: OpVerb.kLine, fLine: ln };
                return false;
            }
            case OpVerb.kQuad:
            {
                const q = new Quad();
                // Endpoints already match — use them directly.
                if ((startT === 0 || endT === 0) && (startT === 1 || endT === 1))
                {
                    q.fPts = [startPtT.fPt, this.fPts[1]!, endPtT.fPt];
                    edge.value = { verb: OpVerb.kQuad, fQuad: q };
                    return false;
                }
                // Sub-divide via the existing Quad.subDivide.
                const full = new Quad();
                full.fPts = [this.fPts[0]!, this.fPts[1]!, this.fPts[2]!];
                const sub = full.subDivide(startT, endT);
                edge.value = { verb: OpVerb.kQuad, fQuad: sub };
                return true;
            }
            case OpVerb.kCubic:
            {
                const c = new Cubic();
                if ((startT === 0 || endT === 0) && (startT === 1 || endT === 1))
                {
                    if (startT === 0)
                    {
                        c.fPts = [startPtT.fPt, this.fPts[1]!, this.fPts[2]!, endPtT.fPt];
                    }
                    else
                    {
                        c.fPts = [startPtT.fPt, this.fPts[2]!, this.fPts[1]!, endPtT.fPt];
                    }
                    edge.value = { verb: OpVerb.kCubic, fCubic: c };
                    return false;
                }
                const full = new Cubic();
                full.fPts = [this.fPts[0]!, this.fPts[1]!, this.fPts[2]!, this.fPts[3]!];
                const sub = full.subDivide(startT, endT);
                edge.value = { verb: OpVerb.kCubic, fCubic: sub };
                return true;
            }
            default:
                throw new Error(`OpSegment.subDivide: unsupported verb ${this.fVerb}`);
        }
    }

    // ── Construction ──────────────────────────────────────────────

    // SkOpSegment.cpp:822 — common init path. Caller is one of the
    // addLine / addQuad / addCubic helpers below. fPts is borrowed,
    // not copied — Skia owns pts via SkOpEdgeBuilder; mural callers
    // own them too.
    public init(pts: Point[], weight: number, contour: OpContourFwd, verb: OpVerb): void
    {
        this.fContour = contour;
        this.fNext = undefined;
        this.fPts  = pts;
        this.fWeight = weight;
        this.fVerb = verb;
        this.fCount = 0;
        this.fDoneCount = 0;
        this.fVisited = false;
        // Sentinel spans. Head is an OpSpan (interior); tail is bare
        // OpSpanBase (final, t === 1).
        this.fHead.init(this, undefined, 0, this.fPts[0]!);
        this.fHead.setNext(this.fTail);
        this.fTail.initBase(this, this.fHead, 1, this.fPts[verbToPoints(verb)]!);
        this.fID = this.globalState().nextSegmentID();
    }

    public addLine(pts: Point[], parent: OpContourFwd): OpSegment
    {
        if (pts[0]!.equals(pts[1]!))
            throw new Error('OpSegment.addLine: degenerate (p0 === p1)');
        this.init(pts, 1, parent, OpVerb.kLine);
        setLineBounds(pts, this.fBounds);
        return this;
    }

    public addQuad(pts: Point[], parent: OpContourFwd): OpSegment
    {
        this.init(pts, 1, parent, OpVerb.kQuad);
        const q = new Quad();
        q.fPts = [pts[0]!, pts[1]!, pts[2]!];
        // Quad.setBounds exists from Phase 1 — accumulate into
        // fBounds. The class's bounds-walk includes the t-extrema in
        // x and y, so the rect is tight.
        const r = new Rect();
        r.set(pts[0]!);
        r.add(pts[1]!);
        r.add(pts[2]!);
        // For tight bounds incorporating extrema, call into the
        // existing setBounds method on Quad's prototype if available.
        // We just AABB the control polygon here; tight-bounds wires
        // in when Quad.setBounds(Rect) is exposed.
        this.fBounds.fLeft   = r.fLeft;
        this.fBounds.fTop    = r.fTop;
        this.fBounds.fRight  = r.fRight;
        this.fBounds.fBottom = r.fBottom;
        return this;
    }

    public addCubic(pts: Point[], parent: OpContourFwd): OpSegment
    {
        this.init(pts, 1, parent, OpVerb.kCubic);
        // Control-polygon AABB; tight bounds when Cubic.setBounds is
        // exposed in a follow-up.
        const r = new Rect();
        r.set(pts[0]!);
        r.add(pts[1]!);
        r.add(pts[2]!);
        r.add(pts[3]!);
        this.fBounds.fLeft   = r.fLeft;
        this.fBounds.fTop    = r.fTop;
        this.fBounds.fRight  = r.fRight;
        this.fBounds.fBottom = r.fBottom;
        return this;
    }

    // SkOpSegment.h:244 — allocate a new interior span and splice it
    // between `prev` and prev.next(). Skia uses an arena allocator;
    // we use `new` and let GC manage the storage. Sets the global
    // "allocated-op-span" flag so the coincidence resolver knows new
    // spans landed during this phase.
    public insert(prev: OpSpan): OpSpan
    {
        const state = this.globalState();
        state.setAllocatedOpSpan();
        const result = new OpSpan();
        const next = prev.next();
        result.setPrev(prev);
        prev.setNext(result);
        result.fPtT.fT = 0;
        result.setNext(next);
        next.setPrev(result);
        return result;
    }

    // ── addT — pt-T allocator ─────────────────────────────────────

    // SkOpSegment.cpp:259 — find or insert a pt-T at parameter t. Two
    // outcomes:
    //   * if an existing span already has fT === t, OR the
    //     candidate (t, pt) matches an existing pt-T per match(),
    //     return that existing pt-T (and bump its span-add count).
    //   * else allocate a fresh interior OpSpan via insert() at the
    //     correct sorted position, init it with (t, pt), return its
    //     pt-T.
    //
    // Returns undefined when t lands before the head (corrupt input).
    public addT(t: number, pt?: Point): OpPtT | undefined
    {
        const point = pt !== undefined ? pt : this.ptAtT(t);
        let spanBase: OpSpanBase | undefined = this.fHead;
        while (spanBase !== undefined)
        {
            const result = spanBase.ptT();
            if (t === result.fT
                || (!zero_or_one(t) && this.matchPtT(result, this, t, point)))
                {
                spanBase.bumpSpanAdds();
                return result;
            }
            if (t < result.fT)
            {
                const prev = result.span().prev();
                if (prev === undefined) return undefined;
                const span = this.insert(prev);
                span.init(this, prev, t, point);
                span.bumpSpanAdds();
                return span.ptT();
            }
            if (spanBase === this.fTail) return undefined;
            const up = spanBase.upCastable();
            if (up === undefined) return undefined;
            spanBase = up.next();
        }
        return undefined;
    }

    // SkOpSegment.cpp:1056 — pt-T equivalence predicate. True iff
    // `(testT, testPt)` is "the same" pt-T as `base` on this segment.
    // For a same-segment match: exact t equality OR approximately
    // equal points + not-disjoint via ptsDisjoint.
    public matchPtT(base: OpPtT, testParent: OpSegment, testT: number, testPt: Point): boolean
    {
        if (this !== base.segment())
            throw new Error('OpSegment.matchPtT: base is not on this segment');
        if (this === testParent)
        {
            if (precisely_equal(base.fT, testT)) return true;
        }
        // Skia's SkDPoint::ApproximatelyEqual is per-axis ULP-equal
        // with NoNormalCheck. Mural's Point.equals is exact; we
        // approximate with a tight FLT_EPSILON window matching Skia.
        if (!approximatelyEqualPt(testPt, base.fPt)) return false;
        return this !== testParent
            || !this.ptsDisjointTPP(base.fT, base.fPt, testT, testPt);
    }

    // SkOpSegment.cpp:1504 — geometry-based disjointness for two
    // proposed pt-Ts on the same curve. Lines are never disjoint
    // (any two points on a line are co-linear, so they're equal-or-
    // adjacent). Quad / cubic: probe the midpoint and check it stays
    // within twice the inter-endpoint distance.
    public ptsDisjointTPP(t1: number, pt1: Point, t2: number, pt2: Point): boolean
    {
        if (this.fVerb === OpVerb.kLine) return false;
        const midT = (t1 + t2) / 2;
        const midPt = this.ptAtT(midT);
        const dx = pt1.fX - pt2.fX;
        const dy = pt1.fY - pt2.fY;
        const baseDistSq = dx * dx + dy * dy;
        const seDistSq = Math.max(baseDistSq * 2, SK_FLOAT_EPSILON * 2);
        const dmx1 = midPt.fX - pt1.fX, dmy1 = midPt.fY - pt1.fY;
        const dmx2 = midPt.fX - pt2.fX, dmy2 = midPt.fY - pt2.fY;
        const d1Sq = dmx1 * dmx1 + dmy1 * dmy1;
        const d2Sq = dmx2 * dmx2 + dmy2 * dmy2;
        return d1Sq > seDistSq || d2Sq > seDistSq;
    }

    // SkOpSegment.cpp:1504 wrappers — convenience for callers that
    // hold pt-T objects directly.
    public ptsDisjointBP(base: OpPtT, t: number, pt: Point): boolean
    {
        if (this !== base.segment()) throw new Error('ptsDisjointBP: cross-segment');
        return this.ptsDisjointTPP(base.fT, base.fPt, t, pt);
    }

    public ptsDisjointPP(base: OpPtT, test: OpPtT): boolean
    {
        if (this !== base.segment()) throw new Error('ptsDisjointPP: cross-segment (base)');
        if (this !== test.segment()) throw new Error('ptsDisjointPP: cross-segment (test)');
        return this.ptsDisjointTPP(base.fT, base.fPt, test.fT, test.fPt);
    }

    // SkOpSegment.cpp:338 — fan out collapsed(s, e) over every span.
    public collapsed(s: number, e: number): OpCollapsed
    {
        let span: OpSpanBase | undefined = this.fHead;
        while (span !== undefined)
        {
            const r = span.collapsed(s, e);
            if (r !== OpCollapsed.kNo) return r;
            const up = span.upCastable();
            if (up === undefined) break;
            span = up.next();
        }
        return OpCollapsed.kNo;
    }

    public contains(t: number): boolean
    {
        let span: OpSpanBase | undefined = this.fHead;
        while (span !== undefined)
        {
            if (span.t() === t) return true;
            const up = span.upCastable();
            if (up === undefined) break;
            span = up.next();
        }
        return false;
    }

    // ── Span lifecycle ───────────────────────────────────────────

    // SkOpSegment.cpp:1014.
    public markDone(span: OpSpan): void
    {
        if (this !== span.segment())
            throw new Error('OpSegment.markDone: span is not on this segment');
        if (span.done()) return;
        span.setDone(true);
        ++this.fDoneCount;
    }

    // SkOpSegment.cpp:858.
    public markAllDone(): void
    {
        let span: OpSpan = this.head();
        for (;;)
        {
            this.markDone(span);
            const next = span.next();
            const up = next.upCastable();
            if (up === undefined) break;
            span = up;
        }
    }

    // SkOpSegment.cpp:1027 / 1041 — soft-fail on done spans.
    public markWinding(span: OpSpan, winding: number, oppWinding?: number): boolean
    {
        if (this !== span.segment())
            throw new Error('OpSegment.markWinding: cross-segment');
        if (winding === 0 && (oppWinding === undefined || oppWinding === 0))
            throw new Error('OpSegment.markWinding: winding must be nonzero');
        if (span.done()) return false;
        span.setWindSum(winding);
        if (oppWinding !== undefined) span.setOppSum(oppWinding);
        return true;
    }

    // SkOpSegment.cpp:504.
    public release(span: OpSpan): void
    {
        if (span.done()) --this.fDoneCount;
        --this.fCount;
        if (this.fCount < this.fDoneCount)
            throw new Error('OpSegment.release: count < doneCount');
    }

    // SkOpSegment.cpp:322 — clear winding state on every span, then
    // notify the global coincidence object. The OpCoincidence.release
    // call is stubbed until that class lands.
    public clearAll(): void
    {
        let span: OpSpan = this.head();
        for (;;)
        {
            this.clearOne(span);
            const next = span.next();
            const up = next.upCastable();
            if (up === undefined) break;
            span = up;
        }
        // OpCoincidence.release(this) wires up later.
    }

    public clearOne(span: OpSpan): void
    {
        span.fWindValue = 0;
        span.fOppValue  = 0;
        this.markDone(span);
    }

    // SkOpSegment.h:281.
    public joinEnds(start: OpSegment): void
    {
        const tailPtT = this.fTail.ptT();
        const headPtT = start.fHead.ptT();
        // Skia: tail.ptT().addOpp(start.head.ptT(), start.head.ptT()).
        // The third arg is `oppPrev` in our port; with a fresh self-
        // looped pt-T it's the pt-T itself, matching Skia.
        tailPtT.addOpp(headPtT, headPtT);
    }

    // SkOpSegment.h:391 — pick which angle stores the local geometry
    // for the (start, end) span pair.
    public spanToAngle(start: OpSpanBase, end: OpSpanBase): OpAngle | undefined
    {
        if (start === end) throw new Error('OpSegment.spanToAngle: start === end');
        if (start.t() < end.t())
        {
            return start.upCast().toAngle() as OpAngle | undefined;
        }
        return start.fromAngle() as OpAngle | undefined;
    }

    // SkOpSegment.cpp:292 — populate fFromAngle / fToAngle on every
    // span. Skia uses an arena allocator for OpAngle; we just `new`
    // them. setSpans / setSector inside the angle still throw, so
    // calcAngles is callable only when callers don't need angles to
    // be fully wired — e.g. tests that probe storage but not sort.
    public calcAngles(): void
    {
        let activePrior = !this.fHead.isCanceled();
        if (activePrior && !this.fHead.simple())
        {
            this.addStartSpan();
        }
        let prior: OpSpan = this.fHead;
        let spanBase: OpSpanBase = this.fHead.next();
        while (spanBase !== this.fTail)
        {
            if (activePrior)
            {
                const priorAngle = new OpAngle();
                priorAngle.set(spanBase, prior);
                spanBase.setFromAngle(priorAngle);
            }
            const span = spanBase.upCast();
            const active = !span.isCanceled();
            const next = span.next();
            if (active)
            {
                const angle = new OpAngle();
                angle.set(span, next);
                span.setToAngle(angle);
            }
            activePrior = active;
            prior = span;
            spanBase = next;
        }
        if (activePrior && !this.fTail.simple())
        {
            this.addEndSpan();
        }
    }

    // SkOpSegment.h:73.
    public addEndSpan(): OpAngle
    {
        const angle = new OpAngle();
        // tail.prev() returns the OpSpan; angle.set wants OpSpanBase.
        // OpSpan extends OpSpanBase, so the cast is structural.
        angle.set(this.fTail, this.fTail.prev()!);
        this.fTail.setFromAngle(angle);
        return angle;
    }

    // SkOpSegment.h:91.
    public addStartSpan(): OpAngle
    {
        const angle = new OpAngle();
        angle.set(this.fHead, this.fHead.next());
        this.fHead.setToAngle(angle);
        return angle;
    }

    // ── Winding bookkeeping helpers ──────────────────────────────

    public static SpanSign(start: OpSpanBase, end: OpSpanBase): number
    {
        return start.t() < end.t() ? -start.upCast().windValue()
                                   :  end.upCast().windValue();
    }

    public static OppSign(start: OpSpanBase, end: OpSpanBase): number
    {
        return start.t() < end.t() ? -start.upCast().oppValue()
                                   :  end.upCast().oppValue();
    }

    // SkOpSegment.h:369.
    public setUpWinding(start: OpSpanBase, end: OpSpanBase,
                        out: { maxWinding: number; sumWinding: number }): void
    {
        const deltaSum = OpSegment.SpanSign(start, end);
        out.maxWinding = out.sumWinding;
        if (out.sumWinding !== (-0x80000000 | 0))
        {
            out.sumWinding -= deltaSum;
        }
    }

    public static UseInnerWinding(outerWinding: number, innerWinding: number): boolean
    {
        // SkOpSegment.cpp:1775 — winding-sign comparison helper.
        //   bool result = absOut == absIn ? outerWinding < 0 : absOut < absIn;
        // The "ladder of if-returns" port had the absOut/absIn inequality
        // flipped — it returned `true` for absIn < absOut (use OUTER)
        // when Skia returns `false`, and vice-versa. The flipped predicate
        // made ComputeOneSum write the "outer" running winding to a span
        // when it should have written the "inner" one, so any boundary
        // where two ops disagree along the same edge (binary Intersect
        // on overlapping operands, where the seed sumMiWinding has to
        // pick up the "inside A" side) propagated the wrong seed
        // through findNextOp's angle-ring walker.
        const absOut = Math.abs(outerWinding);
        const absIn  = Math.abs(innerWinding);
        return absOut === absIn ? outerWinding < 0 : absOut < absIn;
    }

    // ── Phase 6 follow-up stubs ──────────────────────────────────

    // ── Activity predicates ───────────────────────────────────────
    //
    // activeOp / activeWinding decide whether a span belongs in the
    // output path of a binary op / simplify. The decision drives the
    // walker's `markAndChaseDone` calls — inactive spans get marked
    // done so the walker doesn't revisit them.

    public activeOp(start: OpSpanBase, end: OpSpanBase,
                    xorMiMask: number, xorSuMask: number, op: SkPathOp): boolean
    {
        let sumMiWinding = this.updateWinding(end, start);
        let sumSuWinding = this.updateOppWinding(end, start);
        if (this.operand())
        {
            const t = sumMiWinding; sumMiWinding = sumSuWinding; sumSuWinding = t;
        }
        return this.activeOpFull(xorMiMask, xorSuMask, start, end, op, sumMiWinding, sumSuWinding);
    }

    public activeOpFull(xorMiMask: number, xorSuMask: number,
                        start: OpSpanBase, end: OpSpanBase, op: SkPathOp,
                        sumMiWinding: number, sumSuWinding: number): boolean
    {
        // Single-shot form used by bridgeOp's outer activeOp() call —
        // doesn't propagate running sums back to the caller. The
        // findNextOp loop uses activeOpFullRef below.
        const refBox = { sumMiWinding, sumSuWinding };
        return this.activeOpFullRef(xorMiMask, xorSuMask, start, end, op, refBox);
    }

    // §19.7 engine fix — activeOpFull variant that propagates the
    // running sumMiWinding / sumSuWinding totals back to the caller via
    // the `ref` object. Mirrors Skia's `int* sumMiWinding, int* sumSuWinding`
    // pointer semantics so findNextOp's angle-ring walk sees each
    // angle's contribution adjusting the running totals. Without this
    // propagation, every angle in the ring saw the same sums and the
    // truth-table lookup produced the same activeOp result for spans
    // that should have differed by their B-contour topology — making
    // Intersect / Difference walks treat all of A's edges identically.
    public activeOpFullRef(xorMiMask: number, xorSuMask: number,
                           start: OpSpanBase, end: OpSpanBase, op: SkPathOp,
                           ref: { sumMiWinding: number; sumSuWinding: number }): boolean
    {
        const w = { maxWinding: 0, sumWinding: 0,
                    oppMaxWinding: 0, oppSumWinding: 0,
                    sumMiWinding: ref.sumMiWinding, sumSuWinding: ref.sumSuWinding };
        this.setUpWindingsBinary(start, end, w);
        ref.sumMiWinding = w.sumMiWinding;
        ref.sumSuWinding = w.sumSuWinding;
        let miFrom: boolean, miTo: boolean, suFrom: boolean, suTo: boolean;
        if (this.operand())
        {
            miFrom = (w.oppMaxWinding & xorMiMask) !== 0;
            miTo   = (w.oppSumWinding & xorMiMask) !== 0;
            suFrom = (w.maxWinding    & xorSuMask) !== 0;
            suTo   = (w.sumWinding    & xorSuMask) !== 0;
        }
        else
        {
            miFrom = (w.maxWinding    & xorMiMask) !== 0;
            miTo   = (w.sumWinding    & xorMiMask) !== 0;
            suFrom = (w.oppMaxWinding & xorSuMask) !== 0;
            suTo   = (w.oppSumWinding & xorSuMask) !== 0;
        }
        const tbl = gActiveEdge[op]![miFrom ? 1 : 0]![miTo ? 1 : 0]!
                       [suFrom ? 1 : 0]![suTo ? 1 : 0]!;
        return tbl;
    }

    public activeWinding(start: OpSpanBase, end: OpSpanBase): boolean
    {
        let sumWinding = this.updateWinding(end, start);
        const out = { sum: sumWinding };
        return this.activeWindingFull(start, end, out);
    }

    public activeWindingFull(start: OpSpanBase, end: OpSpanBase,
                              sumOut: { sum: number }): boolean
    {
        const w = { maxWinding: 0, sumWinding: sumOut.sum };
        this.setUpWinding(start, end, w);
        sumOut.sum = w.sumWinding;
        const from = w.maxWinding !== 0;
        const to   = w.sumWinding !== 0;
        return gUnaryActiveEdge[from ? 1 : 0]![to ? 1 : 0]!;
    }

    // ── activeAngle family ────────────────────────────────────────

    public activeAngle(start: OpSpanBase,
                       startPtrOut: { value: OpSpanBase | undefined },
                       endPtrOut:   { value: OpSpanBase | undefined },
                       doneOut:     { value: boolean }): OpAngle | undefined
    {
        const r1 = this.activeAngleInner(start, startPtrOut, endPtrOut, doneOut);
        if (r1 !== undefined) return r1;
        const r2 = this.activeAngleOther(start, startPtrOut, endPtrOut, doneOut);
        if (r2 !== undefined) return r2;
        return undefined;
    }

    public activeAngleInner(start: OpSpanBase,
                            startPtrOut: { value: OpSpanBase | undefined },
                            endPtrOut:   { value: OpSpanBase | undefined },
                            doneOut:     { value: boolean }): OpAngle | undefined
    {
        const upSpan = start.upCastable();
        if (upSpan !== undefined)
        {
            if (upSpan.windValue() !== 0 || upSpan.oppValue() !== 0)
            {
                const next = upSpan.next();
                if (endPtrOut.value === undefined)
                {
                    startPtrOut.value = start;
                    endPtrOut.value   = next;
                }
                if (!upSpan.done())
                {
                    if (upSpan.windSum() !== SK_MIN_S32)
                    {
                        return this.spanToAngle(start, next);
                    }
                    doneOut.value = false;
                }
            }
        }
        const downSpan = start.prev();
        if (downSpan !== undefined)
        {
            if (downSpan.windValue() !== 0 || downSpan.oppValue() !== 0)
            {
                if (endPtrOut.value === undefined)
                {
                    startPtrOut.value = start;
                    endPtrOut.value   = downSpan;
                }
                if (!downSpan.done())
                {
                    if (downSpan.windSum() !== SK_MIN_S32)
                    {
                        return this.spanToAngle(start, downSpan);
                    }
                    doneOut.value = false;
                }
            }
        }
        return undefined;
    }

    public activeAngleOther(start: OpSpanBase,
                            startPtrOut: { value: OpSpanBase | undefined },
                            endPtrOut:   { value: OpSpanBase | undefined },
                            doneOut:     { value: boolean }): OpAngle | undefined
    {
        const oPtT = start.ptT().next();
        const other = oPtT.segment() as OpSegment;
        const oSpan = oPtT.span();
        return other.activeAngleInner(oSpan, startPtrOut, endPtrOut, doneOut);
    }

    // ── Winding updates ──────────────────────────────────────────

    public static SK_MAX_S32 = 0x7FFFFFFF;

    public updateOppWinding(start: OpSpanBase, end: OpSpanBase): number
    {
        const lesser = start.starter(end);
        let oppWinding = lesser.oppSum();
        const oppSpanWinding = OpSegment.OppSign(start, end);
        if (oppSpanWinding !== 0
            && OpSegment.UseInnerWinding(oppWinding - oppSpanWinding, oppWinding)
            && oppWinding !== OpSegment.SK_MAX_S32)
        {
            oppWinding -= oppSpanWinding;
        }
        return oppWinding;
    }

    public updateOppWindingByAngle(angle: OpAngle): number
    {
        return this.updateOppWinding(angle.end() as OpSpanBase, angle.start() as OpSpanBase);
    }

    public updateOppWindingReverseByAngle(angle: OpAngle): number
    {
        return this.updateOppWinding(angle.start() as OpSpanBase, angle.end() as OpSpanBase);
    }

    public updateWinding(start: OpSpanBase, end: OpSpanBase): number
    {
        const lesser = start.starter(end);
        let winding = lesser.windSum();
        if (winding === SK_MIN_S32)
        {
            winding = lesser.computeWindSum();
        }
        if (winding === SK_MIN_S32) return winding;
        const spanWinding = OpSegment.SpanSign(start, end);
        if (winding !== 0
            && OpSegment.UseInnerWinding(winding - spanWinding, winding)
            && winding !== OpSegment.SK_MAX_S32)
        {
            winding -= spanWinding;
        }
        return winding;
    }

    public updateWindingByAngle(angle: OpAngle): number
    {
        return this.updateWinding(angle.end() as OpSpanBase, angle.start() as OpSpanBase);
    }

    public updateWindingReverseByAngle(angle: OpAngle): number
    {
        return this.updateWinding(angle.start() as OpSpanBase, angle.end() as OpSpanBase);
    }

    public windSum(angle: OpAngle): number
    {
        const minSpan = (angle.start() as OpSpanBase).starter(angle.end() as OpSpanBase);
        return minSpan.windSum();
    }

    // ── setUpWindings ────────────────────────────────────────────

    // Two-operand setUpWindings (binary op).
    public setUpWindingsBinary(start: OpSpanBase, end: OpSpanBase,
                               w: { maxWinding: number; sumWinding: number;
                                    oppMaxWinding: number; oppSumWinding: number;
                                    sumMiWinding: number; sumSuWinding: number }): void
    {
        const deltaSum     = OpSegment.SpanSign(start, end);
        const oppDeltaSum  = OpSegment.OppSign(start, end);
        if (this.operand())
        {
            w.maxWinding    = w.sumSuWinding;
            w.sumSuWinding -= deltaSum;
            w.sumWinding    = w.sumSuWinding;
            w.oppMaxWinding = w.sumMiWinding;
            w.sumMiWinding -= oppDeltaSum;
            w.oppSumWinding = w.sumMiWinding;
        }
        else
        {
            w.maxWinding    = w.sumMiWinding;
            w.sumMiWinding -= deltaSum;
            w.sumWinding    = w.sumMiWinding;
            w.oppMaxWinding = w.sumSuWinding;
            w.sumSuWinding -= oppDeltaSum;
            w.oppSumWinding = w.sumSuWinding;
        }
    }

    // ── markAngle / markWinding overloads ────────────────────────

    public markAngle(maxWinding: number, sumWinding: number,
                     angle: OpAngle, resultPtr: { value: OpSpanBase | undefined }): boolean
    {
        if ((angle.segment() as OpSegment) !== this)
            throw new Error('OpSegment.markAngle: angle is not on this segment');
        if (OpSegment.UseInnerWinding(maxWinding, sumWinding)) maxWinding = sumWinding;
        return this.markAndChaseWinding(angle.start() as OpSpanBase, angle.end() as OpSpanBase,
                                         maxWinding, resultPtr);
    }

    public markAngleBinary(maxWinding: number, sumWinding: number,
                           oppMaxWinding: number, oppSumWinding: number,
                           angle: OpAngle,
                           resultPtr: { value: OpSpanBase | undefined }): boolean
    {
        if ((angle.segment() as OpSegment) !== this)
            throw new Error('OpSegment.markAngleBinary: angle is not on this segment');
        if (OpSegment.UseInnerWinding(maxWinding, sumWinding)) maxWinding = sumWinding;
        if (oppMaxWinding !== oppSumWinding
            && OpSegment.UseInnerWinding(oppMaxWinding, oppSumWinding))
        {
            oppMaxWinding = oppSumWinding;
        }
        return this.markAndChaseWindingBinary(angle.start() as OpSpanBase,
                                                angle.end() as OpSpanBase,
                                                maxWinding, oppMaxWinding, resultPtr);
    }

    // ── markAndChase: walk segments via angle ring, marking each ──

    public markAndChaseDone(start: OpSpanBase, end: OpSpanBase,
                            foundPtr: { value: OpSpanBase | undefined } | undefined): boolean
    {
        const stepBox  = { value: start.step(end) };
        const startBox = { value: start as OpSpanBase | undefined };
        const minBox: { value: OpSpan | undefined } = { value: start.starter(end) };
        this.markDone(minBox.value!);
        const lastBox: { value: OpSpanBase | undefined } = { value: undefined };
        let other: OpSegment | undefined = this;
        let priorDone: OpSpan | undefined = undefined;
        let lastDone:  OpSpan | undefined = undefined;
        let safetyNet = 100_000;
        while ((other = other.nextChase(startBox, stepBox, minBox, lastBox)) !== undefined)
        {
            if (!--safetyNet) return false;
            if (other.done()) break;
            const cur = minBox.value!;
            if (lastDone === cur || priorDone === cur)
            {
                if (foundPtr) foundPtr.value = undefined;
                return true;
            }
            other.markDone(cur);
            priorDone = lastDone;
            lastDone  = cur;
        }
        if (foundPtr) foundPtr.value = lastBox.value;
        return true;
    }

    public markAndChaseWinding(start: OpSpanBase, end: OpSpanBase, winding: number,
                                lastPtr: { value: OpSpanBase | undefined } | undefined): boolean
    {
        const spanStart = start.starter(end);
        const stepBox  = { value: start.step(end) };
        const startBox = { value: start as OpSpanBase | undefined };
        const minBox: { value: OpSpan | undefined } = { value: spanStart };
        const success = this.markWindingValue(spanStart, winding);
        const lastBox: { value: OpSpanBase | undefined } = { value: undefined };
        let other: OpSegment | undefined = this;
        let safetyNet = 100_000;
        while ((other = other.nextChase(startBox, stepBox, minBox, lastBox)) !== undefined)
        {
            if (!--safetyNet) return false;
            const cur = minBox.value!;
            if (cur.windSum() !== SK_MIN_S32) break;
            void other.markWindingValue(cur, winding);
        }
        if (lastPtr) lastPtr.value = lastBox.value;
        return success;
    }

    public markAndChaseWindingBinary(start: OpSpanBase, end: OpSpanBase,
                                      winding: number, oppWinding: number,
                                      lastPtr: { value: OpSpanBase | undefined } | undefined): boolean
    {
        const spanStart = start.starter(end);
        const stepBox  = { value: start.step(end) };
        const startBox = { value: start as OpSpanBase | undefined };
        const minBox: { value: OpSpan | undefined } = { value: spanStart };
        const success = this.markWindingValueBinary(spanStart, winding, oppWinding);
        const lastBox: { value: OpSpanBase | undefined } = { value: undefined };
        let other: OpSegment | undefined = this;
        let safetyNet = 100_000;
        while ((other = other.nextChase(startBox, stepBox, minBox, lastBox)) !== undefined)
        {
            if (!--safetyNet) return false;
            const cur = minBox.value!;
            if (cur.windSum() !== SK_MIN_S32)
            {
                if (this.operand() === other.operand())
                {
                    if (cur.windSum() !== winding || cur.oppSum() !== oppWinding)
                    {
                        this.globalState().setWindingFailed();
                        return true;
                    }
                }
                else
                {
                    if (cur.windSum() !== oppWinding) return false;
                    if (cur.oppSum() !== winding)    return false;
                }
                break;
            }
            if (this.operand() === other.operand())
            {
                void other.markWindingValueBinary(cur, winding, oppWinding);
            }
            else
            {
                void other.markWindingValueBinary(cur, oppWinding, winding);
            }
        }
        if (lastPtr) lastPtr.value = lastBox.value;
        return success;
    }

    // Renamed-then-aliased version of markWinding so the two-arg
    // public surface still works. Skia's overloads share a name; we
    // pick concrete names to keep the dispatch transparent.
    //
    // The `winding === 0` and `winding == 0 && oppWinding == 0` checks
    // mirror Skia's `SkASSERT(winding)` / `SkASSERT(winding || oppWinding)`
    // — debug assertions that gate the *call site*, not the runtime
    // behaviour. In release builds Skia falls through and writes
    // windSum / oppSum even when zero. The mural port originally
    // turned these into throws, but legitimate code paths
    // (Simplify of a path whose ray-cast finds no other hits leaves
    // wind == oppWind == 0) hit the assertion and aborted Op() /
    // Simplify() output. Quiet no-op match the release-build
    // semantics.
    public markWindingValue(span: OpSpan, winding: number): boolean
    {
        if ((span.segment() as OpSegment) !== this) throw new Error('markWindingValue: cross-segment');
        if (span.done()) return false;
        span.setWindSum(winding);
        return true;
    }

    public markWindingValueBinary(span: OpSpan, winding: number, oppWinding: number): boolean
    {
        if ((span.segment() as OpSegment) !== this) throw new Error('markWindingValueBinary: cross-segment');
        if (span.done()) return false;
        span.setWindSum(winding);
        span.setOppSum(oppWinding);
        return true;
    }

    // ── nextChase: hop to the next segment via the angle ring ─────

    public nextChase(startPtr: { value: OpSpanBase | undefined },
                     stepPtr:  { value: number },
                     minPtr:   { value: OpSpan  | undefined },
                     lastPtr:  { value: OpSpanBase | undefined }): OpSegment | undefined
    {
        const origStart = startPtr.value!;
        const step = stepPtr.value;
        const endSpan: OpSpanBase = step > 0
            ? origStart.upCast().next()
            : origStart.prev()!;
        const angle: OpAngle | undefined = (step > 0
            ? endSpan.fromAngle()
            : endSpan.upCast().toAngle()) as OpAngle | undefined;
        let foundSpan: OpSpanBase | undefined;
        let otherEnd:  OpSpanBase | undefined;
        let other: OpSegment | undefined;
        if (angle === undefined)
        {
            if (endSpan.t() !== 0 && endSpan.t() !== 1) return undefined;
            const otherPtT = endSpan.ptT().next();
            other = otherPtT.segment() as OpSegment;
            foundSpan = otherPtT.span();
            const fUp = foundSpan.upCastable();
            otherEnd = step > 0
                ? (fUp !== undefined ? fUp.next() : undefined)
                : foundSpan.prev();
        }
        else
        {
            const lc = angle.loopCount();
            if (lc > 2) { lastPtr.value = endSpan; return undefined; }
            const next = angle.next();
            if (next === undefined) return undefined;
            other = next.segment() as OpSegment;
            foundSpan = next.start() as OpSpanBase;
            otherEnd  = next.end()   as OpSpanBase;
        }
        if (otherEnd === undefined) return undefined;
        const foundStep = foundSpan!.step(otherEnd);
        if (stepPtr.value !== foundStep) { lastPtr.value = endSpan; return undefined; }
        const origMin: OpSpan = step < 0 ? origStart.prev()! : origStart.upCast();
        const foundMin = foundSpan!.starter(otherEnd);
        if (foundMin.windValue() !== origMin.windValue()
            || foundMin.oppValue() !== origMin.oppValue())
        {
            lastPtr.value = endSpan;
            return undefined;
        }
        startPtr.value = foundSpan;
        stepPtr.value  = foundStep;
        minPtr.value   = foundMin;
        return other;
    }

    // ── isSimple: walk the angle ring; if only one segment leaves
    //   the span, that's the next one.

    public isSimple(endPtr: { value: OpSpanBase | undefined },
                    stepPtr: { value: number }): OpSegment | undefined
    {
        const startPtr: { value: OpSpanBase | undefined } = { value: endPtr.value };
        const minPtr:   { value: OpSpan | undefined } = { value: undefined };
        const lastPtr:  { value: OpSpanBase | undefined } = { value: undefined };
        const result = this.nextChase(startPtr, stepPtr, minPtr, lastPtr);
        endPtr.value = startPtr.value;
        return result;
    }

    // ── computeSum: propagate winding around the angle ring ──────

    public computeSum(start: OpSpanBase, end: OpSpanBase,
                      includeType: AngleIncludeType): number
    {
        if (includeType === AngleIncludeType.kUnaryXor)
            throw new Error('OpSegment.computeSum: includeType must not be kUnaryXor');
        const firstAngle0 = this.spanToAngle(end, start);
        if (firstAngle0 === undefined || firstAngle0.next() === undefined) return SK_MIN_S32;
        let baseAngle: OpAngle | undefined = undefined;
        let tryReverse = false;
        let angle = firstAngle0.previous();
        let next  = angle.next()!;
        let firstAngle = next;
        do
        {
            const prior = angle;
            angle = next;
            next  = angle.next()!;
            if (prior.unorderable() || angle.unorderable() || next.unorderable())
            {
                baseAngle = undefined;
                continue;
            }
            const testWinding = angle.starter().windSum();
            if (testWinding !== SK_MIN_S32)
            {
                baseAngle = angle;
                tryReverse = true;
                continue;
            }
            if (baseAngle !== undefined)
            {
                OpSegment.ComputeOneSum(baseAngle, angle, includeType);
                baseAngle = angle.starter().windSum() !== SK_MIN_S32 ? angle : undefined;
            }
        } while (next !== firstAngle);
        if (baseAngle !== undefined && firstAngle.starter().windSum() === SK_MIN_S32)
        {
            firstAngle = baseAngle;
            tryReverse = true;
        }
        if (tryReverse)
        {
            baseAngle = undefined;
            let prior = firstAngle;
            do
            {
                angle = prior;
                prior = angle.previous();
                next  = angle.next()!;
                if (prior.unorderable() || angle.unorderable() || next.unorderable())
                {
                    baseAngle = undefined;
                    continue;
                }
                const testWinding = angle.starter().windSum();
                if (testWinding !== SK_MIN_S32)
                {
                    baseAngle = angle;
                    continue;
                }
                if (baseAngle !== undefined)
                {
                    OpSegment.ComputeOneSumReverse(baseAngle, angle, includeType);
                    baseAngle = angle.starter().windSum() !== SK_MIN_S32 ? angle : undefined;
                }
            } while (prior !== firstAngle);
        }
        return start.starter(end).windSum();
    }

    public static ComputeOneSum(baseAngle: OpAngle, nextAngle: OpAngle,
                                includeType: AngleIncludeType): boolean
    {
        const baseSegment = baseAngle.segment() as OpSegment;
        let sumMiWinding = baseSegment.updateWindingReverseByAngle(baseAngle);
        let sumSuWinding = 0;
        const binary = includeType >= AngleIncludeType.kBinarySingle;
        if (binary)
        {
            sumSuWinding = baseSegment.updateOppWindingReverseByAngle(baseAngle);
            if (baseSegment.operand())
            {
                const t = sumMiWinding; sumMiWinding = sumSuWinding; sumSuWinding = t;
            }
        }
        const nextSegment = nextAngle.segment() as OpSegment;
        const lastPtr: { value: OpSpanBase | undefined } = { value: undefined };
        if (binary)
        {
            const w = { maxWinding: 0, sumWinding: 0, oppMaxWinding: 0, oppSumWinding: 0,
                        sumMiWinding, sumSuWinding };
            nextSegment.setUpWindingsBinary(nextAngle.start() as OpSpanBase,
                                            nextAngle.end()   as OpSpanBase, w);
            if (!nextSegment.markAngleBinary(w.maxWinding, w.sumWinding,
                                              w.oppMaxWinding, w.oppSumWinding,
                                              nextAngle, lastPtr)) return false;
        }
        else
        {
            const w = { maxWinding: 0, sumWinding: sumMiWinding };
            nextSegment.setUpWinding(nextAngle.start() as OpSpanBase,
                                      nextAngle.end()   as OpSpanBase, w);
            if (!nextSegment.markAngle(w.maxWinding, w.sumWinding, nextAngle, lastPtr)) return false;
        }
        nextAngle.setLastMarked(lastPtr.value!);
        return true;
    }

    public static ComputeOneSumReverse(baseAngle: OpAngle, nextAngle: OpAngle,
                                        includeType: AngleIncludeType): boolean
    {
        const baseSegment = baseAngle.segment() as OpSegment;
        let sumMiWinding = baseSegment.updateWindingByAngle(baseAngle);
        let sumSuWinding = 0;
        const binary = includeType >= AngleIncludeType.kBinarySingle;
        if (binary)
        {
            sumSuWinding = baseSegment.updateOppWindingByAngle(baseAngle);
            if (baseSegment.operand())
            {
                const t = sumMiWinding; sumMiWinding = sumSuWinding; sumSuWinding = t;
            }
        }
        const nextSegment = nextAngle.segment() as OpSegment;
        const lastPtr: { value: OpSpanBase | undefined } = { value: undefined };
        if (binary)
        {
            const w = { maxWinding: 0, sumWinding: 0, oppMaxWinding: 0, oppSumWinding: 0,
                        sumMiWinding, sumSuWinding };
            nextSegment.setUpWindingsBinary(nextAngle.end()   as OpSpanBase,
                                            nextAngle.start() as OpSpanBase, w);
            if (!nextSegment.markAngleBinary(w.maxWinding, w.sumWinding,
                                              w.oppMaxWinding, w.oppSumWinding,
                                              nextAngle, lastPtr)) return false;
        }
        else
        {
            const w = { maxWinding: 0, sumWinding: sumMiWinding };
            nextSegment.setUpWinding(nextAngle.end()   as OpSpanBase,
                                      nextAngle.start() as OpSpanBase, w);
            if (!nextSegment.markAngle(w.maxWinding, w.sumWinding, nextAngle, lastPtr)) return false;
        }
        nextAngle.setLastMarked(lastPtr.value!);
        return true;
    }

    // ── undoneSpan ───────────────────────────────────────────────

    public undoneSpan(): OpSpan | undefined
    {
        let span: OpSpan = this.fHead;
        let next: OpSpanBase;
        for (;;)
        {
            next = span.next();
            if (!span.done()) return span;
            if (next.final()) break;
            span = next.upCast();
        }
        return undefined;
    }

    // ── findSortableTop forward — lives in op-winding.ts ─────────
    public findSortableTop(contourHead: unknown): OpSpan | undefined
    {
        // Implementation injected via op-winding.ts; until that file
        // is imported it falls through to undefined.
        const f = (this as unknown as { _findSortableTopImpl?: (h: unknown) => OpSpan | undefined })._findSortableTopImpl;
        return f !== undefined ? f.call(this, contourHead) : undefined;
    }

    public windingSpanAtT(tHit: number): OpSpan | undefined
    {
        const f = (this as unknown as { _windingSpanAtTImpl?: (t: number) => OpSpan | undefined })._windingSpanAtTImpl;
        return f !== undefined ? f.call(this, tHit) : undefined;
    }

    // ── findNext family: outer walker entry points ───────────────

    public findNextOp(chase: OpSpanBase[],
                      nextStart: { value: OpSpanBase | undefined },
                      nextEnd:   { value: OpSpanBase | undefined },
                      unsortable: { value: boolean }, simple: { value: boolean },
                      op: SkPathOp, xorMiMask: number, xorSuMask: number): OpSegment | undefined
    {
        const start = nextStart.value!;
        const end   = nextEnd.value!;
        const stepBox = { value: start.step(end) };
        const isSimpleResult = this.isSimple(nextStart, stepBox);
        simple.value = isSimpleResult !== undefined;
        if (isSimpleResult !== undefined)
        {
            const startSpan = start.starter(end);
            if (startSpan.done()) return undefined;
            this.markDone(startSpan);
            nextEnd.value = stepBox.value > 0
                ? nextStart.value!.upCast().next()
                : nextStart.value!.prev();
            return isSimpleResult;
        }
        const calcWinding = this.computeSum(start, end, AngleIncludeType.kBinaryOpp);
        const sortable = calcWinding !== SK_MIN_S32;
        if (!sortable)
        {
            unsortable.value = true;
            this.markDone(start.starter(end));
            return undefined;
        }
        const angle = this.spanToAngle(end, start);
        if (angle === undefined || angle.unorderable())
        {
            unsortable.value = true;
            this.markDone(start.starter(end));
            return undefined;
        }
        let sumMiWinding = this.updateWinding(end, start);
        if (sumMiWinding === SK_MIN_S32)
        {
            unsortable.value = true;
            this.markDone(start.starter(end));
            return undefined;
        }
        let sumSuWinding = this.updateOppWinding(end, start);
        if (this.operand()) { const t = sumMiWinding; sumMiWinding = sumSuWinding; sumSuWinding = t; }
        // §19.7 engine fix — Skia's findNextOp passes sumMiWinding /
        // sumSuWinding to activeOp as int* so setUpWindings mutates
        // the caller's running totals as each angle in the ring is
        // visited. We mirror that with a `sumRef` box passed to
        // activeOpFullRef.
        const sumRef = { sumMiWinding, sumSuWinding };
        let nextAngle: OpAngle = angle.next()!;
        let foundAngle: OpAngle | undefined = undefined;
        let foundDone = false;
        let nextSegment: OpSegment;
        let activeCount = 0;
        do
        {
            nextSegment = nextAngle.segment() as OpSegment;
            const isActive = nextSegment.activeOpFullRef(xorMiMask, xorSuMask,
                                                         nextAngle.start() as OpSpanBase,
                                                         nextAngle.end()   as OpSpanBase,
                                                         op, sumRef);
            if (isActive)
            {
                ++activeCount;
                if (foundAngle === undefined || (foundDone && (activeCount & 1)))
                {
                    foundAngle = nextAngle;
                    foundDone = nextSegment.doneByAngle(nextAngle);
                }
            }
            if (nextSegment.done()) { nextAngle = nextAngle.next()!; continue; }
            if (!isActive)
            {
                void nextSegment.markAndChaseDone(nextAngle.start() as OpSpanBase,
                                                  nextAngle.end()   as OpSpanBase, undefined);
            }
            const last = nextAngle.lastMarked();
            if (last !== undefined) chase.push(last);
            nextAngle = nextAngle.next()!;
        } while (nextAngle !== angle);
        (start.segment() as OpSegment).markDone(start.starter(end));
        if (foundAngle === undefined) return undefined;
        nextStart.value = foundAngle.start() as OpSpanBase;
        nextEnd.value   = foundAngle.end()   as OpSpanBase;
        return foundAngle.segment() as OpSegment;
    }

    public findNextWinding(chase: OpSpanBase[],
                           nextStart: { value: OpSpanBase | undefined },
                           nextEnd:   { value: OpSpanBase | undefined },
                           unsortable: { value: boolean }): OpSegment | undefined
    {
        const start = nextStart.value!;
        const end   = nextEnd.value!;
        const stepBox = { value: start.step(end) };
        const isSimpleResult = this.isSimple(nextStart, stepBox);
        if (isSimpleResult !== undefined)
        {
            const startSpan = start.starter(end);
            if (startSpan.done()) return undefined;
            this.markDone(startSpan);
            nextEnd.value = stepBox.value > 0
                ? nextStart.value!.upCast().next()
                : nextStart.value!.prev();
            return isSimpleResult;
        }
        const calcWinding = this.computeSum(start, end, AngleIncludeType.kUnaryWinding);
        const sortable = calcWinding !== SK_MIN_S32;
        if (!sortable)
        {
            unsortable.value = true;
            this.markDone(start.starter(end));
            return undefined;
        }
        const angle = this.spanToAngle(end, start);
        if (angle === undefined || angle.unorderable())
        {
            unsortable.value = true;
            this.markDone(start.starter(end));
            return undefined;
        }
        let sumWinding = this.updateWinding(end, start);
        let nextAngle: OpAngle = angle.next()!;
        let foundAngle: OpAngle | undefined = undefined;
        let foundDone = false;
        let nextSegment: OpSegment;
        let activeCount = 0;
        do
        {
            nextSegment = nextAngle.segment() as OpSegment;
            const sumOut = { sum: sumWinding };
            const isActive = nextSegment.activeWindingFull(nextAngle.start() as OpSpanBase,
                                                            nextAngle.end()   as OpSpanBase,
                                                            sumOut);
            sumWinding = sumOut.sum;
            if (isActive)
            {
                ++activeCount;
                if (foundAngle === undefined || (foundDone && (activeCount & 1)))
                {
                    foundAngle = nextAngle;
                    foundDone = nextSegment.doneByAngle(nextAngle);
                }
            }
            if (nextSegment.done()) { nextAngle = nextAngle.next()!; continue; }
            if (!isActive)
            {
                void nextSegment.markAndChaseDone(nextAngle.start() as OpSpanBase,
                                                  nextAngle.end()   as OpSpanBase, undefined);
            }
            const last = nextAngle.lastMarked();
            if (last !== undefined) chase.push(last);
            nextAngle = nextAngle.next()!;
        } while (nextAngle !== angle);
        (start.segment() as OpSegment).markDone(start.starter(end));
        if (foundAngle === undefined) return undefined;
        nextStart.value = foundAngle.start() as OpSpanBase;
        nextEnd.value   = foundAngle.end()   as OpSpanBase;
        return foundAngle.segment() as OpSegment;
    }

    public findNextXor(nextStart: { value: OpSpanBase | undefined },
                       nextEnd:   { value: OpSpanBase | undefined },
                       unsortable: { value: boolean }): OpSegment | undefined
    {
        const start = nextStart.value!;
        const end   = nextEnd.value!;
        const stepBox = { value: start.step(end) };
        const isSimpleResult = this.isSimple(nextStart, stepBox);
        if (isSimpleResult !== undefined)
        {
            const startSpan = start.starter(end);
            if (startSpan.done()) return undefined;
            this.markDone(startSpan);
            nextEnd.value = stepBox.value > 0
                ? nextStart.value!.upCast().next()
                : nextStart.value!.prev();
            return isSimpleResult;
        }
        const angle = this.spanToAngle(end, start);
        if (angle === undefined || angle.unorderable())
        {
            unsortable.value = true;
            this.markDone(start.starter(end));
            return undefined;
        }
        let nextAngle: OpAngle | undefined = angle.next();
        let foundAngle: OpAngle | undefined = undefined;
        let foundDone = false;
        let nextSegment: OpSegment;
        let activeCount = 0;
        do
        {
            if (nextAngle === undefined) return undefined;
            nextSegment = nextAngle.segment() as OpSegment;
            ++activeCount;
            if (foundAngle === undefined || (foundDone && (activeCount & 1)))
            {
                foundAngle = nextAngle;
                foundDone = nextSegment.doneByAngle(nextAngle);
                if (!foundDone) break;
            }
            nextAngle = nextAngle.next();
        } while (nextAngle !== angle);
        (start.segment() as OpSegment).markDone(start.starter(end));
        if (foundAngle === undefined) return undefined;
        nextStart.value = foundAngle.start() as OpSpanBase;
        nextEnd.value   = foundAngle.end()   as OpSpanBase;
        return foundAngle.segment() as OpSegment;
    }

    // SkOpSegment.cpp:1549. Walks every span on the segment and weaves
    // its from-angle, to-angle, and every coincident-ring angle into
    // one sorted ring rooted at the base angle. Singletons are unset
    // (no sort needed when only one path leaves the span).
    public sortAngles(): boolean
    {
        let span: OpSpanBase | undefined = this.fHead;
        while (span !== undefined)
        {
            const fromAngle = span.fromAngle() as OpAngle | undefined;
            const toAngle = span.final() ? undefined : (span.upCast().toAngle() as OpAngle | undefined);
            if (fromAngle === undefined && toAngle === undefined)
            {
                if (span.final()) break;
                span = span.upCast().next();
                continue;
            }
            let baseAngle: OpAngle | undefined = fromAngle;
            if (fromAngle !== undefined && toAngle !== undefined)
            {
                if (!fromAngle.insert(toAngle)) return false;
            }
            else if (fromAngle === undefined)
            {
                baseAngle = toAngle;
            }
            // Walk the pt-T ring to gather every angle from coincident
            // spans pointing here.
            let ptT = span.ptT();
            const stopPtT = ptT;
            let safetyNet = 1_000_000;
            do
            {
                if (!--safetyNet) return false;
                const oSpan = ptT.span();
                if (oSpan === span)
                {
                    ptT = ptT.next();
                    continue;
                }
                let oAngle = oSpan.fromAngle() as OpAngle | undefined;
                if (oAngle !== undefined)
                {
                    if (!oAngle.loopContains(baseAngle!)) baseAngle!.insert(oAngle);
                }
                if (!oSpan.final())
                {
                    oAngle = oSpan.upCast().toAngle() as OpAngle | undefined;
                    if (oAngle !== undefined)
                    {
                        if (!oAngle.loopContains(baseAngle!)) baseAngle!.insert(oAngle);
                    }
                }
                ptT = ptT.next();
            } while (ptT !== stopPtT);
            if (baseAngle!.loopCount() === 1)
            {
                span.setFromAngle(undefined);
                if (toAngle !== undefined) span.upCast().setToAngle(undefined);
            }
            if (span.final()) break;
            span = span.upCast().next();
        }
        return true;
    }

    // SkOpSegment.cpp:1161. Walk every pt-T loop on this segment; if a
    // pt-T points at a segment we've already visited once, the
    // "second touch" indicates a missed coincident pair — check the
    // prior span chain for a matching pt-T on the same opp segment
    // and ask testForCoincidence to confirm via midpoint projection.
    // Adds the run to the global OpCoincidence list on confirmation.
    public missingCoincidence(): boolean
    {
        if (this.done()) return false;
        let prior: OpSpan | undefined = undefined;
        let spanBase: OpSpanBase | undefined = this.fHead;
        let result = false;
        let safetyNet = 100_000;
        while (spanBase !== undefined)
        {
            const spanStopPtT = spanBase.ptT();
            let ptT: OpPtT = spanStopPtT;
            ptT = ptT.next();
            while (ptT !== spanStopPtT)
            {
                if (!--safetyNet) return false;
                if (ptT.deleted()) { ptT = ptT.next(); continue; }
                const opp = ptT.span().segment() as OpSegment;
                if (opp.done())     { ptT = ptT.next(); continue; }
                if (!opp.visited()) { ptT = ptT.next(); continue; }
                if (spanBase === this.fHead) { ptT = ptT.next(); continue; }
                if (ptT.segment() === this) { ptT = ptT.next(); continue; }
                const span = spanBase.upCastable();
                if (span !== undefined && span.containsCoincidenceSegment(opp)) { ptT = ptT.next(); continue; }
                if (spanBase.containsCoinEndSegment(opp)) { ptT = ptT.next(); continue; }
                // Walk prior spans looking for one whose pt-T loop contains opp.
                let priorOpp: OpSegment | undefined = undefined;
                let priorPtT: OpPtT | undefined = undefined;
                let priorTest: OpSpan | undefined = spanBase.prev();
                while (priorOpp === undefined && priorTest !== undefined)
                {
                    const priorStopPtT = priorTest.ptT();
                    priorPtT = priorStopPtT;
                    priorPtT = priorPtT.next();
                    while (priorPtT !== priorStopPtT)
                    {
                        if (!priorPtT.deleted())
                        {
                            const segm = priorPtT.span().segment() as OpSegment;
                            if (segm === opp)
                            {
                                prior = priorTest;
                                priorOpp = opp;
                                break;
                            }
                        }
                        priorPtT = priorPtT.next();
                    }
                    priorTest = priorTest.prev();
                }
                if (priorOpp === undefined || priorPtT === undefined || priorPtT === ptT)
                {
                    ptT = ptT.next();
                    continue;
                }
                let oppStart = prior!.ptT();
                let oppEnd   = spanBase.ptT();
                const swapped = priorPtT.fT > ptT.fT;
                let aPrior = priorPtT, bPtT = ptT;
                if (swapped)
                {
                    aPrior = ptT;
                    bPtT   = priorPtT;
                    const tmp = oppStart; oppStart = oppEnd; oppEnd = tmp;
                }
                const coins = this.globalState().coincidence() as OpCoincidenceLike | undefined;
                if (coins !== undefined)
                {
                    const rootPriorPtT = aPrior.span().ptT();
                    const rootPtT      = bPtT.span().ptT();
                    const rootOppStart = oppStart.span().ptT();
                    const rootOppEnd   = oppEnd.span().ptT();
                    const c = coins as unknown as {
                        contains(a: OpPtT, b: OpPtT, c: OpPtT, d: OpPtT): boolean;
                        extend(a: OpPtT, b: OpPtT, c: OpPtT, d: OpPtT): boolean;
                        add(a: OpPtT, b: OpPtT, c: OpPtT, d: OpPtT): void;
                    };
                    if (!c.contains(rootPriorPtT, rootPtT, rootOppStart, rootOppEnd))
                    {
                        if (this.testForCoincidence(rootPriorPtT, rootPtT, prior!, spanBase, opp))
                        {
                            if (!c.extend(rootPriorPtT, rootPtT, rootOppStart, rootOppEnd))
                            {
                                c.add(rootPriorPtT, rootPtT, rootOppStart, rootOppEnd);
                            }
                            result = true;
                        }
                    }
                }
                ptT = ptT.next();
            }
            if (spanBase.final()) break;
            spanBase = spanBase.upCast().next();
        }
        // Reset fVisited on every span.
        OpSegment.ClearVisited(this.fHead);
        return result;
    }

    // SkOpSegment.h:127 — reset visited flag across the span chain.
    public static ClearVisited(spanHead: OpSpanBase): void
    {
        let span: OpSpanBase | undefined = spanHead;
        while (span !== undefined)
        {
            const ptT = span.ptT();
            let next: OpPtT = ptT;
            do
            {
                const seg = next.segment() as OpSegment;
                seg.resetVisited();
                next = next.next();
            } while (next !== ptT);
            if (span.final()) break;
            span = span.upCast().next();
        }
    }

    // SkOpSegment.cpp:1671. Project the midpoint of the candidate
    // run onto the opp segment; if it's close enough, it's coincident.
    public testForCoincidence(_priorPtT: OpPtT, _ptT: OpPtT,
                              prior: OpSpanBase, spanBase: OpSpanBase,
                              opp: OpSegment): boolean
    {
        const midT = (prior.t() + spanBase.t()) / 2;
        const midPt = this.ptAtT(midT);
        let coincident = true;
        // Cheap check first — if mid is approximately at one of the
        // pt-T pts, treat as coincident only when the spans differ.
        if (!approximatelyEqualPt(_priorPtT.fPt, midPt)
            && !approximatelyEqualPt(_ptT.fPt, midPt))
        {
            if (_priorPtT.span() === _ptT.span()) return false;
            coincident = false;
            // Project perpendicular to opp.
            const slope = this.dSlopeAtT(midT);
            const rayP0 = new Point(midPt.fX, midPt.fY);
            const rayP1 = new Point(midPt.fX + slope.y, midPt.fY - slope.x);
            const ix = new Intersections();
            const rayLine = new Line(rayP0, rayP1);
            switch (opp.verb())
            {
                case OpVerb.kLine:
                {
                    const ln = new Line(opp.pts()[0]!, opp.pts()[1]!);
                    ix.intersectRayLineLine(ln, rayLine);
                    break;
                }
                case OpVerb.kQuad:
                {
                    const q = new Quad();
                    q.fPts = [opp.pts()[0]!, opp.pts()[1]!, opp.pts()[2]!];
                    ix.intersectRayQuadLine(q, rayLine);
                    break;
                }
                case OpVerb.kCubic:
                {
                    const c = new Cubic();
                    c.fPts = [opp.pts()[0]!, opp.pts()[1]!, opp.pts()[2]!, opp.pts()[3]!];
                    ix.intersectRayCubicLine(c, rayLine);
                    break;
                }
                default: return false;
            }
            for (let i = 0; i < ix.used(); ++i)
            {
                if (approximatelyEqualPt(midPt, ix.pt(i)))
                {
                    coincident = true;
                    break;
                }
            }
        }
        return coincident;
    }

    // SkOpSegment.cpp:1271. For every span with multi-add origin, walk
    // its pt-T ring and merge neighbouring spans on the opp segment
    // that share the same t up to roughly_equal but came from earlier
    // intersection adds.
    public moveMultiples(): boolean
    {
        let test: OpSpanBase | undefined = this.fHead;
        while (test !== undefined)
        {
            const addCount = test.spanAddsCount();
            if (addCount > 1)
            {
                const startPtT = test.ptT();
                let testPtT: OpPtT = startPtT;
                let safetyHatch = 1_000_000;
                let checkNext = false;
                ringLoop: do
                {
                    if (!--safetyHatch) return false;
                    const oppSpan = testPtT.span();
                    if (oppSpan.spanAddsCount() !== addCount
                        && !oppSpan.deleted()
                        && (oppSpan.segment() as OpSegment) !== this)
                    {
                        const oppSegment = oppSpan.segment() as OpSegment;
                        let oppFirst: OpSpanBase = oppSpan;
                        let oppPrev: OpSpanBase | undefined = oppSpan;
                        while ((oppPrev = oppPrev.prev()) !== undefined)
                        {
                            if (!roughly_equal(oppPrev.t(), oppSpan.t())) break;
                            if (oppPrev.spanAddsCount() === addCount) continue;
                            if (oppPrev.deleted()) continue;
                            oppFirst = oppPrev;
                        }
                        let oppLast: OpSpanBase = oppSpan;
                        let oppNext: OpSpanBase | undefined = oppSpan;
                        while (true)
                        {
                            if (oppNext === undefined || oppNext.final()) break;
                            const upN = oppNext.upCastable();
                            if (upN === undefined) break;
                            oppNext = upN.next();
                            if (!roughly_equal(oppNext.t(), oppSpan.t())) break;
                            if (oppNext.spanAddsCount() === addCount) continue;
                            if (oppNext.deleted()) continue;
                            oppLast = oppNext;
                        }
                        if (oppFirst !== oppLast)
                        {
                            let oppTest: OpSpanBase = oppFirst;
                            outer: while (true)
                            {
                                if (oppTest !== oppSpan)
                                {
                                    // does oppTest's pt-T loop intersect this start ring?
                                    const oppStartPtT = oppTest.ptT();
                                    let oppPtT: OpPtT = oppStartPtT;
                                    oppPtT = oppPtT.next();
                                    while (oppPtT !== oppStartPtT)
                                    {
                                        const oppPtTSegment = oppPtT.segment() as OpSegment;
                                        if (oppPtTSegment === this) break outer;
                                        let matchPtT: OpPtT = startPtT;
                                        let matched = false;
                                        do
                                        {
                                            if (matchPtT.segment() === oppPtTSegment) { matched = true; break; }
                                            matchPtT = matchPtT.next();
                                        } while (matchPtT !== startPtT);
                                        if (matched)
                                        {
                                            if (!oppTest.mergeMatches(oppSpan)) return false;
                                            oppTest.addOpp(oppSpan);
                                            void oppSegment;
                                            checkNext = true;
                                            break outer;
                                        }
                                        oppPtT = oppPtT.next();
                                    }
                                }
                                if (oppTest === oppLast) break;
                                const up = oppTest.upCastable();
                                if (up === undefined) break;
                                oppTest = up.next();
                            }
                        }
                    }
                    if (checkNext) break ringLoop;
                    testPtT = testPtT.next();
                } while (testPtT !== startPtT);
            }
            if (test.final()) break;
            test = test.upCast().next();
        }
        return true;
    }

    // SkOpSegment.cpp:1370 — pt-T nearness test for adjacent spans.
    public spansNearby(refSpan: OpSpanBase, checkSpan: OpSpanBase,
                       out: { found: boolean }): boolean
    {
        const refHead = refSpan.ptT();
        const checkHead = checkSpan.ptT();
        // Fast path: if the canonical pts are way-apart, no need to
        // walk the full loop. Mural's port uses a coarse threshold.
        const wayCutoff = 1e-2;
        if (Math.abs(refHead.fPt.fX - checkHead.fPt.fX) > wayCutoff
            || Math.abs(refHead.fPt.fY - checkHead.fPt.fY) > wayCutoff)
        {
            out.found = false;
            return true;
        }
        let distSqBest = Number.POSITIVE_INFINITY;
        let refBest: OpPtT | undefined = undefined;
        let checkBest: OpPtT | undefined = undefined;
        let ref: OpPtT = refHead;
        let escapeHatch = 100_000;
        outer: do
        {
            if (!ref.deleted())
            {
                while (ref.ptAlreadySeen(refHead))
                {
                    ref = ref.next();
                    if (ref === refHead) break outer;
                }
                let check: OpPtT = checkHead;
                const refSeg = ref.segment() as OpSegment;
                do
                {
                    if (!check.deleted())
                    {
                        while (check.ptAlreadySeen(checkHead))
                        {
                            check = check.next();
                            if (check === checkHead) { break; }
                        }
                        if (check !== checkHead)
                        {
                            const dx = ref.fPt.fX - check.fPt.fX;
                            const dy = ref.fPt.fY - check.fPt.fY;
                            const distSq = dx * dx + dy * dy;
                            if (distSqBest > distSq
                                && (refSeg !== check.segment()
                                    || !refSeg.ptsDisjointPP(ref, check)))
                            {
                                distSqBest = distSq;
                                refBest = ref;
                                checkBest = check;
                            }
                            if (--escapeHatch <= 0) return false;
                        }
                    }
                    check = check.next();
                } while (check !== checkHead);
            }
            ref = ref.next();
        } while (ref !== refHead);
        out.found = checkBest !== undefined && refBest !== undefined
            && refBest.segment() === this
            && this.matchPtT(refBest, checkBest.segment() as OpSegment,
                             checkBest.fT, checkBest.fPt);
        return true;
    }

    // SkOpSegment.cpp:1441. Walk the span chain, releasing duplicate
    // spans on this segment that point at the same pt-T, and merging
    // adjacent spans whose pts are close enough to coalesce.
    public moveNearby(): boolean
    {
        let spanBase: OpSpanBase | undefined = this.fHead;
        let escapeHatch = 9999;
        while (spanBase !== undefined && !spanBase.final())
        {
            let ptT: OpPtT = spanBase.ptT();
            const headPtT = ptT;
            ptT = ptT.next();
            while (ptT !== headPtT)
            {
                if (!--escapeHatch) return false;
                const tst = ptT.span();
                if (ptT.segment() === this && !ptT.deleted() && tst !== spanBase
                    && tst.ptT() === ptT)
                {
                    if (tst.final())
                    {
                        if (spanBase === this.fHead)
                        {
                            this.clearAll();
                            return true;
                        }
                        spanBase.upCast().release(ptT);
                    }
                    else if (tst.prev() !== undefined)
                    {
                        tst.upCast().release(headPtT);
                    }
                    break;
                }
                ptT = ptT.next();
            }
            spanBase = spanBase.upCast().next();
        }
        // Adjacent-span merge pass.
        spanBase = this.fHead;
        while (spanBase !== undefined && !spanBase.final())
        {
            const test = spanBase.upCast().next();
            const found = { found: false };
            if (!this.spansNearby(spanBase, test, found)) return false;
            if (found.found)
            {
                if (test.final())
                {
                    if (spanBase.prev() !== undefined)
                    {
                        test.merge(spanBase.upCast());
                    }
                    else
                    {
                        this.clearAll();
                        return true;
                    }
                }
                else
                {
                    spanBase.merge(test.upCast());
                }
            }
            spanBase = test;
        }
        return true;
    }

    // SkOpSegment.cpp:172 — emit one curve segment into the writer.
    //
    // Skia's addCurveTo always populates the carrier via subDivide,
    // then calls SkDCurveSweep::setCurveHullSweep + isCurve to detect
    // a curve that has degenerated to a line and rewrites the verb
    // accordingly. Mural's port skips the hull-sweep degeneracy step
    // — inputs from the OpPath converter never produce degenerate
    // arcs in practice — and just uses fVerb directly.
    //
    // The earlier port mistakenly used subDivide's return value as
    // a stand-in for "is curve". subDivide actually returns false
    // both for lines AND for the "endpoints already at t=0/1"
    // early-out where the original control points carry through.
    // Reading that as "is line" caused the writer to emit a straight
    // line in place of a whole-segment cubic — visible as a chord
    // across the top of every curve+rect Intersect result.
    public addCurveTo(start: OpSpanBase, end: OpSpanBase,
                      path: import('./op-path-writer.js').OpPathWriter): boolean
    {
        const spanStart = start.starter(end);
        if (spanStart.alreadyAdded()) return false;
        spanStart.markAdded();
        const out: { value: OpCurveCarrier } = {
            value: { verb: OpVerb.kLine, fLine: undefined as never },
        };
        this.subDivide(start, end, out);
        path.deferredMove(start.ptT());
        switch (this.fVerb)
        {
            case OpVerb.kLine:
                if (!path.deferredLine(end.ptT())) return false;
                break;
            case OpVerb.kQuad:
            {
                if (out.value.verb !== OpVerb.kQuad) return false;
                // §19-deferred #2 — provenance for same-original-curve coalescing.
                path.quadTo(out.value.fQuad.fPts[1]!, end.ptT(), {
                    seg: this,
                    tStart: start.ptT().fT,
                    tEnd:   end.ptT().fT,
                    sourceVerb: OpVerb.kQuad,
                    sourcePts:  this.fPts.slice(0, 3),
                });
                break;
            }
            case OpVerb.kCubic:
            {
                if (out.value.verb !== OpVerb.kCubic) return false;
                path.cubicTo(out.value.fCubic.fPts[1]!, out.value.fCubic.fPts[2]!, end.ptT(), {
                    seg: this,
                    tStart: start.ptT().fT,
                    tEnd:   end.ptT().fT,
                    sourceVerb: OpVerb.kCubic,
                    sourcePts:  this.fPts.slice(0, 4),
                });
                break;
            }
            default: return false;
        }
        return true;
    }

    // rayCheck is injected via op-winding.ts (module augmentation).

    // SkOpSegment.cpp:839. Project a perpendicular at parameter t on
    // this segment and see whether it lands close enough to the opp
    // segment to call them coincident at that t.
    public isClose(t: number, opp: OpSegment): boolean
    {
        const cPt = this.ptAtT(t);
        const slope = this.dSlopeAtT(t);
        const rayP0 = new Point(cPt.fX, cPt.fY);
        const rayP1 = new Point(cPt.fX + slope.y, cPt.fY - slope.x);
        const ix = new Intersections();
        const rayLine = new Line(rayP0, rayP1);
        switch (opp.verb())
        {
            case OpVerb.kLine:
            {
                const ln = new Line(opp.pts()[0]!, opp.pts()[1]!);
                ix.intersectRayLineLine(ln, rayLine);
                break;
            }
            case OpVerb.kQuad:
            {
                const q = new Quad();
                q.fPts = [opp.pts()[0]!, opp.pts()[1]!, opp.pts()[2]!];
                ix.intersectRayQuadLine(q, rayLine);
                break;
            }
            case OpVerb.kCubic:
            {
                const c = new Cubic();
                c.fPts = [opp.pts()[0]!, opp.pts()[1]!, opp.pts()[2]!, opp.pts()[3]!];
                ix.intersectRayCubicLine(c, rayLine);
                break;
            }
            default: return false;
        }
        for (let i = 0; i < ix.used(); ++i)
        {
            const iPt = ix.pt(i);
            const dx = iPt.fX - cPt.fX, dy = iPt.fY - cPt.fY;
            if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) return true;
        }
        return false;
    }

    public addMissing(_t: number, _opp: OpSegment): OpPtT | undefined
    {
        throw new Error('OpSegment.addMissing: Phase 6 follow-up — winding walker');
    }

    // SkOpSegment.cpp:203. Find an existing pt-T at parameter t (or
    // approximately-matching point) on this segment, optionally
    // anchored to a specific opp segment.
    public existing(t: number, opp: OpSegment | undefined): OpPtT | undefined
    {
        let test: OpSpanBase | undefined = this.fHead;
        const pt = this.ptAtT(t);
        let testPtT: OpPtT;
        while (test !== undefined)
        {
            testPtT = test.ptT();
            if (testPtT.fT === t) break;
            if (!this.matchPtT(testPtT, this, t, pt))
            {
                if (t < testPtT.fT) return undefined;
                if (test.final()) break;
                test = test.upCast().next();
                continue;
            }
            if (opp === undefined) return testPtT;
            let loop: OpPtT = testPtT.next();
            let found = false;
            while (loop !== testPtT)
            {
                if (loop.segment() === this && loop.fT === t && loop.fPt.equals(pt))
                {
                    found = true;
                    break;
                }
                loop = loop.next();
            }
            if (!found) return undefined;
            break;
        }
        if (test === undefined) return undefined;
        if (opp !== undefined && test.containsSegment(opp) === undefined) return undefined;
        return test.ptT();
    }

    // SkOpSegment.cpp:235. Break the span at newT so the coincident
    // portion doesn't change the angle of the remainder.
    public addExpanded(newT: number, test: OpSpanBase, startOver: { value: boolean }): boolean
    {
        if (this.contains(newT)) return true;
        this.globalState().resetAllocatedOpSpan();
        if (!(newT >= 0 && newT <= 1)) return false;
        const newPtT = this.addT(newT);
        if (this.globalState().allocatedOpSpan()) startOver.value = true;
        if (newPtT === undefined) return false;
        newPtT.fPt = this.ptAtT(newT);
        const oppPrev = test.ptT().oppPrev(newPtT);
        if (oppPrev !== undefined)
        {
            test.mergeMatches(newPtT.span());
            test.ptT().addOpp(newPtT, oppPrev);
            test.checkForCollapsedCoincidence();
        }
        return true;
    }

}

// Skia uses SkDPoint::ApproximatelyEqual, which is per-axis ULP-equal
// at FLT_EPSILON * 16. Mural's Point.equals is exact; for pt-T
// deduplication we need the loose-ULP form.
function approximatelyEqualPt(a: Point, b: Point): boolean
{
    return AlmostDequalUlps(a.fX, b.fX) && AlmostDequalUlps(a.fY, b.fY);
}
