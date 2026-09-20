// Copyright 2012 Google Inc.
//
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE-skia file at the root of this repository.
//
// TypeScript port: 2026 Eugene Napryaglo.
// Source: third_party/skia/src/pathops/SkPathOpsRect.{h,cpp}
//         (Skia commit pinned in third_party/skia)
//
// Double-precision axis-aligned bounding rectangle. Used throughout
// pathops to bbox-reject curves and segments before exact intersection
// tests. Fields are public mutable doubles — pathops code reads and
// writes them directly.
//
// Skia's `setBounds(Quad)` / `setBounds(Cubic)` methods are
// implemented on the curve classes themselves (Quad.boundingRect,
// Cubic.boundingRect) to keep this file curve-agnostic and avoid a
// circular import with quad.ts / cubic.ts. The semantics match Skia's
// SkPathOpsRect.cpp exactly — they're just defined on the other side
// of the type boundary.
//
// `SkPathOpsBounds` (the float-precision SkRect subclass used by the
// boolean-op graph) is deferred to Phase 5+ when SkRect itself enters
// the picture.

import { approximately_between } from './types.js';
import type { Point } from './point.js';

export class Rect
{
    public fLeft:   number = 0;
    public fTop:    number = 0;
    public fRight:  number = 0;
    public fBottom: number = 0;

    constructor(left: number = 0, top: number = 0, right: number = 0, bottom: number = 0)
    {
        this.fLeft   = left;
        this.fTop    = top;
        this.fRight  = right;
        this.fBottom = bottom;
    }

    // Expand `this` to include `pt`. Skia's Rect.add (header:24).
    public add(pt: Point): void
    {
        if (pt.fX < this.fLeft)   this.fLeft   = pt.fX;
        if (pt.fY < this.fTop)    this.fTop    = pt.fY;
        if (pt.fX > this.fRight)  this.fRight  = pt.fX;
        if (pt.fY > this.fBottom) this.fBottom = pt.fY;
    }

    // approximately_between on both axes — Skia uses this slack so a
    // point landing exactly on the edge counts as inside even after
    // finite-precision arithmetic nudges it slightly outside.
    public contains(pt: Point): boolean
    {
        return approximately_between(this.fLeft, pt.fX, this.fRight)
            && approximately_between(this.fTop,  pt.fY, this.fBottom);
    }

    // True iff this rectangle and `r` overlap (inclusive). Caller is
    // responsible for ensuring both rects are normalised (left ≤ right,
    // top ≤ bottom) — Skia debug-asserts this; we leave the contract
    // implicit because asserting on every call is expensive in JS.
    public intersects(r: Rect): boolean
    {
        return r.fLeft <= this.fRight
            && this.fLeft <= r.fRight
            && r.fTop <= this.fBottom
            && this.fTop <= r.fBottom;
    }

    // Reset to the degenerate "rectangle of one point" at `pt`. Skia
    // uses this as the seed for accumulating bounds (set first point,
    // then `add()` the rest).
    public set(pt: Point): void
    {
        this.fLeft = this.fRight  = pt.fX;
        this.fTop  = this.fBottom = pt.fY;
    }

    public width(): number
    {
        return this.fRight - this.fLeft;
    }

    public height(): number
    {
        return this.fBottom - this.fTop;
    }

    // Sanity check — false rectangles can arise if caller forgot to
    // call set() before add().
    public valid(): boolean
    {
        return this.fLeft <= this.fRight && this.fTop <= this.fBottom;
    }
}
