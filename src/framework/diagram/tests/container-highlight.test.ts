// Drop-candidate highlight: during a drag, the container the node would drop into
// carries IsDropCandidate = true; moving to another container flips it; ending the
// drag clears it. The drag path drives this via ContainerPlacement.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObservableCollection, Size, Visual } from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Point } from '../../../visual-engine/index.js';
import { Diagram } from '../diagram.js';
import { Figure } from '../figure.js';
import { ContainerFigure } from '../container-figure.js';

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

test('highlightCandidate marks the hovered container and clears the previous one', () => {
    initTestApp();
    const c1 = new ContainerFigure(); c1.Id = 'C1'; c1.Left = 0;   c1.Top = 0; c1.Width = 100; c1.Height = 100;
    const c2 = new ContainerFigure(); c2.Id = 'C2'; c2.Left = 200; c2.Top = 0; c2.Width = 100; c2.Height = 100;
    const dragged = Figure.fromKind('rectangle', 400, 400, { width: 20, height: 20 });
    dragged.Id = 'd';
    const items = new ObservableCollection<Figure>();
    items.Add(c1); items.Add(c2); items.Add(dragged);
    const diagram = mount(items);
    diagram.ContainerPlacement.placeAll();

    diagram.ContainerPlacement.highlightCandidate(new Point(50, 50), dragged);
    assert.equal(c1.IsDropCandidate, true);
    assert.equal(c2.IsDropCandidate, false);

    diagram.ContainerPlacement.highlightCandidate(new Point(250, 50), dragged);
    assert.equal(c1.IsDropCandidate, false, 'previous candidate cleared');
    assert.equal(c2.IsDropCandidate, true);

    diagram.ContainerPlacement.clearCandidate();
    assert.equal(c2.IsDropCandidate, false);
});

test('IsDropCandidate defaults to false', () => {
    initTestApp();
    const c = new ContainerFigure();
    assert.equal(c.IsDropCandidate, false);
});
