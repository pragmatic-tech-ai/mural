// The on-canvas selection adorner is driven by Board.SelectionLeft/Top/
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
import { Board } from '../board.js';
import { Figure } from '../figure.js';
import { NodeViewModel } from '../node-view-model.js';

function mountVM(): { board: Board; vm: NodeViewModel; container: Figure }
{
    Application.current = null; new Application();
    const vm = new NodeViewModel(); vm.Id = 'v';
    const coll = new ObservableCollection<NodeViewModel>(); coll.Add(vm);
    const board = new Board();
    board.SelectionMode = SelectionMode.Extended;
    board.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
    board.ItemsSource = coll;
    const surface = new Border(); (surface as unknown as { Child: Visual }).Child = board;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    const container = board.Generator.ContainerFromItem(vm) as Figure;
    container.Left = 15; container.Top = 25; container.Width = 120; container.Height = 60;
    return { board, vm, container };
}

function select(board: Board, item: unknown, mods: ModifierKeys = ModifierKeys.None): void
{
    const container = board.Generator.ContainerFromItem(item);
    if (container === undefined) throw new Error('no container');
    board.HandleContainerClick(container, mods);
}

describe('SelectionBoundsTracker with a VM-backed content node', () => {
    test('selecting a content VM reports its container geometry as the selection bbox', () => {
        const { board, vm, container } = mountVM();
        select(board, vm);

        assert.equal(board.SelectionCount, 1, 'the selected content node is counted');
        assert.equal(board.SelectionLeft,   container.Left);
        assert.equal(board.SelectionTop,    container.Top);
        assert.equal(board.SelectionWidth,  container.Width);
        assert.equal(board.SelectionHeight, container.Height);
    });

    test('dragging the container re-derives the selection bbox (live adorner tracking)', () => {
        const { board, vm, container } = mountVM();
        select(board, vm);
        container.Left = 200;
        assert.equal(board.SelectionLeft, 200, 'bbox follows the container move');
    });
});
