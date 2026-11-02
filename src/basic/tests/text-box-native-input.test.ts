// TextBox.UsesNativeInput: the TextBox edits through a real browser <input>,
// hosted by its PART_Editor through the renderer's <foreignObject> path, so
// IME, autofill / password managers, mobile keyboards and assistive technology
// work. These tests pin the contract: off by default, two-way Text sync, the
// autocomplete / type hints, key and pointer containment (Enter / Escape still
// reach mural), focus mirroring, and the editor painting nothing while active.

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { Rect, Size } from '../../runtime/index.js';
import { SvgRenderer } from '../../visual-engine/index.js';
import { initTestApp } from './test-app.js';
import { InputPurpose } from '../input-purpose.js';
import { TextBox } from '../text-box.js';

// Counts mural focus requests instead of routing them to an InputManager.
class FocusSpyTextBox extends TextBox
{
    public FocusCount = 0;

    public override Focus(): void
    {
        this.FocusCount++;
    }
}

class NativeFixture
{
    public readonly Document: Document;
    public readonly Surface: SVGSVGElement;
    public readonly Window: Window;

    public constructor()
    {
        const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
        this.Window = dom.window as unknown as Window;
        this.Document = dom.window.document;
        this.Surface = this.Document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
        this.Document.body.appendChild(this.Surface);
    }

    // A native-input TextBox in this fixture's document.
    public Box(): TextBox
    {
        const tb = new TextBox();
        tb.OwnerDocument = this.Document;
        tb.UsesNativeInput = true;
        return tb;
    }

    public Input(tb: TextBox): HTMLInputElement
    {
        const el = tb.NativeInputElement;
        assert.ok(el !== undefined, 'the native input exists');
        return el as HTMLInputElement;
    }

    public Type(input: HTMLInputElement, value: string): void
    {
        input.value = value;
        input.dispatchEvent(new this.Window.Event('input', { bubbles: true }));
    }

    public Key(input: HTMLInputElement, key: string): KeyboardEvent
    {
        const e = new this.Window.KeyboardEvent('keydown', { key, bubbles: true });
        input.dispatchEvent(e);
        return e;
    }
}

describe('TextBox.UsesNativeInput', () =>
{
    beforeEach(() => { initTestApp(); });

    test('off by default: the painted editor stays and no input is created', () =>
    {
        const fx = new NativeFixture();
        const tb = new TextBox();
        tb.OwnerDocument = fx.Document;
        assert.equal(tb.UsesNativeInput, false);
        assert.equal(tb.IsNativeInputActive, false);
        assert.equal(tb.NativeInputElement, undefined);
    });

    test('a multi-line box keeps the painted editor even with UsesNativeInput', () =>
    {
        const fx = new NativeFixture();
        const tb = fx.Box();
        tb.AcceptsReturn = true;
        assert.equal(tb.IsNativeInputActive, false);
        assert.equal(tb.NativeInputElement, undefined);
    });

    test('Text flows both ways: typing writes Text, a Text change from code updates the input', () =>
    {
        const fx = new NativeFixture();
        const tb = fx.Box();
        tb.Text = 'seed';
        const input = fx.Input(tb);
        assert.equal(input.tagName, 'INPUT');
        assert.equal(input.value, 'seed');
        fx.Type(input, 'typed by the user');
        assert.equal(tb.Text, 'typed by the user');
        tb.Text = 'set from a binding';
        assert.equal(input.value, 'set from a binding');
    });

    test('IsPassword and InputPurpose set the type, autocomplete token, name and keyboard', () =>
    {
        const fx = new NativeFixture();
        const email = fx.Box();
        email.InputPurpose = InputPurpose.Email;
        const emailInput = fx.Input(email);
        assert.equal(emailInput.type, 'email');
        assert.equal(emailInput.getAttribute('autocomplete'), 'email');
        assert.equal(emailInput.getAttribute('name'), 'email');
        assert.equal(emailInput.getAttribute('inputmode'), 'email');

        const password = fx.Box();
        password.IsPassword = true;
        password.InputPurpose = InputPurpose.CurrentPassword;
        const passwordInput = fx.Input(password);
        assert.equal(passwordInput.type, 'password');
        assert.equal(passwordInput.getAttribute('autocomplete'), 'current-password');

        const plain = fx.Box();
        const plainInput = fx.Input(plain);
        assert.equal(plainInput.type, 'text');
        assert.equal(plainInput.hasAttribute('autocomplete'), false);
    });

    test('Placeholder doubles as the accessible name; IsReadOnly and IsEnabled carry over', () =>
    {
        const fx = new NativeFixture();
        const tb = fx.Box();
        tb.Placeholder = 'Email';
        tb.IsReadOnly = true;
        tb.IsEnabled = false;
        const input = fx.Input(tb);
        assert.equal(input.placeholder, 'Email');
        assert.equal(input.getAttribute('aria-label'), 'Email');
        assert.equal(input.readOnly, true);
        assert.equal(input.disabled, true);
    });

    test('editing keys stay in the input; Enter, Escape and Tab continue to the mural host', () =>
    {
        const fx = new NativeFixture();
        const tb = fx.Box();
        const input = fx.Input(tb);
        fx.Document.body.appendChild(input);
        const reached: string[] = [];
        fx.Document.body.addEventListener('keydown', (e: Event) => reached.push((e as KeyboardEvent).key));
        for (const key of ['a', 'Backspace', 'ArrowLeft', 'Tab', 'Enter', 'Escape'])
        {
            fx.Key(input, key);
        }
        assert.deepEqual(reached, ['Tab', 'Enter', 'Escape']);
    });

    test('app shortcuts reach mural; the input keeps its own editing chords', () =>
    {
        const fx = new NativeFixture();
        const input = fx.Input(fx.Box());
        fx.Document.body.appendChild(input);
        const reached: string[] = [];
        fx.Document.body.addEventListener('keydown', (e: Event) =>
        {
            const k = e as KeyboardEvent;
            reached.push((k.ctrlKey ? 'Ctrl+' : '') + (k.altKey ? 'Alt+' : '') + k.key);
        });
        const send = (init: KeyboardEventInit): void => { input.dispatchEvent(new fx.Window.KeyboardEvent('keydown', { bubbles: true, ...init })); };
        send({ key: 's', ctrlKey: true });
        send({ key: 'k', ctrlKey: true });
        send({ key: 'F5' });
        send({ key: 'x', altKey: true });
        send({ key: 'a', ctrlKey: true });
        send({ key: 'v', ctrlKey: true });
        send({ key: 'ArrowLeft', ctrlKey: true });
        send({ key: 'Backspace', ctrlKey: true });
        assert.deepEqual(reached, ['Ctrl+s', 'Ctrl+k', 'F5', 'Alt+x']);
    });

    test('nothing is forwarded during an IME composition (Enter commits the candidate)', () =>
    {
        const fx = new NativeFixture();
        const input = fx.Input(fx.Box());
        fx.Document.body.appendChild(input);
        let reached = 0;
        fx.Document.body.addEventListener('keydown', () => { reached++; });
        input.dispatchEvent(new fx.Window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
        input.dispatchEvent(new fx.Window.KeyboardEvent('keydown', { key: 'Process', keyCode: 229, bubbles: true }));
        assert.equal(reached, 0);
    });

    test('verbatim purposes switch off mobile auto-capitalisation and autocorrect', () =>
    {
        const fx = new NativeFixture();
        const user = fx.Box();
        user.InputPurpose = InputPurpose.Username;
        const input = fx.Input(user);
        assert.equal(input.getAttribute('autocapitalize'), 'none');
        assert.equal(input.getAttribute('autocorrect'), 'off');
        const plain = fx.Input(fx.Box());
        assert.equal(plain.hasAttribute('autocapitalize'), false);
    });

    test('pointer presses stay in the input (mural takes no capture or caret)', () =>
    {
        const fx = new NativeFixture();
        const input = fx.Input(fx.Box());
        fx.Document.body.appendChild(input);
        let reached = 0;
        fx.Document.body.addEventListener('pointerdown', () => { reached++; });
        fx.Document.body.addEventListener('mousedown', () => { reached++; });
        input.dispatchEvent(new fx.Window.Event('pointerdown', { bubbles: true }));
        input.dispatchEvent(new fx.Window.MouseEvent('mousedown', { bubbles: true }));
        assert.equal(reached, 0);
    });

    test('native focus moves mural keyboard focus to the TextBox, once', () =>
    {
        // Keyboard.Focus(v) delegates to v.Focus(), which needs a mounted host;
        // the spy records the hand-off instead (as FocusOnVisibleBehavior's tests do).
        const fx = new NativeFixture();
        const tb = new FocusSpyTextBox();
        tb.OwnerDocument = fx.Document;
        tb.UsesNativeInput = true;
        const input = fx.Input(tb);
        fx.Document.body.appendChild(input);
        input.dispatchEvent(new fx.Window.FocusEvent('focus'));
        assert.equal(tb.FocusCount, 1);
    });

    test('rendering hosts the input in a foreignObject and paints no text of its own', () =>
    {
        const fx = new NativeFixture();
        const renderer = new SvgRenderer(fx.Surface, { document: fx.Document });
        const tb = fx.Box();
        tb.Text = 'secret-ish';
        tb.Measure(new Size(240, 40));
        tb.Arrange(new Rect(0, 0, 240, 40));
        renderer.Render(tb, undefined, null, null);
        const fo = fx.Surface.querySelector('foreignObject');
        assert.ok(fo !== null, 'a <foreignObject> hosts the input');
        assert.equal(fo.firstChild, tb.NativeInputElement);
        const painted = [...fx.Surface.querySelectorAll('text')].map(t => t.textContent ?? '').join('');
        assert.equal(painted.includes('secret-ish'), false, 'the editor paints no glyphs while native');
    });

    test('turning UsesNativeInput off hides the input and the editor paints again', () =>
    {
        const fx = new NativeFixture();
        const tb = fx.Box();
        const input = fx.Input(tb);
        tb.UsesNativeInput = false;
        assert.equal(tb.IsNativeInputActive, false);
        assert.equal(input.style.display, 'none');
        tb.UsesNativeInput = true;
        assert.equal(input.style.display, 'block');
    });
});
