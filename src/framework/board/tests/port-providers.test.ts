// Step 5.5 / § 9 of [docs/connectors.md](../../../../docs/connectors.md):
// pins the 5 built-in providers + the kind→provider default table +
// Figure.PortProvider / Figure.ExplicitPorts precedence.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    CubicBezierSegment,
    LineSegment,
    PathFigure,
    PathGeometry,
    Point,
    Rect,
} from '../../../visual-engine/index.js';
import { Figure } from '../figure.js';
import {
    type IPortHost,
    Port,
    PortCoordSpace,
    PortSide,
} from '../port.js';
import {
    BoundingBoxPorts,
    CustomPortProvider,
    type IPortProvider,
    OutlinePorts,
    RadialPorts,
    VertexPorts,
    resolveDefaultPortProvider,
} from '../port-providers/index.js';

const HOST = (rect: Rect, geom?: PathGeometry): IPortHost =>
    ({ ArrangedRect: rect, Geometry: geom });

// ── BoundingBoxPorts ─────────────────────────────────────────────────

describe('BoundingBoxPorts', () => {
    test('default portsPerSide=1 emits 4 midpoint ports, one per side', () => {
        const ports = new BoundingBoxPorts().GetPorts(HOST(new Rect(0, 0, 100, 100)));
        assert.equal(ports.length, 4);

        // Sides land in N, S, E, W order per the provider's emit loop;
        // each at the midpoint of its edge in bbox 0..1 coords.
        const expected: [PortSide, number, number][] = [
            [PortSide.N, 0.5, 0  ],
            [PortSide.S, 0.5, 1  ],
            [PortSide.E, 1,   0.5],
            [PortSide.W, 0,   0.5],
        ];
        for (let i = 0; i < expected.length; i++)
        {
            const [side, x, y] = expected[i]!;
            assert.equal(ports[i]!.Side,       side);
            assert.equal(ports[i]!.X,          x);
            assert.equal(ports[i]!.Y,          y);
            assert.equal(ports[i]!.CoordSpace, PortCoordSpace.Bbox);
        }
    });

    test('portsPerSide=3 emits 12 ports at fractions 0.25, 0.5, 0.75 along each side', () => {
        const ports = new BoundingBoxPorts({ portsPerSide: 3 })
            .GetPorts(HOST(new Rect(0, 0, 100, 100)));
        assert.equal(ports.length, 12);
        // Within each i-iteration the provider emits N then S then E then W,
        // and i sweeps fractions 1/4, 2/4, 3/4 — so port[0..3] use 0.25,
        // port[4..7] use 0.5, port[8..11] use 0.75.
        for (let bucket = 0; bucket < 3; bucket++)
        {
            const frac = (bucket + 1) / 4;
            assert.equal(ports[bucket * 4    ]!.X, frac); // N: X varies
            assert.equal(ports[bucket * 4 + 1]!.X, frac); // S
            assert.equal(ports[bucket * 4 + 2]!.Y, frac); // E: Y varies
            assert.equal(ports[bucket * 4 + 3]!.Y, frac); // W
        }
    });

    test('portsPerSide < 1 emits nothing', () => {
        assert.equal(new BoundingBoxPorts({ portsPerSide: 0 }).GetPorts(HOST(Rect.Zero)).length, 0);
    });
});

// ── RadialPorts ──────────────────────────────────────────────────────

describe('RadialPorts', () => {
    test('count=4 startAngle=0 emits E / S / W / N cardinals', () => {
        const ports = new RadialPorts({ count: 4 }).GetPorts(HOST(Rect.Zero));
        assert.equal(ports.length, 4);

        // Angle convention: 0=E, π/2=S, π=W, 3π/2=N (screen-natural CW).
        // X = 0.5 + 0.5 cos θ, Y = 0.5 + 0.5 sin θ.
        const cases: [number, number][] = [
            [1,   0.5], // east
            [0.5, 1  ], // south
            [0,   0.5], // west
            [0.5, 0  ], // north
        ];
        const eps = 1e-12;
        for (let i = 0; i < 4; i++)
        {
            assert.ok(Math.abs(ports[i]!.X - cases[i]![0]) < eps,
                `port ${i} X expected ${cases[i]![0]} got ${ports[i]!.X}`);
            assert.ok(Math.abs(ports[i]!.Y - cases[i]![1]) < eps,
                `port ${i} Y expected ${cases[i]![1]} got ${ports[i]!.Y}`);
            assert.equal(ports[i]!.Side,       PortSide.Auto);
            assert.equal(ports[i]!.CoordSpace, PortCoordSpace.Bbox);
        }
    });

    test('startAngle rotates the whole ring', () => {
        // count=4, startAngle=π/2: first port at south (0.5, 1).
        const ports = new RadialPorts({ count: 4, startAngle: Math.PI / 2 })
            .GetPorts(HOST(Rect.Zero));
        const eps = 1e-12;
        assert.ok(Math.abs(ports[0]!.X - 0.5) < eps);
        assert.ok(Math.abs(ports[0]!.Y - 1)   < eps);
    });

    test('count < 1 emits nothing', () => {
        assert.equal(new RadialPorts({ count: 0 }).GetPorts(HOST(Rect.Zero)).length, 0);
    });
});

// ── OutlinePorts ─────────────────────────────────────────────────────

describe('OutlinePorts', () => {
    test('count=4 startT=0 emits ports at t = 0, 0.25, 0.5, 0.75', () => {
        const ports = new OutlinePorts({ count: 4 }).GetPorts(HOST(Rect.Zero));
        assert.equal(ports.length, 4);
        const expected = [0, 0.25, 0.5, 0.75];
        for (let i = 0; i < 4; i++)
        {
            assert.equal(ports[i]!.OutlineT,   expected[i]);
            assert.equal(ports[i]!.Side,       PortSide.Auto);
            assert.equal(ports[i]!.CoordSpace, PortCoordSpace.Outline);
        }
    });

    test('startT=0.6 wraps around the [0,1) interval', () => {
        // startT=0.6, count=4 → raw t's: 0.6, 0.85, 1.10, 1.35.
        // Wrapped (raw - floor(raw)) → 0.6, 0.85, 0.10, 0.35.
        const ports = new OutlinePorts({ count: 4, startT: 0.6 }).GetPorts(HOST(Rect.Zero));
        const eps = 1e-12;
        const expected = [0.6, 0.85, 0.10, 0.35];
        for (let i = 0; i < 4; i++)
        {
            assert.ok(Math.abs(ports[i]!.OutlineT - expected[i]!) < eps,
                `port ${i} OutlineT expected ${expected[i]} got ${ports[i]!.OutlineT}`);
        }
    });
});

// ── VertexPorts ──────────────────────────────────────────────────────

function unitTriangleGeometry(): PathGeometry
{
    // Triangle with vertices (0,0), (100,0), (50, 100), closed.
    return new PathGeometry([new PathFigure(
        new Point(0, 0),
        [
            new LineSegment(new Point(100, 0)),
            new LineSegment(new Point(50, 100)),
        ],
        /* IsClosed */ true,
    )]);
}

describe('VertexPorts', () => {
    test('extracts one port per LineSegment vertex + StartPoint', () => {
        const host = HOST(new Rect(0, 0, 100, 100), unitTriangleGeometry());
        const ports = new VertexPorts().GetPorts(host);
        assert.equal(ports.length, 3);
        // Vertices in shape-local space scaled by ArrangedRect.W/H.
        assert.equal(ports[0]!.X, 0);    assert.equal(ports[0]!.Y, 0);
        assert.equal(ports[1]!.X, 1);    assert.equal(ports[1]!.Y, 0);
        assert.equal(ports[2]!.X, 0.5);  assert.equal(ports[2]!.Y, 1);
    });

    test('includeMidpoints adds vertex-pair midpoints + closing midpoint', () => {
        const host = HOST(new Rect(0, 0, 100, 100), unitTriangleGeometry());
        const ports = new VertexPorts({ includeMidpoints: true }).GetPorts(host);
        // 3 vertices + 2 segment midpoints + 1 closing midpoint = 6.
        assert.equal(ports.length, 6);
        // Verify the closing midpoint is between last vertex (0.5, 1)
        // and the start (0, 0) — at (0.25, 0.5).
        const closingMidpoint = ports[5]!;
        assert.equal(closingMidpoint.X, 0.25);
        assert.equal(closingMidpoint.Y, 0.5);
    });

    test('no Geometry on host emits empty', () => {
        const host: IPortHost = { ArrangedRect: new Rect(0, 0, 100, 100) };
        assert.equal(new VertexPorts().GetPorts(host).length, 0);
    });

    test('curved segments contribute no extra vertices (only LineSegment endpoints count)', () => {
        // Single cubic — no LineSegment, so only StartPoint is emitted.
        const curvyGeom = new PathGeometry([new PathFigure(
            new Point(0, 0),
            [new CubicBezierSegment(new Point(30, 0), new Point(70, 100), new Point(100, 100))],
            false,
        )]);
        const host = HOST(new Rect(0, 0, 100, 100), curvyGeom);
        const ports = new VertexPorts().GetPorts(host);
        assert.equal(ports.length, 1);   // just StartPoint
    });
});

// ── CustomPortProvider ───────────────────────────────────────────────

describe('CustomPortProvider', () => {
    test('forwards GetPorts to the callback with the host', () => {
        let calledHost: IPortHost | undefined;
        const provider = new CustomPortProvider(host => {
            calledHost = host;
            return [new Port({ Name: 'a' }), new Port({ Name: 'b' })];
        });
        const host = HOST(new Rect(0, 0, 100, 100));
        const ports = provider.GetPorts(host);
        assert.equal(calledHost, host);
        assert.equal(ports.length, 2);
        assert.equal(ports[0]!.Name, 'a');
        assert.equal(ports[1]!.Name, 'b');
    });
});

// ── resolveDefaultPortProvider ───────────────────────────────────────

describe('resolveDefaultPortProvider — bbox for all', () => {
    // Figures are uniform (no Kind), so the default topology is bounding-box
    // (1 port per side = 4) for every figure. Special topologies are opt-in via
    // Figure.PortProvider.
    test('returns bounding-box ports (4) regardless of shape', () => {
        const provider = resolveDefaultPortProvider();
        assert.ok(provider instanceof BoundingBoxPorts);
        assert.equal(provider.GetPorts(HOST(new Rect(0, 0, 100, 100))).length, 4);
        // Explicit cardinals (not RadialPorts' Auto) — confirms the bbox impl.
        assert.notEqual(provider.GetPorts(HOST(new Rect(0, 0, 100, 100)))[0]!.Side, PortSide.Auto);
    });
});

// ── Figure.Ports integration ─────────────────────────────────────────

describe('Figure.Ports — precedence', () => {
    test('default Figure (no explicit, no provider) routes through resolveDefaultPortProvider', () => {
        const fig = Figure.fromKind('rectangle', 0, 0);
        // bbox default → 4 ports.
        assert.equal(fig.Ports.length, 4);
    });

    test('Figure.PortProvider override wins over kind-based default', () => {
        const fig = Figure.fromKind('rectangle', 0, 0);
        // Custom provider returning 7 ports — distinguishes from the
        // 4-port BoundingBoxPorts default.
        const sevenPorts: Port[] = Array.from({ length: 7 }, () => new Port());
        const customProvider: IPortProvider = { GetPorts: () => sevenPorts };
        fig.PortProvider = customProvider;
        assert.equal(fig.Ports.length, 7);
    });

    test('Figure.ExplicitPorts wins over BOTH PortProvider and kind default', () => {
        const fig = Figure.fromKind('rectangle', 0, 0);
        const customProvider: IPortProvider = { GetPorts: () => [new Port(), new Port()] };
        fig.PortProvider  = customProvider;     // 2 ports if it ran
        fig.ExplicitPorts = [new Port({ Name: 'only-one' })];
        assert.equal(fig.Ports.length, 1);
        assert.equal(fig.Ports[0]!.Name, 'only-one');
    });

    test('clearing ExplicitPorts back to undefined reverts to PortProvider', () => {
        const fig = Figure.fromKind('rectangle', 0, 0);
        const provider: IPortProvider = { GetPorts: () => [new Port(), new Port(), new Port()] };
        fig.PortProvider  = provider;
        fig.ExplicitPorts = [new Port()];
        assert.equal(fig.Ports.length, 1);
        fig.ExplicitPorts = undefined;
        assert.equal(fig.Ports.length, 3);
    });

    test('clearing PortProvider back to undefined falls through to kind default', () => {
        const fig = Figure.fromKind('rectangle', 0, 0);
        fig.PortProvider = { GetPorts: () => [new Port()] };
        assert.equal(fig.Ports.length, 1);
        fig.PortProvider = undefined;
        assert.equal(fig.Ports.length, 4);   // BoundingBoxPorts default
    });
});
