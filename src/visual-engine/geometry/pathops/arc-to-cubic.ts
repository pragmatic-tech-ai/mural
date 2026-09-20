// TypeScript port: 2026 Eugene Napryaglo.
//
// Endpoint-parameterized SVG elliptical arc → chain of cubic Bezier
// curves. Bridges the model-layer `ArcSegment` (SVG-flavored — rx, ry,
// φ, large-arc, sweep) to the pathops kernel which speaks only line /
// quad / cubic verbs.
//
// References:
//   * SVG 1.1 § F.6.5 endpoint-to-center parameterization
//   * SVG 1.1 § F.6.6 out-of-range radii correction
//   * The κ ≈ (4/3) tan(θ/4) cubic-Bezier-approximation formula,
//     Stanislaw Adaszewski et al. The variant used here (with the
//     radical) is the closed-form solution that makes P1, P2 lie on
//     the tangent lines at P0, P3 — keeps the cubic tangent-continuous
//     across split joins.
//
// Algorithm:
//   1. Endpoint-to-center: solve for (cx, cy) + start/sweep angles
//      θ1, Δθ in the primed (axis-aligned, unit-radius) frame.
//   2. Subdivide [θ1, θ1+Δθ] into pieces of size ≤ π/2 — anything
//      larger and the cubic approximation's max error exceeds the
//      ~5e-4 bound the literature documents.
//   3. Per piece, build a unit-circle arc cubic, then map back to the
//      ellipse via scale-by-(rx, ry) → rotate-by-φ → translate-by-
//      (cx, cy).
//
// Degenerate cases (start ≡ end OR rx == 0 OR ry == 0) return an
// empty array. The caller (figure walker) emits a line from start to
// end in those cases.

import { Point } from './point.js';
import { Cubic } from './cubic.js';

const PI = Math.PI;
const TWO_PI = 2 * PI;
const HALF_PI = PI / 2;

// Vector angle between two unit-ish 2D vectors. Returns a signed
// radian value: positive when v lies counterclockwise of u. Used by
// the endpoint→center step to compute θ1 and Δθ.
function vectorAngle(ux: number, uy: number, vx: number, vy: number): number
{
    const sign = (ux * vy - uy * vx) < 0 ? -1 : 1;
    const dotN = (ux * vx + uy * vy)
               / (Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy));
    return sign * Math.acos(Math.max(-1, Math.min(1, dotN)));
}

// One unit-circle arc piece from angle a → b (in radians) approximated
// by a single cubic Bezier. Returns the four control points in unit-
// circle space; the caller scales / rotates / translates them into
// the arc's destination frame.
//
// α derivation:
//   P0 = (cos a, sin a),  P3 = (cos b, sin b)
//   tangents at P0, P3 are perpendicular to the radial directions;
//   P1 = P0 + α · tangent(a),  P2 = P3 − α · tangent(b).
//   The closed-form α = (4/3) · tan(Δ/4) puts B(0.5) exactly on the
//   unit circle (mid-point pinning) — the canonical Bezier-arc
//   approximation. For Δ ≤ 90° the max radial error is ~2.7e-4 · R,
//   which is why we cap pieces at 90°.
function unitArcCubic(a: number, b: number): readonly [number, number, number, number, number, number, number, number]
{
    const cosA = Math.cos(a), sinA = Math.sin(a);
    const cosB = Math.cos(b), sinB = Math.sin(b);
    const alpha = (4 / 3) * Math.tan((b - a) / 4);
    return [
        cosA,                  sinA,
        cosA - alpha * sinA,   sinA + alpha * cosA,
        cosB + alpha * sinB,   sinB - alpha * cosB,
        cosB,                  sinB,
    ];
}

// arcToCubics: convert an SVG-style endpoint-parameterized elliptical
// arc into a chain of cubics. `xAxisRotationDeg` is in degrees per the
// SVG spec; `sweepClockwise` maps to SVG's sweep-flag = 1 (the arc
// traverses positive Δθ in user space; on screen with y-down, this
// appears clockwise).
export function arcToCubics(
    startX: number, startY: number,
    endX: number,   endY: number,
    rx: number,     ry: number,
    xAxisRotationDeg: number,
    largeArc: boolean,
    sweepClockwise: boolean): Cubic[]
{
    if (startX === endX && startY === endY) return [];
    // SVG § F.6.6.1 — out-of-range radii: 0 collapses to a line.
    if (rx === 0 || ry === 0) return [];

    rx = Math.abs(rx);
    ry = Math.abs(ry);

    const phi    = xAxisRotationDeg * PI / 180;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);

    // Step 1 (F.6.5.1): compute (x1', y1') in primed frame.
    const dx2 = (startX - endX) / 2;
    const dy2 = (startY - endY) / 2;
    const x1p =  cosPhi * dx2 + sinPhi * dy2;
    const y1p = -sinPhi * dx2 + cosPhi * dy2;

    // Step 2 (F.6.6.2): radii correction.
    let rxSq = rx * rx;
    let rySq = ry * ry;
    const x1pSq = x1p * x1p;
    const y1pSq = y1p * y1p;
    const lambda = x1pSq / rxSq + y1pSq / rySq;
    if (lambda > 1)
    {
        const sqrtL = Math.sqrt(lambda);
        rx   *= sqrtL;
        ry   *= sqrtL;
        rxSq  = rx * rx;
        rySq  = ry * ry;
    }

    // Step 3 (F.6.5.2): center in primed frame.
    const sign = (largeArc === sweepClockwise) ? -1 : 1;
    let radicand = (rxSq * rySq - rxSq * y1pSq - rySq * x1pSq)
                 / (rxSq * y1pSq + rySq * x1pSq);
    if (radicand < 0) radicand = 0;     // guard against fp noise
    const coef = sign * Math.sqrt(radicand);
    const cxp =  coef * (rx * y1p) / ry;
    const cyp = -coef * (ry * x1p) / rx;

    // Step 4 (F.6.5.3): de-prime the center.
    const cx = cosPhi * cxp - sinPhi * cyp + (startX + endX) / 2;
    const cy = sinPhi * cxp + cosPhi * cyp + (startY + endY) / 2;

    // Step 5 (F.6.5.4): θ1 and Δθ in the unit-circle (primed,
    // unit-radius) frame.
    const ux = (x1p - cxp) / rx;
    const uy = (y1p - cyp) / ry;
    const vx = (-x1p - cxp) / rx;
    const vy = (-y1p - cyp) / ry;
    const theta1 = vectorAngle(1, 0, ux, uy);
    let   delta  = vectorAngle(ux, uy, vx, vy);
    if (!sweepClockwise && delta > 0) delta -= TWO_PI;
    if ( sweepClockwise && delta < 0) delta += TWO_PI;

    // Step 6: split into pieces ≤ π/2 and emit one cubic per piece.
    // ε tolerance below absorbs the floating-point drift that pushes
    // exact π/2 sweeps to 1.0000000001 — without it φ-rotated quarter
    // arcs would spuriously split into 2 cubics.
    const pieceCount = Math.max(1, Math.ceil(Math.abs(delta) / HALF_PI - 1e-9));
    const step       = delta / pieceCount;
    const out: Cubic[] = [];
    for (let i = 0; i < pieceCount; ++i)
    {
        const a = theta1 + i * step;
        const b = theta1 + (i + 1) * step;
        const u = unitArcCubic(a, b);
        // Map unit-circle control points back to ellipse space.
        const pts: Point[] = [];
        for (let k = 0; k < 4; ++k)
        {
            const ux = u[k * 2]!;
            const uy = u[k * 2 + 1]!;
            const xRot = rx * ux;
            const yRot = ry * uy;
            const x    = cosPhi * xRot - sinPhi * yRot + cx;
            const y    = sinPhi * xRot + cosPhi * yRot + cy;
            pts.push(new Point(x, y));
        }
        out.push(new Cubic(pts[0]!, pts[1]!, pts[2]!, pts[3]!));
    }
    return out;
}
