import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    NoModifiers,
    PointerButton,
    RelayCommand,
} from '../../../runtime/index.js';
import {
    CommandBinding,
    CommandManager,
    RoutedCommand,
} from '../../index.js';;
import { Application, Visual } from '../../../runtime/index.js';
import { Control, InputManager } from '../../../framework/index.js';;;
import { Button } from '@pragmatic-tech-ai/mural/framework';

class Root extends Control
{
    private readonly _kids: Visual[] = [];
    public AddChild(child: Visual): void
    {
        this._kids.push(child);
        (this as unknown as { AttachLogical(v: Visual): void }).AttachLogical(child);
        (this as unknown as { AttachVisual(v: Visual): void }).AttachVisual(child);
    }
    public override get visualChildren():  readonly Visual[] { return this._kids; }
    public override get logicalChildren(): readonly Visual[] { return this._kids; }
}

function pointer(): {
    HostX: number; HostY: number;
    Button: PointerButton; Buttons: number;
    Modifiers: typeof NoModifiers; PointerId: number; Pressure: number;
    PointerType: 'mouse';
}
{
    return {
        HostX: 0, HostY: 0,
        Button: PointerButton.Primary, Buttons: 1,
        Modifiers: NoModifiers, PointerId: 0, Pressure: 0,
        PointerType: 'mouse',
    };
}

describe('Button — ICommandSource with RoutedCommand', () => {
    beforeEach(() => {
        Application.current = null;
        CommandManager._resetForTests();
    });

    test('Click routes a RoutedCommand through ancestor CommandBindings', () => {
        const root = new Root();
        const btn  = new Button();
        root.AddChild(btn);

        const cmd = new RoutedCommand('Save', RoutedCommand);
        let executed = 0;
        let seenParam: unknown = null;
        let seenTarget: unknown = null;
        root.CommandBindings.push(new CommandBinding(cmd, {
            executed: (_sender, args) => {
                executed++;
                seenParam  = args.Parameter;
                seenTarget = args.Target;
                args.Handled = true;
            },
        }));

        btn.Command = cmd;
        btn.CommandParameter = 'payload';

        const im = new InputManager();
        im.InjectPointerDown(btn, pointer());
        im.InjectPointerUp  (btn, pointer());
        assert.equal(executed, 1);
        assert.equal(seenParam, 'payload');
        assert.equal(seenTarget, btn);
    });

    test('Routed CanExecute false → click does not invoke handlers either', () => {
        const root = new Root();
        const btn  = new Button();
        root.AddChild(btn);

        const cmd = new RoutedCommand('Foo', RoutedCommand);
        let executed = 0;
        let handlerCalls = 0;
        root.CommandBindings.push(new CommandBinding(cmd, {
            executed:   () => { executed++; },
            canExecute: (_s, args) => { args.CanExecute = false; },
        }));
        btn.Command = cmd;
        btn.AddClickHandler(() => { handlerCalls++; });

        const im = new InputManager();
        im.InjectPointerDown(btn, pointer());
        im.InjectPointerUp  (btn, pointer());
        assert.equal(executed,     0);
        assert.equal(handlerCalls, 0);
    });

    test('CommandTarget redirects routing dispatch', () => {
        // Button hosted inside root#A. CommandTarget = node inside
        // root#B. Pressing the Button should fire B's binding, not A's.
        const rootA = new Root();
        const rootB = new Root();
        const btn   = new Button();
        const inB   = new Root();
        rootA.AddChild(btn);
        rootB.AddChild(inB);

        const cmd = new RoutedCommand('Foo', RoutedCommand);
        const log: string[] = [];
        rootA.CommandBindings.push(new CommandBinding(cmd, {
            executed: (_s, args) => { log.push('A'); args.Handled = true; },
        }));
        rootB.CommandBindings.push(new CommandBinding(cmd, {
            executed: (_s, args) => { log.push('B'); args.Handled = true; },
        }));

        btn.Command       = cmd;
        btn.CommandTarget = inB;

        const im = new InputManager();
        im.InjectPointerDown(btn, pointer());
        im.InjectPointerUp  (btn, pointer());
        assert.deepEqual(log, ['B']);
    });

    test('CanExecuteChanged updates the cached gate on RoutedCommand via RequerySuggested', () => {
        const root = new Root();
        const btn  = new Button();
        root.AddChild(btn);

        const cmd = new RoutedCommand('Foo', RoutedCommand);
        let allowed = false;
        root.CommandBindings.push(new CommandBinding(cmd, {
            executed:   () => { /* runs only when allowed */ },
            canExecute: (_s, args) => { args.CanExecute = allowed; },
        }));
        btn.Command = cmd;

        // Initial: gate is closed.
        const im = new InputManager();
        im.InjectPointerDown(btn, pointer());
        im.InjectPointerUp  (btn, pointer());

        // Flip the flag and pulse RequerySuggested so the helper picks
        // it up. (In a real app focus changes or VM signals trigger
        // this; here we drive it directly.)
        allowed = true;
        CommandManager.InvalidateRequerySuggested();

        let executed = 0;
        // Re-register a fresh Executed counter for the second click.
        root.CommandBindings.length = 0;
        root.CommandBindings.push(new CommandBinding(cmd, {
            executed:   () => { executed++; },
            canExecute: (_s, args) => { args.CanExecute = allowed; },
        }));
        // Replace the binding stack — pulse again so the helper picks
        // up the new CanExecute result against the new binding.
        CommandManager.InvalidateRequerySuggested();

        im.InjectPointerDown(btn, pointer());
        im.InjectPointerUp  (btn, pointer());
        assert.equal(executed, 1);
    });

    test('Plain RelayCommand path still works (Button.Command = relay)', () => {
        // Regression — the helper refactor must not break the existing
        // RelayCommand path. Same shape as the pre-existing button.test
        // case, validated through the new helper.
        const root = new Root();
        const btn  = new Button();
        root.AddChild(btn);

        let executed = 0;
        btn.Command = new RelayCommand(() => { executed++; });

        const im = new InputManager();
        im.InjectPointerDown(btn, pointer());
        im.InjectPointerUp  (btn, pointer());
        assert.equal(executed, 1);
    });
});

// IsEnabled tracking for a RoutedCommand on Button (review I3, M3): the
// routed CanExecute walk depends on the button's ancestors, so it must be
// re-queried when the button joins the tree, and RequerySuggested must move
// IsEnabled (not only the click gate).
describe('Button — RoutedCommand drives IsEnabled', () => {
    beforeEach(() => {
        Application.current = null;
        CommandManager._resetForTests();
    });

    test('a RoutedCommand assigned before the button joins the tree is re-queried on attach', () => {
        const root = new Root();
        const cmd  = new RoutedCommand('Save', RoutedCommand);
        let executed = 0;
        root.CommandBindings.push(new CommandBinding(cmd, {
            executed:   () => { executed++; },
            canExecute: (_s, args) => { args.CanExecute = true; },
        }));
        const btn = new Button();
        btn.Command = cmd;
        assert.equal(btn.IsEnabled, false, 'detached: no CommandBinding is reachable yet');

        root.AddChild(btn);
        assert.equal(btn.IsEnabled, true, 'attaching re-queries and finds the ancestor binding');
        const im = new InputManager();
        im.InjectPointerDown(btn, pointer());
        im.InjectPointerUp  (btn, pointer());
        assert.equal(executed, 1);
    });

    test('RequerySuggested toggles IsEnabled both ways', () => {
        const root = new Root();
        const btn  = new Button();
        root.AddChild(btn);
        const cmd = new RoutedCommand('Foo', RoutedCommand);
        let allowed = false;
        root.CommandBindings.push(new CommandBinding(cmd, {
            executed:   () => { /* no-op */ },
            canExecute: (_s, args) => { args.CanExecute = allowed; },
        }));
        btn.Command = cmd;
        assert.equal(btn.IsEnabled, false);

        allowed = true;
        CommandManager.InvalidateRequerySuggested();
        assert.equal(btn.IsEnabled, true, 'RequerySuggested re-enables the button');
        allowed = false;
        CommandManager.InvalidateRequerySuggested();
        assert.equal(btn.IsEnabled, false, 'and disables it again');
    });
});
