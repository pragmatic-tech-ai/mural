// Moving a content-node's container Figure must mark the document dirty.
// Geometry lives on the container (container-owned-geometry), so _wireNodeDirty
// — keyed on the geometry-less VM — sees nothing to watch; the document instead
// wires a dirty listener on the container when it binds (in _onContainerBound).
// Seeding the saved geometry on bind must NOT self-dirty.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application, Size, Visual } from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { Diagram } from '../diagram.js';
import { Figure } from '../figure.js';
import { NodeViewModel } from '../node-view-model.js';
import { DiagramDocument, type DiagramStorage } from '../diagram-document.js';
import { registerNodeSerializer } from '../serialization/node-serialization.js';
import '../serialization/node-serializers-default.js';

const VM_TYPE = 'dirtyvm';
registerNodeSerializer({
    type: VM_TYPE,
    matches: (n) => n instanceof NodeViewModel,
    serialize: () => ({}),
    deserialize: () => new NodeViewModel(),
});

class MemoryStorage implements DiagramStorage
{
    private readonly _m = new Map<string, string>();
    public GetItem(k: string): string | null { return this._m.get(k) ?? null; }
    public SetItem(k: string, v: string): void { this._m.set(k, v); }
}

function payload(): string
{
    return JSON.stringify({
        version: 3,
        nodes: [{ id: 'a', type: VM_TYPE, data: {} }],
        visuals: { a: { left: 10, top: 20, w: 60, h: 40 } },
        connectors: [],
        nextId: 1,
    });
}

function mountView(doc: DiagramDocument): Diagram
{
    const diagram = new Diagram();
    diagram.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
    diagram.DataContext = doc;
    diagram.ItemsSource = doc.Nodes;
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = diagram;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    return diagram;
}

describe('content-node container dirty tracking', () => {
    test('load + realize leaves the document clean; moving the container dirties it', () => {
        Application.current = null; new Application();
        const storage = new MemoryStorage();
        storage.SetItem('mural-diagram-state-v1', payload());
        const doc = new DiagramDocument(storage);
        doc.Load();
        const diagram = mountView(doc);
        const container = diagram.Generator.ContainerFromItem(doc.Nodes.Get(0)!) as Figure;
        assert.ok(container instanceof Figure);

        // Seeding the saved geometry on bind must not dirty the freshly-loaded doc.
        assert.equal(doc.IsDirty, false, 'clean after load + realize');

        // A move (what a drag writes) dirties the document.
        container.Left = container.Left + 50;
        assert.equal(doc.IsDirty, true, 'moving the container marks dirty');
    });

    test('a resize (Width/Height) of the container dirties the document', () => {
        Application.current = null; new Application();
        const storage = new MemoryStorage();
        storage.SetItem('mural-diagram-state-v1', payload());
        const doc = new DiagramDocument(storage);
        doc.Load();
        const diagram = mountView(doc);
        const container = diagram.Generator.ContainerFromItem(doc.Nodes.Get(0)!) as Figure;
        assert.equal(doc.IsDirty, false);
        container.Width = 200;
        assert.equal(doc.IsDirty, true, 'resizing the container marks dirty');
    });
});
