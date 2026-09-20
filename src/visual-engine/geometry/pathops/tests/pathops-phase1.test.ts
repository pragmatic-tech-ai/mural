import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    // types
    SK_FLOAT_EPSILON,
    SK_DOUBLE_EPSILON,
    FLT_EPSILON_DOUBLE,
    ROUGH_EPSILON,
    AlmostEqualUlps,
    AlmostBequalUlps,
    AlmostDequalUlps,
    RoughlyEqualUlps,
    UlpsDistance,
    SkFloatAs2sCompliment,
    floatToInt32Bits,
    approximately_zero,
    approximately_equal,
    precisely_zero,
    between,
    Interp,
    Sign,
    SkPinT,
    // point/vector
    Point,
    Vector,
    // rect
    Rect,
    // line
    Line,
    // quad
    Quad,
    QuadPair,
    // cubic
    Cubic,
    CubicPair,
    other_two,
} from '../index.js';

// =============================================================================
// types
// =============================================================================

describe('pathops/types — epsilon constants', () => {
    test('SK_FLOAT_EPSILON matches FLT_EPSILON to bit-exact', () => {
        // 2^-23 = 1.1920928955078125e-7
        assert.equal(SK_FLOAT_EPSILON, 2 ** -23);
    });

    test('SK_DOUBLE_EPSILON matches DBL_EPSILON', () => {
        assert.equal(SK_DOUBLE_EPSILON, 2 ** -52);
    });

    test('FLT_EPSILON_DOUBLE = FLT_EPSILON * 2', () => {
        assert.equal(FLT_EPSILON_DOUBLE, SK_FLOAT_EPSILON * 2);
    });

    test('ROUGH_EPSILON = FLT_EPSILON * 64', () => {
        assert.equal(ROUGH_EPSILON, SK_FLOAT_EPSILON * 64);
    });
});

describe('pathops/types — float bit shim', () => {
    test('floatToInt32Bits round-trips zero to 0', () => {
        assert.equal(floatToInt32Bits(0), 0);
    });

    test('floatToInt32Bits returns positive int for positive floats', () => {
        // 1.0 in IEEE-754 single precision = 0x3F800000
        assert.equal(floatToInt32Bits(1), 0x3F800000);
    });

    test('floatToInt32Bits returns negative int for negative floats', () => {
        // -1.0 in IEEE-754 single precision = 0xBF800000 (= -1.082e9 as int32)
        assert.ok(floatToInt32Bits(-1) < 0);
    });

    test('SkFloatAs2sCompliment(+1) === bit pattern of 1', () => {
        assert.equal(SkFloatAs2sCompliment(1), 0x3F800000);
    });

    test('SkFloatAs2sCompliment is sortable across the sign boundary', () => {
        // The whole point of the 2s-compliment trick: negative values
        // come out as small (more-negative) integers, positives as
        // larger ones, so int32 comparison matches float magnitude
        // ordering.
        assert.ok(SkFloatAs2sCompliment(-1) < SkFloatAs2sCompliment(0));
        assert.ok(SkFloatAs2sCompliment(0)  < SkFloatAs2sCompliment(1));
        assert.ok(SkFloatAs2sCompliment(-2) < SkFloatAs2sCompliment(-1));
    });
});

describe('pathops/types — ULPS comparators', () => {
    test('AlmostEqualUlps treats identical floats as equal', () => {
        assert.equal(AlmostEqualUlps(1.5, 1.5), true);
    });

    test('AlmostEqualUlps treats one-bit-apart floats as equal (within 16 ULP)', () => {
        const next = 1 + SK_FLOAT_EPSILON;
        assert.equal(AlmostEqualUlps(1, next), true);
    });

    test('AlmostEqualUlps rejects large differences', () => {
        assert.equal(AlmostEqualUlps(1, 2), false);
    });

    test('AlmostBequalUlps is stricter (2 ULP) than AlmostEqualUlps (16 ULP)', () => {
        // Within ~10 ULP — AlmostEqualUlps passes, AlmostBequalUlps fails.
        const ten = SK_FLOAT_EPSILON * 10;
        assert.equal(AlmostEqualUlps(1, 1 + ten), true);
        assert.equal(AlmostBequalUlps(1, 1 + ten), false);
    });

    test('AlmostDequalUlps handles large-magnitude inputs via relative error', () => {
        // Two large finite values within 16 ULP of each other
        const big = 1e30;
        assert.equal(AlmostDequalUlps(big, big), true);
        assert.equal(AlmostDequalUlps(big, big * 1.001), false);
    });

    test('RoughlyEqualUlps tolerates much larger drift', () => {
        const oneHundred = SK_FLOAT_EPSILON * 100;
        assert.equal(AlmostEqualUlps(1, 1 + oneHundred), false);
        assert.equal(RoughlyEqualUlps(1, 1 + oneHundred), true);
    });

    test('UlpsDistance(x, x) === 0', () => {
        assert.equal(UlpsDistance(2.5, 2.5), 0);
    });

    test('UlpsDistance(+0, -0) === 0 (sign-equality short-circuit)', () => {
        assert.equal(UlpsDistance(0, -0), 0);
    });

    test('UlpsDistance returns SK_MaxS32 across sign boundary when not equal', () => {
        assert.equal(UlpsDistance(-1, 1), 0x7FFFFFFF);
    });
});

describe('pathops/types — approximately_* predicates', () => {
    test('approximately_zero — within FLT_EPSILON', () => {
        assert.equal(approximately_zero(0), true);
        assert.equal(approximately_zero(SK_FLOAT_EPSILON / 2), true);
        assert.equal(approximately_zero(SK_FLOAT_EPSILON * 2), false);
    });

    test('precisely_zero — much stricter (≈ 4·DBL_EPSILON)', () => {
        assert.equal(precisely_zero(SK_FLOAT_EPSILON / 2), false);
        assert.equal(precisely_zero(SK_DOUBLE_EPSILON), true);
    });

    test('approximately_equal — symmetric around the input', () => {
        assert.equal(approximately_equal(0.5, 0.5 + SK_FLOAT_EPSILON / 2), true);
        assert.equal(approximately_equal(0.5, 0.6), false);
    });

    test('between(a, b, c) — true when b lies between a and c (either direction)', () => {
        assert.equal(between(0, 0.5, 1), true);
        assert.equal(between(1, 0.5, 0), true);   // reversed order
        assert.equal(between(0, 1.5, 1), false);  // b past c
        assert.equal(between(0, 0, 1), true);     // edge inclusive
        assert.equal(between(0, 1, 1), true);     // edge inclusive
    });
});

describe('pathops/types — miscellaneous helpers', () => {
    test('Interp lerps A→B', () => {
        assert.equal(Interp(10, 20, 0),    10);
        assert.equal(Interp(10, 20, 1),    20);
        assert.equal(Interp(10, 20, 0.5), 15);
    });

    test('Sign returns -1 / 0 / 1', () => {
        assert.equal(Sign( 3.5),  1);
        assert.equal(Sign( 0),    0);
        assert.equal(Sign(-2.0), -1);
    });

    test('SkPinT clamps into [0, 1] using DBL_EPSILON_ERR slack', () => {
        assert.equal(SkPinT(-SK_DOUBLE_EPSILON), 0);
        assert.equal(SkPinT(1 + SK_DOUBLE_EPSILON), 1);
        assert.equal(SkPinT(0.5), 0.5);
    });
});

// =============================================================================
// Point / Vector — ports the cases from PathOpsDPointTest.cpp.
// =============================================================================

describe('pathops/point — Point construction & equality', () => {
    test('default constructor zeros fields', () => {
        const p = new Point();
        assert.equal(p.fX, 0);
        assert.equal(p.fY, 0);
    });

    test('exact equality via .equals (Skia operator==)', () => {
        const p = new Point(1, 2);
        const q = new Point(1, 2);
        const r = new Point(1, 2.0000001);
        assert.equal(p.equals(q), true);
        assert.equal(p.equals(r), false);
    });

    test('p.sub(q) returns Vector — Skia operator-', () => {
        const p = new Point(5, 3);
        const q = new Point(2, 1);
        const v = p.sub(q);
        assert.equal(v.fX, 3);
        assert.equal(v.fY, 2);
        assert.ok(v instanceof Vector);
    });

    test('round-trip add then sub recovers the original', () => {
        const samples: [number, number][] = [[0, 0], [1, 0], [0, 1], [2, 1], [1, 2], [1, 1], [2, 2]];
        for (const [x, y] of samples)
        {
            const orig = new Point(x, y);
            const p = new Point(x, y);
            const v = p.sub(orig);
            p.addEq(v);
            assert.ok(p.equals(orig));
            p.subEq(v);
            assert.ok(p.equals(orig));
        }
    });

    test('distanceSquared = fX² + fY²', () => {
        const pt = new Point(3, 4);
        const zero = new Point();
        assert.equal(pt.distanceSquared(zero), 25);
        assert.equal(pt.distance(zero), 5);
    });

    test('approximatelyZero true at origin', () => {
        const p = new Point();
        assert.equal(p.approximatelyZero(), true);
        const q = new Point(1, 0);
        assert.equal(q.approximatelyZero(), false);
    });

    test('Point.Mid is the midpoint', () => {
        const m = Point.Mid(new Point(0, 0), new Point(4, 6));
        assert.equal(m.fX, 2);
        assert.equal(m.fY, 3);
    });

    test('Point.ApproximatelyEqual handles tiny offsets', () => {
        const a = new Point(1.0, 1.0);
        const b = new Point(1.0 + SK_FLOAT_EPSILON / 2, 1.0);
        assert.equal(Point.ApproximatelyEqual(a, b), true);
    });
});

describe('pathops/point — Vector arithmetic', () => {
    test('dot product', () => {
        const v = new Vector(2, 3);
        const w = new Vector(4, 5);
        assert.equal(v.dot(w), 8 + 15);
    });

    test('cross product (2D z-component)', () => {
        const v = new Vector(1, 0);
        const w = new Vector(0, 1);
        assert.equal(v.cross(w),  1);
        assert.equal(w.cross(v), -1);
    });

    test('crossCheck zeros out partial-product noise within 16 ULP', () => {
        // Coincident vectors: exact cross = 0, but finite precision
        // may produce a tiny non-zero value. crossCheck snaps it to 0.
        const v = new Vector(1.0000001, 2.0000002);
        const w = new Vector(2.0000002, 4.0000004);
        // These are 1:2 ratio with relative-precision differences;
        // exact cross = 0; crossCheck should report 0.
        assert.equal(v.crossCheck(w), 0);
    });

    test('length / lengthSquared', () => {
        const v = new Vector(3, 4);
        assert.equal(v.lengthSquared(), 25);
        assert.equal(v.length(), 5);
    });

    test('normalize sets unit length', () => {
        const v = new Vector(3, 4);
        v.normalize();
        assert.ok(Math.abs(v.length() - 1) < 1e-15);
    });
});

// =============================================================================
// Rect
// =============================================================================

describe('pathops/rect — Rect basics', () => {
    test('set + add expand around a seed', () => {
        const r = new Rect();
        r.set(new Point(5, 5));
        r.add(new Point(10, 8));
        r.add(new Point(2, 3));
        assert.equal(r.fLeft,   2);
        assert.equal(r.fRight, 10);
        assert.equal(r.fTop,    3);
        assert.equal(r.fBottom, 8);
    });

    test('width / height', () => {
        const r = new Rect(0, 0, 10, 5);
        assert.equal(r.width(),  10);
        assert.equal(r.height(),  5);
    });

    test('contains uses approximately_between (slack at edges)', () => {
        const r = new Rect(0, 0, 10, 10);
        assert.equal(r.contains(new Point(5, 5)),   true);
        assert.equal(r.contains(new Point(0, 0)),   true);   // edge inclusive
        assert.equal(r.contains(new Point(10, 10)), true);
        assert.equal(r.contains(new Point(11, 5)),  false);
    });

    test('intersects with overlapping rects', () => {
        const a = new Rect(0, 0, 10, 10);
        const b = new Rect(5, 5, 15, 15);
        const c = new Rect(20, 20, 30, 30);
        assert.equal(a.intersects(b), true);
        assert.equal(a.intersects(c), false);
    });

    test('valid catches inverted rects', () => {
        assert.equal(new Rect(0, 0, 10, 10).valid(), true);
        assert.equal(new Rect(10, 0, 0, 10).valid(), false);
    });
});

// =============================================================================
// Line
// =============================================================================

describe('pathops/line — Line', () => {
    test('ptAtT(0) and ptAtT(1) return exact endpoints', () => {
        const line = new Line(new Point(2, 3), new Point(8, 7));
        assert.ok(line.ptAtT(0).equals(new Point(2, 3)));
        assert.ok(line.ptAtT(1).equals(new Point(8, 7)));
    });

    test('ptAtT(0.5) is the midpoint', () => {
        const line = new Line(new Point(0, 0), new Point(10, 20));
        const mid = line.ptAtT(0.5);
        assert.equal(mid.fX, 5);
        assert.equal(mid.fY, 10);
    });

    test('exactPoint returns 0/1 at endpoints, -1 elsewhere', () => {
        const line = new Line(new Point(0, 0), new Point(10, 0));
        assert.equal(line.exactPoint(new Point(0, 0)),  0);
        assert.equal(line.exactPoint(new Point(10, 0)), 1);
        assert.equal(line.exactPoint(new Point(5, 0)), -1);
    });

    test('nearPoint reports t on the projected line within tolerance', () => {
        const line = new Line(new Point(0, 0), new Point(10, 0));
        const result = line.nearPoint(new Point(5, 0));
        assert.ok(Math.abs(result.t - 0.5) < 1e-10);
    });

    test('nearPoint returns -1 when point is far from segment', () => {
        const line = new Line(new Point(0, 0), new Point(10, 0));
        const result = line.nearPoint(new Point(5, 50));
        assert.equal(result.t, -1);
    });

    test('ExactPointH static — point on a horizontal line at endpoints', () => {
        assert.equal(Line.ExactPointH(new Point(0, 5),  0, 10, 5),  0);
        assert.equal(Line.ExactPointH(new Point(10, 5), 0, 10, 5),  1);
        assert.equal(Line.ExactPointH(new Point(5, 5),  0, 10, 5), -1);
    });
});

// =============================================================================
// Quad
// =============================================================================

describe('pathops/quad — Quad evaluation', () => {
    test('ptAtT(0) and ptAtT(1) return exact endpoints', () => {
        const q = new Quad(
            new Point(0, 0), new Point(50, 100), new Point(100, 0),
        );
        assert.ok(q.ptAtT(0).equals(new Point(0, 0)));
        assert.ok(q.ptAtT(1).equals(new Point(100, 0)));
    });

    test('ptAtT(0.5) — symmetric arch yields y = control / 2', () => {
        // Bernstein: B(0.5) = (P0 + 2*P1 + P2) / 4
        const q = new Quad(
            new Point(0, 0), new Point(50, 100), new Point(100, 0),
        );
        const mid = q.ptAtT(0.5);
        assert.equal(mid.fX, 50);
        assert.equal(mid.fY, 50);
    });

    test('monotonicInX false for non-monotonic control polygon', () => {
        const q = new Quad(
            new Point(0, 0), new Point(100, 50), new Point(50, 100),
        );
        assert.equal(q.monotonicInX(), false);
        assert.equal(q.monotonicInY(), true);
    });

    test('FindExtrema finds the t where x-derivative is 0', () => {
        // x(t) = (1-t)²·0 + 2(1-t)t·100 + t²·0 → maximum at t = 0.5
        const tVals: [number] = [0];
        const n = Quad.FindExtrema(0, 100, 0, tVals);
        assert.equal(n, 1);
        assert.ok(Math.abs(tVals[0] - 0.5) < 1e-12);
    });

    test('FindExtrema returns 0 for monotonic input', () => {
        const tVals: [number] = [0];
        const n = Quad.FindExtrema(0, 50, 100, tVals);
        assert.equal(n, 0);
    });

    test('RootsReal solves ax² + bx + c = 0', () => {
        // x² - 5x + 6 = 0 → roots 2, 3
        const roots: [number, number] = [0, 0];
        const n = Quad.RootsReal(1, -5, 6, roots);
        assert.equal(n, 2);
        const sorted = [roots[0], roots[1]].sort((a, b) => a - b);
        assert.ok(Math.abs(sorted[0]! - 2) < 1e-10);
        assert.ok(Math.abs(sorted[1]! - 3) < 1e-10);
    });

    test('RootsReal returns 0 for negative discriminant', () => {
        // x² + 1 = 0 → no real roots
        const roots: [number, number] = [0, 0];
        const n = Quad.RootsReal(1, 0, 1, roots);
        assert.equal(n, 0);
    });

    test('subDivide(0, 1) returns this curve unchanged', () => {
        const q = new Quad(
            new Point(0, 0), new Point(50, 100), new Point(100, 0),
        );
        const sub = q.subDivide(0, 1);
        assert.ok(sub.fPts[0].equals(q.fPts[0]));
        assert.ok(sub.fPts[2].equals(q.fPts[2]));
    });

    test('chopAt(0.5) — first half endpoint matches ptAtT(0.5)', () => {
        const q = new Quad(
            new Point(0, 0), new Point(50, 100), new Point(100, 0),
        );
        const pair = q.chopAt(0.5);
        const mid = q.ptAtT(0.5);
        assert.ok(Math.abs(pair.pts[2].fX - mid.fX) < 1e-10);
        assert.ok(Math.abs(pair.pts[2].fY - mid.fY) < 1e-10);
        assert.ok(pair instanceof QuadPair);
    });

    test('boundingRect of symmetric arch covers expected extents', () => {
        const q = new Quad(
            new Point(0, 0), new Point(50, 100), new Point(100, 0),
        );
        const r = q.boundingRect();
        assert.equal(r.fLeft,   0);
        assert.equal(r.fRight, 100);
        assert.equal(r.fTop,    0);
        // y-max is the curve's apex at t=0.5: (P0+2P1+P2)/4 = (0+200+0)/4 = 50
        assert.equal(r.fBottom, 50);
    });
});

// =============================================================================
// Cubic
// =============================================================================

describe('pathops/cubic — Cubic evaluation', () => {
    test('ptAtT(0) and ptAtT(1) return exact endpoints', () => {
        const c = new Cubic(
            new Point(0, 0), new Point(30, 100), new Point(70, 100), new Point(100, 0),
        );
        assert.ok(c.ptAtT(0).equals(new Point(0, 0)));
        assert.ok(c.ptAtT(1).equals(new Point(100, 0)));
    });

    test('symmetric cubic — midpoint is centered horizontally', () => {
        const c = new Cubic(
            new Point(0, 0), new Point(30, 100), new Point(70, 100), new Point(100, 0),
        );
        const mid = c.ptAtT(0.5);
        assert.equal(mid.fX, 50);
        // peak Y at t=0.5: (0 + 3·100 + 3·100 + 0)/8 = 75
        assert.equal(mid.fY, 75);
    });

    test('monotonicInX — both controls between endpoints', () => {
        // Skia's monotonicInX is a CONTROL POLYGON test: each
        // control's X must lie between P0.X and P3.X. A straight
        // rising chord with controls inside qualifies.
        const c = new Cubic(
            new Point(0, 0), new Point(30, 50), new Point(70, 50), new Point(100, 0),
        );
        assert.equal(c.monotonicInX(), true);
    });

    test('monotonicInX false when a control X overshoots the chord', () => {
        // P1.X = 150 > P3.X = 100 → not between(0, 150, 100).
        const c = new Cubic(
            new Point(0, 0), new Point(150, 50), new Point(70, 50), new Point(100, 0),
        );
        assert.equal(c.monotonicInX(), false);
    });

    test('FindExtrema finds derivative-zero crossings of cubic', () => {
        // Symmetric arch — single extremum at t=0.5 in Y.
        const tVals: number[] = [];
        const n = Cubic.FindExtrema(0, 100, 100, 0, tVals);
        assert.equal(n, 1);
        assert.ok(Math.abs(tVals[0]! - 0.5) < 1e-12);
    });

    test('RootsReal — known integer roots', () => {
        // (x-1)(x-2)(x-3) = x³ - 6x² + 11x - 6
        const roots: [number, number, number] = [0, 0, 0];
        const n = Cubic.RootsReal(1, -6, 11, -6, roots);
        assert.equal(n, 3);
        const sorted = [...roots].sort((a, b) => a - b);
        assert.ok(Math.abs(sorted[0]! - 1) < 1e-9);
        assert.ok(Math.abs(sorted[1]! - 2) < 1e-9);
        assert.ok(Math.abs(sorted[2]! - 3) < 1e-9);
    });

    test('RootsReal — one real root path', () => {
        // x³ + 1 = 0 → root -1 (only real root)
        const roots: [number, number, number] = [0, 0, 0];
        const n = Cubic.RootsReal(1, 0, 0, 1, roots);
        assert.equal(n, 1);
        assert.ok(Math.abs(roots[0] - -1) < 1e-9);
    });

    test('RootsValidT clips to [0, 1]', () => {
        // x³ - 6x² + 11x - 6 has roots {1, 2, 3} — only 1 is in [0,1]
        const t: number[] = [];
        const n = Cubic.RootsValidT(1, -6, 11, -6, t);
        // The 1 boundary should be accepted via the snap-to-1 branch.
        assert.equal(n, 1);
        assert.ok(Math.abs(t[0]! - 1) < 1e-9);
    });

    test('chopAt(0.5) — both halves shared midpoint matches ptAtT(0.5)', () => {
        const c = new Cubic(
            new Point(0, 0), new Point(30, 100), new Point(70, 100), new Point(100, 0),
        );
        const pair = c.chopAt(0.5);
        const mid = c.ptAtT(0.5);
        assert.ok(Math.abs(pair.pts[3].fX - mid.fX) < 1e-10);
        assert.ok(Math.abs(pair.pts[3].fY - mid.fY) < 1e-10);
        assert.ok(pair instanceof CubicPair);
    });

    test('subDivide(0.25, 0.75) endpoints match ptAtT at those parameters', () => {
        const c = new Cubic(
            new Point(0, 0), new Point(30, 100), new Point(70, 100), new Point(100, 0),
        );
        const sub = c.subDivide(0.25, 0.75);
        const start = c.ptAtT(0.25);
        const end   = c.ptAtT(0.75);
        assert.ok(Math.abs(sub.fPts[0].fX - start.fX) < 1e-10);
        assert.ok(Math.abs(sub.fPts[0].fY - start.fY) < 1e-10);
        assert.ok(Math.abs(sub.fPts[3].fX - end.fX) < 1e-10);
        assert.ok(Math.abs(sub.fPts[3].fY - end.fY) < 1e-10);
    });

    test('boundingRect of symmetric arch covers expected extents', () => {
        const c = new Cubic(
            new Point(0, 0), new Point(30, 100), new Point(70, 100), new Point(100, 0),
        );
        const r = c.boundingRect();
        assert.equal(r.fLeft,    0);
        assert.equal(r.fRight, 100);
        assert.equal(r.fTop,     0);
        assert.equal(r.fBottom, 75);
    });

    test('findInflections — S-shape cubic has one inflection', () => {
        // S-curve: P0=(0,0), P1=(100,0), P2=(0,100), P3=(100,100)
        const c = new Cubic(
            new Point(0, 0), new Point(100, 0), new Point(0, 100), new Point(100, 100),
        );
        const t: number[] = [];
        const n = c.findInflections(t);
        // The control polygon crosses itself once → at least one inflection.
        assert.ok(n >= 1);
        for (let i = 0; i < n; ++i)
        {
            assert.ok(t[i]! > 0 && t[i]! < 1);
        }
    });

    test('convexHull of an arched cubic returns 4 points', () => {
        const c = new Cubic(
            new Point(0, 0), new Point(30, 100), new Point(70, 100), new Point(100, 0),
        );
        const order: number[] = [0, 0, 0, 0];
        const n = c.convexHull(order);
        assert.equal(n, 4);
    });

    test('other_two helper — XOR table from SkPathOpsCubic.h:156', () => {
        // From the proof table:
        //  (0,3) → 2,   (1,2) → 2
        //  (0,1) → 3,   (0,2) → 3,   (1,3) → 3,   (2,3) → 3
        assert.equal(other_two(0, 3), 2);
        assert.equal(other_two(1, 2), 2);
        assert.equal(other_two(0, 1), 3);
        assert.equal(other_two(0, 2), 3);
        assert.equal(other_two(1, 3), 3);
        assert.equal(other_two(2, 3), 3);
    });

    test('Coefficients — Bernstein basis P0..P3 → power-basis A..D', () => {
        // Bezier B(t) = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3
        // Power     = At³ + Bt² + Ct + D
        // With P0=0, P1=1, P2=2, P3=3 (linear in t):  B(t) = 3t = 0t³ + 0t² + 3t + 0
        const co = Cubic.Coefficients(0, 1, 2, 3);
        assert.ok(Math.abs(co.A) < 1e-12);
        assert.ok(Math.abs(co.B) < 1e-12);
        assert.ok(Math.abs(co.C - 3) < 1e-12);
        assert.ok(Math.abs(co.D) < 1e-12);
    });
});
