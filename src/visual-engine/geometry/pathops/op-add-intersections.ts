// Copyright 2012 Google Inc.
//
// Use of this source code is governed by a BSD-style license that can
// be found in the LICENSE-skia file at the root of this repository.
//
// TypeScript port: 2026 Eugene Napryaglo.
// Source: third_party/skia/src/pathops/SkAddIntersections.cpp
//
// Phase 7 step 5 — pair-wise intersection sweep. For every segment-
// segment pair across the contour tree, run the appropriate
// intersection engine (line × line closed-form, line × curve via the
// quad-line / cubic-line helpers, curve × curve via SkTSect's
// BinarySearch), then splice the discovered pt-Ts into each segment
// via addT and link them with addOpp / mergeMatches so the walker
// will see them as a single pt-T loop.

import { Cubic } from './cubic.js';
import { Intersections } from './intersections.js';
// Side-effect imports — install the per-pair intersection methods
// (intersectLineLine / Quad × Line / Cubic × Line / Quad × Quad /
// Cubic × Quad / Cubic × Cubic) onto the Intersections prototype.
// Without these, AddIntersectTs at line ~116 calls
// `ts.intersectCubicCubic` which throws "not a function" when this
// module is reached via a path that didn't pass through the pathops
// barrel (e.g. the § 19.7 combine() driver).
import './quad-line-intersection.js';
import './cubic-line-intersection.js';
import './t-sect.js';
import { Line } from './line.js';
import { Point } from './point.js';
import { Quad } from './quad.js';
import { OpContour, OpContourHead } from './op-contour.js';
import { OpSegment } from './op-segment.js';
import type { OpCoincidence } from './op-coincidence.js';
import { OpSpanBase } from './op-span.js';
import { OpVerb } from './op-fwd.js';

// Run all intersection routines between two contours.
export function AddIntersectTs(test: OpContour, next: OpContour,
                                coincidence: OpCoincidence): boolean
{
    if (test !== next)
    {
        if (test.bounds().fBottom < next.bounds().fTop) return false;
        if (!test.bounds().intersects(next.bounds())) return true;
    }
    let wt: OpSegment | undefined = test.first();
    while (wt !== undefined)
    {
        let wn: OpSegment | undefined = next.first();
        while (wn !== undefined)
        {
            // On the same contour, only compare each pair once.
            if (test === next && wn === wt)
            {
                wn = wn.next();
                continue;
            }
            if (test === next && wnComesBefore(wn, wt))
            {
                wn = wn.next();
                continue;
            }
            if (!wt.bounds().intersects(wn.bounds()))
            {
                wn = wn.next();
                continue;
            }
            intersectPair(wt, wn, coincidence);
            wn = wn.next();
        }
        wt = wt.next();
    }
    return true;
}

// Same-contour "start after" check — Skia uses segment IDs.
function wnComesBefore(wn: OpSegment, wt: OpSegment): boolean
{
    return wn.fID < wt.fID;
}

// Heart of the sweep — dispatch on the (wt, wn) verb pair and feed
// results into both segments' span chains.
function intersectPair(wt: OpSegment, wn: OpSegment, coincidence: OpCoincidence): void
{
    const ts = new Intersections();
    let swap = false;
    const wtVerb = wt.verb();
    const wnVerb = wn.verb();
    const wtPts  = wt.pts();
    const wnPts  = wn.pts();
    let pts = 0;
    if (wtVerb === OpVerb.kLine && wnVerb === OpVerb.kLine)
    {
        const a = new Line(wtPts[0]!, wtPts[1]!);
        const b = new Line(wnPts[0]!, wnPts[1]!);
        pts = ts.intersectLineLine(a, b);
    }
    else if (wtVerb === OpVerb.kLine && wnVerb === OpVerb.kQuad)
    {
        swap = true;
        const q = new Quad(); q.fPts = [wnPts[0]!, wnPts[1]!, wnPts[2]!];
        const a = new Line(wtPts[0]!, wtPts[1]!);
        pts = ts.intersectQuadLine(q, a);
    }
    else if (wtVerb === OpVerb.kQuad && wnVerb === OpVerb.kLine)
    {
        const q = new Quad(); q.fPts = [wtPts[0]!, wtPts[1]!, wtPts[2]!];
        const a = new Line(wnPts[0]!, wnPts[1]!);
        pts = ts.intersectQuadLine(q, a);
    }
    else if (wtVerb === OpVerb.kLine && wnVerb === OpVerb.kCubic)
    {
        swap = true;
        const c = new Cubic(); c.fPts = [wnPts[0]!, wnPts[1]!, wnPts[2]!, wnPts[3]!];
        const a = new Line(wtPts[0]!, wtPts[1]!);
        pts = ts.intersectCubicLine(c, a);
    }
    else if (wtVerb === OpVerb.kCubic && wnVerb === OpVerb.kLine)
    {
        const c = new Cubic(); c.fPts = [wtPts[0]!, wtPts[1]!, wtPts[2]!, wtPts[3]!];
        const a = new Line(wnPts[0]!, wnPts[1]!);
        pts = ts.intersectCubicLine(c, a);
    }
    else if (wtVerb === OpVerb.kQuad && wnVerb === OpVerb.kQuad)
    {
        const q1 = new Quad(); q1.fPts = [wtPts[0]!, wtPts[1]!, wtPts[2]!];
        const q2 = new Quad(); q2.fPts = [wnPts[0]!, wnPts[1]!, wnPts[2]!];
        pts = ts.intersectQuadQuad(q1, q2);
    }
    else if (wtVerb === OpVerb.kQuad && wnVerb === OpVerb.kCubic)
    {
        const q  = new Quad(); q.fPts  = [wtPts[0]!, wtPts[1]!, wtPts[2]!];
        const c  = new Cubic(); c.fPts = [wnPts[0]!, wnPts[1]!, wnPts[2]!, wnPts[3]!];
        swap = true;
        pts = ts.intersectCubicQuad(c, q);
    }
    else if (wtVerb === OpVerb.kCubic && wnVerb === OpVerb.kQuad)
    {
        const c  = new Cubic(); c.fPts = [wtPts[0]!, wtPts[1]!, wtPts[2]!, wtPts[3]!];
        const q  = new Quad(); q.fPts  = [wnPts[0]!, wnPts[1]!, wnPts[2]!];
        pts = ts.intersectCubicQuad(c, q);
    }
    else if (wtVerb === OpVerb.kCubic && wnVerb === OpVerb.kCubic)
    {
        const c1 = new Cubic(); c1.fPts = [wtPts[0]!, wtPts[1]!, wtPts[2]!, wtPts[3]!];
        const c2 = new Cubic(); c2.fPts = [wnPts[0]!, wnPts[1]!, wnPts[2]!, wnPts[3]!];
        pts = ts.intersectCubicCubic(c1, c2);
    }
    else
    {
        return;  // unsupported verb pair (conic)
    }
    // Each result point lands as a pt-T on both segments.
    let coinIndex = -1;
    let coinPt0: import('./op-span.js').OpPtT | undefined;
    let coinPt1: import('./op-span.js').OpPtT | undefined;
    for (let i = 0; i < pts; ++i)
    {
        const t0 = ts.fT[swap ? 1 : 0]![i]!;
        const t1 = ts.fT[swap ? 0 : 1]![i]!;
        const iPt = ts.pt(i);
        const iPtIsIntegral = iPt.fX === Math.floor(iPt.fX) && iPt.fY === Math.floor(iPt.fY);
        const testTAt = iPtIsIntegral ? wt.addT(t0, iPt) : wt.addT(t0);
        const nextTAt = iPtIsIntegral ? wn.addT(t1, iPt) : wn.addT(t1);
        if (testTAt === undefined || nextTAt === undefined) continue;
        if (!testTAt.containsPtT(nextTAt))
        {
            const oppPrev = testTAt.oppPrev(nextTAt);
            if (oppPrev !== undefined)
            {
                testTAt.span().mergeMatches(nextTAt.span());
                testTAt.addOpp(nextTAt, oppPrev);
            }
            if (!testTAt.fPt.equals(nextTAt.fPt))
            {
                testTAt.span().unaligned();
                nextTAt.span().unaligned();
            }
        }
        if (!ts.isCoincident(i)) continue;
        if (coinIndex < 0)
        {
            coinPt0 = testTAt;
            coinPt1 = nextTAt;
            coinIndex = i;
            continue;
        }
        if (coinPt0!.span() === testTAt.span()) { coinIndex = -1; continue; }
        if (coinPt1!.span() === nextTAt.span()) { coinIndex = -1; continue; }
        let coinA = coinPt0!, coinB = coinPt1!;
        let endA = testTAt, endB = nextTAt;
        if (swap)
        {
            const t = coinA; coinA = coinB; coinB = t;
            const u = endA; endA = endB; endB = u;
        }
        if (coinA.span().deleted() || endA.span().deleted()) { coinIndex = -1; continue; }
        coincidence.add(coinA, endA, coinB, endB);
        coinIndex = -1;
    }
    void OpContourHead;
    void OpSpanBase;
    void Point;
}
