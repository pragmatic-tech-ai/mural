// UnwrapContainer dissolves a container: its children re-home to root (screen
// position preserved), then the container node is removed. Symmetric with Ungroup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Size, Visual } from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Diagram } from '../diagram.js';
import { Figure } from '../figure.js';
import { ContainerFigure } from '../container-figure.js';
import { DiagramDocument } from '../diagram-document.js';
import { diagramSpaceRect } from '../coordinate-space.js';

function mountDoc(doc: DiagramDocument): Diagram
{
    const diagram = new Diagram();
    diagram.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
    diagram.DataContext = doc;
    diagram.ItemsSource = doc.Nodes;
    doc.ActiveView = diagram;
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = diagram;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    return diagram;
}

test('UnwrapContainer dissolves the container; its child survives at root', () => {
    initTestApp();
    const doc = new DiagramDocument();
    const container = new ContainerFigure();
    container.Id = 'C'; container.Left = 100; container.Top = 100; container.Width = 220; container.Height = 160;
    const child = Figure.fromKind('rectangle', 22, 18, { width: 30, height: 20 });
    child.Id = 'n1'; child.ParentId = 'C';
    doc.Nodes.Add(container); doc.Nodes.Add(child);
    const diagram = mountDoc(doc);
    diagram.ContainerPlacement.placeAll();
    const screen = diagramSpaceRect(child);

    doc.UnwrapContainer([container]);

    assert.equal(doc.Nodes.IndexOf(container), -1, 'container removed');
    assert.ok(doc.Nodes.IndexOf(child) >= 0, 'child survives');
    assert.equal(child.ParentId, undefined);
    assert.equal(child.ContainerParent, undefined);
    assert.equal(child.Left, screen.X); assert.equal(child.Top, screen.Y);
});

test('UnwrapContainer is a no-op when no container is selected', () => {
    initTestApp();
    const doc = new DiagramDocument();
    const fig = doc.CreateNode('rectangle', 10, 10)!;
    const before = doc.Nodes.Count;
    doc.UnwrapContainer([fig]);
    assert.equal(doc.Nodes.Count, before);
});

test('unwrapping an empty container just removes it', () => {
    initTestApp();
    const doc = new DiagramDocument();
    const container = new ContainerFigure();
    container.Id = 'C'; container.Left = 0; container.Top = 0; container.Width = 200; container.Height = 150;
    doc.Nodes.Add(container);
    const diagram = mountDoc(doc);
    diagram.ContainerPlacement.placeAll();

    doc.UnwrapContainer([container]);
    assert.equal(doc.Nodes.IndexOf(container), -1, 'empty container removed, no error');
});
