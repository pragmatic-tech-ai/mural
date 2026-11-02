// TextBox.UsesNativeInput focus and keyboard routing through a real HtmlTarget
// (InputManager, Keyboard, the renderer's foreignObject): DOM focus and mural
// focus stay in step, Tab moves between fields through mural, and the mural
// host keeps the keyboard when focus leaves an input.

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { Element, Keyboard, Size } from '../../runtime/index.js';
import { StackPanel, TextBox } from '../index.js';
import { HtmlTarget } from '../../visual-engine/index.js';
import { initTestApp } from './test-app.js';

// A plain focusable mural element with no template: a non-input focus target.
// (Focusing a templated Button in a JSDOM host runs away inside mural's focus
// visuals, unrelated to native inputs, so the test avoids it.)
class FocusTarget extends Element
{
    public constructor()
    {
        super();
        this.Focusable = true;
    }

    protected override MeasureOverride(_available: Size): Size
    {
        return new Size(40, 20);
    }
}

class FocusFixture
{
    public readonly Host: HTMLElement;
    public readonly Document: Document;
    public readonly Window: Window & typeof globalThis;
    public readonly Target: HtmlTarget;
    public readonly First = new TextBox();
    public readonly Second = new TextBox();
    public readonly Action = new FocusTarget();

    public constructor()
    {
        const dom = new JSDOM(
            '<!doctype html><html><head></head><body><div id="host" style="width:400px;height:300px"></div></body></html>',
            { pretendToBeVisual: true },
        );
        this.Window = dom.window as unknown as Window & typeof globalThis;
        this.Document = this.Window.document;
        (globalThis as unknown as { window: Window }).window = this.Window;
        (globalThis as unknown as { document: Document }).document = this.Document;
        (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class
        {
            observe(): void {}
            disconnect(): void {}
            unobserve(): void {}
        };
        this.Host = this.Document.getElementById('host') as HTMLElement;
        Object.defineProperty(this.Host, 'clientWidth', { value: 400, configurable: true });
        Object.defineProperty(this.Host, 'clientHeight', { value: 300, configurable: true });
        this.Target = new HtmlTarget(this.Host);
        const panel = new StackPanel();
        for (const box of [this.First, this.Second])
        {
            box.UsesNativeInput = true;
            panel.AddChild(box);
        }
        panel.AddChild(this.Action);
        this.Target.Content = panel;
        this.Target.Flush();
    }

    public Input(box: TextBox): HTMLInputElement
    {
        const input = box.NativeInputElement as HTMLInputElement | undefined;
        assert.ok(input !== undefined && input.isConnected, 'the input is rendered into the page');
        return input;
    }

    public Key(input: HTMLInputElement, init: KeyboardEventInit): KeyboardEvent
    {
        const e = new this.Window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
        input.dispatchEvent(e);
        return e;
    }
}

describe('TextBox.UsesNativeInput - focus through a real HtmlTarget', () =>
{
    beforeEach(() => { initTestApp(); });

    test('both inputs render inside the mural host', () =>
    {
        const fx = new FocusFixture();
        assert.ok(fx.Host.contains(fx.Input(fx.First)));
        assert.ok(fx.Host.contains(fx.Input(fx.Second)));
    });

    test('focusing an input (a click or tap) gives the TextBox mural focus', () =>
    {
        const fx = new FocusFixture();
        fx.Input(fx.First).focus();
        assert.equal(Keyboard.FocusedElement, fx.First);
        assert.equal(fx.Document.activeElement, fx.Input(fx.First));
    });

    test('Tab is handed to mural, which moves focus to the next field and its input', () =>
    {
        const fx = new FocusFixture();
        const first = fx.Input(fx.First);
        first.focus();
        fx.Key(first, { key: 'Tab', code: 'Tab' });
        assert.equal(Keyboard.FocusedElement, fx.Second);
        assert.equal(fx.Document.activeElement, fx.Input(fx.Second));
    });

    test('mural focus moving to a non-input control returns DOM focus to the host, not the body', () =>
    {
        const fx = new FocusFixture();
        fx.Input(fx.First).focus();
        Keyboard.Focus(fx.Action);
        assert.equal(Keyboard.FocusedElement, fx.Action);
        assert.equal(fx.Document.activeElement, fx.Host);
    });

    test('DOM focus leaving the input without mural (a click on blank space) releases mural focus', () =>
    {
        const fx = new FocusFixture();
        fx.Input(fx.First).focus();
        fx.Host.focus();
        assert.notEqual(Keyboard.FocusedElement, fx.First);
    });

    test('mural focus moved to a field from code focuses its input', () =>
    {
        const fx = new FocusFixture();
        Keyboard.Focus(fx.Second);
        assert.equal(fx.Document.activeElement, fx.Input(fx.Second));
    });

    test('Select / SelectAll from code select the text in the input', () =>
    {
        const fx = new FocusFixture();
        fx.First.Text = 'hello world';
        const input = fx.Input(fx.First);
        input.focus();
        fx.First.Select(6, 5);
        assert.deepEqual([input.selectionStart, input.selectionEnd], [6, 11]);
        fx.First.SelectAll();
        assert.deepEqual([input.selectionStart, input.selectionEnd], [0, 11]);
    });

    test('typing mid-text keeps the caret where the user is typing', () =>
    {
        const fx = new FocusFixture();
        const input = fx.Input(fx.First);
        input.focus();
        input.value = 'abef';
        input.dispatchEvent(new fx.Window.Event('input', { bubbles: true }));
        input.setSelectionRange(2, 2);
        input.dispatchEvent(new fx.Window.KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true }));
        input.value = 'abcef';
        input.setSelectionRange(3, 3);
        input.dispatchEvent(new fx.Window.Event('input', { bubbles: true }));
        assert.equal(fx.First.Text, 'abcef');
        assert.deepEqual([input.selectionStart, input.selectionEnd], [3, 3]);
        assert.equal(fx.First.CaretIndex, 3);
    });

    test('a binding rewriting Text while typing keeps the caret where it was', () =>
    {
        const fx = new FocusFixture();
        const input = fx.Input(fx.First);
        input.focus();
        input.value = 'abcdef';
        input.dispatchEvent(new fx.Window.Event('input', { bubbles: true }));
        // The user moves the caret (an arrow key), then a binding rewrites Text.
        input.setSelectionRange(2, 2);
        input.dispatchEvent(new fx.Window.KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true }));
        fx.First.Text = 'ABCDEF';
        assert.equal(input.value, 'ABCDEF');
        assert.deepEqual([input.selectionStart, input.selectionEnd], [2, 2]);
    });
});
