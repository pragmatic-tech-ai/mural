// M3 connector-VM tests: connector endpoints must reference the shape node
// so routing/delete/serialize all track the node. A shape Figure IS the node
// now (no VM wrapper), so the endpoint's Node is the shape Figure itself.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { Application, ObservableCollection } from '../../../runtime/index.js';
import { Point } from '../../../visual-engine/index.js';
import { ConnectorCreateBehavior } from '../behaviors/connector-create-behavior.js';
import { Connector } from '../connector.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';
import { Board } from '../board.js';
import { BoardDocument, type BoardStorage } from '../board-document.js';
import { Figure } from '../figure.js';
import { NodeViewModel } from '../node-view-model.js';
import { PortSide } from '../port.js';
import '../routing/straight-router.js';
import '../routing/orthogonal-router.js';

// ── In-memory BoardStorage ──────────────────────────────────────────

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

// Build a shape Figure that is the node directly. A shape Figure IS the node
// now, so there's no VM wrapper — the endpoint resolves to the Figure itself.
function shapeNode(kind: string, left: number, top: number): Figure
{
    const f = Figure.fromKind(kind, left, top);
    f.ExplicitPorts = []; // suppress default-provider ports for predictable resolution
    return f;
}

// ── Endpoints reference the shape node ───────────────────────────────

describe('M3 — connector endpoints reference the shape node', () => {
    test('BeginCreate / EndCreate endpoint.Node is the shape Figure', () => {
        Application.current = null;
        new Application();
        const board  = new Board();
        const behavior = new ConnectorCreateBehavior(board);

        const figA = shapeNode('rectangle', 0,   0);
        const figB = shapeNode('rectangle', 300, 0);

        // Capture the created args via the ConnectorCreated event.
        let created: { Source: ConnectorEndpoint; Target: ConnectorEndpoint } | undefined;
        board.AddConnectorCreatedListener((args) => { created = args; });

        behavior.BeginCreate(figA, PortSide.E, new Point(80, 40));
        behavior.EndCreate(figB, PortSide.W);

        assert.ok(created !== undefined, 'ConnectorCreated event must fire');
        // The endpoint Node must be the shape Figure (which is the node).
        assert.strictEqual(created.Source.Node, figA, 'Source.Node should be the shape Figure');
        assert.strictEqual(created.Target.Node, figB, 'Target.Node should be the shape Figure');
    });

    test('transient Source.Node during BeginCreate is the shape Figure', () => {
        Application.current = null;
        new Application();
        const board  = new Board();
        const behavior = new ConnectorCreateBehavior(board);

        const fig = shapeNode('rectangle', 0, 0);

        behavior.BeginCreate(fig, PortSide.E, new Point(80, 40));

        const transient = behavior.TransientConnector!;
        // The transient's Source.Node must be the shape Figure.
        assert.strictEqual(transient.Source!.Node, fig,
            'Transient Source.Node should be the shape Figure during a BeginCreate drag');
    });

    test('Figure with no VM DataContext (e.g. text/callout) references the Figure itself', () => {
        Application.current = null;
        new Application();
        const board  = new Board();
        const behavior = new ConnectorCreateBehavior(board);

        // A bare Figure with no NodeViewModel in its DataContext.
        const bare = new Figure();
        bare.Left = 0; bare.Top = 0; bare.Width = 80; bare.Height = 80;
        bare.ExplicitPorts = [];

        let created: { Source: ConnectorEndpoint; Target: ConnectorEndpoint } | undefined;
        board.AddConnectorCreatedListener((args) => { created = args; });

        behavior.BeginCreate(bare, PortSide.E, new Point(80, 40));
        behavior.EndCreate(bare, PortSide.W);

        assert.ok(created !== undefined, 'ConnectorCreated event must fire');
        // Bare Figure (no VM) must fall back to the Figure itself.
        assert.strictEqual(created.Source.Node, bare,
            'Source.Node should be the bare Figure when DataContext is not a NodeViewModel');
        assert.strictEqual(created.Target.Node, bare,
            'Target.Node should be the bare Figure when DataContext is not a NodeViewModel');
    });
});

// ── Delete cascade tracks VMs ─────────────────────────────────────────

describe('M3 — DeleteNodes cascade drops connectors referencing VMs', () => {
    test('DeleteNodes([vm]) drops connectors whose endpoint.Node is that VM', () => {
        const doc  = newDoc();
        const vmA = doc.CreateNode('rectangle', 100, 100)!;
        const vmB = doc.CreateNode('rectangle', 300, 100)!;

        // Directly construct endpoint referencing the VMs (as itemOf would produce).
        doc.CreateConnector(
            new ConnectorEndpoint({ Node: vmA }),
            new ConnectorEndpoint({ Node: vmB }));
        doc.CreateConnector(
            new ConnectorEndpoint({ Node: vmA }),
            new ConnectorEndpoint({ Node: vmB }));
        // An unrelated free-floating connector must survive.
        doc.CreateConnector(
            new ConnectorEndpoint({ FreePoint: new Point(0, 0) }),
            new ConnectorEndpoint({ FreePoint: new Point(50, 50) }));

        assert.equal(doc.Connectors.Count, 3, 'should start with 3 connectors');

        doc.DeleteNodes([vmA]);

        // Both connectors touching vmA must be gone; the free-floating one stays.
        assert.equal(doc.Connectors.Count, 1,
            'connectors referencing the deleted VM must be cascaded away');
    });

    test('DeleteNodes([vm]) leaves connectors referencing other VMs', () => {
        const doc  = newDoc();
        const vmA = doc.CreateNode('rectangle', 100, 100)!;
        const vmB = doc.CreateNode('rectangle', 300, 100)!;
        const vmC = doc.CreateNode('rectangle', 500, 100)!;

        doc.CreateConnector(
            new ConnectorEndpoint({ Node: vmA }),
            new ConnectorEndpoint({ Node: vmB }));
        doc.CreateConnector(
            new ConnectorEndpoint({ Node: vmB }),
            new ConnectorEndpoint({ Node: vmC }));

        doc.DeleteNodes([vmA]);
        // Only the connector touching vmA is dropped; the B→C one survives.
        assert.equal(doc.Connectors.Count, 1,
            'connector not referencing the deleted VM should survive');
        const surviving = doc.Connectors.Get(0)!;
        assert.strictEqual(surviving.Source!.Node, vmB);
        assert.strictEqual(surviving.Target!.Node, vmC);
    });
});

// ── Serialize by VM id ────────────────────────────────────────────────

describe('M3 — Save/Load round-trips VM-anchored connector endpoints', () => {
    test('connector anchored on shape Figures survives a Save/Load cycle', () => {
        const storage = new MemoryStorage();
        const doc = newDoc(storage);

        const vmA = doc.CreateNode('rectangle', 100, 100)!;
        const vmB = doc.CreateNode('ellipse',   300, 100)!;

        // Simulate what itemOf + ConnectorCreateBehavior will produce:
        // endpoints referencing the VMs by identity.
        doc.CreateConnector(
            new ConnectorEndpoint({ Node: vmA }),
            new ConnectorEndpoint({ Node: vmB }));

        doc.Save();

        // Fresh document — load into clean state.
        const restored = newDoc(storage);
        restored.Storage = storage;
        restored.Load();

        assert.equal(restored.Nodes.Count,      2, 'reloaded doc must have 2 nodes');
        assert.equal(restored.Connectors.Count, 1, 'reloaded doc must have 1 connector');

        // Look up reloaded VMs by their serialized ids.
        const idA = vmA.Id!;
        const idB = vmB.Id!;

        let rA: Figure | undefined;
        let rB: Figure | undefined;
        for (let i = 0; i < restored.Nodes.Count; i++)
        {
            const n = restored.Nodes.Get(i) as Figure;
            if (n.Id === idA) rA = n;
            if (n.Id === idB) rB = n;
        }
        assert.ok(rA !== undefined, 'reloaded vmA must be present by id');
        assert.ok(rB !== undefined, 'reloaded vmB must be present by id');

        const rC = restored.Connectors.Get(0)!;
        assert.strictEqual(rC.Source!.Node, rA,
            'reloaded connector Source.Node must be the reloaded vmA');
        assert.strictEqual(rC.Target!.Node, rB,
            'reloaded connector Target.Node must be the reloaded vmB');
    });
});
