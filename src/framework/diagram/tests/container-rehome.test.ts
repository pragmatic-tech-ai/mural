// Re-homing: when a ContainerFigure leaves the scene (deleted or unwrapped), its
// children move out to the container's own parent (or root), preserving their
// on-screen position — never destroyed with the box (data-loss guard).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObservableCollection, Size, Visual } from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Diagram } from '../diagram.js';
import { Figure } from '../figure.js';
import { ContainerFigure } from '../container-figure.js';
import { DiagramDocument } from '../diagram-document.js';
import { diagramSpaceRect } from '../coordinate-space.js';

function mount(items: ObservableCollection<Figure>): Diagram
{
    const diagram = new Diagram();
    diagram.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
    diagram.ItemsSource = items;
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = diagram;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    return diagram;
}

function mountDoc(doc: DiagramDocument): Diagram
{
    const diagram = new Diagram();
    diagram.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
    diagram.DataContext = doc;
    diagram.ItemsSource = doc.Nodes;
    doc.ActiveView = diagram;               // wires _boundView so DeleteNodes reaches reHome
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = diagram;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    return diagram;
}

test('reHome moves a container child out to root, preserving screen position', () => {
    initTestApp();
    const container = new ContainerFigure();
    container.Id = 'C'; container.Left = 100; container.Top = 100; container.Width = 220; container.Height = 160;
    const child = Figure.fromKind('rectangle', 22, 18, { width: 30, height: 20 });
    child.Id = 'n1'; child.ParentId = 'C';
    const items = new ObservableCollection<Figure>();
    items.Add(container); items.Add(child);
    const diagram = mount(items);
    diagram.ContainerPlacement.placeAll();
    assert.equal(child.ContainerParent, container);
    const screen = diagramSpaceRect(child);   // (130,150)

    diagram.ContainerPlacement.reHome(container);

    assert.equal(child.ParentId, undefined, 'child released');
    assert.equal(child.ContainerParent, undefined, 'child un-nested');
    assert.equal(child.Left, screen.X); assert.equal(child.Top, screen.Y);
    // container no longer answers as a drop target
    assert.equal(diagram.ContainerPlacement.containerAt({ X: 140, Y: 150 } as never), undefined);
});

test('deleting a container re-homes its child to root; the child survives in Nodes', () => {
    initTestApp();
    const doc = new DiagramDocument();
    const container = new ContainerFigure();
    container.Id = 'C'; container.Left = 100; container.Top = 100; container.Width = 220; container.Height = 160;
    const child = Figure.fromKind('rectangle', 22, 18, { width: 30, height: 20 });
    child.Id = 'n1'; child.ParentId = 'C';
    doc.Nodes.Add(container); doc.Nodes.Add(child);
    const diagram = mountDoc(doc);
    diagram.ContainerPlacement.placeAll();
    assert.equal(child.ContainerParent, container);
    const screen = diagramSpaceRect(child);

    doc.DeleteNodes([container]);

    assert.equal(doc.Nodes.IndexOf(container), -1, 'container removed');
    assert.ok(doc.Nodes.IndexOf(child) >= 0, 'child survives');
    assert.equal(child.ParentId, undefined);
    assert.equal(child.ContainerParent, undefined);
    assert.equal(child.Left, screen.X); assert.equal(child.Top, screen.Y);
});
