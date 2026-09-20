// Copyright 2012 Google Inc.
//
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE-skia file at the root of this repository.
//
// TypeScript port: 2026 Eugene Napryaglo.
// Source: third_party/skia/src/pathops/SkLineParameters.h
//         (Skia commit pinned in third_party/skia)
//
// Sources cited in the original:
//   computer-aided design — vol 22 no 9 nov 1990 pp 538–549
//   http://cagd.cs.byu.edu/~tom/papers/bezclip.pdf
//
// Turns a line segment (or curve endpoints) into a parameterised line of
// the form ax + by + c = 0. When a² + b² == 1 the line is normalised.
// The distance from any point (x, y) to the line is then d = a·x + b·y + c.
//
// Used by the line × curve intersection routines (Phase 5) — the curve's
// control points get their signed distance computed against the line
// endpoints' parameterised form, then the curve is bezier-clipped at the
// zero crossings.
//
// Phase 1 covered only the curve-math primitives; this is the first
// piece of Phase 5 (intersection core) — a small, self-contained header
// class that the line-vs-quad / line-vs-cubic / cubic-vs-cubic
// intersection files all depend on.

import { Line } from './line.js';
import { Point } from './point.js';
import { Quad } from './quad.js';
import { Cubic } from './cubic.js';
import {
    NotAlmostEqualUlps,
    SK_DOUBLE_EPSILON,
    approximately_zero,
} from './types.js';

export class LineParameters
{
    private fA: number = 0;
    private fB: number = 0;
    private fC: number = 0;

    // ── Cubic endpoint variants ─────────────────────────────────────
    //
    // The cubic form is a tie-breaker monster — when the line through
    // pts[0]→pts[1] is degenerate (zero length, both axes), we slide
    // the second endpoint to pts[2] and then pts[3]. Failing that, the
    // y-bias trick at the bottom pushes fA off zero so the angle-sort
    // ordering in SkOpAngle stays sortable.

    public cubicEndPoints(pts: Cubic): boolean
    {
        let endIndex = 1;
        this.cubicEndPointsAt(pts, 0, endIndex);
        if (this.dy() !== 0) return true;
        if (this.dx() === 0)
        {
            this.cubicEndPointsAt(pts, 0, ++endIndex);
            if (endIndex !== 2) throw new Error('LineParameters: cubicEndPoints expected endIndex=2');
            if (this.dy() !== 0) return true;
            if (this.dx() === 0)
            {
                this.cubicEndPointsAt(pts, 0, ++endIndex); // pure line
                if (endIndex !== 3) throw new Error('LineParameters: cubicEndPoints expected endIndex=3');
                return false;
            }
        }
        // FIXME (Skia): after switching to round sort, remove bumping fA.
        if (this.dx() < 0) return true; // only worry about y-bias when breaking CW/CCW tie
        // Control point may be approximate — only bias if it moves
        // significantly to account for error.
        const next = ++endIndex; // FIXME(Skia comment): see source
        if (NotAlmostEqualUlps(pts.fPts[0].fY, pts.fPts[next]!.fY))
        {
            if (pts.fPts[0].fY > pts.fPts[next]!.fY)
            {
                this.fA = SK_DOUBLE_EPSILON; // push it from 0 to slightly negative (y() returns -a)
            }
            return true;
        }
        if (endIndex === 3) return true;
        if (endIndex !== 2) throw new Error('LineParameters: cubicEndPoints expected endIndex=2 (fallthrough)');
        if (pts.fPts[0].fY > pts.fPts[3].fY)
        {
            this.fA = SK_DOUBLE_EPSILON;
        }
        return true;
    }

    public cubicEndPointsAt(pts: Cubic, s: number, e: number): void
    {
        this.fA = pts.fPts[s]!.fY - pts.fPts[e]!.fY;
        this.fB = pts.fPts[e]!.fX - pts.fPts[s]!.fX;
        this.fC = pts.fPts[s]!.fX * pts.fPts[e]!.fY - pts.fPts[e]!.fX * pts.fPts[s]!.fY;
    }

    public cubicPart(part: Cubic): number
    {
        this.cubicEndPoints(part);
        // If pts[0]==pts[1] or the first three points are collinear,
        // measure to the FOURTH point — otherwise to the third.
        if (part.fPts[0].equals(part.fPts[1])
            || new Line(part.fPts[0], part.fPts[1]).nearRay(part.fPts[2]))
        {
            return this.pointDistance(part.fPts[3]);
        }
        return this.pointDistance(part.fPts[2]);
    }

    // ── Line / quad endpoint variants ───────────────────────────────

    public lineEndPoints(pts: Line): void
    {
        this.fA = pts.fPts[0].fY - pts.fPts[1].fY;
        this.fB = pts.fPts[1].fX - pts.fPts[0].fX;
        this.fC = pts.fPts[0].fX * pts.fPts[1].fY - pts.fPts[1].fX * pts.fPts[0].fY;
    }

    public quadEndPoints(pts: Quad): boolean
    {
        this.quadEndPointsAt(pts, 0, 1);
        if (this.dy() !== 0) return true;
        if (this.dx() === 0)
        {
            this.quadEndPointsAt(pts, 0, 2);
            return false;
        }
        if (this.dx() < 0) return true; // only worry about y-bias when breaking CW/CCW tie
        // FIXME (Skia): after switching to round sort, remove this
        if (pts.fPts[0].fY > pts.fPts[2].fY)
        {
            this.fA = SK_DOUBLE_EPSILON;
        }
        return true;
    }

    public quadEndPointsAt(pts: Quad, s: number, e: number): void
    {
        this.fA = pts.fPts[s]!.fY - pts.fPts[e]!.fY;
        this.fB = pts.fPts[e]!.fX - pts.fPts[s]!.fX;
        this.fC = pts.fPts[s]!.fX * pts.fPts[e]!.fY - pts.fPts[e]!.fX * pts.fPts[s]!.fY;
    }

    public quadPart(part: Quad): number
    {
        this.quadEndPoints(part);
        return this.pointDistance(part.fPts[2]);
    }

    // ── Normalisation ───────────────────────────────────────────────

    public normalSquared(): number
    {
        return this.fA * this.fA + this.fB * this.fB;
    }

    public normalize(): boolean
    {
        const normal = Math.sqrt(this.normalSquared());
        if (approximately_zero(normal))
        {
            this.fA = this.fB = this.fC = 0;
            return false;
        }
        const reciprocal = 1 / normal;
        this.fA *= reciprocal;
        this.fB *= reciprocal;
        this.fC *= reciprocal;
        return true;
    }

    // ── Signed-distance queries ─────────────────────────────────────

    // Cubic's four control points get parameterised onto a 4-step
    // x ∈ {0, ⅓, ⅔, 1}, with y = a·X + b·Y + c. The result is a
    // "distance cubic" used by the bezier-clip step in cubic × line
    // intersection.
    public cubicDistanceY(pts: Cubic, distance: Cubic): void
    {
        const oneThird = 1 / 3;
        for (let index = 0; index < 4; ++index)
        {
            distance.fPts[index]!.fX = index * oneThird;
            distance.fPts[index]!.fY = this.fA * pts.fPts[index]!.fX
                                      + this.fB * pts.fPts[index]!.fY + this.fC;
        }
    }

    public quadDistanceY(pts: Quad, distance: Quad): void
    {
        const oneHalf = 1 / 2;
        for (let index = 0; index < 3; ++index)
        {
            distance.fPts[index]!.fX = index * oneHalf;
            distance.fPts[index]!.fY = this.fA * pts.fPts[index]!.fX
                                      + this.fB * pts.fPts[index]!.fY + this.fC;
        }
    }

    public controlPtDistanceCubic(pts: Cubic, index: number): number
    {
        if (index !== 1 && index !== 2)
        {
            throw new Error('LineParameters.controlPtDistanceCubic: index must be 1 or 2');
        }
        return this.fA * pts.fPts[index]!.fX + this.fB * pts.fPts[index]!.fY + this.fC;
    }

    public controlPtDistanceQuad(pts: Quad): number
    {
        return this.fA * pts.fPts[1].fX + this.fB * pts.fPts[1].fY + this.fC;
    }

    public pointDistance(pt: Point): number
    {
        return this.fA * pt.fX + this.fB * pt.fY + this.fC;
    }

    public dx(): number { return this.fB; }
    public dy(): number { return -this.fA; }
}
