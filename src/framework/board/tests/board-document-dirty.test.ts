// Dirty-on-edit tracking: a route drag, an endpoint reconnect, or a node move
// mutates a Connector / node DIRECTLY (not through a BoardDocument mutation
// method), so the document must observe those edits to flip IsDirty — otherwise
// the shell's Save command (gated on IsDirty) stays disabled and the change
// can't be saved.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { Application } from '../../../runtime/index.js';
import { Color, Pen, Point, SolidColorBrush } from '../../../visual-engine/index.js';
import { waypoint } from '../route-waypoint.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';
import { BoardDocument, type BoardStorage } from '../board-document.js';
import '../routing/straight-router.js';
import '../routing/orthogonal-router.js';

class MemoryStorage implements BoardStorage
{
    private readonly _map = new Map<string, string>();
    public GetItem(key: string): string | null { return this._map.get(key) ?? null; }
    public SetItem(key: string, value: string): void { this._map.set(key, value); }
}

function newDoc(storage?: BoardStorage): BoardDocument
{
    Application.current = null;
    new Application();
    return new BoardDocument(storage);
}

describe('BoardDocument — dirty-on-edit', () => {
    test('editing a connector Waypoints marks the document dirty', () => {
        const doc = newDoc();
        const a = doc.CreateNode('rectangle', 0, 0)!;
        const b = doc.CreateNode('ellipse', 200, 0)!;
        const c = doc.CreateConnector(new ConnectorEndpoint({ Node: a }), new ConnectorEndpoint({ Node: b }))!;
        // CreateNode/CreateConnector already dirtied — clear via Save to isolate.
        doc.Storage = new MemoryStorage();
        doc.Save();
        assert.equal(doc.IsDirty, false, 'precondition: clean after save');

        c.Waypoints = [waypoint(new Point(100, 40), true)];
        assert.equal(doc.IsDirty, true, 'a route drag dirties the document');
    });

    test('reconnecting an endpoint (Node change) marks the document dirty', () => {
        const doc = newDoc(new MemoryStorage());
        const a = doc.CreateNode('rectangle', 0, 0)!;
        const b = doc.CreateNode('ellipse', 200, 0)!;
        const cc = doc.CreateNode('rectangle', 400, 0)!;
        const c = doc.CreateConnector(new ConnectorEndpoint({ Node: a }), new ConnectorEndpoint({ Node: b }))!;
        doc.Save();
        assert.equal(doc.IsDirty, false);

        // Endpoint drag reattach mutates the SAME endpoint object's Node.
        c.Target!.Node = cc;
        assert.equal(doc.IsDirty, true, 'an endpoint reconnect dirties the document');
    });

    test('a fill-colour change marks the document dirty', () => {
        const doc = newDoc(new MemoryStorage());
        const s = doc.CreateNode('ellipse', 0, 0)!;
        doc.Save();
        assert.equal(doc.IsDirty, false);

        s.Fill = new SolidColorBrush(Color.FromHex('#00ff00'));
        assert.equal(doc.IsDirty, true, 'a Format-Shape fill edit dirties the document');
    });

    test('a stroke edit (in-place pen mutation) marks the document dirty', () => {
        const doc = newDoc(new MemoryStorage());
        const s = doc.CreateNode('ellipse', 0, 0)!;
        doc.Save();
        assert.equal(doc.IsDirty, false);

        // FormatMirror mutates the existing pen in place rather than swapping it.
        s.Stroke!.Thickness = 5;
        assert.equal(doc.IsDirty, true, 'an in-place stroke edit dirties the document');
    });

    test('moving a node marks the document dirty', () => {
        const doc = newDoc(new MemoryStorage());
        const a = doc.CreateNode('rectangle', 0, 0)!;
        doc.Save();
        assert.equal(doc.IsDirty, false);

        a.Left = 120;
        assert.equal(doc.IsDirty, true, 'a node move dirties the document');
    });

    test('Load leaves the document clean despite building routes', () => {
        const storage = new MemoryStorage();
        const doc = newDoc(storage);
        const a = doc.CreateNode('rectangle', 0, 0)!;
        const b = doc.CreateNode('ellipse', 200, 0)!;
        const c = doc.CreateConnector(new ConnectorEndpoint({ Node: a }), new ConnectorEndpoint({ Node: b }))!;
        c.Waypoints = [waypoint(new Point(100, 40), true)];
        doc.Save();

        const restored = newDoc(storage);
        restored.Storage = storage;
        restored.Load();
        assert.equal(restored.IsDirty, false, 'a freshly loaded document is not dirty');
    });

    test('a removed connector no longer dirties the document when edited', () => {
        const doc = newDoc(new MemoryStorage());
        const a = doc.CreateNode('rectangle', 0, 0)!;
        const b = doc.CreateNode('ellipse', 200, 0)!;
        const c = doc.CreateConnector(new ConnectorEndpoint({ Node: a }), new ConnectorEndpoint({ Node: b }))!;
        doc.DeleteConnectors([c]);
        doc.Save();
        assert.equal(doc.IsDirty, false);

        // Editing a detached connector must NOT dirty the document (listeners torn down).
        c.Waypoints = [waypoint(new Point(100, 40), true)];
        assert.equal(doc.IsDirty, false, 'edits to a removed connector are ignored');
    });
});
