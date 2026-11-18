// Slice #3a T2: a connector endpoint that references a content-VM node by id
// resolves to the VM's CONTAINER Figure (the geometry owner), not the VM.
// On load the endpoint is deferred (UnresolvedNodeId); when the container
// binds, the document re-points the endpoint at it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application, ObservableCollection, Size, Visual } from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { Board } from '../board.js';
import { Figure } from '../figure.js';
import { NodeViewModel } from '../node-view-model.js';
import { BoardDocument, type BoardStorage } from '../board-document.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';
import { registerNodeSerializer } from '../serialization/node-serialization.js';
import '../serialization/node-serializers-default.js';

// Stand-in content-VM serializer (Plexus supplies ArchNodeVM in anger).
const CONN_VM_TYPE = 'connvm';
registerNodeSerializer({
    type: CONN_VM_TYPE,
    matches: (n) => n instanceof NodeViewModel,
    serialize: () => ({}),
    deserialize: () => new NodeViewModel(),
});

class MemoryStorage implements BoardStorage
{
    private readonly _map = new Map<string, string>();
    public GetItem(key: string): string | null { return this._map.get(key) ?? null; }
    public SetItem(key: string, value: string): void { this._map.set(key, value); }
}

function payload(): string
{
    return JSON.stringify({
        version: 3,
        nodes: [
            { id: 'a', type: CONN_VM_TYPE, data: {} },
            { id: 'b', type: CONN_VM_TYPE, data: {} },
        ],
        visuals: {
            a: { left: 0,   top: 0, w: 60, h: 40 },
            b: { left: 200, top: 0, w: 60, h: 40 },
        },
        connectors: [{ source: { nodeId: 'a' }, target: { nodeId: 'b' } }],
        nextId: 1,
    });
}

function mountView(doc: BoardDocument): Board
{
    const board = new Board();
    board.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
    board.DataContext = doc;
    board.ItemsSource = doc.Nodes;
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = board;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    return board;
}

describe('connector endpoints resolve to the container Figure for VM nodes', () => {
    test('on load a VM-referencing endpoint is deferred (not bound to the VM)', () => {
        Application.current = null; new Application();
        const storage = new MemoryStorage();
        storage.SetItem('mural-board-state-v1', payload());
        const doc = new BoardDocument(storage);
        doc.Load();

        assert.equal(doc.Connectors.Count, 1);
        const c = doc.Connectors.Get(0)!;
        // Deferred: no live Node (the geometry-owning container isn't realized),
        // the id is preserved for re-point.
        assert.equal(c.Source!.Node, undefined, 'source not bound to the VM');
        assert.equal(c.Source!.UnresolvedNodeId, 'a');
        assert.equal(c.Target!.UnresolvedNodeId, 'b');
    });

    test('after realize each endpoint points at its container Figure', () => {
        Application.current = null; new Application();
        const storage = new MemoryStorage();
        storage.SetItem('mural-board-state-v1', payload());
        const doc = new BoardDocument(storage);
        doc.Load();
        const [a, b] = [doc.Nodes.Get(0)!, doc.Nodes.Get(1)!];

        const board = mountView(doc);
        const ca = board.Generator.ContainerFromItem(a);
        const cb = board.Generator.ContainerFromItem(b);
        assert.ok(ca instanceof Figure && cb instanceof Figure, 'VM items wrapped in containers');

        const c = doc.Connectors.Get(0)!;
        assert.equal(c.Source!.Node, ca, 'source re-pointed at container A');
        assert.equal(c.Target!.Node, cb, 'target re-pointed at container B');
        assert.equal(c.Source!.UnresolvedNodeId, undefined, 'hold cleared on source');
        assert.equal(c.Target!.UnresolvedNodeId, undefined, 'hold cleared on target');
        // The container carries the geometry the router reads (nodeRect).
        assert.equal((c.Target!.Node as Figure).Left, 200);
        assert.equal((c.Target!.Node as Figure).Width, 60);
    });

    // Regression: a connector CREATED programmatically (e.g. a model-projected
    // edge in the Plexus arch binding) AFTER the containers already bound. No
    // fresh ContainerBound fires for an already-realized container, so the old
    // re-point-on-bind path never catches it. CreateConnector must resolve a
    // content-VM endpoint to its geometry-owning container up front, or the
    // connector routes against a geometry-less VM → Geometry undefined → the
    // edge never draws (the "connectors didn't show" report).
    test('CreateConnector resolves a VM endpoint to its already-bound container', () => {
        Application.current = null; new Application();
        const storage = new MemoryStorage();
        // Two VM nodes, NO serialized connector — the edge is added later.
        storage.SetItem('mural-board-state-v1', JSON.stringify({
            version: 3,
            nodes: [
                { id: 'a', type: CONN_VM_TYPE, data: {} },
                { id: 'b', type: CONN_VM_TYPE, data: {} },
            ],
            visuals: { a: { left: 0, top: 0, w: 60, h: 40 }, b: { left: 200, top: 0, w: 60, h: 40 } },
            connectors: [],
            nextId: 1,
        }));
        const doc = new BoardDocument(storage);
        doc.Load();
        const [a, b] = [doc.Nodes.Get(0)!, doc.Nodes.Get(1)!];

        // View up FIRST: both containers realize and bind now.
        const board = mountView(doc);
        const ca = board.Generator.ContainerFromItem(a);
        const cb = board.Generator.ContainerFromItem(b);
        assert.ok(ca instanceof Figure && cb instanceof Figure, 'VM items wrapped in containers');

        // THEN create the edge pointing at the VMs (the binding's timing).
        const c = doc.CreateConnector(
            new ConnectorEndpoint({ Node: a }),
            new ConnectorEndpoint({ Node: b }),
        );
        assert.ok(c !== null);

        // The endpoints must land on the geometry-owning containers, not the VMs.
        assert.equal(c!.Source!.Node, ca, 'source resolved to container A');
        assert.equal(c!.Target!.Node, cb, 'target resolved to container B');
        assert.equal(c!.Source!.UnresolvedNodeId, undefined);
        // With real geometry to route to, the connector actually draws.
        assert.notEqual(c!.Geometry, undefined, 'connector routed (Geometry set)');
    });
});
