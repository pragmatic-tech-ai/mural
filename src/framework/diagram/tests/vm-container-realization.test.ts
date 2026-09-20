import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Application, ObservableCollection, Size, Visual } from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate, TextBlock } from '../../../basic/index.js';
import { DataTemplate } from '../../../basic/templates/data-template.js';
import { Diagram } from '../diagram.js';
import { Figure } from '../figure.js';
import { NodeViewModel } from '../node-view-model.js';
import { ContentContainerFigure } from '../content-container-figure.js';

// A VM that opts into a container host via the duck-typed IsContainer flag.
class ContainerVM extends NodeViewModel { public readonly IsContainer = true; }
class PlainVM     extends NodeViewModel {}

function mount(col: ObservableCollection<NodeViewModel>): Diagram
{
    const diagram = new Diagram();
    diagram.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
    diagram.ItemsSource = col;
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = diagram;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    return diagram;
}

test('a VM with IsContainer realizes as a ContentContainerFigure with a child host', () => {
    initTestApp();
    Application.current!.Resources.Set(ContainerVM,
        new DataTemplate((_d) => { const b = new Border(); b.SetChild(new TextBlock('loc')); return b; }, ContainerVM));
    const vm = new ContainerVM(); vm.Id = 'c1';
    const col = new ObservableCollection<NodeViewModel>(); col.Add(vm);
    const diagram = mount(col);
    const container = diagram.Generator.ContainerFromItem(vm);
    assert.ok(container instanceof ContentContainerFigure, 'container-opting VM → ContentContainerFigure');
    assert.ok((container as ContentContainerFigure).ChildHost !== undefined, 'has a ChildHost');
    assert.equal((container as Figure).SizeToContent, false, 'a container is not a size-to-content tile');
    assert.equal((container as Figure).Id, 'c1', 'mirrors the VM Id');
});

test('a plain VM still realizes as a bare Figure (not a container)', () => {
    initTestApp();
    Application.current!.Resources.Set(PlainVM,
        new DataTemplate((_d) => { const b = new Border(); b.SetChild(new TextBlock('n')); return b; }, PlainVM));
    const vm = new PlainVM(); vm.Id = 'n1';
    const col = new ObservableCollection<NodeViewModel>(); col.Add(vm);
    const diagram = mount(col);
    const container = diagram.Generator.ContainerFromItem(vm);
    assert.ok(container instanceof Figure, 'still a Figure');
    assert.ok(!(container instanceof ContentContainerFigure), 'not a container');
    assert.equal((container as Figure).SizeToContent, true, 'plain VM stays a content tile');
});
