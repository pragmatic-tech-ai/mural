// Wrap / Unwrap event-commands: Execute fires the Board event with the right
// payload; CanExecute gates on selection shape. Mirrors board-group-commands.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModifierKeys, ObservableCollection, RelayCommand, Size, Visual } from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { SelectionMode } from '../../list/list-box.js';
import { Board } from '../board.js';
import { Figure } from '../figure.js';
import { ContainerFigure } from '../container-figure.js';

function mount(items: ObservableCollection<Figure>): Board
{
    const board = new Board();
    board.SelectionMode = SelectionMode.Extended;
    board.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
    board.ItemsSource = items;
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = board;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    return board;
}

// Figures are their own containers here, so click them directly to select.
function selectMany(board: Board, figs: Figure[]): void
{
    for (let i = 0; i < figs.length; i++)
        board.HandleContainerClick(figs[i]!, i === 0 ? ModifierKeys.None : ModifierKeys.Control);
}

test('default Wrap/Unwrap commands are installed', () => {
    initTestApp();
    const board = mount(new ObservableCollection<Figure>());
    assert.ok(board.WrapInContainerCommand instanceof RelayCommand);
    assert.ok(board.UnwrapContainerCommand instanceof RelayCommand);
});

test('WrapInContainerCommand fires WrapRequested with the top-level selection', () => {
    initTestApp();
    const a = Figure.fromKind('rectangle', 10, 10, { width: 40, height: 30 });
    const b = Figure.fromKind('rectangle', 100, 10, { width: 40, height: 30 });
    const items = new ObservableCollection<Figure>(); items.Add(a); items.Add(b);
    const board = mount(items);

    const requests: Array<readonly unknown[]> = [];
    board.AddWrapRequestedListener(args => requests.push(args.Items));

    assert.equal(board.WrapInContainerCommand?.CanExecute(), false, 'empty selection → disabled');
    selectMany(board, [a, b]);
    assert.equal(board.WrapInContainerCommand?.CanExecute(), true, 'two root figures → enabled');
    board.WrapInContainerCommand?.Execute();

    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.length, 2);
    assert.ok(requests[0]!.includes(a) && requests[0]!.includes(b));
});

test('UnwrapContainerCommand gates on a selected container', () => {
    initTestApp();
    const fig = Figure.fromKind('rectangle', 10, 10, { width: 40, height: 30 });
    const container = Figure.fromKind('container', 200, 10) as ContainerFigure;
    container.Id = 'C';
    const items = new ObservableCollection<Figure>(); items.Add(fig); items.Add(container);
    const board = mount(items);

    const requests: Array<readonly unknown[]> = [];
    board.AddUnwrapRequestedListener(args => requests.push(args.Containers));

    selectMany(board, [fig]);
    assert.equal(board.UnwrapContainerCommand?.CanExecute(), false, 'plain figure → disabled');
    selectMany(board, [container]);
    assert.equal(board.UnwrapContainerCommand?.CanExecute(), true, 'container → enabled');
    board.UnwrapContainerCommand?.Execute();
    assert.equal(requests.length, 1);
    assert.equal(requests[0]![0], container);
});
