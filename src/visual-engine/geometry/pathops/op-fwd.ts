// Forward-declared structural interfaces. Phase 6 spans / pt-T / angle
// types must reference segments, contours, coincidence, etc. — types
// that land in later sessions of the port. To keep cyclic imports
// linear, we declare the slice of each surface that the current files
// actually need here, and the concrete classes in later sessions will
// satisfy these via structural typing (TS doesn't require explicit
// `implements`).
//
// As later sessions land the concrete classes, narrow / extend the
// interfaces here in lock-step. Anything not in this file does not
// exist for Phase 6 spans — `OpSpanBase.collapsed()` cannot peek at a
// segment's verb yet because that field isn't on `OpSegmentLike`.

import type { Cubic } from './cubic.js';
import type { Line } from './line.js';
import type { Point } from './point.js';
import type { Quad } from './quad.js';
import type { OpGlobalState } from './op-global-state.js';

// SkPath::Verb — single-letter discriminator for which curve flavour a
// segment carries. Skia includes kMove / kClose / kDone for path
// traversal; we keep them at parity so verb-indexed tables align.
export enum OpVerb
{
    kMove  = 0,
    kLine  = 1,
    kQuad  = 2,
    kConic = 3,
    kCubic = 4,
    kClose = 5,
    kDone  = 6,
}

// Number of *interior + last* control points for each verb (so kLine→1,
// kQuad→2, kCubic→3). Matches SkPathOpsVerbToPoints in SkPathOpsTypes.h.
export function verbToPoints(verb: OpVerb): number
{
    switch (verb)
    {
        case OpVerb.kLine:  return 1;
        case OpVerb.kQuad:  return 2;
        case OpVerb.kConic: return 2;
        case OpVerb.kCubic: return 3;
        default:            throw new Error(`verbToPoints: invalid verb ${verb}`);
    }
}

// Discriminated curve carrier used in span-side debug subdivide.
// The pathops codebase passes a "current sub-curve" around as a
// flat-buffer SkDCurve in Skia (a union). TS doesn't union value types,
// so we tag-and-store. Only one of fLine / fQuad / fCubic is populated
// at a time, matching fVerb.
export type OpCurveCarrier =
    | { verb: OpVerb.kLine;  fLine: Line }
    | { verb: OpVerb.kQuad;  fQuad: Quad }
    | { verb: OpVerb.kCubic; fCubic: Cubic };

// What an OpAngle exposes to a span / pt-T that holds it. The full
// surface (sort, insert, sector math) lives on the concrete class;
// spans only need to round-trip pointers without dereferencing the
// guts.
export interface OpAngleLike
{
    start(): OpSpanBaseLike;
    end():   OpSpanBaseLike;
}

// Forward shape for SkOpSegment. Phase 6 chunks fill this in
// progressively; foundation-layer span code needs only the listed
// surface.
export interface OpSegmentLike
{
    contour(): OpContourLike | undefined;
    globalState(): OpGlobalState;
    head(): OpSpanBaseLike;
    tail(): OpSpanBaseLike;
    verb(): OpVerb;
    pts(): readonly Point[];
    weight(): number;
    done(): boolean;
    markAllDone(): void;
    release(span: unknown): void;
}

// Forward shape for SkOpContour. Only the contour→state link is
// needed at foundation-layer; the rest of the contour API lands with
// its own session.
export interface OpContourLike
{
    globalState(): OpGlobalState;
}

// Forward shape for SkOpContourHead. Skia derives the head from the
// contour for back-reference convenience; we keep the same surface.
export interface OpContourHeadLike extends OpContourLike
{
    next(): OpContourLike | undefined;
}

// Forward shape for SkOpCoincidence — referenced only by global state
// during Phase 6 foundation. The concrete class arrives in its own
// session.
export interface OpCoincidenceLike
{
    // Marker — nothing usable from foundation layer yet. Concrete
    // class will satisfy with its real surface.
    readonly __opCoincidenceLikeBrand: true;
}

// Self-referential forward — span ↔ pt-T cycle. The concrete classes
// in op-span.ts can be referenced directly as types because the file
// owns both. Other consumers (e.g. op-angle.ts) reference them
// through these aliases to keep import direction clear.
export interface OpPtTLike
{
    fT: number;
    fPt: Point;
    span(): OpSpanBaseLike;
    next(): OpPtTLike;
    segment(): OpSegmentLike;
}

export interface OpSpanBaseLike
{
    segment(): OpSegmentLike;
    ptT(): OpPtTLike;
    t(): number;
    pt(): Point;
    globalState(): OpGlobalState;
    final(): boolean;
}
