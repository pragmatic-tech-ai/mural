// Copyright 2015 Google Inc.
//
// Use of this source code is governed by a BSD-style license that can
// be found in the LICENSE-skia file at the root of this repository.
//
// TypeScript port: 2026 Eugene Napryaglo.
// Source: third_party/skia/src/pathops/SkOpCoincidence.{h,cpp}
//         (Skia commit pinned in third_party/skia)
//
// Phase 6 chunk 4 — coincidence resolver. Two classes:
//
//   CoincidentSpans — one record of a coincident-segment pair. Holds
//     four pt-T pointers: (coinStart, coinEnd) on the lower-id
//     segment and (oppStart, oppEnd) on the higher-id segment, where
//     "lower" is by Ordered() (verb-then-x-then-y). Records form a
//     singly-linked list rooted in fHead on OpCoincidence; during
//     phase transitions the resolver moves fHead → fTop so re-entries
//     don't iterate over freshly-added pairs.
//
//   OpCoincidence — list manager + resolver kernel. Constructor
//     attaches itself to globalState.fCoincidence so OpSpan.release /
//     OpSpanBase.checkForCollapsedCoincidence can reach it without
//     plumbing through. The kernel is the multi-phase pipeline the
//     path-ops driver runs between intersection-detection and
//     winding-walk:
//
//       1. addEndMovedSpans — propagate coincidence implied by end
//          points that share a position with another segment but not
//          a recorded pt-T.
//       2. addExpanded — fill in interior spans on each coincident
//          run so the winding walker has a continuous t-chain.
//       3. mark — write fCoincident links on every interior span and
//          fCoinEnd on the boundaries.
//       4. apply — propagate winding values across coincident pairs
//          (the source winding is added/subtracted from the opp
//          winding; the source is then cleared to zero).
//       5. addMissing — find cross-pair runs that share a segment but
//          haven't been linked yet; add them via addOrOverlap.
//       6. expand / correctEnds — boundary cleanup.
//       7. release / releaseDeleted / restoreHead — list maintenance.
//
// All "DEBUG_COIN" branches in Skia map to no-ops here; mural's port
// keeps the structural fields (fContinue, fSpanDeleted, fPtAllocated,
// fCoinExtended, fSpanMerged) for parity but no path-ops driver flips
// them yet (the driver lands in Phase 7).

import { Cubic } from './cubic.js';
import { Intersections } from './intersections.js';
import { Line } from './line.js';
import { Point } from './point.js';
import { Quad } from './quad.js';
import { between, zero_or_one } from './types.js';
import { OpGlobalState } from './op-global-state.js';
import { OpPtT, OpSpan, OpSpanBase, OpCollapsed } from './op-span.js';
import { OpSegment } from './op-segment.js';
import { OpVerb, verbToPoints, type OpCoincidenceLike } from './op-fwd.js';

// ── CoincidentSpans ──────────────────────────────────────────────

export class CoincidentSpans
{
    public fNext: CoincidentSpans | undefined = undefined;
    public fCoinPtTStart: OpPtT | undefined = undefined;
    public fCoinPtTEnd:   OpPtT | undefined = undefined;
    public fOppPtTStart:  OpPtT | undefined = undefined;
    public fOppPtTEnd:    OpPtT | undefined = undefined;

    constructor() {}

    public init(): void
    {
        this.fNext = undefined;
        this.fCoinPtTStart = undefined;
        this.fCoinPtTEnd = undefined;
        this.fOppPtTStart = undefined;
        this.fOppPtTEnd = undefined;
    }

    public next(): CoincidentSpans | undefined { return this.fNext; }
    public setNext(n: CoincidentSpans | undefined): void { this.fNext = n; }

    public coinPtTStart(): OpPtT { return this.fCoinPtTStart!; }
    public coinPtTEnd():   OpPtT { return this.fCoinPtTEnd!; }
    public oppPtTStart():  OpPtT { return this.fOppPtTStart!; }
    public oppPtTEnd():    OpPtT { return this.fOppPtTEnd!; }

    public flipped(): boolean
    {
        return this.fOppPtTStart!.fT > this.fOppPtTEnd!.fT;
    }

    // SkOpCoincidence.cpp:22.
    public collapsed(test: OpPtT): boolean
    {
        return (this.fCoinPtTStart === test && this.fCoinPtTEnd!.containsPtT(test))
            || (this.fCoinPtTEnd === test && this.fCoinPtTStart!.containsPtT(test))
            || (this.fOppPtTStart === test && this.fOppPtTEnd!.containsPtT(test))
            || (this.fOppPtTEnd === test && this.fOppPtTStart!.containsPtT(test));
    }

    // SkOpCoincidence.cpp:131.
    public contains(s: OpPtT, e: OpPtT): boolean
    {
        let lo = s, hi = e;
        if (lo.fT > hi.fT) { const t = lo; lo = hi; hi = t; }
        if (lo.segment() === this.fCoinPtTStart!.segment())
        {
            return this.fCoinPtTStart!.fT <= lo.fT && hi.fT <= this.fCoinPtTEnd!.fT;
        }
        // assume opp side
        let oppTs = this.fOppPtTStart!.fT;
        let oppTe = this.fOppPtTEnd!.fT;
        if (oppTs > oppTe) { const t = oppTs; oppTs = oppTe; oppTe = t; }
        return oppTs <= lo.fT && hi.fT <= oppTe;
    }

    public setCoinPtTStart(p: OpPtT): void
    {
        this.fCoinPtTStart = p;
        p.setCoincident();
    }
    public setCoinPtTEnd(p: OpPtT): void
    {
        this.fCoinPtTEnd = p;
        p.setCoincident();
    }
    public setOppPtTStart(p: OpPtT): void
    {
        this.fOppPtTStart = p;
        p.setCoincident();
    }
    public setOppPtTEnd(p: OpPtT): void
    {
        this.fOppPtTEnd = p;
        p.setCoincident();
    }

    public setStarts(coinPtTStart: OpPtT, oppPtTStart: OpPtT): void
    {
        this.setCoinPtTStart(coinPtTStart);
        this.setOppPtTStart(oppPtTStart);
    }
    public setEnds(coinPtTEnd: OpPtT, oppPtTEnd: OpPtT): void
    {
        this.setCoinPtTEnd(coinPtTEnd);
        this.setOppPtTEnd(oppPtTEnd);
    }

    // SkOpCoincidence.cpp:122.
    public set(next: CoincidentSpans | undefined,
               coinPtTStart: OpPtT, coinPtTEnd: OpPtT,
               oppPtTStart:  OpPtT, oppPtTEnd:  OpPtT): void
    {
        this.fNext = next;
        this.setStarts(coinPtTStart, oppPtTStart);
        this.setEnds(coinPtTEnd, oppPtTEnd);
    }

    // SkOpCoincidence.cpp:105.
    public extend(coinPtTStart: OpPtT, coinPtTEnd: OpPtT,
                  oppPtTStart:  OpPtT, oppPtTEnd:  OpPtT): boolean
    {
        let result = false;
        const flipped = this.flipped();
        if (this.fCoinPtTStart!.fT > coinPtTStart.fT
            || (flipped ? this.fOppPtTStart!.fT < oppPtTStart.fT
                        : this.fOppPtTStart!.fT > oppPtTStart.fT))
        {
            this.setStarts(coinPtTStart, oppPtTStart);
            result = true;
        }
        if (this.fCoinPtTEnd!.fT < coinPtTEnd.fT
            || (flipped ? this.fOppPtTEnd!.fT > oppPtTEnd.fT
                        : this.fOppPtTEnd!.fT < oppPtTEnd.fT))
        {
            this.setEnds(coinPtTEnd, oppPtTEnd);
            result = true;
        }
        return result;
    }

    // SkOpCoincidence.cpp:163.
    public ordered(out: { result: boolean }): boolean
    {
        const start = this.coinPtTStart().span();
        const end   = this.coinPtTEnd().span();
        const startUp = start.upCastable();
        if (startUp === undefined) { out.result = false; return true; }
        let next: OpSpanBase = startUp.next();
        if (next === end) { out.result = true; return true; }
        const flipped = this.flipped();
        const oppSeg = this.oppPtTStart().segment() as OpSegment;
        let oppLastT = this.fOppPtTStart!.fT;
        for (;;)
        {
            const opp = next.containsSegment(oppSeg);
            if (opp === undefined) return false;
            if ((oppLastT > opp.fT) !== flipped)
            {
                out.result = false;
                return true;
            }
            oppLastT = opp.fT;
            if (next === end) break;
            const up = next.upCastable();
            if (up === undefined) { out.result = false; return true; }
            next = up.next();
        }
        out.result = true;
        return true;
    }

    // SkOpCoincidence.cpp:40.
    // Skia uses C++ member-function pointers; we pass functor objects.
    public correctOneEnd(
        getEnd: () => OpPtT,
        setEnd: (p: OpPtT) => void,
    ): void
    {
        const origPtT = getEnd();
        const origSpan = origPtT.span();
        const prev = origSpan.prev();
        const testSpan = prev !== undefined ? prev.next() : origSpan.upCast().next().prev();
        const testPtT = testSpan!.ptT();
        if (origPtT !== testPtT) setEnd(testPtT);
    }

    public correctEnds(): void
    {
        this.correctOneEnd(() => this.coinPtTStart(), (p) => this.setCoinPtTStart(p));
        this.correctOneEnd(() => this.coinPtTEnd(),   (p) => this.setCoinPtTEnd(p));
        this.correctOneEnd(() => this.oppPtTStart(),  (p) => this.setOppPtTStart(p));
        this.correctOneEnd(() => this.oppPtTEnd(),    (p) => this.setOppPtTEnd(p));
    }

    // SkOpCoincidence.cpp:66.
    public expand(): boolean
    {
        let expanded = false;
        const segment = this.coinPtTStart().segment() as OpSegment;
        const oppSegment = this.oppPtTStart().segment() as OpSegment;
        // grow start
        for (;;)
        {
            const start = this.coinPtTStart().span().upCastable();
            if (start === undefined) break;
            const prev = start.prev();
            if (prev === undefined) break;
            const oppPtT = prev.containsSegment(oppSegment);
            if (oppPtT === undefined) break;
            const midT = (prev.t() + start.t()) / 2;
            if (!segment.isClose(midT, oppSegment)) break;
            this.setStarts(prev.ptT(), oppPtT);
            expanded = true;
        }
        // grow end
        for (;;)
        {
            const end = this.coinPtTEnd().span();
            const next = end.final() ? undefined : end.upCast().next();
            if (next !== undefined && next.deleted()) break;
            if (next === undefined) break;
            const oppPtT = next.containsSegment(oppSegment);
            if (oppPtT === undefined) break;
            const midT = (end.t() + next.t()) / 2;
            if (!segment.isClose(midT, oppSegment)) break;
            this.setEnds(next.ptT(), oppPtT);
            expanded = true;
        }
        return expanded;
    }
}

// ── OpCoincidence ───────────────────────────────────────────────

export class OpCoincidence implements OpCoincidenceLike
{
    public readonly __opCoincidenceLikeBrand = true as const;

    public fHead: CoincidentSpans | undefined = undefined;
    public fTop:  CoincidentSpans | undefined = undefined;
    public fGlobalState: OpGlobalState;
    public fContinue: boolean = false;
    public fSpanDeleted: boolean = false;
    public fPtAllocated: boolean = false;
    public fCoinExtended: boolean = false;
    public fSpanMerged: boolean = false;

    constructor(state: OpGlobalState)
    {
        this.fGlobalState = state;
        state.setCoincidence(this);
    }

    public globalState(): OpGlobalState { return this.fGlobalState; }

    public isEmpty(): boolean { return this.fHead === undefined && this.fTop === undefined; }

    // SkOpCoincidence.cpp:1411.
    public static Ordered(coin: OpSegment, opp: OpSegment): boolean
    {
        if (coin.verb() < opp.verb()) return true;
        if (coin.verb() > opp.verb()) return false;
        const count = (verbToPoints(coin.verb()) + 1) * 2;
        const cPts = coin.pts();
        const oPts = opp.pts();
        for (let idx = 0; idx < count; ++idx)
        {
            const cIdx = idx >> 1;
            const cIsY = idx & 1;
            const cVal = cIsY ? cPts[cIdx]!.fY : cPts[cIdx]!.fX;
            const oVal = cIsY ? oPts[cIdx]!.fY : oPts[cIdx]!.fX;
            if (cVal < oVal) return true;
            if (cVal > oVal) return false;
        }
        return true;
    }

    public static OrderedPtT(coinPtTStart: OpPtT, oppPtTStart: OpPtT): boolean
    {
        return OpCoincidence.Ordered(coinPtTStart.segment() as OpSegment,
                                     oppPtTStart.segment() as OpSegment);
    }

    // SkOpCoincidence.cpp:257.
    public add(coinPtTStart: OpPtT, coinPtTEnd: OpPtT,
               oppPtTStart:  OpPtT, oppPtTEnd:  OpPtT): void
    {
        if (!OpCoincidence.OrderedPtT(coinPtTStart, oppPtTStart))
        {
            if (oppPtTStart.fT < oppPtTEnd.fT)
            {
                this.add(oppPtTStart, oppPtTEnd, coinPtTStart, coinPtTEnd);
            }
            else
            {
                this.add(oppPtTEnd, oppPtTStart, coinPtTEnd, coinPtTStart);
            }
            return;
        }
        // Choose the canonical pt-T (the span's primary ptT).
        coinPtTStart = coinPtTStart.span().ptT();
        coinPtTEnd   = coinPtTEnd.span().ptT();
        oppPtTStart  = oppPtTStart.span().ptT();
        oppPtTEnd    = oppPtTEnd.span().ptT();
        // Validations
        if (coinPtTStart.fT >= coinPtTEnd.fT) return;
        if (oppPtTStart.fT === oppPtTEnd.fT) return;
        if (coinPtTStart.deleted() || coinPtTEnd.deleted()) return;
        if (oppPtTStart.deleted() || oppPtTEnd.deleted()) return;
        const rec = new CoincidentSpans();
        rec.init();
        rec.set(this.fHead, coinPtTStart, coinPtTEnd, oppPtTStart, oppPtTEnd);
        this.fHead = rec;
    }

    // SkOpCoincidence.cpp:199.
    public extend(coinPtTStart: OpPtT, coinPtTEnd: OpPtT,
                  oppPtTStart:  OpPtT, oppPtTEnd:  OpPtT): boolean
    {
        let test = this.fHead;
        if (test === undefined) return false;
        let coinSeg = coinPtTStart.segment() as OpSegment;
        let oppSeg  = oppPtTStart.segment() as OpSegment;
        let cS = coinPtTStart, cE = coinPtTEnd, oS = oppPtTStart, oE = oppPtTEnd;
        if (!OpCoincidence.Ordered(coinSeg, oppSeg))
        {
            const tmpSeg = coinSeg; coinSeg = oppSeg; oppSeg = tmpSeg;
            const tmpS = cS; cS = oS; oS = tmpS;
            const tmpE = cE; cE = oE; oE = tmpE;
            if (cS.fT > cE.fT)
            {
                const a = cS; cS = cE; cE = a;
                const b = oS; oS = oE; oE = b;
            }
        }
        const oppMinT = Math.min(oS.fT, oE.fT);
        do
        {
            if (coinSeg !== test.coinPtTStart().segment()) continue;
            if (oppSeg  !== test.oppPtTStart().segment()) continue;
            const oTestMinT = Math.min(test.oppPtTStart().fT, test.oppPtTEnd().fT);
            const oTestMaxT = Math.max(test.oppPtTStart().fT, test.oppPtTEnd().fT);
            const coinTouches = (test.coinPtTStart().fT <= cE.fT
                              && cS.fT <= test.coinPtTEnd().fT);
            const oppTouches = (oTestMinT <= oTestMaxT && oppMinT <= oTestMaxT);
            if (coinTouches || oppTouches)
            {
                test.extend(cS, cE, oS, oE);
                return true;
            }
        } while ((test = test.next()!));
        return false;
    }

    // SkOpCoincidence.cpp:1297.
    public fixUp(deleted: OpPtT, kept: OpPtT): void
    {
        if (deleted === kept) return;
        if (this.fHead !== undefined) this._fixUpList(this.fHead, deleted, kept);
        if (this.fTop  !== undefined) this._fixUpList(this.fTop,  deleted, kept);
    }

    private _fixUpList(headSentinel: CoincidentSpans, deleted: OpPtT, kept: OpPtT): void
    {
        let coin: CoincidentSpans | undefined = headSentinel;
        while (coin !== undefined)
        {
            const next = coin.next();
            let removed = false;
            if (coin.coinPtTStart() === deleted)
            {
                if (coin.coinPtTEnd().span() === kept.span())
                {
                    this._release(headSentinel, coin);
                    removed = true;
                }
                else
                {
                    coin.setCoinPtTStart(kept);
                }
            }
            if (!removed && coin.coinPtTEnd() === deleted)
            {
                if (coin.coinPtTStart().span() === kept.span())
                {
                    this._release(headSentinel, coin);
                    removed = true;
                }
                else
                {
                    coin.setCoinPtTEnd(kept);
                }
            }
            if (!removed && coin.oppPtTStart() === deleted)
            {
                if (coin.oppPtTEnd().span() === kept.span())
                {
                    this._release(headSentinel, coin);
                    removed = true;
                }
                else
                {
                    coin.setOppPtTStart(kept);
                }
            }
            if (!removed && coin.oppPtTEnd() === deleted)
            {
                if (coin.oppPtTStart().span() === kept.span())
                {
                    this._release(headSentinel, coin);
                    removed = true;
                }
                else
                {
                    coin.setOppPtTEnd(kept);
                }
            }
            coin = next;
        }
    }

    // SkOpCoincidence.cpp:1160 — release `remove` from the list rooted
    // by `coin`. Returns true if remove was found and unlinked.
    private _release(coin: CoincidentSpans, remove: CoincidentSpans): boolean
    {
        const headIsThisFHead = coin === this.fHead;
        let walker: CoincidentSpans | undefined = coin;
        let prev: CoincidentSpans | undefined = undefined;
        while (walker !== undefined)
        {
            const next = walker.next();
            if (walker === remove)
            {
                if (prev !== undefined)
                {
                    prev.setNext(next);
                }
                else if (headIsThisFHead)
                {
                    this.fHead = next;
                }
                else
                {
                    this.fTop = next;
                }
                return true;
            }
            prev = walker;
            walker = next;
        }
        return false;
    }

    public release(segDeleted: OpSegment): void
    {
        let coin = this.fHead;
        if (coin === undefined) return;
        do
        {
            if (coin.coinPtTStart().segment() === segDeleted
                || coin.coinPtTEnd().segment() === segDeleted
                || coin.oppPtTStart().segment() === segDeleted
                || coin.oppPtTEnd().segment() === segDeleted)
            {
                this._release(this.fHead!, coin);
            }
        } while ((coin = coin.next()!));
    }

    public releaseDeleted(): void
    {
        if (this.fHead !== undefined) this._releaseDeletedList(this.fHead, true);
        if (this.fTop  !== undefined) this._releaseDeletedList(this.fTop,  false);
    }

    private _releaseDeletedList(head: CoincidentSpans, isFHead: boolean): void
    {
        let coin: CoincidentSpans | undefined = head;
        let prev: CoincidentSpans | undefined = undefined;
        while (coin !== undefined)
        {
            const next = coin.next();
            if (coin.coinPtTStart().deleted())
            {
                if (prev !== undefined) prev.setNext(next);
                else if (isFHead) this.fHead = next;
                else this.fTop = next;
            }
            else
            {
                prev = coin;
            }
            coin = next;
        }
    }

    public restoreHead(): void
    {
        // Walk fHead to its tail, splice fTop in.
        let tail = this.fHead;
        if (tail === undefined)
        {
            this.fHead = this.fTop;
        }
        else
        {
            while (tail.next() !== undefined) tail = tail.next()!;
            tail.setNext(this.fTop);
        }
        this.fTop = undefined;
        // Strip records whose segments have collapsed.
        let prev: CoincidentSpans | undefined = undefined;
        let walker = this.fHead;
        while (walker !== undefined)
        {
            const next = walker.next();
            const cs = walker.coinPtTStart().segment() as OpSegment;
            const os = walker.oppPtTStart().segment() as OpSegment;
            if (cs.done() || os.done())
            {
                if (prev !== undefined) prev.setNext(next);
                else this.fHead = next;
            }
            else
            {
                prev = walker;
            }
            walker = next;
        }
    }

    // SkOpCoincidence.cpp:942 / 952 / 970.
    public contains(seg: OpSegment, opp: OpSegment, oppT: number): boolean
    {
        if (this.fHead !== undefined && this._containsList(this.fHead, seg, opp, oppT)) return true;
        if (this.fTop  !== undefined && this._containsList(this.fTop,  seg, opp, oppT)) return true;
        return false;
    }

    private _containsList(head: CoincidentSpans, seg: OpSegment, opp: OpSegment, oppT: number): boolean
    {
        let coin: CoincidentSpans | undefined = head;
        do
        {
            if (coin.coinPtTStart().segment() === seg
                && coin.oppPtTStart().segment() === opp
                && between(coin.oppPtTStart().fT, oppT, coin.oppPtTEnd().fT)) return true;
            if (coin.oppPtTStart().segment() === seg
                && coin.coinPtTStart().segment() === opp
                && between(coin.coinPtTStart().fT, oppT, coin.coinPtTEnd().fT)) return true;
        } while ((coin = coin.next()) !== undefined);
        return false;
    }

    public containsPtTQuad(coinPtTStart: OpPtT, coinPtTEnd: OpPtT,
                           oppPtTStart:  OpPtT, oppPtTEnd:  OpPtT): boolean
    {
        let test = this.fHead;
        if (test === undefined) return false;
        let coinSeg = coinPtTStart.segment() as OpSegment;
        let oppSeg  = oppPtTStart.segment() as OpSegment;
        let cS = coinPtTStart, cE = coinPtTEnd, oS = oppPtTStart, oE = oppPtTEnd;
        if (!OpCoincidence.Ordered(coinSeg, oppSeg))
        {
            const tmpSeg = coinSeg; coinSeg = oppSeg; oppSeg = tmpSeg;
            const tmpS = cS; cS = oS; oS = tmpS;
            const tmpE = cE; cE = oE; oE = tmpE;
            if (cS.fT > cE.fT)
            {
                const a = cS; cS = cE; cE = a;
                const b = oS; oS = oE; oE = b;
            }
        }
        const oppMinT = Math.min(oS.fT, oE.fT);
        const oppMaxT = Math.max(oS.fT, oE.fT);
        do
        {
            if (coinSeg !== test.coinPtTStart().segment()) continue;
            if (cS.fT < test.coinPtTStart().fT) continue;
            if (cE.fT > test.coinPtTEnd().fT) continue;
            if (oppSeg !== test.oppPtTStart().segment()) continue;
            if (oppMinT < Math.min(test.oppPtTStart().fT, test.oppPtTEnd().fT)) continue;
            if (oppMaxT > Math.max(test.oppPtTStart().fT, test.oppPtTEnd().fT)) continue;
            return true;
        } while ((test = test.next()!));
        return false;
    }

    // SkOpCoincidence.cpp:1389 / 1406.
    public markCollapsed(test: OpPtT): void
    {
        if (this.fHead !== undefined) this._markCollapsedList(this.fHead, test);
        if (this.fTop  !== undefined) this._markCollapsedList(this.fTop,  test);
    }

    private _markCollapsedList(head: CoincidentSpans, test: OpPtT): void
    {
        let coin: CoincidentSpans | undefined = head;
        while (coin !== undefined)
        {
            const next = coin.next();
            if (coin.collapsed(test))
            {
                if (zero_or_one(coin.coinPtTStart().fT) && zero_or_one(coin.coinPtTEnd().fT))
                {
                    (coin.coinPtTStart().segment() as OpSegment).markAllDone();
                }
                if (zero_or_one(coin.oppPtTStart().fT) && zero_or_one(coin.oppPtTEnd().fT))
                {
                    (coin.oppPtTStart().segment() as OpSegment).markAllDone();
                }
                this._release(head, coin);
            }
            coin = next;
        }
    }

    // SkOpCoincidence.cpp:1434.
    public overlap(coin1s: OpPtT, coin1e: OpPtT, coin2s: OpPtT, coin2e: OpPtT,
                   out: { overS: number; overE: number }): boolean
    {
        out.overS = Math.max(Math.min(coin1s.fT, coin1e.fT),
                              Math.min(coin2s.fT, coin2e.fT));
        out.overE = Math.min(Math.max(coin1s.fT, coin1e.fT),
                              Math.max(coin2s.fT, coin2e.fT));
        return out.overS < out.overE;
    }

    // SkOpCoincidence.cpp:1014.
    public correctEnds(): void
    {
        let coin = this.fHead;
        if (coin === undefined) return;
        do { coin.correctEnds(); } while ((coin = coin.next()!));
    }

    // SkOpCoincidence.cpp:1234.
    public expand(): boolean
    {
        let coin = this.fHead;
        if (coin === undefined) return false;
        let expanded = false;
        do
        {
            if (coin.expand())
            {
                let test = this.fHead;
                while (test !== undefined)
                {
                    if (coin !== test
                        && coin.coinPtTStart() === test.coinPtTStart()
                        && coin.oppPtTStart()  === test.oppPtTStart())
                    {
                        this._release(this.fHead!, test);
                        break;
                    }
                    test = test.next();
                }
                expanded = true;
            }
        } while ((coin = coin.next()!));
        return expanded;
    }

    // SkOpCoincidence.cpp:1261.
    public findOverlaps(overlaps: OpCoincidence): boolean
    {
        overlaps.fHead = undefined;
        overlaps.fTop = undefined;
        let outer = this.fHead;
        while (outer !== undefined)
        {
            const outerCoin = outer.coinPtTStart().segment() as OpSegment;
            const outerOpp  = outer.oppPtTStart().segment() as OpSegment;
            let inner = outer.next();
            while (inner !== undefined)
            {
                const innerCoin = inner.coinPtTStart().segment() as OpSegment;
                if (outerCoin === innerCoin) { inner = inner.next(); continue; }
                const innerOpp = inner.oppPtTStart().segment() as OpSegment;
                let overlapS: OpPtT | undefined;
                let overlapE: OpPtT | undefined;
                let hasOverlap = false;
                if (outerOpp === innerCoin)
                {
                    const r = OpPtT.Overlaps(outer.oppPtTStart(), outer.oppPtTEnd(),
                                              inner.coinPtTStart(), inner.coinPtTEnd());
                    if (r.overlaps) { overlapS = r.sOut!; overlapE = r.eOut!; hasOverlap = true; }
                }
                else if (outerCoin === innerOpp)
                {
                    const r = OpPtT.Overlaps(outer.coinPtTStart(), outer.coinPtTEnd(),
                                              inner.oppPtTStart(), inner.oppPtTEnd());
                    if (r.overlaps) { overlapS = r.sOut!; overlapE = r.eOut!; hasOverlap = true; }
                }
                else if (outerOpp === innerOpp)
                {
                    const r = OpPtT.Overlaps(outer.oppPtTStart(), outer.oppPtTEnd(),
                                              inner.oppPtTStart(), inner.oppPtTEnd());
                    if (r.overlaps) { overlapS = r.sOut!; overlapE = r.eOut!; hasOverlap = true; }
                }
                if (hasOverlap)
                {
                    if (!overlaps.addOverlap(outerCoin, outerOpp, innerCoin, innerOpp,
                                              overlapS!, overlapE!))
                    {
                        return false;
                    }
                }
                inner = inner.next();
            }
            outer = outer.next();
        }
        return true;
    }

    // SkOpCoincidence.cpp:901.
    public addOverlap(seg1: OpSegment, seg1o: OpSegment,
                      seg2: OpSegment, seg2o: OpSegment,
                      overS: OpPtT, overE: OpPtT): boolean
    {
        let s1 = overS.find(seg1);
        let e1 = overE.find(seg1);
        if (s1 === undefined || e1 === undefined) return false;
        if (s1.starter(e1).span().upCast().windValue() === 0)
        {
            s1 = overS.find(seg1o);
            e1 = overE.find(seg1o);
            if (s1 === undefined || e1 === undefined) return false;
            if (s1.starter(e1).span().upCast().windValue() === 0) return true;
        }
        let s2 = overS.find(seg2);
        let e2 = overE.find(seg2);
        if (s2 === undefined || e2 === undefined) return false;
        if (s2.starter(e2).span().upCast().windValue() === 0)
        {
            s2 = overS.find(seg2o);
            e2 = overE.find(seg2o);
            if (s2 === undefined || e2 === undefined) return false;
            if (s2.starter(e2).span().upCast().windValue() === 0) return true;
        }
        if (s1.segment() === s2.segment()) return true;
        if (s1.fT > e1.fT)
        {
            const tmp1 = s1; s1 = e1; e1 = tmp1;
            const tmp2 = s2; s2 = e2; e2 = tmp2;
        }
        this.add(s1, e1, s2, e2);
        return true;
    }

    // SkOpCoincidence.cpp:576.
    public checkOverlap(check: CoincidentSpans | undefined,
                        coinSeg: OpSegment, oppSeg: OpSegment,
                        coinTs: number, coinTe: number, oppTs: number, oppTe: number,
                        overlaps: CoincidentSpans[]): boolean
    {
        if (!OpCoincidence.Ordered(coinSeg, oppSeg))
        {
            if (oppTs < oppTe)
            {
                return this.checkOverlap(check, oppSeg, coinSeg, oppTs, oppTe, coinTs, coinTe, overlaps);
            }
            return this.checkOverlap(check, oppSeg, coinSeg, oppTe, oppTs, coinTe, coinTs, overlaps);
        }
        const swapOpp = oppTs > oppTe;
        let oTs = oppTs, oTe = oppTe;
        if (swapOpp) { const t = oTs; oTs = oTe; oTe = t; }
        let walker = check;
        while (walker !== undefined)
        {
            if (walker.coinPtTStart().segment() === coinSeg
                && walker.oppPtTStart().segment() === oppSeg)
            {
                const checkTs = walker.coinPtTStart().fT;
                const checkTe = walker.coinPtTEnd().fT;
                const coinOutside = coinTe < checkTs || coinTs > checkTe;
                let oCheckTs = walker.oppPtTStart().fT;
                let oCheckTe = walker.oppPtTEnd().fT;
                if (swapOpp)
                {
                    if (oCheckTs <= oCheckTe) return false;
                    const t = oCheckTs; oCheckTs = oCheckTe; oCheckTe = t;
                }
                const oppOutside = oTe < oCheckTs || oTs > oCheckTe;
                if (!(coinOutside && oppOutside))
                {
                    const coinInside = coinTe <= checkTe && coinTs >= checkTs;
                    const oppInside  = oTe <= oCheckTe && oTs >= oCheckTs;
                    if (coinInside && oppInside) return false;
                    overlaps.push(walker);
                }
            }
            walker = walker.next();
        }
        return true;
    }

    // SkOpCoincidence.cpp:668 — heavily-branched add-or-merge entry.
    public addOrOverlap(coinSeg: OpSegment, oppSeg: OpSegment,
                        coinTs: number, coinTe: number,
                        oppTs:  number, oppTe:  number,
                        addedOut: { value: boolean }): boolean
    {
        const overlaps: CoincidentSpans[] = [];
        if (this.fTop === undefined) return false;
        if (!this.checkOverlap(this.fTop, coinSeg, oppSeg, coinTs, coinTe, oppTs, oppTe, overlaps))
        {
            return true;
        }
        if (this.fHead !== undefined
            && !this.checkOverlap(this.fHead, coinSeg, oppSeg, coinTs, coinTe, oppTs, oppTe, overlaps))
        {
            return true;
        }
        const overlap = overlaps.length ? overlaps[0]! : undefined;
        for (let i = 1; i < overlaps.length; ++i)
        {
            const test = overlaps[i]!;
            if (overlap!.coinPtTStart().fT > test.coinPtTStart().fT)
            {
                overlap!.setCoinPtTStart(test.coinPtTStart());
            }
            if (overlap!.coinPtTEnd().fT < test.coinPtTEnd().fT)
            {
                overlap!.setCoinPtTEnd(test.coinPtTEnd());
            }
            const flipped = overlap!.flipped();
            if (flipped ? overlap!.oppPtTStart().fT < test.oppPtTStart().fT
                        : overlap!.oppPtTStart().fT > test.oppPtTStart().fT)
            {
                overlap!.setOppPtTStart(test.oppPtTStart());
            }
            if (flipped ? overlap!.oppPtTEnd().fT > test.oppPtTEnd().fT
                        : overlap!.oppPtTEnd().fT < test.oppPtTEnd().fT)
            {
                overlap!.setOppPtTEnd(test.oppPtTEnd());
            }
            if (this.fHead === undefined || !this._release(this.fHead, test))
            {
                if (!this._release(this.fTop!, test)) return false;
            }
        }
        const cs = coinSeg.existing(coinTs, oppSeg);
        const ce = coinSeg.existing(coinTe, oppSeg);
        if (overlap !== undefined && cs !== undefined && ce !== undefined && overlap.contains(cs, ce)) return true;
        if (cs === ce && cs !== undefined) return false;
        const os = oppSeg.existing(oppTs, coinSeg);
        const oe = oppSeg.existing(oppTe, coinSeg);
        if (overlap !== undefined && os !== undefined && oe !== undefined && overlap.contains(os, oe)) return true;
        if ((cs !== undefined && cs.deleted())
            || (os !== undefined && os.deleted())
            || (ce !== undefined && ce.deleted())
            || (oe !== undefined && oe.deleted())) return false;
        const csExisting = cs === undefined ? coinSeg.existing(coinTs, undefined) : undefined;
        const ceExisting = ce === undefined ? coinSeg.existing(coinTe, undefined) : undefined;
        if (csExisting !== undefined && csExisting === ceExisting) return false;
        if (ceExisting !== undefined && (ceExisting === cs
            || ceExisting.containsPtT(csExisting !== undefined ? csExisting : cs!))) return false;
        const osExisting = os === undefined ? oppSeg.existing(oppTs, undefined) : undefined;
        const oeExisting = oe === undefined ? oppSeg.existing(oppTe, undefined) : undefined;
        if (osExisting !== undefined && osExisting === oeExisting) return false;
        if (osExisting !== undefined && (osExisting === oe
            || osExisting.containsPtT(oeExisting !== undefined ? oeExisting : oe!))) return false;
        if (oeExisting !== undefined && (oeExisting === os
            || oeExisting.containsPtT(osExisting !== undefined ? osExisting : os!))) return false;
        let csW: OpPtT | undefined = cs;
        let osW: OpPtT | undefined = os;
        if (cs === undefined || os === undefined)
        {
            csW = cs !== undefined ? cs : coinSeg.addT(coinTs);
            if (csW === ce) return true;
            osW = os !== undefined ? os : oppSeg.addT(oppTs);
            if (csW === undefined || osW === undefined) return false;
            csW.span().addOpp(osW.span());
            const osActive = osW.active();
            if (osActive === undefined) return false;
            osW = osActive;
            if ((ce !== undefined && ce.deleted()) || (oe !== undefined && oe.deleted())) return false;
        }
        let ceW: OpPtT | undefined = ce;
        let oeW: OpPtT | undefined = oe;
        if (ce === undefined || oe === undefined)
        {
            ceW = ce !== undefined ? ce : coinSeg.addT(coinTe);
            oeW = oe !== undefined ? oe : oppSeg.addT(oppTe);
            if (ceW === undefined || oeW === undefined) return false;
            if (!ceW.span().addOpp(oeW.span())) return false;
        }
        if (csW === undefined || osW === undefined || ceW === undefined || oeW === undefined) return false;
        if (csW.deleted() || osW.deleted() || ceW.deleted() || oeW.deleted()) return false;
        if (csW.containsPtT(ceW) || osW.containsPtT(oeW)) return false;
        if (overlap !== undefined)
        {
            if (overlap.coinPtTStart().segment() === coinSeg)
            {
                overlap.extend(csW, ceW, osW, oeW);
            }
            else
            {
                let a = csW, b = ceW, c = osW, d = oeW;
                if (c.fT > d.fT) { const t1 = a; a = b; b = t1; const t2 = c; c = d; d = t2; }
                overlap.extend(c, d, a, b);
            }
        }
        else
        {
            this.add(csW, ceW, osW, oeW);
        }
        addedOut.value = true;
        return true;
    }

    // SkOpCoincidence.cpp:540 — t-mapping helper for addIfMissing.
    public static TRange(overS: OpPtT, t: number, coinSeg: OpSegment): number
    {
        let work: OpSpanBase | undefined = overS.span();
        let foundStart: OpPtT | undefined = undefined;
        let foundEnd:   OpPtT | undefined = undefined;
        let coinStart:  OpPtT | undefined = undefined;
        let coinEnd:    OpPtT | undefined = undefined;
        while (work !== undefined)
        {
            const contained = work.containsSegment(coinSeg);
            if (contained !== undefined)
            {
                if (work.t() <= t)
                {
                    coinStart = contained;
                    foundStart = work.ptT();
                }
                if (work.t() >= t)
                {
                    coinEnd = contained;
                    foundEnd = work.ptT();
                    break;
                }
            }
            if (work.final()) break;
            const up = work.upCastable();
            if (up === undefined) break;
            work = up.next();
        }
        if (coinStart === undefined || coinEnd === undefined
            || foundStart === undefined || foundEnd === undefined) return 1;
        const denom = foundEnd.fT - foundStart.fT;
        const sRatio = denom ? (t - foundStart.fT) / denom : 1;
        return coinStart.fT + (coinEnd.fT - coinStart.fT) * sRatio;
    }

    // SkOpCoincidence.cpp:627.
    public addIfMissing(over1s: OpPtT, over2s: OpPtT,
                        tStart: number, tEnd: number,
                        coinSeg: OpSegment, oppSeg: OpSegment,
                        addedOut: { value: boolean }): boolean
    {
        let coinTs = OpCoincidence.TRange(over1s, tStart, coinSeg);
        let coinTe = OpCoincidence.TRange(over1s, tEnd,   coinSeg);
        const r1 = coinSeg.collapsed(coinTs, coinTe);
        if (r1 !== OpCollapsed.kNo) return r1 === OpCollapsed.kYes;
        let oppTs = OpCoincidence.TRange(over2s, tStart, oppSeg);
        let oppTe = OpCoincidence.TRange(over2s, tEnd,   oppSeg);
        const r2 = oppSeg.collapsed(oppTs, oppTe);
        if (r2 !== OpCollapsed.kNo) return r2 === OpCollapsed.kYes;
        if (coinTs > coinTe)
        {
            const t = coinTs; coinTs = coinTe; coinTe = t;
            const u = oppTs; oppTs = oppTe; oppTe = u;
        }
        void this.addOrOverlap(coinSeg, oppSeg, coinTs, coinTe, oppTs, oppTe, addedOut);
        return true;
    }

    // SkOpCoincidence.cpp:797.
    public addMissing(addedOut: { value: boolean }): boolean
    {
        let outer = this.fHead;
        addedOut.value = false;
        if (outer === undefined) return true;
        this.fTop = outer;
        this.fHead = undefined;
        do
        {
            const ocs = outer.coinPtTStart();
            if (ocs.deleted()) return false;
            const outerCoin = ocs.segment() as OpSegment;
            if (outerCoin.done()) return false;
            const oos = outer.oppPtTStart();
            if (oos.deleted()) return true;
            const outerOpp = oos.segment() as OpSegment;
            let inner = outer.next();
            while (inner !== undefined)
            {
                const overOut = { overS: 0, overE: 0 };
                const ics = inner.coinPtTStart();
                if (ics.deleted()) return false;
                const innerCoin = ics.segment() as OpSegment;
                if (innerCoin.done()) return false;
                const ios = inner.oppPtTStart();
                if (ios.deleted()) return false;
                const innerOpp = ios.segment() as OpSegment;
                if (outerCoin === innerCoin)
                {
                    const oce = outer.coinPtTEnd();
                    if (oce.deleted()) return true;
                    const ice = inner.coinPtTEnd();
                    if (ice.deleted()) return false;
                    if (outerOpp !== innerOpp && this.overlap(ocs, oce, ics, ice, overOut))
                    {
                        if (!this.addIfMissing(ocs.starter(oce), ics.starter(ice),
                                                overOut.overS, overOut.overE,
                                                outerOpp, innerOpp, addedOut)) return false;
                    }
                }
                else if (outerCoin === innerOpp)
                {
                    const oce = outer.coinPtTEnd();
                    if (oce.deleted()) return false;
                    const ioe = inner.oppPtTEnd();
                    if (ioe.deleted()) return false;
                    if (outerOpp !== innerCoin && this.overlap(ocs, oce, ios, ioe, overOut))
                    {
                        if (!this.addIfMissing(ocs.starter(oce), ios.starter(ioe),
                                                overOut.overS, overOut.overE,
                                                outerOpp, innerCoin, addedOut)) return false;
                    }
                }
                else if (outerOpp === innerCoin)
                {
                    const ooe = outer.oppPtTEnd();
                    if (ooe.deleted()) return false;
                    const ice = inner.coinPtTEnd();
                    if (ice.deleted()) return false;
                    if (this.overlap(oos, ooe, ics, ice, overOut))
                    {
                        if (!this.addIfMissing(oos.starter(ooe), ics.starter(ice),
                                                overOut.overS, overOut.overE,
                                                outerCoin, innerOpp, addedOut)) return false;
                    }
                }
                else if (outerOpp === innerOpp)
                {
                    const ooe = outer.oppPtTEnd();
                    if (ooe.deleted()) return false;
                    const ioe = inner.oppPtTEnd();
                    if (ioe.deleted()) return true;
                    if (this.overlap(oos, ooe, ios, ioe, overOut))
                    {
                        if (!this.addIfMissing(oos.starter(ooe), ios.starter(ioe),
                                                overOut.overS, overOut.overE,
                                                outerCoin, innerCoin, addedOut)) return false;
                    }
                }
                inner = inner.next();
            }
            outer = outer.next();
        } while (outer !== undefined);
        this.restoreHead();
        return true;
    }

    // SkOpCoincidence.cpp:289.
    private addEndMovedSpansBaseTest(base: OpSpan, testSpan: OpSpanBase): boolean
    {
        const testPtT0 = testSpan.ptT();
        let testPtT: OpPtT = testPtT0;
        const baseSeg = base.segment() as OpSegment;
        let escapeHatch = 100_000;
        testPtT = testPtT.next();
        while (testPtT !== testPtT0)
        {
            if (--escapeHatch <= 0) return false;
            const testSeg = testPtT.segment() as OpSegment;
            if (testPtT.deleted() || testSeg === baseSeg || testPtT.span().ptT() !== testPtT)
            {
                testPtT = testPtT.next();
                continue;
            }
            if (this.contains(baseSeg, testSeg, testPtT.fT))
            {
                testPtT = testPtT.next();
                continue;
            }
            // Perpendicular ray through base.pt() onto testSeg.
            const slope = baseSeg.dSlopeAtT(base.t());
            const pt = base.pt();
            const ix = new Intersections();
            const rayLine = new Line(new Point(pt.fX, pt.fY),
                                      new Point(pt.fX + slope.y, pt.fY - slope.x));
            switch (testSeg.verb())
            {
                case OpVerb.kLine:
                {
                    const ln = new Line(testSeg.pts()[0]!, testSeg.pts()[1]!);
                    ix.intersectRayLineLine(ln, rayLine);
                    break;
                }
                case OpVerb.kQuad:
                {
                    const q = new Quad();
                    q.fPts = [testSeg.pts()[0]!, testSeg.pts()[1]!, testSeg.pts()[2]!];
                    ix.intersectRayQuadLine(q, rayLine);
                    break;
                }
                case OpVerb.kCubic:
                {
                    const c = new Cubic();
                    c.fPts = [testSeg.pts()[0]!, testSeg.pts()[1]!,
                              testSeg.pts()[2]!, testSeg.pts()[3]!];
                    ix.intersectRayCubicLine(c, rayLine);
                    break;
                }
                default: testPtT = testPtT.next(); continue;
            }
            for (let i = 0; i < ix.used(); ++i)
            {
                const t = ix.fT[0]![i]!;
                if (!between(0, t, 1)) continue;
                const oppPt = ix.pt(i);
                const dx = oppPt.fX - pt.fX, dy = oppPt.fY - pt.fY;
                if (Math.abs(dx) >= 1e-4 || Math.abs(dy) >= 1e-4) continue;
                const oppStart = testSeg.addT(t);
                if (oppStart === undefined || oppStart === testPtT) continue;
                oppStart.span().addOpp(base);
                if (oppStart.deleted()) continue;
                let coinSeg = base.segment() as OpSegment;
                let oppSeg  = oppStart.segment() as OpSegment;
                let coinTs: number, coinTe: number, oppTs: number, oppTe: number;
                if (OpCoincidence.Ordered(coinSeg, oppSeg))
                {
                    coinTs = base.t();
                    coinTe = testSpan.t();
                    oppTs  = oppStart.fT;
                    oppTe  = testPtT.fT;
                }
                else
                {
                    const tmp = coinSeg; coinSeg = oppSeg; oppSeg = tmp;
                    coinTs = oppStart.fT;
                    coinTe = testPtT.fT;
                    oppTs  = base.t();
                    oppTe  = testSpan.t();
                }
                if (coinTs > coinTe)
                {
                    const t1 = coinTs; coinTs = coinTe; coinTe = t1;
                    const t2 = oppTs; oppTs = oppTe; oppTe = t2;
                }
                const added = { value: false };
                if (!this.addOrOverlap(coinSeg, oppSeg, coinTs, coinTe, oppTs, oppTe, added)) return false;
            }
            testPtT = testPtT.next();
        }
        return true;
    }

    private addEndMovedSpansFromPtT(ptT: OpPtT): boolean
    {
        const base = ptT.span().upCastable();
        if (base === undefined) return false;
        const prev = base.prev();
        if (prev === undefined) return false;
        if (!prev.isCanceled())
        {
            if (!this.addEndMovedSpansBaseTest(base, prev)) return false;
        }
        if (!base.isCanceled())
        {
            const next = base.next();
            if (!this.addEndMovedSpansBaseTest(base, next)) return false;
        }
        return true;
    }

    public addEndMovedSpans(): boolean
    {
        const span0 = this.fHead;
        if (span0 === undefined) return true;
        this.fTop = span0;
        this.fHead = undefined;
        let span: CoincidentSpans | undefined = span0;
        do
        {
            if (!span.coinPtTStart().fPt.equals(span.oppPtTStart().fPt))
            {
                if (span.coinPtTStart().fT === 1) return false;
                const onEnd = span.coinPtTStart().fT === 0;
                const oOnEnd = zero_or_one(span.oppPtTStart().fT);
                if (onEnd)
                {
                    if (!oOnEnd)
                    {
                        if (!this.addEndMovedSpansFromPtT(span.oppPtTStart())) return false;
                    }
                }
                else if (oOnEnd)
                {
                    if (!this.addEndMovedSpansFromPtT(span.coinPtTStart())) return false;
                }
            }
            if (!span.coinPtTEnd().fPt.equals(span.oppPtTEnd().fPt))
            {
                const onEnd = span.coinPtTEnd().fT === 1;
                const oOnEnd = zero_or_one(span.oppPtTEnd().fT);
                if (onEnd)
                {
                    if (!oOnEnd)
                    {
                        if (!this.addEndMovedSpansFromPtT(span.oppPtTEnd())) return false;
                    }
                }
                else if (oOnEnd)
                {
                    if (!this.addEndMovedSpansFromPtT(span.coinPtTEnd())) return false;
                }
            }
            span = span.next();
        } while (span !== undefined);
        this.restoreHead();
        return true;
    }

    // SkOpCoincidence.cpp:440. Fills in interior spans so that every
    // coincident run has a continuous t-chain on both segments.
    public addExpanded(): boolean
    {
        let coin = this.fHead;
        if (coin === undefined) return true;
        do
        {
            const startPtT  = coin.coinPtTStart();
            const oStartPtT = coin.oppPtTStart();
            let priorT  = startPtT.fT;
            let oPriorT = oStartPtT.fT;
            if (!startPtT.containsPtT(oStartPtT)) return false;
            const startSpan = startPtT.span();
            const oStartSpan = oStartPtT.span();
            let end  = coin.coinPtTEnd().span();
            let oEnd = coin.oppPtTEnd().span();
            if (oEnd.deleted()) return false;
            const startUp = startSpan.upCastable();
            if (startUp === undefined) return false;
            let test: OpSpanBase = startUp.next();
            if (!coin.flipped() && oStartSpan.upCastable() === undefined) return false;
            let oTest: OpSpanBase | undefined = coin.flipped()
                ? oStartSpan.prev()
                : oStartSpan.upCast().next();
            if (oTest === undefined) return false;
            const seg = startSpan.segment() as OpSegment;
            const oSeg = oStartSpan.segment() as OpSegment;
            while (test !== end || oTest !== oEnd)
            {
                const containedOpp = test.ptT().containsSegment(oSeg);
                const containedThis = oTest.ptT().containsSegment(seg);
                if (containedOpp === undefined || containedThis === undefined)
                {
                    let nextT: number, oNextT: number;
                    if (containedOpp !== undefined)
                    {
                        nextT  = test.t();
                        oNextT = containedOpp.fT;
                    }
                    else if (containedThis !== undefined)
                    {
                        nextT  = containedThis.fT;
                        oNextT = oTest.t();
                    }
                    else
                    {
                        let walk: OpSpanBase = test;
                        let walkOpp: OpPtT | undefined = undefined;
                        do
                        {
                            const wu = walk.upCastable();
                            if (wu === undefined) return false;
                            walk = wu.next();
                        } while ((walkOpp = walk.ptT().containsSegment(oSeg)) === undefined
                                 && walk !== coin.coinPtTEnd().span());
                        if (walkOpp === undefined) return false;
                        nextT  = walk.t();
                        oNextT = walkOpp.fT;
                    }
                    const startRange = nextT - priorT;
                    if (startRange === 0) return false;
                    const startPart = (test.t() - priorT) / startRange;
                    const oStartRange = oNextT - oPriorT;
                    if (oStartRange === 0) return false;
                    const oStartPart = (oTest.t() - oPriorT) / oStartRange;
                    if (startPart === oStartPart) return false;
                    const addToOpp = (containedOpp === undefined && containedThis === undefined)
                        ? startPart < oStartPart : containedThis !== undefined;
                    const startOver = { value: false };
                    const success = addToOpp
                        ? oSeg.addExpanded(oPriorT + oStartRange * startPart, test, startOver)
                        : seg.addExpanded(priorT + startRange * oStartPart, oTest, startOver);
                    if (!success) return false;
                    if (startOver.value)
                    {
                        test = startSpan;
                        oTest = oStartSpan;
                    }
                    end  = coin.coinPtTEnd().span();
                    oEnd = coin.oppPtTEnd().span();
                }
                if (test !== end)
                {
                    const u = test.upCastable();
                    if (u === undefined) return false;
                    priorT = test.t();
                    test = u.next();
                }
                if (oTest !== oEnd)
                {
                    oPriorT = oTest.t();
                    if (coin.flipped())
                    {
                        oTest = oTest.prev();
                    }
                    else
                    {
                        const u = oTest.upCastable();
                        if (u === undefined) return false;
                        oTest = u.next();
                    }
                    if (oTest === undefined) return false;
                }
            }
        } while ((coin = coin.next()!));
        return true;
    }

    // SkOpCoincidence.cpp:1343.
    public mark(): boolean
    {
        let coin = this.fHead;
        if (coin === undefined) return true;
        do
        {
            const startBase = coin.coinPtTStart().span();
            const sUp = startBase.upCastable();
            if (sUp === undefined) return false;
            const start = sUp;
            if (start.deleted()) return false;
            const end   = coin.coinPtTEnd().span();
            let oStart: OpSpanBase = coin.oppPtTStart().span();
            let oEnd:   OpSpanBase = coin.oppPtTEnd().span();
            if (oEnd.deleted()) return false;
            const flipped = coin.flipped();
            if (flipped) { const t = oStart; oStart = oEnd; oEnd = t; }
            const oStartUp = oStart.upCastable();
            if (oStartUp === undefined) return false;
            start.insertCoincidence(oStartUp);
            end.insertCoinEnd(oEnd);
            const segment = start.segment() as OpSegment;
            const oSegment = oStartUp.segment() as OpSegment;
            const orderedOut = { result: false };
            if (!coin.ordered(orderedOut)) return false;
            const ordered = orderedOut.result;
            let next: OpSpanBase = start;
            while ((next = next.upCast().next()) !== end)
            {
                const u = next.upCastable();
                if (u === undefined) return false;
                if (!u.insertCoincidenceBySegment(oSegment, flipped, ordered)) return false;
            }
            let oNext: OpSpanBase = oStart;
            while ((oNext = oNext.upCast().next()) !== oEnd)
            {
                const u = oNext.upCastable();
                if (u === undefined) return false;
                if (!u.insertCoincidenceBySegment(segment, flipped, ordered)) return false;
            }
        } while ((coin = coin.next()!));
        return true;
    }

    // SkOpCoincidence.cpp:1026 — apply winding deltas across all
    // coincident pairs. Iterates the spans in parallel, picking the
    // "source" side (carries the winding) and the "sink" (gets the
    // running totals zero'd).
    public apply(): boolean
    {
        let coin = this.fHead;
        if (coin === undefined) return true;
        do
        {
            const startSpan = coin.coinPtTStart().span();
            const startUp = startSpan.upCastable();
            if (startUp === undefined) return false;
            let start: OpSpan = startUp;
            if (start.deleted()) continue;
            const end = coin.coinPtTEnd().span();
            if (start !== start.starter(end)) return false;
            const flipped = coin.flipped();
            const oStartBase = (flipped ? coin.oppPtTEnd() : coin.oppPtTStart()).span();
            const oStartUp = oStartBase.upCastable();
            if (oStartUp === undefined) return false;
            let oStart: OpSpan = oStartUp;
            if (oStart.deleted()) continue;
            const oEnd = (flipped ? coin.oppPtTStart() : coin.oppPtTEnd()).span();
            const segment = start.segment() as OpSegment;
            const oSegment = oStart.segment() as OpSegment;
            const operandSwap = segment.operand() !== oSegment.operand();
            if (flipped)
            {
                if (oEnd.deleted()) continue;
                for (;;)
                {
                    const oNext = oStart.next();
                    if (oNext === oEnd) break;
                    const u = oNext.upCastable();
                    if (u === undefined) return false;
                    oStart = u;
                }
            }
            for (;;)
            {
                let windValue = start.windValue();
                let oppValue  = start.oppValue();
                let oWindValue = oStart.windValue();
                let oOppValue  = oStart.oppValue();
                let windDiff  = operandSwap ? oOppValue : oWindValue;
                let oWindDiff = operandSwap ? oppValue : windValue;
                if (!flipped) { windDiff = -windDiff; oWindDiff = -oWindDiff; }
                let addToStart = windValue !== 0
                    && (windValue > windDiff
                        || (windValue === windDiff && oWindValue <= oWindDiff));
                if (addToStart ? start.done() : oStart.done()) addToStart = !addToStart;
                if (addToStart)
                {
                    if (operandSwap) { const t = oWindValue; oWindValue = oOppValue; oOppValue = t; }
                    if (flipped)
                    {
                        windValue -= oWindValue;
                        oppValue  -= oOppValue;
                    }
                    else
                    {
                        windValue += oWindValue;
                        oppValue  += oOppValue;
                    }
                    if (segment.isXor()) windValue &= 1;
                    if (segment.oppXor()) oppValue &= 1;
                    oWindValue = oOppValue = 0;
                }
                else
                {
                    if (operandSwap) { const t = windValue; windValue = oppValue; oppValue = t; }
                    if (flipped)
                    {
                        oWindValue -= windValue;
                        oOppValue  -= oppValue;
                    }
                    else
                    {
                        oWindValue += windValue;
                        oOppValue  += oppValue;
                    }
                    if (oSegment.isXor()) oWindValue &= 1;
                    if (oSegment.oppXor()) oOppValue &= 1;
                    windValue = oppValue = 0;
                }
                if (windValue <= -1 || oWindValue <= -1) return false;
                start.setWindValue(windValue);
                start.setOppValue(oppValue);
                oStart.setWindValue(oWindValue);
                oStart.setOppValue(oOppValue);
                if (!windValue && !oppValue) segment.markDone(start);
                if (!oWindValue && !oOppValue) oSegment.markDone(oStart);
                const next  = start.next();
                const oNext = flipped ? oStart.prev() : oStart.next();
                if (next === end) break;
                const u = next.upCastable();
                if (u === undefined) return false;
                start = u;
                let oNextBase: OpSpan | undefined =
                    (oNext === undefined || oNext.upCastable() === undefined)
                        ? oStart : oNext.upCastable();
                if (oNextBase === undefined) oNextBase = oStart;
                oStart = oNextBase;
            }
        } while ((coin = coin.next()!));
        return true;
    }
}

// ── Helpers used by OpSpanBase.checkForCollapsedCoincidence ──────
//
// OpSpanBase resolves the coincidence pointer through globalState; the
// types it sees through the OpCoincidenceLike interface forward only
// the surface it actually needs. Exporting CoincidentSpans + the
// concrete class lets callers (driver, tests) reach the underlying
// structure when needed.
