// Step 1 / § 9 of [docs/connectors.md](../../../../docs/connectors.md):
// pins the StraightRouter's compute() + tangentAt() behavior. Pure
// geometry — no Connector, no Board, no Visual wiring yet.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    LineSegment,
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
// Side-effect import — registers StraightRouter under RoutingMode.Straight.
import '../routing/straight-router.js';

const ANCHOR = (x: number, y: number, side: ResolvedPortSide = PortSide.E): ResolvedAnchor =>
    ({ x, y, side });

// One spec factory; per-case overrides keep the test bodies short and
// the "what's being varied" obvious at the call site.
const SPEC = (overrides: Partial<RouteSpec> = {}): RouteSpec => ({
    sourceRect:   new Rect(0,    0,   10, 10),
    sourceAnchor: ANCHOR(0,   0,   PortSide.E),
    targetRect:   new Rect(100, 100, 10, 10),
    targetAnchor: ANCHOR(100, 100, PortSide.W),
    waypoints:    [],
    ...overrides,
});

const router = RouterRegistry.resolve(RoutingMode.Straight);

describe('StraightRouter — compute', () => {
    test('0 waypoints → one figure, one LineSegment from source to target', () => {
        const geo = router.compute(SPEC());
        assert.ok(geo instanceof PathGeometry, 'expected PathGeometry');

        assert.equal(geo.Figures.length, 1, 'expected exactly one figure');
        const fig = geo.Figures[0]!;
        assert.equal(fig.StartPoint.X, 0);
        assert.equal(fig.StartPoint.Y, 0);
        assert.equal(fig.IsClosed, false, 'connectors are open polylines');

        assert.equal(fig.Segments.length, 1);
        const seg = fig.Segments[0]!;
        assert.ok(seg instanceof LineSegment, 'expected LineSegment');
        assert.equal(seg.Point.X, 100);
        assert.equal(seg.Point.Y, 100);
    });

    test('1 waypoint → two-segment polyline through the waypoint', () => {
        const geo = router.compute(SPEC({ waypoints: [new Point(50, 0)] }));
        const fig = geo.Figures[0]!;
        assert.equal(fig.Segments.length, 2);

        const s0 = fig.Segments[0]! as LineSegment;
        const s1 = fig.Segments[1]! as LineSegment;
        assert.equal(s0.Point.X, 50);  assert.equal(s0.Point.Y, 0);
        assert.equal(s1.Point.X, 100); assert.equal(s1.Point.Y, 100);
    });

    test('N waypoints → (N + 1)-segment polyline in order', () => {
        const wps = [new Point(25, 0), new Point(50, 0), new Point(75, 50)];
        const geo = router.compute(SPEC({ waypoints: wps }));
        const fig = geo.Figures[0]!;
        assert.equal(fig.Segments.length, wps.length + 1);

        for (let i = 0; i < wps.length; i++)
        {
            const seg = fig.Segments[i]! as LineSegment;
            assert.equal(seg.Point.X, wps[i]!.X);
            assert.equal(seg.Point.Y, wps[i]!.Y);
        }
        const last = fig.Segments[wps.length]! as LineSegment;
        assert.equal(last.Point.X, 100); assert.equal(last.Point.Y, 100);
    });

    test('source = target degenerate → single zero-length LineSegment', () => {
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(42, 42, PortSide.E),
            targetAnchor: ANCHOR(42, 42, PortSide.W),
        }));
        const fig = geo.Figures[0]!;
        assert.equal(fig.StartPoint.X, 42);
        assert.equal(fig.StartPoint.Y, 42);
        assert.equal(fig.Segments.length, 1);
        const seg = fig.Segments[0]! as LineSegment;
        assert.equal(seg.Point.X, 42);
        assert.equal(seg.Point.Y, 42);
    });
});

describe('StraightRouter — tangentAt', () => {
    test('horizontal East-pointing line: 0 rad at both ends', () => {
        const spec = SPEC({
            sourceAnchor: ANCHOR(0,  0, PortSide.E),
            targetAnchor: ANCHOR(10, 0, PortSide.W),
        });
        assert.equal(router.tangentAt(spec, ConnectorEnd.Source), 0);
        assert.equal(router.tangentAt(spec, ConnectorEnd.Target), 0);
    });

    test('vertical South-pointing line: π/2 rad at both ends', () => {
        const spec = SPEC({
            sourceAnchor: ANCHOR(0, 0,  PortSide.S),
            targetAnchor: ANCHOR(0, 10, PortSide.N),
        });
        assert.equal(router.tangentAt(spec, ConnectorEnd.Source), Math.PI / 2);
        assert.equal(router.tangentAt(spec, ConnectorEnd.Target), Math.PI / 2);
    });

    test('horizontal West-pointing line: ±π rad at both ends', () => {
        // atan2(0, -1) === π — pinning the canonical sign here so a
        // future implementation that returns -π would fail loudly.
        const spec = SPEC({
            sourceAnchor: ANCHOR(0,   0, PortSide.W),
            targetAnchor: ANCHOR(-10, 0, PortSide.E),
        });
        assert.equal(router.tangentAt(spec, ConnectorEnd.Source), Math.PI);
        assert.equal(router.tangentAt(spec, ConnectorEnd.Target), Math.PI);
    });

    test('vertical North-pointing line: -π/2 rad at both ends', () => {
        const spec = SPEC({
            sourceAnchor: ANCHOR(0, 0,   PortSide.N),
            targetAnchor: ANCHOR(0, -10, PortSide.S),
        });
        assert.equal(router.tangentAt(spec, ConnectorEnd.Source), -Math.PI / 2);
        assert.equal(router.tangentAt(spec, ConnectorEnd.Target), -Math.PI / 2);
    });

    test('with waypoint, source-end tangent reads the FIRST segment', () => {
        // source → waypoint is East (0 rad), waypoint → target is South
        // (π/2 rad). Source-end tangent must be 0.
        const spec = SPEC({
            sourceAnchor: ANCHOR(0,  0,  PortSide.E),
            targetAnchor: ANCHOR(10, 10, PortSide.N),
            waypoints:    [new Point(10, 0)],
        });
        assert.equal(router.tangentAt(spec, ConnectorEnd.Source), 0);
    });

    test('with waypoint, target-end tangent reads the LAST segment', () => {
        // Same spec as above — last segment is waypoint(10,0) → target(10,10),
        // which is South (π/2 rad).
        const spec = SPEC({
            sourceAnchor: ANCHOR(0,  0,  PortSide.E),
            targetAnchor: ANCHOR(10, 10, PortSide.N),
            waypoints:    [new Point(10, 0)],
        });
        assert.equal(router.tangentAt(spec, ConnectorEnd.Target), Math.PI / 2);
    });

    test('source = target degenerate → 0 rad (no direction)', () => {
        const spec = SPEC({
            sourceAnchor: ANCHOR(42, 42, PortSide.E),
            targetAnchor: ANCHOR(42, 42, PortSide.W),
        });
        assert.equal(router.tangentAt(spec, ConnectorEnd.Source), 0);
        assert.equal(router.tangentAt(spec, ConnectorEnd.Target), 0);
    });
});

describe('RouterRegistry', () => {
    test('resolves built-in Straight name', () => {
        const r = RouterRegistry.resolve(RoutingMode.Straight);
        assert.ok(r !== undefined);
    });

    test('throws with known-names list on miss', () => {
        assert.throws(
            () => RouterRegistry.resolve('NotARealRouter'),
            (err: Error) => {
                assert.match(err.message, /NotARealRouter/);
                assert.match(err.message, /Known:/);
                assert.match(err.message, /Straight/);
                return true;
            },
        );
    });
});
