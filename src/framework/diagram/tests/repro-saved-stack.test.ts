// Regression: the user's saved-diagram connector stacking. Rebuilds the exact
// node positions + connector (node, side) topology from their diagram.diagram
// and asserts (a) the three shared sides fan into distinct slots on load and
// (b) repositioning an endpoint onto an occupied side fans rather than stacks.
//
// Post-redesign: the container Figure is the sole side-endpoint host for every
// node kind (content VMs route through their container, which mirrors the VM
// Id). Both the CREATE path (makeSideEndpoint → itemOf) and the REPOSITION path
// (edit adorner → itemOf) reference that Figure — so they share one side
// registry and fan. These nodes are modelled directly as shape Figures (what a
// content node's container is).

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { initTestApp } from '../../../basic/tests/test-app.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';
import { Connector } from '../connector.js';
import { Figure } from '../figure.js';
import { PortSide, type ResolvedPortSide } from '../port.js';
import { ConnectorEnd, RoutingMode } from '../routing/router.js';
import { ConnectorEditAdorner } from '../behaviors/connector-edit-adorner.js';
import { Point } from '../../../visual-engine/index.js';
import '../routing/straight-router.js';
import '../routing/orthogonal-router.js';

const NODES: Record<string, { left: number; top: number }> = {
    component5:  { left: 413.6, top: 448.25 },
    component6:  { left: 115.5, top: 235 },
    n8:          { left: 115.5, top: 460.25 },
    n9:          { left: 264.6, top: 844.5 },
    n10:         { left: 619.5, top: 247 },
    n11:         { left: 351,   top: 66 },
    component7:  { left: 839.5, top: 832.5 },
    component8:  { left: 820.7, top: 448.25 },
    component9:  { left: 1149,  top: 438.25 },
    component10: { left: 827.6, top: 159 },
    n12:         { left: 424,   top: 639.125 },
    n13:         { left: 619.5, top: 460.25 },
};

const EDGES: [string, ResolvedPortSide, string, ResolvedPortSide][] = [
    ['n8', PortSide.S, 'n9', PortSide.N],
    ['component8', PortSide.S, 'component7', PortSide.N],
    ['n10', PortSide.S, 'n13', PortSide.N],
    ['component5', PortSide.S, 'n12', PortSide.N],
    ['n12', PortSide.S, 'n9', PortSide.N],
    ['component10', PortSide.S, 'component8', PortSide.N],
    ['component8', PortSide.E, 'component9', PortSide.W],
    ['component6', PortSide.S, 'n8', PortSide.N],
    ['component6', PortSide.N, 'n11', PortSide.W],
    ['n11', PortSide.E, 'n10', PortSide.N],
    ['n11', PortSide.N, 'component10', PortSide.N],
    ['component6', PortSide.E, 'n11', PortSide.S],
    ['n8', PortSide.W, 'n11', PortSide.W],
    ['n10', PortSide.W, 'n11', PortSide.S],
    ['component5', PortSide.E, 'n13', PortSide.W],
    ['n13', PortSide.E, 'component8', PortSide.W],
    ['n8', PortSide.E, 'component5', PortSide.W],
    ['n9', PortSide.E, 'component7', PortSide.W],
    ['component7', PortSide.E, 'component9', PortSide.S],
];

describe('repro — saved-diagram shared-side fan', () => {
    beforeEach(() => { initTestApp(); });

    test('the three shared sides fan into distinct slots on load', () => {
        const nodes: Record<string, Figure> = {};
        for (const [id, p] of Object.entries(NODES))
        {
            const f = Figure.fromKind('rectangle', p.left, p.top, { width: 80, height: 80 });
            f.Id = id;
            nodes[id] = f;
        }

        const conns: Connector[] = [];
        for (const [s, ss, t, ts] of EDGES)
        {
            const c = new Connector();
            c.RoutingMode = RoutingMode.Orthogonal;
            c.Source = new ConnectorEndpoint({ Node: nodes[s], PortSide: ss });
            c.Target = new ConnectorEndpoint({ Node: nodes[t], PortSide: ts });
            conns.push(c);
        }

        // The three sides that host two connectors each.
        for (const [id, side] of [['n9', PortSide.N], ['n11', PortSide.W], ['n11', PortSide.S]] as const)
        {
            const count = nodes[id]!.GetSideEndpointCount(side);
            assert.equal(count, 2, `${id}|${side} should host 2 connectors`);
        }

        // And each pair occupies distinct slot indices (no stacking).
        const slotIdx = (id: string, side: ResolvedPortSide): number[] =>
            conns
                .flatMap(c => [c.Source, c.Target])
                .filter((e): e is ConnectorEndpoint => e !== undefined && e.Node === nodes[id] && e.PortSide === side)
                .map(e => nodes[id]!.GetSideSlot(e, side)?.index ?? -1);

        for (const [id, side] of [['n9', PortSide.N], ['n11', PortSide.W], ['n11', PortSide.S]] as const)
        {
            const idxs = slotIdx(id, side).sort();
            assert.deepEqual(idxs, [0, 1], `${id}|${side} connectors must occupy distinct slots 0 and 1`);
        }
    });

    test('repositioning a connector endpoint onto a side a sibling already holds FANS, not stacks', () => {
        // Node HOST already hosts connector B on its N side (created bound to the
        // host, as makeSideEndpoint → itemOf yields). The user drags connector A's
        // endpoint onto that same N side; EndDragOverTarget resolves the host
        // Figure. A must bind to the host (like B) so both share ONE side registry
        // and fan — not two registries stacking at the side centre.
        const host  = Figure.fromKind('rectangle', 300, 300, { width: 80, height: 80 }); host.Id  = 'host';
        const other = Figure.fromKind('rectangle', 300, 0,   { width: 80, height: 80 }); other.Id = 'other';
        const src   = Figure.fromKind('rectangle', 0,   300, { width: 80, height: 80 }); src.Id   = 'src';

        // B: already on host's N side.
        const b = new Connector();
        b.RoutingMode = RoutingMode.Orthogonal;
        b.Source = new ConnectorEndpoint({ Node: other, PortSide: PortSide.S });
        b.Target = new ConnectorEndpoint({ Node: host,  PortSide: PortSide.N });

        // A: currently on host's W side; reposition its target onto N.
        const a = new Connector();
        a.RoutingMode = RoutingMode.Orthogonal;
        a.Source = new ConnectorEndpoint({ Node: src,  PortSide: PortSide.E });
        a.Target = new ConnectorEndpoint({ Node: host, PortSide: PortSide.W });

        const adorner = new ConnectorEditAdorner();
        adorner.BeginEndpointDrag(a, ConnectorEnd.Target, new Point(340, 340));
        adorner.EndDragOverTarget(host, PortSide.N);

        // A's target must now reference the host Figure, and its N side hosts BOTH.
        assert.equal(a.Target!.Node, host, 'repositioned endpoint binds to the container/host Figure');
        assert.equal(host.GetSideEndpointCount(PortSide.N), 2, 'both connectors register on the SAME side registry');
        const ia = host.GetSideSlot(a.Target as ConnectorEndpoint, PortSide.N)?.index;
        const ib = host.GetSideSlot(b.Target as ConnectorEndpoint, PortSide.N)?.index;
        assert.ok(ia !== undefined && ib !== undefined && ia !== ib, 'they occupy distinct slots (no centre stack)');
    });
});
