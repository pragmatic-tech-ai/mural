// Copyright 2012 Google Inc.
//
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE-skia file at the root of this repository.
//
// TypeScript port: 2026 Eugene Napryaglo.
// Source: third_party/skia/src/pathops/SkPathOpsLine.{h,cpp}
//         (Skia commit pinned in third_party/skia)
//
// Double-precision 2D line segment. Two endpoints stored in a fixed-
// length `fPts` tuple matching Skia's `Point fPts[2]`. Methods are
// drawn directly from SkPathOpsLine.cpp — endpoint-equality and
// nearest-point queries used by the intersection routines we'll port
// in Phase 5.

import { Point, Vector } from './point.js';
import {
    AlmostBequalUlps,
    AlmostBetweenUlps,
    AlmostEqualUlps,
    AlmostEqualUlps_Pin,
    RoughlyEqualUlps,
    SkPinT,
    between,
} from './types.js';

export class Line
{
    public fPts: [Point, Point];

    constructor(p0?: Point, p1?: Point)
    {
        this.fPts = [p0 ?? new Point(), p1 ?? new Point()];
    }

    // Interpolate along the line at parameter t (0 → fPts[0], 1 → fPts[1]).
    // Skia short-circuits the endpoints to preserve exact values past the
    // floating-point multiply.
    public ptAtT(t: number): Point
    {
        if (t === 0) return this.fPts[0];
        if (t === 1) return this.fPts[1];
        const one_t = 1 - t;
        return new Point(
            one_t * this.fPts[0].fX + t * this.fPts[1].fX,
            one_t * this.fPts[0].fY + t * this.fPts[1].fY,
        );
    }

    // exactPoint: returns 0 if xy === fPts[0], 1 if xy === fPts[1],
    // otherwise -1. Used as the cheapest "is this point a vertex?" test
    // before expensive geometric queries.
    public exactPoint(xy: Point): number
    {
        if (xy.equals(this.fPts[0])) return 0;
        if (xy.equals(this.fPts[1])) return 1;
        return -1;
    }

    // nearPoint: projects xy perpendicularly onto the line, returns the
    // T parameter (0..1) if the projection lands within the segment and
    // the perpendicular distance is within ULP tolerance of the line's
    // scale. -1 if no such projection exists.
    //
    // `unequal` is an out-parameter (Skia takes `bool*`). We return it
    // as part of a result object so the call site can ignore it cleanly.
    public nearPoint(xy: Point): { t: number, unequal: boolean }
    {
        if (!AlmostBetweenUlps(this.fPts[0].fX, xy.fX, this.fPts[1].fX)
            || !AlmostBetweenUlps(this.fPts[0].fY, xy.fY, this.fPts[1].fY))
            {
            return { t: -1, unequal: false };
        }
        // Project a perpendicular ray from the point to the line; find
        // the T on the line.
        const len = this.fPts[1].sub(this.fPts[0]);
        const denom = len.fX * len.fX + len.fY * len.fY;
        const ab0 = xy.sub(this.fPts[0]);
        const numer = len.fX * ab0.fX + ab0.fY * len.fY;
        if (!between(0, numer, denom)) return { t: -1, unequal: false };
        if (denom === 0) return { t: 0, unequal: false };
        let t = numer / denom;
        const realPt = this.ptAtT(t);
        const dist = realPt.distance(xy);
        const tiniest = Math.min(this.fPts[0].fX, this.fPts[0].fY, this.fPts[1].fX, this.fPts[1].fY);
        let largest = Math.max(this.fPts[0].fX, this.fPts[0].fY, this.fPts[1].fX, this.fPts[1].fY);
        largest = Math.max(largest, -tiniest);
        if (!AlmostEqualUlps_Pin(largest, largest + dist)) return { t: -1, unequal: false };
        // Skia reports "unequal" by comparing (float) cast values — we
        // replicate via Math.fround.
        const unequal = Math.fround(largest) !== Math.fround(largest + dist);
        t = SkPinT(t);
        return { t, unequal };
    }

    // nearRay: like nearPoint but doesn't require the projection to
    // fall within the segment. Just asks: is xy close to the
    // (infinite) line containing this segment?
    public nearRay(xy: Point): boolean
    {
        const len = this.fPts[1].sub(this.fPts[0]);
        const denom = len.fX * len.fX + len.fY * len.fY;
        const ab0 = xy.sub(this.fPts[0]);
        const numer = len.fX * ab0.fX + ab0.fY * len.fY;
        const t = numer / denom;
        const realPt = this.ptAtT(t);
        const dist = realPt.distance(xy);
        const tiniest = Math.min(this.fPts[0].fX, this.fPts[0].fY, this.fPts[1].fX, this.fPts[1].fY);
        let largest = Math.max(this.fPts[0].fX, this.fPts[0].fY, this.fPts[1].fX, this.fPts[1].fY);
        largest = Math.max(largest, -tiniest);
        return RoughlyEqualUlps(largest, largest + dist);
    }

    // ExactPointH/V/NearPointH/V: axis-aligned-line shortcuts. Used by
    // the intersection code when one of the lines is horizontal or
    // vertical so we can skip the general 2D projection.

    public static ExactPointH(xy: Point, left: number, right: number, y: number): number
    {
        if (xy.fY === y)
        {
            if (xy.fX === left)  return 0;
            if (xy.fX === right) return 1;
        }
        return -1;
    }

    public static NearPointH(xy: Point, left: number, right: number, y: number): number
    {
        if (!AlmostBequalUlps(xy.fY, y)) return -1;
        if (!AlmostBetweenUlps(left, xy.fX, right)) return -1;
        let t = (xy.fX - left) / (right - left);
        t = SkPinT(t);
        const realPtX = (1 - t) * left + t * right;
        const distU = new Vector(xy.fY - y, xy.fX - realPtX);
        const distSq = distU.fX * distU.fX + distU.fY * distU.fY;
        const dist = Math.sqrt(distSq);
        const tiniest = Math.min(y, left, right);
        let largest = Math.max(y, left, right);
        largest = Math.max(largest, -tiniest);
        if (!AlmostEqualUlps(largest, largest + dist)) return -1;
        return t;
    }

    public static ExactPointV(xy: Point, top: number, bottom: number, x: number): number
    {
        if (xy.fX === x)
        {
            if (xy.fY === top)    return 0;
            if (xy.fY === bottom) return 1;
        }
        return -1;
    }

    public static NearPointV(xy: Point, top: number, bottom: number, x: number): number
    {
        if (!AlmostBequalUlps(xy.fX, x)) return -1;
        if (!AlmostBetweenUlps(top, xy.fY, bottom)) return -1;
        let t = (xy.fY - top) / (bottom - top);
        t = SkPinT(t);
        const realPtY = (1 - t) * top + t * bottom;
        const distU = new Vector(xy.fX - x, xy.fY - realPtY);
        const distSq = distU.fX * distU.fX + distU.fY * distU.fY;
        const dist = Math.sqrt(distSq);
        const tiniest = Math.min(x, top, bottom);
        let largest = Math.max(x, top, bottom);
        largest = Math.max(largest, -tiniest);
        if (!AlmostEqualUlps(largest, largest + dist)) return -1;
        return t;
    }
}
