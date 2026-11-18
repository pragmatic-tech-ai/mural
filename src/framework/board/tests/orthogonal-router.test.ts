// Step 2 / § 9 of [docs/connectors.md](../../../../docs/connectors.md):
// pins the OrthogonalRouter's compute() + tangentAt() across all
// 16 (sourceSide × targetSide) combinations + waypoints + reverse +
// same-side same-axis detour.

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
import '../routing/orthogonal-router.js';

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

const router = RouterRegistry.resolve(RoutingMode.Orthogonal);

// Walk the PathGeometry back to a flat list of Points for assertion.
function pointsOf(geo: PathGeometry): Point[]
{
    assert.equal(geo.Figures.length, 1, 'expected exactly one figure');
    const fig = geo.Figures[0]!;
    const out: Point[] = [fig.StartPoint];
    for (const seg of fig.Segments)
    {
        assert.ok(seg instanceof LineSegment, 'expected LineSegment');
        out.push(seg.Point);
    }
    return out;
}

function expectPoints(geo: PathGeometry, expected: readonly (readonly [number, number])[]): void
{
    const pts = pointsOf(geo);
    assert.equal(pts.length, expected.length,
        `expected ${expected.length} vertices, got ${pts.length}: ${JSON.stringify(pts)}`);
    for (let i = 0; i < expected.length; i++)
    {
        assert.equal(pts[i]!.X, expected[i]![0], `vertex ${i} X`);
        assert.equal(pts[i]!.Y, expected[i]![1], `vertex ${i} Y`);
    }
}

// Each consecutive vertex pair must share X or Y. Used for the 16-combo
// structural sweep where pinning every combo's exact polyline would bloat
// the test file; the structural property is what the orthogonality
// contract actually guarantees.
function assertOrthogonal(geo: PathGeometry): void
{
    const pts = pointsOf(geo);
    for (let i = 1; i < pts.length; i++)
    {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const horizontal = a.Y === b.Y;
        const vertical   = a.X === b.X;
        assert.ok(horizontal || vertical,
            `segment ${i - 1}→${i} is not axis-aligned: ${JSON.stringify([a, b])}`);
    }
}

const ALL_SIDES: readonly ResolvedPortSide[] = [PortSide.N, PortSide.S, PortSide.E, PortSide.W];

describe('OrthogonalRouter — structural sweep over all 16 side combinations', () => {
    for (const sSide of ALL_SIDES)
    {
        for (const tSide of ALL_SIDES)
        {
            test(`(${sSide}, ${tSide}) produces an orthogonal polyline`, () => {
                const geo = router.compute(SPEC({
                    sourceAnchor: ANCHOR(0,   0,   sSide),
                    targetAnchor: ANCHOR(100, 100, tSide),
                }));
                const pts = pointsOf(geo);
                assert.equal(pts[0]!.X, 0);  assert.equal(pts[0]!.Y, 0);
                assert.equal(pts[pts.length - 1]!.X, 100);
                assert.equal(pts[pts.length - 1]!.Y, 100);
                assertOrthogonal(geo);
            });
        }
    }
});

describe('OrthogonalRouter — pinned canonical shapes', () => {
    test('mixed axis E→S: target S enters from south (§ 10.2), 3-corner detour', () => {
        // Per § 10.2 last segment must enter target S going north
        // (target's outward = +Y). The router loops east past source,
        // south past target Y, then east to target X, then north into
        // the south face. Stubs at (s.X+20, s.Y) and (t.X, t.Y+20).
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0,   0,  PortSide.E),
            targetAnchor: ANCHOR(100, 50, PortSide.S),
        }));
        expectPoints(geo, [[0, 0], [20, 0], [20, 70], [100, 70], [100, 50]]);
    });

    test('mixed axis N→W: source N exits north (§ 10.2), 3-corner detour', () => {
        // Per § 10.2 first segment must leave source N going north
        // (source's outward = -Y). The router stubs north past source,
        // west past target X, then south to target Y, then east into
        // the west face.
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(50, 0,   PortSide.N),
            targetAnchor: ANCHOR(0,  100, PortSide.W),
        }));
        expectPoints(geo, [[50, 0], [50, -20], [-20, -20], [-20, 100], [0, 100]]);
    });

    test('both X-axis facing inward (E→W, s.X<t.X): Z with midX = average', () => {
        // Natural opposite-side aligned case. Both outward sides agree
        // with the midX = (0+100)/2 = 50 bridge.
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0,   0,  PortSide.E),
            targetAnchor: ANCHOR(100, 50, PortSide.W),
        }));
        expectPoints(geo, [[0, 0], [50, 0], [50, 50], [100, 50]]);
    });

    test('both Y-axis facing inward (N→S, s.Y>t.Y): Z with midY = average', () => {
        // Natural opposite-side aligned vertical case. Source below
        // target in screen coords (s.Y > t.Y), source.N exits upward
        // toward target.S which receives from below.
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0,  100, PortSide.N),
            targetAnchor: ANCHOR(50, 0,   PortSide.S),
        }));
        expectPoints(geo, [[0, 100], [0, 50], [50, 50], [50, 0]]);
    });

    test('same-side E→E: Z-detour east of both endpoints (the doc § 6 edge case)', () => {
        // chooseMidX: average=50, sOK=50>0 ✓, tOK=50>100 ✗ → detour.
        // max(0,100)+STUB(20) = 120.
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0,   0,  PortSide.E),
            targetAnchor: ANCHOR(100, 50, PortSide.E),
        }));
        expectPoints(geo, [[0, 0], [120, 0], [120, 50], [100, 50]]);
    });

    test('same-side N→N: Z-detour north of both endpoints', () => {
        // chooseMidY: average=50, sOK=50<0 ✗ → detour.
        // min(0,100)-STUB(20) = -20.
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0,  0,   PortSide.N),
            targetAnchor: ANCHOR(50, 100, PortSide.N),
        }));
        expectPoints(geo, [[0, 0], [0, -20], [50, -20], [50, 100]]);
    });

    test('same-side W→W: Z-detour west of both endpoints', () => {
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(100, 0,  PortSide.W),
            targetAnchor: ANCHOR(0,   50, PortSide.W),
        }));
        expectPoints(geo, [[100, 0], [-20, 0], [-20, 50], [0, 50]]);
    });

    test('same-side S→S: Z-detour south of both endpoints', () => {
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0,  100, PortSide.S),
            targetAnchor: ANCHOR(50, 0,   PortSide.S),
        }));
        expectPoints(geo, [[0, 100], [0, 120], [50, 120], [50, 0]]);
    });

    test('aligned horizontal (E→W same Y): single straight segment', () => {
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0,   50, PortSide.E),
            targetAnchor: ANCHOR(100, 50, PortSide.W),
        }));
        expectPoints(geo, [[0, 50], [100, 50]]);
    });

    test('aligned vertical (N→S same X): single straight segment', () => {
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(50, 100, PortSide.N),
            targetAnchor: ANCHOR(50, 0,   PortSide.S),
        }));
        expectPoints(geo, [[50, 100], [50, 0]]);
    });
});

// The perpendicular-beam intersection optimization: when the source's
// outward ray and the target's outward ray meet on both forward halves,
// the route is a single corner at that intersection — no stub, no
// staircase, both adjacent segments collinear with the port axes.
describe('OrthogonalRouter — perpendicular-beam intersection optimization', () => {
    // ── Cases that were already 3-point under stub-Manhattan ─────
    // (L1-friendly mixed-axis quadrants where stub collapse landed
    //  on the intersection coincidentally). Same final polyline, but
    //  pinning the exact corner verifies the optimization picks the
    //  port-aligned intersection rather than a stub-shifted variant.

    test('E→N happy quadrant: corner at (Tx, Sy), no stubs', () => {
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0,   0,   PortSide.E),
            targetAnchor: ANCHOR(100, 100, PortSide.N),
        }));
        // Target down-right of source — both forward rays meet at
        // (Tx, Sy) = (100, 0). Source E goes east to the corner; the
        // last leg enters the N-facing port heading south, which is
        // "into" the port (the OPPOSITE of N's outward, as required).
        expectPoints(geo, [[0, 0], [100, 0], [100, 100]]);
    });

    test('E→S happy quadrant: corner at (Tx, Sy), no stubs', () => {
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0,   0,   PortSide.E),
            targetAnchor: ANCHOR(100, 100, PortSide.S),
        }));
        // Source E (Tx>Sx ✓), Target S needs corner Sy below source Y
        //   (tParam = (Sy-Ty)*tVec.y = (0-100)*1 = -100, FAILS).
        // So this DOES NOT optimize — falls through to the existing
        // 5-point E→S detour. Pin the existing shape to flag any
        // accidental change.
        expectPoints(geo, [[0, 0], [20, 0], [20, 120], [100, 120], [100, 100]]);
    });

    // ── Cases that were 5-point under stub-Manhattan (S→W, N→E with
    //    target up-left, etc.). The optimization reduces these to a
    //    clean 3-point L.

    test('S→W down-right: 3-point L (was 5-point staircase)', () => {
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0,   0,   PortSide.S),
            targetAnchor: ANCHOR(100, 100, PortSide.W),
        }));
        // Source vertical (S, sVec=(0,1)), target horizontal (W,
        // tVec=(-1,0)). Corner = (Sx, Ty) = (0, 100).
        //   sParam = (Ty-Sy)*sVec.y = 100*1 = 100 > 0 ✓
        //   tParam = (Sx-Tx)*tVec.x = (-100)*(-1) = 100 > 0 ✓
        // First segment south from source, last segment east into the
        // west-facing port.
        expectPoints(geo, [[0, 0], [0, 100], [100, 100]]);
    });

    test('N→E up-left: 3-point L (was 5-point staircase)', () => {
        // Source N at (50, 100); target E at (10, 50). The intersection
        // sits at (50, 50) on the forward halves of both beams.
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(50, 100, PortSide.N),
            targetAnchor: ANCHOR(10, 50,  PortSide.E),
        }));
        expectPoints(geo, [[50, 100], [50, 50], [10, 50]]);
    });

    test('S→E down-left: 3-point L', () => {
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(100, 0,   PortSide.S),
            targetAnchor: ANCHOR(0,   100, PortSide.E),
        }));
        // Source S sVec=(0,1), target E tVec=(1,0). Corner=(Sx,Ty)=(100,100).
        //   sParam = (Ty-Sy)*sVec.y = 100*1 = 100 ✓
        //   tParam = (Sx-Tx)*tVec.x = 100*1 = 100 ✓
        expectPoints(geo, [[100, 0], [100, 100], [0, 100]]);
    });

    test('N→W up-right: 3-point L', () => {
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0,   100, PortSide.N),
            targetAnchor: ANCHOR(100, 0,   PortSide.W),
        }));
        // Source N sVec=(0,-1), target W tVec=(-1,0). Corner=(Sx,Ty)=(0,0).
        //   sParam = (Ty-Sy)*sVec.y = (-100)*(-1) = 100 ✓
        //   tParam = (Sx-Tx)*tVec.x = (-100)*(-1) = 100 ✓
        expectPoints(geo, [[0, 100], [0, 0], [100, 0]]);
    });

    // ── Fallback cases: intersection exists geometrically but on a
    //    backward ray of at least one beam → no optimization, current
    //    stub-Manhattan behavior preserved.

    test('E→N wrong-quadrant (target behind source-X): falls back to stub-Manhattan', () => {
        // Target to the LEFT of source while source faces east → source's
        // forward ray never reaches the target's X. Fallback emits the
        // existing L2 corner at (sStub.X, tStub.Y) → 5 points.
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(100, 100, PortSide.E),
            targetAnchor: ANCHOR(0,   0,   PortSide.N),
        }));
        // Path: (100,100) → (120,100) → (120,-20) → (0,-20) → (0,0)
        expectPoints(geo, [[100, 100], [120, 100], [120, -20], [0, -20], [0, 0]]);
    });

    test('source = target degenerate (same axis): falls back', () => {
        // Same axis → optimization returns undefined → fallback path.
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(42, 42, PortSide.E),
            targetAnchor: ANCHOR(42, 42, PortSide.E),
        }));
        expectPoints(geo, [[42, 42], [42, 42]]);
    });

    // ── Degenerate corner cases: corner coincides with source or
    //    target (sParam === 0 or tParam === 0) → optimization rejects
    //    so the perpendicularity invariant on the OTHER end stays
    //    honored.

    test('corner === source (target on source outward axis): no optimization', () => {
        // Source E at (0,0), target N at (0,100). The "intersection"
        // sits at (0,0) — source itself, sParam=0. Optimization rejects;
        // fallback produces the spec-correct route.
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0, 0,   PortSide.E),
            targetAnchor: ANCHOR(0, 100, PortSide.N),
        }));
        const pts = pointsOf(geo);
        assert.ok(pts.length >= 3, 'must bend at least once when source X = target X but sides perpendicular');
        // First segment leaves east (collinear with source outward ray):
        // y unchanged on the s → next step.
        assert.equal(pts[0]!.X, 0);
        assert.equal(pts[0]!.Y, 0);
        assert.equal(pts[1]!.Y, 0, 'first segment must be horizontal (source E)');
        assertOrthogonal(geo);
    });

    test('corner === target (source on target outward axis): no optimization', () => {
        // Symmetric: target E at (100,0), source N at (100,100). The
        // intersection lands on target, tParam=0. Optimization rejects.
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(100, 100, PortSide.N),
            targetAnchor: ANCHOR(100, 0,   PortSide.E),
        }));
        const pts = pointsOf(geo);
        assert.ok(pts.length >= 3);
        // Last segment must enter target horizontally (E outward).
        const lastA = pts[pts.length - 2]!;
        const lastB = pts[pts.length - 1]!;
        assert.equal(lastA.Y, lastB.Y, 'last segment must be horizontal (target E)');
        assertOrthogonal(geo);
    });

    // ── Parallel beams (same-axis pairs): optimization returns
    //    undefined uniformly; existing Z / detour shapes preserved.

    test('parallel beams E→W aligned: optimization returns undefined → existing Z', () => {
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0,   0,  PortSide.E),
            targetAnchor: ANCHOR(100, 50, PortSide.W),
        }));
        // Existing pinned shape from "both X-axis facing inward".
        expectPoints(geo, [[0, 0], [50, 0], [50, 50], [100, 50]]);
    });
});

describe('OrthogonalRouter — reverse-direction (impossible Z) cases', () => {
    test('E→W with s.X > t.X uses 4-corner Z-horizontal bridge (§ 10.2 both ends honored)', () => {
        // Source EAST of target while source faces east. Both port-side
        // outward rays point in incompatible directions for a straight
        // bridge along X; the router stubs both ports outward and bridges
        // on the perpendicular Y axis at midY = avg(s.Y, t.Y).
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(100, 0,  PortSide.E),
            targetAnchor: ANCHOR(0,   50, PortSide.W),
        }));
        expectPoints(geo, [[100, 0], [120, 0], [120, 25], [-20, 25], [-20, 50], [0, 50]]);
    });

    test('W→E with s.X < t.X uses 4-corner Z-horizontal bridge', () => {
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0,   0,  PortSide.W),
            targetAnchor: ANCHOR(100, 50, PortSide.E),
        }));
        expectPoints(geo, [[0, 0], [-20, 0], [-20, 25], [120, 25], [120, 50], [100, 50]]);
    });

    test('N→S with s.Y < t.Y uses 4-corner Z-vertical bridge', () => {
        // Source N exits upward (-Y), target S enters from south (-Y).
        // Source ABOVE target (smaller Y) puts the outward rays facing
        // away from each other; bridge on the perpendicular X axis at
        // midX = avg(s.X, t.X).
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0,  0,   PortSide.N),
            targetAnchor: ANCHOR(50, 100, PortSide.S),
        }));
        expectPoints(geo, [[0, 0], [0, -20], [25, -20], [25, 120], [50, 120], [50, 100]]);
    });
});

describe('OrthogonalRouter — waypoints', () => {
    test('axis-aligned single waypoint produces a 3-segment Z through it', () => {
        // wp on source's horizontal axis → first pair collapses to a
        // single horizontal segment; last pair forms an L into target.
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0,   0,   PortSide.E),
            targetAnchor: ANCHOR(100, 100, PortSide.W),
            waypoints:    [new Point(50, 0)],
        }));
        expectPoints(geo, [[0, 0], [50, 0], [50, 100], [100, 100]]);
    });

    test('two aligned waypoints — segments collapse where possible', () => {
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0,   0,   PortSide.E),
            targetAnchor: ANCHOR(100, 100, PortSide.W),
            waypoints:    [new Point(50, 0), new Point(50, 100)],
        }));
        expectPoints(geo, [[0, 0], [50, 0], [50, 100], [100, 100]]);
    });

    test('off-axis waypoint inserts an L into the source-to-waypoint pair', () => {
        // wp not on source's exit axis → first pair becomes L. Source E
        // → first segment horizontal, corner = (wp.X, s.Y) = (30, 0).
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0,   0,   PortSide.E),
            targetAnchor: ANCHOR(100, 100, PortSide.W),
            waypoints:    [new Point(30, 50)],
        }));
        // Source → corner1 → wp; last pair: wp → corner2 → target.
        // wp(30,50) → t(100,100): tX=true → !tX=false → corner=(wp.X, t.Y)=(30,100).
        expectPoints(geo, [[0, 0], [30, 0], [30, 50], [30, 100], [100, 100]]);
    });

    test('every emitted polyline segment stays axis-aligned with waypoints', () => {
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(0,   0,   PortSide.N),
            targetAnchor: ANCHOR(200, 200, PortSide.S),
            waypoints:    [new Point(50, 25), new Point(150, 75), new Point(120, 180)],
        }));
        assertOrthogonal(geo);
    });
});

describe('OrthogonalRouter — degenerate source = target', () => {
    test('produces a single zero-length segment', () => {
        const geo = router.compute(SPEC({
            sourceAnchor: ANCHOR(42, 42, PortSide.E),
            targetAnchor: ANCHOR(42, 42, PortSide.E),
        }));
        expectPoints(geo, [[42, 42], [42, 42]]);
    });
});

describe('OrthogonalRouter — tangentAt', () => {
    test('E→S detour: source tangent East, target tangent North (entering S face from below)', () => {
        // Per § 10.2 the last segment goes from (100, 70) UP to (100, 50)
        // so the cap sits at the south face of target and points
        // into it (north, -π/2). Source's first segment still goes east.
        const spec = SPEC({
            sourceAnchor: ANCHOR(0,   0,  PortSide.E),
            targetAnchor: ANCHOR(100, 50, PortSide.S),
        });
        assert.equal(router.tangentAt(spec, ConnectorEnd.Source), 0);
        assert.equal(router.tangentAt(spec, ConnectorEnd.Target), -Math.PI / 2);
    });

    test('Z-shape E→W (canonical): both ends tangent East', () => {
        const spec = SPEC({
            sourceAnchor: ANCHOR(0,   0,  PortSide.E),
            targetAnchor: ANCHOR(100, 50, PortSide.W),
        });
        assert.equal(router.tangentAt(spec, ConnectorEnd.Source), 0);
        assert.equal(router.tangentAt(spec, ConnectorEnd.Target), 0);
    });

    test('same-side EE Z-detour: source East, target West (last segment doubles back)', () => {
        // Polyline [(0,0), (120,0), (120,50), (100,50)]. Last segment
        // (120,50) → (100,50) travels -x = West.
        const spec = SPEC({
            sourceAnchor: ANCHOR(0,   0,  PortSide.E),
            targetAnchor: ANCHOR(100, 50, PortSide.E),
        });
        assert.equal(router.tangentAt(spec, ConnectorEnd.Source), 0);
        assert.equal(router.tangentAt(spec, ConnectorEnd.Target), Math.PI);
    });

    test('with waypoint, source tangent reads the first emitted segment', () => {
        // [(0,0), (50,0), (50,100), (100,100)] — first segment east.
        const spec = SPEC({
            sourceAnchor: ANCHOR(0,   0,   PortSide.E),
            targetAnchor: ANCHOR(100, 100, PortSide.W),
            waypoints:    [new Point(50, 0)],
        });
        assert.equal(router.tangentAt(spec, ConnectorEnd.Source), 0);
    });

    test('source = target degenerate: 0 rad', () => {
        const spec = SPEC({
            sourceAnchor: ANCHOR(7, 7, PortSide.E),
            targetAnchor: ANCHOR(7, 7, PortSide.E),
        });
        assert.equal(router.tangentAt(spec, ConnectorEnd.Source), 0);
        assert.equal(router.tangentAt(spec, ConnectorEnd.Target), 0);
    });
});

describe('RouterRegistry — orthogonal registration', () => {
    test('resolves built-in Orthogonal name', () => {
        const r = RouterRegistry.resolve(RoutingMode.Orthogonal);
        assert.ok(r !== undefined);
    });
});
