import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../basic/tests/test-app.js';

import {
    Application,
    DataContextBinding,
    NoModifiers,
    Observable,
    PointerButton,
    PropertyValueSource,
    RelayCommand,
    type PointerEventInit,
} from '../../runtime/index.js';
import { InputManager } from '../../framework/index.js';;
import { Border } from '../../basic/border.js';
import { CornerRadius } from '../../visual-engine/index.js';
import { type ClickHandler } from '../buttons/button.js';
import { Button, ButtonVariant, ClickMode } from '../buttons/button.js';
import { ContentPresenter } from '../../basic/templates/content-presenter.js';
import { Panel } from '../../runtime/index.js';
import { TextBlock } from '../../basic/text-block.js';

function pointer(overrides: Partial<PointerEventInit> = {}): PointerEventInit
{
    return {
        HostX:       0,
        HostY:       0,
        Button:      PointerButton.Primary,
        Buttons:     1,
        Modifiers:   NoModifiers,
        PointerId:   0,
        Pressure:    0,
        PointerType: 'mouse',
        ...overrides,
    };
}

// Minimal Panel subclass used as the root of input scenarios — gives
// the Button a visual parent so the routed-event walker has a route to
// build. We don't care about the parent's class; Panel is the simplest
// concrete Visual that accepts a child via AddChild.
class Root extends Panel { }

describe('Button — default template', () => {
    beforeEach(() => { initTestApp(); });

    test('Button construction installs a Border + StateLayer + ContentPresenter template', () => {
        const btn = new Button();
        const root = btn.visualChildren[0];
        assert.ok(root instanceof Border, 'template root should be a Border (PART_Border)');
        const stateLayer = (root as Border).child;
        assert.ok(stateLayer instanceof Border,
            'PART_Border child should be the PART_StateLayer Border (M3 state-layer overlay)');
        const presenter = (stateLayer as Border).child;
        assert.ok(presenter instanceof ContentPresenter,
            'PART_StateLayer child should be the ContentPresenter slot');
    });

    test('Content set on Button slots into the templated ContentPresenter', () => {
        const btn = new Button();
        const label = new TextBlock('Click me');
        btn.Content = label;
        const root = btn.visualChildren[0] as Border;
        const stateLayer = root.child as Border;
        const presenter = stateLayer.child as ContentPresenter;
        // ContentPresenter holds the slotted visual as its single visual child.
        assert.equal(presenter.visualChildren[0], label);
    });
});

describe('Button — Click protocol (Release mode)', () => {
    beforeEach(() => { initTestApp(); });

    test('PointerDown then PointerUp inside fires Command + handlers + OnClick', () => {
        const root = new Root();
        const btn  = new Button();
        root.AddChild(btn);

        let commandCalls = 0;
        let handlerCalls = 0;
        const log: string[] = [];

        btn.Command = new RelayCommand(() => { commandCalls++; log.push('command'); });
        const handler: ClickHandler = () => { handlerCalls++; log.push('handler'); };
        btn.AddClickHandler(handler);

        const im = new InputManager();
        im.InjectPointerDown(btn, pointer());
        im.InjectPointerUp  (btn, pointer());

        assert.equal(commandCalls, 1);
        assert.equal(handlerCalls, 1);
        // Order matters: command runs before handlers.
        assert.deepEqual(log, ['command', 'handler']);
    });

    test('IsPressed flips true on PointerDown, false on PointerUp', () => {
        const root = new Root();
        const btn  = new Button();
        root.AddChild(btn);

        assert.equal(btn.IsPressed, false);
        const im = new InputManager();
        im.InjectPointerDown(btn, pointer());
        assert.equal(btn.IsPressed, true);
        im.InjectPointerUp(btn, pointer());
        assert.equal(btn.IsPressed, false);
    });

    test('press + drag off cancels: PointerUp elsewhere does NOT fire Click', () => {
        const root = new Root();
        const btn  = new Button();
        const sibling = new Button();
        root.AddChild(btn);
        root.AddChild(sibling);

        let fired = 0;
        btn.AddClickHandler(() => { fired++; });

        const im = new InputManager();
        im.InjectPointerDown(btn, pointer());        // press on btn
        im.InjectPointerLeave(pointer());            // pointer off the host
        im.InjectPointerUp(null, pointer());          // released off-target

        assert.equal(fired, 0, 'Click should not fire when up happens off-target');
        // _pressOriginatedHere should have been cleared by the up too,
        // so a fresh Down → Up here works normally.
        im.InjectPointerDown(btn, pointer());
        im.InjectPointerUp  (btn, pointer());
        assert.equal(fired, 1);
    });

    test('drag-off then drag-back: IsPressed re-asserts on re-enter', () => {
        const root = new Root();
        const btn  = new Button();
        root.AddChild(btn);

        const im = new InputManager();
        im.InjectPointerDown(btn, pointer());
        assert.equal(btn.IsPressed, true);

        im.InjectPointerLeave(pointer());
        assert.equal(btn.IsPressed, false);

        // Pointer comes back over the button while the press is still
        // active (no PointerUp yet). InputManager fires Enter on btn.
        im.InjectPointerMove(btn, pointer());
        assert.equal(btn.IsPressed, true);

        let fired = 0;
        btn.AddClickHandler(() => { fired++; });
        im.InjectPointerUp(btn, pointer());
        assert.equal(fired, 1, 'release after drag-back fires Click');
    });

    test('Removed handler does not fire on subsequent clicks', () => {
        const root = new Root();
        const btn  = new Button();
        root.AddChild(btn);

        let fired = 0;
        const handler: ClickHandler = () => { fired++; };
        btn.AddClickHandler(handler);

        const im = new InputManager();
        im.InjectPointerDown(btn, pointer());
        im.InjectPointerUp  (btn, pointer());
        assert.equal(fired, 1);

        btn.RemoveClickHandler(handler);
        im.InjectPointerDown(btn, pointer());
        im.InjectPointerUp  (btn, pointer());
        assert.equal(fired, 1, 'removed handler should not run again');
    });
});

describe('Button — ICommand integration', () => {
    beforeEach(() => { initTestApp(); });

    test('Execute receives CommandParameter', () => {
        const root = new Root();
        const btn  = new Button();
        root.AddChild(btn);

        const seen: unknown[] = [];
        btn.Command          = new RelayCommand(p => { seen.push(p); });
        btn.CommandParameter = { id: 42 };

        const im = new InputManager();
        im.InjectPointerDown(btn, pointer());
        im.InjectPointerUp  (btn, pointer());

        assert.deepEqual(seen, [{ id: 42 }]);
    });

    test('CanExecute=false blocks BOTH Execute AND handlers', () => {
        const root = new Root();
        const btn  = new Button();
        root.AddChild(btn);

        let executed = 0;
        let handlerHits = 0;
        btn.Command = new RelayCommand(() => { executed++; }, () => false);
        btn.AddClickHandler(() => { handlerHits++; });

        const im = new InputManager();
        im.InjectPointerDown(btn, pointer());
        im.InjectPointerUp  (btn, pointer());

        assert.equal(executed,    0, 'Execute should not run when CanExecute is false');
        assert.equal(handlerHits, 0, 'click handlers are gated by CanExecute too');
    });

    test('CanExecuteChanged invalidates the cached gate', () => {
        const root = new Root();
        const btn  = new Button();
        root.AddChild(btn);

        let allow = false;
        let executed = 0;
        const cmd = new RelayCommand(() => { executed++; }, () => allow);
        btn.Command = cmd;

        const im = new InputManager();
        // First click: CanExecute() returned false at Command set time
        // and we cached that. Execute should NOT fire.
        im.InjectPointerDown(btn, pointer());
        im.InjectPointerUp  (btn, pointer());
        assert.equal(executed, 0);

        // VM flips the guard and notifies. Button re-queries CanExecute.
        allow = true;
        cmd.RaiseCanExecuteChanged();

        im.InjectPointerDown(btn, pointer());
        im.InjectPointerUp  (btn, pointer());
        assert.equal(executed, 1, 'after RaiseCanExecuteChanged the click should fire');
    });

    test('IsEnabled follows the command: a button that cannot execute shows as disabled', () => {
        const root = new Root();
        const btn  = new Button();
        root.AddChild(btn);

        let allow = false;
        const cmd = new RelayCommand(() => { }, () => allow);
        btn.Command = cmd;
        assert.equal(btn.IsEnabled, false, 'CanExecute false at bind time disables the button (its template dims it)');

        allow = true;
        cmd.RaiseCanExecuteChanged();
        assert.equal(btn.IsEnabled, true, 'CanExecuteChanged re-enables it');

        allow = false;
        cmd.RaiseCanExecuteChanged();
        assert.equal(btn.IsEnabled, false);

        btn.Command = undefined;
        assert.equal(btn.IsEnabled, true, 'removing the command restores the default');
    });

    test('CommandParameter change refreshes the cached gate', () => {
        const root = new Root();
        const btn  = new Button();
        root.AddChild(btn);

        let executed = 0;
        // CanExecute is true only when the parameter equals "ok".
        btn.Command = new RelayCommand(() => { executed++; },
                                        p => p === 'ok');
        btn.CommandParameter = 'nope';

        const im = new InputManager();
        im.InjectPointerDown(btn, pointer());
        im.InjectPointerUp  (btn, pointer());
        assert.equal(executed, 0);

        btn.CommandParameter = 'ok';
        im.InjectPointerDown(btn, pointer());
        im.InjectPointerUp  (btn, pointer());
        assert.equal(executed, 1);
    });

    test('Swapping Command detaches the old CanExecuteChanged listener', () => {
        const root = new Root();
        const btn  = new Button();
        root.AddChild(btn);

        const oldCmd = new RelayCommand(() => {});
        const newCmd = new RelayCommand(() => {});
        btn.Command = oldCmd;
        // Sneak the listener set count via the private listeners field.
        // We're testing the subscription bookkeeping, not the public API,
        // so a structural peek is fair game.
        // Listener bookkeeping moved to CommandBase after the
        // RelayCommand-extends-CommandBase refactor. The base stores the
        // set as a private `_canExecuteListeners` (renamed from
        // `_listeners` to avoid colliding with `Observable`'s private
        // property-change store); the structural peek follows.
        const peek = (c: RelayCommand) =>
            ((c as unknown as { _canExecuteListeners: Set<unknown> })._canExecuteListeners).size;

        assert.equal(peek(oldCmd), 1, 'Button subscribes to its current Command');

        btn.Command = newCmd;
        assert.equal(peek(oldCmd), 0, 'old Command should have its listener removed');
        assert.equal(peek(newCmd), 1, 'new Command picks up the subscription');
    });
});

// A command whose CanExecute is an open/closed gate the test flips.
class CommandGate
{
    public Open = false;
    public Executed = 0;
    public readonly Command = new RelayCommand(() => { this.Executed++; }, () => this.Open);

    public Set(open: boolean): void
    {
        this.Open = open;
        this.Command.RaiseCanExecuteChanged();
    }
}

// A view model exposing a command and an enabled flag as notifying properties,
// the shape a `.mu` `Command = $Command` / `IsEnabled = $Enabled` binds to.
class GateViewModel extends Observable
{
    private _command: RelayCommand | undefined;
    private _enabled = true;

    public get Command(): RelayCommand | undefined { return this._command; }
    public set Command(value: RelayCommand | undefined)
    {
        const old = this._command;
        this._command = value;
        this.RaisePropertyChanged('Command', old, value);
    }

    public get Enabled(): boolean { return this._enabled; }
    public set Enabled(value: boolean)
    {
        const old = this._enabled;
        this._enabled = value;
        this.RaisePropertyChanged('Enabled', old, value);
    }
}

// Effective IsEnabled = authored IsEnabled (local / binding / inherited) AND
// Command.CanExecute — WPF's ButtonBase.IsEnabledCore coercion, shared with MenuItem.
describe('Button — IsEnabled follows Command.CanExecute (WPF coercion)', () => {
    beforeEach(() => { initTestApp(); });

    test('a Command bound through DataContext drives IsEnabled and follows a command swap', () => {
        const root = new Root();
        const btn  = new Button();
        root.AddChild(btn);
        const vm = new GateViewModel();
        const closed = new CommandGate();
        vm.Command = closed.Command;
        btn.set_property_value(Button.CommandKey, DataContextBinding(btn, 'Command') as unknown as RelayCommand);
        btn.DataContext = vm;
        assert.equal(btn.Command, closed.Command, 'the binding delivered the command');
        assert.equal(btn.IsEnabled, false, 'a bound command that cannot execute disables the button');

        closed.Set(true);
        assert.equal(btn.IsEnabled, true, 'CanExecuteChanged through the bound command re-enables it');

        const other = new CommandGate();
        vm.Command = other.Command;
        assert.equal(btn.IsEnabled, false, 'the binding pushed a new command that cannot execute');
        vm.Command = undefined;
        assert.equal(btn.IsEnabled, true, 'the binding cleared the command: enabled again');
    });

    test('replacing the command re-subscribes; the old command no longer drives IsEnabled', () => {
        const btn = new Button();
        const a = new CommandGate();
        const b = new CommandGate();
        btn.Command = a.Command;
        assert.equal(btn.IsEnabled, false);
        b.Open = true;
        btn.Command = b.Command;
        assert.equal(btn.IsEnabled, true, 'the new command can execute');

        a.Set(false);
        a.Set(true);
        a.Set(false);
        assert.equal(btn.IsEnabled, true, 'the old command is unsubscribed');

        b.Set(false);
        assert.equal(btn.IsEnabled, false, 'the new command is subscribed');
        btn.Command = undefined;
        assert.equal(btn.IsEnabled, true, 'clearing the command restores IsEnabled');
        assert.equal(btn.GetValueSource(Button.IsEnabledKey), PropertyValueSource.Default,
            'nothing was written to the IsEnabled tiers: the default shows through');
    });

    test('an explicit IsEnabled=false is never overridden by a command that can execute', () => {
        const btn = new Button();
        btn.IsEnabled = false;
        const gate = new CommandGate();
        gate.Open = true;
        btn.Command = gate.Command;
        assert.equal(btn.IsEnabled, false, 'authored false AND CanExecute true is false');

        gate.Set(false);
        gate.Set(true);
        assert.equal(btn.IsEnabled, false, 'a CanExecute transition back to true does not override the author');

        btn.Command = undefined;
        assert.equal(btn.IsEnabled, false, 'clearing the command keeps the authored value');
        btn.IsEnabled = true;
        assert.equal(btn.IsEnabled, true);
    });

    test('an explicit IsEnabled=true written while the command cannot execute stays disabled', () => {
        const btn = new Button();
        const gate = new CommandGate();
        btn.Command = gate.Command;
        btn.IsEnabled = true;
        assert.equal(btn.IsEnabled, false, 'CanExecute false vetoes the authored true');
        gate.Set(true);
        assert.equal(btn.IsEnabled, true);
    });

    test('a bound IsEnabled stays bound and is ANDed with CanExecute', () => {
        const btn = new Button();
        const vm = new GateViewModel();
        btn.set_property_value(Button.IsEnabledKey, DataContextBinding(btn, 'Enabled') as unknown as boolean);
        btn.DataContext = vm;
        const gate = new CommandGate();
        btn.Command = gate.Command;
        assert.equal(btn.IsEnabled, false, 'bound true AND CanExecute false');

        gate.Set(true);
        assert.equal(btn.IsEnabled, true, 'bound true AND CanExecute true');
        vm.Enabled = false;
        assert.equal(btn.IsEnabled, false, 'the binding is still live after the command sync');
        vm.Enabled = true;
        assert.equal(btn.IsEnabled, true);
    });

    test('IsEnabled change notifications fire on CanExecute transitions (templates dim)', () => {
        const btn = new Button();
        const seen: unknown[] = [];
        btn.PropertyChanged(Button.IsEnabledKey).subscribe(({ newValue }) => { seen.push(newValue); });
        const gate = new CommandGate();
        btn.Command = gate.Command;
        gate.Set(true);
        gate.Set(true);
        btn.Command = undefined;
        assert.deepEqual(seen, [false, true], 'one notification per effective transition');
    });

    test('a command that cannot execute disables the button\'s content subtree and blocks clicks', () => {
        const root = new Root();
        const content = new Border();
        const btn  = new Button(content);
        root.AddChild(btn);
        const gate = new CommandGate();
        btn.Command = gate.Command;
        assert.equal(content.IsEnabled, false, 'the disabled state inherits into the content');

        const im = new InputManager();
        im.InjectPointerDown(btn, pointer());
        im.InjectPointerUp  (btn, pointer());
        assert.equal(gate.Executed, 0);

        gate.Set(true);
        assert.equal(content.IsEnabled, true, 'the content re-enables with the button');
        im.InjectPointerDown(btn, pointer());
        im.InjectPointerUp  (btn, pointer());
        assert.equal(gate.Executed, 1);
    });

    test('a disabled ancestor still disables a button whose command can execute', () => {
        const root = new Root();
        const btn  = new Button();
        root.AddChild(btn);
        const gate = new CommandGate();
        gate.Open = true;
        btn.Command = gate.Command;
        root.IsEnabled = false;
        assert.equal(btn.IsEnabled, false, 'inherited false is not overridden by CanExecute');
        root.IsEnabled = true;
        assert.equal(btn.IsEnabled, true);
    });
});

describe('Button — ClickMode variants', () => {
    beforeEach(() => { initTestApp(); });

    test('ClickMode.Press fires Click on PointerDown', () => {
        const root = new Root();
        const btn  = new Button();
        btn.ClickMode = ClickMode.Press;
        root.AddChild(btn);

        let fired = 0;
        btn.AddClickHandler(() => { fired++; });

        const im = new InputManager();
        im.InjectPointerDown(btn, pointer());
        assert.equal(fired, 1, 'Press mode fires on down');

        im.InjectPointerUp(btn, pointer());
        assert.equal(fired, 1, 'Up should not fire a second click in Press mode');
    });

    test('ClickMode.Hover fires Click when the pointer enters', () => {
        const root = new Root();
        const btn  = new Button();
        btn.ClickMode = ClickMode.Hover;
        root.AddChild(btn);

        let fired = 0;
        btn.AddClickHandler(() => { fired++; });

        const im = new InputManager();
        // Move onto the button (Enter dispatched).
        im.InjectPointerMove(btn, pointer({ Button: PointerButton.None, Buttons: 0 }));
        assert.equal(fired, 1, 'Hover mode fires on enter');

        // Moving within doesn't re-fire (Enter is direct + only fires
        // on newly-added visuals in the hover chain).
        im.InjectPointerMove(btn, pointer({ Button: PointerButton.None, Buttons: 0 }));
        assert.equal(fired, 1);
    });
});

describe('Button — Variant DP', () => {
    beforeEach(() => { initTestApp(); });

    test('Variant default is Filled', () => {
        const btn = new Button();
        assert.equal(btn.Variant, ButtonVariant.Filled);
    });

    test('Variant is a settable, get-roundtrips DP', () => {
        const btn = new Button();
        btn.Variant = ButtonVariant.Outlined;
        assert.equal(btn.Variant, ButtonVariant.Outlined);
        btn.Variant = ButtonVariant.Elevated;
        assert.equal(btn.Variant, ButtonVariant.Elevated);
    });

    test('Default template (Filled) installs the Border + ContentPresenter chrome', () => {
        const btn = new Button();
        const root = btn.visualChildren[0];
        assert.ok(root instanceof Border,
            'Filled template root should be a Border (PART_Border)');
        // The Filled variant carries no Effect — elevation lives only
        // on the Elevated variant.
        assert.equal(root.Effect, undefined,
            'Filled variant should have no Effect at rest');
    });
});

describe('Button — CornerRadius DP (18.2)', () => {
    beforeEach(() => { initTestApp(); });

    test('CornerRadius default is @RadiusMd (6dp rounded rect)', () => {
        const btn = new Button();
        // Default Style setter (`CornerRadius = @RadiusMd`) resolves to 6dp under
        // the Pragmatic theme — the M3 pill was retired for a rounded rectangle
        // (Material's @ShapeSmall was 8dp; Pragmatic's @RadiusMd is 6dp). The DP
        // default_value (CornerRadius.Full) remains only as the style-less safety net.
        assert.equal(btn.CornerRadius, 6);
    });

    test('default CornerRadius TemplateBinds @RadiusMd (6) onto PART_Border + PART_StateLayer', () => {
        const btn = new Button();
        const border = btn.visualChildren[0] as Border;
        const stateLayer = border.child as Border;
        assert.equal(border.CornerRadius, 6,
            'PART_Border corner should ride $$CornerRadius from the @RadiusMd default');
        assert.equal(stateLayer.CornerRadius, 6,
            'PART_StateLayer corner should match PART_Border via the same binding');
    });

    test('a per-instance CornerRadius set flows through to the template parts', () => {
        const btn = new Button();
        // A segmented-bank left half: rounded left, square right.
        const shape = new CornerRadius(12, 0, 0, 12);
        btn.CornerRadius = shape;
        const border = btn.visualChildren[0] as Border;
        const stateLayer = border.child as Border;
        assert.equal(border.CornerRadius, shape,
            'Local CornerRadius set overrides the Style setter and reaches PART_Border');
        assert.equal(stateLayer.CornerRadius, shape,
            'the state-layer overlay tracks the same per-instance corner');
    });

    test('a uniform numeric CornerRadius is accepted and propagates', () => {
        const btn = new Button();
        btn.CornerRadius = 4;
        const border = btn.visualChildren[0] as Border;
        assert.equal(border.CornerRadius, 4);
    });
});
