// Edge cases: a container can't drop into itself or a descendant (cycle guard),
// wrap/unwrap no-op on ineligible selections, and unwrapping an empty container
// just removes it. Most behavior falls out of Stage 1 + earlier Stage 2 tasks;
// these pin it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObservableCollection, Size, Visual } from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Point } from '../../../visual-engine/index.js';
import { Diagram } from '../diagram.js';
import { Figure } from '../figure.js';
import { ContainerFigure } from '../container-figure.js';
import { DiagramDocument } from '../diagram-document.js';

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

test('containerAt rejects the dragged container itself and its own descendants (no cycle)', () => {
    initTestApp();
    const outer = new ContainerFigure(); outer.Id = 'O'; outer.Left = 0; outer.Top = 0; outer.Width = 300; outer.Height = 300;
    const inner = new ContainerFigure(); inner.Id = 'I'; inner.Left = 10; inner.Top = 10; inner.Width = 100; inner.Height = 100; inner.ParentId = 'O';
    const items = new ObservableCollection<Figure>(); items.Add(outer); items.Add(inner);
    const diagram = mount(items);
    diagram.ContainerPlacement.placeAll();
    assert.equal(inner.ContainerParent, outer, 'inner nested under outer');

    // Point inside inner's diagram-space rect: O origin (0,0)+ContentOrigin(8,32)+inner.local(10,10) = (18,42).
    const insideInner = new Point(50, 80);
    const hit = diagram.ContainerPlacement.containerAt(insideInner, outer);
    assert.notEqual(hit, inner, 'inner is a descendant of the dragged outer → excluded');
    assert.notEqual(hit, outer, 'the dragged container itself → excluded');
    assert.equal(hit, undefined);
});

test('WrapInContainer no-ops on empty selection; UnwrapContainer no-ops without a container', () => {
    initTestApp();
    const doc = new DiagramDocument();
    const fig = doc.CreateNode('rectangle', 0, 0)!;
    const before = doc.Nodes.Count;    // one plain figure
    doc.WrapInContainer([]);
    doc.UnwrapContainer([fig]);
    assert.equal(doc.Nodes.Count, before, 'nothing wrapped or unwrapped');
});

test('unwrapping an empty container just removes it', () => {
    initTestApp();
    const doc = new DiagramDocument();
    const container = new ContainerFigure();
    container.Id = 'C'; container.Left = 0; container.Top = 0; container.Width = 200; container.Height = 150;
    doc.Nodes.Add(container);
    // No bound view needed: an empty container has no children to re-home.
    doc.UnwrapContainer([container]);
    assert.equal(doc.Nodes.IndexOf(container), -1, 'empty container removed, no error');
});
