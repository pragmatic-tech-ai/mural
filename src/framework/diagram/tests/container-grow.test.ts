// Auto-grow-to-fit: dropping a child near/over a container's edge grows the
// container (never shrinks) so the child fits inside the child region with
// CONTAINER_PADDING to spare.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObservableCollection, Size, Visual } from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Diagram } from '../diagram.js';
import { Figure } from '../figure.js';
import { ContainerFigure, CONTAINER_PADDING } from '../container-figure.js';

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

test('dropping a child past the edge grows the container to fit', () => {
    initTestApp();
    const c = new ContainerFigure();
    c.Id = 'C'; c.Left = 0; c.Top = 0; c.Width = 120; c.Height = 100;
    // Position F so its converted local coords are (100, 80): diagram-space =
    // container.Left + ContentOrigin(8,32) + local(100,80) = (108, 112).
    const f = Figure.fromKind('rectangle', 108, 112, { width: 40, height: 40 });
    f.Id = 'f';
    const items = new ObservableCollection<Figure>(); items.Add(c); items.Add(f);
    const diagram = mount(items);
    diagram.ContainerPlacement.placeAll();

    diagram.ContainerPlacement.reparent(f, 'C');

    assert.equal(f.Left, 100); assert.equal(f.Top, 80);   // converted local
    assert.ok(c.Width  >= c.ContentOrigin.X + f.Left + f.Width  + CONTAINER_PADDING, 'grew width');
    assert.ok(c.Height >= c.ContentOrigin.Y + f.Top  + f.Height + CONTAINER_PADDING, 'grew height');
    assert.equal(c.Width, 156); assert.equal(c.Height, 160);
});

test('dropping a child that already fits does not shrink the container', () => {
    initTestApp();
    const c = new ContainerFigure();
    c.Id = 'C'; c.Left = 0; c.Top = 0; c.Width = 300; c.Height = 300;
    const f = Figure.fromKind('rectangle', 20, 50, { width: 20, height: 20 }); // small, well inside
    f.Id = 'f';
    const items = new ObservableCollection<Figure>(); items.Add(c); items.Add(f);
    const diagram = mount(items);
    diagram.ContainerPlacement.placeAll();

    diagram.ContainerPlacement.reparent(f, 'C');
    assert.equal(c.Width, 300); assert.equal(c.Height, 300);   // unchanged
});
