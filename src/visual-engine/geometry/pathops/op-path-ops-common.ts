// Copyright 2012 Google Inc.
//
// Use of this source code is governed by a BSD-style license that can
// be found in the LICENSE-skia file at the root of this repository.
//
// TypeScript port: 2026 Eugene Napryaglo.
// Source: third_party/skia/src/pathops/SkPathOpsCommon.cpp
//
// Phase 7 step 6 — pipeline orchestration:
//   * SortContourList — bbox-sort contours so the walker hits the
//     topmost one first; sets fOppXor.
//   * AngleWinding — pick an angle whose windSum the walker can
//     trust, with fallback to computeWindSum when the chain is
//     unorderable.
//   * FindUndone — first not-yet-processed span across all contours.
//   * FindChase — pop a chase-array entry, find the angle to advance to.
//   * HandleCoincidence — runs the full coincidence resolver pipeline
//     (addExpanded → move_multiples → move_nearby → correctEnds →
//     addEndMovedSpans → addMissing loop → expand → addExpanded → mark
//     → missing_coincidence check → apply / findOverlaps loop →
//     calc_angles → sort_angles).

import type { OpAngle } from './op-angle.js';
import { OpCoincidence } from './op-coincidence.js';
import { OpContour, OpContourHead } from './op-contour.js';
import { OpSpan, OpSpanBase, SK_MIN_S32 } from './op-span.js';
import type { OpSegment } from './op-segment.js';

// SkPathOpsCommon.cpp:21.
export function AngleWinding(start: OpSpanBase, end: OpSpanBase):
    { angle: OpAngle | undefined; winding: number; sortable: boolean }
{
    let segment = start.segment() as OpSegment;
    let angle: OpAngle | undefined = segment.spanToAngle(start, end);
    if (angle === undefined) return { angle: undefined, winding: SK_MIN_S32, sortable: false };
    let computeWinding = false;
    const firstAngle = angle;
    let loop = false;
    let unorderable = false;
    let winding = SK_MIN_S32;
    do
    {
        angle = angle.next();
        if (angle === undefined) return { angle: undefined, winding: SK_MIN_S32, sortable: false };
        unorderable = unorderable || angle.unorderable();
        computeWinding = unorderable || (angle === firstAngle && loop);
        if (computeWinding) break;
        loop = loop || angle === firstAngle;
        segment = angle.segment() as OpSegment;
        winding = segment.windSum(angle);
    } while (winding === SK_MIN_S32);
    if (computeWinding)
    {
        let probe: OpAngle = angle!;
        const firstProbe = probe;
        winding = SK_MIN_S32;
        do
        {
            const startSpan = probe.start() as OpSpanBase;
            const endSpan   = probe.end()   as OpSpanBase;
            const lesser = startSpan.starter(endSpan);
            let testWinding = lesser.windSum();
            if (testWinding === SK_MIN_S32) testWinding = lesser.computeWindSum();
            if (testWinding !== SK_MIN_S32)
            {
                winding = testWinding;
            }
            probe = probe.next()!;
        } while (probe !== firstProbe);
        angle = probe;
    }
    return { angle, winding, sortable: !unorderable };
}

export function FindUndone(contourHead: OpContourHead): OpSpan | undefined
{
    let contour: OpContour | undefined = contourHead;
    while (contour !== undefined)
    {
        if (!contour.done())
        {
            const result = contour.undoneSpan();
            if (result !== undefined) return result;
        }
        contour = contour.next();
    }
    return undefined;
}

// SkPathOpsCommon.cpp:87.
export function FindChase(chase: OpSpanBase[],
                          startPtr: { value: OpSpanBase | undefined },
                          endPtr:   { value: OpSpanBase | undefined }): OpSegment | undefined
{
    while (chase.length > 0)
    {
        const span = chase.pop()!;
        const segment = span.segment() as OpSegment;
        startPtr.value = span.ptT().next().span();
        const done = { value: true };
        endPtr.value = undefined;
        // Pass startPtr / endPtr directly so activeAngle can mutate
        // them in-place — matches Skia's `&start, &end` semantics.
        // The earlier port used local boxes that never propagated
        // back; endPtr.value stayed undefined and the AngleWinding
        // call below crashed in segment.spanToAngle's `end.t()` read.
        const last = segment.activeAngle(startPtr.value!, startPtr, endPtr, done);
        if (last !== undefined)
        {
            startPtr.value = last.start() as OpSpanBase;
            endPtr.value   = last.end()   as OpSpanBase;
            chase.push(span);
            return last.segment() as OpSegment;
        }
        if (done.value) continue;
        const aw = AngleWinding(startPtr.value!, endPtr.value!);
        if (aw.angle === undefined) return undefined;
        if (aw.winding === SK_MIN_S32) continue;
        let sumWinding = 0;
        if (aw.sortable)
        {
            const seg2 = aw.angle.segment() as OpSegment;
            sumWinding = seg2.updateWindingReverseByAngle(aw.angle);
        }
        let first: OpSegment | undefined = undefined;
        const firstAngle = aw.angle;
        let probe: OpAngle | undefined = aw.angle.next();
        while (probe !== firstAngle)
        {
            const seg3 = probe!.segment() as OpSegment;
            const start = probe!.start() as OpSpanBase;
            const end   = probe!.end()   as OpSpanBase;
            const w = { maxWinding: 0, sumWinding };
            if (aw.sortable) seg3.setUpWinding(start, end, w);
            if (!seg3.doneByAngle(probe!))
            {
                if (first === undefined && (aw.sortable || start.starter(end).windSum() !== SK_MIN_S32))
                {
                    first = seg3;
                    startPtr.value = start;
                    endPtr.value   = end;
                }
                if (aw.sortable)
                {
                    seg3.markAngle(w.maxWinding, w.sumWinding, probe!, { value: undefined });
                }
            }
            probe = probe!.next();
        }
        if (first !== undefined)
        {
            chase.push(span);
            return first;
        }
    }
    return undefined;
}

// SkPathOpsCommon.cpp:159.
export function SortContourList(contourListPtr: { value: OpContourHead | undefined },
                                  evenOdd: boolean, oppEvenOdd: boolean): boolean
{
    const list: OpContour[] = [];
    let contour: OpContour | undefined = contourListPtr.value;
    while (contour !== undefined)
    {
        if (contour.count() > 0)
        {
            contour.setOppXor(contour.operand() ? evenOdd : oppEvenOdd);
            list.push(contour);
        }
        contour = contour.next();
    }
    if (list.length === 0) return false;
    if (list.length > 1)
    {
        list.sort((a, b) =>
            a.bounds().fTop === b.bounds().fTop
                ? a.bounds().fLeft - b.bounds().fLeft
                : a.bounds().fTop - b.bounds().fTop);
    }
    const head = list[0]! as OpContourHead;
    contourListPtr.value = head;
    head.globalState().setContourHead(head);
    for (let i = 1; i < list.length; ++i)
    {
        list[i - 1]!.setNext(list[i]!);
    }
    list[list.length - 1]!.setNext(undefined);
    return true;
}

function calcAngles(contourHead: OpContourHead): void
{
    let c: OpContour | undefined = contourHead;
    while (c !== undefined) { c.calcAngles(); c = c.next(); }
}

function missingCoincidence(contourHead: OpContourHead): boolean
{
    let c: OpContour | undefined = contourHead;
    let result = false;
    while (c !== undefined)
    {
        if (c.missingCoincidence()) result = true;
        c = c.next();
    }
    return result;
}

function moveMultiples(contourHead: OpContourHead): boolean
{
    let c: OpContour | undefined = contourHead;
    while (c !== undefined)
    {
        if (!c.moveMultiples()) return false;
        c = c.next();
    }
    return true;
}

function moveNearby(contourHead: OpContourHead): boolean
{
    let c: OpContour | undefined = contourHead;
    while (c !== undefined)
    {
        if (!c.moveNearby()) return false;
        c = c.next();
    }
    return true;
}

function sortAngles(contourHead: OpContourHead): boolean
{
    let c: OpContour | undefined = contourHead;
    while (c !== undefined)
    {
        if (!c.sortAngles()) return false;
        c = c.next();
    }
    return true;
}

// SkPathOpsCommon.cpp:238 — the coincidence resolver pipeline.
export function HandleCoincidence(contourHead: OpContourHead,
                                    coincidence: OpCoincidence): boolean
{
    if (!coincidence.addExpanded()) return false;
    if (!moveMultiples(contourHead)) return false;
    if (!moveNearby(contourHead))    return false;
    coincidence.correctEnds();
    if (!coincidence.addEndMovedSpans()) return false;
    let safetyHatch = 3;
    for (;;)
    {
        const addedOut = { value: false };
        if (!coincidence.addMissing(addedOut)) return false;
        if (!addedOut.value) break;
        if (!--safetyHatch) return false;
        moveNearby(contourHead);
    }
    if (coincidence.expand())
    {
        const addedOut = { value: false };
        if (!coincidence.addMissing(addedOut)) return false;
        if (!coincidence.addExpanded())        return false;
        if (!moveMultiples(contourHead))       return false;
        moveNearby(contourHead);
    }
    if (!coincidence.addExpanded()) return false;
    coincidence.mark();
    if (missingCoincidence(contourHead))
    {
        coincidence.expand();
        if (!coincidence.addExpanded()) return false;
        if (!coincidence.mark())        return false;
    }
    else
    {
        coincidence.expand();
    }
    coincidence.expand();
    // Skia: SkOpCoincidence overlaps(globalState). Resolver loops apply + findOverlaps
    // until no overlap pairs remain.
    const overlaps = new OpCoincidence(contourHead.globalState());
    safetyHatch = 3;
    do
    {
        const pairs = overlaps.isEmpty() ? coincidence : overlaps;
        if (!pairs.apply())                          return false;
        if (!pairs.findOverlaps(overlaps))           return false;
        if (!--safetyHatch) return false;
    } while (!overlaps.isEmpty());
    calcAngles(contourHead);
    if (!sortAngles(contourHead)) return false;
    return true;
}
