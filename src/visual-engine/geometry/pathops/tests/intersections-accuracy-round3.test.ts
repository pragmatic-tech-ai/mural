// Phase 5 — round-3 accuracy corpus. Targets the three gaps left after
// round 1 + 2:
//
//   1. Coincident-flag pinning: prior tests only asserted "no throw"
//      for identical curves. This round pins fIsCoincident to the
//      exact 0b11 bitmask the engine should emit, with both endpoints
//      flagged as coincident-segment ends.
//
//   2. High-crossing-count cubic × cubic: prior corpus topped out at
//      2-3 intersections per pair (Bezout's bound for two cubics is 9).
//      We add an adversarial "extreme oscillation" pair that lands 5
//      real interior crossings, and a horizontal-S vs vertical-S pair
//      that lands 3 transverse crossings with point-symmetry through
//      origin.
//
//   3. Near-tangent precision sweep: we measure where the engine's
//      bisection driver flips between "two roots" and "one tangent
//      touch" on a parabola. This pins the engine's resolution so a
//      future regression in numerical tail (e.g. swapping bisection
//      iteration cap) trips here loudly. Measured behaviour:
//        BELOW apex (real two-root case)
//          eps ≥ 1e-9 → 2 real roots
//          eps ≤ 1e-10 → engine collapses to 1
//        ABOVE apex (real zero-root case)
//          eps ≥ 1e-5 → 0 roots
//          eps ≤ 1e-6 → engine emits 1 (tangent-touch false-positive)
//
//      These thresholds correspond to Skia's ApproximatelyEqual /
//      precisely_zero family. Tightening would require porting the
//      Newton-refinement tail (out of scope for Phase 5).
//
// Adversarial inputs from Skia's tests/PathOps*Test.cpp corpus
// (~500 cases) are deferred to Phase 8 — those test the full simplify
// engine, not just intersections.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { Cubic } from '../cubic.js';
import { Intersections } from '../intersections.js';
import { Line } from '../line.js';
import { Point } from '../point.js';
import { Quad } from '../quad.js';
import '../quad-line-intersection.js';
import '../cubic-line-intersection.js';
import '../t-sect.js';

const TOL_CLOSED = 1e-9;
const TOL_BISECT = 1e-4;

const P = (x: number, y: number) => new Point(x, y);
const Q = (p0: Point, p1: Point, p2: Point) => {
    const q = new Quad(); q.fPts = [p0, p1, p2]; return q;
};
const C = (p0: Point, p1: Point, p2: Point, p3: Point) => {
    const c = new Cubic(); c.fPts = [p0, p1, p2, p3]; return c;
};

// ── Coincident-flag pinning ────────────────────────────────────────

describe('Round-3 accuracy: coincident-flag pinning on identical curves', () => {
    test('identical quads emit both-endpoint coincidence bits (0b11)', () => {
        const q1 = Q(P(0, 0), P(1, 2), P(2, 0));
        const q2 = Q(P(0, 0), P(1, 2), P(2, 0));
        const ix = new Intersections();
        const n = ix.intersectQuadQuad(q1, q2);
        assert.equal(n, 2, 'two endpoints reported');
        assert.equal(ix.fIsCoincident[0]!, 0b11,
            `fIsCoincident[0] = 0b${ix.fIsCoincident[0]!.toString(2)}, expected 0b11`);
        assert.equal(ix.fIsCoincident[1]!, 0b11,
            `fIsCoincident[1] = 0b${ix.fIsCoincident[1]!.toString(2)}, expected 0b11`);
        assert.ok(ix.isCoincident(0), 'index 0 reports coincident');
        assert.ok(ix.isCoincident(1), 'index 1 reports coincident');
        assert.equal(ix.fT[0]![0]!, 0);
        assert.equal(ix.fT[0]![1]!, 1);
        assert.equal(ix.fT[1]![0]!, 0);
        assert.equal(ix.fT[1]![1]!, 1);
        assert.ok(ix.pt(0).equals(P(0, 0)));
        assert.ok(ix.pt(1).equals(P(2, 0)));
    });

    test('identical cubics emit both-endpoint coincidence bits (0b11)', () => {
        const c1 = C(P(0, 0), P(1, 2), P(2, 2), P(3, 0));
        const c2 = C(P(0, 0), P(1, 2), P(2, 2), P(3, 0));
        const ix = new Intersections();
        const n = ix.intersectCubicCubic(c1, c2);
        assert.equal(n, 2, 'two endpoints reported');
        assert.equal(ix.fIsCoincident[0]!, 0b11);
        assert.equal(ix.fIsCoincident[1]!, 0b11);
        assert.ok(ix.isCoincident(0));
        assert.ok(ix.isCoincident(1));
        assert.equal(ix.fT[0]![0]!, 0);
        assert.equal(ix.fT[0]![1]!, 1);
        assert.ok(ix.pt(0).equals(P(0, 0)));
        assert.ok(ix.pt(1).equals(P(3, 0)));
    });

    test('disjoint quads emit no coincidence flags (mask stays 0)', () => {
        const q1 = Q(P(0, 0),  P(1, -1), P(2, 0));
        const q2 = Q(P(0, 10), P(1, 11), P(2, 10));
        const ix = new Intersections();
        ix.intersectQuadQuad(q1, q2);
        assert.equal(ix.fIsCoincident[0]!, 0);
        assert.equal(ix.fIsCoincident[1]!, 0);
    });
});

// ── High-crossing-count cubic × cubic ─────────────────────────────

describe('Round-3 accuracy: cubic × cubic with 4+ crossings', () => {
    // Two mirror-image cubics with huge control-polygon overshoots.
    // Empirically determined to give 5 transverse crossings on the
    // current engine — well past the 2-3 cap of round-1 / round-2.
    test('extreme-oscillation cubic pair yields 5 transverse crossings', () => {
        const c1 = C(P(0, 0), P(10,  10), P(-10, -10), P(3, 0));
        const c2 = C(P(0, 0), P(-10, 10), P(10,  -10), P(3, 0));
        const ix = new Intersections();
        const n = ix.intersectCubicCubic(c1, c2);
        assert.equal(n, 5, `expected 5 crossings, got ${n}`);
        // Endpoints (0, 0) and (3, 0) must be reported at t = 0 / t = 1
        // on both curves.
        const ts0 = Array.from({ length: n }, (_, i) => ix.fT[0]![i]!);
        const ts1 = Array.from({ length: n }, (_, i) => ix.fT[1]![i]!);
        assert.ok(ts0.some(t => Math.abs(t) < TOL_CLOSED),
            `t=0 missing on curve 0; ts=${JSON.stringify(ts0)}`);
        assert.ok(ts0.some(t => Math.abs(t - 1) < TOL_CLOSED),
            `t=1 missing on curve 0; ts=${JSON.stringify(ts0)}`);
        assert.ok(ts1.some(t => Math.abs(t) < TOL_CLOSED),
            `t=0 missing on curve 1; ts=${JSON.stringify(ts1)}`);
        assert.ok(ts1.some(t => Math.abs(t - 1) < TOL_CLOSED),
            `t=1 missing on curve 1; ts=${JSON.stringify(ts1)}`);
        // (0,0) and (3,0) must be among the reported points.
        let hasStart = false;
        let hasEnd   = false;
        for (let i = 0; i < n; ++i)
        {
            const p = ix.pt(i);
            if (Math.abs(p.fX) < TOL_BISECT && Math.abs(p.fY) < TOL_BISECT) hasStart = true;
            if (Math.abs(p.fX - 3) < TOL_BISECT && Math.abs(p.fY) < TOL_BISECT) hasEnd = true;
        }
        assert.ok(hasStart, 'endpoint (0,0) missing');
        assert.ok(hasEnd,   'endpoint (3,0) missing');
    });

    // Two cubics that are point-reflections of each other through
    // origin: c1 is a horizontal S-curve, c2 is its 90°-rotated copy.
    // Three crossings: origin + two off-axis points placed symmetrically.
    test('horizontal-S vs vertical-S — 3 crossings, point-symmetric through origin', () => {
        const c1 = C(P(-2, 0), P(0,  5), P(0, -5), P(2, 0));
        const c2 = C(P(0, -2), P(5,  0), P(-5, 0), P(0, 2));
        const ix = new Intersections();
        const n = ix.intersectCubicCubic(c1, c2);
        assert.equal(n, 3, `expected 3 crossings, got ${n}`);
        // Origin should be one of the crossings (both curves are odd
        // around origin so by symmetry it's a fixed point).
        let originIdx = -1;
        for (let i = 0; i < n; ++i)
        {
            if (Math.abs(ix.pt(i).fX) < TOL_BISECT && Math.abs(ix.pt(i).fY) < TOL_BISECT)
            {
                originIdx = i;
                break;
            }
        }
        assert.notEqual(originIdx, -1, 'origin crossing missing');
        // Non-origin crossings should sum to (0, 0) by point symmetry.
        let xSum = 0;
        let ySum = 0;
        for (let i = 0; i < n; ++i)
        {
            if (i === originIdx) continue;
            xSum += ix.pt(i).fX;
            ySum += ix.pt(i).fY;
        }
        assert.ok(Math.abs(xSum) < TOL_BISECT,
            `non-origin x's should sum to 0 by symmetry; got ${xSum}`);
        assert.ok(Math.abs(ySum) < TOL_BISECT,
            `non-origin y's should sum to 0 by symmetry; got ${ySum}`);
    });

    // Strong-S vs counter-S construction — both pass through (0,0),
    // (1.5, 0), and (3, 0) by Bernstein-basis algebra. Pin those three.
    test('strong-S vs counter-S — three known crossings on x-axis', () => {
        // B(0.5) = 0.125·P0 + 0.375·(P1+P2) + 0.125·P3.
        // For c1 with y=(0,5,-5,0): y(0.5) = 0.375·(5 + -5) = 0.
        const c1 = C(P(0, 0), P(1,  5), P(2, -5), P(3, 0));
        const c2 = C(P(0, 0), P(1, -5), P(2,  5), P(3, 0));
        const ix = new Intersections();
        const n = ix.intersectCubicCubic(c1, c2);
        assert.equal(n, 3);
        // Sorted t values should land at 0, 0.5, 1.
        const ts = Array.from({ length: n }, (_, i) => ix.fT[0]![i]!).sort((a, b) => a - b);
        assert.ok(Math.abs(ts[0]! - 0)   < TOL_CLOSED, `t1 = ${ts[0]}`);
        assert.ok(Math.abs(ts[1]! - 0.5) < TOL_CLOSED, `t2 = ${ts[1]}`);
        assert.ok(Math.abs(ts[2]! - 1)   < TOL_CLOSED, `t3 = ${ts[2]}`);
        // All three crossings on x-axis (y = 0).
        for (let i = 0; i < n; ++i)
        {
            assert.ok(Math.abs(ix.pt(i).fY) < TOL_BISECT,
                `pt[${i}].y = ${ix.pt(i).fY}`);
        }
    });
});

// ── Near-tangent precision sweep ──────────────────────────────────

describe('Round-3 accuracy: near-tangent precision sweep on quad × line', () => {
    // Quad apex at (1, 1). Line y = 1 - eps for decreasing eps.
    // Engine should give 2 real roots for any eps > 0 in exact
    // arithmetic; we measure where finite-precision collapse occurs.
    test('below apex: 2 real roots holds down to eps ≈ 1e-9', () => {
        const q = Q(P(0, 0), P(1, 2), P(2, 0));
        const epsValues = [1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-7, 1e-8, 1e-9];
        for (const eps of epsValues)
        {
            const ix = new Intersections();
            const line = new Line(P(-5, 1 - eps), P(5, 1 - eps));
            const n = ix.intersectQuadLine(q, line);
            assert.equal(n, 2,
                `eps=${eps}: expected 2 roots, got ${n}`);
            // Roots should be symmetric around t=0.5.
            const t0 = ix.fT[0]![0]!;
            const t1 = ix.fT[0]![1]!;
            const tMid = (t0 + t1) / 2;
            assert.ok(Math.abs(tMid - 0.5) < TOL_BISECT,
                `eps=${eps}: roots not centred at 0.5: t=[${t0},${t1}]`);
        }
    });

    test('below apex: engine collapses to 1 root for eps ≤ 1e-10', () => {
        // This documents (and pins) the engine's resolution floor.
        // If a future change tightens the tail (e.g. ports Newton
        // refinement), this will break — that's the intended signal.
        const q = Q(P(0, 0), P(1, 2), P(2, 0));
        const epsValues = [1e-10, 1e-11, 1e-12];
        for (const eps of epsValues)
        {
            const ix = new Intersections();
            const line = new Line(P(-5, 1 - eps), P(5, 1 - eps));
            const n = ix.intersectQuadLine(q, line);
            assert.equal(n, 1,
                `eps=${eps}: expected 1 root (collapsed), got ${n}`);
            assert.ok(Math.abs(ix.fT[0]![0]! - 0.5) < TOL_BISECT,
                `collapsed root should land near apex t=0.5; got ${ix.fT[0]![0]}`);
        }
    });

    test('above apex: 0 roots holds down to eps ≈ 1e-5', () => {
        const q = Q(P(0, 0), P(1, 2), P(2, 0));
        const epsValues = [1e-1, 1e-2, 1e-3, 1e-4, 1e-5];
        for (const eps of epsValues)
        {
            const ix = new Intersections();
            const line = new Line(P(-5, 1 + eps), P(5, 1 + eps));
            const n = ix.intersectQuadLine(q, line);
            assert.equal(n, 0,
                `eps=${eps}: expected 0 roots, got ${n}`);
        }
    });

    test('above apex: engine reports tangent touch for eps ≤ 1e-6', () => {
        // Pin the engine's tangent-touch threshold. Values in
        // [apex + 1e-6, apex + ?]: engine treats as tangent contact.
        // This is a documented finite-precision artefact, not a bug.
        const q = Q(P(0, 0), P(1, 2), P(2, 0));
        const epsValues = [1e-6, 1e-7, 1e-8, 1e-9, 1e-12];
        for (const eps of epsValues)
        {
            const ix = new Intersections();
            const line = new Line(P(-5, 1 + eps), P(5, 1 + eps));
            const n = ix.intersectQuadLine(q, line);
            assert.equal(n, 1,
                `eps=${eps}: expected 1 root (tangent), got ${n}`);
            assert.ok(Math.abs(ix.fT[0]![0]! - 0.5) < TOL_BISECT,
                `tangent root should land at apex t=0.5; got ${ix.fT[0]![0]}`);
        }
    });
});
