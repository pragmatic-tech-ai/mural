import { ModifierKeys, toModifierKeys } from '../../runtime/index.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from './test-app.js';

import { Application, Key, NoModifiers, Panel, Point, Size, PointerButton, Visual, VerticalAlignment, ThemeManager, Density, type FocusEventArgs, type KeyEventArgs, type KeyEventInit, type ModifierKeys, type PointerEventInit, type DrawingContext } from '../../runtime/index.js';
import { resolveKey } from '../../runtime/model-internals.js';
import { InputManager, ComboBox } from '../../framework/index.js';;
import { HeadlessTarget, SolidColorBrush, type Brush } from '../../visual-engine/index.js';
import { TextBox, TextBoxVariant, type ClipboardSink } from '../text-box.js';

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

class Root extends Panel { }

// In-memory clipboard so Ctrl+C / Ctrl+V can be exercised without a
// platform clipboard. Installed in the suite that exercises clipboard
// behaviour; restored after.
function makeClipboardStub(): ClipboardSink & { Buffer: string }
{
    return {
        Buffer: '',
        async Read(): Promise<string>        { return this.Buffer; },
        async Write(text: string): Promise<void> { this.Buffer = text; },
    };
}

// Helper: stand up a TextBox inside a HeadlessTarget so pointer +
// keyboard + measure all work end-to-end. Mounts the TextBox as the
// target's Content directly — wrapping it in a plain Panel would NOT
// work because Panel's default MeasureOverride returns Size.Zero and
// never measures its children, leaving the editor's line layout
// uninitialised. Tree-view / list-box tests mount the same way for
// the same reason.
function fixture(initialText: string = ''): {
    tb: TextBox; im: InputManager; target: HeadlessTarget;
}
{
    const tb = new TextBox();
    tb.Text = initialText;

    const target = new HeadlessTarget(300, 400);
    target.Content = tb;
    target.Flush();

    // Use the target's own InputManager so SetFocus and the key inject
    // methods share state. Visual.Focus() routes through this same
    // InputManager via PresentationTarget.SetFocus.
    const im = target.InputManager;
    return { tb, im, target };
}

describe('Focus model — runtime plumbing', () => {
    beforeEach(() => { initTestApp(); });

    test('default Focusable is false; Focus() on a non-focusable Visual is a no-op', () => {
        const tb     = new TextBox();
        const filler = new Root();         // Focusable=false by default
        const target = new HeadlessTarget(100, 100);
        target.Content = filler;

        // Filler isn't focusable — Focus() should silently do nothing.
        filler.Focus();
        assert.equal(target.InputManager.GetFocusedVisual(), undefined);
        assert.equal(filler.IsFocused, false);

        // TextBox flipped Focusable on in its constructor.
        assert.equal(tb.Focusable, true);
    });

    test('SetFocus mirrors IsFocused on old + new visuals AND fires LostFocus / GotFocus', () => {
        const tb1 = new TextBox();
        const tb2 = new TextBox();
        const root = new Root();
        root.AddChild(tb1);
        root.AddChild(tb2);
        const target = new HeadlessTarget(200, 100);
        target.Content = root;

        let gotFocusCount  = 0;
        let lostFocusCount = 0;
        let lastGot: Visual | undefined;
        let lastLost: Visual | undefined;
        // Subclass-side virtuals — we override by patching the
        // protected methods on the instances.
        (tb1 as unknown as { OnGotFocus: (a: FocusEventArgs) => void })
            .OnGotFocus  = (a) => { gotFocusCount++;  lastGot  = a.Source; };
        (tb1 as unknown as { OnLostFocus: (a: FocusEventArgs) => void })
            .OnLostFocus = (a) => { lostFocusCount++; lastLost = a.Source; };
        (tb2 as unknown as { OnGotFocus: (a: FocusEventArgs) => void })
            .OnGotFocus  = (a) => { gotFocusCount++;  lastGot  = a.Source; };
        (tb2 as unknown as { OnLostFocus: (a: FocusEventArgs) => void })
            .OnLostFocus = (a) => { lostFocusCount++; lastLost = a.Source; };

        target.InputManager.SetFocus(tb1);
        assert.equal(tb1.IsFocused, true);
        assert.equal(target.InputManager.GetFocusedVisual(), tb1);
        assert.equal(gotFocusCount,  1);
        assert.equal(lastGot,        tb1);
        assert.equal(lostFocusCount, 0);

        target.InputManager.SetFocus(tb2);
        assert.equal(tb1.IsFocused, false);
        assert.equal(tb2.IsFocused, true);
        assert.equal(gotFocusCount,  2);
        assert.equal(lostFocusCount, 1);
        assert.equal(lastLost,       tb1);
        assert.equal(lastGot,        tb2);

        target.InputManager.SetFocus(undefined);
        assert.equal(tb2.IsFocused, false);
        assert.equal(target.InputManager.GetFocusedVisual(), undefined);
        assert.equal(lostFocusCount, 2);
    });

    test('InjectKeyDown with no focused visual is a no-op', () => {
        const im = new InputManager();
        const ok = im.InjectKeyDown(key(Key.A));
        assert.equal(ok, false);
    });

    test('Visual.Blur() clears focus only when the Visual was the focused one', () => {
        const { tb, im } = fixture();
        const other = new TextBox();
        im.SetFocus(tb);
        assert.equal(tb.IsFocused, true);

        // Blurring a non-focused TextBox does nothing.
        other.Blur();
        assert.equal(tb.IsFocused, true);
        assert.equal(im.GetFocusedVisual(), tb);

        // Blurring the focused TextBox clears it.
        tb.Blur();
        assert.equal(tb.IsFocused, false);
        assert.equal(im.GetFocusedVisual(), undefined);
    });
});

describe('TextBox — text input', () => {
    beforeEach(() => { initTestApp(); });

    test('OnTextInput inserts a printable character at the caret', () => {
        const { tb, im } = fixture('hello');
        tb.Select(5, 0);                   // caret at end
        im.SetFocus(tb);
        im.InjectTextInput({ Text: '!' });
        assert.equal(tb.Text, 'hello!');
        assert.equal(tb.CaretIndex, 6);
    });

    test('OnTextInput replaces the current selection', () => {
        const { tb, im } = fixture('hello');
        tb.Select(1, 3);                   // 'ell'
        im.SetFocus(tb);
        im.InjectTextInput({ Text: 'i' });
        assert.equal(tb.Text, 'hio');
        assert.equal(tb.CaretIndex, 2);
        assert.equal(tb.SelectionLength, 0);
    });

    test('IsReadOnly blocks insertion via TextInput', () => {
        const { tb, im } = fixture('hi');
        tb.IsReadOnly = true;
        tb.Select(2, 0);
        im.SetFocus(tb);
        im.InjectTextInput({ Text: '?' });
        assert.equal(tb.Text, 'hi');
    });

    test('Enter inserts a newline only when AcceptsReturn is true', () => {
        const { tb, im } = fixture('abc');
        tb.Select(2, 0);
        im.SetFocus(tb);

        // Default: Enter is not absorbed, no newline inserted.
        const beforeHandled = im.InjectKeyDown(key(Key.Return));
        assert.equal(beforeHandled, false);
        assert.equal(tb.Text, 'abc');

        tb.AcceptsReturn = true;
        const afterHandled = im.InjectKeyDown(key(Key.Return));
        assert.equal(afterHandled, true);
        assert.equal(tb.Text, 'ab\nc');
        assert.equal(tb.CaretIndex, 3);
    });
});

describe('TextBox — SubmitsOnEnter', () => {
    beforeEach(() => { initTestApp(); });

    test('plain Return is left unhandled and inserts no newline when SubmitsOnEnter', () => {
        const { tb, im } = fixture('hi');
        tb.AcceptsReturn   = true;
        tb.SubmitsOnEnter  = true;
        tb.Select(2, 0);
        im.SetFocus(tb);

        // Return bubbles (unhandled) so an ancestor KeyDown trigger can submit;
        // no newline is inserted.
        const handled = im.InjectKeyDown(key(Key.Return));
        assert.equal(handled, false);
        assert.equal(tb.Text, 'hi');
    });

    test('Shift+Return still inserts a newline when SubmitsOnEnter', () => {
        const { tb, im } = fixture('hi');
        tb.AcceptsReturn   = true;
        tb.SubmitsOnEnter  = true;
        tb.Select(2, 0);
        im.SetFocus(tb);

        const handled = im.InjectKeyDown(key(Key.Return, { Shift: true }));
        assert.equal(handled, true);
        assert.equal(tb.Text, 'hi\n');
        assert.equal(tb.CaretIndex, 3);
    });

    test('default (SubmitsOnEnter unset) inserts a newline and handles Return', () => {
        const { tb, im } = fixture('hi');
        tb.AcceptsReturn = true;
        tb.Select(2, 0);
        im.SetFocus(tb);

        const handled = im.InjectKeyDown(key(Key.Return));
        assert.equal(handled, true);
        assert.equal(tb.Text, 'hi\n');
        assert.equal(tb.CaretIndex, 3);
    });
});

// Records every DrawText the render pass emits, so a test can assert whether the
// placeholder string was painted (and with which brush). All other DrawingContext
// ops are no-ops — the TextBox tree also paints its Border/caret, which we ignore.
class DrawCapture implements DrawingContext
{
    public texts: Array<{ text: string; brush: Brush | undefined }> = [];
    DrawRectangle():        void {}
    DrawRoundedRectangle(): void {}
    DrawGeometry():         void {}
    DrawImage():            void {}
    DrawText(t: { Text: string; Foreground: Brush | undefined }): void { this.texts.push({ text: t.Text, brush: t.Foreground }); }
    PushTransform():        void {}
    PushClip():             void {}
    Pop():                  void {}
}

describe('TextBox — Placeholder', () => {
    beforeEach(() => { initTestApp(); });

    function renderTexts(tb: TextBox): Array<{ text: string; brush: Brush | undefined }>
    {
        const target = new HeadlessTarget(300, 400);
        target.Content = tb;
        target.Flush();
        const dc = new DrawCapture();
        target.Render(dc);
        return dc.texts;
    }

    test('draws the placeholder with PlaceholderBrush when the text is empty', () => {
        const tb = new TextBox();
        tb.AcceptsReturn    = true;
        const brush         = new SolidColorBrush();
        tb.Placeholder      = 'Ask anything…';
        tb.PlaceholderBrush = brush;

        const drawn = renderTexts(tb).find((t) => t.text === 'Ask anything…');
        assert.ok(drawn, 'placeholder text is drawn when the box is empty');
        assert.equal(drawn!.brush, brush);
    });

    test('does not draw the placeholder once the text is non-empty', () => {
        const tb = new TextBox();
        tb.AcceptsReturn = true;
        tb.Placeholder   = 'Ask anything…';
        tb.Text          = 'hello';

        const texts = renderTexts(tb);
        assert.equal(texts.find((t) => t.text === 'Ask anything…'), undefined);
        assert.ok(texts.find((t) => t.text === 'hello'), 'the actual text is drawn instead');
    });

    test('placeholder never affects DesiredSize (render-only)', () => {
        const withPh = new TextBox();
        withPh.AcceptsReturn = true;
        withPh.Placeholder   = 'A very long placeholder string that is quite wide';
        withPh.Measure(new Size(300, 400));

        const without = new TextBox();
        without.AcceptsReturn = true;
        without.Measure(new Size(300, 400));

        assert.equal(withPh.DesiredSize.Width,  without.DesiredSize.Width);
        assert.equal(withPh.DesiredSize.Height, without.DesiredSize.Height);
    });
});

describe('TextBox — editing keys', () => {
    beforeEach(() => { initTestApp(); });

    test('Backspace removes the char before the caret', () => {
        const { tb, im } = fixture('hello');
        tb.Select(3, 0);                   // caret between 'l' and 'l'
        im.SetFocus(tb);
        im.InjectKeyDown(key(Key.Back));
        assert.equal(tb.Text, 'helo');
        assert.equal(tb.CaretIndex, 2);
    });

    test('Backspace deletes the selection when one is non-empty', () => {
        const { tb, im } = fixture('hello world');
        tb.Select(5, 6);                   // ' world'
        im.SetFocus(tb);
        im.InjectKeyDown(key(Key.Back));
        assert.equal(tb.Text, 'hello');
        assert.equal(tb.CaretIndex, 5);
    });

    test('Delete removes the char after the caret', () => {
        const { tb, im } = fixture('hello');
        tb.Select(0, 0);
        im.SetFocus(tb);
        im.InjectKeyDown(key(Key.Delete));
        assert.equal(tb.Text, 'ello');
        assert.equal(tb.CaretIndex, 0);
    });

    test('Backspace at index 0 is a no-op', () => {
        const { tb, im } = fixture('abc');
        tb.Select(0, 0);
        im.SetFocus(tb);
        im.InjectKeyDown(key(Key.Back));
        assert.equal(tb.Text, 'abc');
    });
});

describe('TextBox — navigation', () => {
    beforeEach(() => { initTestApp(); });

    test('ArrowLeft / ArrowRight move the caret by 1', () => {
        const { tb, im } = fixture('abc');
        tb.Select(2, 0);
        im.SetFocus(tb);

        im.InjectKeyDown(key(Key.Left));
        assert.equal(tb.CaretIndex, 1);

        im.InjectKeyDown(key(Key.Right));
        assert.equal(tb.CaretIndex, 2);
    });

    test('Shift+ArrowRight extends the selection by 1 to the right', () => {
        const { tb, im } = fixture('abcd');
        tb.Select(1, 0);
        im.SetFocus(tb);

        im.InjectKeyDown(key(Key.Right, { Shift: true }));
        assert.equal(tb.SelectionStart,  1);
        assert.equal(tb.SelectionLength, 1);
        assert.equal(tb.CaretIndex,      2);

        im.InjectKeyDown(key(Key.Right, { Shift: true }));
        assert.equal(tb.SelectionLength, 2);
        assert.equal(tb.CaretIndex,      3);
    });

    test('ArrowDown moves to the next line preserving column', () => {
        const { tb, im, target } = fixture('first\nsecond\nthird');
        tb.Select(3, 0);                   // line 0, col 3
        im.SetFocus(tb);
        target.Flush();                    // ensure editor lines are measured

        im.InjectKeyDown(key(Key.Down));
        // Expected: line 1 col 3 → index 5 + 1 + 3 = 9 ('s', 'e', 'c', |, 'o', ...)
        const { line, col } = lineColOf(tb, tb.CaretIndex);
        assert.equal(line, 1);
        assert.equal(col,  3);
    });

    test('Ctrl+ArrowRight jumps to the next word boundary', () => {
        const { tb, im } = fixture('hello world here');
        tb.Select(0, 0);
        im.SetFocus(tb);

        im.InjectKeyDown(key(Key.Right, { Control: true }));
        assert.equal(tb.CaretIndex, 5);     // after 'hello'

        im.InjectKeyDown(key(Key.Right, { Control: true }));
        assert.equal(tb.CaretIndex, 11);    // after 'world'
    });

    test('Home / End move to the line edges', () => {
        const { tb, im, target } = fixture('alpha\nbravo');
        tb.Select(8, 0);                   // somewhere in 'bravo'
        im.SetFocus(tb);
        target.Flush();

        im.InjectKeyDown(key(Key.Home));
        // line 1, col 0 = index 6
        assert.equal(tb.CaretIndex, 6);

        im.InjectKeyDown(key(Key.End));
        // line 1, col 5 = index 11
        assert.equal(tb.CaretIndex, 11);
    });

    test('Ctrl+End jumps to the end of the entire text', () => {
        const { tb, im } = fixture('abc\ndef\nghi');
        tb.Select(0, 0);
        im.SetFocus(tb);
        im.InjectKeyDown(key(Key.End, { Control: true }));
        assert.equal(tb.CaretIndex, 11);
    });

    test('Ctrl+A selects everything', () => {
        const { tb, im } = fixture('hello world');
        im.SetFocus(tb);
        im.InjectKeyDown(key(Key.A, { Control: true }));
        assert.equal(tb.SelectionStart,  0);
        assert.equal(tb.SelectionLength, 11);
    });
});

describe('TextBox — mouse positioning', () => {
    beforeEach(() => { initTestApp(); });

    test('PointerDown takes focus and positions the caret at the click', () => {
        const { tb, im, target } = fixture('hello');
        // Click at the right side of the text — should put the caret
        // near (or at) the end of the line.
        const initRight: PointerEventInit = pointer({ HostX: 200, HostY: 12 });
        im.InjectPointerDown(tb, initRight);
        assert.equal(tb.IsFocused, true);
        assert.equal(tb.CaretIndex, 5);     // approximate measurer puts every char ~ 6×fontSize wide

        // Click further left — caret moves accordingly. Position is
        // measure-dependent; assert that the click reduced the caret.
        const initLeft: PointerEventInit = pointer({ HostX: 12, HostY: 12 });
        im.InjectPointerDown(tb, initLeft);
        target.Flush();
        assert.ok(tb.CaretIndex < 5, `expected caret < 5, got ${tb.CaretIndex}`);
    });

    test('Shift+click extends selection from the existing anchor', () => {
        const { tb, im } = fixture('hello');
        // First click — sets anchor at index 5 (right edge).
        im.InjectPointerDown(tb, pointer({ HostX: 200, HostY: 12 }));
        assert.equal(tb.CaretIndex, 5);
        assert.equal(tb.SelectionLength, 0);

        // Shift+click left — keeps anchor at 5, moves caret left,
        // produces non-empty selection.
        im.InjectPointerDown(tb, pointer({ HostX: 12, HostY: 12, Modifiers: ModifierKeys.Shift }));
        assert.ok(tb.SelectionLength > 0, `expected non-empty selection after shift-click, got ${tb.SelectionLength}`);
        assert.equal(tb.SelectionStart + tb.SelectionLength, 5);
    });
});

describe('TextBox — clipboard', () => {
    beforeEach(() => { initTestApp(); });

    test('Ctrl+C copies the current selection to the clipboard', async () => {
        const cb = makeClipboardStub();
        TextBox.Clipboard = cb;
        try
        {
            const { tb, im } = fixture('hello world');
            tb.Select(6, 5);                // 'world'
            im.SetFocus(tb);
            im.InjectKeyDown(key(Key.C, { Control: true }));
            // Promise resolves on the microtask — flush and re-check.
            await Promise.resolve();
            assert.equal(cb.Buffer, 'world');
            // Text is unchanged.
            assert.equal(tb.Text, 'hello world');
        }
        finally { TextBox.Clipboard = makeClipboardStub(); }
    });

    test('Ctrl+X cuts the selection (clipboard write AND model delete)', async () => {
        const cb = makeClipboardStub();
        TextBox.Clipboard = cb;
        try
        {
            const { tb, im } = fixture('alpha beta gamma');
            tb.Select(6, 4);                // 'beta'
            im.SetFocus(tb);
            im.InjectKeyDown(key(Key.X, { Control: true }));
            // The clipboard write is async; the model mutation is sync.
            assert.equal(tb.Text, 'alpha  gamma');
            await Promise.resolve();
            assert.equal(cb.Buffer, 'beta');
        }
        finally { TextBox.Clipboard = makeClipboardStub(); }
    });

    test('Ctrl+V pastes the clipboard contents at the caret', async () => {
        const cb = makeClipboardStub();
        cb.Buffer = 'INSERT';
        TextBox.Clipboard = cb;
        try
        {
            const { tb, im } = fixture('ab');
            tb.Select(1, 0);                // caret between 'a' and 'b'
            im.SetFocus(tb);
            im.InjectKeyDown(key(Key.V, { Control: true }));
            // Read completes on the microtask; wait for paste to settle.
            await Promise.resolve();
            await Promise.resolve();
            assert.equal(tb.Text, 'aINSERTb');
            assert.equal(tb.CaretIndex, 7);
        }
        finally { TextBox.Clipboard = makeClipboardStub(); }
    });
});

// Re-derive (line, col) for a caret index from the editor's measured
// lines — used by the ArrowDown test to assert positional preservation
// without baking the index arithmetic into the test.
function lineColOf(tb: TextBox, idx: number): { line: number; col: number }
{
    const text = tb.Text;
    let line = 0, col = 0;
    for (let i = 0; i < idx && i < text.length; i++)
    {
        if (text[i] === '\n') { line++; col = 0; } else col++;
    }
    return { line, col };
}

describe('TextBox — caret + selection re-render plumbing', () => {
    beforeEach(() => { initTestApp(); });

    // Regression: a previous version invalidated `TextBox` itself when
    // the caret moved / focus changed, but TextBox's RenderOverride is
    // a no-op — the caret is actually painted by the TextEditorSurface
    // child. The bug surfaced in the browser as a totally invisible
    // caret. This test pins the invalidation target so the caret can
    // never silently stop re-rendering again.
    test('focus toggle invalidates the editor surface, not the TextBox itself', () => {
        const { tb, im, target } = fixture('hello');
        // Use FindName so the test survives template restructuring
        // (e.g. wrapping the editor in a ScrollViewer for overflow
        // handling). Walking `visualChildren[0].child` would have to
        // change every time the template tree gains a level.
        const editor = (tb.visualChildren[0] as Visual).FindName('PART_Editor')!;
        const renderDirty = (target as unknown as { renderDirty: Set<Visual> }).renderDirty;
        // HeadlessTarget's renderDirty drains on Render(), not Flush();
        // any earlier invalidations from fixture setup are noise for
        // this test. Reset it explicitly so the SetFocus call is the
        // only signal under measurement.
        renderDirty.clear();

        im.SetFocus(tb);
        assert.ok(renderDirty.has(editor),
            'expected the editor surface to be marked render-dirty after focus');
        assert.ok(!renderDirty.has(tb),
            'TextBox itself paints nothing — should not be flagged for re-render on focus');
    });

    test('caret movement (ArrowRight) invalidates the editor surface', () => {
        const { tb, im, target } = fixture('hello');
        tb.Select(0, 0);
        im.SetFocus(tb);
        const editor = (tb.visualChildren[0] as Visual).FindName('PART_Editor')!;
        const renderDirty = (target as unknown as { renderDirty: Set<Visual> }).renderDirty;
        renderDirty.clear();

        im.InjectKeyDown(key(Key.Right));
        assert.ok(renderDirty.has(editor),
            'expected the editor to be marked render-dirty after caret movement');
    });
});

describe('TextBox — single-line content is vertically centered', () => {
    beforeEach(() => { initTestApp(); });

    function scrollOf(tb: TextBox): Visual {
        return (tb.visualChildren[0] as Visual).FindName('PART_Scroll')! as Visual;
    }

    function mount(tb: TextBox): void {
        const target = new HeadlessTarget(300, 400);
        target.Content = tb;
        target.Flush();
    }

    // A single-line field stretched taller than one line (the canonical case:
    // sharing a row with a taller ComboBox) must center its editor, not top-align
    // it — otherwise the surplus height falls as blank space below the text.
    test('single-line (default) centers the scroll surface', () => {
        const tb = new TextBox();
        tb.Text = 'hi';
        mount(tb);
        assert.equal(scrollOf(tb).VerticalAlignment, VerticalAlignment.Center);
    });

    // Multi-line must keep the scroll surface stretched so it fills the box and
    // scrolls; centering it would break vertical overflow.
    test('multi-line keeps the scroll surface stretched', () => {
        const tb = new TextBox();
        tb.AcceptsReturn = true;
        tb.Text = 'a\nb';
        mount(tb);
        assert.equal(scrollOf(tb).VerticalAlignment, VerticalAlignment.Stretch);
    });

    // The Filled variant swaps to a different template with its own PART_Scroll —
    // it must center single-line content too.
    test('filled single-line variant centers the scroll surface', () => {
        const tb = new TextBox();
        tb.Variant = TextBoxVariant.Filled;
        tb.Text = 'hi';
        mount(tb);
        assert.equal(scrollOf(tb).VerticalAlignment, VerticalAlignment.Center);
    });
});

describe('TextBox — single-line field is a compact row by default', () => {
    beforeEach(() => { initTestApp(); });

    function desiredH(v: Visual, density?: Density): number {
        if (density !== undefined) ThemeManager.SetDensity(v, density);
        const target = new HeadlessTarget(300, 400);
        target.Content = v;
        target.Flush();
        return v.DesiredSize.Height;
    }

    // Text fields default to the COMPACT row height (28) app-wide, regardless of
    // the ambient density — a dense, standard-row baseline.
    test('single-line field defaults to the compact row height (28)', () => {
        const tb = new TextBox(); tb.Text = 'hi';
        assert.equal(desiredH(tb), 28);
    });

    // Where the ambient density explicitly raises the row height, the field still
    // tracks the ComboBox (both respond to Compact / Comfortable) so a field and a
    // dropdown in the same density-scoped row stay the same height.
    for (const d of [Density.Compact, Density.Comfortable]) {
        test(`single-line field matches ComboBox height at ${d} density`, () => {
            const tb = new TextBox(); tb.Text = 'hi';
            const cb = new ComboBox();
            assert.equal(desiredH(tb, d), desiredH(cb, d), `height mismatch at ${d}`);
        });
    }

    // Multi-line must NOT be pinned to the row height — it grows with content
    // (the floor is a MinHeight, not a fixed Height).
    test('multi-line field grows with content, not pinned to the row height', () => {
        const one  = new TextBox(); one.AcceptsReturn  = true; one.Text  = 'a';
        const many = new TextBox(); many.AcceptsReturn = true; many.Text = 'a\nb\nc\nd\ne\nf';
        assert.ok(desiredH(many) > desiredH(one),
            'multi-line desired height should grow with line count');
    });
});

describe('TextBox — soft-wrap overflow handling', () => {
    beforeEach(() => { initTestApp(); });

    // Helper: lay out a TextBox with a fixed (small) Width so wrap
    // actually has a budget to break against. ApproximateTextMeasurer
    // gives every char `fontSize × 0.6` width — at fontSize 14 that's
    // 8.4 DIPs per char, so an explicit Width of ~80 fits roughly 10
    // characters per visual line including some Border padding overhead.
    function multiLineFixture(text: string, width: number = 80): {
        tb: TextBox; target: HeadlessTarget;
    }
    {
        const tb = new TextBox();
        tb.AcceptsReturn = true;
        tb.Width  = width;
        tb.Height = 200;
        tb.Text   = text;
        const target = new HeadlessTarget(width + 40, 200);
        target.Content = tb;
        target.Flush();
        return { tb, target };
    }

    // Reach the editor surface through the template so the assertions
    // don't have to know about the Border > ScrollViewer chain above it.
    function editorOf(tb: TextBox): { Lines: readonly { Text: string; GlobalStart: number }[] }
    {
        const found = (tb.visualChildren[0] as Visual).FindName('PART_Editor')!;
        return found as unknown as { Lines: readonly { Text: string; GlobalStart: number }[] };
    }

    test('default TextWrapping is Wrap on multi-line; long line breaks into multiple visual lines', () => {
        // Width 200 with 8.4 DIPs/char (approx measurer) gives ~22
        // chars per line, comfortably wider than every word here so
        // wrapping happens at word boundaries instead of mid-word.
        const { tb } = multiLineFixture(
            'lorem ipsum dolor sit amet consectetur adipiscing',
            200);
        assert.ok(tb.AcceptsReturn);
        const lines = editorOf(tb).Lines;
        assert.ok(lines.length >= 2,
            `expected ≥2 visual lines for a wrapped long line, got ${lines.length}`);
        // Every word should survive intact since the budget exceeds the
        // longest word.
        const reassembled = lines.map(l => l.Text).join(' ');
        for (const word of ['lorem', 'ipsum', 'dolor', 'consectetur', 'adipiscing'])
        {
            assert.ok(reassembled.includes(word),
                `expected wrap output to include "${word}", got "${reassembled}"`);
        }
    });

    test('char-wrap fallback breaks a single word wider than the budget', () => {
        // A 22-char single word in a budget that fits maybe 7 chars
        // means word-wrap can't find a break — char-wrap fallback
        // should kick in and emit multiple shorter visual lines.
        const { tb } = multiLineFixture('aaaaaaaaaaaaaaaaaaaaaa', 80);
        const lines = editorOf(tb).Lines;
        assert.ok(lines.length >= 2,
            `expected char-wrap to split the long word into ≥2 lines, got ${lines.length}`);
        // Sum of visual-line text lengths should equal the original
        // (no characters lost), since there's no whitespace to consume.
        const total = lines.reduce((n, l) => n + l.Text.length, 0);
        assert.equal(total, 22,
            `expected total char count to be preserved through char-wrap, got ${total}`);
    });

    test('TextWrapping = NoWrap keeps the long line as a single visual line', () => {
        const { tb } = multiLineFixture('aaaaaaaaaa bbbbbbbbbb cccccccccc dddddddddd', 80);
        const wrappedCount = editorOf(tb).Lines.length;

        const TextWrappingNoWrap = (TextBox.prototype as unknown as {
            get TextWrapping(): unknown;
        });
        void TextWrappingNoWrap;

        // Flip to NoWrap — same content shouldn't break visually.
        // Import value via a separate top-level import would be cleaner;
        // use a direct DP write to avoid the import dance in the test.
        tb.set_property_value(resolveKey(tb, undefined, 'TextWrapping'), 'NoWrap');
        (tb as unknown as { target: { Flush: () => void } }).target.Flush();

        const flatCount = editorOf(tb).Lines.length;
        assert.equal(flatCount, 1,
            `NoWrap should keep the line whole, got ${flatCount} visual lines`);
        assert.ok(wrappedCount > flatCount,
            'Wrap should have produced more visual lines than NoWrap for the same content');
    });

    test('AcceptsReturn = false (single-line) ignores TextWrapping and stays on one visual line', () => {
        const tb = new TextBox();
        tb.Width  = 80;
        tb.Text   = 'a much longer text than the field is wide';
        // TextWrapping defaults to Wrap, but single-line should ignore it.
        const target = new HeadlessTarget(120, 60);
        target.Content = tb;
        target.Flush();

        const lines = editorOf(tb).Lines;
        assert.equal(lines.length, 1,
            `single-line TextBox should never wrap, got ${lines.length} visual lines`);
    });

    test('wrapped visual lines carry GlobalStart so caret math maps back to original text', () => {
        const { tb } = multiLineFixture('hello world goodbye world', 80);
        const lines = editorOf(tb).Lines;
        // Each visual line's GlobalStart should monotonically increase
        // and never exceed the original text length.
        let prev = -1;
        for (const line of lines)
        {
            assert.ok(line.GlobalStart > prev,
                `expected monotonically increasing GlobalStart, got ${line.GlobalStart} after ${prev}`);
            assert.ok(line.GlobalStart + line.Text.length <= tb.Text.length,
                `line range [${line.GlobalStart},${line.GlobalStart + line.Text.length}] exceeds text length ${tb.Text.length}`);
            prev = line.GlobalStart;
        }
    });

    test('ScrollViewer per-axis enable: Wrap mode disables horizontal scroll', () => {
        const { tb } = multiLineFixture('any wrapped content here at all', 80);
        const scrollVisual = (tb.visualChildren[0] as Visual).FindName('PART_Scroll')!;
        const scroll = scrollVisual as unknown as { HorizontalScrollEnabled: boolean; VerticalScrollEnabled: boolean };
        assert.equal(scroll.HorizontalScrollEnabled, false,
            'Wrap mode should disable horizontal scroll so the editor can wrap to width');
        assert.equal(scroll.VerticalScrollEnabled, true,
            'multi-line should keep vertical scroll enabled for content overflow');
    });

    test('Single-line TextBox disables both scroll axes — bar never shows', () => {
        const tb = new TextBox();
        tb.Width  = 80;
        tb.Text   = 'a much longer text than the field is wide';
        const target = new HeadlessTarget(120, 60);
        target.Content = tb;
        target.Flush();

        const scrollVisual = (tb.visualChildren[0] as Visual).FindName('PART_Scroll')!;
        const scroll = scrollVisual as unknown as { HorizontalScrollEnabled: boolean; VerticalScrollEnabled: boolean };
        // Both axes disabled — single-line should never show a scrollbar
        // (matches native <input>). HorizontalOffset is still writable
        // so caret-into-view scrolls the text invisibly as the user
        // types past the viewport edge.
        assert.equal(scroll.HorizontalScrollEnabled, false,
            'single-line should not show a horizontal scrollbar');
        assert.equal(scroll.VerticalScrollEnabled, false,
            'single-line should never need vertical scroll (fixed font height)');
    });

    // Regression: swapping Variant after construction re-fires the Style
    // trigger, which swaps the Template and rebuilds the visual tree with a
    // FRESH editor. If the TextBox doesn't re-adopt its parts on rebuild, the
    // new editor never gets its `textBox` back-reference and measures to zero —
    // a blank, zero-height, unclickable field (the editable-ComboBox bug).
    test('swapping Variant re-wires the editor so it still measures its text', () => {
        const tb = new TextBox();
        tb.Text = '12';
        const target = new HeadlessTarget(200, 100);
        target.Content = tb;
        target.Flush();

        // Plain drops the chrome; the measured size is the bare text, but it
        // MUST still be non-zero (the editor re-wired to the model).
        tb.Variant = TextBoxVariant.Plain;
        target.Flush();

        assert.ok(tb.DesiredSize.Height > 0,
            'Plain field measures a real line height after the variant swap');
        assert.ok(tb.DesiredSize.Width > 0,
            'Plain field measures its text width after the variant swap');
    });
});
