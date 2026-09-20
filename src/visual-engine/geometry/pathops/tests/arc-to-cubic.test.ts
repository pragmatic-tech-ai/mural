// arcToCubics — SVG endpoint-arc → cubic-Bezier-chain adapter tests.
//
// Coverage:
//   * Degenerate inputs (zero radii, identical endpoints)
//   * Right-angle and half-circle sweeps — endpoint pinning
//   * Full circle expressed as two large-arc halves
//   * x-axis rotation correctness — 45° rotation against analytic
//     reference
//   * Max-error sweep — every cubic in a 90° approximation stays
//     within the documented κ ≈ (4/3) tan(θ/4) bound vs. the true
//     ellipse, sampled at 16 evenly-spaced t-values.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { arcToCubics } from '../arc-to-cubic.js';

const TWO_PI = 2 * Math.PI;

function approx(a: number, b: number, eps = 1e-9): boolean
{
    return Math.abs(a - b) <= eps;
}

// Evaluate a cubic Bezier at parameter t — replicated here rather than
// imported so the test doesn't get tangled in the engine's evaluator
// signature.
function evalCubic(p0x: number, p0y: number,
                   p1x: number, p1y: number,
                   p2x: number, p2y: number,
                   p3x: number, p3y: number,
                   t: number): [number, number]
                   {
    const mt = 1 - t;
    const b0 = mt * mt * mt;
    const b1 = 3 * mt * mt * t;
    const b2 = 3 * mt * t * t;
    const b3 = t * t * t;
    return [b0 * p0x + b1 * p1x + b2 * p2x + b3 * p3x,
            b0 * p0y + b1 * p1y + b2 * p2y + b3 * p3y];
}

describe('arcToCubics — degenerate inputs', () => {
    test('identical endpoints → empty', () => {
        const out = arcToCubics(0, 0, 0, 0, 10, 10, 0, false, false);
        assert.equal(out.length, 0);
    });

    test('rx = 0 → empty (caller emits line)', () => {
        const out = arcToCubics(0, 0, 10, 0, 0, 10, 0, false, false);
        assert.equal(out.length, 0);
    });

    test('ry = 0 → empty', () => {
        const out = arcToCubics(0, 0, 10, 0, 10, 0, 0, false, false);
        assert.equal(out.length, 0);
    });
});

describe('arcToCubics — basic geometry', () => {
    test('quarter arc (rx=ry=10, start (10,0) → end (0,10), small-arc CCW) → 1 cubic with end-pinned endpoints', () => {
        // Counterclockwise unit circle: (10,0) → (0,10) is a 90° arc
        // going through (10/√2, 10/√2) area — small-arc, sweep=0
        // (counterclockwise in user space).
        const out = arcToCubics(10, 0, 0, 10, 10, 10, 0, false, false);
        assert.equal(out.length, 1);
        const c = out[0]!;
        assert.ok(approx(c.fPts[0]!.fX, 10, 1e-9));
        assert.ok(approx(c.fPts[0]!.fY,  0, 1e-9));
        assert.ok(approx(c.fPts[3]!.fX,  0, 1e-9));
        assert.ok(approx(c.fPts[3]!.fY, 10, 1e-9));
    });

    test('semicircle (180° large-arc) splits into 2 cubics with matching mid-join', () => {
        // Start (10,0), end (-10,0), unit circle radii, large-arc=true,
        // sweep=true (clockwise in user space → goes through (0, 10)).
        const out = arcToCubics(10, 0, -10, 0, 10, 10, 0, true, true);
        assert.equal(out.length, 2);
        // Mid-join: cubic[0].P3 should equal cubic[1].P0 exactly.
        assert.ok(approx(out[0]!.fPts[3]!.fX, out[1]!.fPts[0]!.fX, 1e-12));
        assert.ok(approx(out[0]!.fPts[3]!.fY, out[1]!.fPts[0]!.fY, 1e-12));
        // Mid-point of the arc (mid-sweep) is at the +Y pole for
        // clockwise in user-space (visual screen y-down).
        assert.ok(approx(out[0]!.fPts[3]!.fX,  0, 1e-9));
        assert.ok(approx(out[0]!.fPts[3]!.fY, 10, 1e-9));
        // Endpoints pinned.
        assert.ok(approx(out[0]!.fPts[0]!.fX,  10, 1e-9));
        assert.ok(approx(out[1]!.fPts[3]!.fX, -10, 1e-9));
    });

    test('full circle via two large-arc halves → 4 cubics, each ≤ 90°', () => {
        // First half: (10,0) → (-10,0) large-arc clockwise.
        const half1 = arcToCubics(10, 0, -10, 0, 10, 10, 0, true, true);
        // Second half: (-10,0) → (10,0) large-arc clockwise.
        const half2 = arcToCubics(-10, 0, 10, 0, 10, 10, 0, true, true);
        assert.equal(half1.length + half2.length, 4);
        // Full circle closure: first piece's start == last piece's end.
        assert.ok(approx(half1[0]!.fPts[0]!.fX,
                         half2[half2.length - 1]!.fPts[3]!.fX, 1e-9));
    });

    test('45° axis rotation — endpoints transform correctly', () => {
        // Non-rotated quarter arc: (10,0) → (0,10) on the standard
        // ellipse (rx=10, ry=10). Rotating the whole arc by 45° around
        // the origin maps endpoints to: (10,0) → R45 → (10/√2, 10/√2);
        //                              (0,10) → R45 → (-10/√2, 10/√2).
        const c = Math.cos(Math.PI / 4);
        const s = Math.sin(Math.PI / 4);
        const sx =  10 * c, sy = 10 * s;
        const ex = -10 * s, ey = 10 * c;
        const out = arcToCubics(sx, sy, ex, ey, 10, 10, 45, false, false);
        assert.equal(out.length, 1);
        const cubic = out[0]!;
        assert.ok(approx(cubic.fPts[0]!.fX, sx, 1e-9));
        assert.ok(approx(cubic.fPts[0]!.fY, sy, 1e-9));
        assert.ok(approx(cubic.fPts[3]!.fX, ex, 1e-9));
        assert.ok(approx(cubic.fPts[3]!.fY, ey, 1e-9));
    });
});

describe('arcToCubics — max-error sweep', () => {
    test('quarter-arc cubic approximation error stays below 5e-4 · radius', () => {
        // Circle radius 100 centered at the origin, quarter going
        // through (100/√2, 100/√2). Endpoints (100, 0) and (0, 100)
        // admit two centers — (0, 0) and (100, 100). To select the
        // origin-centered arc we need sweep=true (large !== sweep, so
        // sign = +1, putting the center on the opposite side). Sample
        // 16 t-values; each must lie within ~5e-4 · R of radius 100.
        const out = arcToCubics(100, 0, 0, 100, 100, 100, 0, false, true);
        assert.equal(out.length, 1);
        const c = out[0]!;
        const R = 100;
        let maxErr = 0;
        // Sample the cubic at t = 0, 1/15, …, 1. For each sample,
        // distance to nearest point on the true circle = ||(x,y)|| - R.
        for (let i = 0; i <= 15; ++i)
        {
            const t = i / 15;
            const [x, y] = evalCubic(
                c.fPts[0]!.fX, c.fPts[0]!.fY,
                c.fPts[1]!.fX, c.fPts[1]!.fY,
                c.fPts[2]!.fX, c.fPts[2]!.fY,
                c.fPts[3]!.fX, c.fPts[3]!.fY,
                t);
            const r = Math.sqrt(x * x + y * y);
            const err = Math.abs(r - R);
            if (err > maxErr) maxErr = err;
        }
        // The standard bound for κ ≈ (4/3) tan(θ/4) at θ = π/2 is
        // about 2.7e-4 · R. We assert a looser 5e-4 · R = 0.05 to
        // leave room for floating-point drift.
        assert.ok(maxErr < 0.05, `quarter-arc max error ${maxErr} ≥ 0.05`);
    });

    test('semicircle (2 pieces) error stays below 5e-4 · radius', () => {
        const out = arcToCubics(50, 0, -50, 0, 50, 50, 0, true, true);
        assert.equal(out.length, 2);
        const R = 50;
        let maxErr = 0;
        for (const c of out)
        {
            for (let i = 0; i <= 15; ++i)
            {
                const t = i / 15;
                const [x, y] = evalCubic(
                    c.fPts[0]!.fX, c.fPts[0]!.fY,
                    c.fPts[1]!.fX, c.fPts[1]!.fY,
                    c.fPts[2]!.fX, c.fPts[2]!.fY,
                    c.fPts[3]!.fX, c.fPts[3]!.fY,
                    t);
                const r = Math.sqrt(x * x + y * y);
                const err = Math.abs(r - R);
                if (err > maxErr) maxErr = err;
            }
        }
        assert.ok(maxErr < 0.025, `semicircle max error ${maxErr} ≥ 0.025`);
    });
});

describe('arcToCubics — sweep direction', () => {
    test('large-arc large-arc-flag = true forces ≥ 2 pieces', () => {
        // Any large-arc sweep |Δθ| > π/2 → at least 2 pieces.
        const out = arcToCubics(10, 0, -10, 0, 10, 10, 0, true, true);
        assert.ok(out.length >= 2);
    });

    test('sweep direction flips the side of the arc', () => {
        // Same endpoints, small-arc, opposite sweep flags — endpoints
        // pin in both cases, but the mid-point of the curve flips.
        const cw  = arcToCubics(10, 0, 0, 10, 10, 10, 0, false, true);
        const ccw = arcToCubics(10, 0, 0, 10, 10, 10, 0, false, false);
        assert.equal(cw.length,  1);
        assert.equal(ccw.length, 1);
        // Approximate mid-point at t = 0.5.
        const midCw  = evalCubic(cw[0]!.fPts[0]!.fX,  cw[0]!.fPts[0]!.fY,
                                  cw[0]!.fPts[1]!.fX,  cw[0]!.fPts[1]!.fY,
                                  cw[0]!.fPts[2]!.fX,  cw[0]!.fPts[2]!.fY,
                                  cw[0]!.fPts[3]!.fX,  cw[0]!.fPts[3]!.fY, 0.5);
        const midCcw = evalCubic(ccw[0]!.fPts[0]!.fX, ccw[0]!.fPts[0]!.fY,
                                  ccw[0]!.fPts[1]!.fX, ccw[0]!.fPts[1]!.fY,
                                  ccw[0]!.fPts[2]!.fX, ccw[0]!.fPts[2]!.fY,
                                  ccw[0]!.fPts[3]!.fX, ccw[0]!.fPts[3]!.fY, 0.5);
        // For a quarter-arc with (10,0)→(0,10) endpoints and equal
        // radii 10, the two possible mid-points are (10/√2, 10/√2)
        // (closer to the +x +y quadrant) and (-10/√2+10, -10/√2+10)
        // i.e. roughly (2.93, 2.93) — not equal.
        const dx = midCw[0] - midCcw[0];
        const dy = midCw[1] - midCcw[1];
        assert.ok(Math.sqrt(dx * dx + dy * dy) > 5,
            `mid-points too close: cw=${midCw}, ccw=${midCcw}`);
    });
});

describe('arcToCubics — out-of-range radii', () => {
    test('endpoints too far apart for given radii → radii scaled up, arc closes', () => {
        // rx=ry=5 can only reach 10 apart, but we ask for (10,0)→(-10,0)
        // which is 20 apart. Per § F.6.6.2 radii get scaled so the
        // ellipse just fits — arc becomes a half-circle at radius 10.
        const out = arcToCubics(10, 0, -10, 0, 5, 5, 0, false, true);
        assert.equal(out.length >= 1, true);
        // Endpoints pinned exactly after scaling.
        assert.ok(approx(out[0]!.fPts[0]!.fX,  10, 1e-9));
        assert.ok(approx(out[0]!.fPts[0]!.fY,   0, 1e-9));
        const last = out[out.length - 1]!;
        assert.ok(approx(last.fPts[3]!.fX, -10, 1e-9));
        assert.ok(approx(last.fPts[3]!.fY,   0, 1e-9));
    });
});
// keep TWO_PI referenced so unused-import lints don't complain
void TWO_PI;
