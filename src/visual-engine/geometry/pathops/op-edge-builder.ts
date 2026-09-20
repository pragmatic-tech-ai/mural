// Copyright 2012 Google Inc.
//
// Use of this source code is governed by a BSD-style license that can
// be found in the LICENSE-skia file at the root of this repository.
//
// TypeScript port: 2026 Eugene Napryaglo.
// Source: third_party/skia/src/pathops/SkOpEdgeBuilder.{h,cpp}
//
// Path → OpContourHead. Walks the input OpPath, classifies each verb,
// runs degeneracy checks, and feeds the OpContourBuilder which then
// allocates / wires segments into the contour tree.
//
// Simplifications vs. Skia:
//   * No conic verb (mural doesn't expose conics).
//   * Skipping SkDCubic::ComplexBreak — the cubic-self-intersection
//     pre-split. Inputs with loops will still be processed by the
//     intersection engine, just less reliably for adversarial cubics.
//   * Skipping SkChopQuadAtMaxCurvature — the quadratic curvature
//     pre-split. Same trade-off for tight quads.
//   * SkReduceOrder degenerate-curve detection is replaced with a
//     simple endpoint-match collinearity check.

import { Point } from './point.js';
import { FLT_EPSILON_ORDERABLE_ERR } from './types.js';
import { OpContour, OpContourBuilder, OpContourHead } from './op-contour.js';
import { OpGlobalState } from './op-global-state.js';
import { OpMask } from './op-global-state.js';
import { OpVerb } from './op-fwd.js';
import { OpPath, OpFillType } from './op-path.js';

function forceSmallToZero(p: Point): Point
{
    let x = p.fX, y = p.fY;
    if (Math.abs(x) < FLT_EPSILON_ORDERABLE_ERR) x = 0;
    if (Math.abs(y) < FLT_EPSILON_ORDERABLE_ERR) y = 0;
    return new Point(x, y);
}

function approxEqualPt(a: Point, b: Point): boolean
{
    return a.equals(b);
}

// SkOpEdgeBuilder.cpp:43.
function canAddCurve(verb: OpVerb, pts: Point[]): boolean
{
    if (verb === OpVerb.kMove) return false;
    for (let i = 0; i <= verbToPointsCount(verb); ++i)
    {
        pts[i] = forceSmallToZero(pts[i]!);
    }
    return verb !== OpVerb.kLine || !approxEqualPt(pts[0]!, pts[1]!);
}

function verbToPointsCount(v: OpVerb): number
{
    switch (v)
    {
        case OpVerb.kLine:  return 1;
        case OpVerb.kQuad:  return 2;
        case OpVerb.kCubic: return 3;
        default:            return 0;
    }
}

export class OpEdgeBuilder
{
    public fGlobalState: OpGlobalState;
    public fPath: OpPath;
    public fPathPts: Point[]   = [];
    public fPathVerbs: OpVerb[] = [];
    public fContourBuilder: OpContourBuilder;
    public fContoursHead: OpContourHead;
    public fXorMask: [OpMask, OpMask] = [OpMask.kWinding, OpMask.kWinding];
    public fSecondHalf: number = 0;
    public fOperand:  boolean = false;
    public fAllowOpenContours: boolean = false;
    public fUnparseable: boolean = false;

    constructor(path: OpPath, contoursHead: OpContourHead, state: OpGlobalState,
                allowOpen: boolean = false)
    {
        this.fGlobalState = state;
        this.fPath = path;
        this.fContoursHead = contoursHead;
        this.fContourBuilder = new OpContourBuilder(contoursHead);
        this.fAllowOpenContours = allowOpen;
        this.init();
    }

    public init(): void
    {
        this.fOperand = false;
        const evenOdd = (this.fPath.getFillType() & 1) !== 0;
        this.fXorMask[0] = this.fXorMask[1] = evenOdd ? OpMask.kEvenOdd : OpMask.kWinding;
        this.fUnparseable = false;
        this.fSecondHalf = this.preFetch();
    }

    public unparseable(): boolean { return this.fUnparseable; }
    public xorMask(): OpMask { return this.fXorMask[this.fOperand ? 1 : 0]!; }

    public addOperand(path: OpPath): void
    {
        // Pop the trailing kDone marker so the second path appends.
        // We don't emit kDone explicitly — preFetch leaves the tail at
        // a sentinel value (-1 / OpVerb.kDone) instead.
        if (this.fPathVerbs.length > 0 && this.fPathVerbs[this.fPathVerbs.length - 1] === OpVerb.kDone)
        {
            this.fPathVerbs.pop();
        }
        this.fPath = path;
        const evenOdd = (path.getFillType() & 1) !== 0;
        this.fXorMask[1] = evenOdd ? OpMask.kEvenOdd : OpMask.kWinding;
        this.preFetch();
    }

    public complete(): void
    {
        this.fContourBuilder.flush();
        const contour = this.fContourBuilder.contour();
        if (contour !== undefined && contour.count() !== 0)
        {
            contour.complete();
        }
    }

    public finish(): boolean
    {
        this.fOperand = false;
        if (this.fUnparseable || !this.walk()) return false;
        this.complete();
        const contour = this.fContourBuilder.contour();
        if (contour !== undefined && contour.count() === 0 && contour !== this.fContoursHead)
        {
            this.fContoursHead.remove(contour);
        }
        return true;
    }

    public head(): OpContourHead { return this.fContoursHead; }

    // SkOpEdgeBuilder.cpp:75.
    private closeContour(curveEnd: Point, curveStart: Point): void
    {
        if (!approxEqualPt(curveEnd, curveStart))
        {
            this.fPathVerbs.push(OpVerb.kLine);
            this.fPathPts.push(curveStart);
        }
        else
        {
            const v = this.fPathVerbs;
            const p = this.fPathPts;
            const last = v[v.length - 1]!;
            if (last === OpVerb.kLine && p[p.length - 2]!.equals(curveStart))
            {
                v.pop();
                p.pop();
            }
            else
            {
                p[p.length - 1] = curveStart;
            }
        }
        this.fPathVerbs.push(OpVerb.kClose);
    }

    // SkOpEdgeBuilder.cpp:93 — normalised input verb stream.
    private preFetch(): number
    {
        let curveStart = new Point(0, 0);
        const curve: Point[] = [new Point(), new Point(), new Point(), new Point()];
        let lastCurve = false;
        for (const cmd of this.fPath.iterate())
        {
            switch (cmd.verb)
            {
                case OpVerb.kMove:
                    if (!this.fAllowOpenContours && lastCurve)
                    {
                        this.closeContour(curve[0]!, curveStart);
                    }
                    this.fPathVerbs.push(OpVerb.kMove);
                    curve[0] = forceSmallToZero(cmd.pts[0]!);
                    this.fPathPts.push(curve[0]!);
                    curveStart = curve[0]!;
                    lastCurve = false;
                    continue;
                case OpVerb.kLine:
                    curve[1] = forceSmallToZero(cmd.pts[0]!);
                    if (approxEqualPt(curve[0]!, curve[1]!))
                    {
                        const lv = this.fPathVerbs[this.fPathVerbs.length - 1]!;
                        if (lv !== OpVerb.kLine && lv !== OpVerb.kMove)
                        {
                            curve[0] = curve[1]!;
                            this.fPathPts[this.fPathPts.length - 1] = curve[0]!;
                        }
                        continue;
                    }
                    break;
                case OpVerb.kQuad:
                    curve[1] = forceSmallToZero(cmd.pts[0]!);
                    curve[2] = forceSmallToZero(cmd.pts[1]!);
                    break;
                case OpVerb.kCubic:
                    curve[1] = forceSmallToZero(cmd.pts[0]!);
                    curve[2] = forceSmallToZero(cmd.pts[1]!);
                    curve[3] = forceSmallToZero(cmd.pts[2]!);
                    break;
                case OpVerb.kClose:
                    this.closeContour(curve[0]!, curveStart);
                    lastCurve = false;
                    continue;
                default:
                    continue;
            }
            this.fPathVerbs.push(cmd.verb);
            const ptCount = verbToPointsCount(cmd.verb);
            for (let i = 1; i <= ptCount; ++i) this.fPathPts.push(curve[i]!);
            curve[0] = curve[ptCount]!;
            lastCurve = true;
        }
        if (!this.fAllowOpenContours && lastCurve)
        {
            this.closeContour(curve[0]!, curveStart);
        }
        this.fPathVerbs.push(OpVerb.kDone);
        return this.fPathVerbs.length - 1;
    }

    // SkOpEdgeBuilder.cpp:179.
    private walk(): boolean
    {
        let verbIdx = 0;
        let pointIdx = 0;
        const endOfFirstHalf = this.fSecondHalf;
        let contour: OpContour | undefined = this.fContourBuilder.contour();
        let moveToPtrBump = 0;
        while (verbIdx < this.fPathVerbs.length)
        {
            const verb = this.fPathVerbs[verbIdx]!;
            if (verb === OpVerb.kDone) break;
            if (verbIdx === endOfFirstHalf) this.fOperand = true;
            ++verbIdx;
            switch (verb)
            {
                case OpVerb.kMove:
                {
                    if (contour !== undefined && contour.count() > 0)
                    {
                        if (this.fAllowOpenContours)
                        {
                            this.complete();
                        }
                        else if (!this.close())
                        {
                            return false;
                        }
                    }
                    if (contour === undefined
                        || contour.count() > 0)
                    {
                        contour = this.fContoursHead.appendContour();
                        this.fContourBuilder.setContour(contour);
                    }
                    contour.init(this.fGlobalState, this.fOperand,
                                  this.fXorMask[this.fOperand ? 1 : 0] === OpMask.kEvenOdd);
                    pointIdx += moveToPtrBump;
                    moveToPtrBump = 1;
                    continue;
                }
                case OpVerb.kLine:
                {
                    if (contour === undefined)
                    {
                        contour = this.fContoursHead.appendContour();
                        this.fContourBuilder.setContour(contour);
                        contour.init(this.fGlobalState, this.fOperand,
                                      this.fXorMask[this.fOperand ? 1 : 0] === OpMask.kEvenOdd);
                    }
                    const p0 = this.fPathPts[pointIdx]!;
                    const p1 = this.fPathPts[pointIdx + 1]!;
                    this.fContourBuilder.addLine([p0, p1]);
                    break;
                }
                case OpVerb.kQuad:
                {
                    if (contour === undefined)
                    {
                        contour = this.fContoursHead.appendContour();
                        this.fContourBuilder.setContour(contour);
                        contour.init(this.fGlobalState, this.fOperand,
                                      this.fXorMask[this.fOperand ? 1 : 0] === OpMask.kEvenOdd);
                    }
                    const p0 = this.fPathPts[pointIdx]!;
                    const p1 = this.fPathPts[pointIdx + 1]!;
                    const p2 = this.fPathPts[pointIdx + 2]!;
                    if (canAddCurve(OpVerb.kQuad, [p0, p1, p2]))
                    {
                        this.fContourBuilder.addQuad([p0, p1, p2]);
                    }
                    break;
                }
                case OpVerb.kCubic:
                {
                    if (contour === undefined)
                    {
                        contour = this.fContoursHead.appendContour();
                        this.fContourBuilder.setContour(contour);
                        contour.init(this.fGlobalState, this.fOperand,
                                      this.fXorMask[this.fOperand ? 1 : 0] === OpMask.kEvenOdd);
                    }
                    const p0 = this.fPathPts[pointIdx]!;
                    const p1 = this.fPathPts[pointIdx + 1]!;
                    const p2 = this.fPathPts[pointIdx + 2]!;
                    const p3 = this.fPathPts[pointIdx + 3]!;
                    if (canAddCurve(OpVerb.kCubic, [p0, p1, p2, p3]))
                    {
                        this.fContourBuilder.addCubic([p0, p1, p2, p3]);
                    }
                    break;
                }
                case OpVerb.kClose:
                {
                    if (contour === undefined) return false;
                    if (!this.close()) return false;
                    contour = undefined;
                    continue;
                }
                default: return false;
            }
            pointIdx += verbToPointsCount(verb);
        }
        this.fContourBuilder.flush();
        if (contour !== undefined && contour.count() !== 0
            && !this.fAllowOpenContours && !this.close())
        {
            return false;
        }
        void OpFillType;
        return true;
    }

    private close(): boolean
    {
        this.complete();
        return true;
    }
}
