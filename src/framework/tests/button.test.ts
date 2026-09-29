import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../basic/tests/test-app.js';

import { Application, NoModifiers, PointerButton, RelayCommand, type PointerEventInit } from '../../runtime/index.js';
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
