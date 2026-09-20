// Copyright 2014 Google Inc.
//
// Use of this source code is governed by a BSD-style license that can
// be found in the LICENSE-skia file at the root of this repository.
//
// TypeScript port: 2026 Eugene Napryaglo.
// Source: third_party/skia/src/pathops/SkOpSpan.{h,cpp}
//         (Skia commit pinned in third_party/skia)
//
// Phase 6 foundation — the span tree node types. Three classes:
//
//   OpPtT      — a (t, point) tuple. Holds an intersection result on
//                one curve plus a circular `fNext` pointer joining
//                every other curve that shares this geometric point.
//                Skia's "pt-T loop" is this circular list.
//
//   OpSpanBase — an interval boundary on a segment. Owns one OpPtT
//                inline. Holds:
//                  - a pointer to its parent segment
//                  - prev linkage to the start span (a real OpSpan, not
//                    OpSpanBase — every OpSpanBase except the last one
//                    is an OpSpan)
//                  - the angle this span came from (fFromAngle)
//                  - a fCoinEnd ring linking coincident-segment ends
//                Two flavours: the trailing terminus of a segment
//                (`final() === true`; OpSpanBase directly) or an
//                interior / starting span (`final() === false`;
//                upcastable to OpSpan).
//
//   OpSpan     — extends OpSpanBase. Adds the data each interior /
//                starting span needs to participate in the walking
//                phase: forward link (fNext), the angle to the next
//                span (fToAngle), winding accumulators (fWindSum /
//                fOppSum / fWindValue / fOppValue), and a fCoincident
//                ring of fully-coincident spans on the same segment.
//
// Cross-class methods that walk into the segment (release, merge,
// mergeMatches partial, computeWindSum, sortableTop, insertCoincidence
// segment-overload) need OpSegment / OpCoincidence to be ported first.
// Those throw a clear "Phase 6 not yet ported" error and land in a
// follow-up session.

import { Point } from './point.js';
import { between, zero_or_one } from './types.js';
import { OpGlobalState } from './op-global-state.js';
import type {
    OpAngleLike,
    OpContourLike,
    OpSegmentLike,
} from './op-fwd.js';

// SK_MinS32 — sentinel "unset" value used by Skia for winding
// accumulators. Anything observably-different from a legal small int
// works; matching Skia's exact value keeps the line-by-line port
// faithful.
const SK_MIN_S32 = -0x80000000 | 0;
export { SK_MIN_S32 };

// Result of SkOpSpanBase::collapsed(s, e) — three-state for "yes /
// no / detected an infinite loop walking the pt-T ring".
export enum OpCollapsed
{
    kNo    = 0,
    kYes   = 1,
    kError = 2,
}

// ── OpPtT ─────────────────────────────────────────────────────────

export class OpPtT
{
    // SkOpPtT.h:27 — kIsAlias / kIsDuplicate bit values. Both 1 in
    // Skia (the enum is just there to give names to a single flag).
    public static readonly kIsAlias     = 1;
    public static readonly kIsDuplicate = 1;

    public fT: number = 0;
    public fPt: Point = new Point();
    public fID: number = 0;

    // Public-protected mix from Skia: fSpan / fNext / fDeleted /
    // fDuplicatePt are protected in C++ but accessed everywhere by
    // helpers and methods on neighbouring classes. We expose them
    // directly for line-for-line port; consumers should still prefer
    // the accessors below where they exist.
    public fSpan: OpSpanBase;
    public fNext: OpPtT;
    public fDeleted:      boolean = false;
    public fDuplicatePt:  boolean = false;
    public fCoincident:   boolean = false;

    constructor(span?: OpSpanBase)
    {
        // Self-link by default — every OpPtT is initialised as a
        // single-element ring. addOpp / insert weave more in.
        // `undefined!` placeholder for fSpan, callers MUST init() or
        // pass a span to the constructor before use.
        this.fSpan = span as OpSpanBase;
        this.fNext = this;
    }

    public init(span: OpSpanBase, t: number, pt: Point, dup: boolean): void
    {
        this.fT   = t;
        this.fPt  = pt;
        this.fSpan = span;
        this.fNext = this;
        this.fDuplicatePt = dup;
        this.fDeleted     = false;
        this.fCoincident  = false;
        this.fID = span.globalState().nextPtTID();
    }

    // SkOpSpan.cpp:22 — walk the pt-T ring forwards looking for any
    // non-deleted member that points at the same span as this. If we
    // come back to ourselves, the whole loop is deleted — return
    // undefined (Skia: nullptr).
    public active(): OpPtT | undefined
    {
        if (!this.fDeleted) return this;
        let ptT: OpPtT = this;
        const stopPtT = ptT;
        while ((ptT = ptT.fNext) !== stopPtT)
        {
            if (ptT.fSpan === this.fSpan && !ptT.fDeleted) return ptT;
        }
        return undefined; // every entry deleted — caller must abort
    }

    // SkOpSpan.h:43 — true if some other span has marked this pt-T as
    // a coincident endpoint.
    public coincident(): boolean { return this.fCoincident; }
    public setCoincident(): void
    {
        if (this.fDeleted) throw new Error('OpPtT.setCoincident: already deleted');
        this.fCoincident = true;
    }

    public deleted(): boolean { return this.fDeleted; }
    public duplicate(): boolean { return this.fDuplicatePt; }

    public setDeleted(): void
    {
        if (this.fDeleted) throw new Error('OpPtT.setDeleted: already deleted');
        this.fDeleted = true;
    }

    public next(): OpPtT { return this.fNext; }
    public span(): OpSpanBase { return this.fSpan; }
    public setSpan(span: OpSpanBase): void { this.fSpan = span; }

    public segment(): OpSegmentLike { return this.fSpan.segment(); }
    public contour(): OpContourLike { return this.segment().contour()!; }
    public globalState(): OpGlobalState { return this.contour().globalState(); }

    // SkOpSpan.cpp:36 — walk the ring, return true if `check` is in it.
    public containsPtT(check: OpPtT): boolean
    {
        if (this === check) throw new Error('OpPtT.contains: identity check');
        let ptT: OpPtT = this;
        const stopPtT = ptT;
        while ((ptT = ptT.fNext) !== stopPtT)
        {
            if (ptT === check) return true;
        }
        return false;
    }

    public containsSegmentPt(segment: OpSegmentLike, pt: Point): boolean
    {
        if (this.segment() === segment)
            throw new Error('OpPtT.containsSegmentPt: same segment');
        let ptT: OpPtT = this;
        const stopPtT = ptT;
        while ((ptT = ptT.fNext) !== stopPtT)
        {
            if (ptT.fPt.equals(pt) && ptT.segment() === segment) return true;
        }
        return false;
    }

    public containsSegmentT(segment: OpSegmentLike, t: number): boolean
    {
        let ptT: OpPtT = this;
        const stopPtT = ptT;
        while ((ptT = ptT.fNext) !== stopPtT)
        {
            if (ptT.fT === t && ptT.segment() === segment) return true;
        }
        return false;
    }

    // SkOpSpan.cpp:71 — find an undeleted pt-T pointing at `check`.
    public containsSegment(check: OpSegmentLike): OpPtT | undefined
    {
        if (this.segment() === check)
            throw new Error('OpPtT.containsSegment: same segment');
        let ptT: OpPtT = this;
        const stopPtT = ptT;
        while ((ptT = ptT.fNext) !== stopPtT)
        {
            if (ptT.segment() === check && !ptT.deleted()) return ptT;
        }
        return undefined;
    }

    // SkOpSpan.cpp:87 — find variant that walks INCLUDING self.
    public find(segment: OpSegmentLike): OpPtT | undefined
    {
        let ptT: OpPtT = this;
        const stopPtT = ptT;
        do
        {
            if (ptT.segment() === segment && !ptT.deleted()) return ptT;
            ptT = ptT.fNext;
        } while (stopPtT !== ptT);
        return undefined;
    }

    // SkOpSpan.cpp:115 — true if this pt-T sits on the segment's head
    // or tail and is the canonical ptT of its span.
    public onEnd(): boolean
    {
        const span = this.span();
        if (span.ptT() !== this) return false;
        const segment = this.segment();
        return span === segment.head() || span === segment.tail();
    }

    // SkOpSpan.cpp:124 — duplicate-point test: does any element from
    // here to `check` share the same physical point?
    public ptAlreadySeen(check: OpPtT): boolean
    {
        // Skia uses a `this` pointer the loop never moves; we mirror.
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        while (self !== check)
        {
            if (self.fPt.equals(check.fPt)) return true;
            check = check.fNext;
        }
        return false;
    }

    // SkOpSpan.cpp:134 — walk the ring to find the node whose fNext
    // points at this. Linear in the ring length.
    public prev(): OpPtT
    {
        let result: OpPtT = this;
        let next:   OpPtT = this;
        while ((next = next.fNext) !== this)
        {
            result = next;
        }
        return result;
    }

    // SkOpSpan.h:34 — insert `opp` between this and oldNext;
    // simultaneously update oppPrev's fNext to follow what was this's
    // fNext.
    public addOpp(opp: OpPtT, oppPrev: OpPtT): void
    {
        const oldNext = this.fNext;
        if (this === opp) throw new Error('OpPtT.addOpp: self-add');
        this.fNext = opp;
        if (oppPrev === oldNext) throw new Error('OpPtT.addOpp: oppPrev would orphan ring');
        oppPrev.fNext = oldNext;
    }

    // SkOpSpan.h:87 — single-step insert (no rejoin walk).
    public insert(span: OpPtT): void
    {
        if (span === this) throw new Error('OpPtT.insert: self-insert');
        span.fNext = this.fNext;
        this.fNext = span;
    }

    // SkOpSpan.h:104 — find the entry in opp's ring whose fNext
    // points at opp. Returns undefined if we encounter `this` first
    // (meaning we're already in opp's ring).
    public oppPrev(opp: OpPtT): OpPtT | undefined
    {
        let prev: OpPtT = opp.fNext;
        if (prev === this) return undefined;
        while (prev.fNext !== opp)
        {
            prev = prev.fNext;
            if (prev === this) return undefined;
        }
        return prev;
    }

    // SkOpSpan.h:162 — return whichever endpoint has the smaller fT.
    public starter(end: OpPtT): OpPtT
    {
        return this.fT < end.fT ? this : end;
    }

    // SkOpSpan.h:119 — interval overlap helper. Returns true and
    // writes (sOut, eOut) to the overlap of [s1,e1] and [s2,e2] (in
    // t-space, in pt-T order), or false when they don't overlap.
    public static Overlaps(s1: OpPtT, e1: OpPtT, s2: OpPtT, e2: OpPtT):
        { sOut: OpPtT | undefined; eOut: OpPtT | undefined; overlaps: boolean }
    {
        const start1 = s1.fT < e1.fT ? s1 : e1;
        const start2 = s2.fT < e2.fT ? s2 : e2;
        const sOut = between(s1.fT, start2.fT, e1.fT) ? start2
                  : between(s2.fT, start1.fT, e2.fT) ? start1
                  : undefined;
        const end1 = s1.fT < e1.fT ? e1 : s1;
        const end2 = s2.fT < e2.fT ? e2 : s2;
        const eOut = between(s1.fT, end2.fT, e1.fT) ? end2
                  : between(s2.fT, end1.fT, e2.fT) ? end1
                  : undefined;
        if (sOut === eOut)
        {
            // Skia asserts the disjointness condition; we leave the
            // assertion silent (the caller's overlap === false path
            // already covers it) but mirror the boolean returns.
            return { sOut: undefined, eOut: undefined, overlaps: false };
        }
        const overlaps = sOut !== undefined && eOut !== undefined;
        return { sOut, eOut, overlaps };
    }
}

// ── OpSpanBase ────────────────────────────────────────────────────

export class OpSpanBase
{
    // Inlined OpPtT — the canonical pt-T of this span. Other pt-Ts
    // join it through the fNext ring.
    public fPtT: OpPtT;

    public fSegment: OpSegmentLike;
    public fCoinEnd: OpSpanBase;
    public fFromAngle: OpAngleLike | undefined = undefined;
    public fPrev: OpSpan | undefined = undefined;
    public fSpanAdds: number = 0;
    public fAligned: boolean = true;
    public fChased: boolean = false;
    public fID: number = 0;
    public fCount: number = 0;
    public fDebugDeleted: boolean = false;

    constructor()
    {
        this.fPtT = new OpPtT();
        // Self-link fCoinEnd for empty initial state. Real init() sets
        // fSegment + the OpPtT body via initBase().
        this.fSegment = undefined as unknown as OpSegmentLike;
        this.fCoinEnd = this;
        // Wire fPtT back to this span so any caller invoking ptT().span()
        // before init() still sees a valid (if empty) span pointer.
        this.fPtT.fSpan = this;
    }

    // SkOpSpan.cpp:243 — set up parent + initialise the inline pt-T.
    public initBase(segment: OpSegmentLike, prev: OpSpan | undefined,
                    t: number, pt: Point): void
    {
        this.fSegment = segment;
        this.fPtT.init(this, t, pt, false);
        this.fCoinEnd = this;
        this.fFromAngle = undefined;
        this.fPrev = prev;
        this.fSpanAdds = 0;
        this.fAligned = true;
        this.fChased = false;
        this.fCount = 1;
        this.fID = this.globalState().nextSpanID();
        this.fDebugDeleted = false;
    }

    public segment(): OpSegmentLike { return this.fSegment; }
    public contour(): OpContourLike { return this.fSegment.contour()!; }
    public globalState(): OpGlobalState { return this.contour().globalState(); }

    public ptT(): OpPtT { return this.fPtT; }
    public pt():  Point { return this.fPtT.fPt; }
    public t():   number { return this.fPtT.fT; }

    public final(): boolean { return this.fPtT.fT === 1; }

    public coinEnd(): OpSpanBase { return this.fCoinEnd; }

    public deleted(): boolean { return this.fPtT.deleted(); }

    public fromAngle(): OpAngleLike | undefined { return this.fFromAngle; }
    public setFromAngle(angle: OpAngleLike | undefined): void { this.fFromAngle = angle; }

    public prev(): OpSpan | undefined { return this.fPrev; }
    public setPrev(prev: OpSpan): void { this.fPrev = prev; }

    public chased():           boolean { return this.fChased; }
    public setChased(c: boolean): void { this.fChased = c; }

    public setAligned(): void { this.fAligned = true; }
    public unaligned():  void { this.fAligned = false; }
    public aligned(): boolean { return this.fAligned; }

    public spanAddsCount(): number { return this.fSpanAdds; }
    public bumpSpanAdds():  void   { ++this.fSpanAdds; }

    public bumpCount(): number { return ++this.fCount; }

    // SkOpSpan.cpp:158 — link this span and `opp` into each other's
    // pt-T rings. Returns true on success; false if mergeMatches fails
    // (a sign of a corrupted topology that the caller must bail on).
    public addOpp(opp: OpSpanBase): boolean
    {
        const oppPrev = this.ptT().oppPrev(opp.ptT());
        if (oppPrev === undefined) return true;
        if (!this.mergeMatches(opp)) return false;
        this.ptT().addOpp(opp.ptT(), oppPrev);
        this.checkForCollapsedCoincidence();
        return true;
    }

    // SkOpSpan.cpp:169 — has this span's pt-T ring covered both s and
    // e within the t-range of segment-local entries? Returns kError
    // when the ring walks past its safety budget (a corrupted loop).
    public collapsed(s: number, e: number): OpCollapsed
    {
        const start = this.fPtT;
        let startNext: OpPtT | undefined = undefined;
        let walk: OpPtT = start;
        let min = walk.fT;
        let max = min;
        const segment = this.segment();
        let safetyNet = 100000;
        while ((walk = walk.next()) !== start)
        {
            if (!--safetyNet) return OpCollapsed.kError;
            if (walk === startNext) return OpCollapsed.kError;
            if (walk.segment() !== segment) continue;
            min = Math.min(min, walk.fT);
            max = Math.max(max, walk.fT);
            if (between(min, s, max) && between(min, e, max)) return OpCollapsed.kYes;
            startNext = start.next();
        }
        return OpCollapsed.kNo;
    }

    // SkOpSpan.cpp:197 — true if the pt-T ring of this includes the
    // canonical pt-T of `span`.
    public containsSpan(span: OpSpanBase): boolean
    {
        const start = this.fPtT;
        const check = span.fPtT;
        if (start === check) throw new Error('OpSpanBase.containsSpan: identity check');
        let walk: OpPtT = start;
        while ((walk = walk.next()) !== start)
        {
            if (walk === check) return true;
        }
        return false;
    }

    // SkOpSpan.cpp:210 — find an undeleted pt-T in the ring that
    // points at `segment` AND is the canonical pt-T of its span.
    public containsSegment(segment: OpSegmentLike): OpPtT | undefined
    {
        const start = this.fPtT;
        let walk: OpPtT = start;
        while ((walk = walk.next()) !== start)
        {
            if (walk.deleted()) continue;
            if (walk.segment() === segment && walk.span().ptT() === walk)
            {
                return walk;
            }
        }
        return undefined;
    }

    // SkOpSpan.h:206 — walk the fCoinEnd ring looking for `coin`.
    public containsCoinEndSpan(coin: OpSpanBase): boolean
    {
        if (this === coin) throw new Error('OpSpanBase.containsCoinEnd: identity check');
        let next: OpSpanBase = this;
        while ((next = next.fCoinEnd) !== this)
        {
            if (next === coin) return true;
        }
        return false;
    }

    // SkOpSpan.cpp:224 — fCoinEnd-ring walk by segment.
    public containsCoinEndSegment(segment: OpSegmentLike): boolean
    {
        if (this.segment() === segment)
            throw new Error('OpSpanBase.containsCoinEndSegment: same segment');
        let next: OpSpanBase = this;
        while ((next = next.fCoinEnd) !== this)
        {
            if (next.segment() === segment) return true;
        }
        return false;
    }

    // SkOpSpan.h:282 — splice `coin` and this together if not
    // already linked.
    public insertCoinEnd(coin: OpSpanBase): void
    {
        if (this.containsCoinEndSpan(coin))
        {
            if (!coin.containsCoinEndSpan(this))
                throw new Error('OpSpanBase.insertCoinEnd: asymmetric coin ring');
            return;
        }
        if (this === coin) throw new Error('OpSpanBase.insertCoinEnd: self-insert');
        const coinNext = coin.fCoinEnd;
        coin.fCoinEnd = this.fCoinEnd;
        this.fCoinEnd = coinNext;
    }

    // SkOpSpan.cpp:288 — fan markCollapsed across every coincident
    // pt-T in this span's ring, then drop deleted entries.
    public checkForCollapsedCoincidence(): void
    {
        const coins = this.globalState().coincidence() as
            { isEmpty(): boolean; markCollapsed(test: OpPtT): void; releaseDeleted(): void } | undefined;
        if (coins === undefined) return;
        if (coins.isEmpty()) return;
        const head = this.fPtT;
        let test: OpPtT = head;
        do
        {
            if (test.coincident()) coins.markCollapsed(test);
            test = test.next();
        } while (test !== head);
        coins.releaseDeleted();
    }

    // SkOpSpan.cpp:259. Merge two spans on the same segment by
    // releasing `span`, splicing its pt-T ring into this one, and
    // de-duplicating against entries that already point at the same
    // (span, t) pair.
    public merge(span: OpSpan): void
    {
        const spanPtT = span.ptT();
        if (this.t() === spanPtT.fT) throw new Error('OpSpanBase.merge: same t');
        if (zero_or_one(spanPtT.fT)) throw new Error('OpSpanBase.merge: cannot merge an endpoint span');
        span.release(this.ptT());
        if (this.containsSpan(span)) return;   // already in the loop
        const remainderHead = spanPtT.next();
        this.ptT().insert(spanPtT);
        let remainder = remainderHead;
        while (remainder !== spanPtT)
        {
            const next = remainder.next();
            // Check if some existing entry already pairs (span, t)
            let compare = spanPtT.next();
            let dup = false;
            while (compare !== spanPtT)
            {
                const nextC = compare.next();
                if (nextC.span() === remainder.span() && nextC.fT === remainder.fT)
                {
                    dup = true;
                    break;
                }
                compare = nextC;
            }
            if (!dup) spanPtT.insert(remainder);
            remainder = next;
        }
        this.fSpanAdds += span.fSpanAdds;
    }

    // SkOpSpan.cpp:313. Walk every pt-T on this span; for each one
    // pointing at a segment that also appears on `opp`, merge the
    // duplicates and either release the inner span or mark the
    // segment collapsed.
    public mergeMatches(opp: OpSpanBase): boolean
    {
        let test: OpPtT = this.fPtT;
        const stop = test;
        let safetyHatch = 1_000_000;
        do
        {
            if (!--safetyHatch) return false;
            const testNext = test.next();
            if (!test.deleted())
            {
                const testBase = test.span();
                if (testBase.ptT() !== test) throw new Error('OpSpanBase.mergeMatches: ptT mismatch');
                const segment = test.segment();
                if (!segment.done())
                {
                    let inner: OpPtT = opp.ptT();
                    const innerStop = inner;
                    do
                    {
                        if (inner.segment() === segment && !inner.deleted())
                        {
                            const innerBase = inner.span();
                            if (innerBase.ptT() !== inner)
                                throw new Error('OpSpanBase.mergeMatches: inner ptT mismatch');
                            if (!zero_or_one(inner.fT))
                            {
                                innerBase.upCast().release(test);
                            }
                            else if (!zero_or_one(test.fT))
                            {
                                testBase.upCast().release(inner);
                            }
                            else
                            {
                                // Both endpoints — collapse the segment.
                                segment.markAllDone();
                                test.setDeleted();
                                inner.setDeleted();
                            }
                            break;
                        }
                        inner = inner.next();
                    } while (inner !== innerStop);
                }
            }
            test = testNext;
        } while (test !== stop);
        this.checkForCollapsedCoincidence();
        return true;
    }

    // SkOpSpan.h:338 — true when this pt-T ring has exactly two
    // elements (self → next → self).
    public simple(): boolean
    {
        return this.fPtT.next().next() === this.fPtT;
    }

    public starter(end: OpSpanBase): OpSpan
    {
        const result = this.t() < end.t() ? this : end;
        return result.upCast();
    }

    // Mutates *endPtr in place when `this` < end. The pointer-update
    // semantics matter to the caller's flow; we return both the
    // starter span and the (possibly swapped) end span.
    public starterSwap(end: OpSpanBase): { starter: OpSpan; end: OpSpanBase }
    {
        if (this.segment() !== end.segment())
            throw new Error('OpSpanBase.starter: cross-segment');
        if (this.t() < end.t()) return { starter: this.upCast(), end };
        return { starter: end.upCast(), end: this };
    }

    public step(end: OpSpanBase): number
    {
        return this.t() < end.t() ? 1 : -1;
    }

    public upCast(): OpSpan
    {
        if (this.final()) throw new Error('OpSpanBase.upCast: span is final');
        return this as unknown as OpSpan;
    }

    public upCastable(): OpSpan | undefined
    {
        return this.final() ? undefined : this.upCast();
    }
}

// ── OpSpan ────────────────────────────────────────────────────────

export class OpSpan extends OpSpanBase
{
    public fCoincident: OpSpan;
    public fToAngle: OpAngleLike | undefined = undefined;
    public fNext: OpSpanBase | undefined = undefined;
    public fWindSum:   number = SK_MIN_S32;
    public fOppSum:    number = SK_MIN_S32;
    public fWindValue: number = 0;
    public fOppValue:  number = 0;
    public fTopTTry:   number = 0;
    public fDone:      boolean = false;
    public fAlreadyAdded: boolean = false;

    constructor()
    {
        super();
        this.fCoincident = this;
    }

    // SkOpSpan.cpp:398 — initialise a starting or interior span.
    // Asserts t !== 1 (terminating span uses bare OpSpanBase).
    public init(segment: OpSegmentLike, prev: OpSpan | undefined,
                t: number, pt: Point): void
    {
        if (t === 1) throw new Error('OpSpan.init: terminating span must use OpSpanBase');
        this.initBase(segment, prev, t, pt);
        this.fCoincident = this;
        this.fToAngle = undefined;
        this.fWindSum = SK_MIN_S32;
        this.fOppSum = SK_MIN_S32;
        this.fWindValue = 1;
        this.fOppValue = 0;
        this.fTopTTry = 0;
        this.fChased = false;
        this.fDone = false;
        // Skia: segment->bumpCount() — record that this segment now
        // owns one more span. Without this, OpSegment.done() always
        // returns true vacuously (fDoneCount === fCount === 0) and
        // FindSortableTop skips every segment, so the boolean-op
        // walker never finds an anchor and bridgeWinding produces an
        // empty output path.
        (segment as unknown as { bumpCount(): void }).bumpCount();
        this.fAlreadyAdded = false;
    }

    public alreadyAdded(): boolean { return this.fAlreadyAdded; }
    public markAdded():    void    { this.fAlreadyAdded = true; }

    public done():           boolean { return this.fDone; }
    public setDone(d: boolean): void  { this.fDone = d; }

    public next(): OpSpanBase
    {
        if (this.fNext === undefined) throw new Error('OpSpan.next: fNext unset');
        return this.fNext;
    }
    public setNext(next: OpSpanBase): void { this.fNext = next; }

    public toAngle(): OpAngleLike | undefined { return this.fToAngle; }
    public setToAngle(angle: OpAngleLike | undefined): void { this.fToAngle = angle; }

    public windValue(): number { return this.fWindValue; }
    public setWindValue(value: number): void
    {
        if (value < 0) throw new Error('OpSpan.setWindValue: negative');
        if (this.fWindSum !== SK_MIN_S32)
            throw new Error('OpSpan.setWindValue: windSum already set');
        if (value !== 0 && this.fDone)
            throw new Error('OpSpan.setWindValue: nonzero on done span');
        this.fWindValue = value;
    }

    public oppValue(): number { return this.fOppValue; }
    public setOppValue(value: number): void
    {
        if (this.fOppSum !== SK_MIN_S32)
            throw new Error('OpSpan.setOppValue: oppSum already set');
        if (value !== 0 && this.fDone)
            throw new Error('OpSpan.setOppValue: nonzero on done span');
        this.fOppValue = value;
    }

    public windSum(): number { return this.fWindSum; }
    public setWindSum(value: number): void
    {
        // SkOpSpan.cpp:482 — disagreement marks the winding step as
        // failed but does NOT clobber the existing sum. Mirror the
        // soft-fail behaviour.
        if (this.fWindSum !== SK_MIN_S32 && this.fWindSum !== value)
        {
            this.globalState().setWindingFailed();
            return;
        }
        this.fWindSum = value;
    }

    public oppSum(): number { return this.fOppSum; }
    public setOppSum(value: number): void
    {
        if (this.fOppSum !== SK_MIN_S32 && this.fOppSum !== value)
        {
            this.globalState().setWindingFailed();
            return;
        }
        this.fOppSum = value;
    }

    public isCanceled():   boolean { return this.fWindValue === 0 && this.fOppValue === 0; }
    public isCoincident(): boolean { return this.fCoincident !== this; }

    // SkOpSpan.h:427 — disconnect from the coincident ring.
    public clearCoincident(): boolean
    {
        if (this.fCoincident === this) return false;
        this.fCoincident = this;
        return true;
    }

    // SkOpSpan.h:439 — walk the fCoincident ring; true if `coin` is
    // in it.
    public containsCoincidenceSpan(coin: OpSpan): boolean
    {
        if (this === coin) throw new Error('OpSpan.containsCoincidence: identity check');
        let next: OpSpan = this;
        while ((next = next.fCoincident) !== this)
        {
            if (next === coin) return true;
        }
        return false;
    }

    // SkOpSpan.cpp:387 — fCoincident-ring walk by segment.
    public containsCoincidenceSegment(segment: OpSegmentLike): boolean
    {
        if (this.segment() === segment)
            throw new Error('OpSpan.containsCoincidenceSegment: same segment');
        let next: OpSpan = this.fCoincident;
        do
        {
            if (next.segment() === segment) return true;
        } while ((next = next.fCoincident) !== this);
        return false;
    }

    // SkOpSpan.h:468 — splice the two coincident-rings together.
    public insertCoincidence(coin: OpSpan): void
    {
        if (this.containsCoincidenceSpan(coin))
        {
            if (!coin.containsCoincidenceSpan(this))
                throw new Error('OpSpan.insertCoincidence: asymmetric ring');
            return;
        }
        if (this === coin) throw new Error('OpSpan.insertCoincidence: self-insert');
        const coinNext = coin.fCoincident;
        coin.fCoincident = this.fCoincident;
        this.fCoincident = coinNext;
    }

    // SkOpSpan.cpp:413. Walk the pt-T ring; for each pt-T pointing at
    // `segment`, pick the canonical other-span and link this with it.
    public insertCoincidenceBySegment(segment: OpSegmentLike, flipped: boolean, ordered: boolean): boolean
    {
        if (this.containsCoincidenceSegment(segment)) return true;
        let next: OpPtT = this.fPtT;
        while ((next = next.next()) !== this.fPtT)
        {
            if (next.segment() === segment)
            {
                const base = next.span();
                let span: OpSpan | undefined;
                if (!ordered)
                {
                    const spanEndPtT = this.fNext!.containsSegment(segment);
                    if (spanEndPtT === undefined) return false;
                    const spanEnd = spanEndPtT.span();
                    const start = base.ptT().starter(spanEnd.ptT());
                    span = start.span().upCastable();
                    if (span === undefined) return false;
                }
                else if (flipped)
                {
                    span = base.prev();
                    if (span === undefined) return false;
                }
                else
                {
                    span = base.upCastable();
                    if (span === undefined) return false;
                }
                this.insertCoincidence(span);
                return true;
            }
        }
        return true;
    }

    // SkOpSpan.cpp:446. Unlink this span from the doubly-linked span
    // chain on its segment, ask OpCoincidence to swap its pt-T pointer
    // (deleted → kept), then mark every pt-T pointing back here as
    // pointing at kept's span instead.
    public release(kept: OpPtT): void
    {
        this.fDebugDeleted = true;
        if (kept.span() === this) throw new Error('OpSpan.release: kept points at this');
        if (this.final()) throw new Error('OpSpan.release: cannot release tail');
        const prev = this.prev();
        if (prev === undefined) throw new Error('OpSpan.release: no prev');
        const next = this.next();
        prev.setNext(next);
        next.setPrev(prev);
        this.segment().release(this);
        const coins = this.globalState().coincidence() as
            { fixUp(deleted: OpPtT, kept: OpPtT): void } | undefined;
        if (coins !== undefined) coins.fixUp(this.ptT(), kept);
        this.ptT().setDeleted();
        const stopPtT = this.ptT();
        let testPtT: OpPtT = stopPtT;
        const keptSpan = kept.span();
        do
        {
            if (testPtT.span() === this) testPtT.setSpan(keptSpan);
            testPtT = testPtT.next();
        } while (testPtT !== stopPtT);
    }

    // SkOpSpan.cpp:378 — Phase 6 follow-up: depends on
    // SortableTop, which routes through OpContour traversal.
    public computeWindSum(): number
    {
        throw new Error('OpSpan.computeWindSum: Phase 6 follow-up — needs OpContour traversal');
    }

    // SkOpSpan.h:548 — Phase 6 follow-up.
    public sortableTop(_contourHead: unknown): boolean
    {
        throw new Error('OpSpan.sortableTop: Phase 6 follow-up — needs OpContour traversal');
    }

    // SkOpSpan.h:512 — Phase 6 follow-up: needs OpSegment surface.
    public setCoinStart(_oldCoinStart: OpSpan, _oppSegment: OpSegmentLike): OpPtT
    {
        throw new Error('OpSpan.setCoinStart: Phase 6 follow-up — needs OpSegment surface');
    }
}

