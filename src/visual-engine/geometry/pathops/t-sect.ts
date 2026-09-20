// Copyright 2014 Google Inc.
//
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE-skia file at the root of this repository.
//
// TypeScript port: 2026 Eugene Napryaglo.
// Sources:
//   third_party/skia/src/pathops/SkPathOpsTSect.{h,cpp}
//   third_party/skia/src/pathops/SkPathOpsTCurve.h
//   (Skia commit pinned in third_party/skia)
//
// T-sectoring engine — curve × curve intersection. The numerical heart
// of Phase 5: handles every non-line × non-line pair (quad × quad,
// quad × cubic, cubic × cubic) through a single recursive bisection.
//
// ── Why bisection ────────────────────────────────────────────────────
//
// Closed-form curve × curve intersection is degree-9 for cubic × cubic
// (Bezier resultant). Skia's approach: bisect both curves recursively,
// reject pairs whose AABBs (and convex hulls) don't overlap, and refine
// the remaining candidates with perpendicular sampling + Newton's
// method. Result is an O((|A|+|B|) log²(1/ε)) algorithm where ε is the
// numerical tolerance.
//
// ── Architecture (this file) ─────────────────────────────────────────
//
//   * SkTCurve — abstract interface. Common shape over Quad and Cubic
//                so SkTSpan can hold either through one pointer type.
//   * SkTQuad / SkTCubic — concrete wrappers. Each delegates ptAtT /
//                dxdyAtT / hullIntersects / subDivide / setBounds /
//                intersectRay to the underlying Quad or Cubic. (Conic
//                lives in upstream Skia; mural's Geometry doesn't expose
//                conics yet so we skip SkTConic.)
//   * SkTSpan  — sub-range [startT, endT] on one curve. Owns a copy of
//                the sub-curve, its AABB, perpendicular probes to the
//                opposite curve at both ends, and forward/back links.
//                Built by SkTSect; SkTSpan never escapes the engine.
//   * SkTSect  — the engine. Owns a linked list of SkTSpans for one
//                curve plus the bisection driver. Static BinarySearch
//                pairs two SkTSect instances and produces an
//                Intersections result.
//
// ── Scope this session ───────────────────────────────────────────────
//
// Data structures + SkTCurve dispatchers. The actual BinarySearch +
// ~30 helper methods (coincidentCheck, computePerpendiculars,
// linesIntersect, intersects, hullCheck, splitAt, addOne,
// removeByPerpendicular, extractCoincident, …) are stubbed with
// explicit "not yet implemented" errors. BinarySearch lands in the
// next porting session along with the helper sweep.
//
// What works right now (after this file): the SkTCurve / SkTQuad /
// SkTCubic interface dispatches correctly. SkTSpan can be constructed
// and its bounds initialised. SkTSect can hold a linked list. The
// engine itself doesn't run yet.

import { Cubic } from './cubic.js';
import { Intersections } from './intersections.js';
import { Line } from './line.js';
import { Point, Vector } from './point.js';
import { Quad } from './quad.js';
import { Rect } from './rect.js';
import {
    approximately_greater_than_one,
    approximately_less_than_zero,
    approximately_zero_when_compared_to,
    between,
    precisely_zero,
    precisely_zero_when_compared_to,
    roughly_between,
} from './types.js';

// Threshold at which BinarySearch suspects a coincident region. Mirrors
// COINCIDENT_SPAN_COUNT in SkPathOpsTSect.h. Skia tunes this empirically;
// 9 is the value that's lived in the upstream tree for years.
const COINCIDENT_SPAN_COUNT = 9;

// ── SkTCurve abstract interface ─────────────────────────────────────

export abstract class TCurve
{
    public abstract collapsed(): boolean;
    public abstract controlsInside(): boolean;
    public abstract dxdyAtT(t: number): Vector;
    // hullIntersects(opp, isLinear) — overloaded for each opposite-curve
    // type in upstream Skia; we use a single tagged-union method here
    // (the opposite curve carries its own concrete type at runtime).
    public abstract hullIntersects(opp: TCurve, isLinear: { value: boolean }): boolean;
    public abstract intersectRay(intersections: Intersections, line: Line): number;
    public abstract make(): TCurve;
    public abstract maxIntersections(): number;
    public abstract pointCount(): number;
    public abstract pointLast(): number;
    public abstract ptAtT(t: number): Point;
    public abstract pt(index: number): Point;
    public abstract setPt(index: number, p: Point): void;
    public abstract setBounds(rect: Rect): void;
    public abstract subDivide(t1: number, t2: number, dst: TCurve): void;
}

// ── SkTQuad — concrete wrapper around Quad ──────────────────────────

export class TQuad extends TCurve
{
    public readonly fQuad: Quad;

    constructor(q?: Quad) { super(); this.fQuad = q ?? new Quad(); }

    public override collapsed(): boolean { return this.fQuad.collapsed(); }
    public override controlsInside(): boolean { return this.fQuad.controlsInside(); }
    public override dxdyAtT(t: number): Vector { return this.fQuad.dxdyAtT(t); }
    public override maxIntersections(): number { return 4; }
    public override pointCount(): number { return 3; }
    public override pointLast(): number { return 2; }
    public override pt(index: number): Point { return this.fQuad.fPts[index as 0|1|2]; }
    public override setPt(index: number, p: Point): void
    {
        this.fQuad.fPts[index as 0|1|2] = p;
    }
    public override ptAtT(t: number): Point { return this.fQuad.ptAtT(t); }
    public override make(): TCurve { return new TQuad(new Quad()); }

    public override setBounds(rect: Rect): void
    {
        const r = this.fQuad.boundingRect();
        rect.fLeft   = r.fLeft;
        rect.fTop    = r.fTop;
        rect.fRight  = r.fRight;
        rect.fBottom = r.fBottom;
    }

    public override subDivide(t1: number, t2: number, dst: TCurve): void
    {
        if (!(dst instanceof TQuad)) throw new Error('TQuad.subDivide: dst must be TQuad');
        const sub = this.fQuad.subDivide(t1, t2);
        for (let i = 0; i < 3; ++i) dst.fQuad.fPts[i as 0|1|2] = sub.fPts[i as 0|1|2];
    }

    public override hullIntersects(opp: TCurve, isLinear: { value: boolean }): boolean
    {
        if (opp instanceof TQuad)  return this.fQuad.hullIntersects(opp.fQuad, isLinear);
        if (opp instanceof TCubic) return opp.fCubic.hullIntersectsQuad(this.fQuad, isLinear);
        throw new Error('TQuad.hullIntersects: unsupported opp curve type');
    }

    public override intersectRay(intersections: Intersections, line: Line): number
    {
        return intersections.intersectRayQuadLine(this.fQuad, line);
    }
}

// ── SkTCubic — concrete wrapper around Cubic ────────────────────────

export class TCubic extends TCurve
{
    public readonly fCubic: Cubic;

    constructor(c?: Cubic) { super(); this.fCubic = c ?? new Cubic(); }

    public override collapsed(): boolean { return this.fCubic.collapsed(); }
    public override controlsInside(): boolean { return this.fCubic.controlsInside(); }
    public override dxdyAtT(t: number): Vector { return this.fCubic.dxdyAtT(t); }
    public override maxIntersections(): number { return 9; }
    public override pointCount(): number { return 4; }
    public override pointLast(): number { return 3; }
    public override pt(index: number): Point { return this.fCubic.fPts[index as 0|1|2|3]; }
    public override setPt(index: number, p: Point): void
    {
        this.fCubic.fPts[index as 0|1|2|3] = p;
    }
    public override ptAtT(t: number): Point { return this.fCubic.ptAtT(t); }
    public override make(): TCurve { return new TCubic(new Cubic()); }

    public override setBounds(rect: Rect): void
    {
        const r = this.fCubic.boundingRect();
        rect.fLeft   = r.fLeft;
        rect.fTop    = r.fTop;
        rect.fRight  = r.fRight;
        rect.fBottom = r.fBottom;
    }

    public override subDivide(t1: number, t2: number, dst: TCurve): void
    {
        if (!(dst instanceof TCubic)) throw new Error('TCubic.subDivide: dst must be TCubic');
        const sub = this.fCubic.subDivide(t1, t2);
        for (let i = 0; i < 4; ++i) dst.fCubic.fPts[i as 0|1|2|3] = sub.fPts[i as 0|1|2|3];
    }

    public override hullIntersects(opp: TCurve, isLinear: { value: boolean }): boolean
    {
        if (opp instanceof TCubic) return this.fCubic.hullIntersects(opp.fCubic, isLinear);
        if (opp instanceof TQuad)  return this.fCubic.hullIntersectsQuad(opp.fQuad, isLinear);
        throw new Error('TCubic.hullIntersects: unsupported opp curve type');
    }

    public override intersectRay(intersections: Intersections, line: Line): number
    {
        return intersections.intersectRayCubicLine(this.fCubic, line);
    }
}

// ── SkTCoincident — perpendicular probe + match flag ────────────────

export class TCoincident
{
    public fPerpPt: Point = new Point(NaN, NaN);
    public fPerpT: number = -1; // perpendicular intersection on opposite curve
    public fMatch: boolean = false;

    public init(): void
    {
        this.fPerpT = -1;
        this.fMatch = false;
        this.fPerpPt = new Point(NaN, NaN);
    }

    public isMatch(): boolean { return this.fMatch; }

    public markCoincident(): void
    {
        if (!this.fMatch) this.fPerpT = -1;
        this.fMatch = true;
    }

    public perpPt(): Point { return this.fPerpPt; }
    public perpT(): number { return this.fPerpT; }

    // Probe the opposite curve with a ray perpendicular to c1's tangent
    // at parameter t. Record the closest intersection point + its
    // parameter on c2; mark fMatch true if the projected point coincides
    // (within ApproximatelyEqual) with the original cPt on c1.
    //
    // Mirrors SkPathOpsTSect.cpp:28.
    public setPerp(c1: TCurve, t: number, cPt: Point, c2: TCurve): void
    {
        const dxdy = c1.dxdyAtT(t);
        // Perpendicular line origin at cPt, direction rotated 90° from
        // c1's tangent.
        const perp = new Line(cPt, new Point(cPt.fX + dxdy.fY, cPt.fY - dxdy.fX));
        const i = new Intersections();
        const used = c2.intersectRay(i, perp);
        if (used === 0 || used === 3) { this.init(); return; }
        this.fPerpT  = i._get_fT(0, 0);
        this.fPerpPt = i.pt(0);
        if (used === 2)
        {
            const distSq  = this.fPerpPt.sub(cPt).lengthSquared();
            const dist2Sq = i.pt(1).sub(cPt).lengthSquared();
            if (dist2Sq < distSq)
            {
                this.fPerpT  = i._get_fT(0, 1);
                this.fPerpPt = i.pt(1);
            }
        }
        this.fMatch = Point.ApproximatelyEqual(cPt, this.fPerpPt);
    }
}

// ── SkTSpanBounded — singly-linked list of bounded peer spans ───────

export interface TSpanBounded
{
    fBounded: TSpan;
    fNext: TSpanBounded | undefined;
}

// ── SkTSpan — sub-range [startT, endT] on one curve ─────────────────

export class TSpan
{
    public fPart: TCurve;
    public fCoinStart: TCoincident = new TCoincident();
    public fCoinEnd:   TCoincident = new TCoincident();
    public fBounded: TSpanBounded | undefined = undefined;
    public fPrev: TSpan | undefined = undefined;
    public fNext: TSpan | undefined = undefined;
    public fBounds: Rect = new Rect();
    public fStartT: number = 0;
    public fEndT:   number = 0;
    public fBoundsMax: number = 0;
    public fCollapsed: boolean = false;
    public fHasPerp:   boolean = false;
    public fIsLinear:  boolean = false;
    public fIsLine:    boolean = false;
    public fDeleted:   boolean = false;

    constructor(curve: TCurve)
    {
        this.fPart = curve.make();
    }

    public init(curve: TCurve): void
    {
        this.fPrev = undefined;
        this.fNext = undefined;
        this.fStartT = 0;
        this.fEndT = 1;
        this.fBounded = undefined;
        for (let i = 0; i < curve.pointCount(); ++i)
        {
            this.fPart.setPt(i, curve.pt(i));
        }
    }

    public initBounds(curve: TCurve): boolean
    {
        // SkPathOpsTSect.cpp:236 — subdivide the ORIGINAL curve to the
        // span's current [fStartT, fEndT] window, then compute the bbox
        // from the resulting sub-curve. This is the critical step that
        // tells hull-overlap rejection what shape the span is currently
        // working with. Skipping it (my v1) left every span carrying
        // the FULL curve geometry, so the bisection produced spurious
        // "no intersection" results on real overlaps.
        if (Number.isNaN(this.fStartT) || Number.isNaN(this.fEndT)) return false;
        curve.subDivide(this.fStartT, this.fEndT, this.fPart);
        this.fPart.setBounds(this.fBounds);
        this.fCoinStart.init();
        this.fCoinEnd.init();
        this.fBoundsMax = Math.max(
            this.fBounds.fRight - this.fBounds.fLeft,
            this.fBounds.fBottom - this.fBounds.fTop,
        );
        this.fCollapsed = this.fPart.collapsed();
        this.fHasPerp = false;
        this.fDeleted = false;
        return this.fBounds.valid();
    }

    public endT(): number { return this.fEndT; }
    public startT(): number { return this.fStartT; }
    public part(): TCurve { return this.fPart; }
    public pointCount(): number { return this.fPart.pointCount(); }
    public pointFirst(): Point { return this.fPart.pt(0); }
    public pointLast(): Point { return this.fPart.pt(this.fPart.pointLast()); }
    public isBounded(): boolean { return this.fBounded !== undefined; }

    public reset(): void { this.fBounded = undefined; }

    public markCoincident(): void
    {
        this.fCoinStart.markCoincident();
        this.fCoinEnd.markCoincident();
    }

    public resetBounds(curve: TCurve): void
    {
        this.fIsLinear = false;
        this.fIsLine = false;
        this.initBounds(curve);
    }

    // ── Engine helpers ─────────────────────────────────────────────

    // SkPathOpsTSect.cpp:63 — prepend a bounded peer entry.
    public addBounded(span: TSpan): void
    {
        const entry: TSpanBounded = { fBounded: span, fNext: this.fBounded };
        this.fBounded = entry;
    }

    // SkPathOpsTSect.cpp:118 — among bounded peers, find the t-edge
    // (start or end) whose endpoint is closest to `pt`. Returns -1
    // when this span has no bounded peers.
    public closestBoundedT(pt: Point): number
    {
        let result = -1;
        let closest = Number.MAX_VALUE;
        let testBounded = this.fBounded;
        while (testBounded !== undefined)
        {
            const test = testBounded.fBounded;
            const startDist = test.pointFirst().distanceSquared(pt);
            if (closest > startDist) { closest = startDist; result = test.fStartT; }
            const endDist = test.pointLast().distanceSquared(pt);
            if (closest > endDist)   { closest = endDist;   result = test.fEndT;   }
            testBounded = testBounded.fNext;
        }
        return result;
    }

    // SkPathOpsTSect.cpp:153 — t lies inside ANY span in the chain
    // starting at this one.
    public contains(t: number): boolean
    {
        let work: TSpan | undefined = this;
        do
        {
            if (between(work.fStartT, t, work.fEndT)) return true;
            work = work.fNext;
        } while (work !== undefined);
        return false;
    }

    // SkPathOpsTSect.cpp:167 — locate `opp` among bounded peers.
    public findOppSpan(opp: TSpan): TSpan | undefined
    {
        let bounded = this.fBounded;
        while (bounded !== undefined)
        {
            const test = bounded.fBounded;
            if (opp === test) return test;
            bounded = bounded.fNext;
        }
        return undefined;
    }

    public hasOppT(t: number): boolean { return this.oppT(t) !== undefined; }

    public findOppT(t: number): TSpan
    {
        const result = this.oppT(t);
        if (result === undefined) throw new Error('TSpan.findOppT: no opposite span at t');
        return result;
    }

    // SkPathOpsTSect.cpp:185 — hull-overlap classification:
    //   0  : no hull intersection
    //   1  : hulls intersect
    //   2  : hulls only share a common endpoint
    //   -1 : linear; further checking needed by caller
    public hullCheck(opp: TSpan, start: { value: boolean }, oppStart: { value: boolean }): number
    {
        if (this.fIsLinear) return -1;
        const ptsInCommon = { value: false };
        if (this.onlyEndPointsInCommon(opp, start, oppStart, ptsInCommon)) return 2;
        const linear = { value: false };
        if (this.fPart.hullIntersects(opp.fPart, linear))
        {
            if (!linear.value) return 1;
            this.fIsLinear = true;
            this.fIsLine   = this.fPart.controlsInside();
            return ptsInCommon.value ? 1 : -1;
        }
        return ptsInCommon.value ? 2 : 0;
    }

    // SkPathOpsTSect.cpp:212 — bbox-reject first, then hull-check both
    // directions.
    public hullsIntersect(opp: TSpan, start: { value: boolean }, oppStart: { value: boolean }): number
    {
        if (!this.fBounds.intersects(opp.fBounds)) return 0;
        let hullSect = this.hullCheck(opp, start, oppStart);
        if (hullSect >= 0) return hullSect;
        hullSect = opp.hullCheck(this, oppStart, start);
        if (hullSect >= 0) return hullSect;
        return -1;
    }

    // SkPathOpsTSect.cpp:256
    public linearsIntersect(span: TSpan): boolean
    {
        let result = this.linearIntersects(span.fPart);
        if (result <= 1) return result !== 0;
        result = span.linearIntersects(this.fPart);
        return result !== 0;
    }

    // SkPathOpsTSect.cpp:267 — project `pt` onto this span's chord (line
    // from pointFirst to pointLast); return its t-parameter via the
    // dominant axis.
    public linearT(pt: Point): number
    {
        const len = this.pointLast().sub(this.pointFirst());
        return Math.abs(len.fX) > Math.abs(len.fY)
            ? (pt.fX - this.pointFirst().fX) / len.fX
            : (pt.fY - this.pointFirst().fY) / len.fY;
    }

    // SkPathOpsTSect.cpp:274 — "this is nearly linear; does q2 cross the
    // chord?" Returns:
    //   0 : q2 lies entirely on one side of the chord — no intersection
    //   1 : q2's points straddle the chord
    //   3 : q2 is degenerate / on the chord within tolerance
    public linearIntersects(q2: TCurve): number
    {
        let start = 0;
        let end   = this.fPart.pointLast();
        // For curves whose control points are NOT all inside the
        // endpoint chord, pick the farthest-apart pair instead — that's
        // the real "chord" to test against.
        if (!this.fPart.controlsInside())
        {
            let dist = 0;
            for (let outer = 0; outer < this.pointCount() - 1; ++outer)
            {
                for (let inner = outer + 1; inner < this.pointCount(); ++inner)
                {
                    const test = this.fPart.pt(outer).sub(this.fPart.pt(inner)).lengthSquared();
                    if (dist > test) continue;
                    dist = test;
                    start = outer;
                    end   = inner;
                }
            }
        }
        const origX = this.fPart.pt(start).fX;
        const origY = this.fPart.pt(start).fY;
        const adj   = this.fPart.pt(end).fX - origX;
        const opp   = this.fPart.pt(end).fY - origY;
        const maxPart = Math.max(Math.abs(adj), Math.abs(opp));
        let sign = 0;
        for (let n = 0; n < q2.pointCount(); ++n)
        {
            const dx = q2.pt(n).fY - origY;
            const dy = q2.pt(n).fX - origX;
            const maxVal = Math.max(maxPart, Math.max(Math.abs(dx), Math.abs(dy)));
            const test = (q2.pt(n).fY - origY) * adj - (q2.pt(n).fX - origX) * opp;
            if (precisely_zero_when_compared_to(test, maxVal))   return 1;
            if (approximately_zero_when_compared_to(test, maxVal)) return 3;
            if (n === 0) { sign = test; continue; }
            if (test * sign < 0) return 1;
        }
        return 0;
    }

    // SkPathOpsTSect.cpp:320 — quick reject: if two spans share only
    // their endpoints AND each side's "other" control points sit on
    // OPPOSITE sides of the shared endpoint, the hulls touch but
    // don't overlap. Writes `start`/`oppStart` to identify which end
    // matched and `ptsInCommon` for the caller's tracking.
    public onlyEndPointsInCommon(
        opp: TSpan,
        start: { value: boolean },
        oppStart: { value: boolean },
        ptsInCommon: { value: boolean },
    ): boolean
    {
        if      (opp.pointFirst().equals(this.pointFirst())) { start.value = true;  oppStart.value = true;  }
        else if (opp.pointFirst().equals(this.pointLast()))  { start.value = false; oppStart.value = true;  }
        else if (opp.pointLast().equals(this.pointFirst()))  { start.value = true;  oppStart.value = false; }
        else if (opp.pointLast().equals(this.pointLast()))   { start.value = false; oppStart.value = false; }
        else { ptsInCommon.value = false; return false; }
        ptsInCommon.value = true;
        const baseIndex   = start.value ? 0 : this.fPart.pointLast();
        const oppBaseIdx  = oppStart.value ? 0 : opp.fPart.pointLast();
        const otherPts    = otherPtsArray(this.fPart, baseIndex);
        const oppOtherPts = otherPtsArray(opp.fPart,  oppBaseIdx);
        const base = this.fPart.pt(baseIndex);
        for (let o1 = 0; o1 < this.pointCount() - 1; ++o1)
        {
            const v1 = otherPts[o1]!.sub(base);
            for (let o2 = 0; o2 < opp.pointCount() - 1; ++o2)
            {
                const v2 = oppOtherPts[o2]!.sub(base);
                if (v2.dot(v1) >= 0) return false;
            }
        }
        return true;
    }

    // SkPathOpsTSect.cpp:355
    public oppT(t: number): TSpan | undefined
    {
        let bounded = this.fBounded;
        while (bounded !== undefined)
        {
            const test = bounded.fBounded;
            if (between(test.fStartT, t, test.fEndT)) return test;
            bounded = bounded.fNext;
        }
        return undefined;
    }

    // SkPathOpsTSect.cpp:367 — remove every bounded peer's reference to
    // this span; returns true if any peer became span-less and should
    // be deleted.
    public removeAllBounded(): boolean
    {
        let deleteSpan = false;
        let bounded = this.fBounded;
        while (bounded !== undefined)
        {
            const opp = bounded.fBounded;
            if (opp.removeBounded(this)) deleteSpan = true;
            bounded = bounded.fNext;
        }
        return deleteSpan;
    }

    // SkPathOpsTSect.cpp:378
    public removeBounded(opp: TSpan): boolean
    {
        if (this.fHasPerp)
        {
            let foundStart = false;
            let foundEnd   = false;
            let bounded = this.fBounded;
            while (bounded !== undefined)
            {
                const test = bounded.fBounded;
                if (opp !== test)
                {
                    if (between(test.fStartT, this.fCoinStart.perpT(), test.fEndT)) foundStart = true;
                    if (between(test.fStartT, this.fCoinEnd.perpT(),   test.fEndT)) foundEnd   = true;
                }
                bounded = bounded.fNext;
            }
            if (!foundStart || !foundEnd)
            {
                this.fHasPerp = false;
                this.fCoinStart.init();
                this.fCoinEnd.init();
            }
        }
        let bounded = this.fBounded;
        let prev: TSpanBounded | undefined = undefined;
        while (bounded !== undefined)
        {
            const next = bounded.fNext;
            if (opp === bounded.fBounded)
            {
                if (prev !== undefined) { prev.fNext = next; return false; }
                this.fBounded = next;
                return this.fBounded === undefined;
            }
            prev = bounded;
            bounded = next;
        }
        return false;
    }

    // SkPathOpsTSect.cpp:200 (header) — split() bisects work at the
    // midpoint and re-runs through splitAt.
    public split(work: TSpan): boolean
    {
        return this.splitAt(work, (work.fStartT + work.fEndT) * 0.5);
    }

    // SkPathOpsTSect.cpp:417 — split `work` at t. `this` becomes the
    // [t, work.endT] tail; `work` becomes the [work.startT, t] head.
    // Bounded peers are duplicated onto both halves and twin-linked.
    // Returns false if either half collapsed at t.
    public splitAt(work: TSpan, t: number): boolean
    {
        this.fStartT = t;
        this.fEndT   = work.fEndT;
        if (this.fStartT === this.fEndT) { this.fCollapsed = true; return false; }
        work.fEndT = t;
        if (work.fStartT === work.fEndT) { work.fCollapsed = true; return false; }
        this.fPrev = work;
        this.fNext = work.fNext;
        this.fIsLinear = work.fIsLinear;
        this.fIsLine   = work.fIsLine;
        work.fNext = this;
        if (this.fNext !== undefined) this.fNext.fPrev = this;
        let bounded: TSpanBounded | undefined = work.fBounded;
        this.fBounded = undefined;
        while (bounded !== undefined)
        {
            this.addBounded(bounded.fBounded);
            bounded = bounded.fNext;
        }
        const self = this;
        for (let mirror: TSpanBounded | undefined = self.fBounded;
             mirror !== undefined;
             mirror = mirror.fNext)
        {
            mirror.fBounded.addBounded(self);
        }
        return true;
    }
}

// Build the (pointCount - 1)-length array of points OTHER than fPts[baseIndex].
// Used by onlyEndPointsInCommon. Quad/Cubic both have otherPts methods
// but with different return shapes; this helper normalises to Point[].
function otherPtsArray(curve: TCurve, baseIndex: number): Point[]
{
    const out: Point[] = [];
    for (let i = 0; i < curve.pointCount(); ++i)
    {
        if (i === baseIndex) continue;
        out.push(curve.pt(i));
    }
    return out;
}

// ── SkTSect — bisection engine for one curve, paired via BinarySearch

export class TSect
{
    public readonly fCurve: TCurve;
    public fHead: TSpan | undefined = undefined;
    public fCoincident: TSpan | undefined = undefined;
    public fDeleted: TSpan | undefined = undefined;
    public fActiveCount: number = 0;
    public fRemovedStartT: boolean = false;
    public fRemovedEndT: boolean = false;
    public fHung: boolean = false;

    constructor(curve: TCurve)
    {
        this.fCurve = curve;
        const head = new TSpan(curve);
        head.init(curve);
        head.initBounds(curve);
        this.fHead = head;
        this.fActiveCount = 1;
    }

    // ── Removal / unlink helpers ────────────────────────────────────

    // SkPathOpsTSect.cpp:1533 — extract `span` from the doubly-linked
    // chain (head ↔ … ↔ span ↔ … ↔ tail). Caller still needs to
    // markSpanGone afterward. Returns false on internal inconsistency.
    public unlinkSpan(span: TSpan): boolean
    {
        const prev = span.fPrev;
        const next = span.fNext;
        if (prev !== undefined)
        {
            prev.fNext = next;
            if (next !== undefined)
            {
                next.fPrev = prev;
                if (next.fStartT > next.fEndT) return false;
            }
        }
        else
        {
            this.fHead = next;
            if (next !== undefined) next.fPrev = undefined;
        }
        return true;
    }

    // SkPathOpsTSect.cpp:1241 — mark span as deleted + prepend to the
    // freelist for arena recycling. Mural relies on GC so the freelist
    // is informational only.
    public markSpanGone(span: TSpan): boolean
    {
        if (--this.fActiveCount < 0) return false;
        span.fNext = this.fDeleted;
        this.fDeleted = span;
        span.fDeleted = true;
        return true;
    }

    // SkPathOpsTSect.cpp:1423
    public removeSpan(span: TSpan): boolean
    {
        this.removedEndCheck(span);
        if (!this.unlinkSpan(span)) return false;
        return this.markSpanGone(span);
    }

    // SkPathOpsTSect.cpp:1414
    public removedEndCheck(span: TSpan): void
    {
        if (span.fStartT === 0) this.fRemovedStartT = true;
        if (span.fEndT   === 1) this.fRemovedEndT   = true;
    }

    // SkPathOpsTSect.cpp:1431 — drop every span strictly between first
    // and last (inclusive of (first, last]) plus link first → last.next.
    public removeSpanRange(first: TSpan, last: TSpan): void
    {
        if (first === last) return;
        const final = last.fNext;
        let next: TSpan | undefined = first.fNext;
        while (next !== undefined && next !== final)
        {
            const after = next.fNext;
            this.markSpanGone(next);
            next = after;
        }
        if (final !== undefined) final.fPrev = first;
        first.fNext = final;
    }

    // SkPathOpsTSect.cpp:1356 — among `span.fBounded`, remove every peer
    // that isn't `keep`. Deleted peers cascade into `opp.removeSpan`.
    public removeAllBut(keep: TSpan, span: TSpan, opp: TSect): void
    {
        let testBounded = span.fBounded;
        while (testBounded !== undefined)
        {
            const bounded = testBounded.fBounded;
            const next = testBounded.fNext;
            if (bounded !== keep && !bounded.fDeleted)
            {
                span.removeBounded(bounded);
                if (bounded.removeBounded(span)) opp.removeSpan(bounded);
            }
            testBounded = next;
        }
    }

    // SkPathOpsTSect.cpp:1452 — symmetric removal of every peer plus
    // the span itself if it gets stranded.
    public removeSpans(span: TSpan, opp: TSect): boolean
    {
        let bounded = span.fBounded;
        while (bounded !== undefined)
        {
            const spanBounded = bounded.fBounded;
            const next = bounded.fNext;
            if (span.removeBounded(spanBounded)) this.removeSpan(span);
            if (spanBounded.removeBounded(span)) opp.removeSpan(spanBounded);
            if (span.fDeleted && opp.hasBounded(span)) return false;
            bounded = next;
        }
        return true;
    }

    // SkPathOpsTSect.cpp:1400 — move span from the active chain to the
    // coincident chain (or just discard if outside the perp window).
    public removeCoincident(span: TSpan, isBetween: boolean): boolean
    {
        if (!this.unlinkSpan(span)) return false;
        if (isBetween || between(0, span.fCoinStart.perpT(), 1))
        {
            --this.fActiveCount;
            span.fNext = this.fCoincident;
            this.fCoincident = span;
        }
        else
        {
            this.markSpanGone(span);
        }
        return true;
    }

    // SkPathOpsTSect.cpp:819
    public deleteEmptySpans(): boolean
    {
        let next: TSpan | undefined = this.fHead;
        let safety = 1000;
        while (next !== undefined)
        {
            const test = next;
            next = test.fNext;
            if (test.fBounded === undefined)
            {
                if (!this.removeSpan(test)) return false;
            }
            if (--safety < 0) return false;
        }
        return true;
    }

    // SkPathOpsTSect.cpp:1340 — resurrect collapsed deleted spans into
    // the active chain so the BinarySearch tail-pass can probe them.
    public recoverCollapsed(): void
    {
        let deleted = this.fDeleted;
        while (deleted !== undefined)
        {
            const delNext = deleted.fNext;
            if (deleted.fCollapsed)
            {
                // Splice into fHead chain ahead of the first span whose
                // endT > deleted.startT.
                if (this.fHead === undefined || this.fHead.fEndT > deleted.fStartT)
                {
                    deleted.fNext = this.fHead;
                    this.fHead = deleted;
                }
                else
                {
                    let cursor: TSpan = this.fHead;
                    while (cursor.fNext !== undefined && cursor.fNext.fEndT <= deleted.fStartT)
                    {
                        cursor = cursor.fNext;
                    }
                    deleted.fNext = cursor.fNext;
                    cursor.fNext = deleted;
                }
            }
            deleted = delNext;
        }
    }

    // SkPathOpsTSect.cpp:1252 — tangent-dot ≥ 0 means same direction.
    public matchedDirection(t: number, sect2: TSect, t2: number): boolean
    {
        const dxdy  = this.fCurve.dxdyAtT(t);
        const dxdy2 = sect2.fCurve.dxdyAtT(t2);
        return dxdy.dot(dxdy2) >= 0;
    }

    public matchedDirCheck(
        t: number, sect2: TSect, t2: number,
        calcMatched: { value: boolean }, oppMatched: { value: boolean },
    ): void
    {
        if (!calcMatched.value)
        {
            oppMatched.value  = this.matchedDirection(t, sect2, t2);
            calcMatched.value = true;
        }
    }

    // SkPathOpsTSect.cpp:1472
    public spanAtT(t: number, priorOut: { value: TSpan | undefined }): TSpan | undefined
    {
        let test: TSpan | undefined = this.fHead;
        let prev: TSpan | undefined = undefined;
        while (test !== undefined && test.fEndT < t)
        {
            prev = test;
            test = test.fNext;
        }
        priorOut.value = prev;
        return test !== undefined && test.fStartT <= t ? test : undefined;
    }

    // SkPathOpsTSect.cpp:93 — record a perpendicular-induced
    // intersection on `span` with t = `t`. Creates the opposite span
    // if it doesn't exist yet.
    public addForPerp(span: TSpan, t: number): void
    {
        if (!span.hasOppT(t))
        {
            const priorOut = { value: undefined as TSpan | undefined };
            let opp = this.spanAtT(t, priorOut);
            if (opp === undefined) opp = this.addFollowing(priorOut.value);
            opp.addBounded(span);
            span.addBounded(opp);
        }
    }

    public addSplitAt(span: TSpan, t: number): TSpan
    {
        const result = this.addOne();
        result.splitAt(span, t);
        result.initBounds(this.fCurve);
        span.initBounds(this.fCurve);
        return result;
    }

    // SkPathOpsTSect.cpp:1555
    public updateBounded(first: TSpan, last: TSpan, oppFirst: TSpan): boolean
    {
        let test: TSpan | undefined = first;
        const final: TSpan | undefined = last.fNext;
        let deleteSpan = false;
        do
        {
            if (test === undefined) break;
            if (test.removeAllBounded()) deleteSpan = true;
            test = test.fNext;
        } while (test !== final && test !== undefined);
        first.fBounded = undefined;
        first.addBounded(oppFirst);
        return deleteSpan;
    }

    // SkPathOpsTSect.cpp:744
    public computePerpendiculars(sect2: TSect, first: TSpan | undefined, last: TSpan | undefined): void
    {
        if (last === undefined || first === undefined) return;
        const opp = sect2.fCurve;
        let work: TSpan = first;
        let prior: TSpan | undefined = undefined;
        while (true)
        {
            if (!work.fHasPerp && !work.fCollapsed)
            {
                if (prior !== undefined)
                {
                    work.fCoinStart = prior.fCoinEnd;
                }
                else
                {
                    work.fCoinStart.setPerp(this.fCurve, work.fStartT, work.pointFirst(), opp);
                }
                if (work.fCoinStart.isMatch())
                {
                    const perpT = work.fCoinStart.perpT();
                    if (sect2.coincidentHasT(perpT)) work.fCoinStart.init();
                    else                              sect2.addForPerp(work, perpT);
                }
                work.fCoinEnd.setPerp(this.fCurve, work.fEndT, work.pointLast(), opp);
                if (work.fCoinEnd.isMatch())
                {
                    const perpT = work.fCoinEnd.perpT();
                    if (sect2.coincidentHasT(perpT)) work.fCoinEnd.init();
                    else                              sect2.addForPerp(work, perpT);
                }
                work.fHasPerp = true;
            }
            if (work === last) break;
            prior = work;
            const next = work.fNext;
            if (next === undefined) break;
            work = next;
        }
    }

    // SkPathOpsTSect.cpp:1376
    public removeByPerpendicular(opp: TSect): boolean
    {
        let test: TSpan | undefined = this.fHead;
        while (test !== undefined)
        {
            const next = test.fNext;
            if (test.fCoinStart.perpT() < 0 || test.fCoinEnd.perpT() < 0)
            {
                test = next; continue;
            }
            const startV = test.fCoinStart.perpPt().sub(test.pointFirst());
            const endV   = test.fCoinEnd.perpPt().sub(test.pointLast());
            if (startV.dot(endV) <= 0) { test = next; continue; }
            if (!this.removeSpans(test, opp)) return false;
            test = next;
        }
        return true;
    }

    // SkPathOpsTSect.cpp:997
    public intersects(span: TSpan, opp: TSect, oppSpan: TSpan, oppResult: { value: number }): number
    {
        const spanStart = { value: false }, oppStart = { value: false };
        let hullResult = span.hullsIntersect(oppSpan, spanStart, oppStart);
        if (hullResult >= 0)
        {
            if (hullResult === 2)
            {
                if (span.fBounded === undefined || span.fBounded.fNext === undefined)
                {
                    if (spanStart.value) span.fEndT   = span.fStartT;
                    else                 span.fStartT = span.fEndT;
                }
                else hullResult = 1;
                if (oppSpan.fBounded === undefined || oppSpan.fBounded.fNext === undefined)
                {
                    if (oppSpan.fBounded !== undefined && oppSpan.fBounded.fBounded !== span) return 0;
                    if (oppStart.value) oppSpan.fEndT   = oppSpan.fStartT;
                    else                oppSpan.fStartT = oppSpan.fEndT;
                    oppResult.value = 2;
                }
                else oppResult.value = 1;
            }
            else oppResult.value = 1;
            return hullResult;
        }
        if (span.fIsLine && oppSpan.fIsLine)
        {
            const i = new Intersections();
            const sects = this.linesIntersect(span, opp, oppSpan, i);
            if (sects === 2) { oppResult.value = 1; return 1; }
            if (sects === 0) return -1;
            this.removedEndCheck(span);
            span.fStartT = span.fEndT = i._get_fT(0, 0);
            opp.removedEndCheck(oppSpan);
            oppSpan.fStartT = oppSpan.fEndT = i._get_fT(1, 0);
            oppResult.value = 2;
            return 2;
        }
        if (span.fIsLinear || oppSpan.fIsLinear)
        {
            oppResult.value = span.linearsIntersect(oppSpan) ? 1 : 0;
            return oppResult.value;
        }
        oppResult.value = 1;
        return 1;
    }

    // SkPathOpsTSect.cpp:1082 — tangent-line refinement when both spans
    // have collapsed to lines.
    public linesIntersect(span: TSpan, opp: TSect, oppSpan: TSpan, i: Intersections): number
    {
        const thisRayI = new Intersections();
        const oppRayI  = new Intersections();
        let thisLine = new Line(span.pointFirst(), span.pointLast());
        let oppLine  = new Line(oppSpan.pointFirst(), oppSpan.pointLast());
        let loopCount = 0;
        let bestDistSq = Number.MAX_VALUE;
        if (opp.fCurve.intersectRay(thisRayI, thisLine) === 0) return 0;
        if (this.fCurve.intersectRay(oppRayI,  oppLine)  === 0) return 0;
        // Coincident detection by endpoint matching.
        if (thisRayI.used() > 1)
        {
            let ptMatches = 0;
            for (let t = 0; t < thisRayI.used(); ++t)
            {
                for (let l = 0; l < 2; ++l)
                {
                    if (Point.ApproximatelyEqual(thisRayI.pt(t), thisLine.fPts[l]!)) ++ptMatches;
                }
            }
            if (ptMatches === 2) return 2;
        }
        if (oppRayI.used() > 1)
        {
            let ptMatches = 0;
            for (let o = 0; o < oppRayI.used(); ++o)
            {
                for (let l = 0; l < 2; ++l)
                {
                    if (Point.ApproximatelyEqual(oppRayI.pt(o), oppLine.fPts[l]!)) ++ptMatches;
                }
            }
            if (ptMatches === 2) return 2;
        }
        while (true)
        {
            // Pick closest pair of probed points.
            let closest = Number.MAX_VALUE;
            let closeIndex = -1, oppCloseIndex = -1;
            for (let index = 0; index < oppRayI.used(); ++index)
            {
                if (!roughly_between(span.fStartT, oppRayI._get_fT(0, index), span.fEndT)) continue;
                for (let oIdx = 0; oIdx < thisRayI.used(); ++oIdx)
                {
                    if (!roughly_between(oppSpan.fStartT, thisRayI._get_fT(0, oIdx), oppSpan.fEndT)) continue;
                    const distSq = thisRayI.pt(index).distanceSquared(oppRayI.pt(oIdx));
                    if (closest > distSq) { closest = distSq; closeIndex = index; oppCloseIndex = oIdx; }
                }
            }
            if (closest === Number.MAX_VALUE) break;
            const oppIPt = thisRayI.pt(oppCloseIndex);
            const iPt    = oppRayI.pt(closeIndex);
            if (between(span.fStartT, oppRayI._get_fT(0, closeIndex), span.fEndT)
                && between(oppSpan.fStartT, thisRayI._get_fT(0, oppCloseIndex), oppSpan.fEndT)
                && Point.ApproximatelyEqual(oppIPt, iPt))
            {
                i.merge(oppRayI, closeIndex, thisRayI, oppCloseIndex);
                return i.used();
            }
            const distSq = oppIPt.distanceSquared(iPt);
            if (bestDistSq < distSq || ++loopCount > 5) return 0;
            bestDistSq = distSq;
            // Tangent refinement step.
            const oppStartT = oppRayI._get_fT(0, closeIndex);
            const t0 = this.fCurve.ptAtT(oppStartT);
            const v0 = this.fCurve.dxdyAtT(oppStartT);
            thisLine = new Line(t0, new Point(t0.fX + v0.fX, t0.fY + v0.fY));
            if (opp.fCurve.intersectRay(thisRayI, thisLine) === 0) break;
            const startT = thisRayI._get_fT(0, oppCloseIndex);
            const o0 = opp.fCurve.ptAtT(startT);
            const o1v = opp.fCurve.dxdyAtT(startT);
            oppLine = new Line(o0, new Point(o0.fX + o1v.fX, o0.fY + o1v.fY));
            if (this.fCurve.intersectRay(oppRayI, oppLine) === 0) break;
        }
        // Convergence fallback — perpendicular sampling.
        const oCoinS = new TCoincident();
        const oCoinE = new TCoincident();
        oCoinS.setPerp(opp.fCurve, oppSpan.fStartT, oppSpan.pointFirst(), this.fCurve);
        oCoinE.setPerp(opp.fCurve, oppSpan.fEndT,   oppSpan.pointLast(),  this.fCurve);
        let tStart = oCoinS.perpT();
        let tEnd   = oCoinE.perpT();
        const swap = tStart > tEnd;
        if (swap) { const tmp = tStart; tStart = tEnd; tEnd = tmp; }
        tStart = Math.max(tStart, span.fStartT);
        tEnd   = Math.min(tEnd,   span.fEndT);
        if (tStart > tEnd) return 0;
        let perpS: Vector;
        let perpE: Vector;
        if (tStart === span.fStartT)
        {
            const coinS = new TCoincident();
            coinS.setPerp(this.fCurve, span.fStartT, span.pointFirst(), opp.fCurve);
            perpS = span.pointFirst().sub(coinS.perpPt());
        }
        else if (swap) perpS = oCoinE.perpPt().sub(oppSpan.pointLast());
        else           perpS = oCoinS.perpPt().sub(oppSpan.pointFirst());
        if (tEnd === span.fEndT)
        {
            const coinE = new TCoincident();
            coinE.setPerp(this.fCurve, span.fEndT, span.pointLast(), opp.fCurve);
            perpE = span.pointLast().sub(coinE.perpPt());
        }
        else if (swap) perpE = oCoinS.perpPt().sub(oppSpan.pointFirst());
        else           perpE = oCoinE.perpPt().sub(oppSpan.pointLast());
        if (perpS.dot(perpE) >= 0) return 0;
        const coinW = new TCoincident();
        let workT = tStart;
        let tStep = tEnd - tStart;
        let workPt = this.fCurve.ptAtT(workT);
        while (true)
        {
            tStep *= 0.5;
            if (precisely_zero(tStep)) return 0;
            workT += tStep;
            workPt = this.fCurve.ptAtT(workT);
            coinW.setPerp(this.fCurve, workT, workPt, opp.fCurve);
            const perpT = coinW.perpT();
            if (coinW.isMatch() ? !between(oppSpan.fStartT, perpT, oppSpan.fEndT) : perpT < 0) continue;
            const perpW = workPt.sub(coinW.perpPt());
            if ((perpS.dot(perpW) >= 0) === (tStep < 0)) tStep = -tStep;
            if (Point.ApproximatelyEqual(workPt, coinW.perpPt())) break;
        }
        const oppTTest = coinW.perpT();
        if (opp.fHead === undefined || !opp.fHead.contains(oppTTest)) return 0;
        i.setMax(1);
        i.insert(workT, oppTTest, workPt);
        return 1;
    }

    // SkPathOpsTSect.cpp:1502
    public trim(span: TSpan, opp: TSect): boolean
    {
        if (!span.initBounds(this.fCurve)) return false;
        let testBounded = span.fBounded;
        while (testBounded !== undefined)
        {
            const test = testBounded.fBounded;
            const next = testBounded.fNext;
            const oppResult = { value: 0 };
            const sects = this.intersects(span, opp, test, oppResult);
            if (sects >= 1)
            {
                if (oppResult.value === 2)
                {
                    test.initBounds(opp.fCurve);
                    opp.removeAllBut(span, test, this);
                }
                if (sects === 2)
                {
                    span.initBounds(this.fCurve);
                    this.removeAllBut(test, span, opp);
                    return true;
                }
            }
            else
            {
                if (span.removeBounded(test)) this.removeSpan(span);
                if (test.removeBounded(span)) opp.removeSpan(test);
            }
            testBounded = next;
        }
        return true;
    }

    // SkPathOpsTSect.cpp:562
    public binarySearchCoin(
        sect2: TSect, tStart: number, tStep: number,
        result: { value: number }, oppT: { value: number }, oppFirst: { value: TSpan | undefined },
    ): boolean
    {
        const work = new TSpan(this.fCurve);
        work.fStartT = tStart; work.fEndT = tStart;
        let resultT = tStart;
        let last = this.fCurve.ptAtT(tStart);
        let oppPt = new Point(0, 0);
        let flip = false;
        let contained = false;
        const down = tStep < 0;
        const opp = sect2.fCurve;
        while (true)
        {
            tStep *= 0.5;
            work.fStartT += tStep;
            if (flip) { tStep = -tStep; flip = false; }
            work.initBounds(this.fCurve);
            if (work.fCollapsed) return false;
            if (Point.ApproximatelyEqual(last, work.pointFirst())) break;
            last = work.pointFirst();
            work.fCoinStart.setPerp(this.fCurve, work.fStartT, last, opp);
            if (work.fCoinStart.isMatch())
            {
                const oppTTest = work.fCoinStart.perpT();
                if (sect2.fHead !== undefined && sect2.fHead.contains(oppTTest))
                {
                    oppT.value = oppTTest;
                    oppPt = work.fCoinStart.perpPt();
                    contained = true;
                    if (down ? resultT <= work.fStartT : resultT >= work.fStartT)
                    {
                        oppFirst.value = undefined;
                        return false;
                    }
                    resultT = work.fStartT;
                    continue;
                }
            }
            tStep = -tStep;
            flip = true;
        }
        if (!contained) return false;
        if (Point.ApproximatelyEqual(last, this.fCurve.pt(0))) resultT = 0;
        else if (Point.ApproximatelyEqual(last, this.pointLast())) resultT = 1;
        if (Point.ApproximatelyEqual(oppPt, opp.pt(0))) oppT.value = 0;
        else if (Point.ApproximatelyEqual(oppPt, sect2.pointLast())) oppT.value = 1;
        result.value = resultT;
        return true;
    }

    public pointLast(): Point { return this.fCurve.pt(this.fCurve.pointLast()); }

    // SkPathOpsTSect.cpp:956
    public findCoincidentRun(first: TSpan | undefined, lastPtr: { value: TSpan | undefined }): TSpan | undefined
    {
        let work: TSpan | undefined = first;
        let lastCandidate: TSpan | undefined = undefined;
        let firstOut: TSpan | undefined = undefined;
        while (work !== undefined)
        {
            if (work.fCoinStart.isMatch())
            {
                if (!work.fCoinEnd.isMatch()) break;
                lastCandidate = work;
                if (firstOut === undefined) firstOut = work;
            }
            else if (firstOut !== undefined && work.fCollapsed)
            {
                lastPtr.value = lastCandidate;
                return firstOut;
            }
            else
            {
                lastCandidate = undefined;
            }
            if (work === lastPtr.value) return firstOut;
            work = work.fNext;
        }
        if (lastCandidate !== undefined) lastPtr.value = lastCandidate;
        return firstOut;
    }

    // SkPathOpsTSect.cpp:1269 — merge adjacent coincident spans when
    // their gap is itself coincident.
    public mergeCoincidence(sect2: TSect): void
    {
        let smallLimit = 0;
        while (true)
        {
            let smaller: TSpan | undefined = undefined;
            let test: TSpan | undefined = this.fCoincident;
            while (test !== undefined)
            {
                if (test.fStartT >= smallLimit
                    && !(smaller !== undefined && smaller.fEndT < test.fStartT))
                {
                    smaller = test;
                }
                test = test.fNext;
            }
            if (smaller === undefined) return;
            smallLimit = smaller.fEndT;
            let prior: TSpan | undefined = undefined;
            let larger: TSpan | undefined = undefined;
            let largerPrior: TSpan | undefined = undefined;
            test = this.fCoincident;
            while (test !== undefined)
            {
                if (test.fStartT >= smaller.fEndT
                    && !(larger !== undefined && larger.fStartT < test.fStartT))
                {
                    largerPrior = prior;
                    larger = test;
                }
                prior = test;
                test = test.fNext;
            }
            if (larger === undefined) continue;
            const midT = (smaller.fEndT + larger.fStartT) / 2;
            const midPt = this.fCurve.ptAtT(midT);
            const coin = new TCoincident();
            coin.setPerp(this.fCurve, midT, midPt, sect2.fCurve);
            if (coin.isMatch())
            {
                smaller.fEndT = larger.fEndT;
                smaller.fCoinEnd = larger.fCoinEnd;
                if (largerPrior !== undefined) largerPrior.fNext = larger.fNext;
                else                            this.fCoincident = larger.fNext;
            }
        }
    }

    // SkPathOpsTSect.cpp:685
    public coincidentForce(sect2: TSect, start1s: number, start1e: number): void
    {
        const first = this.fHead;
        const last  = this.tail();
        const oppFirst = sect2.fHead;
        const oppLast  = sect2.tail();
        if (last === undefined || oppLast === undefined || first === undefined || oppFirst === undefined) return;
        let del = this.updateBounded(first, last, oppFirst);
        if (sect2.updateBounded(oppFirst, oppLast, first)) del = true;
        this.removeSpanRange(first, last);
        sect2.removeSpanRange(oppFirst, oppLast);
        first.fStartT = start1s;
        first.fEndT   = start1e;
        first.resetBounds(this.fCurve);
        first.fCoinStart.setPerp(this.fCurve, start1s, this.fCurve.pt(0), sect2.fCurve);
        first.fCoinEnd  .setPerp(this.fCurve, start1e, this.pointLast(),   sect2.fCurve);
        const oppMatched = first.fCoinStart.perpT() < first.fCoinEnd.perpT();
        let oppStartT = first.fCoinStart.perpT() === -1 ? 0 : Math.max(0, first.fCoinStart.perpT());
        let oppEndT   = first.fCoinEnd.perpT()   === -1 ? 1 : Math.min(1, first.fCoinEnd.perpT());
        if (!oppMatched) { const tmp = oppStartT; oppStartT = oppEndT; oppEndT = tmp; }
        oppFirst.fStartT = oppStartT;
        oppFirst.fEndT   = oppEndT;
        oppFirst.resetBounds(sect2.fCurve);
        this.removeCoincident(first, false);
        sect2.removeCoincident(oppFirst, true);
        if (del) { this.deleteEmptySpans(); sect2.deleteEmptySpans(); }
    }

    // SkPathOpsTSect.cpp:837
    public extractCoincident(
        sect2: TSect,
        firstIn: TSpan | undefined, lastIn: TSpan | undefined,
        resultOut: { value: TSpan | undefined },
    ): boolean
    {
        const lastBox = { value: lastIn };
        let first = this.findCoincidentRun(firstIn, lastBox);
        const last = lastBox.value;
        if (first === undefined || last === undefined) { resultOut.value = undefined; return true; }
        const startT = first.fStartT;
        let oppStartT = 0, oppEndT = 0;
        const prev = first.fPrev;
        let oppFirst: TSpan | undefined = first.findOppT(first.fCoinStart.perpT());
        const oppMatched = first.fCoinStart.perpT() < first.fCoinEnd.perpT();
        let coinStart = first.fStartT;
        const cs = { value: 0 }, opp0 = { value: 0 }, oppFirstBox = { value: oppFirst };
        if (prev !== undefined && prev.fEndT === startT
            && this.binarySearchCoin(sect2, startT, prev.fStartT - startT, cs, opp0, oppFirstBox)
            && prev.fStartT < cs.value && cs.value < startT
            && prev.oppT(opp0.value) !== undefined)
        {
            oppFirst = prev.oppT(opp0.value);
            coinStart = cs.value;
            oppStartT = opp0.value;
            first = this.addSplitAt(prev, coinStart);
            first.markCoincident();
            prev.fCoinEnd.markCoincident();
            if (oppFirst !== undefined && oppFirst.fStartT < oppStartT && oppStartT < oppFirst.fEndT)
            {
                const oppHalf = sect2.addSplitAt(oppFirst, oppStartT);
                if (oppMatched)
                {
                    oppFirst.fCoinEnd.markCoincident();
                    oppHalf.markCoincident();
                    oppFirst = oppHalf;
                }
                else
                {
                    oppFirst.markCoincident();
                    oppHalf.fCoinStart.markCoincident();
                }
            }
        }
        else
        {
            if (oppFirst === undefined) return false;
        }
        let oppLast: TSpan | undefined = last.findOppT(last.fCoinEnd.perpT());
        if (oppLast === undefined) { resultOut.value = undefined; return true; }
        oppEndT = oppMatched ? oppLast.fEndT : oppLast.fStartT;
        if (!oppMatched) { const tmpS = oppFirst; oppFirst = oppLast; oppLast = tmpS;
                           const tmpT = oppStartT; oppStartT = oppEndT; oppEndT = tmpT; }
        if (oppFirst === undefined) { resultOut.value = undefined; return true; }
        if (oppLast === undefined)  { resultOut.value = undefined; return true; }
        let del = this.updateBounded(first, last, oppFirst);
        if (sect2.updateBounded(oppFirst, oppLast, first)) del = true;
        this.removeSpanRange(first, last);
        sect2.removeSpanRange(oppFirst, oppLast);
        first.fEndT = last.fEndT;
        first.resetBounds(this.fCurve);
        first.fCoinStart.setPerp(this.fCurve, first.fStartT, first.pointFirst(), sect2.fCurve);
        first.fCoinEnd  .setPerp(this.fCurve, first.fEndT,   first.pointLast(),  sect2.fCurve);
        oppStartT = first.fCoinStart.perpT();
        oppEndT   = first.fCoinEnd.perpT();
        if (between(0, oppStartT, 1) && between(0, oppEndT, 1))
        {
            if (!oppMatched) { const tmp = oppStartT; oppStartT = oppEndT; oppEndT = tmp; }
            oppFirst.fStartT = oppStartT;
            oppFirst.fEndT   = oppEndT;
            oppFirst.resetBounds(sect2.fCurve);
        }
        const after = first.fNext;
        if (!this.removeCoincident(first, false)) return false;
        if (!sect2.removeCoincident(oppFirst, true)) return false;
        if (del)
        {
            if (!this.deleteEmptySpans() || !sect2.deleteEmptySpans())
            {
                resultOut.value = undefined;
                return false;
            }
        }
        resultOut.value = (after !== undefined && !after.fDeleted
                           && this.fHead !== undefined && sect2.fHead !== undefined)
                          ? after : undefined;
        return true;
    }

    // SkPathOpsTSect.cpp:650
    public coincidentCheck(sect2: TSect): boolean
    {
        let first: TSpan | undefined = this.fHead;
        if (first === undefined) return false;
        while (first !== undefined)
        {
            const lastBox = { value: first };
            const consecutive = this.countConsecutiveSpans(first, lastBox);
            const last: TSpan = lastBox.value;
            const next = last.fNext;
            if (consecutive < COINCIDENT_SPAN_COUNT) { first = next; continue; }
            this.computePerpendiculars(sect2, first, last);
            // Sweep across the coincident range, extracting one piece at a time.
            const coinStart = { value: first as TSpan | undefined };
            while (coinStart.value !== undefined && !last.fDeleted)
            {
                const ok = this.extractCoincident(sect2, coinStart.value, last, coinStart);
                if (!ok) return false;
            }
            if (this.fHead === undefined || sect2.fHead === undefined) break;
            if (next === undefined || next.fDeleted) break;
            first = next;
        }
        return true;
    }

    // SkPathOpsTSect.cpp:1617
    public static EndsEqual(sect1: TSect, sect2: TSect, intersections: Intersections): number
    {
        const KZeroS1Set = 1, KOneS1Set = 2, KZeroS2Set = 4, KOneS2Set = 8;
        let zeroOneSet = 0;
        const a0 = sect1.fCurve.pt(0);
        const b0 = sect2.fCurve.pt(0);
        const aL = sect1.pointLast();
        const bL = sect2.pointLast();
        if (a0.equals(b0)) { zeroOneSet |= KZeroS1Set | KZeroS2Set; intersections.insert(0, 0, a0); }
        if (a0.equals(bL)) { zeroOneSet |= KZeroS1Set | KOneS2Set;  intersections.insert(0, 1, a0); }
        if (aL.equals(b0)) { zeroOneSet |= KOneS1Set  | KZeroS2Set; intersections.insert(1, 0, aL); }
        if (aL.equals(bL)) { zeroOneSet |= KOneS1Set  | KOneS2Set;  intersections.insert(1, 1, aL); }
        if (!(zeroOneSet & (KZeroS1Set | KZeroS2Set)) && Point.ApproximatelyEqual(a0, b0))
        { zeroOneSet |= KZeroS1Set | KZeroS2Set; intersections.insertNear(0, 0, a0, b0); }
        if (!(zeroOneSet & (KZeroS1Set | KOneS2Set))  && Point.ApproximatelyEqual(a0, bL))
        { zeroOneSet |= KZeroS1Set | KOneS2Set;  intersections.insertNear(0, 1, a0, bL); }
        if (!(zeroOneSet & (KOneS1Set  | KZeroS2Set)) && Point.ApproximatelyEqual(aL, b0))
        { zeroOneSet |= KOneS1Set  | KZeroS2Set; intersections.insertNear(1, 0, aL, b0); }
        if (!(zeroOneSet & (KOneS1Set  | KOneS2Set))  && Point.ApproximatelyEqual(aL, bL))
        { zeroOneSet |= KOneS1Set  | KOneS2Set;  intersections.insertNear(1, 1, aL, bL); }
        return zeroOneSet;
    }

    // SkPathOpsTSect.cpp:1791 — the main recursive driver. Pairs two
    // TSects, repeatedly bisecting the larger span until convergence,
    // running coincidence detection + perpendicular refinement + tail
    // probes, and emitting results into `intersections`.
    public static BinarySearch(sect1: TSect, sect2: TSect, intersections: Intersections): void
    {
        const KZeroS1Set = 1, KOneS1Set = 2, KZeroS2Set = 4, KOneS2Set = 8;
        intersections.reset();
        intersections.setMax(sect1.fCurve.maxIntersections() + 4);
        const span1 = sect1.fHead!;
        const span2 = sect2.fHead!;
        const oppRes = { value: 0 };
        const sect = sect1.intersects(span1, sect2, span2, oppRes);
        if (sect === 0) return;
        if (sect === 2 && oppRes.value === 2) { TSect.EndsEqual(sect1, sect2, intersections); return; }
        span1.addBounded(span2);
        span2.addBounded(span1);
        const kMaxCoinLoopCount = 8;
        let coinLoopCount = kMaxCoinLoopCount;
        let start1s = 0, start1e = 0;
        let iters = 0;
        while (true)
        {
            if (++iters > 5000) break; // safety net
            const largest1 = sect1.boundsMax();
            if (largest1 === undefined) { if (sect1.fHung) return; break; }
            const largest2 = sect2.boundsMax();
            if (largest2 === undefined
                || (largest1.fBoundsMax > largest2.fBoundsMax
                    || (!largest1.fCollapsed && largest2.fCollapsed)))
            {
                if (sect2.fHung) return;
                if (largest1.fCollapsed) break;
                sect1.resetRemovedEnds();
                sect2.resetRemovedEnds();
                const half1 = sect1.addOne();
                if (!half1.split(largest1)) break;
                if (!sect1.trim(largest1, sect2)) return;
                if (!sect1.trim(half1,    sect2)) return;
            }
            else
            {
                if (largest2.fCollapsed) break;
                sect1.resetRemovedEnds();
                sect2.resetRemovedEnds();
                const half2 = sect2.addOne();
                if (!half2.split(largest2)) break;
                if (!sect2.trim(largest2, sect1)) return;
                if (!sect2.trim(half2,    sect1)) return;
            }
            // Coincidence sweep when both sides exceed the threshold.
            if (sect1.fActiveCount >= COINCIDENT_SPAN_COUNT
                && sect2.fActiveCount >= COINCIDENT_SPAN_COUNT)
            {
                if (coinLoopCount === kMaxCoinLoopCount)
                {
                    start1s = sect1.fHead!.fStartT;
                    start1e = sect1.tail()!.fEndT;
                }
                if (!sect1.coincidentCheck(sect2)) return;
                if (!--coinLoopCount && sect1.fHead !== undefined && sect2.fHead !== undefined)
                {
                    sect1.coincidentForce(sect2, start1s, start1e);
                }
            }
            if (sect1.fActiveCount >= COINCIDENT_SPAN_COUNT
                && sect2.fActiveCount >= COINCIDENT_SPAN_COUNT)
            {
                if (sect1.fHead === undefined) return;
                sect1.computePerpendiculars(sect2, sect1.fHead, sect1.tail());
                if (sect2.fHead === undefined) return;
                sect2.computePerpendiculars(sect1, sect2.fHead, sect2.tail());
                if (!sect1.removeByPerpendicular(sect2)) return;
                if (sect1.collapsed() > sect1.fCurve.maxIntersections()) break;
            }
            if (sect1.fHead === undefined || sect2.fHead === undefined) break;
        }
        // Coincident-tail emission.
        let coincident = sect1.fCoincident;
        if (coincident !== undefined)
        {
            if (coincident.fNext !== undefined) { sect1.mergeCoincidence(sect2); coincident = sect1.fCoincident; }
            while (coincident !== undefined)
            {
                if (coincident.fCoinStart.isMatch() && coincident.fCoinEnd.isMatch())
                {
                    const perpT = coincident.fCoinStart.perpT();
                    if (perpT < 0) return;
                    const index = intersections.insertCoincident(coincident.fStartT, perpT, coincident.pointFirst());
                    if (intersections.insertCoincident(coincident.fEndT, coincident.fCoinEnd.perpT(),
                                                       coincident.pointLast()) < 0 && index >= 0)
                    {
                        intersections.clearCoincidence(index);
                    }
                }
                coincident = coincident.fNext;
            }
        }
        const zeroOneSet = TSect.EndsEqual(sect1, sect2, intersections);
        // Pin to t=0/1 on each side when the bisection found and then
        // removed an endpoint touch.
        if (sect1.fRemovedStartT && !(zeroOneSet & KZeroS1Set))
        {
            const perp = new TCoincident();
            perp.setPerp(sect1.fCurve, 0, sect1.fCurve.pt(0), sect2.fCurve);
            if (perp.isMatch()) intersections.insert(0, perp.perpT(), perp.perpPt());
        }
        if (sect1.fRemovedEndT && !(zeroOneSet & KOneS1Set))
        {
            const perp = new TCoincident();
            perp.setPerp(sect1.fCurve, 1, sect1.pointLast(), sect2.fCurve);
            if (perp.isMatch()) intersections.insert(1, perp.perpT(), perp.perpPt());
        }
        if (sect2.fRemovedStartT && !(zeroOneSet & KZeroS2Set))
        {
            const perp = new TCoincident();
            perp.setPerp(sect2.fCurve, 0, sect2.fCurve.pt(0), sect1.fCurve);
            if (perp.isMatch()) intersections.insert(perp.perpT(), 0, perp.perpPt());
        }
        if (sect2.fRemovedEndT && !(zeroOneSet & KOneS2Set))
        {
            const perp = new TCoincident();
            perp.setPerp(sect2.fCurve, 1, sect2.pointLast(), sect1.fCurve);
            if (perp.isMatch()) intersections.insert(perp.perpT(), 1, perp.perpPt());
        }
        if (sect1.fHead === undefined || sect2.fHead === undefined) return;
        sect1.recoverCollapsed();
        sect2.recoverCollapsed();
        // Tail probes at unbounded heads / tails.
        let result1: TSpan | undefined = sect1.fHead;
        if (!(zeroOneSet & KZeroS1Set) && result1 !== undefined
            && approximately_less_than_zero(result1.fStartT))
        {
            const start1 = sect1.fCurve.pt(0);
            if (result1.isBounded())
            {
                const t = result1.closestBoundedT(start1);
                if (Point.ApproximatelyEqual(sect2.fCurve.ptAtT(t), start1))
                    intersections.insert(0, t, start1);
            }
        }
        const head2 = sect2.fHead;
        if (!(zeroOneSet & KZeroS2Set) && head2 !== undefined
            && approximately_less_than_zero(head2.fStartT))
        {
            const start2 = sect2.fCurve.pt(0);
            if (head2.isBounded())
            {
                const t = head2.closestBoundedT(start2);
                if (Point.ApproximatelyEqual(sect1.fCurve.ptAtT(t), start2))
                    intersections.insert(t, 0, start2);
            }
        }
        if (!(zeroOneSet & KOneS1Set))
        {
            const tail1 = sect1.tail();
            if (tail1 === undefined) return;
            if (approximately_greater_than_one(tail1.fEndT))
            {
                const end1 = sect1.pointLast();
                if (tail1.isBounded())
                {
                    const t = tail1.closestBoundedT(end1);
                    if (Point.ApproximatelyEqual(sect2.fCurve.ptAtT(t), end1))
                        intersections.insert(1, t, end1);
                }
            }
        }
        if (!(zeroOneSet & KOneS2Set))
        {
            const tail2 = sect2.tail();
            if (tail2 === undefined) return;
            if (approximately_greater_than_one(tail2.fEndT))
            {
                const end2 = sect2.pointLast();
                if (tail2.isBounded())
                {
                    const t = tail2.closestBoundedT(end2);
                    if (Point.ApproximatelyEqual(sect1.fCurve.ptAtT(t), end2))
                        intersections.insert(t, 1, end2);
                }
            }
        }
        // Closest-pair pass over remaining (non-coincident) spans —
        // simplified vs the SkClosestSect struct in upstream (we don't
        // need the multi-merge optimisation for the result set sizes
        // we deal with).
        const candidates: { c1: TSpan; c2: TSpan; pt: Point; c1t: number; c2t: number; dist: number }[] = [];
        while (result1 !== undefined
            && result1.fCoinStart.isMatch() && result1.fCoinEnd.isMatch())
        {
            result1 = result1.fNext;
        }
        let walker1 = result1;
        while (walker1 !== undefined)
        {
            let walker2: TSpan | undefined = sect2.fHead;
            while (walker2 !== undefined)
            {
                considerEndPair(walker1, walker2, candidates);
                walker2 = walker2.fNext;
            }
            walker1 = walker1.fNext;
        }
        candidates.sort((a, b) => a.dist - b.dist);
        for (const c of candidates) intersections.insert(c.c1t, c.c2t, c.pt);
        // Last pass — promote pairs of adjacent intersection points to
        // coincident when their midpoint is also on the opposite curve.
        let lastIdx = intersections.used() - 1;
        for (let index = 0; index < lastIdx; )
        {
            if (intersections.isCoincident(index) && intersections.isCoincident(index + 1)) { ++index; continue; }
            const midT = (intersections._get_fT(0, index) + intersections._get_fT(0, index + 1)) / 2;
            const midPt = sect1.fCurve.ptAtT(midT);
            const perp = new TCoincident();
            perp.setPerp(sect1.fCurve, midT, midPt, sect2.fCurve);
            if (!perp.isMatch()) { ++index; continue; }
            if (intersections.isCoincident(index))     { intersections.removeOne(index);     --lastIdx; }
            else if (intersections.isCoincident(index + 1)) { intersections.removeOne(index + 1); --lastIdx; }
            else                                        { intersections.setCoincident(index++); }
            intersections.setCoincident(index);
        }
    }

    public resetRemovedEnds(): void
    {
        this.fRemovedStartT = false;
        this.fRemovedEndT = false;
    }

    // ── Span allocation / linking ──────────────────────────────────

    // SkPathOpsTSect.cpp:533 — fresh span. The C++ recycles from a
    // freelist; TS relies on GC and just allocates.
    public addOne(): TSpan
    {
        const result = new TSpan(this.fCurve);
        result.reset();
        result.fHasPerp = false;
        result.fDeleted = false;
        ++this.fActiveCount;
        return result;
    }

    // SkPathOpsTSect.cpp:70 — append a new span after `prior` (or at
    // the head if prior is undefined). Bounds inherit from the new
    // span's [startT, endT] window.
    public addFollowing(prior: TSpan | undefined): TSpan
    {
        const result = this.addOne();
        result.fStartT = prior !== undefined ? prior.fEndT : 0;
        const next: TSpan | undefined = prior !== undefined ? prior.fNext : this.fHead;
        result.fEndT = next !== undefined ? next.fStartT : 1;
        result.fPrev = prior;
        result.fNext = next;
        if (prior !== undefined) prior.fNext = result;
        else                     this.fHead = result;
        if (next !== undefined) next.fPrev = result;
        result.resetBounds(this.fCurve);
        return result;
    }

    // SkPathOpsTSect.cpp:630 — span with the largest fBoundsMax.
    // Returns undefined if a span-chain cycle is detected (sets fHung).
    public boundsMax(): TSpan | undefined
    {
        let test: TSpan | undefined = this.fHead;
        if (test === undefined) return undefined;
        let largest: TSpan = test;
        let lCollapsed = largest.fCollapsed;
        let safetyNet = 10000;
        while ((test = test.fNext) !== undefined)
        {
            if (--safetyNet === 0)
            {
                this.fHung = true;
                return undefined;
            }
            const tCollapsed = test.fCollapsed;
            if ((lCollapsed && !tCollapsed)
                || (lCollapsed === tCollapsed && largest.fBoundsMax < test.fBoundsMax))
            {
                largest = test;
                lCollapsed = test.fCollapsed;
            }
        }
        return largest;
    }

    // SkPathOpsTSect.cpp:1484 — the span with the largest endT.
    public tail(): TSpan | undefined
    {
        let result: TSpan | undefined = this.fHead;
        if (result === undefined) return undefined;
        let next: TSpan | undefined = this.fHead;
        let safetyNet = 100000;
        while ((next = next!.fNext) !== undefined)
        {
            if (--safetyNet === 0) return undefined;
            if (next.fEndT > result.fEndT) result = next;
        }
        return result;
    }

    // SkPathOpsTSect.cpp:1328 — walk from head until we reach `span`;
    // return the preceding span (undefined if span === fHead).
    public prev(span: TSpan): TSpan | undefined
    {
        let result: TSpan | undefined = undefined;
        let test: TSpan | undefined = this.fHead;
        while (span !== test)
        {
            result = test;
            test = test!.fNext;
            if (test === undefined) throw new Error('TSect.prev: span not in chain');
        }
        return result;
    }

    // SkPathOpsTSect.cpp:721 — does any active span contain t?
    public coincidentHasT(t: number): boolean
    {
        let test: TSpan | undefined = this.fCoincident;
        while (test !== undefined)
        {
            if (between(test.fStartT, t, test.fEndT)) return true;
            test = test.fNext;
        }
        return false;
    }

    // SkPathOpsTSect.cpp:732 — count of fully-collapsed spans (used by
    // the engine to decide whether to give up).
    public collapsed(): number
    {
        let result = 0;
        let test: TSpan | undefined = this.fHead;
        while (test !== undefined)
        {
            if (test.fCollapsed) ++result;
            test = test.fNext;
        }
        return result;
    }

    // SkPathOpsTSect.cpp:787 — count consecutive spans starting at
    // `first`. Writes the tail of the run into `lastOut`.
    public countConsecutiveSpans(first: TSpan, lastOut: { value: TSpan }): number
    {
        let consecutive = 1;
        let last: TSpan = first;
        while (true)
        {
            const next: TSpan | undefined = last.fNext;
            if (next === undefined) break;
            if (next.fStartT !== last.fEndT) break;
            ++consecutive;
            last = next;
        }
        lastOut.value = last;
        return consecutive;
    }

    public hasBounded(span: TSpan): boolean
    {
        // SkPathOpsTSect.cpp:806 — scan all spans for one that bounds
        // `span`. Simple linear search.
        let test: TSpan | undefined = this.fHead;
        while (test !== undefined)
        {
            if (test.findOppSpan(span) !== undefined) return true;
            test = test.fNext;
        }
        return false;
    }
}

// ── Curve-pair entry points on Intersections ───────────────────────
//
// SkPathOpsTSect.cpp:2098 onwards — the public Skia entry points that
// wrap each (curve, curve) pair in a fresh pair of SkTSects and call
// BinarySearch. Installed on the Intersections class via TypeScript
// module augmentation (same pattern as quad-line / cubic-line).

declare module './intersections.js'
{
    interface Intersections
    {
        intersectQuadQuad(q1: Quad, q2: Quad): number;
        intersectCubicCubic(c1: Cubic, c2: Cubic): number;
        intersectCubicQuad(c: Cubic, q: Quad): number;
    }
}

Intersections.prototype.intersectQuadQuad = function (q1: Quad, q2: Quad): number
{
    const sect1 = new TSect(new TQuad(q1));
    const sect2 = new TSect(new TQuad(q2));
    TSect.BinarySearch(sect1, sect2, this);
    return this.used();
};

Intersections.prototype.intersectCubicCubic = function (c1: Cubic, c2: Cubic): number
{
    const sect1 = new TSect(new TCubic(c1));
    const sect2 = new TSect(new TCubic(c2));
    TSect.BinarySearch(sect1, sect2, this);
    return this.used();
};

Intersections.prototype.intersectCubicQuad = function (c: Cubic, q: Quad): number
{
    const sect1 = new TSect(new TCubic(c));
    const sect2 = new TSect(new TQuad(q));
    TSect.BinarySearch(sect1, sect2, this);
    return this.used();
};

// SkClosestRecord/SkClosestSect simplified — for our use we just collect
// (c1, c2, point, c1t, c2t, dist) candidate tuples from each end-pair of
// span1×span2 and sort by distance at the end. SkClosestSect's
// merge/update optimisation matters at very large coincidence runs; for
// our diagram-scale inputs the plain list works.
function considerEndPair(
    span1: TSpan, span2: TSpan,
    out: { c1: TSpan; c2: TSpan; pt: Point; c1t: number; c2t: number; dist: number }[],
): void
{
    const sides1 = [span1.fPart.pt(0), span1.fPart.pt(span1.fPart.pointLast())];
    const t1     = [span1.fStartT, span1.fEndT];
    const sides2 = [span2.fPart.pt(0), span2.fPart.pt(span2.fPart.pointLast())];
    const t2     = [span2.fStartT, span2.fEndT];
    for (let i = 0; i < 2; ++i)
    {
        for (let j = 0; j < 2; ++j)
        {
            if (Point.ApproximatelyEqual(sides1[i]!, sides2[j]!))
            {
                const dist = sides1[i]!.distanceSquared(sides2[j]!);
                out.push({ c1: span1, c2: span2, pt: sides1[i]!, c1t: t1[i]!, c2t: t2[j]!, dist });
            }
        }
    }
}
