// Easing functions map a NORMALISED progress t ∈ [0, 1] to an
// eased-progress value f(t) ∈ [0, 1] (with f(0) = 0 and f(1) = 1).
// AnimationTimeline.Evaluate applies the easing AFTER normalising
// (elapsed - BeginTime) / Duration, so easings stay duration-agnostic.
//
// Curves follow the Penner / CSS naming convention. Quadratic / cubic
// In-Out forms use the standard piecewise definition so the boundary at
// t = 0.5 is C¹-continuous (matches CSS `ease-in-out`).
export type EasingFunction = (t: number) => number;

// Curve palette — frozen so consumers can't mutate the shared functions
// and break later animations. New easings can be added by callers as
// plain `(t) => …` arrows; the Easing field on a Timeline accepts any
// function matching the signature.
export const Easings = {
    /** No easing — linear interpolation between From and To. */
    Linear:      (t: number): number => t,

    // Quadratic family.
    QuadIn:      (t: number): number => t * t,
    QuadOut:     (t: number): number => 1 - (1 - t) * (1 - t),
    QuadInOut:   (t: number): number =>
        t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t),

    // Cubic family — CSS `ease-in` / `ease-out` / `ease-in-out` parity.
    CubicIn:     (t: number): number => t * t * t,
    CubicOut:    (t: number): number => 1 - Math.pow(1 - t, 3),
    CubicInOut:  (t: number): number =>
        t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,

    // ── M3 motion curves (https://m3.material.io/styles/motion/easing-and-duration/tokens-specs)
    // Authored as cubic-beziers via the same machinery as the Linear /
    // Quad / Cubic families above. Each curve is materialised once at
    // module load (the cubicBezier closure caches its precomputed
    // polynomial coefficients) so theme tokens can reference them
    // without per-frame allocations.
    Standard:             cubicBezier(0.2,  0,    0,    1   ),
    StandardAccelerate:   cubicBezier(0.3,  0,    1,    1   ),
    StandardDecelerate:   cubicBezier(0,    0,    0,    1   ),
    Emphasized:           cubicBezier(0.2,  0,    0,    1   ),
    EmphasizedAccelerate: cubicBezier(0.3,  0,    0.8,  0.15),
    EmphasizedDecelerate: cubicBezier(0.05, 0.7,  0.1,  1   ),
    // Symmetrical in-out curve for looping/reversible motion
    // (Pragmatic design system's easing-inout).
    Inout:                cubicBezier(0.4,  0,    0.2,  1   ),
} as const;

// Build a CSS-style cubic-bezier easing from two interior control points.
// The endpoints are anchored at (0, 0) and (1, 1); (x1, y1) and (x2, y2)
// shape the curve in between. Same control-point convention as CSS
// `cubic-bezier(x1, y1, x2, y2)` and WPF KeySpline.
//
// Given normalised time progress t ∈ [0, 1], the curve is parameterised
// by a scalar s ∈ [0, 1]:
//   x(s) = 3(1-s)²s·x1 + 3(1-s)s²·x2 + s³
//   y(s) = 3(1-s)²s·y1 + 3(1-s)s²·y2 + s³
// We need to find s such that x(s) = t, then return y(s). x(s) is
// monotonic when x1 and x2 ∈ [0, 1] (the CSS-standard range), so
// Newton's method converges quickly with a bisection fallback for the
// near-zero-derivative case.
//
// CSS-equivalent presets:
//   cubicBezier(0.25, 0.1, 0.25, 1)   // 'ease'
//   cubicBezier(0.42, 0, 1, 1)         // 'ease-in'
//   cubicBezier(0, 0, 0.58, 1)         // 'ease-out'
//   cubicBezier(0.42, 0, 0.58, 1)      // 'ease-in-out'
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFunction
{
    // Per-coefficient closed-form expansion of the bezier polynomial.
    // Precomputing these saves three multiplies per Newton iteration.
    const ax = 1 - 3 * x2 + 3 * x1;
    const bx = 3 * x2 - 6 * x1;
    const cx = 3 * x1;
    const ay = 1 - 3 * y2 + 3 * y1;
    const by = 3 * y2 - 6 * y1;
    const cy = 3 * y1;

    const sampleX = (s: number): number => ((ax * s + bx) * s + cx) * s;
    const sampleY = (s: number): number => ((ay * s + by) * s + cy) * s;
    const sampleDxDs = (s: number): number => (3 * ax * s + 2 * bx) * s + cx;

    return (t: number): number => {
        if (t <= 0) return 0;
        if (t >= 1) return 1;
        // Newton-Raphson converges very fast for control points away
        // from the boundaries; 8 iterations is enough for sub-pixel
        // accuracy at 60 fps. Fall back to bisection if the slope is
        // ~zero (control points pinned to an axis).
        let s = t;
        for (let i = 0; i < 8; i++)
        {
            const x = sampleX(s) - t;
            const dx = sampleDxDs(s);
            if (Math.abs(dx) < 1e-6) break;
            s = s - x / dx;
        }
        // Bisection cleanup — pulls s back into a numerically safe range
        // if Newton overshot under a flat slope.
        if (s < 0 || s > 1)
        {
            let lo = 0;
            let hi = 1;
            s = t;
            for (let i = 0; i < 24; i++)
            {
                const xs = sampleX(s);
                if (Math.abs(xs - t) < 1e-7) break;
                if (xs < t) lo = s; else hi = s;
                s = (lo + hi) / 2;
            }
        }
        return sampleY(s);
    };
}
