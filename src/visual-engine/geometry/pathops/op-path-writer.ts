// Copyright 2012 Google Inc.
//
// Use of this source code is governed by a BSD-style license that can
// be found in the LICENSE-skia file at the root of this repository.
//
// TypeScript port: 2026 Eugene Napryaglo.
// Source: third_party/skia/src/pathops/SkPathWriter.{h,cpp}
//
// Path-ops output. The walker calls deferredMove / deferredLine /
// quadTo / cubicTo on this writer as it traces output contours. When
// a contour closes back on its first pt-T the writer commits it to
// the output path; partial contours park in `fPartials` until
// `assemble()` reorders them by closest-pair matching.

import { Point } from './point.js';
import { OpPath, type CurveProvenance } from './op-path.js';
import type { OpPtT } from './op-span.js';

export class OpPathWriter
{
    public fCurrent: OpPath = new OpPath();
    public fPartials: OpPath[] = [];
    public fEndPtTs: OpPtT[] = [];
    public fPath: OpPath;
    public fDefer: [OpPtT | undefined, OpPtT | undefined] = [undefined, undefined];
    public fFirstPtT: OpPtT | undefined = undefined;

    constructor(path: OpPath)
    {
        this.fPath = path;
        this.init();
    }

    public init(): void
    {
        this.fCurrent.reset();
        this.fFirstPtT = undefined;
        this.fDefer[0] = undefined;
        this.fDefer[1] = undefined;
    }

    public nativePath(): OpPath { return this.fPath; }

    public hasMove(): boolean { return this.fFirstPtT === undefined; }

    public isClosed(): boolean
    {
        return this.matchedLast(this.fFirstPtT);
    }

    public deferredMove(pt: OpPtT): void
    {
        if (this.fDefer[1] === undefined)
        {
            this.fFirstPtT = pt;
            this.fDefer[0] = pt;
            return;
        }
        if (!this.matchedLast(pt))
        {
            this.finishContour();
            this.fFirstPtT = pt;
            this.fDefer[0] = pt;
        }
    }

    public deferredLine(pt: OpPtT): boolean
    {
        if (this.fFirstPtT === undefined || this.fDefer[0] === undefined) return false;
        if (this.fDefer[0] === pt) return true;
        if (pt.containsPtT(this.fDefer[0]!)) return true;
        if (this.matchedLast(pt)) return false;
        if (this.fDefer[1] !== undefined && this.changedSlopes(pt))
        {
            this.lineTo();
            this.fDefer[0] = this.fDefer[1];
        }
        this.fDefer[1] = pt;
        return true;
    }

    public quadTo(pt1: Point, pt2: OpPtT, prov?: CurveProvenance): void
    {
        const pt2pt = this.update(pt2);
        this.fCurrent.quadTo(pt1, pt2pt, prov);
    }

    public cubicTo(pt1: Point, pt2: Point, pt3: OpPtT, prov?: CurveProvenance): void
    {
        const pt3pt = this.update(pt3);
        this.fCurrent.cubicTo(pt1, pt2, pt3pt, prov);
    }

    public finishContour(): void
    {
        if (!this.matchedLast(this.fDefer[0]))
        {
            if (this.fDefer[1] === undefined) return;
            this.lineTo();
        }
        if (this.fCurrent.isEmpty()) return;
        if (this.isClosed())
        {
            this.close();
        }
        else
        {
            if (this.fDefer[1] === undefined) return;
            this.fEndPtTs.push(this.fFirstPtT!);
            this.fEndPtTs.push(this.fDefer[1]);
            // Move current into partials (clone).
            const part = new OpPath();
            part.addPath(this.fCurrent);
            this.fPartials.push(part);
            this.init();
        }
    }

    private close(): void
    {
        if (this.fCurrent.isEmpty()) return;
        this.fCurrent.close();
        this.fPath.addPath(this.fCurrent);
        this.fCurrent.reset();
        this.init();
    }

    private lineTo(): void
    {
        if (this.fCurrent.isEmpty()) this.moveTo();
        this.fCurrent.lineTo(this.fDefer[1]!.fPt);
    }

    private matchedLast(test: OpPtT | undefined): boolean
    {
        if (test === undefined) return false;
        if (test === this.fDefer[1]) return true;
        if (this.fDefer[1] === undefined) return false;
        return test.containsPtT(this.fDefer[1]);
    }

    private moveTo(): void
    {
        this.fCurrent.moveTo(this.fFirstPtT!.fPt);
    }

    private update(pt: OpPtT): Point
    {
        if (this.fDefer[1] === undefined)
        {
            this.moveTo();
        }
        else if (!this.matchedLast(this.fDefer[0]))
        {
            this.lineTo();
        }
        let result = pt.fPt;
        if (this.fFirstPtT !== undefined
            && !result.equals(this.fFirstPtT.fPt)
            && this.fFirstPtT.containsPtT(pt))
        {
            result = this.fFirstPtT.fPt;
        }
        this.fDefer[0] = pt;
        this.fDefer[1] = pt;
        return result;
    }

    private changedSlopes(ptT: OpPtT): boolean
    {
        if (this.matchedLast(this.fDefer[0])) return false;
        const a = this.fDefer[1]!.fPt;
        const b = this.fDefer[0]!.fPt;
        const c = ptT.fPt;
        const dx1 = a.fX - b.fX, dy1 = a.fY - b.fY;
        const dx2 = c.fX - a.fX, dy2 = c.fY - a.fY;
        return dx1 * dy2 !== dy1 * dx2;
    }

    public someAssemblyRequired(): boolean
    {
        this.finishContour();
        return this.fEndPtTs.length !== 0;
    }

    // SkPathWriter.cpp:207 — partial-contour reassembly. Match each
    // open contour's endpoint to the closest other endpoint, link them
    // in order, and write the joined run to fPath.
    //
    // Mural's port uses a simplified algorithm: sort all endpoints by
    // distance and greedily link the closest available pair. This
    // matches Skia's outer loop structure (Closest-pair greedy via
    // sorted distance table) without porting the full SkTQSort + flip
    // bookkeeping.
    public assemble(): void
    {
        if (!this.someAssemblyRequired()) return;
        const runs = this.fEndPtTs.slice();
        const endCount = runs.length;
        const linkCount = endCount / 2;
        const sLink: number[] = new Array(linkCount).fill(SK_MAX_S32);
        const eLink: number[] = new Array(linkCount).fill(SK_MAX_S32);
        // Build distance table for every (i, j) pair.
        type Entry = { i: number; j: number; d: number };
        const entries: Entry[] = [];
        for (let i = 0; i < endCount - 1; ++i)
        {
            for (let j = i + 1; j < endCount; ++j)
            {
                const a = runs[i]!.fPt, b = runs[j]!.fPt;
                const dx = b.fX - a.fX, dy = b.fY - a.fY;
                entries.push({ i, j, d: dx * dx + dy * dy });
            }
        }
        entries.sort((a, b) => a.d - b.d);
        let remaining = linkCount;
        for (const e of entries)
        {
            if (remaining === 0) break;
            const row = e.i;
            const col = e.j;
            const ndxOne = row >> 1;
            const endOne = (row & 1) !== 0;
            const linkOne = endOne ? eLink : sLink;
            if (linkOne[ndxOne] !== SK_MAX_S32) continue;
            const ndxTwo = col >> 1;
            const endTwo = (col & 1) !== 0;
            const linkTwo = endTwo ? eLink : sLink;
            if (linkTwo[ndxTwo] !== SK_MAX_S32) continue;
            const flip = endOne === endTwo;
            linkOne[ndxOne] = flip ? ~ndxTwo : ndxTwo;
            linkTwo[ndxTwo] = flip ? ~ndxOne : ndxOne;
            --remaining;
        }
        // Walk the link table emitting joined contours.
        let rIndex = 0;
        outer: while (rIndex < linkCount)
        {
            let forward = true;
            let first = true;
            let sIndex = sLink[rIndex]!;
            if (sIndex === SK_MAX_S32)
            {
                ++rIndex;
                if (rIndex >= linkCount) break;
                continue;
            }
            sLink[rIndex] = SK_MAX_S32;
            let eIndex: number;
            if (sIndex < 0)
            {
                eIndex = sLink[~sIndex]!;
                sLink[~sIndex] = SK_MAX_S32;
            }
            else
            {
                eIndex = eLink[sIndex]!;
                eLink[sIndex] = SK_MAX_S32;
            }
            if (eIndex === SK_MAX_S32) break;
            let safety = linkCount * 4;
            while (--safety > 0)
            {
                const contour = this.fPartials[rIndex]!;
                if (forward)
                {
                    this.fPath.addPath(contour);
                }
                else
                {
                    this.fPath.reverseAddPath(contour);
                }
                first = false;
                void first;
                const closeCheck = (rIndex !== eIndex) !== forward ? eIndex : ~eIndex;
                if (sIndex === closeCheck)
                {
                    this.fPath.close();
                    break;
                }
                if (forward)
                {
                    eIndex = eLink[rIndex]!;
                    if (eIndex === SK_MAX_S32) break;
                    eLink[rIndex] = SK_MAX_S32;
                    if (eIndex >= 0) sLink[eIndex] = SK_MAX_S32;
                    else eLink[~eIndex] = SK_MAX_S32;
                }
                else
                {
                    eIndex = sLink[rIndex]!;
                    if (eIndex === SK_MAX_S32) break;
                    sLink[rIndex] = SK_MAX_S32;
                    if (eIndex >= 0) eLink[eIndex] = SK_MAX_S32;
                    else sLink[~eIndex] = SK_MAX_S32;
                }
                rIndex = eIndex;
                if (rIndex < 0)
                {
                    forward = !forward;
                    rIndex = ~rIndex;
                }
            }
            // Find next unstarted partial.
            for (rIndex = 0; rIndex < linkCount; ++rIndex)
            {
                if (sLink[rIndex] !== SK_MAX_S32)
                {
                    continue outer;
                }
            }
            break;
        }
    }
}

const SK_MAX_S32 = 0x7FFFFFFF;
