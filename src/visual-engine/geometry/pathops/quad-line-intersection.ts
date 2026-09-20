// Copyright 2012 Google Inc.
//
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE-skia file at the root of this repository.
//
// TypeScript port: 2026 Eugene Napryaglo.
// Source: third_party/skia/src/pathops/SkDQuadLineIntersection.cpp
//         (Skia commit pinned in third_party/skia)
//
// Quad × Line intersection — finds 0–2 (t_quad, t_line, point) triples
// where a parametric quadratic Bézier meets a line segment.
//
// Algorithm (derived in the C++ source's prologue, repeated here):
//   1. Rotate the (line, quad) pair so the line lies on the x-axis.
//      After the rotation, the quad's y-component becomes a 1-D
//      quadratic in t whose roots are the parametric values where the
//      curve crosses the (rotated) line.
//   2. Solve A·t² + B·t + C = 0 via `Quad.RootsValidT` (Phase 1).
//   3. For each root, map back to (point, t_line) and pin to [0, 1].
//   4. Endpoint hits (quad endpoints touching the line; line endpoints
//      touching the quad) are inserted before the root sweep so the
//      endpoint t-values are exact 0 / 1 rather than rounded results
//      of the parametric solve.
//   5. Coincidence: midpoint of two adjacent results — if it also lies
//      on the line, the segment between them is coincident.
//
// Sibling module via TypeScript declaration merging: importing this
// file installs `intersectQuadLine`, `intersectRayQuadLine`,
// `horizontalQuad`, `verticalQuad`, and `HorizontalInterceptQuad` /
// `VerticalInterceptQuad` on the Intersections class. No call site
// changes; just `import './quad-line-intersection.js'` once at the
// barrel.

import { Intersections } from './intersections.js';
import { Line } from './line.js';
import { Point } from './point.js';
import { Quad } from './quad.js';
import {
    AlmostBetweenUlps,
    SkPinT,
    approximately_equal,
    approximately_one_or_less_double,
    approximately_zero_or_more_double,
} from './types.js';

// ── TypeScript module augmentation ──────────────────────────────────
//
// Declare the curve-pair methods on Intersections so call sites can
// invoke them through the normal type-checked API. The runtime
// implementations are installed via `Intersections.prototype.foo = …`
// below.

declare module './intersections.js'
{
    interface Intersections
    {
        intersectQuadLine(quad: Quad, line: Line): number;
        intersectRayQuadLine(quad: Quad, line: Line): number;
        horizontalQuad(quad: Quad, left: number, right: number, y: number, flipped: boolean): number;
        verticalQuad(quad: Quad, top: number, bottom: number, x: number, flipped: boolean): number;
    }
    interface IntersectionsStatic
    {
        HorizontalInterceptQuad(quad: Quad, y: number, roots: number[]): number;
        VerticalInterceptQuad(quad: Quad, x: number, roots: number[]): number;
    }
}

// Skia distinguishes "I'm computing the point from this t" (kPoint-
// Uninitialized) from "the caller already wrote the point" (kPoint-
// Initialized). Matters for the pin path — the rotated-axis case
// doesn't have a precomputed point.
enum PinTPoint { Uninitialized, Initialized }

// Single-precision rounding mirrors SkPoint::ApproximatelyEqual against
// the float-truncated grid Skia uses. Math.fround gives exactly that.
function frX(p: Point): number { return Math.fround(p.fX); }
function frY(p: Point): number { return Math.fround(p.fY); }

function skPointApproxEqual(aX: number, aY: number, bX: number, bY: number): boolean
{
    return Point.ApproximatelyEqual(new Point(aX, aY), new Point(bX, bY));
}

function skPointEqualFRound(aX: number, aY: number, bX: number, bY: number): boolean
{
    return aX === bX && aY === bY;
}

// Quad-specific `nearPoint(verb=Quad, xy, opp)` — finds the t on the
// quad nearest to xy, using opp to orient a perpendicular probe.
// Quad version of SkDCurve::nearPoint. The cubic version lands with
// cubic-line-intersection.ts.
function quadNearPoint(quad: Quad, xy: Point, opp: Point): number
{
    let minX = quad.fPts[0].fX, maxX = minX;
    let minY = quad.fPts[0].fY, maxY = minY;
    for (let i = 1; i <= 2; ++i)
    {
        minX = Math.min(minX, quad.fPts[i]!.fX);
        maxX = Math.max(maxX, quad.fPts[i]!.fX);
        minY = Math.min(minY, quad.fPts[i]!.fY);
        maxY = Math.max(maxY, quad.fPts[i]!.fY);
    }
    if (!AlmostBetweenUlps(minX, xy.fX, maxX)) return -1;
    if (!AlmostBetweenUlps(minY, xy.fY, maxY)) return -1;
    // Perpendicular probe — rotate (opp - xy) by 90° to get a ray
    // perpendicular to the line through xy and opp.
    const perp = new Line(
        xy,
        new Point(xy.fX + opp.fY - xy.fY, xy.fY + xy.fX - opp.fX),
    );
    const probe = new Intersections();
    probe.intersectRayQuadLine(quad, perp);
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

// ── LineQuadraticIntersections — the SkDQuadLineIntersection helper ──

class LineQuadraticIntersections
{
    private readonly fQuad: Quad;
    private readonly fLine: Line | undefined;
    private readonly fIntersections: Intersections | undefined;
    private fAllowNear: boolean;

    constructor(quad: Quad, line?: Line, intersections?: Intersections)
    {
        this.fQuad = quad;
        this.fLine = line;
        this.fIntersections = intersections;
        this.fAllowNear = true;
        if (intersections !== undefined) intersections.setMax(5);
    }

    public allowNear(allow: boolean): void { this.fAllowNear = allow; }

    public checkCoincident(): void
    {
        if (this.fIntersections === undefined) return;
        let last = this.fIntersections.used() - 1;
        for (let index = 0; index < last; )
        {
            const tA = this.fIntersections._get_fT(0, index);
            const tB = this.fIntersections._get_fT(0, index + 1);
            const quadMidT = (tA + tB) / 2;
            const quadMidPt = this.fQuad.ptAtT(quadMidT);
            const t = this.fLine!.nearPoint(quadMidPt).t;
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

    // Solve the rotated-axis quadratic; populate roots[0..n]. Returns n.
    public intersectRay(roots: number[]): number
    {
        const line = this.fLine!;
        const adj = line.fPts[1].fX - line.fPts[0].fX;
        const opp = line.fPts[1].fY - line.fPts[0].fY;
        const r: number[] = new Array(3);
        for (let n = 0; n < 3; ++n)
        {
            r[n] = (this.fQuad.fPts[n]!.fY - line.fPts[0].fY) * adj
                 - (this.fQuad.fPts[n]!.fX - line.fPts[0].fX) * opp;
        }
        let A = r[2]!;
        let B = r[1]!;
        const C = r[0]!;
        A += C - 2 * B; // A = a - 2b + c
        B -= C;         // B = -(b - c)
        return Quad.RootsValidT(A, 2 * B, C, roots);
    }

    public intersect(): number
    {
        this.addExactEndPoints();
        if (this.fAllowNear) this.addNearEndPoints();
        const rootVals: number[] = [0, 0];
        const roots = this.intersectRay(rootVals);
        for (let index = 0; index < roots; ++index)
        {
            let quadT = rootVals[index]!;
            let lineT = this.findLineT(quadT);
            const pinResult = this.pinTs(quadT, lineT, PinTPoint.Uninitialized);
            if (pinResult !== undefined)
            {
                ({ quadT, lineT } = pinResult);
                if (this.uniqueAnswer(quadT, pinResult.pt))
                {
                    this.fIntersections!.insert(quadT, lineT, pinResult.pt);
                }
            }
        }
        this.checkCoincident();
        return this.fIntersections!.used();
    }

    // Static helpers — solve quadratic for axis-aligned target.
    public horizontalIntersectRoots(axisIntercept: number, roots: number[]): number
    {
        let D = this.fQuad.fPts[2].fY; // f
        let E = this.fQuad.fPts[1].fY; // e
        const F = this.fQuad.fPts[0].fY; // d
        D += F - 2 * E;
        E -= F;
        return Quad.RootsValidT(D, 2 * E, F - axisIntercept, roots);
    }

    public verticalIntersectRoots(axisIntercept: number, roots: number[]): number
    {
        let D = this.fQuad.fPts[2].fX;
        let E = this.fQuad.fPts[1].fX;
        const F = this.fQuad.fPts[0].fX;
        D += F - 2 * E;
        E -= F;
        return Quad.RootsValidT(D, 2 * E, F - axisIntercept, roots);
    }

    public horizontalIntersect(axisIntercept: number, left: number, right: number, flipped: boolean): number
    {
        this.addExactHorizontalEndPoints(left, right, axisIntercept);
        if (this.fAllowNear) this.addNearHorizontalEndPoints(left, right, axisIntercept);
        const rootVals: number[] = [0, 0];
        const roots = this.horizontalIntersectRoots(axisIntercept, rootVals);
        for (let index = 0; index < roots; ++index)
        {
            let quadT = rootVals[index]!;
            let pt = this.fQuad.ptAtT(quadT);
            let lineT = (pt.fX - left) / (right - left);
            const pinResult = this.pinTs(quadT, lineT, PinTPoint.Initialized, pt);
            if (pinResult !== undefined)
            {
                ({ quadT, lineT, pt } = pinResult);
                if (this.uniqueAnswer(quadT, pt))
                {
                    this.fIntersections!.insert(quadT, lineT, pt);
                }
            }
        }
        if (flipped) this.fIntersections!.flip();
        this.checkCoincident();
        return this.fIntersections!.used();
    }

    public verticalIntersect(axisIntercept: number, top: number, bottom: number, flipped: boolean): number
    {
        this.addExactVerticalEndPoints(top, bottom, axisIntercept);
        if (this.fAllowNear) this.addNearVerticalEndPoints(top, bottom, axisIntercept);
        const rootVals: number[] = [0, 0];
        const roots = this.verticalIntersectRoots(axisIntercept, rootVals);
        for (let index = 0; index < roots; ++index)
        {
            let quadT = rootVals[index]!;
            let pt = this.fQuad.ptAtT(quadT);
            let lineT = (pt.fY - top) / (bottom - top);
            const pinResult = this.pinTs(quadT, lineT, PinTPoint.Initialized, pt);
            if (pinResult !== undefined)
            {
                ({ quadT, lineT, pt } = pinResult);
                if (this.uniqueAnswer(quadT, pt))
                {
                    this.fIntersections!.insert(quadT, lineT, pt);
                }
            }
        }
        if (flipped) this.fIntersections!.flip();
        this.checkCoincident();
        return this.fIntersections!.used();
    }

    private uniqueAnswer(quadT: number, pt: Point): boolean
    {
        const ix = this.fIntersections!;
        for (let inner = 0; inner < ix.used(); ++inner)
        {
            if (!ix.pt(inner).equals(pt)) continue;
            const existingQuadT = ix._get_fT(0, inner);
            if (quadT === existingQuadT) return false;
            const quadMidT = (existingQuadT + quadT) / 2;
            const quadMidPt = this.fQuad.ptAtT(quadMidT);
            if (Point.ApproximatelyEqual(quadMidPt, pt)) return false;
        }
        return true;
    }

    // ── endpoint helpers ───────────────────────────────────────────

    private addExactEndPoints(): void
    {
        for (let qIndex = 0; qIndex < 3; qIndex += 2)
        {
            const lineT = this.fLine!.exactPoint(this.fQuad.fPts[qIndex]!);
            if (lineT < 0) continue;
            const quadT = qIndex >> 1;
            this.fIntersections!.insert(quadT, lineT, this.fQuad.fPts[qIndex]!);
        }
    }

    private addNearEndPoints(): void
    {
        for (let qIndex = 0; qIndex < 3; qIndex += 2)
        {
            const quadT = qIndex >> 1;
            if (this.fIntersections!.hasT(quadT === 0 ? 0 : 1)) continue;
            const lineT = this.fLine!.nearPoint(this.fQuad.fPts[qIndex]!).t;
            if (lineT < 0) continue;
            this.fIntersections!.insert(quadT, lineT, this.fQuad.fPts[qIndex]!);
        }
        this.addLineNearEndPoints();
    }

    private addLineNearEndPoints(): void
    {
        for (let lIndex = 0; lIndex < 2; ++lIndex)
        {
            const lineT = lIndex;
            if (this.fIntersections!.hasOppT(lineT === 0 ? 0 : 1)) continue;
            const otherIdx = lIndex === 0 ? 1 : 0;
            const quadT = quadNearPoint(this.fQuad, this.fLine!.fPts[lIndex]!, this.fLine!.fPts[otherIdx]!);
            if (quadT < 0) continue;
            this.fIntersections!.insert(quadT, lineT, this.fLine!.fPts[lIndex]!);
        }
    }

    private addExactHorizontalEndPoints(left: number, right: number, y: number): void
    {
        for (let qIndex = 0; qIndex < 3; qIndex += 2)
        {
            const lineT = Line.ExactPointH(this.fQuad.fPts[qIndex]!, left, right, y);
            if (lineT < 0) continue;
            const quadT = qIndex >> 1;
            this.fIntersections!.insert(quadT, lineT, this.fQuad.fPts[qIndex]!);
        }
    }

    private addNearHorizontalEndPoints(left: number, right: number, y: number): void
    {
        for (let qIndex = 0; qIndex < 3; qIndex += 2)
        {
            const quadT = qIndex >> 1;
            if (this.fIntersections!.hasT(quadT === 0 ? 0 : 1)) continue;
            const lineT = Line.NearPointH(this.fQuad.fPts[qIndex]!, left, right, y);
            if (lineT < 0) continue;
            this.fIntersections!.insert(quadT, lineT, this.fQuad.fPts[qIndex]!);
        }
        // The horizontal/vertical variants of addLineNearEndPoints
        // pass a synthesized Line whose endpoints are (left, y) and
        // (right, y); the original code reuses fLine here, which is
        // set by the SkIntersections::horizontal entry below.
        this.addLineNearEndPoints();
    }

    private addExactVerticalEndPoints(top: number, bottom: number, x: number): void
    {
        for (let qIndex = 0; qIndex < 3; qIndex += 2)
        {
            const lineT = Line.ExactPointV(this.fQuad.fPts[qIndex]!, top, bottom, x);
            if (lineT < 0) continue;
            const quadT = qIndex >> 1;
            this.fIntersections!.insert(quadT, lineT, this.fQuad.fPts[qIndex]!);
        }
    }

    private addNearVerticalEndPoints(top: number, bottom: number, x: number): void
    {
        for (let qIndex = 0; qIndex < 3; qIndex += 2)
        {
            const quadT = qIndex >> 1;
            if (this.fIntersections!.hasT(quadT === 0 ? 0 : 1)) continue;
            const lineT = Line.NearPointV(this.fQuad.fPts[qIndex]!, top, bottom, x);
            if (lineT < 0) continue;
            this.fIntersections!.insert(quadT, lineT, this.fQuad.fPts[qIndex]!);
        }
        this.addLineNearEndPoints();
    }

    private findLineT(t: number): number
    {
        const xy = this.fQuad.ptAtT(t);
        const dx = this.fLine!.fPts[1].fX - this.fLine!.fPts[0].fX;
        const dy = this.fLine!.fPts[1].fY - this.fLine!.fPts[0].fY;
        if (Math.abs(dx) > Math.abs(dy))
        {
            return (xy.fX - this.fLine!.fPts[0].fX) / dx;
        }
        return (xy.fY - this.fLine!.fPts[0].fY) / dy;
    }

    private pinTs(
        quadT: number, lineT: number, ptSet: PinTPoint, ptIn?: Point,
    ): { quadT: number; lineT: number; pt: Point } | undefined
    {
        if (!approximately_one_or_less_double(lineT)) return undefined;
        if (!approximately_zero_or_more_double(lineT)) return undefined;
        const qT = SkPinT(quadT);
        const lT = SkPinT(lineT);
        let pt: Point;
        if (ptIn !== undefined && ptSet === PinTPoint.Initialized)
        {
            pt = ptIn;
        }
        else if (lT === 0 || lT === 1
            || (ptSet === PinTPoint.Uninitialized && qT !== 0 && qT !== 1))
        {
            pt = this.fLine!.ptAtT(lT);
        }
        else
        {
            pt = this.fQuad.ptAtT(qT);
        }
        // Snap to line endpoints under single-precision rounding.
        const gridPtX = frX(pt), gridPtY = frY(pt);
        let lTOut = lT;
        const linePt0 = this.fLine!.fPts[0];
        const linePt1 = this.fLine!.fPts[1];
        if (skPointApproxEqual(gridPtX, gridPtY, frX(linePt0), frY(linePt0)))
        {
            pt = linePt0;
            lTOut = 0;
        }
        else if (skPointApproxEqual(gridPtX, gridPtY, frX(linePt1), frY(linePt1)))
        {
            pt = linePt1;
            lTOut = 1;
        }
        if (this.fIntersections!.used() > 0
            && approximately_equal(this.fIntersections!._get_fT(1, 0), lTOut))
        {
            return undefined;
        }
        let qTOut = qT;
        const quadPt0 = this.fQuad.fPts[0];
        const quadPt2 = this.fQuad.fPts[2];
        if (skPointEqualFRound(frX(pt), frY(pt), frX(quadPt0), frY(quadPt0)))
        {
            pt = quadPt0;
            qTOut = 0;
        }
        else if (skPointEqualFRound(frX(pt), frY(pt), frX(quadPt2), frY(quadPt2)))
        {
            pt = quadPt2;
            qTOut = 1;
        }
        return { quadT: qTOut, lineT: lTOut, pt };
    }
}

// ── Prototype augmentation: install methods on Intersections ────────

Intersections.prototype.intersectQuadLine = function (quad: Quad, line: Line): number
{
    const helper = new LineQuadraticIntersections(quad, line, this);
    helper.allowNear(this.fAllowNear);
    return helper.intersect();
};

Intersections.prototype.intersectRayQuadLine = function (quad: Quad, line: Line): number
{
    const helper = new LineQuadraticIntersections(quad, line, this);
    const roots: number[] = [0, 0];
    const n = helper.intersectRay(roots);
    this._set_fUsed(n);
    for (let index = 0; index < n; ++index)
    {
        this._set_fT(0, index, roots[index]!);
        this._set_fPt(index, quad.ptAtT(roots[index]!));
    }
    return n;
};

Intersections.prototype.horizontalQuad = function (
    quad: Quad, left: number, right: number, y: number, flipped: boolean,
): number
{
    const line = new Line(new Point(left, y), new Point(right, y));
    const helper = new LineQuadraticIntersections(quad, line, this);
    return helper.horizontalIntersect(y, left, right, flipped);
};

Intersections.prototype.verticalQuad = function (
    quad: Quad, top: number, bottom: number, x: number, flipped: boolean,
): number
{
    const line = new Line(new Point(x, top), new Point(x, bottom));
    const helper = new LineQuadraticIntersections(quad, line, this);
    return helper.verticalIntersect(x, top, bottom, flipped);
};

// Static intercept helpers (Skia: SkIntersections::HorizontalIntercept).
// Returned via free functions, not on the class — TS doesn't support
// merging static members through declaration-only `interface`s as
// cleanly, and free functions are equivalent at the call site.
export function HorizontalInterceptQuad(quad: Quad, y: number, roots: number[]): number
{
    const helper = new LineQuadraticIntersections(quad);
    return helper.horizontalIntersectRoots(y, roots);
}

export function VerticalInterceptQuad(quad: Quad, x: number, roots: number[]): number
{
    const helper = new LineQuadraticIntersections(quad);
    return helper.verticalIntersectRoots(x, roots);
}

export { LineQuadraticIntersections };
