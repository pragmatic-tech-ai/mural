// Copyright 2012 Google Inc.
//
// Use of this source code is governed by a BSD-style license that can
// be found in the LICENSE-skia file at the root of this repository.
//
// TypeScript port: 2026 Eugene Napryaglo.
// Source: third_party/skia/src/pathops/SkPathOpsOp.cpp
//         third_party/skia/src/pathops/SkPathOpsSimplify.cpp (simplified)
//
// Phase 7 + 8 final step — driver:
//   * Op(pathA, pathB, op, result) — binary path op entry point.
//   * Simplify(path, result) — unary simplify (collapse self-
//     intersections, normalise winding).
//
// Pipeline (Op):
//   1. Inverse-fill rewrite via gOpInverse / gOutInverse.
//   2. Build a single OpContourHead containing both operands via
//      OpEdgeBuilder.
//   3. SortContourList — sort by bounds, set fOppXor.
//   4. AddIntersectTs — pair-wise intersection sweep.
//   5. HandleCoincidence — full resolver pipeline.
//   6. bridgeOp — walk the contour ring emitting active edges via
//      OpSegment.addCurveTo into the OpPathWriter; chase back-edges
//      via findChaseOp.
//   7. OpPathWriter.assemble — splice partial contours by closest-
//      pair greedy matching.

import { OpCoincidence } from './op-coincidence.js';
import { OpContour, OpContourHead } from './op-contour.js';
import { OpEdgeBuilder } from './op-edge-builder.js';
import { OpFillType, OpPath } from './op-path.js';
import { OpPathWriter } from './op-path-writer.js';
import { OpGlobalState, OpMask, OpPhase } from './op-global-state.js';
import { OpSegment, SkPathOp } from './op-segment.js';
import type { OpSpanBase } from './op-span.js';
import { AddIntersectTs } from './op-add-intersections.js';
import {
    AngleWinding,
    FindChase,
    HandleCoincidence,
    SortContourList,
} from './op-path-ops-common.js';
import { FindSortableTop } from './op-winding.js';

// SkPathOpsOp.cpp:220.
const D = SkPathOp.kDifference;
const I = SkPathOp.kIntersect;
const U = SkPathOp.kUnion;
const X = SkPathOp.kXOR_SkPathOp;
const R = SkPathOp.kReverseDifference;

const gOpInverse: ReadonlyArray<ReadonlyArray<ReadonlyArray<SkPathOp>>> = [
    [[D, I], [U, R]],
    [[I, D], [R, U]],
    [[U, R], [D, I]],
    [[X, X], [X, X]],
    [[R, U], [I, D]],
];

const gOutInverse: ReadonlyArray<ReadonlyArray<ReadonlyArray<boolean>>> = [
    [[false, false], [true,  false]],   // diff
    [[false, false], [false, true ]],   // sect
    [[false, true ], [true,  true ]],   // union
    [[false, true ], [true,  false]],   // xor
    [[false, true ], [false, false]],   // rev diff
];

// SkPathOpsOp.cpp:28.
function findChaseOp(chase: OpSpanBase[],
                     startPtr: { value: OpSpanBase | undefined },
                     endPtr:   { value: OpSpanBase | undefined }):
    { ok: boolean; result: OpSegment | undefined }
{
    while (chase.length > 0)
    {
        const span = chase.pop()!;
        startPtr.value = span.ptT().prev().span();
        const segment = startPtr.value.segment() as OpSegment;
        const done = { value: true };
        endPtr.value = undefined;
        // Skia passes startPtr / endPtr directly into activeAngle so it
        // can mutate them in-place — the chase walker then reads the
        // updated pair to feed AngleWinding. The earlier port used
        // separate local boxes that never propagated back; that left
        // endPtr.value === undefined and AngleWinding's
        // segment.spanToAngle crashed on `end.t()`.
        const last = segment.activeAngle(startPtr.value, startPtr, endPtr, done);
        if (last !== undefined)
        {
            startPtr.value = last.start() as OpSpanBase;
            endPtr.value   = last.end()   as OpSpanBase;
            chase.push(span);
            return { ok: true, result: last.segment() as OpSegment };
        }
        if (done.value) continue;
        const aw = AngleWinding(startPtr.value!, endPtr.value!);
        if (aw.angle === undefined) return { ok: true, result: undefined };
        if (aw.winding === SK_MIN_S32) continue;
        let sumMiWinding = 0, sumSuWinding = 0;
        if (aw.sortable)
        {
            const seg2 = aw.angle.segment() as OpSegment;
            sumMiWinding = seg2.updateWindingReverseByAngle(aw.angle);
            if (sumMiWinding === SK_MIN_S32) return { ok: true, result: undefined };
            sumSuWinding = seg2.updateOppWindingReverseByAngle(aw.angle);
            if (sumSuWinding === SK_MIN_S32) return { ok: true, result: undefined };
            if (seg2.operand())
            {
                const t = sumMiWinding; sumMiWinding = sumSuWinding; sumSuWinding = t;
            }
        }
        let first: OpSegment | undefined = undefined;
        const firstAngle = aw.angle;
        let probe = aw.angle.next();
        // §19.7 engine fix — same sum-ref propagation as findNextOp.
        // Skia's findChaseOp passes sumMiWinding / sumSuWinding as
        // int* to setUpWindings so each angle in the ring mutates the
        // running totals in place. The port previously created a
        // fresh `w` object per iteration, so the totals never
        // propagated across angles and Intersect's chase walker saw
        // every span with the same (wrong) windings.
        while (probe !== firstAngle)
        {
            const seg3 = probe!.segment() as OpSegment;
            const start = probe!.start() as OpSpanBase;
            const end   = probe!.end()   as OpSpanBase;
            const w = { maxWinding: 0, sumWinding: 0,
                        oppMaxWinding: 0, oppSumWinding: 0,
                        sumMiWinding, sumSuWinding };
            if (aw.sortable)
            {
                seg3.setUpWindingsBinary(start, end, w);
                sumMiWinding = w.sumMiWinding;
                sumSuWinding = w.sumSuWinding;
            }
            if (!seg3.doneByAngle(probe!))
            {
                if (first === undefined && (aw.sortable
                    || start.starter(end).windSum() !== SK_MIN_S32))
                {
                    first = seg3;
                    startPtr.value = start;
                    endPtr.value   = end;
                }
                if (aw.sortable)
                {
                    if (!seg3.markAngleBinary(w.maxWinding, w.sumWinding,
                                                w.oppMaxWinding, w.oppSumWinding,
                                                probe!, { value: undefined }))
                    {
                        return { ok: false, result: undefined };
                    }
                }
            }
            probe = probe!.next();
        }
        if (first !== undefined)
        {
            chase.push(span);
            return { ok: true, result: first };
        }
    }
    return { ok: true, result: undefined };
}

const SK_MIN_S32 = -0x80000000 | 0;

// SkPathOpsOp.cpp:122 — outer walker for binary ops.
function bridgeOp(contourList: OpContourHead, op: SkPathOp,
                   xorMask: number, xorOpMask: number,
                   writer: OpPathWriter): boolean
{
    let unsortableBox = { value: false };
    let lastSimple = false;
    let simpleBox = { value: false };
    // Adversarial inputs in the §19.8 corpus (PathOpsOpTest fuzz
    // entries) occasionally drive the walker into a degenerate loop
    // where FindSortableTop keeps returning a span and the chase
    // never advances. The hard caps are loose enough that any
    // honest contour graph terminates well within them.
    let outerSafety = 1_000;
    for (;;)
    {
        if (--outerSafety <= 0) return false;
        const span = FindSortableTop(contourList);
        if (span === undefined) break;
        let current: OpSegment | undefined = span.segment() as OpSegment;
        let startPtr: { value: OpSpanBase | undefined } = { value: span.next() };
        let endPtr:   { value: OpSpanBase | undefined } = { value: span };
        const chase: OpSpanBase[] = [];
        let chainSafety = 1_000;
        do
        {
            if (--chainSafety <= 0) return false;
            if (current!.activeOp(startPtr.value!, endPtr.value!, xorMask, xorOpMask, op))
            {
                let innerSafety = 1_000;
                do
                {
                    if (--innerSafety <= 0) return false;
                    if (!unsortableBox.value && current!.done()) break;
                    const nextStart = { value: startPtr.value };
                    const nextEnd   = { value: endPtr.value };
                    lastSimple = simpleBox.value;
                    const next = current!.findNextOp(chase, nextStart, nextEnd,
                                                    unsortableBox, simpleBox,
                                                    op, xorMask, xorOpMask);
                    if (next === undefined)
                    {
                        if (!unsortableBox.value && writer.hasMove()
                            && current!.verb() !== 1 /* kLine */
                            && !writer.isClosed())
                        {
                            if (!current!.addCurveTo(startPtr.value!, endPtr.value!, writer))
                                return false;
                        }
                        else if (lastSimple)
                        {
                            if (!current!.addCurveTo(startPtr.value!, endPtr.value!, writer))
                                return false;
                        }
                        break;
                    }
                    if (!current!.addCurveTo(startPtr.value!, endPtr.value!, writer)) return false;
                    current = next;
                    startPtr = nextStart;
                    endPtr   = nextEnd;
                } while (!writer.isClosed()
                         && (!unsortableBox.value || !startPtr.value!.starter(endPtr.value!).done()));
                if (current!.activeOp(startPtr.value!, endPtr.value!, xorMask, xorOpMask, op)
                    && !writer.isClosed())
                {
                    const spanStart = startPtr.value!.starter(endPtr.value!);
                    if (!spanStart.done())
                    {
                        if (!current!.addCurveTo(startPtr.value!, endPtr.value!, writer)) return false;
                        current!.markDone(spanStart);
                    }
                }
                writer.finishContour();
            }
            else
            {
                const lastBox: { value: OpSpanBase | undefined } = { value: undefined };
                if (!current!.markAndChaseDone(startPtr.value!, endPtr.value!, lastBox)) return false;
                if (lastBox.value !== undefined && !lastBox.value.chased())
                {
                    lastBox.value.setChased(true);
                    chase.push(lastBox.value);
                }
            }
            const fc = findChaseOp(chase, startPtr, endPtr);
            if (!fc.ok) return false;
            current = fc.result;
            if (current === undefined) break;
        } while (true);
    }
    return true;
}

// SkPathOpsOp.cpp:252.
export function Op(one: OpPath, two: OpPath, op: SkPathOp, result: OpPath): boolean
{
    op = gOpInverse[op]![one.isInverseFillType() ? 1 : 0]![two.isInverseFillType() ? 1 : 0]!;
    const inverseFill = gOutInverse[op]![one.isInverseFillType() ? 1 : 0]![two.isInverseFillType() ? 1 : 0]!;
    const fillType: OpFillType = inverseFill ? OpFillType.kInverseEvenOdd : OpFillType.kEvenOdd;
    if (one.isEmpty() || two.isEmpty())
    {
        const work = new OpPath();
        switch (op)
        {
            case SkPathOp.kIntersect: break;
            case SkPathOp.kUnion:
            case SkPathOp.kXOR_SkPathOp:
                work.addPath(one.isEmpty() ? two : one);
                break;
            case SkPathOp.kDifference:
                if (!one.isEmpty()) work.addPath(one);
                break;
            case SkPathOp.kReverseDifference:
                if (!two.isEmpty()) work.addPath(two);
                break;
            default: return false;
        }
        if (inverseFill !== work.isInverseFillType()) work.toggleInverseFillType();
        return Simplify(work, result);
    }
    let minuend = one;
    let subtrahend = two;
    if (op === SkPathOp.kReverseDifference)
    {
        minuend = two;
        subtrahend = one;
        op = SkPathOp.kDifference;
    }
    const contour = new OpContourHead();
    const state = new OpGlobalState(contour);
    contour.init(state, false, false);
    const coincidence = new OpCoincidence(state);
    const builder = new OpEdgeBuilder(minuend, contour, state, /* allowOpen */ false);
    if (builder.unparseable()) return false;
    const xorMask = builder.xorMask();
    builder.addOperand(subtrahend);
    if (!builder.finish()) return false;
    const xorOpMask = builder.xorMask();
    const headPtr: { value: OpContourHead | undefined } = { value: contour };
    if (!SortContourList(headPtr,
                         xorMask    === OpMask.kEvenOdd,
                         xorOpMask  === OpMask.kEvenOdd))
    {
        result.reset();
        result.setFillType(fillType);
        return true;
    }
    const sortedHead = headPtr.value!;
    // Pair-wise intersection sweep.
    let current: OpContour | undefined = sortedHead;
    while (current !== undefined)
    {
        let next: OpContour | undefined = current;
        while (next !== undefined)
        {
            if (!AddIntersectTs(current, next, coincidence)) break;
            next = next.next();
        }
        current = current.next();
    }
    state.setPhase(OpPhase.kWalking);
    if (!HandleCoincidence(sortedHead, coincidence)) return false;
    // Output assembly.
    const original = new OpPath();
    original.addPath(result);
    result.reset();
    result.setFillType(fillType);
    const writer = new OpPathWriter(result);
    if (!bridgeOp(sortedHead, op,
                  xorMask === OpMask.kEvenOdd ? 1 : -1,
                  xorOpMask === OpMask.kEvenOdd ? 1 : -1,
                  writer))
    {
        // Restore the original on failure.
        result.reset();
        result.addPath(original);
        return false;
    }
    writer.assemble();
    return true;
}

// SkPathOpsSimplify.cpp (port) — unary simplify.
// Walks one input path through the same pipeline as Op but with the
// "unary" winding semantics from activeWinding instead of activeOp.
export function Simplify(path: OpPath, result: OpPath): boolean
{
    const fillType: OpFillType = path.isInverseFillType()
        ? OpFillType.kInverseEvenOdd : OpFillType.kEvenOdd;
    if (path.isEmpty())
    {
        result.reset();
        result.setFillType(fillType);
        return true;
    }
    const contour = new OpContourHead();
    const state = new OpGlobalState(contour);
    contour.init(state, false, false);
    const coincidence = new OpCoincidence(state);
    const builder = new OpEdgeBuilder(path, contour, state, false);
    if (builder.unparseable()) return false;
    if (!builder.finish()) return false;
    const xorMask = builder.xorMask();
    const headPtr: { value: OpContourHead | undefined } = { value: contour };
    if (!SortContourList(headPtr, xorMask === OpMask.kEvenOdd, false))
    {
        result.reset();
        result.setFillType(fillType);
        return true;
    }
    const sortedHead = headPtr.value!;
    let current: OpContour | undefined = sortedHead;
    while (current !== undefined)
    {
        let next: OpContour | undefined = current;
        while (next !== undefined)
        {
            if (!AddIntersectTs(current, next, coincidence)) break;
            next = next.next();
        }
        current = current.next();
    }
    state.setPhase(OpPhase.kWalking);
    if (!HandleCoincidence(sortedHead, coincidence)) return false;
    result.reset();
    result.setFillType(fillType);
    const writer = new OpPathWriter(result);
    if (!bridgeWinding(sortedHead, writer)) return false;
    writer.assemble();
    return true;
}

// SkPathOpsSimplify.cpp bridgeWinding equivalent.
function bridgeWinding(contourList: OpContourHead, writer: OpPathWriter): boolean
{
    const unsortableBox = { value: false };
    let outerSafety = 1_000;
    for (;;)
    {
        if (--outerSafety <= 0) return false;
        const span = FindSortableTop(contourList);
        if (span === undefined) break;
        let current: OpSegment | undefined = span.segment() as OpSegment;
        let startPtr: { value: OpSpanBase | undefined } = { value: span.next() };
        let endPtr:   { value: OpSpanBase | undefined } = { value: span };
        const chase: OpSpanBase[] = [];
        let chainSafety = 1_000;
        do
        {
            if (--chainSafety <= 0) return false;
            if (current!.activeWinding(startPtr.value!, endPtr.value!))
            {
                let innerSafety = 1_000;
                do
                {
                    if (--innerSafety <= 0) return false;
                    if (!unsortableBox.value && current!.done()) break;
                    const nextStart = { value: startPtr.value };
                    const nextEnd   = { value: endPtr.value };
                    const next = current!.findNextWinding(chase, nextStart, nextEnd, unsortableBox);
                    if (next === undefined)
                    {
                        if (!unsortableBox.value && writer.hasMove() && current!.verb() !== 1)
                        {
                            if (!current!.addCurveTo(startPtr.value!, endPtr.value!, writer))
                                return false;
                        }
                        break;
                    }
                    if (!current!.addCurveTo(startPtr.value!, endPtr.value!, writer)) return false;
                    current = next;
                    startPtr = nextStart;
                    endPtr   = nextEnd;
                } while (!writer.isClosed()
                         && (!unsortableBox.value || !startPtr.value!.starter(endPtr.value!).done()));
                writer.finishContour();
            }
            else
            {
                const lastBox: { value: OpSpanBase | undefined } = { value: undefined };
                if (!current!.markAndChaseDone(startPtr.value!, endPtr.value!, lastBox)) return false;
                if (lastBox.value !== undefined && !lastBox.value.chased())
                {
                    lastBox.value.setChased(true);
                    chase.push(lastBox.value);
                }
            }
            const next2 = FindChase(chase, startPtr, endPtr);
            if (next2 === undefined) break;
            current = next2;
        } while (true);
    }
    return true;
}
