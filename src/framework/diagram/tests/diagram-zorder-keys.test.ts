import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModifierKeys, ObservableCollection, RelayCommand, Size, Visual } from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { SelectionMode } from '../../list/list-box.js';
import { Key, KeyEventArgs } from '../../../visual-engine/index.js';
import { Diagram } from '../diagram.js';
import { Figure } from '../figure.js';

function mount(items: ObservableCollection<Figure>): Diagram
{
    const diagram = new Diagram();
    diagram.SelectionMode = SelectionMode.Extended;
    diagram.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
    diagram.ItemsSource = items;
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = diagram;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    return diagram;
}

function dispatch(diagram: Diagram, key: Key, mods: ModifierKeys): void
{
    const args = new KeyEventArgs('KeyDown', diagram, {
        Key: key, KeyText: key, Code: key, Modifiers: mods, IsRepeat: false,
    });
    (diagram as unknown as { OnKeyDown(a: KeyEventArgs): void }).OnKeyDown(args);
}

test('Ctrl+]/[ (+Shift) route to the four z-order commands', () => {
    initTestApp();
    const a = Figure.fromKind('rectangle', 10, 10, { width: 40, height: 30 });
    const items = new ObservableCollection<Figure>(); items.Add(a);
    const diagram = mount(items);
    diagram.HandleContainerClick(a, ModifierKeys.None);   // a selection so CanExecute passes

    const fired: string[] = [];
    const stub = (name: string) => new RelayCommand(() => fired.push(name), () => true, { Text: name });
    diagram.set_property_value(Diagram.BringForwardCommandKey, stub('forward'));
    diagram.set_property_value(Diagram.BringToFrontCommandKey, stub('front'));
    diagram.set_property_value(Diagram.SendBackwardCommandKey, stub('backward'));
    diagram.set_property_value(Diagram.SendToBackCommandKey,   stub('back'));

    dispatch(diagram, Key.Oem6, ModifierKeys.Control);                         // Ctrl+]
    dispatch(diagram, Key.Oem6, ModifierKeys.Control | ModifierKeys.Shift);    // Ctrl+Shift+]
    dispatch(diagram, Key.Oem4, ModifierKeys.Control);                         // Ctrl+[
    dispatch(diagram, Key.Oem4, ModifierKeys.Control | ModifierKeys.Shift);    // Ctrl+Shift+[
    assert.deepEqual(fired, ['forward', 'front', 'backward', 'back']);
});
