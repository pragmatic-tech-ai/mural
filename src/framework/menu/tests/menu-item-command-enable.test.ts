import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Binding, Observable, Panel, PointerButton, NoModifiers, RelayCommand, type PointerEventInit } from '../../../runtime/index.js';
import { InputManager } from '../../../framework/index.js';
import { MenuItem } from '../menu-strip.js';

class Root extends Panel {}

class Gate
{
    public Open = false;
    public readonly Command = new RelayCommand(() => { this.Executed++; }, () => this.Open);
    public Executed = 0;
}

function pointer(): PointerEventInit
{
    return {
        HostX: 0, HostY: 0, Button: PointerButton.Primary, Buttons: 1,
        Modifiers: NoModifiers, PointerId: 0, Pressure: 0, PointerType: 'mouse',
    };
}

describe('MenuItem enable state follows Command.CanExecute', () => {
    beforeEach(() => { initTestApp(); });

    test('no Command: IsEnabled stays at its default (true)', () => {
        const mi = new MenuItem();
        assert.equal(mi.IsEnabled, true);
    });

    test('Command whose CanExecute is false disables the item', () => {
        const gate = new Gate();
        const mi = new MenuItem();
        mi.Command = gate.Command;
        assert.equal(mi.IsEnabled, false);
    });

    test('CanExecuteChanged re-enables the item live', () => {
        const gate = new Gate();
        const mi = new MenuItem();
        mi.Command = gate.Command;
        gate.Open = true;
        gate.Command.RaiseCanExecuteChanged();
        assert.equal(mi.IsEnabled, true);
        gate.Open = false;
        gate.Command.RaiseCanExecuteChanged();
        assert.equal(mi.IsEnabled, false);
    });

    test('clearing Command after a disabled command re-enables the item', () => {
        const gate = new Gate();
        const mi = new MenuItem();
        mi.Command = gate.Command;
        mi.Command = undefined;
        assert.equal(mi.IsEnabled, true);
    });

    test('swapping one disabled command for another stays disabled and stops listening to the old one', () => {
        const a = new Gate();
        const b = new Gate();
        const mi = new MenuItem();
        mi.Command = a.Command;
        mi.Command = b.Command;
        assert.equal(mi.IsEnabled, false);
        a.Open = true;
        a.Command.RaiseCanExecuteChanged();
        assert.equal(mi.IsEnabled, false);
    });

    test('CommandParameter change re-queries CanExecute', () => {
        const mi = new MenuItem();
        mi.Command = new RelayCommand(() => {}, (p) => p === 'ok');
        assert.equal(mi.IsEnabled, false);
        mi.CommandParameter = 'ok';
        assert.equal(mi.IsEnabled, true);
    });

    test('a bound IsEnabled keeps winning over the command sync (Binding > Local)', () => {
        const source = new (class extends Observable { public Enabled = true; })();
        const gate = new Gate();
        const mi = new MenuItem();
        mi.set_property_value(MenuItem.IsEnabledKey, new Binding(source as unknown as never, 'Enabled'));
        mi.Command = gate.Command;
        assert.equal(mi.IsEnabled, true);
    });

    test('clicking a disabled item neither executes nor activates', () => {
        const root = new Root();
        const gate = new Gate();
        const mi = new MenuItem();
        root.AddChild(mi);
        mi.Command = gate.Command;
        let activated = 0;
        mi._onActivated = (): void => { activated++; };
        const im = new InputManager();
        im.InjectPointerDown(mi, pointer());
        im.InjectPointerUp(mi, pointer());
        assert.equal(gate.Executed, 0);
        assert.equal(activated, 0);
    });
});
