// Step 11 / § 9 of [docs/connectors.md](../../../../docs/connectors.md):
// pins the ConnectorEditAdorner state machine — endpoint re-anchor
// (§ 4.2) + waypoint add/move/remove (§ 4.3). Visual rendering of the
// drag handles lives in a follow-up step; the state machine drives
// the actual endpoint / waypoint mutations.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { Application } from '../../../runtime/index.js';
import { Point } from '../../../visual-engine/index.js';
import { waypoint } from '../route-waypoint.js';
import {
    attachConnectorEditAdorner,
    ConnectorEditAdorner,
} from '../behaviors/connector-edit-adorner.js';
import { Connector } from '../connector.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';
import { Figure } from '../figure.js';
import { PortSide } from '../port.js';
import { ConnectorEnd, RoutingMode } from '../routing/router.js';
import '../routing/straight-router.js';
import '../routing/orthogonal-router.js';

function newApplication(): void
{
    Application.current = null;
    new Application();
}

function fig(left: number, top: number): Figure
{
    const f = new Figure();
    f.Left = left;
    f.Top  = top;
    f.Width  = 80;
    f.Height = 80;
    f.ExplicitPorts = [];
    return f;
}

function makeConnector(): Connector
{
    const c = new Connector();
    c.RoutingMode = RoutingMode.Straight;
    c.Source = new ConnectorEndpoint({ FreePoint: new Point(0,   0) });
    c.Target = new ConnectorEndpoint({ FreePoint: new Point(100, 0) });
    return c;
}

// ── Endpoint drag — Begin → Update → End (target / empty / abort) ────

describe('ConnectorEditAdorner — endpoint drag (re-anchor)', () => {
    test('BeginEndpointDrag(source, cursor) snapshots + sets Source to FreePoint mode', () => {
        newApplication();
        const c = makeConnector();
        // Initial Source has FreePoint at (0, 0), no Node.
        const adorner = new ConnectorEditAdorner();
        adorner.BeginEndpointDrag(c, ConnectorEnd.Source, new Point(50, 50));
        assert.equal(adorner.IsActive, true);
        assert.equal(c.Source!.FreePoint!.X, 50);
        assert.equal(c.Source!.FreePoint!.Y, 50);
        assert.equal(c.Source!.Node, undefined);
    });

    test('BeginEndpointDrag on a Node-bound endpoint clears the Node + port-ref + sets FreePoint', () => {
        newApplication();
        const f = fig(100, 100);
        const c = makeConnector();
        c.Source = new ConnectorEndpoint({ Node: f, PortName: 'out' });
        const adorner = new ConnectorEditAdorner();
        adorner.BeginEndpointDrag(c, ConnectorEnd.Source, new Point(50, 50));
        assert.equal(c.Source!.Node, undefined);
        assert.equal(c.Source!.PortName, undefined);
        assert.equal(c.Source!.FreePoint!.X, 50);
    });

    test('UpdateCursor flows into the dragged endpoint FreePoint', () => {
        newApplication();
        const c = makeConnector();
        const adorner = new ConnectorEditAdorner();
        adorner.BeginEndpointDrag(c, ConnectorEnd.Target, new Point(150, 0));
        adorner.UpdateCursor(new Point(200, 25));
        assert.equal(c.Target!.FreePoint!.X, 200);
        assert.equal(c.Target!.FreePoint!.Y, 25);
    });

    test('EndDragOverTarget anchors to (target, side) + clears FreePoint / clears stale port refs', () => {
        newApplication();
        const target = fig(200, 100);
        const c = makeConnector();
        // Pre-existing PortName / PortIndex on the endpoint must clear
        // when re-anchored via side drag — otherwise the resolver's
        // path-2 / path-3 would beat the new side-slot resolution.
        c.Target = new ConnectorEndpoint({ Node: target, PortName: 'stale', PortIndex: 5 });
        const adorner = new ConnectorEditAdorner();
        adorner.BeginEndpointDrag(c, ConnectorEnd.Target, new Point(150, 0));
        adorner.EndDragOverTarget(target, PortSide.W);
        assert.equal(c.Target!.Node, target);
        assert.equal(c.Target!.PortSide, PortSide.W);
        assert.equal(c.Target!.PortName, undefined);
        assert.equal(c.Target!.PortIndex, undefined);
        assert.equal(c.Target!.FreePoint, undefined);
        assert.equal(adorner.IsActive, false);
    });

    test('EndDragOverTarget records each cardinal side correctly', () => {
        newApplication();
        for (const side of [PortSide.N, PortSide.S, PortSide.E, PortSide.W])
        {
            const target = fig(200, 100);
            const c = makeConnector();
            const adorner = new ConnectorEditAdorner();
            adorner.BeginEndpointDrag(c, ConnectorEnd.Target, new Point(150, 0));
            adorner.EndDragOverTarget(target, side);
            assert.equal(c.Target!.PortSide, side);
        }
    });

    test('EndDragOverEmpty restores the endpoint from snapshot', () => {
        newApplication();
        const original = fig(50, 50);
        const c = makeConnector();
        c.Source = new ConnectorEndpoint({ Node: original, PortName: 'out' });
        const adorner = new ConnectorEditAdorner();
        adorner.BeginEndpointDrag(c, ConnectorEnd.Source, new Point(0, 0));
        // mid-drag: endpoint is now FreePoint-mode.
        adorner.UpdateCursor(new Point(10, 10));
        // Drop over empty → restore.
        adorner.EndDragOverEmpty();
        assert.equal(c.Source!.Node, original);
        assert.equal(c.Source!.PortName, 'out');
        assert.equal(c.Source!.FreePoint, undefined);
        assert.equal(adorner.IsActive, false);
    });

    test('Abort restores the endpoint from snapshot', () => {
        newApplication();
        const original = fig(50, 50);
        const c = makeConnector();
        c.Source = new ConnectorEndpoint({ Node: original });
        const adorner = new ConnectorEditAdorner();
        adorner.BeginEndpointDrag(c, ConnectorEnd.Source, new Point(0, 0));
        adorner.Abort();
        assert.equal(c.Source!.Node, original);
    });

    test('EndDragOverTarget(undefined) restores the pre-drag anchor — never leaves the endpoint node-less', () => {
        // A drop that resolves NO target (released over empty space / a
        // non-Figure item) must restore the endpoint, not clear FreePoint while
        // assigning an undefined Node — which left a node-less orphan routing to
        // the origin.
        newApplication();
        const original = fig(50, 50);
        const c = makeConnector();
        c.Target = new ConnectorEndpoint({ Node: original, PortSide: PortSide.E });
        const adorner = new ConnectorEditAdorner();
        adorner.BeginEndpointDrag(c, ConnectorEnd.Target, new Point(150, 0));
        adorner.EndDragOverTarget(undefined as unknown as Figure, PortSide.E);
        assert.equal(c.Target!.Node, original, 'the pre-drag node is restored');
        assert.equal(
            c.Target!.Node === undefined && c.Target!.FreePoint === undefined,
            false,
            'the endpoint is never left without an anchor');
        assert.equal(adorner.IsActive, false);
    });
});

describe('Connector — unanchored-endpoint invariant', () => {
    test('a node-less + free-less endpoint hides the connector instead of routing to the origin', () => {
        newApplication();
        const c = makeConnector();          // both ends are FreePoints → routable
        c.RecomputeRoute();
        assert.notEqual(c.Geometry, undefined, 'a valid connector routes');

        // Orphan the target — no Node, no FreePoint. Path 1 would resolve it to
        // (0,0); the invariant must leave the connector un-drawn instead.
        c.Target = new ConnectorEndpoint();
        c.RecomputeRoute();
        assert.equal(c.Geometry, undefined,
            'an unanchored endpoint leaves the connector un-drawn, not snapped to (0,0)');
    });
});

// ── Waypoint drag (existing waypoint) ────────────────────────────────

describe('ConnectorEditAdorner — waypoint drag', () => {
    test('BeginWaypointDrag → UpdateCursor → EndDragOverEmpty commits new position', () => {
        newApplication();
        const c = makeConnector();
        c.Waypoints = [waypoint(new Point(50, 50)), waypoint(new Point(75, 25))];
        const adorner = new ConnectorEditAdorner();
        adorner.BeginWaypointDrag(c, 0);
        adorner.UpdateCursor(new Point(60, 60));
        adorner.EndDragOverEmpty();
        assert.equal(c.Waypoints![0]!.point.X, 60);
        assert.equal(c.Waypoints![0]!.point.Y, 60);
        // Untouched waypoint preserved.
        assert.equal(c.Waypoints![1]!.point.X, 75);
        assert.equal(c.Waypoints![1]!.point.Y, 25);
        assert.equal(adorner.IsActive, false);
    });

    test('Abort during a waypoint drag restores the snapshotted Waypoints array', () => {
        newApplication();
        const c = makeConnector();
        const initial = [waypoint(new Point(50, 50)), waypoint(new Point(75, 25))];
        c.Waypoints = initial;
        const adorner = new ConnectorEditAdorner();
        adorner.BeginWaypointDrag(c, 0);
        adorner.UpdateCursor(new Point(99, 99));
        adorner.Abort();
        assert.equal(c.Waypoints![0]!.point.X, 50);
        assert.equal(c.Waypoints![0]!.point.Y, 50);
    });

    test('BeginWaypointDrag with out-of-range index is a silent no-op', () => {
        newApplication();
        const c = makeConnector();
        c.Waypoints = [waypoint(new Point(50, 50))];
        const adorner = new ConnectorEditAdorner();
        adorner.BeginWaypointDrag(c, 99);
        assert.equal(adorner.IsActive, false);
    });
});

// ── Insert-and-drag (mid-segment ghost handle) ───────────────────────

describe('ConnectorEditAdorner — InsertWaypointAndDrag', () => {
    test('inserts the new waypoint at the requested index + immediately enters drag', () => {
        newApplication();
        const c = makeConnector();
        c.Waypoints = [waypoint(new Point(50, 50))];
        const adorner = new ConnectorEditAdorner();
        adorner.InsertWaypointAndDrag(c, 0, new Point(25, 25));
        assert.equal(c.Waypoints!.length, 2);
        assert.equal(c.Waypoints![0]!.point.X, 25);
        assert.equal(c.Waypoints![1]!.point.X, 50);
        assert.equal(adorner.IsActive, true);

        adorner.UpdateCursor(new Point(30, 30));
        assert.equal(c.Waypoints![0]!.point.X, 30);
        assert.equal(c.Waypoints![0]!.point.Y, 30);
    });

    test('Abort after Insert removes the just-inserted waypoint', () => {
        newApplication();
        const c = makeConnector();
        c.Waypoints = [waypoint(new Point(50, 50))];
        const adorner = new ConnectorEditAdorner();
        adorner.InsertWaypointAndDrag(c, 0, new Point(25, 25));
        adorner.Abort();
        assert.equal(c.Waypoints!.length, 1);
        assert.equal(c.Waypoints![0]!.point.X, 50);
    });

    test('EndDragOverEmpty after Insert keeps the new waypoint at its current position', () => {
        newApplication();
        const c = makeConnector();
        c.Waypoints = [];
        const adorner = new ConnectorEditAdorner();
        adorner.InsertWaypointAndDrag(c, 0, new Point(40, 40));
        adorner.UpdateCursor(new Point(45, 50));
        adorner.EndDragOverEmpty();
        assert.equal(c.Waypoints!.length, 1);
        assert.equal(c.Waypoints![0]!.point.X, 45);
        assert.equal(c.Waypoints![0]!.point.Y, 50);
    });
});

// ── RemoveWaypoint imperative API ────────────────────────────────────

describe('ConnectorEditAdorner — RemoveWaypoint', () => {
    test('removes the entry at the given index', () => {
        newApplication();
        const c = makeConnector();
        c.Waypoints = [waypoint(new Point(50, 50)), waypoint(new Point(75, 25)), waypoint(new Point(90, 10))];
        const adorner = new ConnectorEditAdorner();
        adorner.RemoveWaypoint(c, 1);
        assert.equal(c.Waypoints!.length, 2);
        assert.equal(c.Waypoints![0]!.point.X, 50);
        assert.equal(c.Waypoints![1]!.point.X, 90);
    });

    test('out-of-range index is a silent no-op', () => {
        newApplication();
        const c = makeConnector();
        c.Waypoints = [waypoint(new Point(50, 50))];
        const adorner = new ConnectorEditAdorner();
        adorner.RemoveWaypoint(c, 99);
        assert.equal(c.Waypoints!.length, 1);
    });
});

// ── Preemption + idle no-ops ─────────────────────────────────────────

describe('ConnectorEditAdorner — gesture preemption + idle no-ops', () => {
    test('Beginning a second drag while active aborts the previous', () => {
        newApplication();
        const original = fig(50, 50);
        const c = makeConnector();
        c.Source = new ConnectorEndpoint({ Node: original });
        c.Waypoints = [waypoint(new Point(50, 50))];
        const adorner = new ConnectorEditAdorner();
        adorner.BeginEndpointDrag(c, ConnectorEnd.Source, new Point(0, 0));
        adorner.BeginWaypointDrag(c, 0);
        // The endpoint mutation from the first Begin should be rolled
        // back by the implicit Abort.
        assert.equal(c.Source!.Node, original);
        assert.equal(adorner.IsActive, true);
    });

    test('UpdateCursor / End* / Abort while idle are silent no-ops', () => {
        newApplication();
        const c = makeConnector();
        const adorner = new ConnectorEditAdorner();
        adorner.UpdateCursor(new Point(0, 0));      // no-op
        adorner.EndDragOverEmpty();                 // no-op
        adorner.Abort();                            // no-op
        adorner.EndDragOverTarget(fig(0, 0), undefined); // waypoint drags don't have targets either
        assert.equal(adorner.IsActive, false);
    });
});

// ── Segment drag — perpendicular slide of a RENDERED-route segment ───
//
// BeginSegmentDrag indexes the rendered route (source → bends → target),
// not Waypoints. With Straight routing the route is exactly
// [source, ...waypoints, target], so a connector with waypoints
// (40,30),(120,30),(120,90) and FreePoint endpoints (0,0)/(100,0) renders
// as route indices:
//   0: (0,0)→(40,30)     source-adjacent (diagonal)
//   1: (40,30)→(120,30)  interior, horizontal
//   2: (120,30)→(120,90) interior, vertical
//   3: (120,90)→(100,0)  target-adjacent (diagonal)

describe('ConnectorEditAdorner — segment drag (perpendicular slide)', () => {
    // Route with two clean interior segments (one H, one V) between bends.
    function wpConnector(): Connector
    {
        const c = makeConnector();
        c.Waypoints = [waypoint(new Point(40, 30)), waypoint(new Point(120, 30)), waypoint(new Point(120, 90))];
        return c;
    }

    test('an interior horizontal segment moves only vertically — both ends take cursor.Y, keep X', () => {
        newApplication();
        const c = wpConnector();
        const adorner = new ConnectorEditAdorner();
        adorner.BeginSegmentDrag(c, 1);                  // route seg 1 = (40,30)→(120,30)
        assert.equal(adorner.IsActive, true);
        adorner.UpdateCursor(new Point(999, 75));        // X ignored, Y drives
        const wps = c.Waypoints!;
        assert.equal(wps[0]!.point.X, 40,  'left end keeps its X');
        assert.equal(wps[1]!.point.X, 120, 'right end keeps its X');
        assert.equal(wps[0]!.point.Y, 75,  'left end snaps to cursor Y');
        assert.equal(wps[1]!.point.Y, 75,  'right end snaps to cursor Y');
        assert.equal(wps[2]!.point.Y, 90,  'the next bend is untouched');
    });

    test('an interior vertical segment moves only horizontally — both ends take cursor.X, keep Y', () => {
        newApplication();
        const c = wpConnector();
        const adorner = new ConnectorEditAdorner();
        adorner.BeginSegmentDrag(c, 2);                  // route seg 2 = (120,30)→(120,90)
        adorner.UpdateCursor(new Point(160, 999));       // Y ignored, X drives
        const wps = c.Waypoints!;
        assert.equal(wps[1]!.point.Y, 30, 'top end keeps its Y');
        assert.equal(wps[2]!.point.Y, 90, 'bottom end keeps its Y');
        assert.equal(wps[1]!.point.X, 160, 'top end snaps to cursor X');
        assert.equal(wps[2]!.point.X, 160, 'bottom end snaps to cursor X');
        assert.equal(wps[0]!.point.X, 40,  'the prior bend is untouched');
    });

    // A source-adjacent axis-aligned segment: the port can't move, so the
    // gesture inserts a FIXED jog anchor (kept at the port's level) plus a
    // moving twin, then slides the segment + jog.
    function adjacentConnector(): Connector
    {
        const c = makeConnector();
        c.Source = new ConnectorEndpoint({ FreePoint: new Point(0, 0) });
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(60, 80) });
        c.Waypoints = [waypoint(new Point(60, 0))];
        return c;   // route: (0,0)→(60,0)→(60,80)
    }

    test('a source-adjacent horizontal segment inserts a jog rooted at the port, then slides', () => {
        newApplication();
        const c = adjacentConnector();
        const adorner = new ConnectorEditAdorner();
        adorner.BeginSegmentDrag(c, 0);                  // route seg 0 = source(0,0)→(60,0)
        adorner.UpdateCursor(new Point(999, -30));        // horizontal seg → Y drives
        const wps = c.Waypoints!;
        // [fixedAnchor, movingNear, movingFar]
        assert.equal(wps.length, 3, 'one jog anchor + moving twin + far end');
        assert.deepEqual({ X: wps[0]!.point.X, Y: wps[0]!.point.Y }, { X: 26, Y: 0 },
            'fixed jog anchor stays at the port level (Y=0)');
        assert.equal(wps[1]!.point.Y, -30, 'moving near end slid to cursor Y');
        assert.equal(wps[2]!.point.Y, -30, 'moving far end slid to cursor Y');
        assert.equal(wps[2]!.point.X, 60,  'far end keeps its X');
        assert.equal(c.Source!.FreePoint!.X, 0, 'source port stays pinned');
        assert.equal(c.Source!.FreePoint!.Y, 0);
    });

    test('a target-adjacent vertical segment inserts a jog rooted at the target, then slides', () => {
        newApplication();
        const c = adjacentConnector();
        const adorner = new ConnectorEditAdorner();
        adorner.BeginSegmentDrag(c, 1);                  // route seg 1 = (60,0)→target(60,80)
        adorner.UpdateCursor(new Point(90, 999));         // vertical seg → X drives
        const wps = c.Waypoints!;
        // [movingNear, movingFar, fixedAnchor]
        assert.equal(wps.length, 3);
        assert.equal(wps[0]!.point.X, 90, 'moving near end slid to cursor X');
        assert.equal(wps[1]!.point.X, 90, 'moving far end slid to cursor X');
        assert.equal(wps[0]!.point.Y, 0,  'near end keeps its Y');
        assert.deepEqual({ X: wps[2]!.point.X, Y: wps[2]!.point.Y }, { X: 60, Y: 54 },
            'fixed jog anchor stays on the target column (X=60)');
        assert.equal(c.Target!.FreePoint!.X, 60, 'target port stays pinned');
        assert.equal(c.Target!.FreePoint!.Y, 80);
    });

    test('Abort restores the pre-drag waypoints (un-materializes the route)', () => {
        newApplication();
        const c = wpConnector();
        const before = c.Waypoints!.map(p => ({ X: p.point.X, Y: p.point.Y }));
        const adorner = new ConnectorEditAdorner();
        adorner.BeginSegmentDrag(c, 1);
        adorner.UpdateCursor(new Point(0, 200));
        adorner.Abort();
        const after = c.Waypoints!;
        assert.deepEqual(after.map(p => ({ X: p.point.X, Y: p.point.Y })), before);
        assert.equal(adorner.IsActive, false);
    });

    test('EndDragOverEmpty commits the moved segment', () => {
        newApplication();
        const c = wpConnector();
        const adorner = new ConnectorEditAdorner();
        adorner.BeginSegmentDrag(c, 1);
        adorner.UpdateCursor(new Point(0, 55));
        adorner.EndDragOverEmpty();
        assert.equal(adorner.IsActive, false);
        assert.equal(c.Waypoints![0]!.point.Y, 55, 'committed Y persists');
        assert.equal(c.Waypoints![1]!.point.Y, 55);
    });

    test('a grab released with no move sheds the coincident jog anchor on commit', () => {
        newApplication();
        const c = adjacentConnector();
        const adorner = new ConnectorEditAdorner();
        adorner.BeginSegmentDrag(c, 0);                  // inserts a coincident [(26,0),(26,0),...]
        adorner.EndDragOverEmpty();                       // no UpdateCursor → degenerate jog
        const wps = c.Waypoints!;
        for (let i = 1; i < wps.length; i++)
        {
            assert.ok(!(wps[i]!.point.X === wps[i - 1]!.point.X && wps[i]!.point.Y === wps[i - 1]!.point.Y),
                'no coincident adjacent waypoints survive commit');
        }
    });

    test('a segment drag marks the moved vertices userAltered and keeps a prior pin', () => {
        newApplication();
        const c = makeConnector();
        // First waypoint is a user pin; the other two are auto bends.
        c.Waypoints = [waypoint(new Point(40, 30), true), waypoint(new Point(120, 30)), waypoint(new Point(120, 90))];
        const adorner = new ConnectorEditAdorner();
        adorner.BeginSegmentDrag(c, 2);                  // interior vertical seg (120,30)→(120,90)
        adorner.UpdateCursor(new Point(160, 999));        // X drives
        adorner.EndDragOverEmpty();
        const wps = c.Waypoints!;
        assert.ok(wps.some(w => w.userAltered && w.point.X === 40 && w.point.Y === 30), 'prior pin preserved');
        assert.ok(wps.some(w => w.userAltered && w.point.X === 160), 'dragged vertex is pinned');
    });

    test('BeginSegmentDrag on an out-of-range segment index is a no-op', () => {
        newApplication();
        const c = wpConnector();        // route has 5 points → segments 0..3
        const adorner = new ConnectorEditAdorner();
        adorner.BeginSegmentDrag(c, 4); // segment 4 needs route[5], absent
        assert.equal(adorner.IsActive, false);
    });
});

// ── Port-slot reorder via segment drag (position-based) ──────────────

describe('ConnectorEditAdorner — port-slot reorder via segment drag', () => {
    function sideFig(left: number, top: number): Figure
    {
        const f = new Figure();
        f.Left = left; f.Top = top; f.Width = 80; f.Height = 80;
        f.ExplicitPorts = [];
        return f;
    }
    function sideConn(hub: Figure, tgt: Figure): Connector
    {
        const c = new Connector();
        c.RoutingMode = RoutingMode.Orthogonal;
        c.Source = new ConnectorEndpoint({ Node: hub, PortSide: PortSide.E });
        c.Target = new ConnectorEndpoint({ Node: tgt, PortSide: PortSide.W });
        return c;
    }
    const idxOf = (hub: Figure, c: Connector): number | undefined =>
        hub.GetSideSlot(c.Source!, PortSide.E)?.index;

    test('dragging the port-adjacent segment down past a sibling swaps their slots', () => {
        newApplication();
        const hub = sideFig(0, 0);
        const c1 = sideConn(hub, sideFig(300, -40));   // slot 0 (upper)
        const c2 = sideConn(hub, sideFig(300, 160));   // slot 1 (lower)
        assert.equal(idxOf(hub, c1), 0);
        assert.equal(idxOf(hub, c2), 1);

        // Grab c1's source-adjacent (port) segment and drag it to the
        // lower slot — orthogonal routes here never transversally cross, so
        // the old anti-cross optimizer left them put. Position-based reorder
        // moves c1 to the slot under the cursor and c2 fills the gap.
        const adorner = new ConnectorEditAdorner();
        adorner.BeginSegmentDrag(c1, 0);
        adorner.UpdateCursor(new Point(120, 65));       // Y=65 → lower slot
        adorner.EndDragOverEmpty();

        assert.equal(idxOf(hub, c1), 1, 'c1 reordered to the lower slot');
        assert.equal(idxOf(hub, c2), 0, 'c2 shifted to the upper slot');
    });

    test('Abort restores the pre-drag slot order', () => {
        newApplication();
        const hub = sideFig(0, 0);
        const c1 = sideConn(hub, sideFig(300, -40));
        const c2 = sideConn(hub, sideFig(300, 160));

        const adorner = new ConnectorEditAdorner();
        adorner.BeginSegmentDrag(c1, 0);
        adorner.UpdateCursor(new Point(120, 65));        // moves c1 to slot 1
        assert.equal(idxOf(hub, c1), 1);
        adorner.Abort();

        assert.equal(idxOf(hub, c1), 0, 'c1 restored to its original slot');
        assert.equal(idxOf(hub, c2), 1);
    });
});

// ── attachConnectorEditAdorner convenience ───────────────────────────

describe('attachConnectorEditAdorner', () => {
    test('detach aborts an in-flight drag', () => {
        newApplication();
        const original = fig(50, 50);
        const c = makeConnector();
        c.Source = new ConnectorEndpoint({ Node: original });
        const { adorner, detach } = attachConnectorEditAdorner();
        adorner.BeginEndpointDrag(c, ConnectorEnd.Source, new Point(0, 0));
        detach();
        assert.equal(c.Source!.Node, original);
        assert.equal(adorner.IsActive, false);
    });
});
