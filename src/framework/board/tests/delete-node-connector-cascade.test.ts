// Models the user's question: when a node with attached connectors is deleted,
// the connectors vanish from the CANVAS — but do they vanish from the MODEL
// (doc.Connectors), or do they linger invisibly and get saved as ghosts?

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { Application } from '../../../runtime/index.js';
import { GeometryCombineMode } from '../commands/combine.js';
import { Figure } from '../figure.js';
import { Connector } from '../connector.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';
import { BoardDocument, type BoardStorage } from '../board-document.js';
import { PortSide } from '../port.js';
import '../routing/straight-router.js';
import '../routing/orthogonal-router.js';
import '../serialization/node-serializers-default.js';

class MemoryStorage implements BoardStorage
{
    private readonly _map = new Map<string, string>();
    public GetItem(k: string): string | null { return this._map.get(k) ?? null; }
    public SetItem(k: string, v: string): void { this._map.set(k, v); }
}

function newDoc(storage?: BoardStorage): BoardDocument
{
    Application.current = null;
    new Application();
    return new BoardDocument(storage);
}

describe('delete node → connector cascade', () => {
    test('DeleteNodes removes attached connectors from the MODEL (doc.Connectors)', () => {
        const doc = newDoc();
        const a = Figure.fromKind('rectangle', 100, 100); a.Id = 'a'; doc.Nodes.Add(a);
        const b = Figure.fromKind('rectangle', 300, 100); b.Id = 'b'; doc.Nodes.Add(b);
        doc.CreateConnector(
            new ConnectorEndpoint({ Node: a, PortSide: PortSide.E }),
            new ConnectorEndpoint({ Node: b, PortSide: PortSide.W }));
        assert.equal(doc.Connectors.Count, 1);

        doc.DeleteNodes([a]);

        // The cascade must drop the connector from the model, not just hide it.
        assert.equal(doc.Nodes.Count, 1, 'node a removed');
        assert.equal(doc.Connectors.Count, 0, 'attached connector removed from the model too');
    });

    test('an ORPHANED connector (endpoint node-less, no free point) FAILS the save loudly and writes NO ghost', () => {
        // Models the failure mode: a connector left in doc.Connectors whose
        // endpoint lost its node WITHOUT the cascade removing the connector.
        // Previously this serialized as `{}` → reloaded as FreePoint(0,0) → a
        // self-perpetuating ghost. serializeEndpoint now THROWS on it; Save's
        // guard turns that into an aborted save (Status shows the failure) so
        // the corrupt record is never written to storage.
        const storage = new MemoryStorage();
        const doc = newDoc(storage);
        const a = Figure.fromKind('rectangle', 100, 100); a.Id = 'a'; doc.Nodes.Add(a);
        const b = Figure.fromKind('rectangle', 300, 100); b.Id = 'b'; doc.Nodes.Add(b);
        doc.CreateConnector(
            new ConnectorEndpoint({ Node: a, PortSide: PortSide.E }),
            new ConnectorEndpoint({ Node: b, PortSide: PortSide.W }))!.Target!.Node = undefined;

        doc.Save();

        // Nothing persisted (the throw aborted _serialize before SetItem), and
        // the failure is surfaced — NOT silently swallowed into a good "Saved".
        assert.equal(storage.GetItem('mural-board-state-v1'), null, 'no ghost written to storage');
        assert.match(doc.Status, /Save failed.*no persistable anchor/,
            'the empty-endpoint throw surfaces as a failed save');
        assert.equal(doc.IsDirty, true, 'a failed save leaves the doc dirty (not falsely marked clean)');
    });

    test('cascade matches by node Id, catching a connector on a STALE object', () => {
        // The connector references a DIFFERENT node object than the one in
        // doc.Nodes, but with the same Id (simulates a connector left pointing
        // at a pre-reload/rebind node instance). Deleting the real node with
        // identity-only matching would miss the connector and orphan it; Id
        // matching removes it.
        const doc = newDoc();
        const a = Figure.fromKind('rectangle', 100, 100); a.Id = 'a'; doc.Nodes.Add(a);
        const b = Figure.fromKind('rectangle', 300, 100); b.Id = 'b'; doc.Nodes.Add(b);
        const staleA = Figure.fromKind('rectangle', 100, 100); staleA.Id = 'a';   // same Id, other object
        doc.CreateConnector(
            new ConnectorEndpoint({ Node: staleA, PortSide: PortSide.E }),   // points at the stale object
            new ConnectorEndpoint({ Node: b, PortSide: PortSide.W }));
        assert.equal(doc.Connectors.Count, 1);

        doc.DeleteNodes([a]);   // delete the REAL node in the scene

        assert.equal(doc.Nodes.Count, 1, 'real node a removed');
        assert.equal(doc.Connectors.Count, 0, 'connector on the stale same-Id object is still cascaded out');
    });

    test('CombineSelection cascades connectors attached to the combined-away leaves', () => {
        const doc = newDoc();
        const a = Figure.fromKind('rectangle', 100, 100); a.Id = 'a'; doc.Nodes.Add(a);
        const b = Figure.fromKind('rectangle', 130, 130); b.Id = 'b'; doc.Nodes.Add(b);
        const other = Figure.fromKind('rectangle', 400, 100); other.Id = 'o'; doc.Nodes.Add(other);
        // Connector between the two shapes that will be combined away.
        doc.CreateConnector(
            new ConnectorEndpoint({ Node: a, PortSide: PortSide.E }),
            new ConnectorEndpoint({ Node: b, PortSide: PortSide.W }));
        // Connector from a combined leaf to a survivor.
        doc.CreateConnector(
            new ConnectorEndpoint({ Node: a, PortSide: PortSide.S }),
            new ConnectorEndpoint({ Node: other, PortSide: PortSide.W }));
        assert.equal(doc.Connectors.Count, 2);

        doc.CombineSelection([a, b], GeometryCombineMode.Union);

        // Both connectors touched a combined-away leaf → both removed; no ghost
        // left pointing at `a` or `b`.
        assert.equal(doc.Connectors.Count, 0, 'connectors on combined leaves are cascaded out');
    });

    test('a node removed WITHOUT cascade leaves the connector hidden but still in the model', () => {
        // Demonstrates WHY the canvas can lie: an orphaned connector cannot
        // route (its endpoint node is gone) so it renders nothing — yet it is
        // still a live entry in doc.Connectors. Visual absence ≠ model absence.
        const doc = newDoc();
        const a = Figure.fromKind('rectangle', 100, 100); a.Id = 'a'; doc.Nodes.Add(a);
        const b = Figure.fromKind('rectangle', 300, 100); b.Id = 'b'; doc.Nodes.Add(b);
        const c = doc.CreateConnector(
            new ConnectorEndpoint({ Node: a, PortSide: PortSide.E }),
            new ConnectorEndpoint({ Node: b, PortSide: PortSide.W }))!;

        // Remove node `a` from the collection directly — the NON-cascading path
        // (as Combine/Ungroup do). The connector is NOT removed.
        doc.Nodes.RemoveAt(doc.Nodes.IndexOf(a));

        assert.equal(doc.Connectors.Count, 1, 'connector lingers in the model despite its node being gone');
        // And its geometry: with the source node still referenced (object alive,
        // just out of the collection) it may still route; the point of the test
        // is the model-count, which the canvas cannot show you.
        void c;
    });
});
