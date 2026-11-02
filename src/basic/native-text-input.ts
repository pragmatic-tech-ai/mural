import { Keyboard } from '../runtime/index.js';
import { SolidColorBrush, type Brush } from '../visual-engine/index.js';
import { InputPurpose } from './input-purpose.js';
import type { TextBox } from './text-box.js';

// What a TextBox's InputPurpose means to the browser: the autocomplete token
// password managers key on, the input type, the on-screen keyboard, and whether
// mobile auto-capitalisation / autocorrect must stay off (they corrupt emails,
// usernames, codes and passwords).
interface PurposeHints
{
    readonly Autocomplete: string | undefined;
    readonly Type: string;
    readonly InputMode: string | undefined;
    readonly Verbatim: boolean;
}

// The native <input> behind a TextBox with UsesNativeInput (single-line, in a
// browser). The TextBox's PART_Editor hosts it through the renderer's
// <foreignObject> path (the DomHost mechanism) and stops painting its own text,
// caret and selection; the browser does the editing, so IME, dead keys,
// autofill, password managers, mobile soft keyboards and assistive technology
// work as they do for any web form.
//
// Text and selection flow both ways: typing writes TextBox.Text (and so any
// TwoWay binding) and the TextBox selection; a Text or selection change from
// code or a binding is pushed into the input, keeping the caret and never
// touching the value mid-composition.
//
// Keys: the native editing set (typing, Backspace / Delete, arrows, Home / End
// and the clipboard / undo chords) stays in the input. Everything mural acts
// on continues to the host so the TextBox's routed KeyDown fires and bubbles:
// Enter / Escape (submit and dismiss triggers), Tab / Shift+Tab (mural focus
// navigation) and every other Ctrl / Cmd / Alt chord or F-key (app shortcuts).
// Nothing is forwarded while an IME composition is open. Pointer presses stay
// in the input.
//
// Focus is mirrored with mural's Keyboard focus both ways: DOM focus arriving
// moves mural focus to the TextBox; DOM focus leaving it (a click elsewhere,
// the browser's own Tab) releases mural focus; mural focus moving away hands
// DOM focus back to the mural host, so the rest of the surface still hears
// the keyboard. Focus requested before the input is attached is applied once
// it is.
export class NativeTextInput
{
    public static readonly DataAttribute = 'data-mural-native-input';
    private static readonly InputTag = 'input';
    private static readonly StyleTag = 'style';
    private static readonly StyleId = 'mural-native-input-style';
    private static readonly PlaceholderColorVariable = '--mural-native-placeholder';
    // ::placeholder cannot be styled inline: one shared rule per document.
    private static readonly StyleText = 'input[' + NativeTextInput.DataAttribute + ']::placeholder{color:var('
        + NativeTextInput.PlaceholderColorVariable + ');opacity:1}';
    private static readonly HostSelector = '[tabindex]';
    private static readonly InputEvent = 'input';
    private static readonly FocusEvent = 'focus';
    private static readonly BlurEvent = 'blur';
    private static readonly SelectEvent = 'select';
    private static readonly CompositionStartEvent = 'compositionstart';
    private static readonly CompositionEndEvent = 'compositionend';
    private static readonly KeyDownEvent = 'keydown';
    private static readonly KeyUpEvent = 'keyup';
    private static readonly KeyPressEvent = 'keypress';
    private static readonly PointerUpEvent = 'pointerup';
    private static readonly TextType = 'text';
    private static readonly PasswordType = 'password';
    private static readonly EmailType = 'email';
    private static readonly EmailMode = 'email';
    private static readonly NumericMode = 'numeric';
    private static readonly AutocompleteAttribute = 'autocomplete';
    private static readonly NameAttribute = 'name';
    private static readonly InputModeAttribute = 'inputmode';
    private static readonly AriaLabelAttribute = 'aria-label';
    private static readonly SpellcheckAttribute = 'spellcheck';
    private static readonly AutocapitalizeAttribute = 'autocapitalize';
    private static readonly AutocorrectAttribute = 'autocorrect';
    private static readonly EmptyText = '';
    private static readonly FalseText = 'false';
    private static readonly NoneText = 'none';
    private static readonly OffText = 'off';
    private static readonly PixelSuffix = 'px';
    private static readonly HiddenDisplay = 'none';
    private static readonly ShownDisplay = 'block';
    private static readonly InheritColor = 'inherit';
    private static readonly BorderBox = 'border-box';
    private static readonly Fill = '100%';
    private static readonly Zero = '0';
    private static readonly Transparent = 'transparent';
    private static readonly NormalLineHeight = 'normal';
    // An IME's "process" key code: a keydown that belongs to a composition.
    private static readonly ImeKeyCode = 229;
    // Frames to wait for a focus requested before the input is attached.
    private static readonly MaxFocusRetries = 10;
    // Keys always handed to mural (submit, dismiss, focus navigation).
    private static readonly ForwardedKeys: ReadonlySet<string> = new Set(['Enter', 'Escape', 'Tab']);
    // Keys the input edits with, even with a modifier (word jumps, word delete).
    private static readonly EditingKeys: ReadonlySet<string> = new Set([
        'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);
    // Ctrl / Cmd chords the input handles itself: select all, clipboard, undo / redo.
    private static readonly EditingChords: ReadonlySet<string> = new Set(['a', 'c', 'v', 'x', 'z', 'y']);
    private static readonly FunctionKey = /^F\d{1,2}$/;
    // Pointer presses stay native: mural must not take capture or place its own caret.
    private static readonly ContainedPointerEvents: readonly string[] = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick'];
    private static readonly Hints: ReadonlyMap<InputPurpose, PurposeHints> = new Map<InputPurpose, PurposeHints>([
        [InputPurpose.None,            { Autocomplete: undefined,          Type: NativeTextInput.TextType,  InputMode: undefined,                   Verbatim: false }],
        [InputPurpose.Email,           { Autocomplete: 'email',            Type: NativeTextInput.EmailType, InputMode: NativeTextInput.EmailMode,   Verbatim: true }],
        [InputPurpose.Username,        { Autocomplete: 'username',         Type: NativeTextInput.TextType,  InputMode: undefined,                   Verbatim: true }],
        [InputPurpose.CurrentPassword, { Autocomplete: 'current-password', Type: NativeTextInput.TextType,  InputMode: undefined,                   Verbatim: true }],
        [InputPurpose.NewPassword,     { Autocomplete: 'new-password',     Type: NativeTextInput.TextType,  InputMode: undefined,                   Verbatim: true }],
        [InputPurpose.OneTimeCode,     { Autocomplete: 'one-time-code',    Type: NativeTextInput.TextType,  InputMode: NativeTextInput.NumericMode, Verbatim: true }],
    ]);

    public readonly Element: HTMLInputElement;
    private syncing = false;
    private reportingSelection = false;
    private composing = false;
    private focusRetries = 0;
    // Set while focus is being handed between mural and the input, so each
    // side's focus handler does not hand it straight back (an endless loop).
    private transferring = false;

    public constructor(private readonly box: TextBox, doc: Document)
    {
        const C = NativeTextInput;
        const input = doc.createElement(C.InputTag);
        input.setAttribute(C.DataAttribute, C.EmptyText);
        input.setAttribute(C.SpellcheckAttribute, C.FalseText);
        const s = input.style;
        s.boxSizing = C.BorderBox;
        s.width = C.Fill;
        s.height = C.Fill;
        s.margin = C.Zero;
        s.padding = C.Zero;
        s.border = C.Zero;
        s.outline = C.NoneText;
        s.background = C.Transparent;
        s.lineHeight = C.NormalLineHeight;
        input.addEventListener(C.InputEvent, () => this.HandleInput());
        input.addEventListener(C.FocusEvent, () => this.HandleFocus());
        input.addEventListener(C.BlurEvent, () => this.HandleBlur());
        input.addEventListener(C.SelectEvent, () => this.ReportSelection());
        input.addEventListener(C.CompositionStartEvent, () => { this.composing = true; });
        input.addEventListener(C.CompositionEndEvent, () => { this.composing = false; });
        input.addEventListener(C.KeyDownEvent, (e) => this.HandleKey(e));
        input.addEventListener(C.KeyPressEvent, (e) => this.HandleKey(e));
        input.addEventListener(C.KeyUpEvent, (e) =>
        {
            this.HandleKey(e);
            this.ReportSelection();
        });
        for (const name of C.ContainedPointerEvents)
        {
            input.addEventListener(name, (e) => e.stopPropagation());
        }
        input.addEventListener(C.PointerUpEvent, () => this.ReportSelection());
        this.Element = input;
        this.Sync(true);
    }

    // Pushes the TextBox's state into the input. `active` false hides it (the
    // TextBox paints itself again). The value is written only when it differs,
    // never mid-composition, and keeps the caret where it was.
    public Sync(active: boolean): void
    {
        const C = NativeTextInput;
        const input = this.Element;
        const box = this.box;
        C.EnsureStyle(input.ownerDocument);
        input.style.display = active ? C.ShownDisplay : C.HiddenDisplay;
        if (input.value !== box.Text && !this.composing)
        {
            this.WriteValue(box.Text);
        }
        const hints = C.HintsFor(box.InputPurpose);
        input.type = box.IsPassword ? C.PasswordType : hints.Type;
        C.SetOptional(input, C.AutocompleteAttribute, hints.Autocomplete);
        C.SetOptional(input, C.NameAttribute, hints.Autocomplete);
        C.SetOptional(input, C.InputModeAttribute, hints.InputMode);
        C.SetOptional(input, C.AutocapitalizeAttribute, hints.Verbatim ? C.NoneText : undefined);
        C.SetOptional(input, C.AutocorrectAttribute, hints.Verbatim ? C.OffText : undefined);
        input.placeholder = box.Placeholder;
        C.SetOptional(input, C.AriaLabelAttribute, box.Placeholder.length > 0 ? box.Placeholder : undefined);
        input.readOnly = box.IsReadOnly;
        input.disabled = !box.IsEnabled;
        input.style.fontFamily = box.FontFamily.Source;
        input.style.fontSize = String(box.FontSize) + C.PixelSuffix;
        input.style.fontWeight = box.FontWeight;
        input.style.fontStyle = box.FontStyle;
        const foreground = C.CssColor(box.Foreground) ?? C.InheritColor;
        input.style.color = foreground;
        input.style.caretColor = C.CssColor(box.CaretBrush) ?? foreground;
        input.style.setProperty(C.PlaceholderColorVariable, C.CssColor(box.PlaceholderBrush) ?? foreground);
    }

    public get IsFocused(): boolean
    {
        return this.Element.ownerDocument.activeElement === this.Element;
    }

    // Moves DOM focus into the input (mural focus arrived some other way).
    // Before the input is attached (first paint pending) the focus is retried
    // on the next frames while mural focus is still on the TextBox.
    public Focus(): void
    {
        if (this.IsFocused || this.transferring)
        {
            return;
        }
        if (!this.Element.isConnected)
        {
            this.RetryFocus();
            return;
        }
        this.Transfer(() => this.Element.focus({ preventScroll: true }));
    }

    // Mural focus moved elsewhere: DOM focus goes back to the mural host (not
    // the page body), so the surface keeps receiving the keyboard.
    public Blur(): void
    {
        if (!this.IsFocused)
        {
            return;
        }
        const host = this.Element.parentElement?.closest(NativeTextInput.HostSelector) as HTMLElement | null | undefined;
        this.Transfer(() =>
        {
            if (host !== null && host !== undefined)
            {
                host.focus({ preventScroll: true });
            }
            else
            {
                this.Element.blur();
            }
        });
    }

    // Selects [start, end) in the input (a TextBox selection set from code).
    public SetSelection(start: number, end: number): void
    {
        const input = this.Element;
        if (this.reportingSelection || this.composing || input.selectionStart === null)
        {
            return;   // the input's own report echoing back, mid-composition, or no selection API (type=email)
        }
        if (input.selectionStart !== start || input.selectionEnd !== end)
        {
            input.setSelectionRange(start, end);
        }
    }

    private HandleInput(): void
    {
        if (this.syncing)
        {
            return;
        }
        // Writing Text clamps and re-mirrors the TextBox's (stale) selection;
        // hold that echo so the caret the user is typing at stays put, then
        // report the input's real selection.
        this.reportingSelection = true;
        try
        {
            this.box.Text = this.Element.value;
        }
        finally
        {
            this.reportingSelection = false;
        }
        this.ReportSelection();
    }

    // DOM focus arrived (a click, a tap, Tab, autofill): mural focus follows.
    private HandleFocus(): void
    {
        if (this.transferring || Keyboard.FocusedElement === this.box)
        {
            return;
        }
        this.Transfer(() => Keyboard.Focus(this.box));
    }

    // DOM focus left without mural moving it (a click on a non-focusable mural
    // area, the browser's own Tab out): release mural focus so the TextBox no
    // longer claims keys it cannot receive.
    private HandleBlur(): void
    {
        if (this.transferring || Keyboard.FocusedElement !== this.box)
        {
            return;
        }
        this.Transfer(() => Keyboard.Focus(undefined));
    }

    // The input's caret / selection moved: mirror it onto the TextBox.
    private ReportSelection(): void
    {
        const input = this.Element;
        if (input.selectionStart === null || input.selectionEnd === null || this.reportingSelection)
        {
            return;
        }
        this.reportingSelection = true;
        try
        {
            this.box.Select(input.selectionStart, input.selectionEnd - input.selectionStart);
        }
        finally
        {
            this.reportingSelection = false;
        }
    }

    private HandleKey(e: Event): void
    {
        if (!NativeTextInput.Forwards(e as KeyboardEvent))
        {
            e.stopPropagation();
        }
    }

    // Whether mural should see this key (see the class comment). Never during
    // an IME composition: Enter there commits a candidate, not a form.
    private static Forwards(e: KeyboardEvent): boolean
    {
        const C = NativeTextInput;
        if (e.isComposing || e.keyCode === C.ImeKeyCode)
        {
            return false;
        }
        if (C.ForwardedKeys.has(e.key) || C.FunctionKey.test(e.key))
        {
            return true;
        }
        if (!e.ctrlKey && !e.metaKey && !e.altKey)
        {
            return false;
        }
        if (C.EditingKeys.has(e.key))
        {
            return false;
        }
        return !((e.ctrlKey || e.metaKey) && C.EditingChords.has(e.key.toLowerCase()));
    }

    private WriteValue(value: string): void
    {
        const input = this.Element;
        const focused = this.IsFocused;
        const start = input.selectionStart;
        const end = input.selectionEnd;
        this.syncing = true;
        try
        {
            input.value = value;
            if (focused && start !== null && end !== null && input.selectionStart !== null)
            {
                input.setSelectionRange(Math.min(start, value.length), Math.min(end, value.length));
            }
        }
        finally
        {
            this.syncing = false;
        }
    }

    private RetryFocus(): void
    {
        const view = this.Element.ownerDocument.defaultView;
        if (view === null || this.focusRetries >= NativeTextInput.MaxFocusRetries)
        {
            this.focusRetries = 0;
            return;
        }
        this.focusRetries++;
        view.requestAnimationFrame(() =>
        {
            if (Keyboard.FocusedElement === this.box)
            {
                this.Focus();
            }
            else
            {
                this.focusRetries = 0;
            }
        });
    }

    private Transfer(move: () => void): void
    {
        this.transferring = true;
        try
        {
            move();
        }
        finally
        {
            this.transferring = false;
        }
    }

    private static HintsFor(purpose: InputPurpose): PurposeHints
    {
        return NativeTextInput.Hints.get(purpose) ?? NativeTextInput.Hints.get(InputPurpose.None)!;
    }

    private static SetOptional(el: HTMLElement, name: string, value: string | undefined): void
    {
        if (value === undefined)
        {
            el.removeAttribute(name);
        }
        else
        {
            el.setAttribute(name, value);
        }
    }

    private static CssColor(brush: Brush | undefined): string | undefined
    {
        return brush instanceof SolidColorBrush ? brush.Color.ToCss() : undefined;
    }

    // Adds the ::placeholder rule to the input's current document (it may have
    // been adopted into another one, e.g. a torn-off window).
    private static EnsureStyle(doc: Document): void
    {
        if (doc.getElementById(NativeTextInput.StyleId) !== null || doc.head === null)
        {
            return;
        }
        const style = doc.createElement(NativeTextInput.StyleTag);
        style.id = NativeTextInput.StyleId;
        style.textContent = NativeTextInput.StyleText;
        doc.head.appendChild(style);
    }
}
