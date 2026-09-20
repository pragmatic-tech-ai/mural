// Copyright 2012 Google Inc.
//
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE-skia file at the root of this repository.
//
// TypeScript port: 2026 Eugene Napryaglo.
// Source: third_party/skia/src/pathops/SkPathOpsPoint.h
//         (Skia commit pinned in third_party/skia)
//
// Double-precision 2D point and vector. Skia distinguishes the two
// types so vector arithmetic (a - b → vector, p + v → point) can be
// expressed at the type level. Both store `fX` / `fY` as public
// mutable fields — pathops code reads and writes them directly.
//
// TypeScript doesn't have operator overloading, so the C++ operators
// are named methods:
//
//   C++                          TS
//   ──────────────────────────   ──────────────────────────
//   Vector v = a - b;         const v = a.sub(b);
//   p += v;                      p.addEq(v);
//   p -= v;                      p.subEq(v);
//   Point q = p + v;          const q = p.add(v);
//   v += w;                      v.addEqV(w);
//   v *= s;                      v.mulEq(s);
//   v /= s;                      v.divEq(s);
//
// Field names (fX / fY), method semantics, and ULPS-tolerant equality
// match Skia exactly so review against the C++ source is line-for-line.

import {
    AlmostDequalUlps,
    AlmostEqualUlps,
    AlmostEqualUlpsNoNormalCheck,
    AlmostPequalUlps,
    RoughlyEqualUlps,
    approximately_equal,
    approximately_zero,
    roughly_equal,
    roughly_zero_when_compared_to,
} from './types.js';

export class Vector
{
    public fX: number = 0;
    public fY: number = 0;

    constructor(x: number = 0, y: number = 0)
    {
        this.fX = x;
        this.fY = y;
    }

    // In-place v += w  (Skia operator+=).
    public addEqV(v: Vector): void
    {
        this.fX += v.fX;
        this.fY += v.fY;
    }

    // In-place v -= w  (Skia operator-=).
    public subEqV(v: Vector): void
    {
        this.fX -= v.fX;
        this.fY -= v.fY;
    }

    // In-place v /= s  (Skia operator/=).
    public divEq(s: number): void
    {
        this.fX /= s;
        this.fY /= s;
    }

    // In-place v *= s  (Skia operator*=).
    public mulEq(s: number): void
    {
        this.fX *= s;
        this.fY *= s;
    }

    // 2D cross product (z-component): a.x*b.y - a.y*b.x.
    public cross(a: Vector): number
    {
        return this.fX * a.fY - this.fY * a.fX;
    }

    // crossCheck: cross product that returns exactly 0 when the two
    // partial products agree within 16 ULPs (float precision). Used by
    // collinearity tests where the raw subtraction would otherwise
    // produce noise from finite-precision cancellation.
    public crossCheck(a: Vector): number
    {
        const xy = this.fX * a.fY;
        const yx = this.fY * a.fX;
        return AlmostEqualUlps(xy, yx) ? 0 : xy - yx;
    }

    // crossNoNormalCheck: same as crossCheck but the ULPS comparator
    // doesn't special-case denormals — used when we know inputs may be
    // very small and want to avoid the "denormals are equal" shortcut.
    public crossNoNormalCheck(a: Vector): number
    {
        const xy = this.fX * a.fY;
        const yx = this.fY * a.fX;
        return AlmostEqualUlpsNoNormalCheck(xy, yx) ? 0 : xy - yx;
    }

    public dot(a: Vector): number
    {
        return this.fX * a.fX + this.fY * a.fY;
    }

    public length(): number
    {
        return Math.sqrt(this.lengthSquared());
    }

    public lengthSquared(): number
    {
        return this.fX * this.fX + this.fY * this.fY;
    }

    // In-place normalize. JS divides yield Infinity on /0, matching
    // IEEE behaviour of Skia's sk_ieee_double_divide wrapper.
    public normalize(): Vector
    {
        const inverseLength = 1 / this.length();
        this.fX *= inverseLength;
        this.fY *= inverseLength;
        return this;
    }

    public isFinite(): boolean
    {
        return Number.isFinite(this.fX) && Number.isFinite(this.fY);
    }
}

export class Point
{
    public fX: number = 0;
    public fY: number = 0;

    constructor(x: number = 0, y: number = 0)
    {
        this.fX = x;
        this.fY = y;
    }

    // Skia operator- :  point - point → vector.
    public sub(b: Point): Vector
    {
        return new Vector(this.fX - b.fX, this.fY - b.fY);
    }

    // p += v
    public addEq(v: Vector): void
    {
        this.fX += v.fX;
        this.fY += v.fY;
    }

    // p -= v
    public subEq(v: Vector): void
    {
        this.fX -= v.fX;
        this.fY -= v.fY;
    }

    // p + v  (returns new point)
    public add(v: Vector): Point
    {
        return new Point(this.fX + v.fX, this.fY + v.fY);
    }

    // p - v  (returns new point)
    public subV(v: Vector): Point
    {
        return new Point(this.fX - v.fX, this.fY - v.fY);
    }

    // Equality predicate — note this is exact equality (`a.fX === b.fX
    // && a.fY === b.fY`), matching Skia's operator==. Use
    // approximatelyEqual / approximatelyDEqual for tolerant comparisons.
    public equals(b: Point): boolean
    {
        return this.fX === b.fX && this.fY === b.fY;
    }

    // approximatelyDEqual: "D" for "distance". The straightforward
    // `approximately_equal(fX, a.fX) && ...` form doesn't work because
    // it ignores magnitude — two large numbers can pass per-coordinate
    // approximately_equal but be far apart. Skia first checks the cheap
    // per-coord predicate, then falls back to ULP-comparing
    // (largest, largest + dist) where dist is the actual distance and
    // largest is max(|fX|, |fY|, |a.fX|, |a.fY|). If adding dist to
    // largest is within ULP tolerance of largest, the points are close
    // relative to their scale.
    public approximatelyDEqual(a: Point): boolean
    {
        if (approximately_equal(this.fX, a.fX) && approximately_equal(this.fY, a.fY))
        {
            return true;
        }
        if (!RoughlyEqualUlps(this.fX, a.fX) || !RoughlyEqualUlps(this.fY, a.fY))
        {
            return false;
        }
        const dist = this.distance(a);
        const tiniest = Math.min(this.fX, a.fX, this.fY, a.fY);
        let largest = Math.max(this.fX, a.fX, this.fY, a.fY);
        largest = Math.max(largest, -tiniest);
        return AlmostDequalUlps(largest, largest + dist);
    }

    // approximatelyEqual: same shape as approximatelyDEqual but uses
    // AlmostPequalUlps (ULP epsilon = 8) on the final distance check
    // instead of AlmostDequalUlps (epsilon = 16). Marginally stricter.
    public approximatelyEqual(a: Point): boolean
    {
        if (approximately_equal(this.fX, a.fX) && approximately_equal(this.fY, a.fY))
        {
            return true;
        }
        if (!RoughlyEqualUlps(this.fX, a.fX) || !RoughlyEqualUlps(this.fY, a.fY))
        {
            return false;
        }
        const dist = this.distance(a);
        const tiniest = Math.min(this.fX, a.fX, this.fY, a.fY);
        let largest = Math.max(this.fX, a.fX, this.fY, a.fY);
        largest = Math.max(largest, -tiniest);
        return AlmostPequalUlps(largest, largest + dist);
    }

    // Static form: ApproximatelyEqual on two raw point-like inputs.
    // Mirrors SkPathOpsPoint.h:197.
    public static ApproximatelyEqual(a: Point, b: Point): boolean
    {
        if (approximately_equal(a.fX, b.fX) && approximately_equal(a.fY, b.fY))
        {
            return true;
        }
        if (!RoughlyEqualUlps(a.fX, b.fX) || !RoughlyEqualUlps(a.fY, b.fY))
        {
            return false;
        }
        const dist = a.distance(b);
        const tiniest = Math.min(a.fX, b.fX, a.fY, b.fY);
        let largest = Math.max(a.fX, b.fX, a.fY, b.fY);
        largest = Math.max(largest, -tiniest);
        return AlmostDequalUlps(largest, largest + dist);
    }

    public approximatelyZero(): boolean
    {
        return approximately_zero(this.fX) && approximately_zero(this.fY);
    }

    public distance(a: Point): number
    {
        const temp = this.sub(a);
        return temp.length();
    }

    public distanceSquared(a: Point): number
    {
        const temp = this.sub(a);
        return temp.lengthSquared();
    }

    public static Mid(a: Point, b: Point): Point
    {
        return new Point((a.fX + b.fX) / 2, (a.fY + b.fY) / 2);
    }

    public roughlyEqual(a: Point): boolean
    {
        if (roughly_equal(this.fX, a.fX) && roughly_equal(this.fY, a.fY))
        {
            return true;
        }
        const dist = this.distance(a);
        const tiniest = Math.min(this.fX, a.fX, this.fY, a.fY);
        let largest = Math.max(this.fX, a.fX, this.fY, a.fY);
        largest = Math.max(largest, -tiniest);
        return RoughlyEqualUlps(largest, largest + dist);
    }

    public static RoughlyEqual(a: Point, b: Point): boolean
    {
        if (!RoughlyEqualUlps(a.fX, b.fX) && !RoughlyEqualUlps(a.fY, b.fY))
        {
            return false;
        }
        const dist = a.distance(b);
        const tiniest = Math.min(a.fX, b.fX, a.fY, b.fY);
        let largest = Math.max(a.fX, b.fX, a.fY, b.fY);
        largest = Math.max(largest, -tiniest);
        return RoughlyEqualUlps(largest, largest + dist);
    }

    // Light-weight inequality check — used to gate expensive precise
    // tests. SkPathOpsPoint.h:267.
    public static WayRoughlyEqual(a: Point, b: Point): boolean
    {
        const largestNumber = Math.max(
            Math.abs(a.fX),
            Math.abs(a.fY),
            Math.abs(b.fX),
            Math.abs(b.fY),
        );
        const diffX = a.fX - b.fX;
        const diffY = a.fY - b.fY;
        const largestDiff = Math.max(diffX, diffY);
        return roughly_zero_when_compared_to(largestDiff, largestNumber);
    }
}
