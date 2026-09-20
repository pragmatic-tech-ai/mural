// Copyright 2012 Google Inc.
//
// Use of this source code is governed by a BSD-style license that can
// be found in the LICENSE-skia file at the root of this repository.
//
// TypeScript port: 2026 Eugene Napryaglo.
// Source: third_party/skia/src/pathops/SkPathOpsTypes.{h,cpp}
//         (Skia commit pinned in third_party/skia)
//
// Phase 6 entry — operation-time state shared across the contour /
// segment / span tree. Each SkPathOps run instantiates exactly one
// OpGlobalState; every span / pt-t / segment / contour holds a pointer
// to the same instance through their contour parent.
//
// Mural's port keeps the same shape but strips Skia's debug-only fields
// (ID counters, allocator stash, glitch logs) down to what's actually
// observable from the engine. ID counters stay because the engine uses
// them when sorting equal-priority spans deterministically; the rest of
// the debug payload moves to a `_debug` sub-record we can extend later
// without changing the public surface.

import { OpCoincidenceLike, OpContourHeadLike } from './op-fwd.js';

// SkPathOpsTypes.h:29 — phase enum. Tracks where in the pathops
// pipeline we are; affects which assertions fire (intersecting allows
// open spans; walking does not).
export enum OpPhase
{
    kNoChange,
    kIntersecting,
    kWalking,
    kFixWinding,
}

// SkPathOpsTypes.h:18 — winding mask enum. -1 / 0 / 1 distinguish
// winding / no-op / even-odd path-fill semantics. Used by the Op
// driver, not the span tree, but lives here for parity with Skia's
// header organisation.
export enum OpMask
{
    kWinding  = -1,
    kNo       =  0,
    kEvenOdd  =  1,
}

export class OpGlobalState
{
    // Public: hot-path state read by spans / segments without
    // accessors. Skia exposes these too; matching shape simplifies the
    // line-by-line port.
    public fContourHead:   OpContourHeadLike | undefined = undefined;
    public fCoincidence:   OpCoincidenceLike | undefined = undefined;
    public fNested:        number = 0;
    public fAllocatedOpSpan: boolean = false;
    public fWindingFailed: boolean = false;
    public fPhase:         OpPhase = OpPhase.kNoChange;

    // ID counters. Skia gates these behind SkDEBUGCODE; mural keeps
    // them unconditional. Cost is one increment per allocation, which
    // is negligible alongside the bisection / coincidence work, and
    // having stable IDs makes failures comparable across runs.
    private _nextAngleID:   number = 0;
    private _nextCoinID:    number = 0;
    private _nextContourID: number = 0;
    private _nextPtTID:     number = 0;
    private _nextSegmentID: number = 0;
    private _nextSpanID:    number = 0;

    constructor(contourHead?: OpContourHeadLike)
    {
        this.fContourHead = contourHead;
    }

    // SkPathOpsTypes.h:113 — nesting counter; used by the Op driver to
    // detect re-entrant calls into the simplify engine.
    public nested(): number { return this.fNested; }
    public bumpNested(): void { ++this.fNested; }
    public clearNested(): void { this.fNested = 0; }

    public coincidence(): OpCoincidenceLike | undefined { return this.fCoincidence; }
    public setCoincidence(coincidence: OpCoincidenceLike | undefined): void
    {
        this.fCoincidence = coincidence;
    }

    public contourHead(): OpContourHeadLike | undefined { return this.fContourHead; }
    public setContourHead(head: OpContourHeadLike | undefined): void
    {
        this.fContourHead = head;
    }

    // SkPathOpsTypes.h:46 — flag that tracks whether the current pass
    // allocated any new spans; coincidence resolution loops on this.
    public allocatedOpSpan(): boolean { return this.fAllocatedOpSpan; }
    public setAllocatedOpSpan(): void { this.fAllocatedOpSpan = true; }
    public resetAllocatedOpSpan(): void { this.fAllocatedOpSpan = false; }

    public phase(): OpPhase { return this.fPhase; }
    public setPhase(phase: OpPhase): void
    {
        // SkPathOpsTypes.h:163 — kNoChange is a no-op; otherwise the
        // new phase must differ from the current one. Skia asserts on
        // the same-phase case; we throw so a misconfigured caller
        // surfaces loudly rather than silently no-op.
        if (phase === OpPhase.kNoChange) return;
        if (this.fPhase === phase) throw new Error('OpGlobalState.setPhase: same phase');
        this.fPhase = phase;
    }

    public windingFailed(): boolean { return this.fWindingFailed; }
    public setWindingFailed(): void { this.fWindingFailed = true; }

    public nextAngleID():   number { return ++this._nextAngleID; }
    public nextCoinID():    number { return ++this._nextCoinID; }
    public nextContourID(): number { return ++this._nextContourID; }
    public nextPtTID():     number { return ++this._nextPtTID; }
    public nextSegmentID(): number { return ++this._nextSegmentID; }
    public nextSpanID():    number { return ++this._nextSpanID; }
}
