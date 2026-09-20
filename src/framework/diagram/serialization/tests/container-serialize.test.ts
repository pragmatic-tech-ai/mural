// A container + its nested child survive a save/load round-trip: the container
// serializes as a 'container' node, the child's parentId + parent-relative
// coords ride the visuals section, and on load ContainerPlacement restores the
// nesting regardless of node order.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Size, Visual } from '../../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../../basic/index.js';
import { initTestApp } from '../../../../basic/tests/test-app.js';
import { Diagram } from '../../diagram.js';
import { Figure } from '../../figure.js';
import { ContainerFigure } from '../../container-figure.js';
import { DiagramDocument, type DiagramStorage } from '../../diagram-document.js';
import '../node-serializers-default.js';   // side-effect: registers shape/text/callout/container

class MemoryStorage implements DiagramStorage
{
    private readonly _map = new Map<string, string>();
    public GetItem(key: string): string | null { return this._map.get(key) ?? null; }
    public SetItem(key: string, value: string): void { this._map.set(key, value); }
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

test('save/load round-trips a container + its nested child via parentId', () => {
    initTestApp();
    const storage = new MemoryStorage();

    // Author a container with a nested child (child coords are parent-relative).
    const doc1 = new DiagramDocument(storage);
    const container = new ContainerFigure();
    container.Id = 'C'; container.Left = 100; container.Top = 100; container.Width = 220; container.Height = 160;
    container.Text.Content = 'Group';
    const child = Figure.fromKind('rectangle', 22, 18, { width: 30, height: 20 });
    child.Id = 'n1'; child.ParentId = 'C';
    doc1.Nodes.Add(container);
    doc1.Nodes.Add(child);
    doc1.Save();

    // Load into a fresh document.
    const doc2 = new DiagramDocument(storage);
    doc2.Load();
    assert.equal(doc2.Nodes.Count, 2, 'both nodes rehydrated');
    const c2 = doc2.Nodes.ToArray().find((n) => n instanceof ContainerFigure) as ContainerFigure | undefined;
    const n2 = doc2.Nodes.ToArray().find((n) => n instanceof Figure && !(n instanceof ContainerFigure)) as Figure | undefined;
    assert.ok(c2 instanceof ContainerFigure, 'container round-tripped as a ContainerFigure');
    assert.equal(c2!.Text.Content, 'Group', 'container title round-tripped');
    assert.ok(n2 !== undefined, 'child rehydrated');
    assert.equal(n2!.ParentId, 'C', 'child parentId restored from visuals');
    assert.equal(n2!.Left, 22); assert.equal(n2!.Top, 18);   // parent-relative coords restored

    // Mount + placeAll restores the visual nesting.
    const diagram = mountView(doc2);
    diagram.ContainerPlacement.placeAll();
    assert.equal(n2!.ContainerParent, c2, 'child nested after load + placeAll');
    assert.equal(n2!.GetVisualParent(), c2!.ChildHost, 'child lives in the container ChildHost');
});
