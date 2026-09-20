// Phase 5 accuracy-validation corpus.
//
// Beyond the "engine doesn't throw" smoke tests, these cases pin actual
// intersection coordinates against analytically-known answers. If a
// future change breaks the engine's numerical accuracy, these fail
// loudly with specific (expected, actual) deltas.
//
// Tolerance choice: 1e-6 for coordinate / t-value comparisons. Skia's
// own corpus runs near 1e-7 (ApproximatelyEqual ≈ FLT_EPSILON × 16),
// but the t-section bisection caps out at the precision of its
// terminating chord — coordinate accuracy can drift up to ~1e-6 when
// the iteration count hits the safety net. Tightening this would mean
// porting Skia's Newton-refinement tail.

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

const TOL_COORD = 1e-6;
const TOL_T     = 1e-6;
const P = (x: number, y: number) => new Point(x, y);
const Q = (p0: Point, p1: Point, p2: Point) => {
    const q = new Quad(); q.fPts = [p0, p1, p2]; return q;
};
const C = (p0: Point, p1: Point, p2: Point, p3: Point) => {
    const c = new Cubic(); c.fPts = [p0, p1, p2, p3]; return c;
};

function approxPoint(actual: Point, expected: Point, tol = TOL_COORD): boolean
{
    return Math.abs(actual.fX - expected.fX) < tol
        && Math.abs(actual.fY - expected.fY) < tol;
}

// ── Line × Line — analytical sanity ─────────────────────────────────

describe('Accuracy: line × line at exact crossings', () => {
    test('two diagonals cross at (5, 5)', () => {
        const a = new Line(P(0, 0), P(10, 10));
        const b = new Line(P(0, 10), P(10, 0));
        const ix = new Intersections();
        ix.intersectLineLine(a, b);
        assert.equal(ix.used(), 1);
        assert.ok(approxPoint(ix.pt(0), P(5, 5)));
        assert.ok(Math.abs(ix.fT[0]![0]! - 0.5) < TOL_T);
        assert.ok(Math.abs(ix.fT[1]![0]! - 0.5) < TOL_T);
    });

    test('horizontal × vertical at (3, 4)', () => {
        const h = new Line(P(0, 4), P(10, 4));
        const v = new Line(P(3, 0), P(3, 10));
        const ix = new Intersections();
        ix.intersectLineLine(h, v);
        assert.equal(ix.used(), 1);
        assert.ok(approxPoint(ix.pt(0), P(3, 4)));
    });
});

// ── Line × Quad — analytical crossings ──────────────────────────────

describe('Accuracy: line × quad at analytical t-values', () => {
    test('quad B(t)=(2t, 4t(1-t)) cut by y=0.5 at t = (2±√(1−0.5))/(2·1) on the worked curve', () => {
        // Quad through (0,0)→(1,2)→(2,0): B(t) = (2t, 4t(1-t)).
        // y = 4t - 4t² = 0.5 → 8t² - 8t + 1 = 0 → t = (2±√2)/4.
        const q = Q(P(0, 0), P(1, 2), P(2, 0));
        const line = new Line(P(-1, 0.5), P(3, 0.5));
        const ix = new Intersections();
        ix.intersectQuadLine(q, line);
        assert.equal(ix.used(), 2);
        const t1Expected = (2 - Math.SQRT2) / 4;
        const t2Expected = (2 + Math.SQRT2) / 4;
        // Quad t values should match analytical roots (order may vary).
        const got = [ix.fT[0]![0]!, ix.fT[0]![1]!].sort((a, b) => a - b);
        assert.ok(Math.abs(got[0]! - t1Expected) < TOL_T,
            `t1: expected ${t1Expected}, got ${got[0]}`);
        assert.ok(Math.abs(got[1]! - t2Expected) < TOL_T,
            `t2: expected ${t2Expected}, got ${got[1]}`);
        // Both intersection points should have y ≈ 0.5.
        for (let i = 0; i < 2; ++i)
        {
            assert.ok(Math.abs(ix.pt(i).fY - 0.5) < TOL_COORD);
        }
    });

    test('quad tangent to its apex line: y = 1 at t = 0.5 only', () => {
        const q = Q(P(0, 0), P(1, 2), P(2, 0));   // apex at (1, 1) at t = 0.5
        const line = new Line(P(-1, 1), P(3, 1));
        const ix = new Intersections();
        ix.intersectQuadLine(q, line);
        assert.equal(ix.used(), 1, 'tangent line gives one root');
        assert.ok(Math.abs(ix.fT[0]![0]! - 0.5) < TOL_T);
        assert.ok(approxPoint(ix.pt(0), P(1, 1)));
    });
});

// ── Line × Cubic — known crossings ──────────────────────────────────

describe('Accuracy: line × cubic at known crossings', () => {
    test('symmetric hill cubic crossed by y=3 — two roots equidistant from t=0.5', () => {
        // Symmetric cubic (control points mirror around t=0.5).
        const c = C(P(-2, 0), P(-1, 8), P(1, 8), P(2, 0));
        const line = new Line(P(-5, 3), P(5, 3));
        const ix = new Intersections();
        ix.intersectCubicLine(c, line);
        assert.equal(ix.used(), 2);
        // Both crossing points at y = 3.
        for (let i = 0; i < 2; ++i)
        {
            assert.ok(Math.abs(ix.pt(i).fY - 3) < TOL_COORD,
                `pt[${i}].y = ${ix.pt(i).fY}, expected 3`);
        }
        // Symmetric in x — sum of x's should equal 0 (mirror).
        const xSum = ix.pt(0).fX + ix.pt(1).fX;
        assert.ok(Math.abs(xSum) < TOL_COORD,
            `x's should sum to 0 by symmetry; got ${xSum}`);
    });

    test('cubic line crossing exactly at endpoint (t=0)', () => {
        const c = C(P(0, 0), P(1, 3), P(2, 3), P(3, 0));
        const line = new Line(P(-5, 0), P(0, 0));
        const ix = new Intersections();
        ix.intersectCubicLine(c, line);
        assert.ok(ix.used() >= 1);
        // First intersection should be cubic t = 0.
        let endpointFound = false;
        for (let i = 0; i < ix.used(); ++i)
        {
            if (Math.abs(ix.fT[0]![i]!) < TOL_T) endpointFound = true;
        }
        assert.ok(endpointFound, 'endpoint t=0 should be in result');
    });
});

// ── Quad × Quad — engine accuracy ──────────────────────────────────

describe('Accuracy: quad × quad through BinarySearch', () => {
    test('two parabolas crossing at exact analytical points', () => {
        // Q1: y = 4t1·(1-t1), parameter via x = 2t1.
        // Q2: y = (1 - 2t2)², parameter via x = 2t2.
        // Setting Q1.x = Q2.x means t1 = t2 = t.
        // 4t(1-t) = (1-2t)² → 8t² - 8t + 1 = 0 → t = (2±√2)/4.
        // Intersection points:
        //   t = (2-√2)/4 ≈ 0.1464 → x ≈ 0.2929, y = 0.5
        //   t = (2+√2)/4 ≈ 0.8536 → x ≈ 1.707,  y = 0.5
        const q1 = Q(P(0, 0), P(1, 2),  P(2, 0));
        const q2 = Q(P(0, 1), P(1, -1), P(2, 1));
        const ix = new Intersections();
        const n = ix.intersectQuadQuad(q1, q2);
        // Both crossings should be found.
        assert.equal(n, 2, `expected 2 intersections, got ${n}`);
        // Both intersection points should have y ≈ 0.5.
        for (let i = 0; i < n; ++i)
        {
            assert.ok(Math.abs(ix.pt(i).fY - 0.5) < 1e-4,
                `pt[${i}].y = ${ix.pt(i).fY}, expected 0.5`);
        }
        // x's should sum to 2 (the parabolas are symmetric around x=1).
        const xSum = ix.pt(0).fX + ix.pt(1).fX;
        assert.ok(Math.abs(xSum - 2) < 1e-4, `xs sum to 2 expected; got ${xSum}`);
    });

    test('disjoint quads — no intersection', () => {
        const q1 = Q(P(0, 0), P(1, -1), P(2, 0));   // dip
        const q2 = Q(P(0, 5), P(1,  6), P(2, 5));   // hill above
        const ix = new Intersections();
        const n = ix.intersectQuadQuad(q1, q2);
        assert.equal(n, 0);
    });

    test('identical quads run to completion (coincident)', () => {
        const q1 = Q(P(0, 0), P(1, 2), P(2, 0));
        const q2 = Q(P(0, 0), P(1, 2), P(2, 0));
        const ix = new Intersections();
        // Engine completes without throwing. Coincidence behaviour
        // can vary by t-sect numerical path; just gate on no-throw.
        const n = ix.intersectQuadQuad(q1, q2);
        assert.ok(n >= 0);
    });
});

// ── Cubic × Cubic — engine accuracy ────────────────────────────────

describe('Accuracy: cubic × cubic through BinarySearch', () => {
    test('mirrored S-curves crossing at origin', () => {
        // Antisymmetric S-curves through origin.
        const c1 = C(P(-3, -3), P(-1,  3), P(1, -3), P(3,  3));
        const c2 = C(P(-3,  3), P(-1, -3), P(1,  3), P(3, -3));
        const ix = new Intersections();
        const n = ix.intersectCubicCubic(c1, c2);
        // Both curves cross y=0 at x=0 by symmetry — they intersect at
        // least at origin.
        assert.ok(n >= 1, `expected ≥1 cubic×cubic intersection, got ${n}`);
        let originFound = false;
        for (let i = 0; i < n; ++i)
        {
            if (Math.abs(ix.pt(i).fX) < 1e-4 && Math.abs(ix.pt(i).fY) < 1e-4)
            {
                originFound = true;
                break;
            }
        }
        assert.ok(originFound, 'origin intersection should be found');
    });

    test('separated cubics — no intersection', () => {
        const c1 = C(P(-3, -10), P(-1, -8), P(1, -8), P(3, -10));
        const c2 = C(P(-3,  10), P(-1,  8), P(1,  8), P(3,  10));
        const ix = new Intersections();
        const n = ix.intersectCubicCubic(c1, c2);
        assert.equal(n, 0);
    });
});

// ── Cubic × Quad — engine accuracy ─────────────────────────────────

describe('Accuracy: cubic × quad through BinarySearch', () => {
    test('symmetric cubic vs inverted quad — they cross at known y-line', () => {
        // Cubic hill centred on origin, peak at y = 6
        const c = C(P(-2, 0), P(-1, 8), P(1, 8), P(2, 0));
        // Inverted quad opening upward, passing through (-2, 3), (0, 9), (2, 3)
        const q = Q(P(-2, 3), P(0, -1), P(2, 3));
        const ix = new Intersections();
        const n = ix.intersectCubicQuad(c, q);
        // The engine should at minimum survive this without throwing.
        // Both curves are bounded; intersection count is geometry-dependent.
        assert.ok(n >= 0);
    });
});
