import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObservableCollection, Size, Visual } from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
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

test('reparent fires NodeReparented with old/new parent ids (nest then un-nest)', () => {
    initTestApp();
    const container = new ContainerFigure();
    container.Id = 'C'; container.Left = 100; container.Top = 100; container.Width = 220; container.Height = 160;
    const child = Figure.fromKind('rectangle', 130, 150, { width: 30, height: 20 });
    child.Id = 'n1';
    const items = new ObservableCollection<Figure>();
    items.Add(container); items.Add(child);
    const diagram = mount(items);
    diagram.ContainerPlacement.placeAll();   // registers the container

    const events: Array<{ id: string | undefined; oldP: string | undefined; newP: string | undefined }> = [];
    diagram.AddNodeReparentedListener(a => events.push({ id: a.Node.Id, oldP: a.OldParentId, newP: a.NewParentId }));

    diagram.ContainerPlacement.reparent(child, 'C');
    assert.deepEqual(events.at(-1), { id: 'n1', oldP: undefined, newP: 'C' });

    diagram.ContainerPlacement.reparent(child, undefined);
    assert.deepEqual(events.at(-1), { id: 'n1', oldP: 'C', newP: undefined });
});

test('reHome fires NodeReparented per child as it is re-homed to root', () => {
    initTestApp();
    const container = new ContainerFigure();
    container.Id = 'C'; container.Left = 100; container.Top = 100; container.Width = 220; container.Height = 160;
    const child = Figure.fromKind('rectangle', 130, 150, { width: 30, height: 20 });
    child.Id = 'n1';
    const items = new ObservableCollection<Figure>();
    items.Add(container); items.Add(child);
    const diagram = mount(items);
    diagram.ContainerPlacement.placeAll();
    diagram.ContainerPlacement.reparent(child, 'C');   // now nested

    const events: Array<{ id: string | undefined; newP: string | undefined }> = [];
    diagram.AddNodeReparentedListener(a => events.push({ id: a.Node.Id, newP: a.NewParentId }));

    diagram.ContainerPlacement.reHome(container);   // re-homes child to the container's parent (root)
    assert.deepEqual(events.at(-1), { id: 'n1', newP: undefined });
});
