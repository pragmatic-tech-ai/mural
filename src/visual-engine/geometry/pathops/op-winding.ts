// Copyright 2015 Google Inc.
//
// Use of this source code is governed by a BSD-style license that can
// be found in the LICENSE-skia file at the root of this repository.
//
// TypeScript port: 2026 Eugene Napryaglo.
// Source: third_party/skia/src/pathops/SkPathOpsWinding.cpp
//         (Skia commit pinned in third_party/skia)
//
// Phase 6 chunk 5 (final step) — winding-from-zero. After intersections
// and coincidence have been resolved, some spans still carry windSum =
// SK_MinS32 (unknown). The walker can't proceed until those have
// authoritative windings. Skia's strategy: pick an undone span, shoot
// the most-perpendicular ray (kLeft, kTop, kRight, or kBottom) through
// it, count the signed crossings of every other segment in winding
// order, and stamp the result back via markAndChaseWinding.
//
// What this file ports:
//   * OpRayDir enum + helper geometry tables (xy_index / pt_xy / pt_yx
//     / pt_dxdy / pt_dydx / rect_side / sideways_overlap / less_than
//     / ccw_dxdy)
//   * OpRayHit struct (the per-hit record) + makeTestBase helper
//   * OpSegment.rayCheck — cast a ray through a segment, collect hits
//   * OpContour.rayCheck — fan over segments
//   * OpSegment.windingSpanAtT — find the span containing parameter t
//   * OpSegment.findSortableTop — first span on a segment whose winding
//     we can propagate
//   * OpContour.findSortableTop — fan over segments
//   * OpSpan.sortableTop — actual ray-cast + winding-stamp
//   * OpSpan.computeWindSum — loop sortableTop up to kMaxWindingTries
//   * FindSortableTop — outer driver across all contours
//
// Tables that aren't in this port:
//   * Skia's path-ops driver also calls SkDPoint::ApproximatelyEqual
//     between hit points; mural uses Point.equals which is exact —
//     close enough for the FindSortableTop heuristic.

import { Cubic } from './cubic.js';
import { Point } from './point.js';
import { Quad } from './quad.js';
import { Rect } from './rect.js';
import {
    approximately_between,
    approximately_equal,
    approximately_zero,
    roughly_equal,
} from './types.js';
import { OpAngle } from './op-angle.js';
import { OpPhase } from './op-global-state.js';
import { OpSpan, OpSpanBase, SK_MIN_S32 } from './op-span.js';
import { OpSegment } from './op-segment.js';
import { OpContour, OpContourHead } from './op-contour.js';
import { OpVerb, verbToPoints } from './op-fwd.js';
import { HorizontalInterceptCubic, VerticalInterceptCubic } from './cubic-line-intersection.js';
import { HorizontalInterceptQuad,  VerticalInterceptQuad  } from './quad-line-intersection.js';

// SkPathOpsWinding.cpp:48 — four cardinal scan-line directions.
export enum OpRayDir
{
    kLeft   = 0,
    kTop    = 1,
    kRight  = 2,
    kBottom = 3,
}

const kMaxWindingTries = 10;

// SkPathOpsWinding.cpp:64-101 — direction-indexed accessors that pick
// axes out of (x, y) tuples and rect sides.

function xy_index(dir: OpRayDir): number { return dir & 1; }

function pt_xy(pt: Point, dir: OpRayDir): number
{
    return xy_index(dir) === 0 ? pt.fX : pt.fY;
}

function pt_yx(pt: Point, dir: OpRayDir): number
{
    return xy_index(dir) === 0 ? pt.fY : pt.fX;
}

function pt_dxdy(v: { fX?: number; fY?: number; x?: number; y?: number }, dir: OpRayDir): number
{
    const x = v.fX !== undefined ? v.fX : v.x!;
    const y = v.fY !== undefined ? v.fY : v.y!;
    return xy_index(dir) === 0 ? x : y;
}

function pt_dydx(v: { fX?: number; fY?: number; x?: number; y?: number }, dir: OpRayDir): number
{
    const x = v.fX !== undefined ? v.fX : v.x!;
    const y = v.fY !== undefined ? v.fY : v.y!;
    return xy_index(dir) === 0 ? y : x;
}

function rect_side(r: Rect, dir: OpRayDir): number
{
    switch (dir)
    {
        case OpRayDir.kLeft:   return r.fLeft;
        case OpRayDir.kTop:    return r.fTop;
        case OpRayDir.kRight:  return r.fRight;
        case OpRayDir.kBottom: return r.fBottom;
    }
}

function sideways_overlap(rect: Rect, pt: Point, dir: OpRayDir): boolean
{
    const i = 1 - xy_index(dir);
    const lo = i === 0 ? rect.fLeft : rect.fTop;
    const hi = i === 0 ? rect.fRight : rect.fBottom;
    const x  = i === 0 ? pt.fX     : pt.fY;
    return approximately_between(lo, x, hi);
}

function less_than(dir: OpRayDir): boolean { return (dir & 2) === 0; }

function ccw_dxdy(v: { x: number; y: number }, dir: OpRayDir): boolean
{
    const vPartPos = pt_dydx(v, dir) > 0;
    const leftBottom = ((dir + 1) & 2) !== 0;
    return vPartPos === leftBottom;
}

// SkPathOpsWinding.cpp:103.
export class OpRayHit
{
    public fNext: OpRayHit | undefined = undefined;
    public fSpan: OpSpan   | undefined = undefined;
    public fPt:   Point   = new Point();
    public fT:    number  = 0;
    public fSlope: { x: number; y: number } = { x: 0, y: 0 };
    public fValid: boolean = false;

    public makeTestBase(span: OpSpan, t: number): OpRayDir
    {
        this.fNext = undefined;
        this.fSpan = span;
        this.fT    = span.t() * (1 - t) + span.next().t() * t;
        const segment = span.segment() as OpSegment;
        this.fSlope = segment.dSlopeAtT(this.fT);
        this.fPt    = segment.ptAtT(this.fT);
        this.fValid = true;
        return Math.abs(this.fSlope.x) < Math.abs(this.fSlope.y)
            ? OpRayDir.kLeft : OpRayDir.kTop;
    }
}

// CurveIntercept dispatch — returns up to 3 t-values where the curve
// crosses the scan-line at `axisIntercept` (x = axisIntercept for
// vertical scan; y = axisIntercept for horizontal scan).
function curveIntercept(verb: OpVerb, pts: readonly Point[], _weight: number,
                         axisIntercept: number, dirIsHoriz: boolean,
                         roots: number[]): number
{
    switch (verb)
    {
        case OpVerb.kLine:
        {
            // Line: solve y = a + bt for t at given y (or x for vertical).
            const p0 = pts[0]!, p1 = pts[1]!;
            const base = dirIsHoriz ? p0.fY : p0.fX;
            const diff = dirIsHoriz ? p1.fY - p0.fY : p1.fX - p0.fX;
            if (approximately_zero(diff)) return 0;
            const t = (axisIntercept - base) / diff;
            if (!(t > 0 && t < 1) && !approximately_zero(t) && !approximately_equal(t, 1)) return 0;
            roots[0] = t < 0 ? 0 : t > 1 ? 1 : t;
            return 1;
        }
        case OpVerb.kQuad:
        {
            const q = new Quad();
            q.fPts = [pts[0]!, pts[1]!, pts[2]!];
            return dirIsHoriz
                ? HorizontalInterceptQuad(q, axisIntercept, roots)
                : VerticalInterceptQuad(q, axisIntercept, roots);
        }
        case OpVerb.kCubic:
        {
            const c = new Cubic();
            c.fPts = [pts[0]!, pts[1]!, pts[2]!, pts[3]!];
            return dirIsHoriz
                ? HorizontalInterceptCubic(c, axisIntercept, roots)
                : VerticalInterceptCubic(c, axisIntercept, roots);
        }
        default:
            return 0;
    }
}

// SkPathOpsWinding.cpp:138 — module-augmentation: install rayCheck on
// OpSegment's prototype so OpContour can reach it via the OpSegment
// methods we already export.

declare module './op-segment.js'
{
    interface OpSegment
    {
        rayCheck(base: OpRayHit, dir: OpRayDir, hitsRef: { value: OpRayHit | undefined }): void;
    }
}

OpSegment.prototype.rayCheck = function(this: OpSegment,
                                         base: OpRayHit, dir: OpRayDir,
                                         hitsRef: { value: OpRayHit | undefined }): void
{
    if (!sideways_overlap(this.fBounds, base.fPt, dir)) return;
    const baseXY   = pt_xy(base.fPt, dir);
    const boundsXY = rect_side(this.fBounds, dir);
    const checkLessThan = less_than(dir);
    if (!approximately_equal(baseXY, boundsXY) && (baseXY < boundsXY) === checkLessThan) return;
    const tVals: number[] = [0, 0, 0];
    const baseYX = pt_yx(base.fPt, dir);
    // §19.7 engine fix — the `dirIsHoriz` argument to curveIntercept
    // is "is the scan line a horizontal slice at axisIntercept Y" (i.e.
    // solve `y(t) = axisIntercept`). For an x-axis ray (kLeft / kRight),
    // axisIntercept IS a y value → dirIsHoriz = true → xy_index === 0
    // matches. For a y-axis ray (kTop / kBottom), axisIntercept is an x
    // value → dirIsHoriz = false → xy_index === 1 matches. The port
    // previously passed `!dirIsHoriz` here, inverting the dispatch:
    // horizontal lines with diff.Y = 0 returned 0 roots when scanned
    // by a vertical ray, so the walker missed A-vs-B crossings during
    // sortableTop and all of B's spans got bogus oppSum = 0.
    const dirIsHoriz = xy_index(dir) === 0;
    const roots = curveIntercept(this.fVerb, this.fPts, this.fWeight, baseYX,
                                  dirIsHoriz, tVals);
    for (let index = 0; index < roots; ++index)
    {
        const t = tVals[index]!;
        if ((base.fSpan!.segment() as OpSegment) === this
            && approximately_equal(base.fT, t)) continue;
        let slope: { x: number; y: number } = { x: 0, y: 0 };
        let pt: Point;
        let valid = false;
        if (approximately_zero(t))
        {
            pt = this.fPts[0]!;
        }
        else if (approximately_equal(t, 1))
        {
            pt = this.fPts[verbToPoints(this.fVerb)]!;
        }
        else
        {
            pt = this.ptAtT(t);
            if (pt.equals(base.fPt))
            {
                if ((base.fSpan!.segment() as OpSegment) === this) continue;
            }
            else
            {
                const ptXY = pt_xy(pt, dir);
                if (!approximately_equal(baseXY, ptXY) && (baseXY < ptXY) === checkLessThan) continue;
                slope = this.dSlopeAtT(t);
                if (this.fVerb === OpVerb.kCubic
                    && (base.fSpan!.segment() as OpSegment) === this
                    && roughly_equal(base.fT, t)
                    && pt.equals(base.fPt))
                {
                    continue;
                }
                if (Math.abs(pt_dydx(slope, dir) * 10000) > Math.abs(pt_dxdy(slope, dir)))
                {
                    valid = true;
                }
            }
        }
        const span = this.windingSpanAtT(t);
        if (span === undefined)
        {
            valid = false;
        }
        else if (span.windValue() === 0 && span.oppValue() === 0)
        {
            continue;
        }
        const hit = new OpRayHit();
        hit.fNext = hitsRef.value;
        hit.fPt = pt;
        hit.fSlope = slope;
        hit.fSpan = span;
        hit.fT = t;
        hit.fValid = valid;
        hitsRef.value = hit;
    }
};

// OpSegment.windingSpanAtT — walk the chain, return the OpSpan whose
// [t, next.t) interval contains tHit.
declare module './op-segment.js'
{
    interface OpSegment
    {
        _windingSpanAtTImpl(tHit: number): OpSpan | undefined;
    }
}

OpSegment.prototype._windingSpanAtTImpl = function(this: OpSegment, tHit: number): OpSpan | undefined
{
    let span: OpSpan = this.fHead;
    let next: OpSpanBase;
    for (;;)
    {
        next = span.next();
        if (approximately_equal(tHit, next.t())) return undefined;
        if (tHit < next.t()) return span;
        if (next.final()) break;
        span = next.upCast();
    }
    return undefined;
};

// OpSegment.findSortableTop — first span whose winding can propagate.
declare module './op-segment.js'
{
    interface OpSegment
    {
        _findSortableTopImpl(contourHead: OpContourHead): OpSpan | undefined;
    }
}

OpSegment.prototype._findSortableTopImpl = function(this: OpSegment, contourHead: OpContourHead): OpSpan | undefined
{
    let span: OpSpan = this.fHead;
    let next: OpSpanBase;
    for (;;)
    {
        next = span.next();
        if (!span.done())
        {
            if (span.windSum() !== SK_MIN_S32) return span;
            if (span.sortableTop(contourHead)) return span;
        }
        if (next.final()) break;
        span = next.upCast();
    }
    return undefined;
};

// ── OpContour.rayCheck + findSortableTop ─────────────────────────

declare module './op-contour.js'
{
    interface OpContour
    {
        rayCheck(base: OpRayHit, dir: OpRayDir, hitsRef: { value: OpRayHit | undefined }): void;
        findSortableTop(contourHead: OpContourHead): OpSpan | undefined;
    }
}

OpContour.prototype.rayCheck = function(this: OpContour,
                                         base: OpRayHit, dir: OpRayDir,
                                         hitsRef: { value: OpRayHit | undefined }): void
{
    const baseXY   = pt_xy(base.fPt, dir);
    const boundsXY = rect_side(this.fBounds, dir);
    const checkLessThan = less_than(dir);
    if (!approximately_equal(baseXY, boundsXY) && (baseXY < boundsXY) === checkLessThan) return;
    let segment: OpSegment | undefined = this.fHead;
    while (segment !== undefined)
    {
        segment.rayCheck(base, dir, hitsRef);
        segment = segment.next();
    }
};

OpContour.prototype.findSortableTop = function(this: OpContour,
                                                contourHead: OpContourHead): OpSpan | undefined
{
    let allDone = true;
    if (this.fCount)
    {
        let testSegment: OpSegment | undefined = this.fHead;
        while (testSegment !== undefined)
        {
            if (!testSegment.done())
            {
                allDone = false;
                const result = testSegment.findSortableTop(contourHead);
                if (result !== undefined) return result;
            }
            testSegment = testSegment.next();
        }
    }
    if (allDone) this.fDone = true;
    return undefined;
};

// ── OpSpan.sortableTop + computeWindSum ──────────────────────────

declare module './op-span.js'
{
    interface OpSpan
    {
        sortableTop(contourHead: OpContourHead): boolean;
        computeWindSum(): number;
    }
}

// SkPathOpsWinding.cpp:239 — adaptive t-guess so we don't ray-cast
// through degenerate features over and over.
function getTGuess(tTry: number, dirOffsetOut: { value: number }): number
{
    let t = 0.5;
    dirOffsetOut.value = tTry & 1;
    const tBase = tTry >> 1;
    let tBits = 0;
    let tTryShifted = tTry;
    while ((tTryShifted >>= 1) !== 0)
    {
        t /= 2;
        ++tBits;
    }
    if (tBits)
    {
        const tIndex = (tBase - 1) & ((1 << tBits) - 1);
        t += t * 2 * tIndex;
    }
    return t;
}

OpSpan.prototype.sortableTop = function(this: OpSpan, contourHead: OpContourHead): boolean
{
    const dirOffset = { value: 0 };
    const t = getTGuess(this.fTopTTry++, dirOffset);
    const hitBase = new OpRayHit();
    let dir = hitBase.makeTestBase(this, t);
    if (hitBase.fSlope.x === 0 && hitBase.fSlope.y === 0) return false;
    const hitsRef: { value: OpRayHit | undefined } = { value: hitBase };
    dir = (dir + dirOffset.value) as OpRayDir;
    if (hitBase.fSpan !== undefined
        && (hitBase.fSpan.segment() as OpSegment).verb() > OpVerb.kLine
        && pt_dydx(hitBase.fSlope, dir) === 0)
    {
        return false;
    }
    // Walk every contour.
    let contour: OpContour | undefined = contourHead;
    while (contour !== undefined)
    {
        if (contour.count() !== 0)
        {
            contour.rayCheck(hitBase, dir, hitsRef);
        }
        contour = contour.next();
    }
    // Sort hits along the scan-line axis (depending on dir).
    const sorted: OpRayHit[] = [];
    let walk = hitsRef.value;
    while (walk !== undefined)
    {
        sorted.push(walk);
        walk = walk.fNext;
    }
    const useY = xy_index(dir) !== 0;
    const ascending = less_than(dir);
    sorted.sort((a, b) => {
        const av = useY ? a.fPt.fY : a.fPt.fX;
        const bv = useY ? b.fPt.fY : b.fPt.fX;
        return ascending ? av - bv : bv - av;
    });
    // Walk in winding order.
    let last: Point | undefined = undefined;
    let wind = 0;
    let oppWind = 0;
    const count = sorted.length;
    for (let index = 0; index < count; ++index)
    {
        const hit = sorted[index]!;
        if (!hit.fValid) return false;
        const ccw = ccw_dxdy(hit.fSlope, dir);
        const span = hit.fSpan;
        if (span === undefined) return false;
        const hitSegment = span.segment() as OpSegment;
        if (span.windValue() === 0 && span.oppValue() === 0) continue;
        if (last !== undefined && last.equals(hit.fPt)) return false;
        if (index < count - 1)
        {
            if (sorted[index + 1]!.fPt.equals(hit.fPt)) return false;
        }
        const operand = hitSegment.operand();
        if (operand) { const t = wind; wind = oppWind; oppWind = t; }
        const lastWind = wind;
        const lastOpp  = oppWind;
        const windValue = ccw ? -span.windValue() : span.windValue();
        const oppValue  = ccw ? -span.oppValue()  : span.oppValue();
        wind    += windValue;
        oppWind += oppValue;
        let sumSet = false;
        const spanSum = span.windSum();
        const windSum = OpSegment.UseInnerWinding(lastWind, wind) ? wind : lastWind;
        if (spanSum === SK_MIN_S32)
        {
            span.setWindSum(windSum);
            sumSet = true;
        }
        const oSpanSum = span.oppSum();
        const oppSum = OpSegment.UseInnerWinding(lastOpp, oppWind) ? oppWind : lastOpp;
        if (oSpanSum === SK_MIN_S32)
        {
            span.setOppSum(oppSum);
        }
        if (sumSet)
        {
            if (this.globalState().phase() === OpPhase.kFixWinding)
            {
                (hitSegment.contour() as unknown as { setCcw(c: number): void }).setCcw(ccw ? 1 : 0);
            }
            else
            {
                void hitSegment.markAndChaseWindingBinary(span, span.next(), windSum, oppSum, undefined);
                void hitSegment.markAndChaseWindingBinary(span.next(), span, windSum, oppSum, undefined);
            }
        }
        if (operand) { const t = wind; wind = oppWind; oppWind = t; }
        last = hit.fPt;
        this.globalState().bumpNested();
    }
    return true;
};

OpSpan.prototype.computeWindSum = function(this: OpSpan): number
{
    const globals = this.globalState();
    const contourHead = globals.contourHead() as OpContourHead | undefined;
    if (contourHead === undefined) return this.windSum();
    let windTry = 0;
    while (!this.sortableTop(contourHead) && ++windTry < kMaxWindingTries)
    {
        // retry
    }
    return this.windSum();
};

// SkPathOpsWinding.cpp:429 — driver entry.
export function FindSortableTop(contourHead: OpContourHead): OpSpan | undefined
{
    for (let index = 0; index < kMaxWindingTries; ++index)
    {
        let contour: OpContour | undefined = contourHead;
        while (contour !== undefined)
        {
            if (!contour.done())
            {
                const result = contour.findSortableTop(contourHead);
                if (result !== undefined) return result;
            }
            contour = contour.next();
        }
    }
    return undefined;
}

// Use OpAngle once so the import isn't elided when the file is
// bundle-tree-shaken. (sortableTop reads OpAngle through OpSegment;
// the type info is implicit.)
const _ = OpAngle;
void _;
