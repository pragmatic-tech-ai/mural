// Copyright 2012 Google Inc.
//
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE-skia file at the root of this repository.
//
// TypeScript port: 2026 Eugene Napryaglo.
// Sources:
//   third_party/skia/src/pathops/SkIntersections.{h,cpp}
//   third_party/skia/src/pathops/SkDLineIntersection.cpp (line × line)
//   (Skia commit pinned in third_party/skia)
//
// The result-holder + dispatcher class shared by every intersection
// routine in Skia's pathops. One instance holds 0–N intersection points
// for a single curve-pair query:
//
//   * fT[2][13] — parameters on each of the two input curves.
//   * fPt[13]   — the (x, y) point of each intersection. Skia tracks
//                 this separately rather than recomputing from t to
//                 keep the result self-consistent under accumulated
//                 floating-point drift.
//   * fPt2[2]   — alternates for the "nearly same" endpoint case.
//   * fIsCoincident — bitmask flagging coincident sub-segments.
//   * fNearlySame   — flags end-point near-coincidence.
//   * fAllowNear    — tolerate near-coincident endpoints during insert.
//   * fSwap         — whether the two input roles were swapped by the
//                     caller (insertSwap unswaps before storing).
//
// Phase scope for THIS file:
//   * Line × Line is fully ported (intersect, horizontal, vertical,
//     intersectRay, plus the cleanup helpers).
//   * Storage + insertion mechanics are fully ported (insert,
//     insertNear, insertCoincident, removeOne, flip, closestTo,
//     mostOutside, merge, setCoincident, clearCoincidence,
//     unBumpT, isCoincident, hasT, hasOppT).
//   * Curve-pair entry points (line × quad, line × cubic, quad × quad,
//     etc.) are declared with stubs that throw — they land alongside
//     this file as separate ports of SkDQuadLineIntersection.cpp,
//     SkDCubicLineIntersection.cpp, SkPathOpsTSect.cpp, etc.

import { Line } from './line.js';
import { Point } from './point.js';
import {
    AlmostEqualUlps,
    BUMP_EPSILON,
    NotAlmostDequalUlps,
    NotAlmostEqualUlps_Pin,
    SkPinT,
    approximately_equal,
    between,
    more_roughly_equal,
    precisely_equal,
    precisely_zero,
    zero_or_one,
} from './types.js';

// Maximum number of intersection points one query can hold. Mirrors
// Skia's fPt[13] fixed array — 13 is the worst-case from cubic × cubic
// (9 interior intersections + 4 endpoint touches).
const MAX_INTERSECTIONS = 13;

export class Intersections
{
    // Up to 13 intersection points. Skia stores them as fixed array;
    // we follow suit so indices match line-for-line with the C++.
    public fPt:  Point[];
    // Alternate points for "nearly same" — used when two segments end
    // at nearly-identical (but not exactly equal) points and the
    // intersection effectively spans both.
    public fPt2: [Point, Point];
    // Parameters along each curve. fT[0][i] is the parameter on the
    // first input; fT[1][i] is the second.
    public fT:   [number[], number[]];
    // Bitmask — bit i flags fPt[i] as a coincident-segment endpoint.
    public fIsCoincident: [number, number];
    public fNearlySame:   [boolean, boolean];
    public fUsed:    number;
    public fMax:     number;
    public fAllowNear: boolean;
    public fSwap:    boolean;

    constructor()
    {
        this.fPt  = Array.from({ length: MAX_INTERSECTIONS }, () => new Point());
        this.fPt2 = [new Point(), new Point()];
        this.fT   = [
            new Array(MAX_INTERSECTIONS).fill(0),
            new Array(MAX_INTERSECTIONS).fill(0),
        ];
        this.fIsCoincident = [0, 0];
        this.fNearlySame   = [false, false];
        this.fUsed         = 0;
        this.fMax          = 0; // caller MUST set before use
        this.fAllowNear    = true;
        this.fSwap         = false;
    }

    // Leaves swap, max alone — Skia parity.
    public reset(): void
    {
        this.fAllowNear = true;
        this.fUsed = 0;
        this.fIsCoincident[0] = 0;
        this.fIsCoincident[1] = 0;
    }

    public allowNear(nearAllowed: boolean): void { this.fAllowNear = nearAllowed; }

    public setMax(max: number): void
    {
        if (max > MAX_INTERSECTIONS) throw new Error('Intersections.setMax exceeds capacity');
        this.fMax = max;
    }

    public swap(): void { this.fSwap = !this.fSwap; }
    public swapped(): boolean { return this.fSwap; }
    public used(): number { return this.fUsed; }

    public pt(index: number): Point { return this.fPt[index]!; }
    public pt2(index: number): Point { return this.fPt2[index]!; }

    public isCoincident(index: number): boolean
    {
        return (this.fIsCoincident[0] & (1 << index)) !== 0;
    }

    public clearCoincidence(index: number): void
    {
        if (index < 0) throw new Error('clearCoincidence: index < 0');
        const bit = 1 << index;
        this.fIsCoincident[0] &= ~bit;
        this.fIsCoincident[1] &= ~bit;
    }

    public setCoincident(index: number): void
    {
        if (index < 0) throw new Error('setCoincident: index < 0');
        const bit = 1 << index;
        this.fIsCoincident[0] |= bit;
        this.fIsCoincident[1] |= bit;
    }

    public nearlySame(index: number): boolean
    {
        if (index !== 0 && index !== 1) throw new Error('nearlySame: index must be 0 or 1');
        return this.fNearlySame[index];
    }

    public hasT(t: number): boolean
    {
        if (t !== 0 && t !== 1) throw new Error('hasT: t must be 0 or 1');
        return this.fUsed > 0
            && (t === 0 ? this.fT[0][0] === 0 : this.fT[0][this.fUsed - 1] === 1);
    }

    public hasOppT(t: number): boolean
    {
        if (t !== 0 && t !== 1) throw new Error('hasOppT: t must be 0 or 1');
        return this.fUsed > 0
            && (this.fT[1][0] === t || this.fT[1][this.fUsed - 1] === t);
    }

    // tIndex on this curve (0/1), insert into fT[swap ? 1 : 0][tIndex].
    public set(swap: boolean, tIndex: number, t: number): void
    {
        this.fT[swap ? 1 : 0]![tIndex] = t;
    }

    // ── Insert / remove ────────────────────────────────────────────
    //
    // SkIntersections.cpp:36 — Insert (one, two) sorted by `one` (t on
    // the first curve). Returns the index where the new entry landed,
    // or -1 when the entry was rejected (duplicate, near-duplicate that
    // can't replace, or out of [0, 1]).
    public insert(one: number, two: number, pt: Point): number
    {
        if (this.fIsCoincident[0] === 3
            && between(this.fT[0]![0]!, one, this.fT[0]![1]!))
        {
            // Don't allow mixing coincident and non-coincident.
            return -1;
        }
        let index: number;
        for (index = 0; index < this.fUsed; ++index)
        {
            const oldOne = this.fT[0]![index]!;
            const oldTwo = this.fT[1]![index]!;
            if (one === oldOne && two === oldTwo) return -1;
            if (more_roughly_equal(oldOne, one) && more_roughly_equal(oldTwo, two))
            {
                // Don't displace an endpoint hit by a near-duplicate
                // unless one of them IS an endpoint.
                if ((!precisely_zero(one) || precisely_zero(oldOne))
                    && (!precisely_equal(one, 1) || precisely_equal(oldOne, 1))
                    && (!precisely_zero(two) || precisely_zero(oldTwo))
                    && (!precisely_equal(two, 1) || precisely_equal(oldTwo, 1)))
                {
                    return -1;
                }
                if (!(one >= 0 && one <= 1)) throw new Error('insert: replacement one out of [0,1]');
                if (!(two >= 0 && two <= 1)) throw new Error('insert: replacement two out of [0,1]');
                // Remove existing entry; we'll reinsert below at sorted
                // location.
                const remaining = this.fUsed - index - 1;
                this.shiftLeftAt(index, remaining);
                this.shiftCoincidentLeft(index);
                --this.fUsed;
                break;
            }
        }
        for (index = 0; index < this.fUsed; ++index)
        {
            if (this.fT[0]![index]! > one) break;
        }
        if (this.fUsed >= this.fMax)
        {
            // Skia asserts here; mural treats overflow as "this query
            // is broken — drop everything" so callers get a usable
            // zero rather than a corrupt list.
            this.fUsed = 0;
            return 0;
        }
        const remaining = this.fUsed - index;
        if (remaining > 0)
        {
            this.shiftRightAt(index, remaining);
            this.shiftCoincidentRight(index);
        }
        this.fPt[index] = pt;
        if (one < 0 || one > 1) return -1;
        if (two < 0 || two > 1) return -1;
        this.fT[0]![index] = one;
        this.fT[1]![index] = two;
        ++this.fUsed;
        return index;
    }

    public insertNear(one: number, two: number, pt1: Point, pt2: Point): void
    {
        if (one !== 0 && one !== 1) throw new Error('insertNear: one must be 0 or 1');
        if (two !== 0 && two !== 1) throw new Error('insertNear: two must be 0 or 1');
        if (pt1.equals(pt2)) throw new Error('insertNear: pt1 must differ from pt2');
        this.fNearlySame[one ? 1 : 0] = true;
        this.insert(one, two, pt1);
        this.fPt2[one ? 1 : 0] = pt2;
    }

    public insertSwap(one: number, two: number, pt: Point): number
    {
        return this.fSwap ? this.insert(two, one, pt) : this.insert(one, two, pt);
    }

    public insertCoincident(one: number, two: number, pt: Point): number
    {
        const index = this.insertSwap(one, two, pt);
        if (index >= 0) this.setCoincident(index);
        return index;
    }

    public removeOne(index: number): void
    {
        const remaining = --this.fUsed - index;
        if (remaining <= 0) return;
        this.shiftLeftAt(index, remaining);
        const coBit = this.fIsCoincident[0] & (1 << index);
        this.fIsCoincident[0] -= ((this.fIsCoincident[0] >> 1) & ~((1 << index) - 1)) + coBit;
        if ((coBit ^ (this.fIsCoincident[1] & (1 << index))) !== 0)
        {
            throw new Error('removeOne: coincident bitmasks out of sync');
        }
        this.fIsCoincident[1] -= ((this.fIsCoincident[1] >> 1) & ~((1 << index) - 1)) + coBit;
    }

    public flip(): void
    {
        for (let index = 0; index < this.fUsed; ++index)
        {
            this.fT[1]![index] = 1 - this.fT[1]![index]!;
        }
    }

    // ── closestTo / mostOutside / merge ─────────────────────────────

    public closestTo(rangeStart: number, rangeEnd: number, testPt: Point): { index: number; distSquared: number }
    {
        let closest = -1;
        let closestDist = Number.MAX_VALUE;
        for (let index = 0; index < this.fUsed; ++index)
        {
            if (!between(rangeStart, this.fT[0]![index]!, rangeEnd)) continue;
            const dist = testPt.distanceSquared(this.fPt[index]!);
            if (closestDist > dist)
            {
                closestDist = dist;
                closest = index;
            }
        }
        return { index: closest, distSquared: closestDist };
    }

    public mostOutside(rangeStart: number, rangeEnd: number, origin: Point): number
    {
        let result = -1;
        for (let index = 0; index < this.fUsed; ++index)
        {
            if (!between(rangeStart, this.fT[0]![index]!, rangeEnd)) continue;
            if (result < 0) { result = index; continue; }
            const best = this.fPt[result]!.sub(origin);
            const test = this.fPt[index]!.sub(origin);
            if (test.crossCheck(best) < 0) result = index;
        }
        return result;
    }

    public merge(a: Intersections, aIndex: number, b: Intersections, bIndex: number): void
    {
        this.reset();
        this.fT[0]![0]  = a.fT[0]![aIndex]!;
        this.fT[1]![0]  = b.fT[0]![bIndex]!;
        this.fPt[0]  = a.fPt[aIndex]!;
        this.fPt2[0] = b.fPt[bIndex]!;
        this.fUsed = 1;
    }

    public unBumpT(index: number): boolean
    {
        if (this.fUsed !== 1) throw new Error('unBumpT: precondition fUsed===1');
        this.fT[0]![index] = this.fT[0]![index]! * (1 + BUMP_EPSILON * 2) - BUMP_EPSILON;
        if (!between(0, this.fT[0]![index]!, 1))
        {
            this.fUsed = 0;
            return false;
        }
        return true;
    }

    // ── Line × Line ─────────────────────────────────────────────────
    //
    // SkDLineIntersection.cpp:87 — intersect(a, b). Returns the number
    // of intersections found (0, 1, or 2). On return, fT / fPt are
    // populated; fUsed equals the return value.
    public intersectLineLine(a: Line, b: Line): number
    {
        this.fMax = 3; // cleanUpParallelLines caps to 2 at the end
        // See if end points intersect the opposite line exactly.
        let t: number;
        for (let iA = 0; iA < 2; ++iA)
        {
            if ((t = b.exactPoint(a.fPts[iA]!)) >= 0) this.insert(iA, t, a.fPts[iA]!);
        }
        for (let iB = 0; iB < 2; ++iB)
        {
            if ((t = a.exactPoint(b.fPts[iB]!)) >= 0) this.insert(t, iB, b.fPts[iB]!);
        }
        // Determine the interior intersection. Slopes match (parallel)
        // when denom goes to zero.
        const axLen = a.fPts[1].fX - a.fPts[0].fX;
        const ayLen = a.fPts[1].fY - a.fPts[0].fY;
        const bxLen = b.fPts[1].fX - b.fPts[0].fX;
        const byLen = b.fPts[1].fY - b.fPts[0].fY;
        const axByLen = axLen * byLen;
        const ayBxLen = ayLen * bxLen;
        // Same parallel-test predicate as SkOpAngle's operator< — keeps
        // non-parallel pairs sortable downstream.
        const unparallel = this.fAllowNear
            ? NotAlmostEqualUlps_Pin(axByLen, ayBxLen)
            : NotAlmostDequalUlps(axByLen, ayBxLen);
        if (unparallel && this.fUsed === 0)
        {
            const ab0y = a.fPts[0].fY - b.fPts[0].fY;
            const ab0x = a.fPts[0].fX - b.fPts[0].fX;
            const numerA = ab0y * bxLen - byLen * ab0x;
            const numerB = ab0y * axLen - ayLen * ab0x;
            const denom = axByLen - ayBxLen;
            if (between(0, numerA, denom) && between(0, numerB, denom))
            {
                this.fT[0]![0] = numerA / denom;
                this.fT[1]![0] = numerB / denom;
                this.computePoints(a, 1);
            }
        }
        // Near-coincident endpoints — Skia is generous here, allowing
        // either polygon end to mate to either of the other's ends as
        // long as the perpendicular distance fits the ULP slack on each
        // line.
        if (this.fAllowNear || !unparallel)
        {
            const aNearB: [number, number] = [0, 0];
            const bNearA: [number, number] = [0, 0];
            const aNotB:  [boolean, boolean] = [false, false];
            const bNotA:  [boolean, boolean] = [false, false];
            let nearCount = 0;
            for (let index = 0; index < 2; ++index)
            {
                const rA = b.nearPoint(a.fPts[index]!);
                aNearB[index] = rA.t;
                aNotB[index]  = rA.unequal;
                if (rA.t >= 0) ++nearCount;
                const rB = a.nearPoint(b.fPts[index]!);
                bNearA[index] = rB.t;
                bNotA[index]  = rB.unequal;
                if (rB.t >= 0) ++nearCount;
            }
            if (nearCount > 0)
            {
                // Skip if each segment contributes to one end point.
                if (nearCount !== 2 || aNotB[0] === aNotB[1])
                {
                    for (let iA = 0; iA < 2; ++iA)
                    {
                        if (!aNotB[iA]) continue;
                        const nearer = aNearB[iA]! > 0.5 ? 1 : 0;
                        if (!bNotA[nearer]) continue;
                        this.insertNear(iA, nearer, a.fPts[iA]!, b.fPts[nearer]!);
                        aNearB[iA] = -1;
                        bNearA[nearer] = -1;
                        nearCount -= 2;
                    }
                }
                if (nearCount > 0)
                {
                    for (let iA = 0; iA < 2; ++iA)
                    {
                        if (aNearB[iA]! >= 0) this.insert(iA, aNearB[iA]!, a.fPts[iA]!);
                    }
                    for (let iB = 0; iB < 2; ++iB)
                    {
                        if (bNearA[iB]! >= 0) this.insert(bNearA[iB]!, iB, b.fPts[iB]!);
                    }
                }
            }
        }
        this.cleanUpParallelLines(!unparallel);
        return this.fUsed;
    }

    // SkDLineIntersection.cpp:46 — intersectRay(a, b). Ignores segment
    // ranges and returns interior intersections only (ignores endpoint
    // touches). Used by SkOpAngle's intersection-tracking helpers.
    public intersectRayLineLine(a: Line, b: Line): number
    {
        this.fMax = 2;
        const aLen = a.fPts[1].sub(a.fPts[0]);
        const bLen = b.fPts[1].sub(b.fPts[0]);
        const denom = bLen.fY * aLen.fX - aLen.fY * bLen.fX;
        let used: number;
        if (!this.approximately_zero(denom))
        {
            const ab0 = a.fPts[0].sub(b.fPts[0]);
            let numerA = ab0.fY * bLen.fX - bLen.fY * ab0.fX;
            let numerB = ab0.fY * aLen.fX - aLen.fY * ab0.fX;
            numerA /= denom;
            numerB /= denom;
            this.fT[0]![0] = numerA;
            this.fT[1]![0] = numerB;
            used = 1;
        }
        else
        {
            // Coincident rays — return arbitrary parameters per Skia's
            // "there's no great answer" comment.
            if (!AlmostEqualUlps(
                aLen.fX * a.fPts[0].fY - aLen.fY * a.fPts[0].fX,
                aLen.fX * b.fPts[0].fY - aLen.fY * b.fPts[0].fX))
            {
                this.fUsed = 0;
                return 0;
            }
            this.fT[0]![0] = 0;
            this.fT[0]![1] = 1;
            this.fT[1]![0] = 0;
            this.fT[1]![1] = 1;
            used = 2;
        }
        this.computePoints(a, used);
        return this.fUsed;
    }

    // SkDLineIntersection.cpp:209 — line × horizontal-line.
    public horizontalLine(line: Line, left: number, right: number, y: number, flipped: boolean): number
    {
        this.fMax = 3; // cleanUpParallelLines caps to 2
        let t: number;
        const leftPt = new Point(left, y);
        if ((t = line.exactPoint(leftPt)) >= 0) this.insert(t, flipped ? 1 : 0, leftPt);
        if (left !== right)
        {
            const rightPt = new Point(right, y);
            if ((t = line.exactPoint(rightPt)) >= 0) this.insert(t, flipped ? 0 : 1, rightPt);
            for (let index = 0; index < 2; ++index)
            {
                if ((t = Line.ExactPointH(line.fPts[index]!, left, right, y)) >= 0)
                {
                    this.insert(index, flipped ? 1 - t : t, line.fPts[index]!);
                }
            }
        }
        const result = horizontal_coincident(line, y);
        if (result === 1 && this.fUsed === 0)
        {
            this.fT[0]![0] = Intersections.HorizontalInterceptLine(line, y);
            const xIntercept = line.fPts[0].fX + this.fT[0]![0]! * (line.fPts[1].fX - line.fPts[0].fX);
            if (between(left, xIntercept, right))
            {
                this.fT[1]![0] = (xIntercept - left) / (right - left);
                if (flipped)
                {
                    for (let index = 0; index < result; ++index)
                    {
                        this.fT[1]![index] = 1 - this.fT[1]![index]!;
                    }
                }
                this.fPt[0]!.fX = xIntercept;
                this.fPt[0]!.fY = y;
                this.fUsed = 1;
            }
        }
        if (this.fAllowNear || result === 2)
        {
            if ((t = line.nearPoint(leftPt).t) >= 0) this.insert(t, flipped ? 1 : 0, leftPt);
            if (left !== right)
            {
                const rightPt = new Point(right, y);
                if ((t = line.nearPoint(rightPt).t) >= 0) this.insert(t, flipped ? 0 : 1, rightPt);
                for (let index = 0; index < 2; ++index)
                {
                    if ((t = Line.NearPointH(line.fPts[index]!, left, right, y)) >= 0)
                    {
                        this.insert(index, flipped ? 1 - t : t, line.fPts[index]!);
                    }
                }
            }
        }
        this.cleanUpParallelLines(result === 2);
        return this.fUsed;
    }

    // SkDLineIntersection.cpp:287 — line × vertical-line.
    public verticalLine(line: Line, top: number, bottom: number, x: number, flipped: boolean): number
    {
        this.fMax = 3;
        let t: number;
        const topPt = new Point(x, top);
        if ((t = line.exactPoint(topPt)) >= 0) this.insert(t, flipped ? 1 : 0, topPt);
        if (top !== bottom)
        {
            const bottomPt = new Point(x, bottom);
            if ((t = line.exactPoint(bottomPt)) >= 0) this.insert(t, flipped ? 0 : 1, bottomPt);
            for (let index = 0; index < 2; ++index)
            {
                if ((t = Line.ExactPointV(line.fPts[index]!, top, bottom, x)) >= 0)
                {
                    this.insert(index, flipped ? 1 - t : t, line.fPts[index]!);
                }
            }
        }
        const result = vertical_coincident(line, x);
        if (result === 1 && this.fUsed === 0)
        {
            this.fT[0]![0] = Intersections.VerticalInterceptLine(line, x);
            const yIntercept = line.fPts[0].fY + this.fT[0]![0]! * (line.fPts[1].fY - line.fPts[0].fY);
            if (between(top, yIntercept, bottom))
            {
                this.fT[1]![0] = (yIntercept - top) / (bottom - top);
                if (flipped)
                {
                    for (let index = 0; index < result; ++index)
                    {
                        this.fT[1]![index] = 1 - this.fT[1]![index]!;
                    }
                }
                this.fPt[0]!.fX = x;
                this.fPt[0]!.fY = yIntercept;
                this.fUsed = 1;
            }
        }
        if (this.fAllowNear || result === 2)
        {
            if ((t = line.nearPoint(topPt).t) >= 0) this.insert(t, flipped ? 1 : 0, topPt);
            if (top !== bottom)
            {
                const bottomPt = new Point(x, bottom);
                if ((t = line.nearPoint(bottomPt).t) >= 0) this.insert(t, flipped ? 0 : 1, bottomPt);
                for (let index = 0; index < 2; ++index)
                {
                    if ((t = Line.NearPointV(line.fPts[index]!, top, bottom, x)) >= 0)
                    {
                        this.insert(index, flipped ? 1 - t : t, line.fPts[index]!);
                    }
                }
            }
        }
        this.cleanUpParallelLines(result === 2);
        return this.fUsed;
    }

    // Static interception helpers used by the horizontal / vertical
    // line cases. Pinned to [0, 1].
    public static HorizontalInterceptLine(line: Line, y: number): number
    {
        if (line.fPts[1].fY === line.fPts[0].fY) throw new Error('HorizontalIntercept: line is horizontal');
        return SkPinT((y - line.fPts[0].fY) / (line.fPts[1].fY - line.fPts[0].fY));
    }

    public static VerticalInterceptLine(line: Line, x: number): number
    {
        if (line.fPts[1].fX === line.fPts[0].fX) throw new Error('VerticalIntercept: line is vertical');
        return SkPinT((x - line.fPts[0].fX) / (line.fPts[1].fX - line.fPts[0].fX));
    }

    // Curve-pair entry points (`intersectQuadLine`, `horizontalQuad`,
    // `intersectCubicLine`, `intersectQuadQuad`, …) are added to this
    // class by per-pair sibling files via TypeScript module augmentation.
    // Importing the matching port file installs them on the prototype.
    // See:
    //   ./quad-line-intersection.ts  — SkDQuadLineIntersection
    //   ./cubic-line-intersection.ts — SkDCubicLineIntersection  (pending)
    //   ./t-sect.ts                  — SkPathOpsTSect             (pending)

    // ── Internal helpers (intentionally protected so curve-pair files
    // can poke at fields by extending Intersections via prototype
    // assignment; without `as any` casts they'd be stranded) ────────

    public _set_fT(curve: 0 | 1, index: number, value: number): void
    {
        this.fT[curve]![index] = value;
    }

    public _get_fT(curve: 0 | 1, index: number): number
    {
        return this.fT[curve]![index]!;
    }

    public _set_fPt(index: number, p: Point): void { this.fPt[index] = p; }

    public _set_fUsed(value: number): void { this.fUsed = value; }

    // ── Internal helpers ───────────────────────────────────────────

    private computePoints(line: Line, used: number): void
    {
        this.fPt[0] = line.ptAtT(this.fT[0]![0]!);
        this.fUsed = used;
        if (used === 2)
        {
            this.fPt[1] = line.ptAtT(this.fT[0]![1]!);
        }
    }

    // SkDLineIntersection.cpp:17 — Trim duplicate / spurious near-
    // coincidence results that the line-line code emits. With
    // unparallel inputs we drop at most one duplicate; with parallel
    // (coincident overlap), the cleaned-up result is marked
    // coincident.
    private cleanUpParallelLines(parallel: boolean): void
    {
        while (this.fUsed > 2) this.removeOne(1);
        if (this.fUsed === 2 && !parallel)
        {
            const startMatch = this.fT[0]![0] === 0 || zero_or_one(this.fT[1]![0]!);
            const endMatch   = this.fT[0]![1] === 1 || zero_or_one(this.fT[1]![1]!);
            if ((!startMatch && !endMatch)
                || approximately_equal(this.fT[0]![0]!, this.fT[0]![1]!))
            {
                if (!(startMatch || endMatch))
                {
                    throw new Error('cleanUpParallelLines: expected startMatch || endMatch');
                }
                if (startMatch && endMatch
                    && (this.fT[0]![0] !== 0 || !zero_or_one(this.fT[1]![0]!))
                    && this.fT[0]![1] === 1 && zero_or_one(this.fT[1]![1]!))
                {
                    this.removeOne(0);
                }
                else
                {
                    this.removeOne(endMatch ? 1 : 0);
                }
            }
        }
        if (this.fUsed === 2)
        {
            this.fIsCoincident[0] = 0x03;
            this.fIsCoincident[1] = 0x03;
        }
    }

    // Skia uses `approximately_zero` (1e-7) here — we mirror exactly.
    private approximately_zero(x: number): boolean
    {
        return Math.abs(x) < 1e-7;
    }

    // Skia's memmove-shift helpers. fPt and fT entries from [index+1, used)
    // move LEFT by one. Used by removeOne / replace-in-insert paths.
    private shiftLeftAt(index: number, remaining: number): void
    {
        for (let i = 0; i < remaining; ++i)
        {
            this.fPt[index + i] = this.fPt[index + i + 1]!;
            this.fT[0]![index + i] = this.fT[0]![index + i + 1]!;
            this.fT[1]![index + i] = this.fT[1]![index + i + 1]!;
        }
    }

    // Symmetric — fPt/fT entries from [index, used) move RIGHT by one
    // to make room for a new insertion at `index`.
    private shiftRightAt(index: number, remaining: number): void
    {
        for (let i = remaining - 1; i >= 0; --i)
        {
            this.fPt[index + i + 1] = this.fPt[index + i]!;
            this.fT[0]![index + i + 1] = this.fT[0]![index + i]!;
            this.fT[1]![index + i + 1] = this.fT[1]![index + i]!;
        }
    }

    // Coincident bitmasks shift in lockstep with fPt/fT. The bit at
    // `index` and above slide one position UP.
    private shiftCoincidentRight(index: number): void
    {
        const clearMask = ~((1 << index) - 1);
        this.fIsCoincident[0] += this.fIsCoincident[0] & clearMask;
        this.fIsCoincident[1] += this.fIsCoincident[1] & clearMask;
    }

    private shiftCoincidentLeft(index: number): void
    {
        const clearMask = ~((1 << index) - 1);
        this.fIsCoincident[0] -= (this.fIsCoincident[0] >> 1) & clearMask;
        this.fIsCoincident[1] -= (this.fIsCoincident[1] >> 1) & clearMask;
    }
}

// SkDLineIntersection.cpp:188
function horizontal_coincident(line: Line, y: number): number
{
    let min = line.fPts[0].fY;
    let max = line.fPts[1].fY;
    if (min > max) { const tmp = min; min = max; max = tmp; }
    if (min > y || max < y) return 0;
    if (AlmostEqualUlps(min, max) && max - min < Math.abs(line.fPts[0].fX - line.fPts[1].fX))
    {
        return 2;
    }
    return 1;
}

// SkDLineIntersection.cpp:266
function vertical_coincident(line: Line, x: number): number
{
    let min = line.fPts[0].fX;
    let max = line.fPts[1].fX;
    if (min > max) { const tmp = min; min = max; max = tmp; }
    if (min > x || max < x) return 0;
    if (AlmostEqualUlps(min, max)) return 2;
    return 1;
}
