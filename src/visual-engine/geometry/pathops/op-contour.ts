// Copyright 2013 Google Inc.
//
// Use of this source code is governed by a BSD-style license that can
// be found in the LICENSE-skia file at the root of this repository.
//
// TypeScript port: 2026 Eugene Napryaglo.
// Source: third_party/skia/src/pathops/SkOpContour.{h,cpp}
//         (Skia commit pinned in third_party/skia)
//
// Phase 6 chunk 2 — contour aggregator. A contour is one closed loop
// of segments, optionally tagged "operand" (second operand of a path
// op), "reversed" (output direction flipped), "xor" (even-odd fill),
// or "oppXor" (the other operand uses even-odd fill).
//
// Each contour owns a head OpSegment inline and links additional
// segments forward through OpSegment.fNext. The first segment owns
// the head pointer; new segments arrive via appendSegment(). Bounds
// aggregate from all segments via setBounds().
//
// OpContourHead is the contour-list root used by the path-ops driver
// to walk every contour in an operand. It inherits OpContour but
// overrides nothing structural — it just provides a single appendContour
// + remove + joinAllSegments helper trio for the driver.

import { Point } from './point.js';
import { Rect } from './rect.js';
import { OpSegment } from './op-segment.js';
import { OpGlobalState } from './op-global-state.js';
import {
    OpVerb,
    type OpContourHeadLike,
    type OpContourLike,
} from './op-fwd.js';

export class OpContour implements OpContourLike
{
    public fState:    OpGlobalState | undefined = undefined;
    public fHead:     OpSegment;
    public fTail:     OpSegment | undefined = undefined;
    public fNext:     OpContour | undefined = undefined;
    public fBounds:   Rect = new Rect();
    public fCcw:      number = -1;
    public fCount:    number = 0;
    public fFirstSorted: number = -1;
    public fDone:     boolean = false;
    public fOperand:  boolean = false;
    public fReverse:  boolean = false;
    public fXor:      boolean = false;
    public fOppXor:   boolean = false;
    public fID:       number = 0;

    constructor()
    {
        this.fHead = new OpSegment();
        this.reset();
    }

    // SkOpContour.h:288 — wipe the structural fields without freeing
    // the inline head. Skia's reset doesn't clear fHead because the
    // contour will be re-init() ed before reuse.
    public reset(): void
    {
        this.fTail = undefined;
        this.fNext = undefined;
        this.fCount = 0;
        this.fDone = false;
        this.fBounds.fLeft   = Number.MAX_VALUE;
        this.fBounds.fTop    = Number.MAX_VALUE;
        this.fBounds.fRight  = -Number.MAX_VALUE;
        this.fBounds.fBottom = -Number.MAX_VALUE;
        this.fFirstSorted = -1;
    }

    public init(state: OpGlobalState, operand: boolean, isXor: boolean): void
    {
        this.fState = state;
        this.fOperand = operand;
        this.fXor = isXor;
        this.fID = state.nextContourID();
    }

    public globalState(): OpGlobalState
    {
        if (this.fState === undefined) throw new Error('OpContour: globalState before init');
        return this.fState;
    }

    public bounds(): Rect { return this.fBounds; }
    public count():  number { return this.fCount; }
    public done():   boolean { return this.fDone; }
    public isCcw():  number { return this.fCcw; }
    public isXor():  boolean { return this.fXor; }
    public operand(): boolean { return this.fOperand; }
    public oppXor():  boolean { return this.fOppXor; }
    public reversed(): boolean { return this.fReverse; }
    public next(): OpContour | undefined { return this.fNext; }

    public setCcw(ccw: number): void { this.fCcw = ccw; }
    public setNext(c: OpContour | undefined): void { this.fNext = c; }
    public setOperand(o: boolean): void { this.fOperand = o; }
    public setOppXor(o: boolean):  void { this.fOppXor = o; }
    public setReverse(): void { this.fReverse = true; }
    public setXor(o: boolean): void { this.fXor = o; }
    public setGlobalState(state: OpGlobalState): void { this.fState = state; }

    public first(): OpSegment
    {
        if (this.fCount === 0) throw new Error('OpContour.first: empty contour');
        return this.fHead;
    }

    public start(): Point { return this.fHead.pts()[0]!; }
    public end():   Point
    {
        if (this.fTail === undefined) throw new Error('OpContour.end: empty contour');
        const tailPts = this.fTail.pts();
        // SkOpContour.h:180 — end pt index = SkPathOpsVerbToPoints(tail.verb).
        return tailPts[tailPts.length - 1]!;
    }

    // SkOpContour.h:57 — append a new segment. The first segment uses
    // the inlined head; subsequent ones get `new` allocations. Skia
    // uses its arena; we use GC.
    public appendSegment(): OpSegment
    {
        let result: OpSegment;
        if (this.fCount++ === 0)
        {
            result = this.fHead;
        }
        else
        {
            result = new OpSegment();
        }
        result.setPrev(this.fTail);
        if (this.fTail !== undefined)
        {
            this.fTail.setNext(result);
        }
        this.fTail = result;
        return result;
    }

    public addLine(pts: Point[]): OpSegment
    {
        if (pts[0]!.equals(pts[1]!))
            throw new Error('OpContour.addLine: degenerate (p0 === p1)');
        return this.appendSegment().addLine(pts, this);
    }

    public addQuad(pts: Point[]): OpSegment
    {
        return this.appendSegment().addQuad(pts, this);
    }

    public addCubic(pts: Point[]): OpSegment
    {
        return this.appendSegment().addCubic(pts, this);
    }

    // SkOpContour.h:313.
    public setBounds(): void
    {
        if (this.fCount === 0) throw new Error('OpContour.setBounds: empty contour');
        let segment: OpSegment | undefined = this.fHead;
        const first = segment.bounds();
        this.fBounds.fLeft   = first.fLeft;
        this.fBounds.fTop    = first.fTop;
        this.fBounds.fRight  = first.fRight;
        this.fBounds.fBottom = first.fBottom;
        segment = segment.next();
        while (segment !== undefined)
        {
            const b = segment.bounds();
            if (b.fLeft   < this.fBounds.fLeft)   this.fBounds.fLeft   = b.fLeft;
            if (b.fTop    < this.fBounds.fTop)    this.fBounds.fTop    = b.fTop;
            if (b.fRight  > this.fBounds.fRight)  this.fBounds.fRight  = b.fRight;
            if (b.fBottom > this.fBounds.fBottom) this.fBounds.fBottom = b.fBottom;
            segment = segment.next();
        }
    }

    public complete(): void { this.setBounds(); }

    // SkOpContour.h:72.
    public calcAngles(): void
    {
        if (this.fCount === 0) throw new Error('OpContour.calcAngles: empty');
        let segment: OpSegment | undefined = this.fHead;
        do
        {
            segment.calcAngles();
            segment = segment.next();
        } while (segment !== undefined);
    }

    // SkOpContour.h:214 — chain tail-of-each-segment to head-of-next.
    public joinSegments(): void
    {
        let segment: OpSegment | undefined = this.fHead;
        let next:    OpSegment | undefined;
        do
        {
            next = segment!.next();
            segment!.joinEnds(next !== undefined ? next : this.fHead);
            segment = next;
        } while (segment !== undefined);
    }

    // SkOpContour.h:223.
    public markAllDone(): void
    {
        let segment: OpSegment | undefined = this.fHead;
        do
        {
            segment.markAllDone();
            segment = segment.next();
        } while (segment !== undefined);
    }

    public resetReverse(): void
    {
        let next: OpContour | undefined = this;
        do
        {
            if (next.count() === 0)
            {
                next = next.next();
                continue;
            }
            next.fCcw = -1;
            next.fReverse = false;
            next = next.next();
        } while (next !== undefined);
    }

    // ── Phase 6 follow-up stubs ──────────────────────────────────

    // SkOpContour.h:231.
    public missingCoincidence(): boolean
    {
        if (this.fCount === 0) throw new Error('OpContour.missingCoincidence: empty');
        let segment: OpSegment | undefined = this.fHead;
        let result = false;
        do
        {
            if (segment.missingCoincidence()) result = true;
            segment = segment.next();
        } while (segment !== undefined);
        return result;
    }

    public moveMultiples(): boolean
    {
        if (this.fCount === 0) throw new Error('OpContour.moveMultiples: empty');
        let segment: OpSegment | undefined = this.fHead;
        do
        {
            if (!segment.moveMultiples()) return false;
            segment = segment.next();
        } while (segment !== undefined);
        return true;
    }

    public moveNearby(): boolean
    {
        if (this.fCount === 0) throw new Error('OpContour.moveNearby: empty');
        let segment: OpSegment | undefined = this.fHead;
        do
        {
            if (!segment.moveNearby()) return false;
            segment = segment.next();
        } while (segment !== undefined);
        return true;
    }

    public sortAngles(): boolean
    {
        if (this.fCount === 0) throw new Error('OpContour.sortAngles: empty');
        let segment: OpSegment | undefined = this.fHead;
        while (segment !== undefined)
        {
            if (!segment.sortAngles()) return false;
            segment = segment.next();
        }
        return true;
    }

    public toPath(): void
    {
        throw new Error('OpContour.toPath: Phase 6 follow-up — needs OpPathWriter');
    }

    public toReversePath(): void
    {
        throw new Error('OpContour.toReversePath: Phase 6 follow-up — needs OpPathWriter');
    }

    // SkOpContour.cpp:34. Fan over segments looking for the first
    // span whose winding sum hasn't been computed yet. Used by
    // FindUndone to seed the walker after the resolver settles.
    public undoneSpan(): import('./op-span.js').OpSpan | undefined
    {
        let segment: OpSegment | undefined = this.fHead;
        while (segment !== undefined)
        {
            if (!segment.done())
            {
                const r = segment.undoneSpan();
                if (r !== undefined) return r;
            }
            segment = segment.next();
        }
        this.fDone = true;
        return undefined;
    }

    // rayCheck + findSortableTop are injected via op-winding.ts.
}

// SkOpContour.h:400 — the contour list root. The driver allocates one
// OpContourHead per path argument and appends OpContours into it via
// appendContour().
export class OpContourHead extends OpContour implements OpContourHeadLike
{
    // SkOpContour.h:402.
    public appendContour(): OpContour
    {
        const contour = new OpContour();
        contour.setNext(undefined);
        let prev: OpContour = this;
        let next: OpContour | undefined;
        while ((next = prev.next()) !== undefined)
        {
            prev = next;
        }
        prev.setNext(contour);
        // Inherit global-state pointer so child contours can resolve
        // it through their own getter chain.
        contour.setGlobalState(this.globalState());
        return contour;
    }

    public joinAllSegments(): void
    {
        let next: OpContour | undefined = this;
        do
        {
            if (next.count() === 0)
            {
                next = next.next();
                continue;
            }
            next.joinSegments();
            next = next.next();
        } while (next !== undefined);
    }

    // SkOpContour.h:424.
    public remove(contour: OpContour): void
    {
        if (contour === this)
        {
            if (this.count() !== 0)
                throw new Error('OpContourHead.remove: self-remove with content');
            return;
        }
        if (contour.next() !== undefined)
            throw new Error('OpContourHead.remove: contour must be the tail');
        let prev: OpContour = this;
        let next: OpContour | undefined;
        while ((next = prev.next()) !== contour)
        {
            if (next === undefined)
                throw new Error('OpContourHead.remove: contour not in list');
            prev = next;
        }
        prev.setNext(undefined);
    }
}

// ── OpContourBuilder — line-collapse + flush ─────────────────────
//
// SkOpContourBuilder collects line segments and elides any
// immediately-following reverse line (the "remove redundant back-out
// stub" pre-pass). Quad / cubic adds flush the pending line first.
// Useful for path-ops drivers that pull from a raw verb stream.

export class OpContourBuilder
{
    public fContour: OpContour;
    public fLastLine: [Point, Point] = [new Point(), new Point()];
    public fLastIsLine: boolean = false;

    constructor(contour: OpContour)
    {
        this.fContour = contour;
    }

    public contour(): OpContour { return this.fContour; }
    public setContour(contour: OpContour): void
    {
        this.flush();
        this.fContour = contour;
    }

    public addLine(pts: readonly Point[]): void
    {
        if (this.fLastIsLine)
        {
            // Identical reverse — cancel both.
            if (this.fLastLine[0].equals(pts[1]!)
                && this.fLastLine[1].equals(pts[0]!))
            {
                this.fLastIsLine = false;
                return;
            }
            this.flush();
        }
        this.fLastLine[0] = pts[0]!;
        this.fLastLine[1] = pts[1]!;
        this.fLastIsLine = true;
    }

    public addQuad(pts: readonly Point[]): void
    {
        this.flush();
        this.fContour.addQuad([pts[0]!, pts[1]!, pts[2]!]);
    }

    public addCubic(pts: readonly Point[]): void
    {
        this.flush();
        this.fContour.addCubic([pts[0]!, pts[1]!, pts[2]!, pts[3]!]);
    }

    public addCurve(verb: OpVerb, pts: readonly Point[]): void
    {
        switch (verb)
        {
            case OpVerb.kLine:  this.addLine(pts);  return;
            case OpVerb.kQuad:  this.addQuad(pts);  return;
            case OpVerb.kCubic: this.addCubic(pts); return;
            default: throw new Error(`OpContourBuilder.addCurve: unsupported verb ${verb}`);
        }
    }

    public flush(): void
    {
        if (!this.fLastIsLine) return;
        this.fContour.addLine([this.fLastLine[0], this.fLastLine[1]]);
        this.fLastIsLine = false;
    }
}
