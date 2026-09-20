// Copyright 2012 Google Inc.
//
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE-skia file at the root of this repository.
//
// TypeScript port: 2026 Eugene Napryaglo.
// Source: third_party/skia/src/pathops/SkPathOpsCubic.{h,cpp}
//         + third_party/skia/src/pathops/SkOpCubicHull.cpp (convexHull)
//         (Skia commit pinned in third_party/skia)
//
// Cubic Bézier curve in double precision. Four control points stored
// in `fPts[0..3]`. Endpoints are fPts[0] (t=0) and fPts[3] (t=1);
// fPts[1] / fPts[2] are the off-curve handles.
//
// Phase 1 scope: pure curve algebra — point evaluation, derivative,
// monotonicity, subdivision, the full cubic-formula root finder, the
// FindExtrema / Coefficients / findInflections / findMaxCurvature
// extrema helpers, and the convex-hull computation that bbox-rejection
// keys off in Phase 5.
//
// Deferred to Phase 5: hullIntersects (needs SkLineParameters),
// isLinear (same), ComplexBreak (needs SkClassifyCubic from
// include/core/SkGeometry.h — a different Skia subsystem),
// binarySearch / searchRoots (intersection helpers), subDivide(a, d,
// t1, t2, p[2]) (uses AlmostBequalUlps to snap to endpoint
// coordinates after subdivision). SkTCubic (the SkTCurve adapter for
// the T-section graph) lands in Phase 6.

import { Point, Vector } from './point.js';
import { Rect } from './rect.js';
import { Quad } from './quad.js';
import {
    AlmostDequalUlps,
    Interp,
    approximately_equal,
    approximately_equal_half,
    approximately_one_or_less,
    approximately_zero,
    approximately_zero_or_more,
    approximately_zero_when_compared_to,
    between,
    precisely_between,
    zero_or_one,
} from './types.js';

const PI = 3.141592653589793;

// Cubic Bezier split into two halves — pts[0..3] is the first cubic,
// pts[3..6] is the second. Shared midpoint at pts[3].
export class CubicPair
{
    public pts: [Point, Point, Point, Point, Point, Point, Point];

    constructor()
    {
        this.pts = [
            new Point(), new Point(), new Point(), new Point(),
            new Point(), new Point(), new Point(),
        ];
    }

    public first(): Cubic
    {
        const c = new Cubic();
        c.fPts = [this.pts[0], this.pts[1], this.pts[2], this.pts[3]];
        return c;
    }

    public second(): Cubic
    {
        const c = new Cubic();
        c.fPts = [this.pts[3], this.pts[4], this.pts[5], this.pts[6]];
        return c;
    }
}

// "Search axis" enum — used by horizontal/vertical intersection
// routines to pick which scalar coord to project against. Kept here
// so callers can already import it; the routines that consume it land
// in Phase 5.
export enum SearchAxis
{
    kXAxis = 0,
    kYAxis = 1,
}

// Given any two indices in {0,1,2,3}, return the XOR mask that yields
// the other two indices. Used by the convex-hull walk and otherPts.
// See the proof in SkPathOpsCubic.h:156-169.
export function other_two(one: number, two: number): number
{
    return (1 >> (3 - (one ^ two))) ^ 3;
}

export class Cubic
{
    public static readonly kPointCount = 4;
    public static readonly kPointLast = 3;
    public static readonly kMaxIntersections = 9;
    public static readonly gPrecisionUnit = 256;

    public fPts: [Point, Point, Point, Point];

    constructor(p0?: Point, p1?: Point, p2?: Point, p3?: Point)
    {
        this.fPts = [
            p0 ?? new Point(),
            p1 ?? new Point(),
            p2 ?? new Point(),
            p3 ?? new Point(),
        ];
    }

    // True when every control collapses to (approximately) one point.
    public collapsed(): boolean
    {
        return this.fPts[0].approximatelyEqual(this.fPts[1])
            && this.fPts[0].approximatelyEqual(this.fPts[2])
            && this.fPts[0].approximatelyEqual(this.fPts[3]);
    }

    // True when both handles project between the endpoints along the
    // chord — a non-S-curve, non-loop cubic. Used by the boolean
    // engine to fast-path normal-shape input.
    public controlsInside(): boolean
    {
        const v01 = this.fPts[0].sub(this.fPts[1]);
        const v02 = this.fPts[0].sub(this.fPts[2]);
        const v03 = this.fPts[0].sub(this.fPts[3]);
        const v13 = this.fPts[1].sub(this.fPts[3]);
        const v23 = this.fPts[2].sub(this.fPts[3]);
        return v03.dot(v01) > 0 && v03.dot(v02) > 0
            && v03.dot(v13) > 0 && v03.dot(v23) > 0;
    }

    public endsAreExtremaInXOrY(): boolean
    {
        return (between(this.fPts[0].fX, this.fPts[1].fX, this.fPts[3].fX)
                && between(this.fPts[0].fX, this.fPts[2].fX, this.fPts[3].fX))
            || (between(this.fPts[0].fY, this.fPts[1].fY, this.fPts[3].fY)
                && between(this.fPts[0].fY, this.fPts[2].fY, this.fPts[3].fY));
    }

    public monotonicInX(): boolean
    {
        return precisely_between(this.fPts[0].fX, this.fPts[1].fX, this.fPts[3].fX)
            && precisely_between(this.fPts[0].fX, this.fPts[2].fX, this.fPts[3].fX);
    }

    public monotonicInY(): boolean
    {
        return precisely_between(this.fPts[0].fY, this.fPts[1].fY, this.fPts[3].fY)
            && precisely_between(this.fPts[0].fY, this.fPts[2].fY, this.fPts[3].fY);
    }

    // otherPts: returns the three control points other than fPts[index].
    // Order matches SkPathOpsCubic.cpp:344 — uses !SkToBool(index) to
    // start at fPts[1] when index==0, fPts[0] when index!=0, then
    // iterates forward.
    public otherPts(index: number): [Point, Point, Point]
    {
        const offset = (index === 0 ? 1 : 0) as 0 | 1;
        const a = this.fPts[offset];
        const b = this.fPts[(offset + 1) as 0 | 1 | 2 | 3];
        const c = this.fPts[(offset + 2) as 0 | 1 | 2 | 3];
        return [a, b, c];
    }

    // align: snap dstPt's X / Y to the endpoint's X / Y when the
    // endpoint shares an exact value with the named control. Used
    // during subdivision to preserve axis-aligned chord directions.
    public align(endIndex: number, ctrlIndex: number, dstPt: Point): void
    {
        const end  = this.fPts[endIndex  as 0 | 1 | 2 | 3];
        const ctrl = this.fPts[ctrlIndex as 0 | 1 | 2 | 3];
        if (end.fX === ctrl.fX) dstPt.fX = end.fX;
        if (end.fY === ctrl.fY) dstPt.fY = end.fY;
    }

    // Rough geometric scale of the curve. Used to bound iteration
    // accuracy in curvature analysis.
    public calcPrecision(): number
    {
        return (this.fPts[1].sub(this.fPts[0]).length()
              + this.fPts[2].sub(this.fPts[1]).length()
              + this.fPts[3].sub(this.fPts[2]).length()) / Cubic.gPrecisionUnit;
    }

    // ----- evaluation -----

    public ptAtT(t: number): Point
    {
        if (t === 0) return this.fPts[0];
        if (t === 1) return this.fPts[3];
        const one_t = 1 - t;
        const one_t2 = one_t * one_t;
        const a = one_t2 * one_t;
        const b = 3 * one_t2 * t;
        const t2 = t * t;
        const c = 3 * one_t * t2;
        const d = t2 * t;
        return new Point(
            a * this.fPts[0].fX + b * this.fPts[1].fX + c * this.fPts[2].fX + d * this.fPts[3].fX,
            a * this.fPts[0].fY + b * this.fPts[1].fY + c * this.fPts[2].fY + d * this.fPts[3].fY,
        );
    }

    // Cubic derivative at parameter t. For C(t) = (1-t)³P0 + 3(1-t)²t·P1
    // + 3(1-t)t²·P2 + t³·P3, derivative is:
    //   C'(t) = 3((P1-P0)(1-t)² + 2(P2-P1)t(1-t) + (P3-P2)t²)
    //
    // Falls back to the chord direction at endpoints where the
    // analytic derivative collapses to (0,0).
    public dxdyAtT(t: number): Vector
    {
        const fx = derivative_at_t_axis(this, 0, t);
        const fy = derivative_at_t_axis(this, 1, t);
        let result = new Vector(fx, fy);
        if (result.fX === 0 && result.fY === 0)
        {
            if (t === 0)       result = this.fPts[2].sub(this.fPts[0]);
            else if (t === 1)  result = this.fPts[3].sub(this.fPts[1]);
            if (result.fX === 0 && result.fY === 0 && zero_or_one(t))
            {
                result = this.fPts[3].sub(this.fPts[0]);
            }
        }
        return result;
    }

    // ----- root finding -----

    // RootsReal — full cubic formula. Solves Ax³ + Bx² + Cx + D = 0.
    // Returns the number of real roots (1, 2, or 3) written into s[].
    //
    // Edge cases handled in order:
    //   1. A ≈ 0 and small relative to B/C/D → degenerate to quadratic
    //   2. D ≈ 0 → 0 is one root; solve the residual quadratic for the others
    //   3. A + B + C + D ≈ 0 → 1 is one root; same shape
    //   4. General case — trigonometric formula via Q, R, theta
    //
    // Cardano-style formula:
    //   normalise to t³ + at² + bt + c = 0
    //   substitute t = x - a/3 → depressed cubic x³ + Qx = R (no x² term)
    //   discriminant R²-Q³ < 0 → 3 real roots via cos(theta/3)
    //   discriminant ≥ 0 → 1 real root via cube root
    public static RootsReal(A: number, B: number, C: number, D: number, s: number[]): number
    {
        if (approximately_zero(A)
            && approximately_zero_when_compared_to(A, B)
            && approximately_zero_when_compared_to(A, C)
            && approximately_zero_when_compared_to(A, D))
            {
            return Quad.RootsReal(B, C, D, s);
        }
        if (approximately_zero_when_compared_to(D, A)
            && approximately_zero_when_compared_to(D, B)
            && approximately_zero_when_compared_to(D, C))
            {
            const quadRoots: [number, number] = [0, 0];
            const num = Quad.RootsReal(A, B, C, quadRoots);
            for (let i = 0; i < num; ++i)
            {
                if (approximately_zero(quadRoots[i]!))
                {
                    s[0] = quadRoots[0];
                    if (num > 1) s[1] = quadRoots[1];
                    return num;
                }
            }
            s[0] = quadRoots[0];
            if (num > 1) s[1] = quadRoots[1];
            s[num] = 0;
            return num + 1;
        }
        if (approximately_zero(A + B + C + D))
        {
            const quadRoots: [number, number] = [0, 0];
            const num = Quad.RootsReal(A, A + B, -D, quadRoots);
            for (let i = 0; i < num; ++i)
            {
                if (AlmostDequalUlps(quadRoots[i]!, 1))
                {
                    s[0] = quadRoots[0];
                    if (num > 1) s[1] = quadRoots[1];
                    return num;
                }
            }
            s[0] = quadRoots[0];
            if (num > 1) s[1] = quadRoots[1];
            s[num] = 1;
            return num + 1;
        }
        const invA = 1 / A;
        const a = B * invA;
        const b = C * invA;
        const c = D * invA;
        const a2 = a * a;
        const Q = (a2 - b * 3) / 9;
        const R = (2 * a2 * a - 9 * a * b + 27 * c) / 54;
        const R2 = R * R;
        const Q3 = Q * Q * Q;
        const R2MinusQ3 = R2 - Q3;
        const adiv3 = a / 3;
        let count = 0;
        if (R2MinusQ3 < 0)
        {
            // 3 real roots — trigonometric formula. acos input may
            // slip outside [-1, 1] due to round-off; clamp.
            const cosArg = Math.max(-1, Math.min(1, R / Math.sqrt(Q3)));
            const theta = Math.acos(cosArg);
            const neg2RootQ = -2 * Math.sqrt(Q);
            const r0 = neg2RootQ * Math.cos(theta / 3) - adiv3;
            s[count++] = r0;
            const r1 = neg2RootQ * Math.cos((theta + 2 * PI) / 3) - adiv3;
            if (!AlmostDequalUlps(r0, r1)) s[count++] = r1;
            const r2 = neg2RootQ * Math.cos((theta - 2 * PI) / 3) - adiv3;
            if (!AlmostDequalUlps(r0, r2) && (count === 1 || !AlmostDequalUlps(s[1]!, r2)))
            {
                s[count++] = r2;
            }
        }
        else
        {
            const sqrtR2MinusQ3 = Math.sqrt(R2MinusQ3);
            let At = Math.abs(R) + sqrtR2MinusQ3;
            At = Math.cbrt(At);
            if (R > 0) At = -At;
            if (At !== 0) At += Q / At;
            const r = At - adiv3;
            s[count++] = r;
            if (AlmostDequalUlps(R2, Q3))
            {
                const r2 = -At / 2 - adiv3;
                if (!AlmostDequalUlps(s[0]!, r2)) s[count++] = r2;
            }
        }
        return count;
    }

    // Solve cubic for roots in [0, 1]. Snaps near-edge values into 0/1
    // when slightly outside the range — matches Skia's SkPathOpsCubic
    // .cpp:382 closely (including the 0.00005 slack window past the
    // approximately_one_or_less check).
    public static RootsValidT(A: number, B: number, C: number, D: number, t: number[]): number
    {
        const s: [number, number, number] = [0, 0, 0];
        const realRoots = Cubic.RootsReal(A, B, C, D, s);
        let foundRoots = Quad.AddValidTs(s, realRoots, t);
        for (let index = 0; index < realRoots; ++index)
        {
            const tValue = s[index]!;
            if (!approximately_one_or_less(tValue) && between(1, tValue, 1.00005))
            {
                let alreadyHave = false;
                for (let idx2 = 0; idx2 < foundRoots; ++idx2)
                {
                    if (approximately_equal(t[idx2]!, 1)) { alreadyHave = true; break; }
                }
                if (!alreadyHave) t[foundRoots++] = 1;
            }
            else if (!approximately_zero_or_more(tValue) && between(-0.00005, tValue, 0))
            {
                let alreadyHave = false;
                for (let idx2 = 0; idx2 < foundRoots; ++idx2)
                {
                    if (approximately_equal(t[idx2]!, 0)) { alreadyHave = true; break; }
                }
                if (!alreadyHave) t[foundRoots++] = 0;
            }
        }
        return foundRoots;
    }

    // ----- power-basis conversion -----

    // Bezier control points P0,P1,P2,P3 → cubic-polynomial coefficients
    // for C(t) = At³ + Bt² + Ct + D. Layout matches SkPathOpsCubic.cpp
    // :134 — `A` is the leading t³ coefficient, `D` is the constant.
    public static Coefficients(p0: number, p1: number, p2: number, p3: number)
        : { A: number, B: number, C: number, D: number }
    {
        let A = p3;
        let B = p2 * 3;
        let C = p1 * 3;
        const D = p0;
        A -= D - C + B;
        B += 3 * D - 2 * C;
        C -= 3 * D;
        return { A, B, C, D };
    }

    // FindExtrema: solve C'(t) = 0 for the scalar coordinate
    // [p0, p1, p2, p3]. Returns 0/1/2 t-values in (0, 1).
    public static FindExtrema(p0: number, p1: number, p2: number, p3: number, tValues: number[]): number
    {
        const A = p3 - p0 + 3 * (p1 - p2);
        const B = 2 * (p0 - p1 - p1 + p2);
        const C = p1 - p0;
        return Quad.RootsValidT(A, B, C, tValues);
    }

    // findInflections: t-values where C''(t) × C'(t) = 0 (inflection
    // points of the cubic — where curvature changes sign).
    public findInflections(tValues: number[]): number
    {
        const Ax = this.fPts[1].fX - this.fPts[0].fX;
        const Ay = this.fPts[1].fY - this.fPts[0].fY;
        const Bx = this.fPts[2].fX - 2 * this.fPts[1].fX + this.fPts[0].fX;
        const By = this.fPts[2].fY - 2 * this.fPts[1].fY + this.fPts[0].fY;
        const Cx = this.fPts[3].fX + 3 * (this.fPts[1].fX - this.fPts[2].fX) - this.fPts[0].fX;
        const Cy = this.fPts[3].fY + 3 * (this.fPts[1].fY - this.fPts[2].fY) - this.fPts[0].fY;
        return Quad.RootsValidT(
            Bx * Cy - By * Cx,
            Ax * Cy - Ay * Cx,
            Ax * By - Ay * Bx,
            tValues,
        );
    }

    // findMaxCurvature: t-values where F'·F'' = 0 (curvature extrema).
    // Combines the F'·F'' coefficient polynomials of X and Y components
    // and feeds them to the cubic root finder. Mirrors
    // SkPathOpsCubic.cpp:580.
    public findMaxCurvature(tValues: number[]): number
    {
        const coeffX: [number, number, number, number] = [0, 0, 0, 0];
        const coeffY: [number, number, number, number] = [0, 0, 0, 0];
        formulate_F1DotF2(this, 0, coeffX);
        formulate_F1DotF2(this, 1, coeffY);
        const c0 = coeffX[0] + coeffY[0];
        const c1 = coeffX[1] + coeffY[1];
        const c2 = coeffX[2] + coeffY[2];
        const c3 = coeffX[3] + coeffY[3];
        return Cubic.RootsValidT(c0, c1, c2, c3, tValues);
    }

    // binarySearch: locate the t in [min, max] where the cubic's
    // chosen-axis coordinate equals `axisIntercept`. Used by searchRoots
    // as the refinement step when the polynomial root finder produces a
    // t whose evaluated point misses the axis line by more than ULP
    // tolerance (typically because the polynomial is near-degenerate
    // for the intended root). Returns -1 if no such t exists within the
    // interval — the inner approximately_equal_half check catches a
    // step's worth of t producing the same float-rounded point twice.
    //
    // Mirrors SkPathOpsCubic.cpp:binarySearch (~line 295).
    public binarySearch(min: number, max: number, axisIntercept: number, xAxis: SearchAxis): number
    {
        let t = (min + max) / 2;
        let step = (t - min) / 2;
        let cubicAtT = this.ptAtT(t);
        const coordOf = (p: Point) => xAxis === SearchAxis.kXAxis ? p.fX : p.fY;
        let calcPos  = coordOf(cubicAtT);
        let calcDist = calcPos - axisIntercept;
        do
        {
            const priorT = Math.max(min, t - step);
            const lessPt = this.ptAtT(priorT);
            if (approximately_equal_half(lessPt.fX, cubicAtT.fX)
                && approximately_equal_half(lessPt.fY, cubicAtT.fY))
                {
                return -1; // binary search found no point at this axis intercept
            }
            const lessDist = coordOf(lessPt) - axisIntercept;
            const lastStep = step;
            step /= 2;
            if (calcDist > 0 ? calcDist > lessDist : calcDist < lessDist)
            {
                t = priorT;
            }
            else
            {
                const nextT = t + lastStep;
                if (nextT > max) return -1;
                const morePt = this.ptAtT(nextT);
                if (approximately_equal_half(morePt.fX, cubicAtT.fX)
                    && approximately_equal_half(morePt.fY, cubicAtT.fY))
                    {
                    return -1;
                }
                const moreDist = coordOf(morePt) - axisIntercept;
                if (calcDist > 0 ? calcDist <= moreDist : calcDist >= moreDist) continue;
                t = nextT;
            }
            const testAtT = this.ptAtT(t);
            cubicAtT = testAtT;
            calcPos = coordOf(cubicAtT);
            calcDist = calcPos - axisIntercept;
        } while (!approximately_equal(calcPos, axisIntercept));
        return t;
    }

    // searchRoots: monotonic-interval refinement of the polynomial root
    // finder. When `RootsValidT` gives a coarse-grained t whose evaluated
    // point misses the axis, split the curve at its extrema + inflections
    // and binarySearch each monotonic sub-interval for a real crossing.
    //
    // Mirrors SkPathOpsCubic.cpp:searchRoots (~line 765).
    public searchRoots(
        extremeTs: number[], extremaIn: number, axisIntercept: number,
        xAxis: SearchAxis, validRoots: number[],
    ): number
    {
        let extrema = extremaIn + this.findInflections(extremeTs.slice(extremaIn));
        // findInflections wrote into a SLICE; merge back.
        for (let i = extremaIn; i < extrema; ++i)
        {
            extremeTs[i] = extremeTs.slice(extremaIn)[i - extremaIn]!;
        }
        extremeTs[extrema++] = 0;
        extremeTs[extrema]   = 1;
        if (extrema >= 6) throw new Error('Cubic.searchRoots: extrema overflow');
        // Stable in-place sort over [0, extrema].
        const head = extremeTs.slice(0, extrema + 1).sort((a, b) => a - b);
        for (let i = 0; i <= extrema; ++i) extremeTs[i] = head[i]!;
        let validCount = 0;
        for (let index = 0; index < extrema; )
        {
            const min = extremeTs[index]!;
            const max = extremeTs[++index]!;
            if (min === max) continue;
            const newT = this.binarySearch(min, max, axisIntercept, xAxis);
            if (newT >= 0)
            {
                if (validCount >= 3) return 0;
                validRoots[validCount++] = newT;
            }
        }
        return validCount;
    }

    // top: track the topmost (smallest fY, with smaller fX as tie-break)
    // point along the curve over [startT, endT]. Returns the t-value of
    // the winner and writes the point into topPt. Returns -1 if no
    // extremum found.
    public top(dCurve: Cubic, startT: number, endT: number, topPt: Point): number
    {
        const extremeTs: number[] = [];
        let topT = -1;
        const roots = Cubic.FindExtrema(
            this.fPts[0].fY, this.fPts[1].fY, this.fPts[2].fY, this.fPts[3].fY,
            extremeTs,
        );
        for (let index = 0; index < roots; ++index)
        {
            const t = startT + (endT - startT) * extremeTs[index]!;
            const mid = dCurve.ptAtT(t);
            if (topPt.fY > mid.fY || (topPt.fY === mid.fY && topPt.fX > mid.fX))
            {
                topT = t;
                topPt.fX = mid.fX;
                topPt.fY = mid.fY;
            }
        }
        return topT;
    }

    // ----- subdivision -----

    // chopAt(t): split into two cubics meeting at t. Special-cases
    // t == 0.5 with closed-form expressions to maximise precision.
    public chopAt(t: number): CubicPair
    {
        const dst = new CubicPair();
        if (t === 0.5)
        {
            dst.pts[0] = this.fPts[0];
            dst.pts[1].fX = (this.fPts[0].fX + this.fPts[1].fX) / 2;
            dst.pts[1].fY = (this.fPts[0].fY + this.fPts[1].fY) / 2;
            dst.pts[2].fX = (this.fPts[0].fX + 2 * this.fPts[1].fX + this.fPts[2].fX) / 4;
            dst.pts[2].fY = (this.fPts[0].fY + 2 * this.fPts[1].fY + this.fPts[2].fY) / 4;
            dst.pts[3].fX = (this.fPts[0].fX + 3 * (this.fPts[1].fX + this.fPts[2].fX) + this.fPts[3].fX) / 8;
            dst.pts[3].fY = (this.fPts[0].fY + 3 * (this.fPts[1].fY + this.fPts[2].fY) + this.fPts[3].fY) / 8;
            dst.pts[4].fX = (this.fPts[1].fX + 2 * this.fPts[2].fX + this.fPts[3].fX) / 4;
            dst.pts[4].fY = (this.fPts[1].fY + 2 * this.fPts[2].fY + this.fPts[3].fY) / 4;
            dst.pts[5].fX = (this.fPts[2].fX + this.fPts[3].fX) / 2;
            dst.pts[5].fY = (this.fPts[2].fY + this.fPts[3].fY) / 2;
            dst.pts[6] = this.fPts[3];
            return dst;
        }
        interp_cubic_chop(this, 0, dst.pts, t);
        interp_cubic_chop(this, 1, dst.pts, t);
        return dst;
    }

    // subDivide(t1, t2): extract sub-curve covering parameters
    // [t1, t2]. Three-step algebra documented in SkPathOpsCubic.cpp
    // :610-654: compute endpoints by direct evaluation, then sample
    // two extra reference points at (2t1+t2)/3 and (t1+2t2)/3 to back
    // out the missing inner controls.
    public subDivide(t1: number, t2: number): Cubic
    {
        if (t1 === 0 || t2 === 1)
        {
            if (t1 === 0 && t2 === 1) return this;
            const pair = this.chopAt(t1 === 0 ? t2 : t1);
            return t1 === 0 ? pair.first() : pair.second();
        }
        const dst = new Cubic();
        const ax = dst.fPts[0].fX = interp_cubic_full(this, 0, t1);
        const ay = dst.fPts[0].fY = interp_cubic_full(this, 1, t1);
        const ex = interp_cubic_full(this, 0, (t1 * 2 + t2) / 3);
        const ey = interp_cubic_full(this, 1, (t1 * 2 + t2) / 3);
        const fx = interp_cubic_full(this, 0, (t1 + t2 * 2) / 3);
        const fy = interp_cubic_full(this, 1, (t1 + t2 * 2) / 3);
        const dx = dst.fPts[3].fX = interp_cubic_full(this, 0, t2);
        const dy = dst.fPts[3].fY = interp_cubic_full(this, 1, t2);
        const mx = ex * 27 - ax * 8 - dx;
        const my = ey * 27 - ay * 8 - dy;
        const nx = fx * 27 - ax - dx * 8;
        const ny = fy * 27 - ay - dy * 8;
        dst.fPts[1].fX = (mx * 2 - nx) / 18;
        dst.fPts[1].fY = (my * 2 - ny) / 18;
        dst.fPts[2].fX = (nx * 2 - mx) / 18;
        dst.fPts[2].fY = (ny * 2 - my) / 18;
        return dst;
    }

    // ----- convex hull (from SkOpCubicHull.cpp:60) -----
    //
    // Given a cubic, find the convex hull described by the end and
    // control points. Hull has 3 or 4 points. Degenerate cubics
    // (collapsed to a point or line) are not considered.
    //
    // Writes hull indices into `order[]` in winding order; returns the
    // hull point count (3 or 4).
    public convexHull(order: number[]): number
    {
        // Find topmost point (smallest fY, ties broken by smaller fX).
        const pts = this.fPts;
        let yMin = 0;
        for (let i = 1; i < 4; ++i)
        {
            if (pts[yMin]!.fY > pts[i]!.fY
                || (pts[yMin]!.fY === pts[i]!.fY
                    && pts[yMin]!.fX > pts[i]!.fX))
                    {
                yMin = i;
            }
        }
        order[0] = yMin;
        let midX = -1;
        let backupYMin = -1;
        for (let pass = 0; pass < 2; ++pass)
        {
            for (let index = 0; index < 4; ++index)
            {
                if (index === yMin) continue;
                const mask = other_two(yMin, index);
                const side1 = yMin ^ mask;
                const side2 = index ^ mask;
                const rotPath = new Cubic(
                    new Point(this.fPts[0].fX, this.fPts[0].fY),
                    new Point(this.fPts[1].fX, this.fPts[1].fY),
                    new Point(this.fPts[2].fX, this.fPts[2].fY),
                    new Point(this.fPts[3].fX, this.fPts[3].fY),
                );
                if (!rotate_into(this, yMin, index, rotPath))
                {
                    order[1] = side1;
                    order[2] = side2;
                    return 3;
                }
                let sides = side(rotPath.fPts[side1]!.fY - rotPath.fPts[yMin]!.fY);
                sides ^= side(rotPath.fPts[side2]!.fY - rotPath.fPts[yMin]!.fY);
                if (sides === 2)
                {
                    if (midX >= 0)
                    {
                        // Degenerate: control point coincides with an end point.
                        order[0] = 0;
                        order[1] = 3;
                        if (this.fPts[1].equals(this.fPts[0]) || this.fPts[1].equals(this.fPts[3]))
                        {
                            order[2] = 2;
                            return 3;
                        }
                        if (this.fPts[2].equals(this.fPts[0]) || this.fPts[2].equals(this.fPts[3]))
                        {
                            order[2] = 1;
                            return 3;
                        }
                        const dist1_0 = this.fPts[1].distanceSquared(this.fPts[0]);
                        const dist1_3 = this.fPts[1].distanceSquared(this.fPts[3]);
                        const dist2_0 = this.fPts[2].distanceSquared(this.fPts[0]);
                        const dist2_3 = this.fPts[2].distanceSquared(this.fPts[3]);
                        const smallest1 = Math.min(dist1_0, dist1_3);
                        const smallest2 = Math.min(dist2_0, dist2_3);
                        if (approximately_zero(Math.min(smallest1, smallest2)))
                        {
                            order[2] = smallest1 < smallest2 ? 2 : 1;
                            return 3;
                        }
                    }
                    midX = index;
                }
                else if (sides === 0)
                {
                    backupYMin = index;
                }
            }
            if (midX >= 0) break;
            if (backupYMin < 0) break;
            yMin = backupYMin;
            backupYMin = -1;
        }
        if (midX < 0) midX = yMin ^ 3;
        const mask = other_two(yMin, midX);
        const least = yMin ^ mask;
        const most  = midX ^ mask;
        order[0] = yMin;
        order[1] = least;
        const midPath = new Cubic(
            new Point(this.fPts[0].fX, this.fPts[0].fY),
            new Point(this.fPts[1].fX, this.fPts[1].fY),
            new Point(this.fPts[2].fX, this.fPts[2].fY),
            new Point(this.fPts[3].fX, this.fPts[3].fY),
        );
        if (!rotate_into(this, least, most, midPath))
        {
            order[2] = midX;
            return 3;
        }
        let midSides = side(midPath.fPts[yMin]!.fY - midPath.fPts[least]!.fY);
        midSides ^= side(midPath.fPts[midX]!.fY - midPath.fPts[least]!.fY);
        if (midSides !== 2)
        {
            order[2] = most;
            return 3;
        }
        order[2] = midX;
        order[3] = most;
        return 4;
    }

    // boundingRect(): axis-aligned bounding box. Endpoints first, then
    // expand to include x and y extrema. Mirrors Skia's
    // Rect::setBounds(Cubic).
    public boundingRect(): Rect
    {
        const rect = new Rect();
        rect.set(this.fPts[0]);
        rect.add(this.fPts[3]);
        const tValues: number[] = [];
        if (!this.monotonicInX())
        {
            const tx: number[] = [];
            const n = Cubic.FindExtrema(
                this.fPts[0].fX, this.fPts[1].fX, this.fPts[2].fX, this.fPts[3].fX, tx,
            );
            for (let i = 0; i < n; ++i) tValues.push(tx[i]!);
        }
        if (!this.monotonicInY())
        {
            const ty: number[] = [];
            const n = Cubic.FindExtrema(
                this.fPts[0].fY, this.fPts[1].fY, this.fPts[2].fY, this.fPts[3].fY, ty,
            );
            for (let i = 0; i < n; ++i) tValues.push(ty[i]!);
        }
        for (const t of tValues) rect.add(this.ptAtT(t));
        return rect;
    }

    // ── hull-intersection rejection (Phase 5) ──────────────────────
    //
    // Iterate the hull edges (consecutive vertices on the convex hull
    // of fPts[]). For each edge, find the two control points NOT on
    // the edge ("odd man" pair) and rotate them + the opposite curve's
    // points relative to the edge's line. If the opposite curve's
    // points all sit on the side AWAY from the odd-man pair, the
    // hulls don't intersect.
    //
    // *isLinear* is set when all hull-edge tests indicate the cubic's
    // hull is degenerately flat (a thick line).
    //
    // Mirrors SkPathOpsCubic.cpp:158. Overloads route through this
    // ptCount-parameterised core: hullIntersects(c2) passes ptCount=4,
    // hullIntersects(quad) passes ptCount=3.
    public hullIntersectsPts(pts: readonly Point[], ptCount: number, isLinear: { value: boolean }): boolean
    {
        let linear = true;
        const hullOrder: number[] = [0, 0, 0, 0];
        const hullCount = this.convexHull(hullOrder);
        let end1 = hullOrder[0]!;
        let hullIndex = 0;
        let endPt0: Point = this.fPts[end1 as 0|1|2|3]!;
        do
        {
            hullIndex = (hullIndex + 1) % hullCount;
            const end2 = hullOrder[hullIndex]!;
            const endPt1: Point = this.fPts[end2 as 0|1|2|3]!;
            const origX = endPt0.fX;
            const origY = endPt0.fY;
            const adj = endPt1.fX - origX;
            const opp = endPt1.fY - origY;
            const oddManMask = other_two(end1, end2);
            const oddMan = end1 ^ oddManMask;
            let sign = (this.fPts[oddMan as 0|1|2|3]!.fY - origY) * adj
                     - (this.fPts[oddMan as 0|1|2|3]!.fX - origX) * opp;
            const oddMan2 = end2 ^ oddManMask;
            const sign2 = (this.fPts[oddMan2 as 0|1|2|3]!.fY - origY) * adj
                        - (this.fPts[oddMan2 as 0|1|2|3]!.fX - origX) * opp;
            if (sign * sign2 < 0) continue;
            if (approximately_zero(sign))
            {
                sign = sign2;
                if (approximately_zero(sign)) continue;
            }
            linear = false;
            let foundOutlier = false;
            for (let n = 0; n < ptCount; ++n)
            {
                const test = (pts[n]!.fY - origY) * adj
                           - (pts[n]!.fX - origX) * opp;
                if (test * sign > 0 && !precisely_zero_cubic_pathops(test))
                {
                    foundOutlier = true;
                    break;
                }
            }
            if (!foundOutlier) return false;
            endPt0 = endPt1;
            end1 = end2;
        } while (hullIndex);
        isLinear.value = linear;
        return true;
    }

    public hullIntersects(c2: Cubic, isLinear: { value: boolean }): boolean
    {
        return this.hullIntersectsPts(c2.fPts, Cubic.kPointCount, isLinear);
    }

    public hullIntersectsQuad(q: Quad, isLinear: { value: boolean }): boolean
    {
        return this.hullIntersectsPts(q.fPts, 3, isLinear);
    }
}

function precisely_zero_cubic_pathops(x: number): boolean
{
    return Math.abs(x) < 2.2204460492503131e-16;
}

// ----- module-private helpers -----

// Cubic derivative scalar formula. Mirrors derivative_at_t in
// SkPathOpsCubic.cpp:245, parameterised by axis so we can call it for
// x or y without juggling pointers.
function derivative_at_t_axis(c: Cubic, axis: 0 | 1, t: number): number
{
    const k = axis === 0 ? 'fX' : 'fY';
    const one_t = 1 - t;
    const a = c.fPts[0][k];
    const b = c.fPts[1][k];
    const cd = c.fPts[2][k];
    const d = c.fPts[3][k];
    return 3 * ((b - a) * one_t * one_t + 2 * (cd - b) * t * one_t + (d - cd) * t * t);
}

// One-T cubic subdivision: writes (P0, ab, abc, abcd, bcd, cd, P3) on
// the chosen axis into the 7-point dst.pts buffer. Mirrors
// interp_cubic_coords in SkPathOpsCubic.cpp:94.
function interp_cubic_chop(
    c: Cubic, axis: 0 | 1,
    dstPts: [Point, Point, Point, Point, Point, Point, Point],
    t: number,
): void
{
    const k = axis === 0 ? 'fX' : 'fY';
    const src0 = c.fPts[0][k];
    const src2 = c.fPts[1][k];
    const src4 = c.fPts[2][k];
    const src6 = c.fPts[3][k];
    const ab = Interp(src0, src2, t);
    const bc = Interp(src2, src4, t);
    const cd = Interp(src4, src6, t);
    const abc = Interp(ab, bc, t);
    const bcd = Interp(bc, cd, t);
    const abcd = Interp(abc, bcd, t);
    dstPts[0][k] = src0;
    dstPts[1][k] = ab;
    dstPts[2][k] = abc;
    dstPts[3][k] = abcd;
    dstPts[4][k] = bcd;
    dstPts[5][k] = cd;
    dstPts[6][k] = src6;
}

// Scalar-only one-T evaluation. Same de Casteljau cascade as
// interp_cubic_chop, returns only the abcd (sample point) value
// without recording the intermediates. Mirrors interp_cubic_coords in
// SkPathOpsCubic.cpp:656.
function interp_cubic_full(c: Cubic, axis: 0 | 1, t: number): number
{
    const k = axis === 0 ? 'fX' : 'fY';
    const src0 = c.fPts[0][k];
    const src2 = c.fPts[1][k];
    const src4 = c.fPts[2][k];
    const src6 = c.fPts[3][k];
    const ab = Interp(src0, src2, t);
    const bc = Interp(src2, src4, t);
    const cd = Interp(src4, src6, t);
    const abc = Interp(ab, bc, t);
    const bcd = Interp(bc, cd, t);
    return Interp(abc, bcd, t);
}

// F'·F'' coefficient polynomial. Used by findMaxCurvature.
// SkPathOpsCubic.cpp:539-547.
function formulate_F1DotF2(c: Cubic, axis: 0 | 1, coeff: number[]): void
{
    const k = axis === 0 ? 'fX' : 'fY';
    const a = c.fPts[1][k] - c.fPts[0][k];
    const b = c.fPts[2][k] - 2 * c.fPts[1][k] + c.fPts[0][k];
    const cd = c.fPts[3][k] + 3 * (c.fPts[1][k] - c.fPts[2][k]) - c.fPts[0][k];
    coeff[0] = cd * cd;
    coeff[1] = 3 * b * cd;
    coeff[2] = 2 * b * b + cd * a;
    coeff[3] = a * b;
}

// "Rotate" the cubic so that the chord from `cubic[zero]` to
// `cubic[index]` lies along the X axis. Used by convexHull to decide
// which side of a chord the other two control points fall on. Returns
// false when the chord has zero length (degenerate input). Mirrors
// `rotate` in SkOpCubicHull.cpp:14.
function rotate_into(cubic: Cubic, zero: number, index: number, rotPath: Cubic): boolean
{
    const cp = cubic.fPts;
    const rp = rotPath.fPts;
    const dy = cp[index]!.fY - cp[zero]!.fY;
    const dx = cp[index]!.fX - cp[zero]!.fX;
    if (approximately_zero(dy))
    {
        if (approximately_zero(dx)) return false;
        for (let i = 0; i < 4; ++i)
        {
            rp[i]!.fX = cp[i]!.fX;
            rp[i]!.fY = cp[i]!.fY;
        }
        if (dy !== 0)
        {
            rp[index]!.fY = cp[zero]!.fY;
            const mask = other_two(index, zero);
            const side1 = index ^ mask;
            const side2 = zero ^ mask;
            if (approximately_equal(cp[side1]!.fY, cp[zero]!.fY))
            {
                rp[side1]!.fY = cp[zero]!.fY;
            }
            if (approximately_equal(cp[side2]!.fY, cp[zero]!.fY))
            {
                rp[side2]!.fY = cp[zero]!.fY;
            }
        }
        return true;
    }
    for (let i = 0; i < 4; ++i)
    {
        rp[i]!.fX = cp[i]!.fX * dx + cp[i]!.fY * dy;
        rp[i]!.fY = cp[i]!.fY * dx - cp[i]!.fX * dy;
    }
    return true;
}

// 0 if negative, 1 if zero, 2 if positive. Mirrors `side` in
// SkOpCubicHull.cpp:45.
function side(x: number): number
{
    return (x > 0 ? 1 : 0) + (x >= 0 ? 1 : 0);
}
