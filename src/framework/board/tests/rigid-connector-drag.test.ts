// Rigid-translate of connectors internal to a multi-selection drag:
// Board.BeginRigidConnectorDrag snapshots connectors whose BOTH endpoint
// nodes are in the moving set AND that carry user waypoints, then slides
// those waypoints by the accumulated drag delta. Boundary connectors (one
// end outside) and pure auto-routed internal ones are deliberately not
// tracked. See [rigid-connector-drag.ts] + Figure's drag wiring.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { Application, ObservableCollection, type MuralBase } from '../../../runtime/index.js';
import { Point } from '../../../visual-engine/index.js';
import { waypoint } from '../route-waypoint.js';
import { Connector } from '../connector.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';
import { Board } from '../board.js';
import { Figure } from '../figure.js';
import '../routing/straight-router.js';
import '../routing/orthogonal-router.js';

function fig(left: number, top: number): Figure
{
    const f = new Figure();
    f.Left = left; f.Top = top; f.Width = 40; f.Height = 40;
    return f;
}
function connWith(src: Figure, tgt: Figure, waypoints?: readonly Point[]): Connector
{
    const c = new Connector();
    c.Source = new ConnectorEndpoint({ Node: src });
    c.Target = new ConnectorEndpoint({ Node: tgt });
    if (waypoints !== undefined) c.Waypoints = waypoints.map(p => waypoint(p, true));   // user pins
    return c;
}
function newBoard(connectors: Connector[]): Board
{
    Application.current = null; new Application();
    const d = new Board();
    const coll = new ObservableCollection<MuralBase>();
    for (const c of connectors) coll.Add(c);
    d.Connectors = coll;
    return d;
}

describe('Board.BeginRigidConnectorDrag', () => {
    test('translates an internal connector\'s waypoints; leaves a boundary one untouched', () => {
        const a = fig(0, 0), b = fig(200, 0), c = fig(0, 200);
        const internal = connWith(a, b, [new Point(100, 10), new Point(100, 30)]);
        const boundary = connWith(a, c, [new Point(10, 100)]);
        const d = newBoard([internal, boundary]);

        const session = d.BeginRigidConnectorDrag(new Set<MuralBase>([a, b]));
        assert.ok(session !== undefined, 'session opens — an internal connector has waypoints');

        session!.Translate(5, 7);

        const iwp = internal.Waypoints!;
        assert.deepEqual([iwp[0]!.point.X, iwp[0]!.point.Y], [105, 17]);
        assert.deepEqual([iwp[1]!.point.X, iwp[1]!.point.Y], [105, 37]);

        // Boundary connector is not tracked — the session never touches it
        // (its reroute is the per-figure clear, exercised by the real drag).
        const bwp = boundary.Waypoints!;
        assert.deepEqual([bwp[0]!.point.X, bwp[0]!.point.Y], [10, 100]);
    });

    test('accumulates successive deltas against the original snapshot', () => {
        const a = fig(0, 0), b = fig(200, 0);
        const internal = connWith(a, b, [new Point(100, 10)]);
        const d = newBoard([internal]);

        const session = d.BeginRigidConnectorDrag(new Set<MuralBase>([a, b]))!;
        session.Translate(5, 7);
        session.Translate(3, 4);                 // running total (8, 11)

        const wp = internal.Waypoints!;
        assert.deepEqual([wp[0]!.point.X, wp[0]!.point.Y], [108, 21]);
    });

    test('translate preserves the userAltered flag on each pin', () => {
        const a = fig(0, 0), b = fig(200, 0);
        const internal = connWith(a, b, [new Point(100, 10)]);   // pinned via connWith
        const d = newBoard([internal]);
        const session = d.BeginRigidConnectorDrag(new Set<MuralBase>([a, b]))!;
        session.Translate(10, 5);
        const w = internal.Waypoints![0]!;
        assert.deepEqual([w.point.X, w.point.Y, w.userAltered], [110, 15, true]);
    });

    test('returns undefined when no internal connector carries waypoints', () => {
        const a = fig(0, 0), b = fig(200, 0), c = fig(0, 200);
        // boundary WITH waypoints + internal WITHOUT waypoints → nothing to track.
        const d = newBoard([connWith(a, c, [new Point(10, 100)]), connWith(a, b)]);
        assert.equal(d.BeginRigidConnectorDrag(new Set<MuralBase>([a, b])), undefined);
    });
});
