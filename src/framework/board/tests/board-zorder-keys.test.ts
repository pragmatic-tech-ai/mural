import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModifierKeys, ObservableCollection, RelayCommand, Size, Visual } from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { SelectionMode } from '../../list/list-box.js';
import { Key, KeyEventArgs } from '../../../visual-engine/index.js';
import { Board } from '../board.js';
import { Figure } from '../figure.js';

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

function dispatch(board: Board, key: Key, mods: ModifierKeys): void
{
    const args = new KeyEventArgs('KeyDown', board, {
        Key: key, KeyText: key, Code: key, Modifiers: mods, IsRepeat: false,
    });
    (board as unknown as { OnKeyDown(a: KeyEventArgs): void }).OnKeyDown(args);
}

test('Ctrl+]/[ (+Shift) route to the four z-order commands', () => {
    initTestApp();
    const a = Figure.fromKind('rectangle', 10, 10, { width: 40, height: 30 });
    const items = new ObservableCollection<Figure>(); items.Add(a);
    const board = mount(items);
    board.HandleContainerClick(a, ModifierKeys.None);   // a selection so CanExecute passes

    const fired: string[] = [];
    const stub = (name: string) => new RelayCommand(() => fired.push(name), () => true, { Text: name });
    board.set_property_value(Board.BringForwardCommandKey, stub('forward'));
    board.set_property_value(Board.BringToFrontCommandKey, stub('front'));
    board.set_property_value(Board.SendBackwardCommandKey, stub('backward'));
    board.set_property_value(Board.SendToBackCommandKey,   stub('back'));

    dispatch(board, Key.Oem6, ModifierKeys.Control);                         // Ctrl+]
    dispatch(board, Key.Oem6, ModifierKeys.Control | ModifierKeys.Shift);    // Ctrl+Shift+]
    dispatch(board, Key.Oem4, ModifierKeys.Control);                         // Ctrl+[
    dispatch(board, Key.Oem4, ModifierKeys.Control | ModifierKeys.Shift);    // Ctrl+Shift+[
    assert.deepEqual(fired, ['forward', 'front', 'backward', 'back']);
});
