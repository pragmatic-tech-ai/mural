import {
    APPROXIMATE_TEXT_MEASURER,
    Element,
    MetaData,
    MuralBase,
    Rect,
    hasModifier,
    Key,
    ModifierKeys,
    type DrawingContext,
    type FocusEventArgs,
    type KeyEventArgs,
    type PointerEventArgs,
    type TextInputEventArgs,
} from '../runtime/index.js';
import { Brush, FontFamily, SolidColorBrush, TextAlignment } from '../visual-engine/index.js';
import { Theme } from './theme.js';
import { RichTextBlock } from './rich-text-block.js';
import { FlowDocument } from './documents/flow-document.js';
import { TextPointer, ParagraphRuns } from './documents/text-pointer.js';
import { type Run } from './documents/inlines.js';
import { type ClipboardSink } from './text-box.js';
import { type MeasureText } from './documents/text-layout.js';
import {
    DocumentParagraphs, DocumentStart, DocumentEnd, OrderPointers, ParagraphText,
    ParagraphStart, ParagraphEnd, MoveByChar, MoveByWord,
} from './documents/text-navigation.js';
import {
    NormalizeParagraph, InsertText, DeleteRange, DeleteBack, DeleteForward,
    SplitParagraph, ToggleFormat, FormatKind, IndentParagraph, OutdentParagraph,
    SetFormat, SetRunStyle, QueryFormatActive, QueryRunValue, RunHasFormat,
} from './documents/text-editing.js';

// Normalise a run's FontFamily (string | FontFamily | undefined) to a plain
// family-name string so a toolbar picker's `Text` DP reflects it directly.
function familyName(v: FontFamily | string | undefined): string | undefined
{
    if (v === undefined) return undefined;
    return typeof v === 'string' ? v : v.Source;
}
import { CaretRectFor, PointerAtPoint, SelectionRects } from './documents/caret-geometry.js';

// Selection-highlight opacity, on Color's 0–255 alpha scale (≈ 30%).
const SELECTION_ALPHA = 77;

// Node-safe default clipboard (mirrors TextBox's) — replaceable per test.
const DEFAULT_CLIPBOARD: ClipboardSink = {
    Read: async () => {
        const nav = (globalThis as { navigator?: { clipboard?: { readText?: () => Promise<string> } } }).navigator;
        return nav?.clipboard?.readText === undefined ? '' : nav.clipboard.readText();
    },
    Write: async (text: string) => {
        const nav = (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } }).navigator;
        if (nav?.clipboard?.writeText !== undefined) await nav.clipboard.writeText(text);
    },
};

// ─────────────────────────────────────────────────────────────────────
// RichTextBox — the editable host for a FlowDocument. Reuses RichTextBlock's
// whole layout / paint / hit-test core and adds the editing surface: a
// caret + selection expressed as two TextPointers (anchor + active), caret
// blink, keyboard editing (nav / type / delete / Enter / Tab / Ctrl chords),
// mouse selection, clipboard, and Ctrl+B/I/U formatting. Edits are model
// mutations (text-editing.ts) that bubble back through the document to
// re-measure; selection & caret paint over the block render.
//
// The editor works on NORMALISED paragraphs (flat styled Runs) — the whole
// document is normalised on assignment so every op is a clean run operation.
export class RichTextBox extends RichTextBlock
{
    static
    {
        MuralBase.OverrideMetadata(RichTextBox, Element.DefaultStyleKeyKey, { default_value: RichTextBox });
    }

    /** Replaceable clipboard surface (tests swap in a synchronous stub). */
    public static Clipboard: ClipboardSink = DEFAULT_CLIPBOARD;

    public static readonly IsReadOnlyKey    = MuralBase.RegisterProperty<boolean>(RichTextBox, 'IsReadOnly', false, MetaData.None);
    public static readonly CaretBrushKey     = MuralBase.RegisterProperty<Brush | undefined>(RichTextBox, 'CaretBrush', undefined, MetaData.Render);
    public static readonly SelectionBrushKey = MuralBase.RegisterProperty<Brush | undefined>(RichTextBox, 'SelectionBrush', undefined, MetaData.Render);

    // Selection endpoints. `_anchor` is fixed while dragging / shift-moving;
    // `_caret` is the moving end. Equal → a collapsed caret (no selection).
    private _anchor: TextPointer | undefined;
    private _caret:  TextPointer | undefined;

    public CaretVisible = false;
    private _blinkTimer: ReturnType<typeof setInterval> | undefined;
    private _dragging = false;
    // Desired x (document space) preserved across vertical moves.
    private _preferredX: number | undefined;

    constructor()
    {
        super();
        this.Focusable = true;
        // I-beam over the editable text surface (WPF TextBoxBase parity).
        // The renderer mirrors Visual.Cursor onto the outer <g>'s cursor attr.
        this.Cursor = 'text';
    }

    public get IsReadOnly(): boolean { return this.get_property_value(RichTextBox.IsReadOnlyKey); }
    public set IsReadOnly(v: boolean) { this.set_property_value(RichTextBox.IsReadOnlyKey, v); }
    public get CaretBrush(): Brush | undefined { return this.get_property_value(RichTextBox.CaretBrushKey); }
    public set CaretBrush(v: Brush | undefined) { this.set_property_value(RichTextBox.CaretBrushKey, v); }
    public get SelectionBrush(): Brush | undefined { return this.get_property_value(RichTextBox.SelectionBrushKey); }
    public set SelectionBrush(v: Brush | undefined) { this.set_property_value(RichTextBox.SelectionBrushKey, v); }

    // Normalise + reset the caret whenever the document changes.
    public override get Document(): FlowDocument | undefined { return super.Document; }
    public override set Document(v: FlowDocument | undefined)
    {
        super.Document = v;
        if (v !== undefined) for (const p of DocumentParagraphs(v)) NormalizeParagraph(p);
        const start = v !== undefined ? DocumentStart(v) : undefined;
        this._caret = start;
        this._anchor = start?.Clone();
        this._preferredX = undefined;
    }

    /** The current selection as [anchor, caret], or undefined. */
    public get CaretPosition(): TextPointer | undefined { return this._caret?.Clone(); }

    // ── Measurer ────────────────────────────────────────────────────
    private caretMeasure(): MeasureText
    {
        const m = this.target?.TextMeasurer ?? APPROXIMATE_TEXT_MEASURER;
        return (t, p) => m.Measure(t, p.family, p.size, p.weight, p.style);
    }

    // ── Selection helpers ───────────────────────────────────────────
    private selectionEmpty(): boolean
    {
        return this._anchor === undefined || this._caret === undefined || this._anchor.Equals(this._caret);
    }
    private setCaret(p: TextPointer, extend: boolean): void
    {
        this._caret = p;
        if (!extend) this._anchor = p.Clone();
    }
    private collapseTo(p: TextPointer): void { this._caret = p; this._anchor = p.Clone(); }
    private afterEdit(): void
    {
        this.CaretVisible = true;
        this._preferredX = undefined;
        this.InvalidateMeasure();
        this.InvalidateVisual();
        this._fireSelectionChanged();
    }
    private afterMove(): void
    {
        this.CaretVisible = true;
        this.InvalidateVisual();
        this._fireSelectionChanged();
    }

    // ── Selection-changed notification ──────────────────────────────
    // Fires after every caret move / edit so a host (a board alignment
    // toolbar) can re-reflect the caret paragraph's format.
    private readonly _selectionListeners: Array<() => void> = [];
    public AddSelectionChangedListener(l: () => void): void { this._selectionListeners.push(l); }
    public RemoveSelectionChangedListener(l: () => void): void
    {
        const i = this._selectionListeners.indexOf(l);
        if (i >= 0) this._selectionListeners.splice(i, 1);
    }
    private _fireSelectionChanged(): void
    {
        for (const l of [...this._selectionListeners]) l();
    }

    // ── Paragraph alignment ─────────────────────────────────────────
    // Set the TextAlignment of every paragraph the current selection touches
    // (the caret's paragraph when the selection is collapsed).
    public SetSelectionAlignment(align: TextAlignment): void
    {
        const doc = this.Document;
        if (doc === undefined || this._caret === undefined || this._anchor === undefined) return;
        const [lo, hi] = OrderPointers(doc, this._anchor, this._caret);
        const paras = DocumentParagraphs(doc);
        const loI = paras.indexOf(lo.Paragraph);
        const hiI = paras.indexOf(hi.Paragraph);
        if (loI < 0 || hiI < 0) return;
        for (let i = loI; i <= hiI; i++) paras[i]!.TextAlignment = align;
        this.afterEdit();
    }

    // The alignment at the caret (the lower end of the selection). undefined
    // when there's no document to read.
    public get SelectionAlignment(): TextAlignment | undefined
    {
        const doc = this.Document;
        if (doc === undefined || this._caret === undefined) return undefined;
        const at = this._anchor !== undefined ? OrderPointers(doc, this._anchor, this._caret)[0] : this._caret;
        return at.Paragraph.TextAlignment;
    }

    // ── Character formatting (font family / size / colour / decorations) ──
    // Every setter acts on the current selection (no-op when collapsed),
    // splitting runs at the endpoints so only the covered text is restyled;
    // afterEdit() relays out + fires selection-changed so a toolbar re-reflects.
    // The getters reflect the selection (mixed → false / undefined) or, when the
    // selection is collapsed, the run at the caret.
    public SetSelectionBold(on: boolean): void { this._setFormatFlag(FormatKind.Bold, on); }
    public SetSelectionItalic(on: boolean): void { this._setFormatFlag(FormatKind.Italic, on); }
    public SetSelectionUnderline(on: boolean): void { this._setFormatFlag(FormatKind.Underline, on); }
    public SetSelectionStrikethrough(on: boolean): void { this._setFormatFlag(FormatKind.Strikethrough, on); }
    public ToggleStrikethrough(): void { this.toggle(FormatKind.Strikethrough); }

    private _setFormatFlag(kind: FormatKind, on: boolean): void
    {
        const doc = this.Document;
        if (doc === undefined || this._caret === undefined || this._anchor === undefined) return;
        SetFormat(doc, this._anchor, this._caret, kind, on);
        this.afterEdit();
    }

    public SetSelectionFontFamily(family: FontFamily | string): void { this._setRunStyle((r) => { r.FontFamily = family; }); }
    public SetSelectionFontSize(size: number): void { this._setRunStyle((r) => { r.FontSize = size; }); }
    public SetSelectionForeground(brush: Brush): void { this._setRunStyle((r) => { r.Foreground = brush; }); }

    private _setRunStyle(apply: (r: Run) => void): void
    {
        const doc = this.Document;
        if (doc === undefined || this._caret === undefined || this._anchor === undefined) return;
        SetRunStyle(doc, this._anchor, this._caret, apply);
        this.afterEdit();
    }

    public get SelectionBold():          boolean { return this._queryFlag(FormatKind.Bold); }
    public get SelectionItalic():        boolean { return this._queryFlag(FormatKind.Italic); }
    public get SelectionUnderline():     boolean { return this._queryFlag(FormatKind.Underline); }
    public get SelectionStrikethrough(): boolean { return this._queryFlag(FormatKind.Strikethrough); }

    private _queryFlag(kind: FormatKind): boolean
    {
        const doc = this.Document;
        if (doc === undefined || this._caret === undefined) return false;
        if (this._anchor !== undefined && !this._anchor.Equals(this._caret))
        {
            return QueryFormatActive(doc, this._anchor, this._caret, kind);
        }
        const r = this._runAtCaret();
        return r !== undefined && RunHasFormat(r, kind);
    }

    public get SelectionFontFamily(): string | undefined { return this._queryValue((r) => familyName(r.FontFamily)); }
    public get SelectionFontSize():   number | undefined { return this._queryValue((r) => r.FontSize); }

    // Brushes compare by identity, so a value-equality query would report mixed
    // for two same-colour runs — return the caret run's brush to seed a swatch.
    public get SelectionForeground(): Brush | undefined
    {
        return this._runAtCaret()?.Foreground;
    }

    private _queryValue<T>(read: (r: Run) => T): T | undefined
    {
        const doc = this.Document;
        if (doc === undefined || this._caret === undefined) return undefined;
        if (this._anchor !== undefined && !this._anchor.Equals(this._caret))
        {
            return QueryRunValue(doc, this._anchor, this._caret, read);
        }
        const r = this._runAtCaret();
        return r !== undefined ? read(r) : undefined;
    }

    // The run the caret sits in (or the last run when the caret is at the
    // paragraph end). undefined when there's no caret.
    private _runAtCaret(): Run | undefined
    {
        if (this._caret === undefined) return undefined;
        const off = this._caret.Offset;
        let last: Run | undefined;
        for (const slot of ParagraphRuns(this._caret.Paragraph))
        {
            const rEnd = slot.start + slot.run.Text.length;
            last = slot.run;
            if (off >= slot.start && off < rEnd) return slot.run;
        }
        return last;
    }

    // ── Painting (selection behind text, caret in front) ────────────
    protected override RenderOverride(dc: DrawingContext): void
    {
        this.paintSelection(dc);
        super.RenderOverride(dc);
        this.paintCaret(dc);
    }

    private selectionBrush(): Brush
    {
        const b = this.SelectionBrush;
        if (b !== undefined) return b;
        // ~30% opacity. Color's alpha channel is 0–255 (NOT 0–1) — passing a
        // fractional value here renders as alpha 0 (a fully transparent, and
        // therefore invisible, selection highlight).
        const prim = Theme.primary;
        return prim instanceof SolidColorBrush ? new SolidColorBrush(prim.Color.WithAlpha(SELECTION_ALPHA)) : prim;
    }
    private caretBrush(): Brush { return this.CaretBrush ?? this.Foreground ?? Theme.ink; }

    private paintSelection(dc: DrawingContext): void
    {
        const doc = this.Document;
        if (doc === undefined || this._layout === undefined || this.selectionEmpty()) return;
        const rects = SelectionRects(this._layout, doc, this._anchor!, this._caret!, this.caretMeasure());
        const brush = this.selectionBrush();
        for (const r of rects) dc.DrawRectangle(brush, undefined, r);
    }

    private paintCaret(dc: DrawingContext): void
    {
        if (!this.IsFocused || !this.CaretVisible || this._caret === undefined || this._layout === undefined) return;
        const c = CaretRectFor(this._layout, this._caret, this.caretMeasure());
        if (c === undefined) return;
        dc.DrawRectangle(this.caretBrush(), undefined, new Rect(c.x, c.y, 1, c.height));
    }

    // ── Focus + blink ───────────────────────────────────────────────
    protected override OnGotFocus(_args: FocusEventArgs): void
    {
        this.CaretVisible = true;
        this.startBlink();
        this.InvalidateVisual();
    }
    protected override OnLostFocus(_args: FocusEventArgs): void
    {
        this.CaretVisible = false;
        this.stopBlink();
        this._dragging = false;
        this.InvalidateVisual();
    }
    private startBlink(): void
    {
        if (this._blinkTimer !== undefined) return;
        const timer = setInterval(() => { this.CaretVisible = !this.CaretVisible; this.InvalidateVisual(); }, 500);
        (timer as unknown as { unref?: () => void }).unref?.();
        this._blinkTimer = timer;
    }
    private stopBlink(): void
    {
        if (this._blinkTimer === undefined) return;
        clearInterval(this._blinkTimer);
        this._blinkTimer = undefined;
    }

    // ── Mouse ───────────────────────────────────────────────────────
    private hitTest(args: PointerEventArgs): TextPointer | undefined
    {
        if (this._layout === undefined) return undefined;
        const o = this.absoluteOrigin();
        return PointerAtPoint(this._layout, args.HostX - o.x, args.HostY - o.y, this.caretMeasure());
    }

    protected override OnPointerDown(args: PointerEventArgs): void
    {
        // Take focus + capture so the drag-extends-selection flow keeps
        // receiving Move / Up even when the pointer wanders outside the
        // editor's bounds (capture overrides hit-testing in the router).
        args.SetFocus(this);
        args.CapturePointer(this);
        const p = this.hitTest(args);
        if (p !== undefined)
        {
            const shift = hasModifier(args.Modifiers, ModifierKeys.Shift);
            this.setCaret(p, shift);
            this._dragging = true;
            this.afterMove();
        }
        args.Handled = true;
    }
    protected override OnPointerMove(args: PointerEventArgs): void
    {
        if (!this._dragging) return;
        const p = this.hitTest(args);
        if (p !== undefined) { this.setCaret(p, true); this.afterMove(); }
        args.Handled = true;
    }
    protected override OnPointerUp(args: PointerEventArgs): void
    {
        if (this._dragging) { this._dragging = false; args.ReleasePointerCapture(); }
        args.Handled = true;
    }

    // ── Keyboard ────────────────────────────────────────────────────
    protected override OnKeyDown(args: KeyEventArgs): void
    {
        const mods = args.Modifiers;
        const shift = hasModifier(mods, ModifierKeys.Shift);
        const ctrl = hasModifier(mods, ModifierKeys.Control) || hasModifier(mods, ModifierKeys.Windows);
        const ro = this.IsReadOnly;

        switch (args.Key)
        {
            case Key.Left:  this.moveHorizontal(-1, shift, ctrl); args.Handled = true; return;
            case Key.Right: this.moveHorizontal(+1, shift, ctrl); args.Handled = true; return;
            case Key.Up:    this.moveVertical(-1, shift); args.Handled = true; return;
            case Key.Down:  this.moveVertical(+1, shift); args.Handled = true; return;
            case Key.Home:  this.moveEdge('start', shift, ctrl); args.Handled = true; return;
            case Key.End:   this.moveEdge('end', shift, ctrl); args.Handled = true; return;
            case Key.Back:    if (!ro) this.deleteBefore(); args.Handled = true; return;
            case Key.Delete:  if (!ro) this.deleteAfter();  args.Handled = true; return;
            case Key.Return:  if (!ro) this.splitAtCaret(); args.Handled = true; return;
            case Key.Tab:
                if (!ro) { this.indentOutdent(shift); args.Handled = true; }
                return;
        }

        if (ctrl)
        {
            switch (args.Key)
            {
                case Key.A: this.selectAll(); args.Handled = true; return;
                case Key.C: void this.copy(); args.Handled = true; return;
                case Key.X: if (!ro) void this.cut(); else void this.copy(); args.Handled = true; return;
                case Key.V: if (!ro) void this.paste(); args.Handled = true; return;
                case Key.B: if (!ro) this.toggle(FormatKind.Bold); args.Handled = true; return;
                case Key.I: if (!ro) this.toggle(FormatKind.Italic); args.Handled = true; return;
                case Key.U: if (!ro) this.toggle(FormatKind.Underline); args.Handled = true; return;
            }
        }
    }

    protected override OnTextInput(args: TextInputEventArgs): void
    {
        if (this.IsReadOnly || args.Text.length === 0) return;
        this.type(args.Text);
        args.Handled = true;
    }

    // ── Navigation ──────────────────────────────────────────────────
    private moveHorizontal(dir: 1 | -1, extend: boolean, byWord: boolean): void
    {
        const doc = this.Document;
        if (doc === undefined || this._caret === undefined) return;
        // Non-extending arrow over a selection collapses to the edge.
        if (!extend && !this.selectionEmpty())
        {
            const [lo, hi] = OrderPointers(doc, this._anchor!, this._caret);
            this.collapseTo(dir < 0 ? lo : hi);
            this.afterMove();
            return;
        }
        const next = byWord ? MoveByWord(doc, this._caret, dir) : MoveByChar(doc, this._caret, dir);
        this.setCaret(next, extend);
        this._preferredX = undefined;
        this.afterMove();
    }

    private moveVertical(dir: 1 | -1, extend: boolean): void
    {
        if (this._layout === undefined || this._caret === undefined) return;
        const c = CaretRectFor(this._layout, this._caret, this.caretMeasure());
        if (c === undefined) return;
        const x = this._preferredX ?? c.x;
        this._preferredX = x;
        const targetY = dir < 0 ? c.y - 1 : c.y + c.height + 1;
        const next = PointerAtPoint(this._layout, x, targetY, this.caretMeasure());
        if (next !== undefined) { this.setCaret(next, extend); this.afterMove(); }
    }

    private moveEdge(edge: 'start' | 'end', extend: boolean, whole: boolean): void
    {
        const doc = this.Document;
        if (doc === undefined || this._caret === undefined) return;
        const next = whole
            ? (edge === 'start' ? DocumentStart(doc) : DocumentEnd(doc))
            : (edge === 'start' ? ParagraphStart(this._caret.Paragraph) : ParagraphEnd(this._caret.Paragraph));
        if (next === undefined) return;
        this.setCaret(next, extend);
        this._preferredX = undefined;
        this.afterMove();
    }

    private selectAll(): void
    {
        const doc = this.Document;
        if (doc === undefined) return;
        const s = DocumentStart(doc), e = DocumentEnd(doc);
        if (s === undefined || e === undefined) return;
        this._anchor = s; this._caret = e;
        this.afterMove();
    }

    // ── Editing ─────────────────────────────────────────────────────
    private type(text: string): void
    {
        const doc = this.Document;
        if (doc === undefined || this._caret === undefined) return;
        if (!this.selectionEmpty()) this._caret = DeleteRange(doc, this._anchor!, this._caret);
        const parts = text.split('\n');
        let caret = InsertText(doc, this._caret, parts[0]!);
        for (let i = 1; i < parts.length; i++) { caret = SplitParagraph(doc, caret); caret = InsertText(doc, caret, parts[i]!); }
        this.collapseTo(caret);
        this.afterEdit();
    }

    private deleteBefore(): void
    {
        const doc = this.Document;
        if (doc === undefined || this._caret === undefined) return;
        const caret = this.selectionEmpty() ? DeleteBack(doc, this._caret) : DeleteRange(doc, this._anchor!, this._caret);
        this.collapseTo(caret);
        this.afterEdit();
    }
    private deleteAfter(): void
    {
        const doc = this.Document;
        if (doc === undefined || this._caret === undefined) return;
        const caret = this.selectionEmpty() ? DeleteForward(doc, this._caret) : DeleteRange(doc, this._anchor!, this._caret);
        this.collapseTo(caret);
        this.afterEdit();
    }
    private splitAtCaret(): void
    {
        const doc = this.Document;
        if (doc === undefined || this._caret === undefined) return;
        if (!this.selectionEmpty()) this._caret = DeleteRange(doc, this._anchor!, this._caret);
        this.collapseTo(SplitParagraph(doc, this._caret));
        this.afterEdit();
    }
    private indentOutdent(shift: boolean): void
    {
        const doc = this.Document;
        if (doc === undefined || this._caret === undefined) return;
        this._caret = shift ? OutdentParagraph(doc, this._caret) : IndentParagraph(doc, this._caret);
        this._anchor = this._caret.Clone();
        this.afterEdit();
    }
    private toggle(kind: FormatKind): void
    {
        const doc = this.Document;
        if (doc === undefined || this.selectionEmpty()) return;
        ToggleFormat(doc, this._anchor!, this._caret!, kind);
        this.afterEdit();
    }

    // ── Clipboard ───────────────────────────────────────────────────
    private selectedText(): string
    {
        const doc = this.Document;
        if (doc === undefined || this.selectionEmpty()) return '';
        const [lo, hi] = OrderPointers(doc, this._anchor!, this._caret!);
        const all = DocumentParagraphs(doc);
        const loI = all.indexOf(lo.Paragraph), hiI = all.indexOf(hi.Paragraph);
        if (loI === hiI) return ParagraphText(lo.Paragraph).slice(lo.Offset, hi.Offset);
        const parts = [ParagraphText(lo.Paragraph).slice(lo.Offset)];
        for (let i = loI + 1; i < hiI; i++) parts.push(ParagraphText(all[i]!));
        parts.push(ParagraphText(hi.Paragraph).slice(0, hi.Offset));
        return parts.join('\n');
    }
    private async copy(): Promise<void>
    {
        const text = this.selectedText();
        if (text !== '') await RichTextBox.Clipboard.Write(text);
    }
    private async cut(): Promise<void>
    {
        const text = this.selectedText();
        if (text === '') return;
        await RichTextBox.Clipboard.Write(text);
        const doc = this.Document;
        if (doc !== undefined && this._caret !== undefined && this._anchor !== undefined)
        {
            this.collapseTo(DeleteRange(doc, this._anchor, this._caret));
            this.afterEdit();
        }
    }
    private async paste(): Promise<void>
    {
        const text = await RichTextBox.Clipboard.Read();
        if (text !== '') this.type(text);
    }

    // Public editing commands (the WPF EditingCommands analog) — for a
    // formatting toolbar / menu to drive the editor. They act on the
    // current selection (format toggles) or caret paragraph (indent), which
    // persist on this control regardless of focus, so a toolbar button that
    // takes focus still applies to the last selection.
    public ToggleBold(): void { this.toggle(FormatKind.Bold); }
    public ToggleItalic(): void { this.toggle(FormatKind.Italic); }
    public ToggleUnderline(): void { this.toggle(FormatKind.Underline); }
    public Indent(): void { this.indentOutdent(false); }
    public Outdent(): void { this.indentOutdent(true); }

    // Public test/host affordances for driving selection programmatically.
    public SelectAll(): void { this.selectAll(); }
    public SelectedText(): string { return this.selectedText(); }
    public SetCaret(p: TextPointer): void { this.collapseTo(p); this.afterMove(); }
    public Select(anchor: TextPointer, caret: TextPointer): void { this._anchor = anchor; this._caret = caret; this.afterMove(); }
}
