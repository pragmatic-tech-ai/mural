// Step 3 / § 9 of [docs/connectors.md](../../../../docs/connectors.md):
// pins the BezierRouter's compute() control-point math + tangentAt()
// across the 4×4 side combinations and waypoint-spline cases.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    CubicBezierSegment,
    PathGeometry,
    Point,
    Rect,
} from '../../../visual-engine/index.js';
import { PortSide, type ResolvedPortSide } from '../port.js';
import {
    ConnectorEnd,
    type ResolvedAnchor,
    type RouteSpec,
    RouterRegistry,
    RoutingMode,
} from '../routing/router.js';
import '../routing/bezier-router.js';

const ANCHOR = (x: number, y: number, side: ResolvedPortSide): ResolvedAnchor =>
    ({ x, y, side });

const SPEC = (overrides: Partial<RouteSpec> = {}): RouteSpec => ({
    sourceRect:   new Rect(0,    0,   10, 10),
    sourceAnchor: ANCHOR(0,   0,   PortSide.E),
    targetRect:   new Rect(100, 100, 10, 10),
    targetAnchor: ANCHOR(100, 100, PortSide.W),
    waypoints:    [],
    ...overrides,
});

const router = RouterRegistry.resolve(RoutingMode.Bezier);

// Pull (start, [cubic-segments]) out of the PathGeometry for assertion.
function cubicsOf(geo: PathGeometry): { start: Point; segs: CubicBezierSegment[] }
{
    assert.equal(geo.Figures.length, 1);
    const fig = geo.Figures[0]!;
    const segs: CubicBezierSegment[] = [];
    for (const s of fig.Segments)
    {
        assert.ok(s instanceof CubicBezierSegment, 'expected CubicBezierSegment');
        segs.push(s);
    }
    return { start: fig.StartPoint, segs };
}

describe('BezierRouter — no-waypoint single cubic, control-point math', () => {
    test('E→W canonical: P1 east of source, P2 west of target, offsets = ½|t.X−s.X|', () => {
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0,   0,  PortSide.E),
            targetAnchor: ANCHOR(100, 50, PortSide.W),
        }));
        const { start, segs } = cubicsOf(geo);
        assert.equal(start.X, 0); assert.equal(start.Y, 0);
        assert.equal(segs.length, 1);
        const c = segs[0]!;
        // Offset = 0.5 × 100 = 50. P1 = (0+50, 0). P2 = (100-50, 50).
        assert.equal(c.Point1.X, 50); assert.equal(c.Point1.Y, 0);
        assert.equal(c.Point2.X, 50); assert.equal(c.Point2.Y, 50);
        assert.equal(c.Point3.X, 100); assert.equal(c.Point3.Y, 50);
    });

    test('W→E mirrored: controls extend inward from both endpoints', () => {
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(100, 0,  PortSide.W),
            targetAnchor: ANCHOR(0,   50, PortSide.E),
        }));
        const c = cubicsOf(geo).segs[0]!;
        // Source W: P1 = (100 - 50, 0) = (50, 0).
        // Target E: P2 = (0 + 50, 50) = (50, 50).
        assert.equal(c.Point1.X, 50); assert.equal(c.Point1.Y, 0);
        assert.equal(c.Point2.X, 50); assert.equal(c.Point2.Y, 50);
    });

    test('N→S vertical: offsets scale by ½|t.Y−s.Y|', () => {
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0,  0,   PortSide.N),
            targetAnchor: ANCHOR(50, 100, PortSide.S),
        }));
        const c = cubicsOf(geo).segs[0]!;
        // Source N: P1 = (0, 0 + (-1)*50) = (0, -50).
        // Target S: P2 = (50, 100 + (+1)*50) = (50, 150).
        assert.equal(c.Point1.X, 0);  assert.equal(c.Point1.Y, -50);
        assert.equal(c.Point2.X, 50); assert.equal(c.Point2.Y, 150);
    });

    test('S→N mirrored vertical', () => {
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0,  100, PortSide.S),
            targetAnchor: ANCHOR(50, 0,   PortSide.N),
        }));
        const c = cubicsOf(geo).segs[0]!;
        // Source S: P1 = (0, 100 + 50) = (0, 150).
        // Target N: P2 = (50, 0 - 50) = (50, -50).
        assert.equal(c.Point1.X, 0);  assert.equal(c.Point1.Y, 150);
        assert.equal(c.Point2.X, 50); assert.equal(c.Point2.Y, -50);
    });

    test('E→N mixed axis: each end uses its OWN axis for the offset', () => {
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0,   0,  PortSide.E),
            targetAnchor: ANCHOR(100, 50, PortSide.N),
        }));
        const c = cubicsOf(geo).segs[0]!;
        // Source E: offset on X = 50. P1 = (50, 0).
        // Target N: offset on Y = 25. P2 = (100, 50 - 25) = (100, 25).
        assert.equal(c.Point1.X, 50);  assert.equal(c.Point1.Y, 0);
        assert.equal(c.Point2.X, 100); assert.equal(c.Point2.Y, 25);
    });

    test('E→S mixed axis: target control extends below target', () => {
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0,   0,  PortSide.E),
            targetAnchor: ANCHOR(100, 50, PortSide.S),
        }));
        const c = cubicsOf(geo).segs[0]!;
        // Target S: P2 = (100, 50 + 25) = (100, 75).
        assert.equal(c.Point2.X, 100); assert.equal(c.Point2.Y, 75);
    });

    test('N→E mixed axis with source on Y axis, target on X axis', () => {
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0,   0,  PortSide.N),
            targetAnchor: ANCHOR(100, 50, PortSide.E),
        }));
        const c = cubicsOf(geo).segs[0]!;
        // Source N: offset on Y = 25. P1 = (0, -25).
        // Target E: offset on X = 50. P2 = (150, 50).
        assert.equal(c.Point1.X, 0);   assert.equal(c.Point1.Y, -25);
        assert.equal(c.Point2.X, 150); assert.equal(c.Point2.Y, 50);
    });

    test('W→S mixed axis with both controls extending outward', () => {
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(100, 0,  PortSide.W),
            targetAnchor: ANCHOR(0,   50, PortSide.S),
        }));
        const c = cubicsOf(geo).segs[0]!;
        // Source W: offset = |0-100|/2 = 50. P1 = (50, 0).
        // Target S: offset = |0-50|/2 = 25. P2 = (0, 75).
        assert.equal(c.Point1.X, 50); assert.equal(c.Point1.Y, 0);
        assert.equal(c.Point2.X, 0);  assert.equal(c.Point2.Y, 75);
    });
});

describe('BezierRouter — MIN-clamp when offset would degenerate', () => {
    test('N→N with endpoints on the same Y line: clamp to BEZIER_MIN_CONTROL_OFFSET', () => {
        // Both anchors at Y=0 → axis delta is 0; offset would be 0
        // without the clamp. The doc's 0.5×Δaxis rule alone would
        // collapse this cubic to a straight line that misses the side
        // direction; the clamp pins the side tangent at min length.
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0,   0, PortSide.N),
            targetAnchor: ANCHOR(100, 0, PortSide.N),
        }));
        const c = cubicsOf(geo).segs[0]!;
        assert.equal(c.Point1.X, 0);   assert.equal(c.Point1.Y, -20);
        assert.equal(c.Point2.X, 100); assert.equal(c.Point2.Y, -20);
    });

    test('E→E with endpoints on the same X line: clamp pins both controls eastward', () => {
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0, 0,   PortSide.E),
            targetAnchor: ANCHOR(0, 100, PortSide.E),
        }));
        const c = cubicsOf(geo).segs[0]!;
        assert.equal(c.Point1.X, 20); assert.equal(c.Point1.Y, 0);
        assert.equal(c.Point2.X, 20); assert.equal(c.Point2.Y, 100);
    });
});

describe('BezierRouter — multi-knot spline through waypoints', () => {
    test('one waypoint → two cubic segments with Catmull-Rom interior controls', () => {
        // knots: [(0,0), (60,60), (120,0)]
        //
        // Segment 0 (source→wp):
        //   P0 = (0,0)  [pen position]
        //   P1 = source-side E control: offset on X = |60-0|/2 = 30,
        //                              dir = (+1,0) → P1 = (30, 0).
        //   P2 = Catmull-Rom around wp going IN to k0→k1 segment:
        //        k1 - (k2 - k0) / 6 = (60,60) - (120/6, 0) = (40, 60).
        //   P3 = (60, 60)
        //
        // Segment 1 (wp→target):
        //   P0 = (60, 60)  [pen position from previous P3]
        //   P1 = Catmull-Rom around wp going OUT to k0→k1 (from this seg's POV):
        //        k0 + (k1 - km1) / 6 = (60,60) + (120/6, 0) = (80, 60).
        //   P2 = target-side W control: offset on X = |60-120|/2 = 30,
        //                              dir = (-1,0) → P2 = (90, 0).
        //   P3 = (120, 0)
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0,   0, PortSide.E),
            targetAnchor: ANCHOR(120, 0, PortSide.W),
            waypoints:    [new Point(60, 60)],
        }));
        const { start, segs } = cubicsOf(geo);
        assert.equal(start.X, 0); assert.equal(start.Y, 0);
        assert.equal(segs.length, 2);

        const s0 = segs[0]!;
        assert.equal(s0.Point1.X, 30); assert.equal(s0.Point1.Y, 0);
        assert.equal(s0.Point2.X, 40); assert.equal(s0.Point2.Y, 60);
        assert.equal(s0.Point3.X, 60); assert.equal(s0.Point3.Y, 60);

        const s1 = segs[1]!;
        assert.equal(s1.Point1.X, 80); assert.equal(s1.Point1.Y, 60);
        assert.equal(s1.Point2.X, 90); assert.equal(s1.Point2.Y, 0);
        assert.equal(s1.Point3.X, 120); assert.equal(s1.Point3.Y, 0);
    });

    test('multiple waypoints → N+1 segments, each cubic continues from the previous', () => {
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0,    0,  PortSide.E),
            targetAnchor: ANCHOR(300, 60, PortSide.W),
            waypoints:    [
                new Point(60,  60),
                new Point(150, 0),
                new Point(240, 60),
            ],
        }));
        const { segs } = cubicsOf(geo);
        assert.equal(segs.length, 4);
        // Verify continuity at each interior knot: the previous
        // segment's P3 equals the next segment's pen-position. (Pen
        // position is the previous P3 since the figure tracks it.)
        for (let i = 0; i < segs.length - 1; i++)
        {
            assert.equal(segs[i]!.Point3.X, [60, 150, 240][i]);
        }
    });
});

describe('BezierRouter — tangentAt at every side', () => {
    type Case = { side: ResolvedPortSide; expectedSource: number; expectedTarget: number };
    // Compose 4 spec variations — vary only source.side, keep target as
    // a "facing-inward" W so the target side stays controlled. Then a
    // symmetric pass varies target.side. Validates each side's outward
    // direction independently at both ends.
    const SOURCE_CASES: Case[] = [
        { side: PortSide.E, expectedSource: 0,           expectedTarget: 0 },
        { side: PortSide.W, expectedSource: Math.PI,     expectedTarget: 0 },
        { side: PortSide.N, expectedSource: -Math.PI / 2, expectedTarget: 0 },
        { side: PortSide.S, expectedSource: Math.PI / 2,  expectedTarget: 0 },
    ];
    for (const c of SOURCE_CASES)
    {
        test(`source side ${c.side}: tangent at source = ${c.expectedSource.toFixed(4)} rad`, () => {
            const spec = SPEC({
                sourceAnchor: ANCHOR(0,   0,  c.side),
                targetAnchor: ANCHOR(100, 50, PortSide.W),
            });
            assert.equal(router.tangentAt(spec, ConnectorEnd.Source), c.expectedSource);
        });
    }

    const TARGET_CASES: { side: ResolvedPortSide; expected: number }[] = [
        // tangentAt(Target) reads P₂ → P₃=target. P₂ sits outward from
        // target by the side's outward direction, so tangent points
        // OPPOSITE to outward (segment travels INTO target).
        { side: PortSide.E, expected: Math.PI },
        { side: PortSide.W, expected: 0 },
        { side: PortSide.N, expected: Math.PI / 2 },
        { side: PortSide.S, expected: -Math.PI / 2 },
    ];
    for (const c of TARGET_CASES)
    {
        test(`target side ${c.side}: tangent at target = ${c.expected.toFixed(4)} rad (segment INTO target)`, () => {
            const spec = SPEC({
                sourceAnchor: ANCHOR(0,   0,  PortSide.E),
                targetAnchor: ANCHOR(100, 50, c.side),
            });
            assert.equal(router.tangentAt(spec, ConnectorEnd.Target), c.expected);
        });
    }
});

describe('BezierRouter — degenerate source = target', () => {
    test('produces a non-trivial cubic anchored by the MIN-clamp', () => {
        // source = target with no waypoints. axis delta = 0 → offset
        // clamps to MIN=20. Controls trace the side direction so the
        // cubic forms a small loop / curl rather than collapsing.
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(42, 42, PortSide.E),
            targetAnchor: ANCHOR(42, 42, PortSide.E),
        }));
        const c = cubicsOf(geo).segs[0]!;
        assert.equal(c.Point1.X, 62); assert.equal(c.Point1.Y, 42);
        assert.equal(c.Point2.X, 62); assert.equal(c.Point2.Y, 42);
        assert.equal(c.Point3.X, 42); assert.equal(c.Point3.Y, 42);
    });

    test('tangent at source reflects source side, NOT 0 (distinct from StraightRouter convention)', () => {
        const spec = SPEC({
            sourceAnchor: ANCHOR(0, 0, PortSide.N),
            targetAnchor: ANCHOR(0, 0, PortSide.N),
        });
        // Source N: P1 = (0, -20). Tangent = atan2(-20, 0) = -π/2.
        assert.equal(router.tangentAt(spec, ConnectorEnd.Source), -Math.PI / 2);
    });
});

describe('RouterRegistry — bezier registration', () => {
    test('resolves built-in Bezier name', () => {
        const r = RouterRegistry.resolve(RoutingMode.Bezier);
        assert.ok(r !== undefined);
    });
});
