// Step 5 / § 9 of [docs/connectors.md](../../../../docs/connectors.md):
// pins the PortResolver's outline-mode resolution + flatten cache.
// Test fixtures: (a) unit square — 4 LineSegments, analytic positions
// and sides per quadrant; (b) circle — 4 cubics with the 4/3·(√2-1)
// magic control distance, positions verified numerically against the
// analytic circle equation; (c) cache-hit instrumentation verifies a
// repeated resolve against the same Geometry doesn't re-flatten.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    CubicBezierSegment,
    EllipseGeometry,
    LineSegment,
    PathFigure,
    PathGeometry,
    Point,
    Rect,
} from '../../../visual-engine/index.js';
import {
    type IPortHost,
    Port,
    PortCoordSpace,
    PortResolver,
    PortSide,
} from '../port.js';
import { _outlineFlattenStatsForTesting } from '../outline-flatten.js';

const HOST = (rect: Rect, geom: PathGeometry): IPortHost =>
    ({ ArrangedRect: rect, Geometry: geom });

// ── Fixtures ──────────────────────────────────────────────────────────

// 100×100 unit square outline, traversed clockwise from (0,0):
//   (0,0) → (100,0) → (100,100) → (0,100) → close to (0,0).
// Total perimeter = 400. Per-edge arc-length share = 0.25 (exactly).
function unitSquareGeometry(): PathGeometry
{
    return new PathGeometry([new PathFigure(
        new Point(0, 0),
        [
            new LineSegment(new Point(100, 0)),
            new LineSegment(new Point(100, 100)),
            new LineSegment(new Point(0,   100)),
        ],
        /* IsClosed */ true,
    )]);
}

// Circle of radius R centered at (R, R) approximated as 4 cubics with
// control distance MAGIC * R. MAGIC = (4/3) × (√2 - 1) — the optimal
// control offset for a single-cubic-per-quadrant circle approximation.
// Traversed clockwise from east → south → west → north → east.
const MAGIC = (4 / 3) * (Math.SQRT2 - 1);
function unitCircleGeometry(R: number): PathGeometry
{
    const m = R * MAGIC;
    const cx = R, cy = R;
    return new PathGeometry([new PathFigure(
        new Point(cx + R, cy),
        [
            new CubicBezierSegment(
                new Point(cx + R, cy + m),
                new Point(cx + m, cy + R),
                new Point(cx,     cy + R)),
            new CubicBezierSegment(
                new Point(cx - m, cy + R),
                new Point(cx - R, cy + m),
                new Point(cx - R, cy)),
            new CubicBezierSegment(
                new Point(cx - R, cy - m),
                new Point(cx - m, cy - R),
                new Point(cx,     cy - R)),
            new CubicBezierSegment(
                new Point(cx + m, cy - R),
                new Point(cx + R, cy - m),
                new Point(cx + R, cy)),
        ],
        /* IsClosed */ false,
    )]);
}

function close(actual: number, expected: number, eps: number, label: string): void
{
    assert.ok(
        Math.abs(actual - expected) < eps,
        `${label}: expected ~${expected}, got ${actual} (Δ=${actual - expected})`,
    );
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('PortResolver — outline mode on unit square', () => {
    const host = HOST(new Rect(0, 0, 100, 100), unitSquareGeometry());

    test('t = 0: top-left corner (start of figure)', () => {
        const p = new Port({ CoordSpace: PortCoordSpace.Outline, OutlineT: 0 });
        const a = PortResolver.resolve(p, host);
        assert.equal(a.x, 0);
        assert.equal(a.y, 0);
    });

    test('t = 0.25: top-right corner (end of first edge)', () => {
        const p = new Port({ CoordSpace: PortCoordSpace.Outline, OutlineT: 0.25 });
        const a = PortResolver.resolve(p, host);
        assert.equal(a.x, 100);
        assert.equal(a.y, 0);
    });

    test('t = 0.5: bottom-right corner', () => {
        const p = new Port({ CoordSpace: PortCoordSpace.Outline, OutlineT: 0.5 });
        const a = PortResolver.resolve(p, host);
        assert.equal(a.x, 100);
        assert.equal(a.y, 100);
    });

    test('t = 0.75: bottom-left corner', () => {
        const p = new Port({ CoordSpace: PortCoordSpace.Outline, OutlineT: 0.75 });
        const a = PortResolver.resolve(p, host);
        assert.equal(a.x, 0);
        assert.equal(a.y, 100);
    });

    test('t = 1: back at start (closed figure)', () => {
        const p = new Port({ CoordSpace: PortCoordSpace.Outline, OutlineT: 1 });
        const a = PortResolver.resolve(p, host);
        assert.equal(a.x, 0);
        assert.equal(a.y, 0);
    });

    test('mid-edge t values land at edge midpoints', () => {
        const cases: [number, number, number][] = [
            [0.125, 50,  0  ],
            [0.375, 100, 50 ],
            [0.625, 50,  100],
            [0.875, 0,   50 ],
        ];
        for (const [t, ex, ey] of cases)
        {
            const a = PortResolver.resolve(
                new Port({ CoordSpace: PortCoordSpace.Outline, OutlineT: t }), host);
            assert.equal(a.x, ex, `t=${t} X`);
            assert.equal(a.y, ey, `t=${t} Y`);
        }
    });

    test('ArrangedRect origin translates the resolved position', () => {
        // Same geometry, host shifted by (200, 300). Resolution must
        // add the origin to the shape-local outline walk.
        const offsetHost = HOST(new Rect(200, 300, 100, 100), unitSquareGeometry());
        const a = PortResolver.resolve(
            new Port({ CoordSpace: PortCoordSpace.Outline, OutlineT: 0.25 }), offsetHost);
        assert.equal(a.x, 300);
        assert.equal(a.y, 300);
    });

    test('mid-edge t values auto-derive the right cardinal sides', () => {
        const expected: [number, PortSide][] = [
            [0.125, PortSide.N], // top edge
            [0.375, PortSide.E], // right edge
            [0.625, PortSide.S], // bottom edge
            [0.875, PortSide.W], // left edge
        ];
        for (const [t, side] of expected)
        {
            const a = PortResolver.resolve(
                new Port({ CoordSpace: PortCoordSpace.Outline, OutlineT: t }), host);
            assert.equal(a.side, side, `t=${t} side`);
        }
    });
});

describe('PortResolver — outline mode on circle (cubic approximation)', () => {
    const R    = 50;
    const cx   = R, cy = R;
    const geom = unitCircleGeometry(R);
    const host = HOST(new Rect(0, 0, R * 2, R * 2), geom);

    test('walked positions lie on the circle within tolerance', () => {
        // Sample 16 t-values around the outline; each must satisfy
        // (x - cx)² + (y - cy)² ≈ R². Tolerance scales with flatten
        // chord-error: 0.5 px + the cubic-to-circle approximation
        // error (~0.027% of R ≈ 0.014 for R=50).
        const eps = 1.0;
        for (let i = 0; i < 16; i++)
        {
            const t = i / 16;
            const a = PortResolver.resolve(
                new Port({ CoordSpace: PortCoordSpace.Outline, OutlineT: t }), host);
            const dist = Math.hypot(a.x - cx, a.y - cy);
            close(dist, R, eps, `t=${t.toFixed(4)} on-circle radius`);
        }
    });

    test('cardinal-quadrant t values land near cardinal points', () => {
        // The 4-cubic circle approximation distributes arc-length
        // uniformly across the four cubics (by symmetry); t=0/0.25/0.5/0.75
        // land near east / south / west / north.
        const cases: [number, number, number][] = [
            [0,    cx + R, cy    ],  // east
            [0.25, cx,     cy + R],  // south
            [0.5,  cx - R, cy    ],  // west
            [0.75, cx,     cy - R],  // north
        ];
        for (const [t, ex, ey] of cases)
        {
            const a = PortResolver.resolve(
                new Port({ CoordSpace: PortCoordSpace.Outline, OutlineT: t }), host);
            close(a.x, ex, 1.0, `t=${t} X`);
            close(a.y, ey, 1.0, `t=${t} Y`);
        }
    });

    test('cardinal t values auto-derive the matching sides', () => {
        const cases: [number, PortSide][] = [
            [0,    PortSide.E],
            [0.25, PortSide.S],
            [0.5,  PortSide.W],
            [0.75, PortSide.N],
        ];
        for (const [t, side] of cases)
        {
            const a = PortResolver.resolve(
                new Port({ CoordSpace: PortCoordSpace.Outline, OutlineT: t }), host);
            assert.equal(a.side, side, `t=${t} side`);
        }
    });
});

describe('PortResolver — outline mode: explicit Side overrides Auto', () => {
    test('Side=N at any t returns N regardless of position', () => {
        const host = HOST(new Rect(0, 0, 100, 100), unitSquareGeometry());
        for (const t of [0, 0.125, 0.5, 0.875])
        {
            const a = PortResolver.resolve(
                new Port({ CoordSpace: PortCoordSpace.Outline, OutlineT: t, Side: PortSide.N }),
                host);
            assert.equal(a.side, PortSide.N);
        }
    });
});

describe('PortResolver — flatten cache', () => {
    test('repeat resolves on the same Geometry instance hit the cache', () => {
        _outlineFlattenStatsForTesting.reset();
        const host = HOST(new Rect(0, 0, 100, 100), unitSquareGeometry());

        // Multiple resolves, varying only the port — same Geometry
        // instance, so only the first should flatten.
        PortResolver.resolve(
            new Port({ CoordSpace: PortCoordSpace.Outline, OutlineT: 0.1 }), host);
        PortResolver.resolve(
            new Port({ CoordSpace: PortCoordSpace.Outline, OutlineT: 0.5 }), host);
        PortResolver.resolve(
            new Port({ CoordSpace: PortCoordSpace.Outline, OutlineT: 0.9 }), host);

        assert.equal(_outlineFlattenStatsForTesting.flattenCount, 1,
            'expected exactly one flatten across three resolves of the same Geometry');
    });

    test('a fresh Geometry instance flattens on first resolve', () => {
        _outlineFlattenStatsForTesting.reset();
        // Two distinct Geometry instances even though they describe
        // the same shape — cache keys on reference identity, so each
        // must flatten independently.
        const g1   = unitSquareGeometry();
        const g2   = unitSquareGeometry();
        const h1   = HOST(new Rect(0, 0, 100, 100), g1);
        const h2   = HOST(new Rect(0, 0, 100, 100), g2);

        PortResolver.resolve(
            new Port({ CoordSpace: PortCoordSpace.Outline, OutlineT: 0.1 }), h1);
        PortResolver.resolve(
            new Port({ CoordSpace: PortCoordSpace.Outline, OutlineT: 0.1 }), h2);

        assert.equal(_outlineFlattenStatsForTesting.flattenCount, 2);
    });
});

describe('PortResolver — outline mode error paths', () => {
    test('non-PathGeometry throws a "v1 limitation" error', () => {
        // EllipseGeometry could be supported by a dedicated flattener
        // (arc-length analytic), but v1 routes all catalog shapes
        // through PathGeometry, so non-Path Geometry subclasses get
        // the loud error instead of a silent fallback.
        const ellipse = new EllipseGeometry(new Point(50, 50), 50, 50);
        const host: IPortHost = {
            ArrangedRect: new Rect(0, 0, 100, 100),
            Geometry:     ellipse,
        };
        assert.throws(
            () => PortResolver.resolve(
                new Port({ CoordSpace: PortCoordSpace.Outline, OutlineT: 0 }), host),
            (err: Error) => {
                assert.match(err.message, /PathGeometry/);
                assert.match(err.message, /EllipseGeometry/);
                return true;
            },
        );
    });

    test('empty PathGeometry resolves to origin (0,0) without crashing', () => {
        const empty = new PathGeometry([]);
        const host  = HOST(new Rect(10, 20, 100, 100), empty);
        const a = PortResolver.resolve(
            new Port({ CoordSpace: PortCoordSpace.Outline, OutlineT: 0.5 }), host);
        // walkOutline returns (0,0) for empty outlines; resolveOutline
        // then translates by ArrangedRect.X / Y.
        assert.equal(a.x, 10);
        assert.equal(a.y, 20);
    });
});
