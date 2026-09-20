// The on-canvas selection adorner is driven by Diagram.SelectionLeft/Top/
// Width/Height/Count, which SelectionBoundsTracker derives from the selected
// nodes' geometry. Under container-owned-geometry the selected ITEM is a
// content VM (no geometry) while the geometry lives on its container Figure,
// so the tracker must read geometry from the CONTAINERS — otherwise a selected
// content node yields a zero bbox / zero count and no handles ever appear
// (the "selection is broken" report).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application, ObservableCollection, Size, ModifierKeys, Visual } from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { SelectionMode } from '../../list/list-box.js';
import { Diagram } from '../diagram.js';
import { Figure } from '../figure.js';
import { NodeViewModel } from '../node-view-model.js';

function mountVM(): { diagram: Diagram; vm: NodeViewModel; container: Figure }
{
    Application.current = null; new Application();
    const vm = new NodeViewModel(); vm.Id = 'v';
    const coll = new ObservableCollection<NodeViewModel>(); coll.Add(vm);
    const diagram = new Diagram();
    diagram.SelectionMode = SelectionMode.Extended;
    diagram.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
    diagram.ItemsSource = coll;
    const surface = new Border(); (surface as unknown as { Child: Visual }).Child = diagram;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    const container = diagram.Generator.ContainerFromItem(vm) as Figure;
    container.Left = 15; container.Top = 25; container.Width = 120; container.Height = 60;
    return { diagram, vm, container };
}

function select(diagram: Diagram, item: unknown, mods: ModifierKeys = ModifierKeys.None): void
{
    const container = diagram.Generator.ContainerFromItem(item);
    if (container === undefined) throw new Error('no container');
    diagram.HandleContainerClick(container, mods);
}

describe('SelectionBoundsTracker with a VM-backed content node', () => {
    test('selecting a content VM reports its container geometry as the selection bbox', () => {
        const { diagram, vm, container } = mountVM();
        select(diagram, vm);

        assert.equal(diagram.SelectionCount, 1, 'the selected content node is counted');
        assert.equal(diagram.SelectionLeft,   container.Left);
        assert.equal(diagram.SelectionTop,    container.Top);
        assert.equal(diagram.SelectionWidth,  container.Width);
        assert.equal(diagram.SelectionHeight, container.Height);
    });

    test('dragging the container re-derives the selection bbox (live adorner tracking)', () => {
        const { diagram, vm, container } = mountVM();
        select(diagram, vm);
        container.Left = 200;
        assert.equal(diagram.SelectionLeft, 200, 'bbox follows the container move');
    });
});
