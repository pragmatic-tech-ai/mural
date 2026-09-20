// Copyright 2012 Google Inc.
//
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE-skia file at the root of this repository.
//
// TypeScript port: 2026 Eugene Napryaglo.
// Source: third_party/skia/src/pathops/SkDCubicLineIntersection.cpp
//         (Skia commit pinned in third_party/skia)
//
// Cubic × Line intersection — finds 0–3 (t_cubic, t_line, point)
// triples where a parametric cubic Bézier meets a line segment.
//
// Algorithm: same rotate-line-to-x-axis trick as quad-line, but the
// resulting polynomial in t is a cubic. Use `Cubic.RootsValidT`
// (Phase 1) for the primary solve. When the recovered point fails to
// land on the axis within tolerance (near-degenerate polynomial),
// fall back to `Cubic.searchRoots` which splits the curve at its
// extrema + inflections and binary-searches each monotonic interval.
//
// Sibling module via TypeScript declaration merging: importing this
// file installs `intersectCubicLine`, `intersectRayCubicLine`,
// `horizontalCubic`, `verticalCubic`, and the static
// `HorizontalInterceptCubic` / `VerticalInterceptCubic` on the
// Intersections class.

import { Cubic, SearchAxis } from './cubic.js';
import { Intersections } from './intersections.js';
import { Line } from './line.js';
import { Point } from './point.js';
import {
    AlmostBetweenUlps,
    SkPinT,
    approximately_equal,
    approximately_one_or_less_double,
    approximately_zero,
    approximately_zero_or_more_double,
} from './types.js';

declare module './intersections.js'
{
    interface Intersections
    {
        intersectCubicLine(cubic: Cubic, line: Line): number;
        intersectRayCubicLine(cubic: Cubic, line: Line): number;
        horizontalCubic(cubic: Cubic, left: number, right: number, y: number, flipped: boolean): number;
        verticalCubic(cubic: Cubic, top: number, bottom: number, x: number, flipped: boolean): number;
    }
}

enum PinTPoint { Uninitialized, Initialized }

function frX(p: Point): number { return Math.fround(p.fX); }
function frY(p: Point): number { return Math.fround(p.fY); }

function skPointEqualFRound(aX: number, aY: number, bX: number, bY: number): boolean
{
    return aX === bX && aY === bY;
}

// Cubic-specific `nearPoint(verb=Cubic, xy, opp)` — analogous to the
// quad version in quad-line-intersection.ts.
function cubicNearPoint(cubic: Cubic, xy: Point, opp: Point): number
{
    let minX = cubic.fPts[0].fX, maxX = minX;
    let minY = cubic.fPts[0].fY, maxY = minY;
    for (let i = 1; i <= 3; ++i)
    {
        minX = Math.min(minX, cubic.fPts[i]!.fX);
        maxX = Math.max(maxX, cubic.fPts[i]!.fX);
        minY = Math.min(minY, cubic.fPts[i]!.fY);
        maxY = Math.max(maxY, cubic.fPts[i]!.fY);
    }
    if (!AlmostBetweenUlps(minX, xy.fX, maxX)) return -1;
    if (!AlmostBetweenUlps(minY, xy.fY, maxY)) return -1;
    const perp = new Line(
        xy,
        new Point(xy.fX + opp.fY - xy.fY, xy.fY + xy.fX - opp.fX),
    );
    const probe = new Intersections();
    probe.intersectRayCubicLine(cubic, perp);
    let minIndex = -1;
    let minDist = Number.MAX_VALUE;
    for (let index = 0; index < probe.used(); ++index)
    {
        const dist = xy.distance(probe.pt(index));
        if (minDist > dist) { minDist = dist; minIndex = index; }
    }
    if (minIndex < 0) return -1;
    return probe._get_fT(0, minIndex);
}

class LineCubicIntersections
{
    private readonly fCubic: Cubic;
    private readonly fLine: Line;
    private readonly fIntersections: Intersections;
    private fAllowNear: boolean;

    constructor(cubic: Cubic, line: Line, intersections: Intersections)
    {
        this.fCubic = cubic;
        this.fLine = line;
        this.fIntersections = intersections;
        this.fAllowNear = true;
        intersections.setMax(4);
    }

    public allowNear(allow: boolean): void { this.fAllowNear = allow; }

    public checkCoincident(): void
    {
        let last = this.fIntersections.used() - 1;
        for (let index = 0; index < last; )
        {
            const tA = this.fIntersections._get_fT(0, index);
            const tB = this.fIntersections._get_fT(0, index + 1);
            const cubicMidT = (tA + tB) / 2;
            const cubicMidPt = this.fCubic.ptAtT(cubicMidT);
            const t = this.fLine.nearPoint(cubicMidPt).t;
            if (t < 0) { ++index; continue; }
            if (this.fIntersections.isCoincident(index))
            {
                this.fIntersections.removeOne(index);
                --last;
            }
            else if (this.fIntersections.isCoincident(index + 1))
            {
                this.fIntersections.removeOne(index + 1);
                --last;
            }
            else
            {
                this.fIntersections.setCoincident(index++);
            }
            this.fIntersections.setCoincident(index);
        }
    }

    // Same rotate-to-axis trick as the quad version, but the rotated
    // cubic's x' component is a cubic in t — solve via RootsValidT,
    // fall back to searchRoots if the recovered point misses the axis.
    public intersectRay(roots: number[]): number
    {
        const adj = this.fLine.fPts[1].fX - this.fLine.fPts[0].fX;
        const opp = this.fLine.fPts[1].fY - this.fLine.fPts[0].fY;
        const c = new Cubic();
        for (let n = 0; n < 4; ++n)
        {
            c.fPts[n]!.fX = (this.fCubic.fPts[n]!.fY - this.fLine.fPts[0].fY) * adj
                          - (this.fCubic.fPts[n]!.fX - this.fLine.fPts[0].fX) * opp;
        }
        const xs: [number, number, number, number] = [
            c.fPts[0]!.fX, c.fPts[1]!.fX, c.fPts[2]!.fX, c.fPts[3]!.fX,
        ];
        const { A, B, C, D } = Cubic.Coefficients(xs[0], xs[1], xs[2], xs[3]);
        let count = Cubic.RootsValidT(A, B, C, D, roots);
        for (let index = 0; index < count; ++index)
        {
            const calcPt = c.ptAtT(roots[index]!);
            if (!approximately_zero(calcPt.fX))
            {
                // Polynomial misses axis: refill c's y from the rotated
                // y' projection and refine via extrema-based search.
                for (let n = 0; n < 4; ++n)
                {
                    c.fPts[n]!.fY = (this.fCubic.fPts[n]!.fY - this.fLine.fPts[0].fY) * opp
                                  + (this.fCubic.fPts[n]!.fX - this.fLine.fPts[0].fX) * adj;
                }
                const xs2: [number, number, number, number] = [
                    c.fPts[0]!.fX, c.fPts[1]!.fX, c.fPts[2]!.fX, c.fPts[3]!.fX,
                ];
                const extremeTs: number[] = [0, 0, 0, 0, 0, 0];
                const extrema = Cubic.FindExtrema(xs2[0], xs2[1], xs2[2], xs2[3], extremeTs);
                count = c.searchRoots(extremeTs, extrema, 0, SearchAxis.kXAxis, roots);
                break;
            }
        }
        return count;
    }

    public intersect(): number
    {
        this.addExactEndPoints();
        if (this.fAllowNear) this.addNearEndPoints();
        const rootVals: number[] = [0, 0, 0];
        const roots = this.intersectRay(rootVals);
        for (let index = 0; index < roots; ++index)
        {
            let cubicT = rootVals[index]!;
            let lineT = this.findLineT(cubicT);
            const pinResult = this.pinTs(cubicT, lineT, PinTPoint.Uninitialized);
            if (pinResult !== undefined)
            {
                ({ cubicT, lineT } = pinResult);
                if (this.uniqueAnswer(cubicT, pinResult.pt))
                {
                    this.fIntersections.insert(cubicT, lineT, pinResult.pt);
                }
            }
        }
        this.checkCoincident();
        return this.fIntersections.used();
    }

    public static HorizontalIntersect(c: Cubic, axisIntercept: number, roots: number[]): number
    {
        const ys: [number, number, number, number] = [
            c.fPts[0].fY, c.fPts[1].fY, c.fPts[2].fY, c.fPts[3].fY,
        ];
        const { A, B, C, D } = Cubic.Coefficients(ys[0], ys[1], ys[2], ys[3]);
        let count = Cubic.RootsValidT(A, B, C, D - axisIntercept, roots);
        for (let index = 0; index < count; ++index)
        {
            const calcPt = c.ptAtT(roots[index]!);
            if (!approximately_equal(calcPt.fY, axisIntercept))
            {
                const extremeTs: number[] = [0, 0, 0, 0, 0, 0];
                const extrema = Cubic.FindExtrema(ys[0], ys[1], ys[2], ys[3], extremeTs);
                count = c.searchRoots(extremeTs, extrema, axisIntercept, SearchAxis.kYAxis, roots);
                break;
            }
        }
        return count;
    }

    public static VerticalIntersect(c: Cubic, axisIntercept: number, roots: number[]): number
    {
        const xs: [number, number, number, number] = [
            c.fPts[0].fX, c.fPts[1].fX, c.fPts[2].fX, c.fPts[3].fX,
        ];
        const { A, B, C, D } = Cubic.Coefficients(xs[0], xs[1], xs[2], xs[3]);
        let count = Cubic.RootsValidT(A, B, C, D - axisIntercept, roots);
        for (let index = 0; index < count; ++index)
        {
            const calcPt = c.ptAtT(roots[index]!);
            if (!approximately_equal(calcPt.fX, axisIntercept))
            {
                const extremeTs: number[] = [0, 0, 0, 0, 0, 0];
                const extrema = Cubic.FindExtrema(xs[0], xs[1], xs[2], xs[3], extremeTs);
                count = c.searchRoots(extremeTs, extrema, axisIntercept, SearchAxis.kXAxis, roots);
                break;
            }
        }
        return count;
    }

    public horizontalIntersect(axisIntercept: number, left: number, right: number, flipped: boolean): number
    {
        this.addExactHorizontalEndPoints(left, right, axisIntercept);
        if (this.fAllowNear) this.addNearHorizontalEndPoints(left, right, axisIntercept);
        const roots: number[] = [0, 0, 0];
        const count = LineCubicIntersections.HorizontalIntersect(this.fCubic, axisIntercept, roots);
        for (let index = 0; index < count; ++index)
        {
            let cubicT = roots[index]!;
            let pt = new Point(this.fCubic.ptAtT(cubicT).fX, axisIntercept);
            let lineT = (pt.fX - left) / (right - left);
            const pinResult = this.pinTs(cubicT, lineT, PinTPoint.Initialized, pt);
            if (pinResult !== undefined)
            {
                ({ cubicT, lineT, pt } = pinResult);
                if (this.uniqueAnswer(cubicT, pt))
                {
                    this.fIntersections.insert(cubicT, lineT, pt);
                }
            }
        }
        if (flipped) this.fIntersections.flip();
        this.checkCoincident();
        return this.fIntersections.used();
    }

    public verticalIntersect(axisIntercept: number, top: number, bottom: number, flipped: boolean): number
    {
        this.addExactVerticalEndPoints(top, bottom, axisIntercept);
        if (this.fAllowNear) this.addNearVerticalEndPoints(top, bottom, axisIntercept);
        const roots: number[] = [0, 0, 0];
        const count = LineCubicIntersections.VerticalIntersect(this.fCubic, axisIntercept, roots);
        for (let index = 0; index < count; ++index)
        {
            let cubicT = roots[index]!;
            let pt = new Point(axisIntercept, this.fCubic.ptAtT(cubicT).fY);
            let lineT = (pt.fY - top) / (bottom - top);
            const pinResult = this.pinTs(cubicT, lineT, PinTPoint.Initialized, pt);
            if (pinResult !== undefined)
            {
                ({ cubicT, lineT, pt } = pinResult);
                if (this.uniqueAnswer(cubicT, pt))
                {
                    this.fIntersections.insert(cubicT, lineT, pt);
                }
            }
        }
        if (flipped) this.fIntersections.flip();
        this.checkCoincident();
        return this.fIntersections.used();
    }

    private uniqueAnswer(cubicT: number, pt: Point): boolean
    {
        const ix = this.fIntersections;
        for (let inner = 0; inner < ix.used(); ++inner)
        {
            if (!ix.pt(inner).equals(pt)) continue;
            const existingCubicT = ix._get_fT(0, inner);
            if (cubicT === existingCubicT) return false;
            const cubicMidT = (existingCubicT + cubicT) / 2;
            const cubicMidPt = this.fCubic.ptAtT(cubicMidT);
            if (Point.ApproximatelyEqual(cubicMidPt, pt)) return false;
        }
        return true;
    }

    // ── endpoint helpers ───────────────────────────────────────────

    private addExactEndPoints(): void
    {
        for (let cIndex = 0; cIndex < 4; cIndex += 3)
        {
            const lineT = this.fLine.exactPoint(this.fCubic.fPts[cIndex]!);
            if (lineT < 0) continue;
            const cubicT = cIndex >> 1; // 0 or 1 (with 3 >> 1 = 1)
            // 3 >> 1 yields 1, mapping endpoint indices {0, 3} → {0, 1}.
            this.fIntersections.insert(cubicT, lineT, this.fCubic.fPts[cIndex]!);
        }
    }

    private addNearEndPoints(): void
    {
        for (let cIndex = 0; cIndex < 4; cIndex += 3)
        {
            const cubicT = cIndex >> 1;
            if (this.fIntersections.hasT(cubicT === 0 ? 0 : 1)) continue;
            const lineT = this.fLine.nearPoint(this.fCubic.fPts[cIndex]!).t;
            if (lineT < 0) continue;
            this.fIntersections.insert(cubicT, lineT, this.fCubic.fPts[cIndex]!);
        }
        this.addLineNearEndPoints();
    }

    private addLineNearEndPoints(): void
    {
        for (let lIndex = 0; lIndex < 2; ++lIndex)
        {
            const lineT = lIndex;
            if (this.fIntersections.hasOppT(lineT === 0 ? 0 : 1)) continue;
            const otherIdx = lIndex === 0 ? 1 : 0;
            const cubicT = cubicNearPoint(this.fCubic, this.fLine.fPts[lIndex]!, this.fLine.fPts[otherIdx]!);
            if (cubicT < 0) continue;
            this.fIntersections.insert(cubicT, lineT, this.fLine.fPts[lIndex]!);
        }
    }

    private addExactHorizontalEndPoints(left: number, right: number, y: number): void
    {
        for (let cIndex = 0; cIndex < 4; cIndex += 3)
        {
            const lineT = Line.ExactPointH(this.fCubic.fPts[cIndex]!, left, right, y);
            if (lineT < 0) continue;
            const cubicT = cIndex >> 1;
            this.fIntersections.insert(cubicT, lineT, this.fCubic.fPts[cIndex]!);
        }
    }

    private addNearHorizontalEndPoints(left: number, right: number, y: number): void
    {
        for (let cIndex = 0; cIndex < 4; cIndex += 3)
        {
            const cubicT = cIndex >> 1;
            if (this.fIntersections.hasT(cubicT === 0 ? 0 : 1)) continue;
            const lineT = Line.NearPointH(this.fCubic.fPts[cIndex]!, left, right, y);
            if (lineT < 0) continue;
            this.fIntersections.insert(cubicT, lineT, this.fCubic.fPts[cIndex]!);
        }
        this.addLineNearEndPoints();
    }

    private addExactVerticalEndPoints(top: number, bottom: number, x: number): void
    {
        for (let cIndex = 0; cIndex < 4; cIndex += 3)
        {
            const lineT = Line.ExactPointV(this.fCubic.fPts[cIndex]!, top, bottom, x);
            if (lineT < 0) continue;
            const cubicT = cIndex >> 1;
            this.fIntersections.insert(cubicT, lineT, this.fCubic.fPts[cIndex]!);
        }
    }

    private addNearVerticalEndPoints(top: number, bottom: number, x: number): void
    {
        for (let cIndex = 0; cIndex < 4; cIndex += 3)
        {
            const cubicT = cIndex >> 1;
            if (this.fIntersections.hasT(cubicT === 0 ? 0 : 1)) continue;
            const lineT = Line.NearPointV(this.fCubic.fPts[cIndex]!, top, bottom, x);
            if (lineT < 0) continue;
            this.fIntersections.insert(cubicT, lineT, this.fCubic.fPts[cIndex]!);
        }
        this.addLineNearEndPoints();
    }

    private findLineT(t: number): number
    {
        const xy = this.fCubic.ptAtT(t);
        const dx = this.fLine.fPts[1].fX - this.fLine.fPts[0].fX;
        const dy = this.fLine.fPts[1].fY - this.fLine.fPts[0].fY;
        if (Math.abs(dx) > Math.abs(dy))
        {
            return (xy.fX - this.fLine.fPts[0].fX) / dx;
        }
        return (xy.fY - this.fLine.fPts[0].fY) / dy;
    }

    private pinTs(
        cubicT: number, lineT: number, ptSet: PinTPoint, ptIn?: Point,
    ): { cubicT: number; lineT: number; pt: Point } | undefined
    {
        if (!approximately_one_or_less_double(lineT)) return undefined;
        if (!approximately_zero_or_more_double(lineT)) return undefined;
        const cT = SkPinT(cubicT);
        const lT = SkPinT(lineT);
        const lPt = this.fLine.ptAtT(lT);
        const cPt = this.fCubic.ptAtT(cT);
        if (!lPt.roughlyEqual(cPt)) return undefined;
        let pt: Point;
        if (ptIn !== undefined && ptSet === PinTPoint.Initialized)
        {
            pt = ptIn;
        }
        else if (lT === 0 || lT === 1
            || (ptSet === PinTPoint.Uninitialized && cT !== 0 && cT !== 1))
        {
            pt = lPt;
        }
        else
        {
            pt = cPt;
        }
        let lTOut = lT;
        const gridPtX = frX(pt), gridPtY = frY(pt);
        const linePt0 = this.fLine.fPts[0];
        const linePt1 = this.fLine.fPts[1];
        if (skPointEqualFRound(gridPtX, gridPtY, frX(linePt0), frY(linePt0)))
        {
            lTOut = 0;
        }
        else if (skPointEqualFRound(gridPtX, gridPtY, frX(linePt1), frY(linePt1)))
        {
            lTOut = 1;
        }
        let cTOut = cT;
        const cubicPt0 = this.fCubic.fPts[0];
        const cubicPt3 = this.fCubic.fPts[3];
        if (skPointEqualFRound(gridPtX, gridPtY, frX(cubicPt0), frY(cubicPt0))
            && approximately_equal(cTOut, 0))
        {
            cTOut = 0;
        }
        else if (skPointEqualFRound(gridPtX, gridPtY, frX(cubicPt3), frY(cubicPt3))
            && approximately_equal(cTOut, 1))
        {
            cTOut = 1;
        }
        return { cubicT: cTOut, lineT: lTOut, pt };
    }
}

// ── Prototype augmentation ──────────────────────────────────────────

Intersections.prototype.intersectCubicLine = function (cubic: Cubic, line: Line): number
{
    const helper = new LineCubicIntersections(cubic, line, this);
    helper.allowNear(this.fAllowNear);
    return helper.intersect();
};

Intersections.prototype.intersectRayCubicLine = function (cubic: Cubic, line: Line): number
{
    const helper = new LineCubicIntersections(cubic, line, this);
    const roots: number[] = [0, 0, 0];
    const n = helper.intersectRay(roots);
    this._set_fUsed(n);
    for (let index = 0; index < n; ++index)
    {
        this._set_fT(0, index, roots[index]!);
        this._set_fPt(index, cubic.ptAtT(roots[index]!));
    }
    return n;
};

Intersections.prototype.horizontalCubic = function (
    cubic: Cubic, left: number, right: number, y: number, flipped: boolean,
): number
{
    const line = new Line(new Point(left, y), new Point(right, y));
    const helper = new LineCubicIntersections(cubic, line, this);
    return helper.horizontalIntersect(y, left, right, flipped);
};

Intersections.prototype.verticalCubic = function (
    cubic: Cubic, top: number, bottom: number, x: number, flipped: boolean,
): number
{
    const line = new Line(new Point(x, top), new Point(x, bottom));
    const helper = new LineCubicIntersections(cubic, line, this);
    return helper.verticalIntersect(x, top, bottom, flipped);
};

export function HorizontalInterceptCubic(c: Cubic, y: number, roots: number[]): number
{
    return LineCubicIntersections.HorizontalIntersect(c, y, roots);
}

export function VerticalInterceptCubic(c: Cubic, x: number, roots: number[]): number
{
    return LineCubicIntersections.VerticalIntersect(c, x, roots);
}

export { LineCubicIntersections };
