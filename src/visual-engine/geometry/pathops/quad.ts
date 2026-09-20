// Copyright 2012 Google Inc.
//
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE-skia file at the root of this repository.
//
// TypeScript port: 2026 Eugene Napryaglo.
// Source: third_party/skia/src/pathops/SkPathOpsQuad.{h,cpp}
//         (Skia commit pinned in third_party/skia)
//
// Quadratic Bézier curve in double precision. Three control points
// stored in `fPts[0..2]`, where fPts[0] / fPts[2] are the curve's
// endpoints and fPts[1] is the control handle.
//
// Phase 1 scope: curve algebra only — point evaluation, derivative,
// monotonicity, subdivision, the quadratic-formula root finder, and
// the FindExtrema / SetABC helpers used by bounds computation. The
// hull-intersection family (hullIntersects, isLinear, subDivide(a,
// c, …)) depends on SkLineParameters + SkIntersections which arrive
// in Phase 5; placeholders are out of scope here.
//
// The `SkTQuad` adapter (SkTCurve subclass used by the T-section
// graph) lands in Phase 6 when the SkTCurve abstract base ports over.

import { Point, Vector } from './point.js';
import { Rect } from './rect.js';
import {
    AlmostDequalUlps,
    Interp,
    approximately_equal,
    approximately_greater_than_one,
    approximately_less_than_zero,
    approximately_one_or_less,
    approximately_zero,
    approximately_zero_inverse,
    approximately_zero_or_more,
    between,
    zero_or_one,
} from './types.js';

// A chopped quadratic — five points arranged so [0..2] is the first
// half and [2..4] is the second half (the shared middle point sits at
// pts[2]). Mirrors Skia's QuadPair struct.
export class QuadPair
{
    public pts: [Point, Point, Point, Point, Point];

    constructor()
    {
        this.pts = [
            new Point(), new Point(), new Point(),
            new Point(), new Point(),
        ];
    }

    public first(): Quad
    {
        const q = new Quad();
        q.fPts = [this.pts[0], this.pts[1], this.pts[2]];
        return q;
    }

    public second(): Quad
    {
        const q = new Quad();
        q.fPts = [this.pts[2], this.pts[3], this.pts[4]];
        return q;
    }
}

export class Quad
{
    public static readonly kPointCount = 3;
    public static readonly kPointLast = 2;
    public static readonly kMaxIntersections = 4;

    public fPts: [Point, Point, Point];

    constructor(p0?: Point, p1?: Point, p2?: Point)
    {
        this.fPts = [p0 ?? new Point(), p1 ?? new Point(), p2 ?? new Point()];
    }

    // True when every control collapses to (approximately) one point.
    // Used by the boolean engine to discard degenerate input.
    public collapsed(): boolean
    {
        return this.fPts[0].approximatelyEqual(this.fPts[1])
            && this.fPts[0].approximatelyEqual(this.fPts[2]);
    }

    // True when the control point projects between (rather than past)
    // the endpoints along the chord direction — i.e. the curve is a
    // normal arched quadratic, not an "S-shape" or crossing form.
    public controlsInside(): boolean
    {
        const v01 = this.fPts[0].sub(this.fPts[1]);
        const v02 = this.fPts[0].sub(this.fPts[2]);
        const v12 = this.fPts[1].sub(this.fPts[2]);
        return v02.dot(v01) > 0 && v02.dot(v12) > 0;
    }

    // Reverse traversal direction (swap endpoints, control unchanged).
    public flip(): Quad
    {
        return new Quad(this.fPts[2], this.fPts[1], this.fPts[0]);
    }

    // otherPts: for an `oddMan` index in [0..2], returns the two
    // remaining control points in fPts[] (order: smaller index first
    // when oddMan is in the middle, otherwise natural order). Used by
    // hull-intersection rejection in the intersection routines.
    // Mirrors the bit-twiddling table in SkPathOpsQuad.cpp:99-114.
    public otherPts(oddMan: number): [Point, Point]
    {
        const result: Point[] = [];
        for (let opp = 1; opp < Quad.kPointCount; ++opp)
        {
            let end = (oddMan ^ opp) - oddMan;
            end &= ~(end >> 2); // negative → 0
            result.push(this.fPts[end as 0 | 1 | 2]);
        }
        return [result[0]!, result[1]!];
    }

    // ----- root finding -----
    //
    // RootsReal solves Ax² + Bx + C = 0 using the Numeric Solutions §5.6
    // formulation: compute p = B/(2A), q = C/A, then x = -p ± √(p² - q).
    // This avoids the catastrophic cancellation in the schoolbook
    // (-b ± √(b² - 4ac)) / 2a formula when b² is much larger than 4ac.
    //
    // Returns the number of real roots written into s[]. The same root
    // may be written twice in the s[0..1] buffer; callers should pin
    // duplicates via AddValidTs / AlmostDequalUlps.
    public static RootsReal(A: number, B: number, C: number, s: number[]): number
    {
        if (A === 0) return Quad.handle_zero(B, C, s);
        const p = B / (2 * A);
        const q = C / A;
        if (approximately_zero(A) && (approximately_zero_inverse(p) || approximately_zero_inverse(q)))
        {
            return Quad.handle_zero(B, C, s);
        }
        const p2 = p * p;
        if (!AlmostDequalUlps(p2, q) && p2 < q)
        {
            // No real roots — discriminant negative.
            return 0;
        }
        let sqrt_D = 0;
        if (p2 > q) sqrt_D = Math.sqrt(p2 - q);
        s[0] =  sqrt_D - p;
        s[1] = -sqrt_D - p;
        return 1 + (AlmostDequalUlps(s[0]!, s[1]!) ? 0 : 1);
    }

    // Linear-degenerate fallback when A=0: equation becomes Bx + C = 0.
    private static handle_zero(B: number, C: number, s: number[]): number
    {
        if (approximately_zero(B))
        {
            s[0] = 0;
            return C === 0 ? 1 : 0;
        }
        s[0] = -C / B;
        return 1;
    }

    // Filter raw roots into the [0, 1] T-range with deduplication.
    // Snaps roots within FLT_EPSILON of an endpoint to exactly 0 or 1.
    public static AddValidTs(s: number[], realRoots: number, t: number[]): number
    {
        let foundRoots = 0;
        outer:
        for (let index = 0; index < realRoots; ++index)
        {
            let tValue = s[index]!;
            if (approximately_zero_or_more(tValue) && approximately_one_or_less(tValue))
            {
                if (approximately_less_than_zero(tValue))
                {
                    tValue = 0;
                }
                else if (approximately_greater_than_one(tValue))
                {
                    tValue = 1;
                }
                for (let idx2 = 0; idx2 < foundRoots; ++idx2)
                {
                    if (approximately_equal(t[idx2]!, tValue)) continue outer;
                }
                t[foundRoots++] = tValue;
            }
        }
        return foundRoots;
    }

    // Combined: solve Ax² + Bx + C = 0 and return only roots in [0, 1].
    public static RootsValidT(A: number, B: number, C: number, t: number[]): number
    {
        const s: number[] = [0, 0];
        const realRoots = Quad.RootsReal(A, B, C, s);
        return Quad.AddValidTs(s, realRoots, t);
    }

    // ----- evaluation -----

    // ptAtT: evaluate the quadratic at parameter t using the Bernstein
    // basis. Short-circuits the endpoints for exact preservation.
    public ptAtT(t: number): Point
    {
        if (t === 0) return this.fPts[0];
        if (t === 1) return this.fPts[2];
        const one_t = 1 - t;
        const a = one_t * one_t;
        const b = 2 * one_t * t;
        const c = t * t;
        return new Point(
            a * this.fPts[0].fX + b * this.fPts[1].fX + c * this.fPts[2].fX,
            a * this.fPts[0].fY + b * this.fPts[1].fY + c * this.fPts[2].fY,
        );
    }

    // dxdyAtT: derivative dQ/dt at parameter t. For Quad(t) =
    // (1-t)²·P0 + 2(1-t)t·P1 + t²·P2, derivative is:
    //   Q'(t) = 2((t-1)·P0 + (1-2t)·P1 + t·P2)
    // (the factor of 2 is dropped in Skia's port since derivative
    // direction matters more than magnitude in the typical caller —
    // matches the C++ source line-for-line).
    public dxdyAtT(t: number): Vector
    {
        const a = t - 1;
        const b = 1 - 2 * t;
        const c = t;
        const result = new Vector(
            a * this.fPts[0].fX + b * this.fPts[1].fX + c * this.fPts[2].fX,
            a * this.fPts[0].fY + b * this.fPts[1].fY + c * this.fPts[2].fY,
        );
        if (result.fX === 0 && result.fY === 0)
        {
            // Degenerate: derivative collapses to (0,0). At the
            // endpoints, fall back to the chord direction.
            if (zero_or_one(t))
            {
                return this.fPts[2].sub(this.fPts[0]);
            }
            // Skia logs "!q" in debug; we silently leave (0,0) here —
            // callers in Phase 1 don't depend on this branch.
        }
        return result;
    }

    // True iff x-coordinates are non-strictly monotonic along the
    // control polygon (so the curve cannot have an x-extremum strictly
    // inside the parameter range).
    public monotonicInX(): boolean
    {
        return between(this.fPts[0].fX, this.fPts[1].fX, this.fPts[2].fX);
    }

    public monotonicInY(): boolean
    {
        return between(this.fPts[0].fY, this.fPts[1].fY, this.fPts[2].fY);
    }

    // ----- subdivision -----

    // subDivide(t1, t2): extract the sub-curve covering parameters
    // [t1, t2]. Computes endpoints by evaluating at t1/t2, then derives
    // the control point from a midpoint sample using the algebra
    // documented in SkPathOpsQuad.cpp:261-282.
    public subDivide(t1: number, t2: number): Quad
    {
        if (t1 === 0 && t2 === 1) return this;
        const dst = new Quad();
        const ax = dst.fPts[0].fX = interp_quad_coords_scalar(this, /*axis*/ 0, t1);
        const ay = dst.fPts[0].fY = interp_quad_coords_scalar(this, /*axis*/ 1, t1);
        const dx = interp_quad_coords_scalar(this, 0, (t1 + t2) / 2);
        const dy = interp_quad_coords_scalar(this, 1, (t1 + t2) / 2);
        const cx = dst.fPts[2].fX = interp_quad_coords_scalar(this, 0, t2);
        const cy = dst.fPts[2].fY = interp_quad_coords_scalar(this, 1, t2);
        dst.fPts[1].fX = 2 * dx - (ax + cx) / 2;
        dst.fPts[1].fY = 2 * dy - (ay + cy) / 2;
        return dst;
    }

    // chopAt(t): split the curve into two halves at parameter t.
    // The two halves share the curve point at t (pts[2] in the pair).
    public chopAt(t: number): QuadPair
    {
        const dst = new QuadPair();
        interp_quad_chop(this, /*axis*/ 0, dst.pts, t);
        interp_quad_chop(this, /*axis*/ 1, dst.pts, t);
        return dst;
    }

    // align: when an endpoint shares an exact x or y with the control
    // point, snap dstPt to that exact value. Used during subdivision
    // to preserve axis-aligned chord directions.
    public align(endIndex: number, dstPt: Point): void
    {
        const end = this.fPts[endIndex as 0 | 1 | 2];
        if (end.fX === this.fPts[1].fX) dstPt.fX = end.fX;
        if (end.fY === this.fPts[1].fY) dstPt.fY = end.fY;
    }

    // ----- extrema & bounds -----

    // FindExtrema: solves Q'(t) = 0 for the scalar coordinate sampled
    // at src[0], src[2], src[4] (interleaved x,y storage in Skia). For
    // our TS port the caller passes the three coordinate values
    // directly. Returns 1 if there's a valid extremum in (0, 1),
    // writing it to tValue[0]; 0 otherwise.
    public static FindExtrema(a: number, b: number, c: number, tValue: number[]): number
    {
        return valid_unit_divide(a - b, a - b - b + c, tValue);
    }

    // SetABC: convert Bernstein-form control coordinates [P0, P1, P2]
    // into power-basis coefficients [a, b, c] such that the curve at
    // parameter t equals a·t² + b·t + c (interpreted as Q(t) =
    // C(1-t)² + 2B(1-t)t + At², rearranged in the comments below).
    //
    //  Q(t) = A·t² + 2B·t·(1-t) + C·(1-t)²
    //       = (A - 2B + C)·t² + (2B - 2C)·t + C
    //
    //   a = A - 2B + C       b = 2B - 2C       c = C
    public static SetABC(p0: number, p1: number, p2: number): { a: number, b: number, c: number }
    {
        let a = p0;
        let b = 2 * p1;
        const c = p2;
        b -= c;
        a -= b;
        b -= c;
        return { a, b, c };
    }

    // boundingRect(): axis-aligned bounding box. Reproduces Skia's
    // Rect::setBounds(Quad) — start with the endpoints, then
    // expand to include each axis-extremum point.
    public boundingRect(): Rect
    {
        const rect = new Rect();
        rect.set(this.fPts[0]);
        rect.add(this.fPts[2]);
        const tValues: number[] = [];
        if (!this.monotonicInX())
        {
            const tx: [number] = [0];
            if (Quad.FindExtrema(this.fPts[0].fX, this.fPts[1].fX, this.fPts[2].fX, tx))
            {
                tValues.push(tx[0]);
            }
        }
        if (!this.monotonicInY())
        {
            const ty: [number] = [0];
            if (Quad.FindExtrema(this.fPts[0].fY, this.fPts[1].fY, this.fPts[2].fY, ty))
            {
                tValues.push(ty[0]);
            }
        }
        for (const t of tValues) rect.add(this.ptAtT(t));
        return rect;
    }

    // ── hull-intersection rejection (Phase 5) ──────────────────────
    //
    // Quick reject for the SkTSect bisection: rotate every control
    // point of `this` relative to a line through two of `this`'s
    // points; if the "odd man out" lies on one side of the line and
    // all of q2's points lie on the OPPOSITE side, the hulls don't
    // intersect (so the curves can't either).
    //
    // Returns true if the hulls might intersect; *isLinear* is set
    // true when the hull degenerates to a line (the rotation found no
    // odd man on either side, meaning all control points are
    // collinear). Mirrors SkPathOpsQuad.cpp:53.
    public hullIntersects(q2: Quad, isLinear: { value: boolean }): boolean
    {
        let linear = true;
        for (let oddMan = 0; oddMan < Quad.kPointCount; ++oddMan)
        {
            const endPt = this.otherPts(oddMan);
            const origX = endPt[0]!.fX;
            const origY = endPt[0]!.fY;
            const adj   = endPt[1]!.fX - origX;
            const opp   = endPt[1]!.fY - origY;
            const sign  = (this.fPts[oddMan as 0|1|2].fY - origY) * adj
                        - (this.fPts[oddMan as 0|1|2].fX - origX) * opp;
            if (approximately_zero_pathops(sign)) continue;
            linear = false;
            let foundOutlier = false;
            for (let n = 0; n < Quad.kPointCount; ++n)
            {
                const test = (q2.fPts[n as 0|1|2].fY - origY) * adj
                           - (q2.fPts[n as 0|1|2].fX - origX) * opp;
                if (test * sign > 0 && !precisely_zero_pathops(test))
                {
                    foundOutlier = true;
                    break;
                }
            }
            if (!foundOutlier) return false;
        }
        if (linear
            && !matchesQuadEnd(this.fPts, q2.fPts[0])
            && !matchesQuadEnd(this.fPts, q2.fPts[2]))
        {
            // Linear-degenerate hull: a quad whose three control points
            // are collinear is essentially a thick line. The hull-as-line
            // test misses an opposite-quad endpoint lying inside the
            // triangle (this hull is a degenerate triangle). Fall through
            // and check the triangle explicitly.
            if (pointInTriangleQuad(this.fPts, q2.fPts[0])
                || pointInTriangleQuad(this.fPts, q2.fPts[2]))
            {
                linear = false;
            }
        }
        isLinear.value = linear;
        return true;
    }
}

// ── module-private helpers used by hullIntersects ────────────────────

// Barycentric point-in-triangle test (from blackpawn.com/texts/pointinpoly).
// Skia inlines this in SkPathOpsQuad.cpp:21.
function pointInTriangleQuad(fPts: readonly Point[], test: Point): boolean
{
    const v0 = fPts[2]!.sub(fPts[0]!);
    const v1 = fPts[1]!.sub(fPts[0]!);
    const v2 = test.sub(fPts[0]!);
    const dot00 = v0.dot(v0);
    const dot01 = v0.dot(v1);
    const dot02 = v0.dot(v2);
    const dot11 = v1.dot(v1);
    const dot12 = v1.dot(v2);
    const denom = dot00 * dot11 - dot01 * dot01;
    const u = dot11 * dot02 - dot01 * dot12;
    const v = dot00 * dot12 - dot01 * dot02;
    if (denom >= 0) return u >= 0 && v >= 0 && u + v < denom;
    return u <= 0 && v <= 0 && u + v > denom;
}

function matchesQuadEnd(fPts: readonly Point[], test: Point): boolean
{
    return fPts[0]!.equals(test) || fPts[2]!.equals(test);
}

// Locally-named so we don't have to add to the import list above.
function approximately_zero_pathops(x: number): boolean
{
    return Math.abs(x) < 1.1920928955078125e-7;
}

function precisely_zero_pathops(x: number): boolean
{
    return Math.abs(x) < 2.2204460492503131e-16;
}

// ----- module-private interpolation helpers -----

// Evaluate one coordinate of the curve at t by twice-applied lerp.
// `axis` selects fX (0) or fY (1). Mirrors interp_quad_coords in
// SkPathOpsQuad.cpp:240, parameterised by axis so we can call it for x
// or y without juggling pointers like the C++ does.
function interp_quad_coords_scalar(q: Quad, axis: 0 | 1, t: number): number
{
    const k = axis === 0 ? 'fX' : 'fY';
    if (t === 0) return q.fPts[0][k];
    if (t === 1) return q.fPts[2][k];
    const ab  = Interp(q.fPts[0][k], q.fPts[1][k], t);
    const bc  = Interp(q.fPts[1][k], q.fPts[2][k], t);
    return Interp(ab, bc, t);
}

// Single-T subdivision: writes (P0, ab, abc, bc, P2) on `axis` into
// the 5-point dst.pts buffer of an QuadPair. Mirrors the second
// interp_quad_coords overload in SkPathOpsQuad.cpp:343.
function interp_quad_chop(
    q: Quad, axis: 0 | 1,
    dstPts: [Point, Point, Point, Point, Point],
    t: number,
): void
{
    const k = axis === 0 ? 'fX' : 'fY';
    const src0 = q.fPts[0][k];
    const src2 = q.fPts[1][k];
    const src4 = q.fPts[2][k];
    const ab = Interp(src0, src2, t);
    const bc = Interp(src2, src4, t);
    dstPts[0][k] = src0;
    dstPts[1][k] = ab;
    dstPts[2][k] = Interp(ab, bc, t);
    dstPts[3][k] = bc;
    dstPts[4][k] = src4;
}

// valid_unit_divide: numer/denom only if the result is strictly in
// (0, 1). Returns 1 if so, 0 otherwise. Used by FindExtrema. Mirrors
// SkPathOpsQuad.cpp:362.
function valid_unit_divide(numer: number, denom: number, ratio: number[]): number
{
    if (numer < 0) { numer = -numer; denom = -denom; }
    if (denom === 0 || numer === 0 || numer >= denom) return 0;
    const r = numer / denom;
    if (r === 0) return 0;
    ratio[0] = r;
    return 1;
}

