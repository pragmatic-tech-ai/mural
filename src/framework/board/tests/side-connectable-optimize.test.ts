// Regression: the side-intersection optimizer lived only on Figure, and the
// connector invoked it duck-typed with optional chaining — so connectors sharing
// a node's side were never fanned out to avoid crossings unless the host carried
// the optimizer. The optimizer now lives in the shared SideEndpointRegistry, the
// container Figure (the sole side-endpoint host for every node kind) delegates to
// it, and it is part of the ISideEndpointHost contract (a typed call, no ?.
// no-op). These tests pin the fix on Figure hosts (content nodes now route
// through their container Figure, which is exactly what these shape Figures are).

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { initTestApp } from '../../../basic/tests/test-app.js';
import { PathGeometry, Point } from '../../../visual-engine/index.js';
import { Figure } from '../figure.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';
import { Connector } from '../connector.js';
import { PortSide } from '../port.js';
import { RoutingMode } from '../routing/router.js';
// Side-effect imports — register the routers under their RoutingMode names.
import '../routing/straight-router.js';
import '../routing/orthogonal-router.js';
import '../routing/bezier-router.js';

function makeVM(left: number, top: number, w: number, h: number): Figure
{
    return Figure.fromKind('rectangle', left, top, { width: w, height: h });
}

function startY(conn: Connector): number
{
    return (conn.Geometry as PathGeometry).Figures[0]!.StartPoint.Y;
}

describe('Figure — side-intersection optimizer runs on Figure hosts', () => {
    beforeEach(() => { initTestApp(); });

    test('two crossing connectors on a VM node’s E side get swapped to un-cross', () => {
        // Same topology as the Figure optimizer test, but the source + targets
        // are Figures. Built in CROSSING order: c1 → T2 (lower)
        // first takes top slot 0, c2 → T1 (upper) second takes bottom slot 1,
        // so the two straight runs cross. The optimizer must swap them.
        const F  = makeVM(100, 100, 80, 80);
        const T1 = makeVM(300, 50,  80, 80);   // upper target
        const T2 = makeVM(300, 200, 80, 80);   // lower target

        const c1 = new Connector();
        c1.RoutingMode = RoutingMode.Straight;
        c1.Source = new ConnectorEndpoint({ Node: F,  PortSide: PortSide.E });
        c1.Target = new ConnectorEndpoint({ Node: T2, PortSide: PortSide.W });

        const c2 = new Connector();
        c2.RoutingMode = RoutingMode.Straight;
        c2.Source = new ConnectorEndpoint({ Node: F,  PortSide: PortSide.E });
        c2.Target = new ConnectorEndpoint({ Node: T1, PortSide: PortSide.W });

        // c1 (→ lower target T2) ends at the lower slot 1; c2 (→ upper T1) at 0.
        const slot1 = F.GetSideSlot(c1.Source as ConnectorEndpoint, PortSide.E);
        const slot2 = F.GetSideSlot(c2.Source as ConnectorEndpoint, PortSide.E);
        assert.ok(slot1 !== undefined && slot2 !== undefined);
        assert.equal(slot1!.index, 1, 'c1 (→ lower target) must end at the lower slot');
        assert.equal(slot2!.index, 0, 'c2 (→ upper target) must end at the upper slot');

        // And the resulting source Y positions reflect the swap.
        assert.ok(startY(c1) > startY(c2),
            `expected c1 below c2 on side E, got c1.Y=${startY(c1)} c2.Y=${startY(c2)}`);
    });

    test('THREE connectors settle to a fully crossing-free order', () => {
        // Regression for the stale-geometry bug: the optimizer used to run
        // inside the triggering connector's own recompute, where that
        // connector's `_recomputing` guard suppressed its re-route — so
        // crossings were measured against a stale route and 3+ connectors
        // settled on a WRONG (still-crossing) order. Now the optimizer runs
        // after the guard releases, so every route is fresh when measured.
        const F  = makeVM(100, 100, 80, 80);
        const T1 = makeVM(400, 60,  80, 80);   // top
        const T2 = makeVM(400, 140, 80, 80);   // middle
        const T3 = makeVM(400, 220, 80, 80);   // bottom

        // Insertion order deliberately scrambled: bottom target first.
        const mk = (tgt: Figure): Connector => {
            const c = new Connector();
            c.RoutingMode = RoutingMode.Straight;
            c.Source = new ConnectorEndpoint({ Node: F,   PortSide: PortSide.E });
            c.Target = new ConnectorEndpoint({ Node: tgt, PortSide: PortSide.W });
            return c;
        };
        const cTop = mk(T1), cMid = mk(T2), cBot = mk(T3);

        // Each connector's source Y must be ordered like its target: the one
        // heading to the top target sits at the top slot, etc. → no crossings.
        const y = (c: Connector): number => startY(c);
        assert.ok(y(cTop) < y(cMid) && y(cMid) < y(cBot),
            `expected top<mid<bottom source Y, got [${y(cTop)}, ${y(cMid)}, ${y(cBot)}]`);
    });

    test('a clean (non-crossing) VM setup is left untouched', () => {
        // Natural non-crossing order — c1 → T1 (upper) first at slot 0, c2 → T2
        // (lower) second at slot 1. Total crossings already 0, so the hill-climb
        // makes no swaps.
        const F  = makeVM(100, 100, 80, 80);
        const T1 = makeVM(300, 50,  80, 80);
        const T2 = makeVM(300, 200, 80, 80);

        const c1 = new Connector();
        c1.RoutingMode = RoutingMode.Straight;
        c1.Source = new ConnectorEndpoint({ Node: F,  PortSide: PortSide.E });
        c1.Target = new ConnectorEndpoint({ Node: T1, PortSide: PortSide.W });

        const c2 = new Connector();
        c2.RoutingMode = RoutingMode.Straight;
        c2.Source = new ConnectorEndpoint({ Node: F,  PortSide: PortSide.E });
        c2.Target = new ConnectorEndpoint({ Node: T2, PortSide: PortSide.W });

        assert.equal(F.GetSideSlot(c1.Source as ConnectorEndpoint, PortSide.E)!.index, 0);
        assert.equal(F.GetSideSlot(c2.Source as ConnectorEndpoint, PortSide.E)!.index, 1);
    });

    test('a Node-bearing endpoint with a stale FreePoint still joins the side-slot fan', () => {
        // The corrupt state behind the "both connectors stack on the side
        // centre" bug: an endpoint carries Node + PortSide AND a vestigial
        // FreePoint. endpointSideSlot bailed on the FreePoint, so the endpoint
        // dropped to a geometric-clip centre and never registered on the side —
        // its sibling then saw count 1 and also sat at centre. The recompute now
        // clears the vestigial FreePoint so the endpoint fans normally.
        const F  = makeVM(100, 100, 80, 80);
        const T1 = makeVM(300, 50,  80, 80);
        const T2 = makeVM(300, 200, 80, 80);

        const c1 = new Connector();
        c1.RoutingMode = RoutingMode.Straight;
        c1.Source = new ConnectorEndpoint({ Node: F,  PortSide: PortSide.E, FreePoint: new Point(999, 999) });
        c1.Target = new ConnectorEndpoint({ Node: T1, PortSide: PortSide.W });

        const c2 = new Connector();
        c2.RoutingMode = RoutingMode.Straight;
        c2.Source = new ConnectorEndpoint({ Node: F,  PortSide: PortSide.E });
        c2.Target = new ConnectorEndpoint({ Node: T2, PortSide: PortSide.W });

        // The vestigial FreePoint is cleared on recompute...
        assert.equal(c1.Source!.FreePoint, undefined, 'stale FreePoint cleared once the endpoint has a Node');
        // ...so BOTH sources register on F's E side (count 2) and take distinct
        // slots instead of stacking on the same centre point.
        assert.equal(F.GetSideEndpointCount(PortSide.E), 2, 'both endpoints registered on the side');
        const s1 = F.GetSideSlot(c1.Source as ConnectorEndpoint, PortSide.E);
        const s2 = F.GetSideSlot(c2.Source as ConnectorEndpoint, PortSide.E);
        assert.ok(s1 !== undefined && s2 !== undefined, 'both endpoints have a side slot');
        assert.notEqual(s1!.index, s2!.index, 'the two endpoints occupy different slots');
        assert.notEqual(startY(c1), startY(c2), 'they do not stack on the same centre point');
    });
});
