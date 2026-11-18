import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application, ObservableCollection, Size, ModifierKeys, Visual } from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { SelectionMode } from '../../list/list-box.js';
import { Board } from '../board.js';
import { Figure } from '../figure.js';
import { NodeViewModel } from '../node-view-model.js';

function mount(): { board: Board; a: Figure; b: Figure }
{
    Application.current = null; new Application();
    const a = Figure.fromKind('rectangle', 10, 20, { width: 100, height: 50 }); a.Id = 'a';
    const b = Figure.fromKind('rectangle', 200, 60, { width: 80, height: 40 }); b.Id = 'b';
    const coll = new ObservableCollection<Figure>(); coll.Add(a); coll.Add(b);
    const board = new Board();
    board.SelectionMode = SelectionMode.Extended;
    board.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
    board.ItemsSource = coll;
    const surface = new Border(); (surface as unknown as { Child: Visual }).Child = board;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    return { board, a, b };
}

// A VM-backed node (content node, e.g. Plexus ArchNodeVM) — the Board wraps
// it in a Figure container that OWNS the geometry (the VM carries only content +
// Id). Geometry is set on the container directly here (the document's store is
// the production path). SelectedItems surfaces the VM, not the container.
function mountVM(): { board: Board; vm: NodeViewModel; container: Figure }
{
    Application.current = null; new Application();
    const vm = new NodeViewModel();
    vm.Id = 'v';
    const coll = new ObservableCollection<NodeViewModel>(); coll.Add(vm);
    const board = new Board();
    board.SelectionMode = SelectionMode.Extended;
    board.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
    board.ItemsSource = coll;
    const surface = new Border(); (surface as unknown as { Child: Visual }).Child = board;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    // Geometry lives on the container Figure now, not the VM.
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

describe('SelectionGeometryMirror', () => {
    test('single selection mirrors the shape geometry; HasSelectedShape true', () => {
        const { board, a } = mount();
        select(board, a);
        assert.equal(board.HasSelectedShape, true);
        assert.equal(board.SelectedShapeLeft, 10);
        assert.equal(board.SelectedShapeWidth, 100);
        assert.equal(board.SelectedShapeBaseWidth, 100);
    });
    test('writing a SelectedShape DP updates the shape', () => {
        const { board, a } = mount();
        select(board, a);
        board.SelectedShapeWidth = 160;
        assert.equal(a.Width, 160);
        board.SelectedShapeRotation = 30;
        assert.equal(a.Rotation, 30);
    });
    test('dragging the shape re-seeds the DP (live tracking)', () => {
        const { board, a } = mount();
        select(board, a);
        a.Left = 77;
        assert.equal(board.SelectedShapeLeft, 77);
    });
    test('VM-backed node: HasSelectedShape true, mirrors container geometry', () => {
        const { board, vm } = mountVM();
        select(board, vm);
        assert.equal(board.SelectedItems.length, 1);
        assert.equal(board.HasSelectedShape, true);
        assert.equal(board.SelectedShapeLeft, 15);
        assert.equal(board.SelectedShapeWidth, 120);
    });
    test('VM-backed node: writing a SelectedShape DP propagates to the container', () => {
        const { board, vm, container } = mountVM();
        select(board, vm);
        board.SelectedShapeLeft = 40;
        assert.equal(container.Left, 40);
        board.SelectedShapeWidth = 200;
        assert.equal(container.Width, 200);
    });
    test('multi selection => HasSelectedShape false, writes ignored', () => {
        const { board, a, b } = mount();
        select(board, a);
        select(board, b, ModifierKeys.Control);
        assert.equal(board.SelectedItems.length, 2);
        assert.equal(board.HasSelectedShape, false);
        board.SelectedShapeWidth = 999;
        assert.equal(a.Width, 100);
    });
});
