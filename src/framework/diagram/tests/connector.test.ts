// Step 6 / § 9 of [docs/connectors.md](../../../../docs/connectors.md):
// pins the Connector skeleton — DPs, the 5 endpoint-resolution paths
// from § 3.2, source/target reactivity, and routing-mode dispatch.
// Caps, hit-test widen, and edit interaction land in later steps.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PathGeometry, Point } from '../../../visual-engine/index.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';
import { AnchorClip, Connector } from '../connector.js';
import { Figure } from '../figure.js';
import { Port, PortSide } from '../port.js';
import { waypoint } from '../route-waypoint.js';
import { RoutingMode } from '../routing/router.js';
// Side-effect imports — register the routers under their RoutingMode names.
import '../routing/straight-router.js';
import '../routing/orthogonal-router.js';
import '../routing/bezier-router.js';

// ── Fixtures ──────────────────────────────────────────────────────────

function makeFigure(left: number, top: number, w: number, h: number, ports?: readonly Port[]): Figure
{
    const f = new Figure();
    f.Left   = left;
    f.Top    = top;
    f.Width  = w;
    f.Height = h;
    if (ports !== undefined) f.ExplicitPorts = ports;
    return f;
}

function startOf(conn: Connector): Point
{
    const g = conn.Geometry as PathGeometry;
    return g.Figures[0]!.StartPoint;
}

// ── Path 1 — free-floating endpoints ──────────────────────────────────

describe('Connector resolution path 1 — FreePoint endpoints', () => {
    test('Straight route between two FreePoint endpoints', () => {
        const src = new ConnectorEndpoint({ FreePoint: new Point(0,   0) });
        const tgt = new ConnectorEndpoint({ FreePoint: new Point(100, 50) });
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = src;
        c.Target = tgt;
        assert.ok(c.Geometry !== undefined, 'expected Geometry after both endpoints set');
        const fig = (c.Geometry as PathGeometry).Figures[0]!;
        assert.equal(fig.StartPoint.X, 0);
        assert.equal(fig.StartPoint.Y, 0);
    });

    test('Geometry stays undefined while only one endpoint is set', () => {
        const c = new Connector();
        c.Source = new ConnectorEndpoint({ FreePoint: new Point(0, 0) });
        assert.equal(c.Geometry, undefined);
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(100, 100) });
        assert.ok(c.Geometry !== undefined);
    });

    test('FreePoint changes re-route on the next OnPropertyChanged', () => {
        const src = new ConnectorEndpoint({ FreePoint: new Point(0, 0) });
        const tgt = new ConnectorEndpoint({ FreePoint: new Point(100, 0) });
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = src;
        c.Target = tgt;
        const before = startOf(c);
        src.FreePoint = new Point(50, 50);
        const after = startOf(c);
        assert.notEqual(before.X, after.X);
        assert.equal(after.X, 50);
        assert.equal(after.Y, 50);
    });
});

// ── Path 2 — named lookup ────────────────────────────────────────────

describe('Connector resolution path 2 — named port lookup', () => {
    test('PortName resolves against ExplicitPorts', () => {
        // 'out' port at bbox (1, 0.5) → diagram-host (180, 140).
        const fig = makeFigure(100, 100, 80, 80, [
            new Port({ Name: 'in',  Side: PortSide.W, X: 0, Y: 0.5 }),
            new Port({ Name: 'out', Side: PortSide.E, X: 1, Y: 0.5 }),
        ]);
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = new ConnectorEndpoint({ Node: fig, PortName: 'out' });
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(300, 200) });
        const start = startOf(c);
        assert.equal(start.X, 180);
        assert.equal(start.Y, 140);
    });

    test('unknown PortName falls through to subsequent paths (eventually auto-pick)', () => {
        const fig = makeFigure(100, 100, 80, 80, [
            new Port({ Name: 'in', Side: PortSide.W, X: 0, Y: 0.5 }),
        ]);
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = new ConnectorEndpoint({ Node: fig, PortName: 'nonexistent' });
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(300, 140) });
        // Falls through to path 4: only port available is 'in' at (100, 140).
        const start = startOf(c);
        assert.equal(start.X, 100);
        assert.equal(start.Y, 140);
    });
});

// ── Path 3 — positional (PortSide, PortIndex) lookup ─────────────────

describe('Connector resolution path 3 — positional (PortSide, PortIndex) lookup', () => {
    test('bucket-sort within a side picks the X-ordered index 0', () => {
        // Emit order intentionally scrambled — bucket-sort by X ascending
        // means index 0 is the LEFTMOST N-side port (X=0.25).
        const fig = makeFigure(100, 100, 80, 80, [
            new Port({ Side: PortSide.N, X: 0.75, Y: 0 }),
            new Port({ Side: PortSide.N, X: 0.25, Y: 0 }),
            new Port({ Side: PortSide.N, X: 0.50, Y: 0 }),
        ]);
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = new ConnectorEndpoint({
            Node: fig, PortSide: PortSide.N, PortIndex: 0,
        });
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(300, 200) });
        const start = startOf(c);
        // Index 0 → X=0.25 → diagram-host (100 + 0.25*80, 100) = (120, 100).
        assert.equal(start.X, 120);
        assert.equal(start.Y, 100);
    });

    test('positional lookup is stable under scrambled provider emit order', () => {
        // Two figures with identical port SETS but in different emit
        // orders. Looking up (N, 1) must land on the X=0.5 port for
        // BOTH — bucketing sorts independent of insertion order.
        const portsA = [
            new Port({ Side: PortSide.N, X: 0.25, Y: 0 }),
            new Port({ Side: PortSide.N, X: 0.50, Y: 0 }),
            new Port({ Side: PortSide.N, X: 0.75, Y: 0 }),
        ];
        const portsB = [
            new Port({ Side: PortSide.N, X: 0.75, Y: 0 }),
            new Port({ Side: PortSide.N, X: 0.25, Y: 0 }),
            new Port({ Side: PortSide.N, X: 0.50, Y: 0 }),
        ];
        const figA = makeFigure(100, 100, 80, 80, portsA);
        const figB = makeFigure(100, 100, 80, 80, portsB);
        const free = (): ConnectorEndpoint => new ConnectorEndpoint({ FreePoint: new Point(300, 200) });
        const mkConnector = (fig: Figure): Connector => {
            const c = new Connector();
            c.RoutingMode = RoutingMode.Straight;
            c.Source = new ConnectorEndpoint({ Node: fig, PortSide: PortSide.N, PortIndex: 1 });
            c.Target = free();
            return c;
        };
        const sA = startOf(mkConnector(figA));
        const sB = startOf(mkConnector(figB));
        assert.equal(sA.X, sB.X);
        assert.equal(sA.Y, sB.Y);
        assert.equal(sA.X, 140);   // X=0.5 → 100 + 0.5*80 = 140
    });
});

// ── Path 3 → 4 fallthrough ───────────────────────────────────────────

describe('Connector resolution path 3 → 4 fallthrough — index out of range', () => {
    test('out-of-range PortIndex falls through to closest-port pick', () => {
        const fig = makeFigure(100, 100, 80, 80, [
            new Port({ Side: PortSide.N, X: 0.5, Y: 0   }),   // (140, 100)
            new Port({ Side: PortSide.E, X: 1,   Y: 0.5 }),   // (180, 140)
        ]);
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = new ConnectorEndpoint({
            Node: fig, PortSide: PortSide.N, PortIndex: 99,
        });
        // Target far east → closest is E-side port.
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(500, 140) });
        const start = startOf(c);
        assert.equal(start.X, 180);
        assert.equal(start.Y, 140);
    });
});

// ── Path 3a — side-slot dynamic distribution ─────────────────────────

describe('Connector resolution path 3a — dynamic side-slot distribution', () => {
    test('single connector on side: slot 0 of 1 = bbox edge midpoint (centered)', () => {
        // Odd count (N=1) → t = (0+1)/(1+1) = 0.5. Connector anchors
        // at the dead center of the side. Designer-intent ports (none
        // here) deliberately don't pre-empt this — the side-only
        // resolution is purely dynamic.
        const fig = makeFigure(100, 100, 80, 80, []);
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = new ConnectorEndpoint({ Node: fig, PortSide: PortSide.E });
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(500, 140) });
        const start = startOf(c);
        assert.equal(start.X, 180);
        assert.equal(start.Y, 140);   // figure.Top (100) + 0.5 * 80
    });

    test('odd count (N=3) places one slot at the side center', () => {
        // t values: 1/4, 2/4 (= 0.5, centered), 3/4 → Y = 120, 140, 160.
        // Positions are read AFTER all three are created so each
        // connector's geometry reflects the final N=3 distribution
        // (mid-loop pushes would capture pre-rebalance values).
        const fig = makeFigure(100, 100, 80, 80, []);
        const cs: Connector[] = [];
        for (let i = 0; i < 3; i++)
        {
            const c = new Connector();
            c.RoutingMode = RoutingMode.Straight;
            c.Source = new ConnectorEndpoint({ Node: fig, PortSide: PortSide.E });
            c.Target = new ConnectorEndpoint({ FreePoint: new Point(500, 140) });
            cs.push(c);
        }
        const ys = cs.map(c => startOf(c).Y);
        assert.deepEqual(ys, [120, 140, 160]);
        assert.ok(ys.includes(140), 'odd count must include the side center');
    });

    test('even count (N=2) is symmetric around the center with no slot at the center', () => {
        // t values: 1/3, 2/3 → Y = 100 + (1/3)*80 ≈ 126.66, 153.33.
        // Center (Y=140) NOT in the slot list.
        const fig = makeFigure(100, 100, 80, 80, []);
        const cs: Connector[] = [];
        for (let i = 0; i < 2; i++)
        {
            const c = new Connector();
            c.RoutingMode = RoutingMode.Straight;
            c.Source = new ConnectorEndpoint({ Node: fig, PortSide: PortSide.E });
            c.Target = new ConnectorEndpoint({ FreePoint: new Point(500, 140) });
            cs.push(c);
        }
        const ys = cs.map(c => startOf(c).Y);
        const center = 140;
        assert.ok(Math.abs((ys[0]! - center) + (ys[1]! - center)) < 1e-9,
            `expected symmetry around ${center}, got ${ys}`);
        assert.ok(!ys.some(y => Math.abs(y - center) < 1e-9),
            'even count must leave the center empty');
    });

    test('even count (N=4) is symmetric around the center with no slot at the center', () => {
        const fig = makeFigure(100, 100, 80, 80, []);
        const cs: Connector[] = [];
        for (let i = 0; i < 4; i++)
        {
            const c = new Connector();
            c.RoutingMode = RoutingMode.Straight;
            c.Source = new ConnectorEndpoint({ Node: fig, PortSide: PortSide.E });
            c.Target = new ConnectorEndpoint({ FreePoint: new Point(500, 140) });
            cs.push(c);
        }
        const ys = cs.map(c => startOf(c).Y);
        const center = 140;
        const offsetSum = ys.reduce((acc, y) => acc + (y - center), 0);
        assert.ok(Math.abs(offsetSum) < 1e-9, `expected symmetry, got ${ys}`);
        assert.ok(!ys.some(y => Math.abs(y - center) < 1e-9),
            'even count must leave the center empty');
    });

    test('static ports on the side do NOT capture path 3a — bbox distribution still wins', () => {
        // Figure declares an off-center port on E, but the endpoint
        // uses PortSide-only (no name, no index). Path 3a stays on
        // the dynamic bbox distribution; the centered slot wins.
        // The static port stays addressable via Path 2 (PortName) /
        // Path 3 (PortSide + PortIndex) for callers that want it.
        const fig = makeFigure(100, 100, 80, 80, [
            new Port({ Side: PortSide.E, X: 1, Y: 0.25 }),   // off-center
        ]);
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = new ConnectorEndpoint({ Node: fig, PortSide: PortSide.E });
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(500, 140) });
        const start = startOf(c);
        assert.equal(start.X, 180);
        assert.equal(start.Y, 140);   // bbox center, not the off-center port
    });

    test('adding a second side-anchored connector rebalances the first', () => {
        // When a new endpoint joins side E, the existing connector
        // must shift from t=0.5 to t=1/3 — Figure._fireSideRebalance
        // fans the rebalance through every endpoint on the side, and
        // each Connector._scheduleRecompute re-resolves and re-routes
        // (the orthogonal router's beam-intersection optimization runs
        // again with the updated anchors).
        const fig = makeFigure(100, 100, 80, 80, []);
        const c1 = new Connector();
        c1.RoutingMode = RoutingMode.Straight;
        c1.Source = new ConnectorEndpoint({ Node: fig, PortSide: PortSide.E });
        c1.Target = new ConnectorEndpoint({ FreePoint: new Point(500, 140) });
        // Single connector on side: c1 at slot 0 of 1 → Y = 140.
        assert.equal(startOf(c1).Y, 140);

        const c2 = new Connector();
        c2.RoutingMode = RoutingMode.Straight;
        c2.Source = new ConnectorEndpoint({ Node: fig, PortSide: PortSide.E });
        c2.Target = new ConnectorEndpoint({ FreePoint: new Point(500, 200) });

        // After c2 joins, both connectors must occupy slots 0 and 1 of 2.
        // c1's Y reflects the new distribution — proof the rebalance
        // callback fired and c1's anchor re-resolved.
        const y1 = startOf(c1).Y;
        const y2 = startOf(c2).Y;
        assert.notEqual(y1, 140, 'c1 must have shifted off the center after c2 joined');
        // Symmetric around the center.
        assert.ok(Math.abs((y1 - 140) + (y2 - 140)) < 1e-9,
            `expected symmetry around 140, got [${y1}, ${y2}]`);
    });

    test('bare-Node endpoint (no PortSide) lands at the baked side center, not path-5 off-center', () => {
        // Reproduces the demo wiring `new ConnectorEndpoint({ Node })`
        // with no PortSide. The bake step inside _scheduleRecompute
        // sets PortSide based on the first-pass resolved side, then
        // re-resolves locally so the route uses the side-center anchor
        // from path 3a — not the pre-bake off-center anchor from path 5
        // (which the recursive _scheduleRecompute used to clobber).
        const src = makeFigure(0,   100, 80, 80, []);   // square at left
        const tgt = makeFigure(200, 100, 80, 80, []);   // figure at right
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = new ConnectorEndpoint({ Node: src });
        c.Target = new ConnectorEndpoint({ Node: tgt });
        const start = startOf(c);
        // Source's E side center: (80, 140). Target's W side center: (200, 140).
        // First segment leaves source at (80, 140); the test pins the
        // start point.
        assert.equal(start.X, 80);
        assert.equal(start.Y, 140);
        // Side gets baked.
        assert.equal((c.Source as ConnectorEndpoint).PortSide, PortSide.E);
        assert.equal((c.Target as ConnectorEndpoint).PortSide, PortSide.W);
    });

    test('side-intersection optimizer: swaps slot order to avoid two connectors crossing', () => {
        // Source figure F with two connectors leaving its E side. T1
        // is up-right, T2 is down-right. Creating the connectors in
        // CROSSING order (c1 → T2 first, c2 → T1 second) would put
        // c1 at slot 0 (top of E) heading to T2 (down) and c2 at
        // slot 1 (bottom) heading to T1 (up) — the two lines cross.
        // The optimizer swaps c1 ↔ c2 slot indices so c1 (→ T2) lands
        // at the BOTTOM slot and c2 (→ T1) at the TOP slot. After
        // swap each connector runs straight to its target, no crossing.
        const F  = makeFigure(100, 100, 80, 80, []);
        const T1 = makeFigure(300, 50,  80, 80, []);
        const T2 = makeFigure(300, 200, 80, 80, []);

        const c1 = new Connector();
        c1.RoutingMode = RoutingMode.Straight;
        c1.Source = new ConnectorEndpoint({ Node: F,  PortSide: PortSide.E });
        c1.Target = new ConnectorEndpoint({ Node: T2, PortSide: PortSide.W });

        const c2 = new Connector();
        c2.RoutingMode = RoutingMode.Straight;
        c2.Source = new ConnectorEndpoint({ Node: F,  PortSide: PortSide.E });
        c2.Target = new ConnectorEndpoint({ Node: T1, PortSide: PortSide.W });

        // After optimization: c1 (→ T2, the lower target) should sit
        // at the LOWER slot index 1, c2 (→ T1, the upper target) at
        // the UPPER slot index 0.
        const slot1 = F.GetSideSlot(c1.Source as ConnectorEndpoint, PortSide.E);
        const slot2 = F.GetSideSlot(c2.Source as ConnectorEndpoint, PortSide.E);
        assert.ok(slot1 !== undefined && slot2 !== undefined);
        assert.equal(slot1!.index, 1, 'c1 (→ lower target T2) must end at the lower slot');
        assert.equal(slot2!.index, 0, 'c2 (→ upper target T1) must end at the upper slot');

        // And the resulting source Y positions match.
        const c1Y = startOf(c1).Y;
        const c2Y = startOf(c2).Y;
        assert.ok(c1Y > c2Y, `expected c1 below c2 on side E, got c1.Y=${c1Y} c2.Y=${c2Y}`);
    });

    test('side-intersection optimizer: does not disturb a clean (non-crossing) setup', () => {
        // Create the connectors in the NATURAL non-crossing order — c1
        // → T1 (upper) first, c2 → T2 (lower) second. Insertion-order
        // already places c1 at top slot 0 and c2 at bottom slot 1. The
        // optimizer must detect no crossing and leave the slots alone.
        const F  = makeFigure(100, 100, 80, 80, []);
        const T1 = makeFigure(300, 50,  80, 80, []);
        const T2 = makeFigure(300, 200, 80, 80, []);

        const c1 = new Connector();
        c1.RoutingMode = RoutingMode.Straight;
        c1.Source = new ConnectorEndpoint({ Node: F,  PortSide: PortSide.E });
        c1.Target = new ConnectorEndpoint({ Node: T1, PortSide: PortSide.W });

        const c2 = new Connector();
        c2.RoutingMode = RoutingMode.Straight;
        c2.Source = new ConnectorEndpoint({ Node: F,  PortSide: PortSide.E });
        c2.Target = new ConnectorEndpoint({ Node: T2, PortSide: PortSide.W });

        const slot1 = F.GetSideSlot(c1.Source as ConnectorEndpoint, PortSide.E);
        const slot2 = F.GetSideSlot(c2.Source as ConnectorEndpoint, PortSide.E);
        assert.equal(slot1!.index, 0, 'c1 stays at insertion-order slot 0 (no swap needed)');
        assert.equal(slot2!.index, 1, 'c2 stays at insertion-order slot 1 (no swap needed)');
    });

    test('side-intersection optimizer: swaps to break a COLLINEAR overlap (no transversal crossing)', () => {
        // F's E side at x = 220. Two targets sit on that SAME vertical line
        // (T1 above via its S-side anchor, T2 below via its N-side anchor),
        // so both connectors run as vertical segments on x = 220 — they
        // can stack on top of each other but never cross transversally.
        //
        // Built in the stacking order: c1 → T2 (below) takes upper slot 0,
        // c2 → T1 (above) takes lower slot 1. c1 then spans Y≈[127,280] and
        // c2 spans Y≈[80,153] on x=220 — a positive-length collinear overlap
        // that segmentsProperlyCross can't see. Only the overlap predicate
        // fires the swap; the old crossing-only optimizer left this stacked.
        const F  = makeFigure(140, 100, 80, 80, []);     // E side x = 220
        const T1 = makeFigure(180, 0,   80, 80, []);     // S-side anchor (220, 80)
        const T2 = makeFigure(180, 280, 80, 80, []);     // N-side anchor (220, 280)

        const c1 = new Connector();
        c1.RoutingMode = RoutingMode.Straight;
        c1.Source = new ConnectorEndpoint({ Node: F,  PortSide: PortSide.E });
        c1.Target = new ConnectorEndpoint({ Node: T2, PortSide: PortSide.N });

        const c2 = new Connector();
        c2.RoutingMode = RoutingMode.Straight;
        c2.Source = new ConnectorEndpoint({ Node: F,  PortSide: PortSide.E });
        c2.Target = new ConnectorEndpoint({ Node: T1, PortSide: PortSide.S });

        // After overlap-driven optimization c1 (→ lower target T2) lands at
        // the lower slot 1 and c2 (→ upper target T1) at the upper slot 0,
        // so the two vertical runs no longer share span.
        const slot1 = F.GetSideSlot(c1.Source as ConnectorEndpoint, PortSide.E);
        const slot2 = F.GetSideSlot(c2.Source as ConnectorEndpoint, PortSide.E);
        assert.equal(slot1!.index, 1, 'c1 (→ lower target) moved to the lower slot to clear the overlap');
        assert.equal(slot2!.index, 0, 'c2 (→ upper target) moved to the upper slot');
        assert.ok(startOf(c1).Y > startOf(c2).Y,
            `expected c1 below c2 after the un-stacking swap, got c1.Y=${startOf(c1).Y} c2.Y=${startOf(c2).Y}`);
    });

    test('orthogonal lane stagger: two connectors sharing a side route on DISTINCT vertical lanes', () => {
        // The screenshot case: a target H with two connectors entering its
        // E side from sources below. Both run a long vertical up the E-stub
        // lane — without staggering they'd sit on the SAME x and stack. The
        // side-slot index feeds the router's stub offset, so slot 0 keeps
        // the base lane and slot 1 fans out by LANE_GAP.
        const H  = makeFigure(60, 0,   100, 100, []);   // E side x = 160
        const S1 = makeFigure(60, 260, 100, 60,  []);
        const S2 = makeFigure(60, 340, 100, 60,  []);

        const c1 = new Connector();                      // default Orthogonal
        c1.Source = new ConnectorEndpoint({ Node: S1, PortSide: PortSide.E });
        c1.Target = new ConnectorEndpoint({ Node: H,  PortSide: PortSide.E });

        const c2 = new Connector();
        c2.Source = new ConnectorEndpoint({ Node: S2, PortSide: PortSide.E });
        c2.Target = new ConnectorEndpoint({ Node: H,  PortSide: PortSide.E });

        // The dominant vertical run of each route — the long E-stub lane.
        const laneX = (c: Connector): number => {
            const pts = (c.Geometry as PathGeometry).Figures[0]!;
            const verts: Point[] = [pts.StartPoint,
                ...pts.Segments.map(s => (s as unknown as { Point: Point }).Point)];
            let best = 0, bestLen = -1;
            for (let i = 1; i < verts.length; i++)
            {
                if (verts[i]!.X === verts[i - 1]!.X)               // vertical segment
                {
                    const len = Math.abs(verts[i]!.Y - verts[i - 1]!.Y);
                    if (len > bestLen) { bestLen = len; best = verts[i]!.X; }
                }
            }
            return best;
        };

        const x1 = laneX(c1);
        const x2 = laneX(c2);
        assert.notEqual(x1, x2,
            `the two vertical lanes must not coincide (both at x=${x1})`);
        assert.ok(Math.abs(x1 - x2) >= 10,
            `lanes should be separated by at least LANE_GAP, got |${x1} - ${x2}|`);
    });

    test('orthogonal lane stagger + reorder: three connectors into a shared side route WITHOUT crossings', () => {
        // The reported screenshot: three connectors enter H's E side from
        // three sources below. Direction-aware lane offsets (top slot →
        // outermost lane when the other end is below) nest the routes, and
        // the side optimizer settles the slot order — together they leave
        // the three routes crossing-free, not just un-stacked.
        const H = makeFigure(60, 0, 100, 100, []);          // E side x = 160
        const cs = [260, 320, 380].map(top => {
            const S = makeFigure(60, top, 100, 50, []);
            const c = new Connector();                       // default Orthogonal
            c.Source = new ConnectorEndpoint({ Node: S, PortSide: PortSide.E });
            c.Target = new ConnectorEndpoint({ Node: H, PortSide: PortSide.E });
            return c;
        });

        const vertsOf = (c: Connector): Point[] => {
            const f = (c.Geometry as PathGeometry).Figures[0]!;
            return [f.StartPoint, ...f.Segments.map(s => (s as unknown as { Point: Point }).Point)];
        };
        const orient = (a: Point, b: Point, p: Point): number =>
            (b.X - a.X) * (p.Y - a.Y) - (b.Y - a.Y) * (p.X - a.X);
        const cross = (p: Point[], q: Point[]): boolean => {
            for (let i = 1; i < p.length; i++) for (let j = 1; j < q.length; j++)
            {
                const a = p[i - 1]!, b = p[i]!, c = q[j - 1]!, d = q[j]!;
                const o1 = orient(a, b, c), o2 = orient(a, b, d);
                const o3 = orient(c, d, a), o4 = orient(c, d, b);
                if ((o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0) && o1 && o2 && o3 && o4) return true;
            }
            return false;
        };

        for (let i = 0; i < cs.length; i++)
            for (let j = i + 1; j < cs.length; j++)
                assert.ok(!cross(vertsOf(cs[i]!), vertsOf(cs[j]!)),
                    `connectors ${i + 1} and ${j + 1} must not cross after the reorder pass`);
    });

    test('removing a side-anchored connector rebalances the rest', () => {
        // Start with three on E (slots at Y = 120, 140, 160). Drop
        // c2 by re-pinning its endpoint to a FreePoint, leaving c1
        // and c3. They should re-center at the N=2 symmetric pair.
        const fig = makeFigure(100, 100, 80, 80, []);
        const c1 = new Connector();
        c1.RoutingMode = RoutingMode.Straight;
        c1.Source = new ConnectorEndpoint({ Node: fig, PortSide: PortSide.E });
        c1.Target = new ConnectorEndpoint({ FreePoint: new Point(500, 100) });
        const c2 = new Connector();
        c2.RoutingMode = RoutingMode.Straight;
        c2.Source = new ConnectorEndpoint({ Node: fig, PortSide: PortSide.E });
        c2.Target = new ConnectorEndpoint({ FreePoint: new Point(500, 140) });
        const c3 = new Connector();
        c3.RoutingMode = RoutingMode.Straight;
        c3.Source = new ConnectorEndpoint({ Node: fig, PortSide: PortSide.E });
        c3.Target = new ConnectorEndpoint({ FreePoint: new Point(500, 200) });

        // N=3 baseline.
        assert.equal(startOf(c1).Y, 120);
        assert.equal(startOf(c2).Y, 140);
        assert.equal(startOf(c3).Y, 160);

        // Unregister c2 by reassigning its source to a FreePoint.
        c2.Source = new ConnectorEndpoint({ FreePoint: new Point(50, 50) });

        // c1 and c3 must rebalance to the N=2 symmetric pair.
        const y1 = startOf(c1).Y;
        const y3 = startOf(c3).Y;
        assert.ok(Math.abs((y1 - 140) + (y3 - 140)) < 1e-9,
            `expected symmetry around 140 after rebalance, got [${y1}, ${y3}]`);
        assert.notEqual(y1, 120);   // shifted from the old slot 0 of 3
        assert.notEqual(y3, 160);   // shifted from the old slot 2 of 3
    });
});

// ── Path 4 — auto-pick closest ───────────────────────────────────────

describe('Connector resolution path 4 — closest-port auto-pick', () => {
    test('picks the port closest to the other endpoint', () => {
        const fig = makeFigure(100, 100, 80, 80, [
            new Port({ Side: PortSide.N, X: 0.5, Y: 0   }),   // (140, 100)
            new Port({ Side: PortSide.S, X: 0.5, Y: 1   }),   // (140, 180)
            new Port({ Side: PortSide.E, X: 1,   Y: 0.5 }),   // (180, 140)
            new Port({ Side: PortSide.W, X: 0,   Y: 0.5 }),   // (100, 140)
        ]);
        // Source connector with no port addressing → path 4 auto-picks.
        // Target far south → closest port is S-side at (140, 180).
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = new ConnectorEndpoint({ Node: fig });
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(140, 500) });
        const start = startOf(c);
        assert.equal(start.X, 140);
        assert.equal(start.Y, 180);
    });
});

// ── Path 5 — geometric clip (bbox) ───────────────────────────────────

describe('Connector resolution path 5 — bbox geometric clip', () => {
    test('bbox clip determines the side, bake re-routes through path 3a center', () => {
        // ExplicitPorts = [] skips paths 2-4. The first-pass resolve
        // hits path 5: centroid (140, 140) → target (500, 200), exit
        // through the right edge → side = E.
        //
        // bakeSideIfBare pins PortSide = E. The same recompute then
        // re-resolves through path 3a (slot 0 of 1 on the E side) and
        // routes from the side-center anchor (180, 140) — NOT the
        // pre-bake off-center clip point (180, 146.66). The path-5
        // clip remains reachable as the bake's side-picking signal,
        // but no longer drives the final anchor.
        const fig = makeFigure(100, 100, 80, 80, []);
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.AnchorClip  = AnchorClip.Bbox;
        c.Source = new ConnectorEndpoint({ Node: fig });
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(500, 200) });
        const start = startOf(c);
        assert.equal(start.X, 180);
        assert.equal(start.Y, 140);
        assert.equal((c.Source as ConnectorEndpoint).PortSide, PortSide.E);
    });

    test('AnchorClip.Geometry throws (v1 limitation)', () => {
        const fig = makeFigure(100, 100, 80, 80, []);
        const c = new Connector();
        c.AnchorClip = AnchorClip.Geometry;
        c.Source = new ConnectorEndpoint({ Node: fig });
        // Geometry compute happens synchronously on Target set —
        // the throw fires from there.
        assert.throws(
            () => { c.Target = new ConnectorEndpoint({ FreePoint: new Point(500, 200) }); },
            (err: Error) => {
                assert.match(err.message, /AnchorClip\.Geometry/);
                return true;
            },
        );
    });
});

// ── Source-move reactivity ───────────────────────────────────────────

describe('Connector reactivity — source / target node moves', () => {
    test('bumping source Figure.Left re-routes', () => {
        const fig = makeFigure(100, 100, 80, 80, []);  // path 5
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = new ConnectorEndpoint({ Node: fig });
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(500, 200) });
        const before = startOf(c).X;
        fig.Left = 200;
        const after = startOf(c).X;
        // Right edge shifts from 180 to 280.
        assert.equal(before, 180);
        assert.equal(after,  280);
    });

    test('bumping target Figure.Top re-routes', () => {
        const fig = makeFigure(300, 100, 80, 80, []);
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = new ConnectorEndpoint({ FreePoint: new Point(0, 50) });
        c.Target = new ConnectorEndpoint({ Node: fig });
        // Target end point is on the figure's left edge initially.
        const before = (c.Geometry as PathGeometry).Figures[0]!.Segments[0]!;
        const beforeEnd = (before as { Point: Point }).Point;
        fig.Top = 200;
        const after = (c.Geometry as PathGeometry).Figures[0]!.Segments[0]!;
        const afterEnd = (after as { Point: Point }).Point;
        assert.notEqual(beforeEnd.Y, afterEnd.Y);
    });

    test('replacing Source.Node detaches old node listeners and attaches new', () => {
        const figA = makeFigure(100, 100, 80, 80, []);
        const figB = makeFigure(300, 300, 80, 80, []);
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        const src = new ConnectorEndpoint({ Node: figA });
        c.Source = src;
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(500, 200) });
        const beforeSwap = startOf(c).X;     // resolved against figA centroid → exit x=180

        src.Node = figB;                     // ConnectorEndpoint's Node DP swap
        const afterSwap = startOf(c).X;      // resolved against figB centroid → exit x=380
        assert.notEqual(beforeSwap, afterSwap);
        assert.equal(beforeSwap, 180);
        assert.equal(afterSwap,  380);

        // After swap, mutating figA should NOT trigger re-route.
        figA.Left = 999;
        assert.equal(startOf(c).X, afterSwap);
    });

    test('moving an attached figure clears the connector waypoints (re-route clean)', () => {
        const src = makeFigure(100, 100, 80, 80, []);
        const tgt = makeFigure(400, 100, 80, 80, []);
        const c = new Connector();
        c.RoutingMode = RoutingMode.Orthogonal;
        c.Source = new ConnectorEndpoint({ Node: src, PortSide: PortSide.E });
        c.Target = new ConnectorEndpoint({ Node: tgt, PortSide: PortSide.W });
        c.Waypoints = [waypoint(new Point(250, 100)), waypoint(new Point(250, 300))];   // auto (unpinned)
        assert.equal(c.Waypoints!.length, 2, 'waypoints set before the move');

        src.Left = 150;                       // move the source figure
        assert.equal(c.Waypoints, undefined, 'waypoints cleared on figure move');
        assert.ok(c.Geometry !== undefined, 're-routed clean to the new position');
    });

    test('moving an attached figure discards pinned waypoints too (full reroute)', () => {
        const src = makeFigure(100, 100, 80, 80, []);
        const tgt = makeFigure(400, 100, 80, 80, []);
        const c = new Connector();
        c.RoutingMode = RoutingMode.Orthogonal;
        c.Source = new ConnectorEndpoint({ Node: src, PortSide: PortSide.E });
        c.Target = new ConnectorEndpoint({ Node: tgt, PortSide: PortSide.W });
        c.Waypoints = [waypoint(new Point(250, 60), true), waypoint(new Point(250, 300))];   // one pin, one auto

        src.Left = 150;                       // move the source figure
        // A moved figure recalculates ALL waypoints — even the user-pinned one is
        // dropped, so the connector re-routes clean to the figure's new position.
        assert.equal(c.Waypoints, undefined,
            'both the auto vertex AND the user pin are cleared on figure move');
        assert.ok(c.Geometry !== undefined, 're-routed clean to the new position');
    });

    test('resizing the source Figure.Width re-routes (perimeter anchor follows)', () => {
        const fig = makeFigure(100, 100, 80, 80, []);  // right edge = 180
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = new ConnectorEndpoint({ Node: fig });
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(500, 200) });
        const before = startOf(c).X;
        fig.Width = 180;                       // grow width → right edge 180 → 280
        const after = startOf(c).X;
        assert.equal(before, 180);
        assert.equal(after,  280);
    });

    test('resizing the target Figure.Height re-routes', () => {
        const fig = makeFigure(300, 100, 80, 80, []);
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = new ConnectorEndpoint({ FreePoint: new Point(0, 50) });
        c.Target = new ConnectorEndpoint({ Node: fig });
        const before = (c.Geometry as PathGeometry).Figures[0]!.Segments[0]! as { Point: Point };
        const beforeEndY = before.Point.Y;
        fig.Height = 400;                      // taller figure → left-edge anchor shifts
        const after = (c.Geometry as PathGeometry).Figures[0]!.Segments[0]! as { Point: Point };
        assert.notEqual(beforeEndY, after.Point.Y);
    });

    test('resizing an attached figure PRESERVES waypoints (unlike a move)', () => {
        const src = makeFigure(100, 100, 80, 80, []);
        const tgt = makeFigure(400, 100, 80, 80, []);
        const c = new Connector();
        c.RoutingMode = RoutingMode.Orthogonal;
        c.Source = new ConnectorEndpoint({ Node: src, PortSide: PortSide.E });
        c.Target = new ConnectorEndpoint({ Node: tgt, PortSide: PortSide.W });
        c.Waypoints = [waypoint(new Point(250, 100), true), waypoint(new Point(250, 300))];   // one pin, one auto

        src.Width = 120;                       // resize (Width only, Left unchanged)
        // A resize reroutes against the new rect but keeps user bends — a move
        // would have dropped them (see the move tests above).
        assert.notEqual(c.Waypoints, undefined, 'waypoints survive a resize');
        assert.equal(c.Waypoints!.length, 2, 'both vertices retained');
        assert.ok(c.Geometry !== undefined, 're-routed against the new size');
    });

    test('replacing Source.Node stops resize reactivity on the old node', () => {
        const figA = makeFigure(100, 100, 80, 80, []);
        const figB = makeFigure(300, 300, 80, 80, []);
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        const src = new ConnectorEndpoint({ Node: figA });
        c.Source = src;
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(500, 200) });

        src.Node = figB;                       // swap
        const afterSwap = startOf(c).X;
        figA.Width = 999;                      // resizing the OLD node must not re-route
        assert.equal(startOf(c).X, afterSwap, 'old node resize is ignored after swap');
    });

    test('moving the TARGET figure also clears the waypoints', () => {
        const src = makeFigure(100, 100, 80, 80, []);
        const tgt = makeFigure(400, 100, 80, 80, []);
        const c = new Connector();
        c.RoutingMode = RoutingMode.Orthogonal;
        c.Source = new ConnectorEndpoint({ Node: src, PortSide: PortSide.E });
        c.Target = new ConnectorEndpoint({ Node: tgt, PortSide: PortSide.W });
        c.Waypoints = [waypoint(new Point(250, 100))];   // auto (unpinned)

        tgt.Top = 250;
        assert.equal(c.Waypoints, undefined, 'waypoints cleared when the target figure moves');
    });
});

// ── Routing mode dispatch ────────────────────────────────────────────

describe('Connector — routing mode dispatch', () => {
    test('switching RoutingMode re-routes via the new router', () => {
        const src = new ConnectorEndpoint({ FreePoint: new Point(0, 0) });
        const tgt = new ConnectorEndpoint({ FreePoint: new Point(100, 50) });
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = src;
        c.Target = tgt;
        // Straight: 1 segment.
        const straightSegs = (c.Geometry as PathGeometry).Figures[0]!.Segments.length;
        assert.equal(straightSegs, 1);

        c.RoutingMode = RoutingMode.Orthogonal;
        // Orthogonal with two free-floating endpoints: both have
        // path-1 derived sides. For source(0,0) → target(100,50) the
        // toward-target dominant cardinal is E (X-axis dominates the
        // 100-vs-50 magnitude); target's side faces "back from line"
        // = W. Both X-axis with sY≠tY → Z-shape, 3 segments.
        const orthogonalSegs = (c.Geometry as PathGeometry).Figures[0]!.Segments.length;
        assert.equal(orthogonalSegs, 3);
    });

    test('RoutingMode = Bezier emits cubic segments', () => {
        const src = new ConnectorEndpoint({ FreePoint: new Point(0, 0) });
        const tgt = new ConnectorEndpoint({ FreePoint: new Point(100, 50) });
        const c = new Connector();
        c.RoutingMode = RoutingMode.Bezier;
        c.Source = src;
        c.Target = tgt;
        const segs = (c.Geometry as PathGeometry).Figures[0]!.Segments;
        // One cubic per knot pair, and no waypoints → 1 cubic.
        assert.equal(segs.length, 1);
        assert.equal(segs[0]!.constructor.name, 'CubicBezierSegment');
    });
});

// ── Waypoints ────────────────────────────────────────────────────────

describe('Connector — waypoints', () => {
    test('Waypoints DP flows into the route compute', () => {
        const src = new ConnectorEndpoint({ FreePoint: new Point(0,   0) });
        const tgt = new ConnectorEndpoint({ FreePoint: new Point(200, 0) });
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = src;
        c.Target = tgt;
        assert.equal((c.Geometry as PathGeometry).Figures[0]!.Segments.length, 1);

        c.Waypoints = [waypoint(new Point(100, 50))];
        // One waypoint → 2 segments through the polyline.
        assert.equal((c.Geometry as PathGeometry).Figures[0]!.Segments.length, 2);
    });

    test('a pinned waypoint appears in the route; a collinear auto waypoint is minimised out', () => {
        const src = new ConnectorEndpoint({ FreePoint: new Point(0,   0) });
        const tgt = new ConnectorEndpoint({ FreePoint: new Point(200, 0) });
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = src;
        c.Target = tgt;

        // A pinned bend off the src->tgt line: kept, so the route has 2 segments
        // and the rendered polyline passes through it.
        c.Waypoints = [waypoint(new Point(100, 50), true)];
        assert.equal(c.Waypoints![0]!.userAltered, true);
        assert.equal((c.Geometry as PathGeometry).Figures[0]!.Segments.length, 2);
        assert.ok(c.CurrentRoutePoints!.some(p => p.X === 100 && p.Y === 50), 'route passes through the pin');

        // An AUTO waypoint sitting on the straight line is redundant → the
        // minimiser drops it from the fed route → 1 segment (no bend).
        c.Waypoints = [waypoint(new Point(100, 0))];
        assert.equal((c.Geometry as PathGeometry).Figures[0]!.Segments.length, 1);
    });
});
