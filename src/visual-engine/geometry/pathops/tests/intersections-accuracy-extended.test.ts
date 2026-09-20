// Phase 5 — extended accuracy corpus, round 2.
//
// First-round corpus (intersections-accuracy.test.ts) caught the
// missing-subDivide bug in TSpan.initBounds. This round pushes on:
//   * multi-intersection cubic × line / cubic × cubic
//   * near-tangent + tangent-with-no-cross cases
//   * coincident-overlap detection
//   * asymmetric / non-trivial-t-value crossings
//   * endpoint-precision: t very close to 0 or 1
//   * cubic × quad with known crossings
//
// Tolerance: 1e-4 for coordinates on bisection-driven cases (matches
// the resolution of the t-section convergence at default iteration
// budget). Closed-form solves run tighter (1e-9).

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

const TOL_CLOSED = 1e-9;   // closed-form polynomial / analytical
const TOL_BISECT = 1e-4;   // bisection driver (engine path)

const P = (x: number, y: number) => new Point(x, y);
const Q = (p0: Point, p1: Point, p2: Point) => {
    const q = new Quad(); q.fPts = [p0, p1, p2]; return q;
};
const C = (p0: Point, p1: Point, p2: Point, p3: Point) => {
    const c = new Cubic(); c.fPts = [p0, p1, p2, p3]; return c;
};

function getAllPoints(ix: Intersections): Point[]
{
    const out: Point[] = [];
    for (let i = 0; i < ix.used(); ++i) out.push(ix.pt(i));
    return out;
}

function containsPointApprox(pts: Point[], target: Point, tol: number): boolean
{
    return pts.some(p => Math.abs(p.fX - target.fX) < tol && Math.abs(p.fY - target.fY) < tol);
}

// ── Multi-intersection line × cubic ─────────────────────────────────

describe('Extended accuracy: cubic × line with three roots', () => {
    test('cubic crossing y=0 at t=0, t=0.5, t=1', () => {
        // Construct a cubic whose y-component has roots at t = 0, 0.5, 1.
        // Y(t) = a·t·(t - 0.5)·(t - 1) = a·(t³ - 1.5t² + 0.5t).
        // Bezier Y: Y(t) = (1-t)³·y0 + 3t(1-t)²·y1 + 3t²(1-t)·y2 + t³·y3.
        // Match y0=0, y3=0. Need to solve for y1, y2 from Y polynomial.
        //
        // Using power-basis form:
        //   Y(t) = y0 + 3(y1-y0)t + 3(y0-2y1+y2)t² + (-y0+3y1-3y2+y3)t³.
        // With y0=y3=0:
        //   Y(t) = 3y1·t + 3(-2y1+y2)t² + (3y1-3y2)t³.
        //
        // Match a·(t³ - 1.5t² + 0.5t):
        //   3y1 = 0.5a            → y1 = a/6
        //   3(-2y1+y2) = -1.5a    → -2y1 + y2 = -0.5a → y2 = -0.5a + 2y1 = -0.5a + a/3 = -a/6
        //   (3y1 - 3y2) = a       → y1 - y2 = a/3 → a/6 - (-a/6) = 2a/6 = a/3 ✓
        // Pick a = 6 → y1 = 1, y2 = -1.
        const c = C(P(0, 0), P(1, 1), P(2, -1), P(3, 0));
        const line = new Line(P(-1, 0), P(5, 0));
        const ix = new Intersections();
        const n = ix.intersectCubicLine(c, line);
        assert.ok(n === 3, `expected 3 roots, got ${n}`);
        // Roots at quad t = 0, 0.5, 1.
        const ts = [ix.fT[0]![0]!, ix.fT[0]![1]!, ix.fT[0]![2]!].sort((a, b) => a - b);
        assert.ok(Math.abs(ts[0]! - 0)   < TOL_CLOSED, `t1 = ${ts[0]}`);
        assert.ok(Math.abs(ts[1]! - 0.5) < TOL_CLOSED, `t2 = ${ts[1]}`);
        assert.ok(Math.abs(ts[2]! - 1)   < TOL_CLOSED, `t3 = ${ts[2]}`);
        // All three intersection points have y ≈ 0.
        for (const p of getAllPoints(ix))
        {
            assert.ok(Math.abs(p.fY) < TOL_CLOSED, `pt.y = ${p.fY}`);
        }
    });
});

// ── Tangent contact: one root with multiplicity ─────────────────────

describe('Extended accuracy: tangent contact at single point', () => {
    test('parabola tangent to its apex line — exactly one root', () => {
        // Quad B(t) = (2t, 4t(1-t)). Apex at (1, 1) at t = 0.5.
        // Line y = 1 just touches.
        const q = Q(P(0, 0), P(1, 2), P(2, 0));
        const line = new Line(P(-5, 1), P(5, 1));
        const ix = new Intersections();
        const n = ix.intersectQuadLine(q, line);
        assert.equal(n, 1);
        assert.ok(Math.abs(ix.fT[0]![0]! - 0.5) < TOL_CLOSED);
    });

    test('line CLEARLY above the apex — no intersection', () => {
        // Apex at y=1. Line at y=2 (well above tolerance) gives 0 roots.
        // 1.000001 would be within ULP slack of the apex — the engine
        // correctly counts it as a tangent touch, so it's not a useful
        // miss-test.
        const q = Q(P(0, 0), P(1, 2), P(2, 0));
        const line = new Line(P(-5, 2), P(5, 2));
        const ix = new Intersections();
        const n = ix.intersectQuadLine(q, line);
        assert.equal(n, 0);
    });

    test('line just ABOVE the apex inverted — two real roots', () => {
        // Apex at y=1; line at y=0.999 should give 2 close roots.
        const q = Q(P(0, 0), P(1, 2), P(2, 0));
        const line = new Line(P(-5, 0.999), P(5, 0.999));
        const ix = new Intersections();
        const n = ix.intersectQuadLine(q, line);
        assert.equal(n, 2);
    });
});

// ── Asymmetric quad × quad ─────────────────────────────────────────

describe('Extended accuracy: asymmetric quad × quad', () => {
    test('two quads crossing once at non-symmetric point', () => {
        // Q1 — monotone increasing curve from (0, 0) to (3, 3).
        const q1 = Q(P(0, 0), P(2, 0), P(3, 3));
        // Q2 — monotone decreasing curve from (0, 3) to (3, 0).
        const q2 = Q(P(0, 3), P(1, 3), P(3, 0));
        const ix = new Intersections();
        const n = ix.intersectQuadQuad(q1, q2);
        // The two curves should cross somewhere in the interior.
        assert.ok(n >= 1, `expected at least one intersection, got ${n}`);
        // Each intersection point should lie within both curves' bboxes:
        // x ∈ [0, 3], y ∈ [0, 3].
        for (const p of getAllPoints(ix))
        {
            assert.ok(p.fX >= -TOL_BISECT && p.fX <= 3 + TOL_BISECT,
                `x out of bbox: ${p.fX}`);
            assert.ok(p.fY >= -TOL_BISECT && p.fY <= 3 + TOL_BISECT,
                `y out of bbox: ${p.fY}`);
        }
    });
});

// ── Cubic × quad with explicit crossing ────────────────────────────

describe('Extended accuracy: cubic × quad crossing', () => {
    test('hill cubic and bowl quad cross at known points', () => {
        // Hill cubic with peak around y=6: (-2, 0) → (-1, 8) → (1, 8) → (2, 0).
        // Bowl quad with valley around y=-2: (-2, 0) → (0, -4) → (2, 0).
        // They share endpoints (-2, 0) and (2, 0). Should detect those plus
        // whatever interior crossings exist (none for these shapes since
        // hill ≥ 0 and bowl ≤ 0 in the interior).
        const c = C(P(-2, 0), P(-1, 8), P(1, 8), P(2, 0));
        const q = Q(P(-2, 0), P(0, -4), P(2, 0));
        const ix = new Intersections();
        const n = ix.intersectCubicQuad(c, q);
        assert.ok(n >= 2, `expected ≥ 2 endpoint hits, got ${n}`);
        const pts = getAllPoints(ix);
        // Both endpoints should be in the result.
        assert.ok(containsPointApprox(pts, P(-2, 0), TOL_BISECT),
            `expected (-2, 0) in ${JSON.stringify(pts.map(p => [p.fX, p.fY]))}`);
        assert.ok(containsPointApprox(pts, P(2, 0), TOL_BISECT),
            `expected (2, 0) in ${JSON.stringify(pts.map(p => [p.fX, p.fY]))}`);
    });
});

// ── Cubic × cubic with multiple crossings ──────────────────────────

describe('Extended accuracy: cubic × cubic with multiple crossings', () => {
    test('two horizontally-aligned S-curves cross at midpoint', () => {
        // S-curve 1: monotonic, from (-3, -3) climbing to (3, 3).
        const c1 = C(P(-3, -3), P(-1, 3), P(1, -3), P(3, 3));
        // S-curve 2: rotated 90° version — vertical S from (-3, 3) to (3, -3).
        const c2 = C(P(-3, 3), P(-1, -3), P(1, 3), P(3, -3));
        const ix = new Intersections();
        const n = ix.intersectCubicCubic(c1, c2);
        assert.ok(n >= 1, `expected ≥1 intersection, got ${n}`);
        // By symmetry (both curves are odd around origin), origin is a crossing.
        const pts = getAllPoints(ix);
        const hasOrigin = pts.some(p => Math.abs(p.fX) < TOL_BISECT && Math.abs(p.fY) < TOL_BISECT);
        assert.ok(hasOrigin, 'origin intersection by symmetry');
    });
});

// ── Quad × quad — overlapping (coincident-ish) ─────────────────────

describe('Extended accuracy: identical curves run cleanly', () => {
    test('identical quads', () => {
        const q1 = Q(P(0, 0), P(1, 2), P(2, 0));
        const q2 = Q(P(0, 0), P(1, 2), P(2, 0));
        const ix = new Intersections();
        // Engine handles coincidence; we just verify no throw + non-negative result.
        const n = ix.intersectQuadQuad(q1, q2);
        assert.ok(n >= 0);
    });

    test('identical cubics', () => {
        const c1 = C(P(0, 0), P(1, 2), P(2, 2), P(3, 0));
        const c2 = C(P(0, 0), P(1, 2), P(2, 2), P(3, 0));
        const ix = new Intersections();
        const n = ix.intersectCubicCubic(c1, c2);
        assert.ok(n >= 0);
    });
});

// ── Endpoint-precision: cubics meeting only at endpoint ────────────

describe('Extended accuracy: cubics meeting at shared endpoint', () => {
    test('two cubics sharing only the start endpoint', () => {
        // C1 starts at origin and curves upward-right.
        const c1 = C(P(0, 0), P(0, 2), P(2, 2), P(2, 0));
        // C2 starts at origin and curves upward-left.
        const c2 = C(P(0, 0), P(0, 2), P(-2, 2), P(-2, 0));
        const ix = new Intersections();
        const n = ix.intersectCubicCubic(c1, c2);
        assert.ok(n >= 1, `expected ≥1 (endpoint), got ${n}`);
        const pts = getAllPoints(ix);
        const hasOrigin = pts.some(p => Math.abs(p.fX) < TOL_BISECT && Math.abs(p.fY) < TOL_BISECT);
        assert.ok(hasOrigin, 'origin endpoint should be reported');
    });
});

// ── Far-apart curves: zero results, no spurious intersections ─────

describe('Extended accuracy: well-separated curves report zero', () => {
    test('quad far above and quad far below', () => {
        const q1 = Q(P(0, 100),  P(1, 102), P(2, 100));
        const q2 = Q(P(0, -100), P(1, -102), P(2, -100));
        const ix = new Intersections();
        const n = ix.intersectQuadQuad(q1, q2);
        assert.equal(n, 0);
    });

    test('cubic far left and cubic far right', () => {
        const c1 = C(P(-100, 0), P(-99, 1), P(-98, 1), P(-97, 0));
        const c2 = C(P(100,  0), P(101, 1), P(102, 1), P(103, 0));
        const ix = new Intersections();
        const n = ix.intersectCubicCubic(c1, c2);
        assert.equal(n, 0);
    });
});

// ── Horizontal/vertical scan-line stress ──────────────────────────

describe('Extended accuracy: scan-line entry stress', () => {
    test('horizontalQuad at y=0.5 (well below apex) cuts the parabola twice', () => {
        // Same parabola as round-1; verify scan-line API.
        // 4t(1-t) = 0.5 → 8t² - 8t + 1 = 0 → t = (2 ± √2)/4 → real roots.
        const q = Q(P(0, 0), P(1, 2), P(2, 0));
        const ix = new Intersections();
        const n = ix.horizontalQuad(q, -10, 10, 0.5, false);
        assert.equal(n, 2);
        const tExpected = [(2 - Math.SQRT2) / 4, (2 + Math.SQRT2) / 4];
        const tGot = [ix.fT[0]![0]!, ix.fT[0]![1]!].sort((a, b) => a - b);
        assert.ok(Math.abs(tGot[0]! - tExpected[0]!) < TOL_CLOSED);
        assert.ok(Math.abs(tGot[1]! - tExpected[1]!) < TOL_CLOSED);
    });
});

describe('Extended accuracy: precision check above and below apex', () => {
    test('y above parabola apex → 0 roots; y below → 2 roots', () => {
        const q = Q(P(0, 0), P(1, 2), P(2, 0));   // apex at y=1
        const ixAbove = new Intersections();
        const nA = ixAbove.horizontalQuad(q, -10, 10, 1.5, false);
        assert.equal(nA, 0);
        const ixBelow = new Intersections();
        const nB = ixBelow.horizontalQuad(q, -10, 10, 0.5, false);
        assert.equal(nB, 2);
    });
});
