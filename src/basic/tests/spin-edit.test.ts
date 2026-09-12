import { ModifierKeys, toModifierKeys } from '../../runtime/index.js';
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from './test-app.js';

import {
    Application,
    Key,
    NoModifiers,    PointerButton,
    type KeyEventInit,
    type ModifierKeys,
    type PointerEventInit,
} from '../../runtime/index.js';
import { HeadlessTarget } from '../../visual-engine/index.js';
import { SpinEdit } from '../spin-edit.js';
import { TextBox } from '../text-box.js';
import { TextBlock } from '../text-block.js';
import { ClickableBorder } from '../clickable-border.js';

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

function key(k: Key, mods: Partial<ModifierKeys> = {}, code?: string): KeyEventInit
{
    return {
        Key:       k,
        KeyText:       k,
        Code:      code ?? k,
        Modifiers: toModifierKeys({ shift: mods.Shift, control: mods.Control, alt: mods.Alt, meta: mods.Meta }),
        IsRepeat:  false,
    };
}

// Stand up a SpinEdit inside a HeadlessTarget so pointer + keyboard
// dispatch and measure all flow end-to-end. Mounting directly as the
// target's Content (no Panel wrapper) keeps the SpinEdit's Measure
// pass running — a wrapping Panel's default MeasureOverride returns
// Size.Zero and never measures children, which would leave the inner
// TextBox's editor unmeasured.
function fixture(): {
    sp:        SpinEdit;
    target:    HeadlessTarget;
    inner:     TextBox;
    up:        ClickableBorder;
    down:      ClickableBorder;
}
{
    const sp = new SpinEdit();
    const target = new HeadlessTarget(200, 60);
    target.Content = sp;
    target.Flush();

    // Reach into the SpinEdit's private template parts so tests can
    // assert against them and route pointer events at them. Keeps the
    // public surface small — the inner TextBox + buttons are
    // implementation details consumers shouldn't depend on.
    const inner = (sp as unknown as { _textBox:    TextBox }       )._textBox;
    const up    = (sp as unknown as { _upButton:   ClickableBorder })._upButton;
    const down  = (sp as unknown as { _downButton: ClickableBorder })._downButton;
    return { sp, target, inner, up, down };
}

describe('SpinEdit — value font forwarding', () => {
    beforeEach(() => { initTestApp(); });

    test('TextBlock.FontSize on the SpinEdit forwards to the inner TextBox', () => {
        const sp = new SpinEdit();
        sp.set_property_value(TextBlock.FontSizeKey, 12);
        const target = new HeadlessTarget(200, 60);
        target.Content = sp;
        target.Flush();
        const inner = (sp as unknown as { _textBox: TextBox })._textBox;
        assert.equal(inner.FontSize, 12, 'inner editor honours the override');
    });

    test('without an override the inner TextBox keeps its Style default (not 12)', () => {
        const sp = new SpinEdit();
        const target = new HeadlessTarget(200, 60);
        target.Content = sp;
        target.Flush();
        const inner = (sp as unknown as { _textBox: TextBox })._textBox;
        assert.notEqual(inner.FontSize, 12, 'no forward when unset — TextBox Style stands');
    });
});

describe('SpinEdit — defaults', () => {
    beforeEach(() => { initTestApp(); });

    test('Default Value is 0, DecimalPlaces=0, SmallChange=1, LargeChange=10', () => {
        const sp = new SpinEdit();
        assert.equal(sp.Value,         0);
        assert.equal(sp.DecimalPlaces, 0);
        assert.equal(sp.SmallChange,   1);
        assert.equal(sp.LargeChange,   10);
        assert.equal(sp.IsReadOnly,    false);
    });

    test('Inner TextBox display reflects the formatted Value at construction', () => {
        const { inner } = fixture();
        assert.equal(inner.Text, '0');
    });
});

describe('SpinEdit — buttons', () => {
    beforeEach(() => { initTestApp(); });

    test('Click ▴ increments by SmallChange', () => {
        const { sp, target, up } = fixture();
        sp.Value = 5;

        target.InputManager.InjectPointerDown(up, pointer());
        target.InputManager.InjectPointerUp  (up, pointer());
        assert.equal(sp.Value, 6);

        sp.SmallChange = 3;
        target.InputManager.InjectPointerDown(up, pointer());
        target.InputManager.InjectPointerUp  (up, pointer());
        assert.equal(sp.Value, 9);
    });

    test('Click ▾ decrements by SmallChange', () => {
        const { sp, target, down } = fixture();
        sp.Value = 5;

        target.InputManager.InjectPointerDown(down, pointer());
        target.InputManager.InjectPointerUp  (down, pointer());
        assert.equal(sp.Value, 4);
    });

    test('Display updates after a button click', () => {
        const { sp, target, inner, up } = fixture();
        sp.Value = 7;
        assert.equal(inner.Text, '7');

        target.InputManager.InjectPointerDown(up, pointer());
        target.InputManager.InjectPointerUp  (up, pointer());
        assert.equal(inner.Text, '8');
    });

    test('Click ▴ clamps at Maximum', () => {
        const { sp, target, up } = fixture();
        sp.Maximum = 10;
        sp.Value   = 10;
        target.InputManager.InjectPointerDown(up, pointer());
        target.InputManager.InjectPointerUp  (up, pointer());
        assert.equal(sp.Value, 10);
    });

    test('Click ▾ clamps at Minimum', () => {
        const { sp, target, down } = fixture();
        sp.Minimum = 0;
        sp.Value   = 0;
        target.InputManager.InjectPointerDown(down, pointer());
        target.InputManager.InjectPointerUp  (down, pointer());
        assert.equal(sp.Value, 0);
    });

    test('IsReadOnly suppresses button clicks', () => {
        const { sp, target, up, down } = fixture();
        sp.Value      = 5;
        sp.IsReadOnly = true;
        target.InputManager.InjectPointerDown(up, pointer());
        target.InputManager.InjectPointerUp  (up, pointer());
        target.InputManager.InjectPointerDown(down, pointer());
        target.InputManager.InjectPointerUp  (down, pointer());
        assert.equal(sp.Value, 5);
    });
});

describe('SpinEdit — keyboard', () => {
    beforeEach(() => { initTestApp(); });

    test('ArrowUp increments by SmallChange (intercepted in tunnel)', () => {
        const { sp, target, inner } = fixture();
        sp.Value = 5;
        target.InputManager.SetFocus(inner);

        const handled = target.InputManager.InjectKeyDown(key(Key.Up));
        assert.equal(handled, true, 'SpinEdit should mark ArrowUp Handled in preview');
        assert.equal(sp.Value, 6);
    });

    test('ArrowDown decrements by SmallChange', () => {
        const { sp, target, inner } = fixture();
        sp.Value = 5;
        target.InputManager.SetFocus(inner);

        target.InputManager.InjectKeyDown(key(Key.Down));
        assert.equal(sp.Value, 4);
    });

    test('PageUp / PageDown use LargeChange', () => {
        const { sp, target, inner } = fixture();
        sp.LargeChange = 25;
        sp.Value       = 100;
        target.InputManager.SetFocus(inner);

        target.InputManager.InjectKeyDown(key(Key.PageUp));
        assert.equal(sp.Value, 125);

        target.InputManager.InjectKeyDown(key(Key.PageDown));
        assert.equal(sp.Value, 100);
    });

    test('ArrowUp does NOT reach the inner TextBox caret model', () => {
        const { sp, target, inner } = fixture();
        sp.Value = 5;
        target.InputManager.SetFocus(inner);
        // Make sure inner's CaretIndex isn't touched — TextBox's own
        // ArrowUp moves to text edge; SpinEdit intercepts before that.
        const caretBefore = inner.CaretIndex;
        target.InputManager.InjectKeyDown(key(Key.Up));
        assert.equal(inner.CaretIndex, caretBefore);
    });

    test('IsReadOnly suppresses Arrow / Page steps but still marks Handled', () => {
        const { sp, target, inner } = fixture();
        sp.Value      = 5;
        sp.IsReadOnly = true;
        target.InputManager.SetFocus(inner);

        const handled = target.InputManager.InjectKeyDown(key(Key.Up));
        // Still Handled — we don't want ArrowUp to leak through and
        // step the TextBox's caret even in read-only mode.
        assert.equal(handled, true);
        assert.equal(sp.Value, 5);
    });
});

describe('SpinEdit — Text commit', () => {
    beforeEach(() => { initTestApp(); });

    test('Enter commits the inner Text into Value', () => {
        const { sp, target, inner } = fixture();
        target.InputManager.SetFocus(inner);
        inner.Text = '42';

        const handled = target.InputManager.InjectKeyDown(key(Key.Return));
        assert.equal(handled, true);
        assert.equal(sp.Value,   42);
        assert.equal(inner.Text, '42');
    });

    test('Blur (focus leaves the inner TextBox) commits the typed text', () => {
        const { sp, target, inner } = fixture();
        target.InputManager.SetFocus(inner);
        inner.Text = '17';

        target.InputManager.SetFocus(undefined);
        assert.equal(sp.Value,   17);
        assert.equal(inner.Text, '17');
    });

    test('Invalid text on commit reverts the display to the current Value', () => {
        const { sp, target, inner } = fixture();
        sp.Value = 5;
        target.InputManager.SetFocus(inner);
        inner.Text = 'not a number';

        target.InputManager.InjectKeyDown(key(Key.Return));
        assert.equal(sp.Value,   5);
        assert.equal(inner.Text, '5');
    });

    test('Commit clamps to [Minimum, Maximum]', () => {
        const { sp, target, inner } = fixture();
        sp.Minimum = 0;
        sp.Maximum = 100;
        target.InputManager.SetFocus(inner);

        inner.Text = '999';
        target.InputManager.InjectKeyDown(key(Key.Return));
        assert.equal(sp.Value,   100);
        assert.equal(inner.Text, '100');

        inner.Text = '-50';
        target.InputManager.InjectKeyDown(key(Key.Return));
        assert.equal(sp.Value,   0);
        assert.equal(inner.Text, '0');
    });

    test('Infinity / NaN typed text is rejected (display reverts)', () => {
        const { sp, target, inner } = fixture();
        sp.Value = 7;
        target.InputManager.SetFocus(inner);

        inner.Text = 'Infinity';
        target.InputManager.InjectKeyDown(key(Key.Return));
        assert.equal(sp.Value,   7,   'Infinity must not commit');
        assert.equal(inner.Text, '7');

        inner.Text = 'NaN';
        target.InputManager.InjectKeyDown(key(Key.Return));
        assert.equal(sp.Value,   7);
        assert.equal(inner.Text, '7');
    });

    test('Empty text on commit reverts to the current Value', () => {
        const { sp, target, inner } = fixture();
        sp.Value = 3;
        target.InputManager.SetFocus(inner);

        inner.Text = '';
        target.InputManager.InjectKeyDown(key(Key.Return));
        assert.equal(sp.Value,   3);
        assert.equal(inner.Text, '3');
    });
});

describe('SpinEdit — DecimalPlaces formatting + rounding', () => {
    beforeEach(() => { initTestApp(); });

    test('DecimalPlaces=2 formats the display with two decimals', () => {
        const { sp, inner } = fixture();
        sp.DecimalPlaces = 2;
        sp.Value         = 5;
        assert.equal(inner.Text, '5.00');

        sp.Value = 3.1;
        assert.equal(inner.Text, '3.10');
    });

    test('Commit rounds typed text to DecimalPlaces precision', () => {
        const { sp, target, inner } = fixture();
        sp.DecimalPlaces = 0;
        target.InputManager.SetFocus(inner);

        inner.Text = '1.999';
        target.InputManager.InjectKeyDown(key(Key.Return));
        assert.equal(sp.Value, 2, '1.999 with DP=0 rounds to 2 before commit');
        assert.equal(inner.Text, '2');
    });

    test('Display reformats when Value setter is called even if rounded result equals current', () => {
        const { sp, target, inner } = fixture();
        sp.DecimalPlaces = 0;
        sp.Value         = 2;
        target.InputManager.SetFocus(inner);

        // Typing "2.0" then committing leaves Value=2 (same), but the
        // display must clean up to "2" (not "2.0") so SpinEdit doesn't
        // leak the user's intermediate text after blur.
        inner.Text = '2.0';
        target.InputManager.InjectKeyDown(key(Key.Return));
        assert.equal(sp.Value,   2);
        assert.equal(inner.Text, '2');
    });
});

describe('SpinEdit — clamping + NaN', () => {
    beforeEach(() => { initTestApp(); });

    test('Value setter clamps to [Minimum, Maximum]', () => {
        const sp = new SpinEdit();
        sp.Minimum = 0;
        sp.Maximum = 10;

        sp.Value = 99;
        assert.equal(sp.Value, 10);

        sp.Value = -5;
        assert.equal(sp.Value, 0);
    });

    test('Value setter ignores NaN, preserving the prior value', () => {
        const sp = new SpinEdit();
        sp.Value = 4;
        sp.Value = Number.NaN;
        assert.equal(sp.Value, 4);
    });

    test('Programmatic Value write keeps display in sync', () => {
        const { sp, inner } = fixture();
        sp.Value = 17;
        assert.equal(inner.Text, '17');

        sp.Value = -3;
        assert.equal(inner.Text, '-3');
    });
});

describe('SpinEdit — IsReadOnly propagation', () => {
    beforeEach(() => { initTestApp(); });

    test('IsReadOnly is forwarded to the inner TextBox', () => {
        const { sp, inner } = fixture();
        assert.equal(inner.IsReadOnly, false);

        sp.IsReadOnly = true;
        assert.equal(inner.IsReadOnly, true);

        sp.IsReadOnly = false;
        assert.equal(inner.IsReadOnly, false);
    });
});

describe('SpinEdit — hold-to-repeat spin buttons', () => {
    beforeEach(() => { initTestApp(); });
    // Mock timers are enabled per-test AFTER fixture()/Flush so the mock does
    // not intercept any setTimeout used during construction/layout — the repeat
    // timer only starts on the pointer-down below.
    afterEach(() => { mock.timers.reset(); });

    test('holding ▴ steps once immediately, then repeats and accelerates until release', () => {
        const { sp, target, up } = fixture();
        sp.SmallChange = 1;
        sp.Value = 0;
        mock.timers.enable({ apis: ['setTimeout'] });

        target.InputManager.InjectPointerDown(up, pointer());
        assert.equal(sp.Value, 1, 'press steps once immediately');
        mock.timers.tick(399); assert.equal(sp.Value, 1, 'no repeat before the initial delay');
        mock.timers.tick(1);   assert.equal(sp.Value, 2, 'first repeat at the initial delay');
        mock.timers.tick(120); assert.equal(sp.Value, 3);
        mock.timers.tick(100); assert.equal(sp.Value, 4, 'gap shrank — accelerating');

        target.InputManager.InjectPointerUp(up, pointer());
        mock.timers.tick(5000);
        assert.equal(sp.Value, 4, 'release stops the repeat');
    });

    test('holding ▾ decrements repeatedly', () => {
        const { sp, target, down } = fixture();
        sp.Value = 10;
        mock.timers.enable({ apis: ['setTimeout'] });

        target.InputManager.InjectPointerDown(down, pointer());   // -1 (now 9)
        mock.timers.tick(400);   // -1 (8)
        mock.timers.tick(120);   // -1 (7)
        mock.timers.tick(100);   // -1 (6)
        target.InputManager.InjectPointerUp(down, pointer());
        assert.equal(sp.Value, 6, '1 immediate + 3 repeats = -4');
    });

    test('IsReadOnly — holding a spin button never changes Value', () => {
        const { sp, target, up } = fixture();
        sp.IsReadOnly = true;
        sp.Value = 5;
        mock.timers.enable({ apis: ['setTimeout'] });

        target.InputManager.InjectPointerDown(up, pointer());
        mock.timers.tick(5000);
        target.InputManager.InjectPointerUp(up, pointer());
        assert.equal(sp.Value, 5, 'read-only held press is a no-op');
    });
});
