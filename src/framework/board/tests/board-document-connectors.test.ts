// Step 13 / § 9 of [docs/connectors.md](../../../../docs/connectors.md):
// pins BoardDocument's Connectors collection + CreateConnector /
// DeleteConnectors / cascade-on-Figure-delete + Save/Load round-trip,
// plus the attach-standard-mutations wiring of the ConnectorCreated
// event through to BoardMutator.CreateConnector.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { Application, ObservableCollection } from '../../../runtime/index.js';
import { Point } from '../../../visual-engine/index.js';
import { waypoint } from '../route-waypoint.js';
import { Connector } from '../connector.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';
import { Board } from '../board.js';
import { BoardDocument, type BoardStorage } from '../board-document.js';
import { Figure } from '../figure.js';
import { PortSide } from '../port.js';
import { RoutingMode } from '../routing/router.js';
import { attachStandardBoardMutations } from '../behaviors/attach-standard-mutations.js';
import '../routing/straight-router.js';
import '../routing/orthogonal-router.js';

// ── In-memory BoardStorage for the Save / Load round-trip ──────────

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

// ── Collection initialisation ────────────────────────────────────────

describe('BoardDocument — Connectors collection', () => {
    test('initializes Connectors as an empty ObservableCollection', () => {
        const doc = newDoc();
        assert.ok(doc.Connectors instanceof ObservableCollection);
        assert.equal(doc.Connectors.Count, 0);
    });
});

// ── CreateConnector / DeleteConnectors ───────────────────────────────

describe('BoardDocument — CreateConnector / DeleteConnectors', () => {
    test('CreateConnector adds a Connector with the supplied Source/Target endpoints', () => {
        const doc = newDoc();
        const src = new ConnectorEndpoint({ FreePoint: new Point(10, 10) });
        const tgt = new ConnectorEndpoint({ FreePoint: new Point(50, 50) });
        const c = doc.CreateConnector(src, tgt);
        assert.ok(c !== null);
        assert.equal(doc.Connectors.Count, 1);
        assert.equal(doc.Connectors.Get(0), c);
        assert.equal(c!.Source, src);
        assert.equal(c!.Target, tgt);
    });

    test('DeleteConnectors removes the named entries; orthogonal entries stay', () => {
        const doc = newDoc();
        const a = doc.CreateConnector(
            new ConnectorEndpoint({ FreePoint: new Point(0, 0) }),
            new ConnectorEndpoint({ FreePoint: new Point(10, 10) }))!;
        const b = doc.CreateConnector(
            new ConnectorEndpoint({ FreePoint: new Point(20, 20) }),
            new ConnectorEndpoint({ FreePoint: new Point(30, 30) }))!;
        doc.DeleteConnectors([a]);
        assert.equal(doc.Connectors.Count, 1);
        assert.equal(doc.Connectors.Get(0), b);
    });

    test('DeleteConnectors unregisters the deleted endpoint so siblings redistribute', () => {
        const doc = newDoc();
        // Construct Figures directly so GetSideEndpointCount (a Figure-specific
        // method) and port tracking are available.  CreateNode now emits a
        // shape Figure, and the port-side registry lives on Figure itself;
        // using Figure.fromKind is the right seam here.
        const hub = Figure.fromKind('rectangle',   0, 100); hub.Id = 'hub'; doc.Nodes.Add(hub);
        const t1  = Figure.fromKind('rectangle', 300,  20); t1.Id  = 't1';  doc.Nodes.Add(t1);
        const t2  = Figure.fromKind('rectangle', 300, 100); t2.Id  = 't2';  doc.Nodes.Add(t2);
        const t3  = Figure.fromKind('rectangle', 300, 180); t3.Id  = 't3';  doc.Nodes.Add(t3);

        const share = (tgt: Figure): Connector => doc.CreateConnector(
            new ConnectorEndpoint({ Node: hub, PortSide: PortSide.E }),
            new ConnectorEndpoint({ Node: tgt, PortSide: PortSide.W }))!;
        const c1 = share(t1);
        share(t2);
        share(t3);

        // Three connectors share hub's East side → three dynamic slots.
        assert.equal(hub.GetSideEndpointCount(PortSide.E), 3);

        doc.DeleteConnectors([c1]);

        // The deleted connector must drop out of the side registry so the
        // remaining two re-space across two slots.
        assert.equal(hub.GetSideEndpointCount(PortSide.E), 2);
    });
});

// ── Cascade: deleting a Figure drops connectors referencing it ───────

describe('BoardDocument — Figure delete cascades to dependent connectors', () => {
    test('a connector whose Source.Node is a deleted Figure is auto-removed', () => {
        const doc = newDoc();
        const fig = doc.CreateNode('rectangle', 100, 100)!;
        const other = doc.CreateNode('rectangle', 300, 100)!;
        doc.CreateConnector(
            new ConnectorEndpoint({ Node: fig }),
            new ConnectorEndpoint({ Node: other }));
        doc.CreateConnector(
            new ConnectorEndpoint({ FreePoint: new Point(0, 0) }),    // unrelated
            new ConnectorEndpoint({ FreePoint: new Point(50, 50) }));
        assert.equal(doc.Connectors.Count, 2);

        doc.DeleteNodes([fig]);
        // The connector touching `fig` is dropped; the unrelated one survives.
        assert.equal(doc.Connectors.Count, 1);
    });
});

// ── Save / Load round-trip ───────────────────────────────────────────

describe('BoardDocument — Save / Load round-trips connectors', () => {
    test('a derived (system-projected) connector is excluded from serialization', () => {
        const storage = new MemoryStorage();
        const doc = newDoc(storage);
        const a = doc.CreateNode('rectangle', 100, 100)!;
        const b = doc.CreateNode('ellipse',   300, 100)!;
        // One user connector + one derived (projection-owned) connector.
        doc.CreateConnector(new ConnectorEndpoint({ Node: a }), new ConnectorEndpoint({ Node: b }));
        const derived = doc.CreateConnector(new ConnectorEndpoint({ Node: b }), new ConnectorEndpoint({ Node: a }))!;
        derived.IsDerived = true;
        assert.equal(doc.Connectors.Count, 2, 'both live on the canvas');

        doc.Save();
        const restored = newDoc(storage);
        restored.Storage = storage;
        restored.Load();
        // Only the user connector persisted; the derived one is re-projected by its
        // owner, never saved — so it does not duplicate on reload.
        assert.equal(restored.Connectors.Count, 1, 'derived connector not persisted');
    });

    test('node-anchored endpoints rehydrate by node Id', () => {
        const storage = new MemoryStorage();
        const doc = newDoc(storage);

        // CreateNode emits a shape Figure (serializable via the 'shape' registry).
        const a = doc.CreateNode('rectangle', 100, 100)!;
        const b = doc.CreateNode('ellipse',   300, 100)!;
        const c = doc.CreateConnector(
            new ConnectorEndpoint({ Node: a, PortName: 'out' }),
            new ConnectorEndpoint({ Node: b }))!;
        c.RoutingMode = RoutingMode.Straight;
        c.Waypoints = [waypoint(new Point(200, 50), true)];

        doc.Save();

        // Tear down + start fresh.
        const restored = newDoc(storage);
        restored.Storage = storage;
        restored.Load();

        assert.equal(restored.Nodes.Count, 2);
        assert.equal(restored.Connectors.Count, 1);
        const rA = restored.Nodes.Get(0)!;
        const rB = restored.Nodes.Get(1)!;
        const rC = restored.Connectors.Get(0)!;
        assert.equal(rC.Source!.Node, rA);
        assert.equal(rC.Source!.PortName, 'out');
        assert.equal(rC.Target!.Node, rB);
        assert.equal(rC.RoutingMode, RoutingMode.Straight);
        assert.equal(rC.Waypoints!.length, 1);
        assert.equal(rC.Waypoints![0]!.point.X, 200);
        assert.equal(rC.Waypoints![0]!.point.Y, 50);
        assert.equal(rC.Waypoints![0]!.userAltered, true, 'pin flag round-trips');
    });

    test('mixed pinned/auto waypoints round-trip with flags intact', () => {
        const storage = new MemoryStorage();
        const doc = newDoc(storage);
        const a = doc.CreateNode('rectangle', 0, 0)!;
        const b = doc.CreateNode('ellipse', 200, 0)!;
        const c = doc.CreateConnector(new ConnectorEndpoint({ Node: a }), new ConnectorEndpoint({ Node: b }))!;
        c.Waypoints = [waypoint(new Point(60, 40), true), waypoint(new Point(120, 40))];
        doc.Save();

        const restored = newDoc(storage);
        restored.Storage = storage;
        restored.Load();
        const wps = restored.Connectors.Get(0)!.Waypoints!;
        assert.deepEqual(
            wps.map(w => [w.point.X, w.point.Y, w.userAltered]),
            [[60, 40, true], [120, 40, false]]);
    });

    test('legacy waypoints without userAltered load as pinned', () => {
        const storage = new MemoryStorage();
        const doc = newDoc(storage);
        const a = doc.CreateNode('rectangle', 0, 0)!;
        const b = doc.CreateNode('ellipse', 200, 0)!;
        const c = doc.CreateConnector(new ConnectorEndpoint({ Node: a }), new ConnectorEndpoint({ Node: b }))!;
        c.Waypoints = [waypoint(new Point(70, 8))];
        doc.Save();

        // Simulate a pre-flag scene: strip userAltered from the persisted waypoints.
        const KEY = 'mural-board-state-v1';
        const raw = JSON.parse(storage.GetItem(KEY)!) as { connectors: { waypoints: { x: number; y: number }[] }[] };
        raw.connectors[0]!.waypoints = raw.connectors[0]!.waypoints.map(w => ({ x: w.x, y: w.y }));
        storage.SetItem(KEY, JSON.stringify(raw));

        const restored = newDoc(storage);
        restored.Storage = storage;
        restored.Load();
        const w = restored.Connectors.Get(0)!.Waypoints![0]!;
        assert.equal(w.point.X, 70);
        assert.equal(w.userAltered, true, 'legacy waypoint pins');
    });

    test('free-floating endpoints round-trip through FreePoint', () => {
        const storage = new MemoryStorage();
        const doc = newDoc(storage);
        doc.CreateConnector(
            new ConnectorEndpoint({ FreePoint: new Point(7, 11) }),
            new ConnectorEndpoint({ FreePoint: new Point(42, 17) }));

        doc.Save();
        const restored = newDoc(storage);
        restored.Storage = storage;
        restored.Load();
        const rC = restored.Connectors.Get(0)!;
        assert.equal(rC.Source!.FreePoint!.X, 7);
        assert.equal(rC.Source!.FreePoint!.Y, 11);
        assert.equal(rC.Target!.FreePoint!.X, 42);
        assert.equal(rC.Target!.FreePoint!.Y, 17);
    });

    test('endpoint PortSide / PortIndex round-trip (a hand-placed side is kept)', () => {
        const storage = new MemoryStorage();
        const doc = newDoc(storage);
        const a = doc.CreateNode('ellipse',   0,   0)!;
        const b = doc.CreateNode('rectangle', 300, 0)!;
        const c = doc.CreateConnector(new ConnectorEndpoint({ Node: a }), new ConnectorEndpoint({ Node: b }))!;
        // Simulate the user dragging each endpoint onto a specific side.
        c.Source!.PortSide = PortSide.E;
        c.Target!.PortSide = PortSide.N;
        c.Target!.PortIndex = 1;
        doc.Save();

        const restored = newDoc(storage);
        restored.Storage = storage;
        restored.Load();
        const rC = restored.Connectors.Get(0)!;
        assert.equal(rC.Source!.PortSide, PortSide.E, 'source side preserved');
        assert.equal(rC.Target!.PortSide, PortSide.N, 'target side preserved');
        assert.equal(rC.Target!.PortIndex, 1, 'target slot preserved');
    });

    test('an endpoint whose node is absent on load PRESERVES its nodeId (no origin collapse)', () => {
        const storage = new MemoryStorage();
        const doc = newDoc(storage);
        const a = doc.CreateNode('rectangle', 100, 100)!;
        const b = doc.CreateNode('ellipse',   300, 100)!;
        doc.CreateConnector(
            new ConnectorEndpoint({ Node: a }),
            new ConnectorEndpoint({ Node: b, PortName: 'in' }))!;
        doc.Save();

        // Simulate 'b' being unloadable (e.g. its node serializer wasn't
        // registered yet): drop its node record but keep the connector that
        // references it by id.
        const KEY = 'mural-board-state-v1';
        const raw = JSON.parse(storage.GetItem(KEY)!) as {
            nodes: { id: string }[];
            connectors: { target: { nodeId?: string } }[];
        };
        const bId = raw.nodes[1]!.id;
        raw.nodes = raw.nodes.filter(n => n.id !== bId);
        storage.SetItem(KEY, JSON.stringify(raw));

        const restored = newDoc(storage);
        restored.Storage = storage;
        restored.Load();

        // The node is gone, but the reference is PRESERVED — not destroyed by
        // collapsing to FreePoint(0,0).
        const rC = restored.Connectors.Get(0)!;
        assert.equal(rC.Target!.Node, undefined);
        assert.equal(rC.Target!.FreePoint, undefined, 'must NOT collapse to a free point');
        assert.equal(rC.Target!.UnresolvedNodeId, bId, 'nodeId preserved for later re-bind');
        assert.equal(rC.Target!.PortName, 'in', 'portName preserved too');

        // Re-saving keeps the id — the corruption is not baked in.
        restored.Save();
        const raw2 = JSON.parse(storage.GetItem(KEY)!) as {
            connectors: { target: { nodeId?: string; freeX?: number } }[];
        };
        assert.equal(raw2.connectors[0]!.target.nodeId, bId, 're-save preserves the id');
        assert.equal(raw2.connectors[0]!.target.freeX, undefined, 'no origin free point written');

        // Recovery: with the node record present again, the endpoint re-binds.
        raw2.connectors[0]!.target.nodeId = bId;
        const withNode = raw2 as unknown as { nodes: unknown[] };
        withNode.nodes = [{ type: 'shape', id: bId, left: 300, top: 100, w: 80, h: 80, data: { kind: 'ellipse', d: '' } }];
        storage.SetItem(KEY, JSON.stringify(withNode));
        const recovered = newDoc(storage);
        recovered.Storage = storage;
        recovered.Load();
        assert.equal(recovered.Connectors.Get(0)!.Target!.Node, recovered.Nodes.Get(0), 're-binds to the node');
    });

    test('Load with a payload missing the connectors field leaves Connectors empty', () => {
        const storage = new MemoryStorage();
        // Hand-craft a v3 node-only payload (no connectors field).
        storage.SetItem('mural-board-state-v1', JSON.stringify({
            version: 3,
            nodes: [{ id: 'n1', type: 'shape', data: { kind: 'rectangle', d: '' } }],
            visuals: { n1: { left: 0, top: 0, w: 80, h: 80 } },
            nextId: 2,
        }));
        const doc = newDoc(storage);
        doc.Load();
        assert.equal(doc.Nodes.Count, 1);
        assert.equal(doc.Connectors.Count, 0);
    });
});

// ── attach-standard-mutations wires ConnectorCreated → CreateConnector ─

describe('attachStandardBoardMutations — connector flow', () => {
    test('ConnectorCreated event forwards to mutator.CreateConnector', () => {
        const doc  = newDoc();
        const diag = new Board();
        const detach = attachStandardBoardMutations(diag, doc);

        const src = new ConnectorEndpoint({ FreePoint: new Point(0, 0) });
        const tgt = new ConnectorEndpoint({ FreePoint: new Point(100, 0) });
        diag._fireConnectorCreated({ Source: src, Target: tgt });

        assert.equal(doc.Connectors.Count, 1);
        const c = doc.Connectors.Get(0)!;
        assert.equal(c.Source, src);
        assert.equal(c.Target, tgt);

        detach();
    });

    test('DeleteRequested with non-empty Connectors forwards to mutator.DeleteConnectors', () => {
        const doc  = newDoc();
        const diag = new Board();
        const detach = attachStandardBoardMutations(diag, doc);

        const a = doc.CreateConnector(
            new ConnectorEndpoint({ FreePoint: new Point(0, 0) }),
            new ConnectorEndpoint({ FreePoint: new Point(1, 1) }))!;
        const b = doc.CreateConnector(
            new ConnectorEndpoint({ FreePoint: new Point(2, 2) }),
            new ConnectorEndpoint({ FreePoint: new Point(3, 3) }))!;

        diag._fireDeleteRequested({ Items: [], Connectors: [a] });
        assert.equal(doc.Connectors.Count, 1);
        assert.equal(doc.Connectors.Get(0), b);

        detach();
    });

    test('DeleteRequested with empty Connectors skips the connector branch', () => {
        const doc  = newDoc();
        const diag = new Board();
        attachStandardBoardMutations(diag, doc);

        const a = doc.CreateConnector(
            new ConnectorEndpoint({ FreePoint: new Point(0, 0) }),
            new ConnectorEndpoint({ FreePoint: new Point(1, 1) }))!;
        diag._fireDeleteRequested({ Items: [], Connectors: [] });
        assert.equal(doc.Connectors.Count, 1);
        assert.equal(doc.Connectors.Get(0), a);
    });
});

// ── Materializer respects items-are-Connectors ──────────────────────

describe('BoardConnectorsMaterializer — items-are-Connectors', () => {
    test('a Connector entry IS the visual the materializer hands out', () => {
        Application.current = null;
        new Application();
        const board = new Board();
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = new ConnectorEndpoint({ FreePoint: new Point(0, 0) });
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(10, 0) });
        board.Connectors = new ObservableCollection<Connector>([c]);
        const v = board._getConnectorsMaterializerForTesting().MaterializedVisuals.get(c);
        // SAME identity — no wrap.
        assert.equal(v, c);
    });
});
