import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Binding, Observable, Panel, PointerButton, PropertyValueSource, NoModifiers, RelayCommand, type PointerEventInit } from '../../../runtime/index.js';
import { InputManager } from '../../../framework/index.js';
import { MenuItem } from '../menu-strip.js';
import { CommandBinding, CommandManager, Control, RoutedCommand } from '../../index.js';
import { Visual } from '../../../runtime/index.js';

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

    test('a bound IsEnabled stays bound and is ANDed with CanExecute (WPF coercion)', () => {
        const source = new (class extends Observable { public Enabled = true; })();
        const gate = new Gate();
        const mi = new MenuItem();
        mi.set_property_value(MenuItem.IsEnabledKey, new Binding(source as unknown as never, 'Enabled'));
        mi.Command = gate.Command;
        assert.equal(mi.IsEnabled, false, 'bound true AND CanExecute false');
        gate.Open = true;
        gate.Command.RaiseCanExecuteChanged();
        assert.equal(mi.IsEnabled, true, 'bound true AND CanExecute true');
        assert.equal(mi.GetValueSource(MenuItem.IsEnabledKey), PropertyValueSource.Binding, 'the binding was never replaced');
    });

    test('an explicit IsEnabled=false is never overridden by a command that can execute', () => {
        const gate = new Gate();
        gate.Open = true;
        const mi = new MenuItem();
        mi.IsEnabled = false;
        mi.Command = gate.Command;
        assert.equal(mi.IsEnabled, false);
        gate.Open = false;
        gate.Command.RaiseCanExecuteChanged();
        gate.Open = true;
        gate.Command.RaiseCanExecuteChanged();
        assert.equal(mi.IsEnabled, false, 'a CanExecute transition does not override the authored value');
        mi.Command = undefined;
        assert.equal(mi.IsEnabled, false);
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

// Same tree-following subscription as Button (review I2/I3): a detached item
// releases its CanExecuteChanged subscription, and attaching re-queries, so a
// RoutedCommand assigned before the item joins the tree finds its binding.
describe('MenuItem command subscription follows the tree', () => {
    beforeEach(() => { initTestApp(); CommandManager._resetForTests(); });

    class BindingRoot extends Control
    {
        private readonly _kids: Visual[] = [];
        public AddChild(child: Visual): void
        {
            this._kids.push(child);
            (this as unknown as { AttachLogical(v: Visual): void }).AttachLogical(child);
            (this as unknown as { AttachVisual(v: Visual): void }).AttachVisual(child);
        }
        public RemoveChild(child: Visual): void
        {
            this._kids.splice(this._kids.indexOf(child), 1);
            (this as unknown as { DetachLogical(v: Visual): void }).DetachLogical(child);
            (this as unknown as { DetachVisual(v: Visual): void }).DetachVisual(child);
        }
        public override get visualChildren():  readonly Visual[] { return this._kids; }
        public override get logicalChildren(): readonly Visual[] { return this._kids; }
    }

    test('a RoutedCommand assigned before attach is re-queried when the item joins the tree', () => {
        const root = new BindingRoot();
        const cmd  = new RoutedCommand('Paste', RoutedCommand);
        root.CommandBindings.push(new CommandBinding(cmd, {
            executed:   () => { /* no-op */ },
            canExecute: (_s, args) => { args.CanExecute = true; },
        }));
        const mi = new MenuItem();
        mi.Command = cmd;
        assert.equal(mi.IsEnabled, false, 'detached: no binding reachable');
        root.AddChild(mi);
        assert.equal(mi.IsEnabled, true, 'attach re-queried and found the binding');
    });

    test('detaching releases the subscription; re-attaching restores it and re-queries', () => {
        const root = new BindingRoot();
        const gate = new Gate();
        const mi = new MenuItem();
        root.AddChild(mi);
        mi.Command = gate.Command;
        const listeners = (): number =>
            ((gate.Command as unknown as { _canExecuteListeners: Set<unknown> })._canExecuteListeners).size;
        assert.equal(listeners(), 1);
        root.RemoveChild(mi);
        assert.equal(listeners(), 0, 'released on detach');
        gate.Open = true;
        root.AddChild(mi);
        assert.equal(listeners(), 1, 'restored on attach');
        assert.equal(mi.IsEnabled, true, 'the change missed while detached is picked up');
    });
});
