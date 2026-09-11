import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    Application,
    Element,
    Key,
    NoModifiers,
    PointerButton,
    Visual,
    type FocusEventArgs,
    type KeyEventInit,
    type PointerEventArgs,
    type PointerEventInit,
    type QueryCursorEventArgs,
} from '../../runtime/index.js';
import { Control, InputManager } from '../index.js';

function key(overrides: Partial<KeyEventInit> = {}): KeyEventInit
{
    return { Key: Key.A, KeyText: 'a', Code: 'KeyA', Modifiers: NoModifiers, IsRepeat: false, ...overrides };
}

function pointer(overrides: Partial<PointerEventInit> = {}): PointerEventInit
{
    return {
        HostX: 0, HostY: 0,
        Button: PointerButton.Primary, Buttons: 1,
        Modifiers: NoModifiers, PointerId: 0, Pressure: 0,
        PointerType: 'mouse',
        ...overrides,
    };
}

class Focusable extends Control
{
    private readonly _kids: Visual[] = [];
    constructor() { super(); this.Focusable = true; }
    public AddChild(child: Visual): void
    {
        this._kids.push(child);
        (this as unknown as { AttachLogical(v: Visual): void }).AttachLogical(child);
        (this as unknown as { AttachVisual(v: Visual): void }).AttachVisual(child);
    }
    public override get visualChildren():  readonly Visual[] { return this._kids; }
    public override get logicalChildren(): readonly Visual[] { return this._kids; }
}

function on(el: Element, name: string, fn: (a: unknown) => void): void
{
    el.AddRoutedEventListener(name, fn);
}

describe('Phase 3a — button-specific mouse events', () => {
    beforeEach(() => { Application.current = null; });

    test('MouseLeftButtonDown/Up fire on primary press/release', () => {
        const el = new Focusable();
        const log: string[] = [];
        on(el, 'MouseLeftButtonDown', () => log.push('down'));
        on(el, 'MouseLeftButtonUp',   () => log.push('up'));
        const im = new InputManager();
        im.InjectPointerDown(el, pointer({ Button: PointerButton.Primary }));
        im.InjectPointerUp(el, pointer({ Button: PointerButton.Primary, Buttons: 0 }));
        assert.deepEqual(log, ['down', 'up']);
    });

    test('MouseRightButtonDown fires on secondary press; left does not', () => {
        const el = new Focusable();
        let left = 0, right = 0;
        on(el, 'MouseLeftButtonDown',  () => left++);
        on(el, 'MouseRightButtonDown', () => right++);
        const im = new InputManager();
        im.InjectPointerDown(el, pointer({ Button: PointerButton.Secondary, Buttons: 2 }));
        assert.equal(right, 1);
        assert.equal(left, 0);
    });
});

describe('Phase 3b — mouse-capture events', () => {
    beforeEach(() => { Application.current = null; });

    test('GotMouseCapture / LostMouseCapture fire on capture + release', () => {
        const el = new Focusable();
        const log: string[] = [];
        on(el, 'GotMouseCapture',  () => log.push('got'));
        on(el, 'LostMouseCapture', () => log.push('lost'));
        const im = new InputManager();
        im.InjectPointerDown(el, pointer());
        im.CapturePointer(el);
        im.ReleasePointerCapture();
        assert.deepEqual(log, ['got', 'lost']);
    });
});

describe('Phase 3c — keyboard-focus events', () => {
    beforeEach(() => { Application.current = null; });

    test('GotKeyboardFocus / LostKeyboardFocus fire on focus change, preview before bubble', () => {
        const el = new Focusable();
        const log: string[] = [];
        on(el, 'PreviewGotKeyboardFocus', () => log.push('preview-got'));
        on(el, 'GotKeyboardFocus',        () => log.push('got'));
        on(el, 'LostKeyboardFocus',       () => log.push('lost'));
        const im = new InputManager();
        im.SetFocus(el);
        im.SetFocus(undefined);
        assert.deepEqual(log, ['preview-got', 'got', 'lost']);
    });

    test('keyboard-focus events tunnel through ancestors', () => {
        const parent = new Focusable();
        const child  = new Focusable();
        parent.AddChild(child);
        const log: string[] = [];
        on(parent, 'PreviewGotKeyboardFocus', () => log.push('parent-preview'));
        on(child,  'GotKeyboardFocus',        () => log.push('child-bubble'));
        const im = new InputManager();
        im.SetFocus(child);
        // Tunnel (root→target) fires the parent's Preview before the
        // bubble (target→root) reaches the child's handler.
        assert.deepEqual(log, ['parent-preview', 'child-bubble']);
    });
});

describe('Phase 3d — QueryCursor', () => {
    beforeEach(() => { Application.current = null; });

    test('a QueryCursor handler picks the cursor; it flows to the host bridge', () => {
        const el = new Focusable();
        on(el, 'QueryCursor', (a) => {
            const args = a as QueryCursorEventArgs;
            args.Cursor = 'pointer';
            args.Handled = true;
        });
        let hostCursor: string | undefined = 'unset';
        const im = new InputManager();
        im.SetCursorBridge(c => { hostCursor = c; });
        im.InjectPointerMove(el, pointer({ HostX: 5, HostY: 5 }));
        assert.equal(hostCursor, 'pointer');
    });
});

describe('Phase 3e — Is*Changed via DP notifications (WPF parity)', () => {
    beforeEach(() => { Application.current = null; });

    test('IsFocused change is observable through the DP listener API', () => {
        // WPF’s Is*Changed members are DependencyProperty change events,
        // not routed events — mural delivers them through the standard DP
        // change-listener API. IsFocused is the keyboard-focus DP.
        const el = new Focusable();
        const seen: boolean[] = [];
        el.PropertyChanged(Element.IsFocusedKey).subscribe(() => seen.push(el.IsFocused));
        const im = new InputManager();
        im.SetFocus(el);
        im.SetFocus(undefined);
        assert.deepEqual(seen, [true, false]);
    });
});
