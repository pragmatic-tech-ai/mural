import {
    APPROXIMATE_TEXT_MEASURER,
    MetaData,
    MuralBase,
    Point,
    Rect,
    Size,
    Element, Visual,
    hasModifier,
    ModifierKeys,
    type DrawingContext,
    type FocusEventArgs,
    type KeyEventArgs,
    Key,
    type PointerEventArgs,
    type TextInputEventArgs,
    type TextMeasurer,
    type TextMetrics,
} from '../runtime/index.js';
import {
    FontFamily,
    FontStyle,
    FontWeight,
    FormattedText,
    TextDecorations,
    type Brush,
} from '../visual-engine/index.js';
import type { Border } from './border.js';
import { TemplatedControl } from './templated-control.js';
import { TextWrapping } from './text-block.js';
import { InputPurpose } from './input-purpose.js';
import { NativeTextInput } from './native-text-input.js';
import type { ScrollViewer } from '../framework/surfaces/scroll-viewer.js';

// Resource-dictionary key — matches the `x:key` literal in
// controls.template.mu's DefaultTextBox entry.


// ── Clipboard surface ──────────────────────────────────────────────

// Async string-clipboard contract. The default implementation reaches
// for `navigator.clipboard` in browser contexts; tests / non-browser
// hosts (Node) override `TextBox.Clipboard` with a synchronous in-memory
// stub so Ctrl+C / Ctrl+V can be exercised without a real OS clipboard.
export interface ClipboardSink
{
    Read():  Promise<string>;
    Write(text: string): Promise<void>;
}

// Defensive default — falls back to a no-op promise when `navigator` or
// `navigator.clipboard` is undefined (Node test environments). Real
// browser pages get the system clipboard; tests can replace
// `TextBox.Clipboard` wholesale before invoking key handlers.
const DEFAULT_CLIPBOARD: ClipboardSink = {
    Read: async () => {
        const nav = (globalThis as { navigator?: { clipboard?: { readText?: () => Promise<string> } } }).navigator;
        if (nav?.clipboard?.readText === undefined) return '';
        return nav.clipboard.readText();
    },
    Write: async (text: string) => {
        const nav = (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } }).navigator;
        if (nav?.clipboard?.writeText === undefined) return;
        return nav.clipboard.writeText(text);
    },
};

// ── Internal painted surface (template part PART_Editor) ───────────

// Cached per-line layout — the substring, its full-width metrics, and
// the per-character X positions used by caret-positioning and mouse
// hit-testing. After soft-wrap one logical line can produce several
// LineLayout entries; in NoWrap mode each logical line maps to exactly
// one entry.
interface LineLayout
{
    Text:    string;
    Metrics: TextMetrics;
    /** prefix X position for each column 0..Text.length. CharX[c] is
     *  the X of the leading edge of column `c`; CharX[Text.length] is
     *  the trailing edge of the last glyph. */
    CharX:   number[];
    /** Char offset into TextBox.Text where this visual line's first
     *  glyph lives. For a wrapped logical line, successive visual lines'
     *  GlobalStart values may skip a character — the consumed whitespace
     *  that the wrap algorithm collapsed into the break — so this is
     *  NOT always equal to `previousLine.GlobalStart + previousLine.Text.length`. */
    GlobalStart: number;
}

// Pre-GlobalStart per-logical-line cache entry. The wrap algorithm
// returns a list of these (positions RELATIVE to the logical line's
// start); the flatten step that builds `_lines` adds the global
// offset of each logical line on top.
interface RelativeVisualLine
{
    Text:    string;
    Metrics: TextMetrics;
    CharX:   number[];
    /** Char offset within the LOGICAL line where this visual line begins. */
    RelStart: number;
}

// Editor surface — paints the text body, selection backgrounds, and the
// caret. Owned by a TextBox via the consolidated template, which sets
// `textBox` back-reference after Apply.
//
// All editing state (Text, anchor, caret index, selection direction,
// focus visual) lives on the TextBox. The editor surface reads from it
// at Measure / Render time and writes nothing back; it is purely a
// view-side concern. Exported so the consolidated controls template
// can name it; not part of the public Controls API (rename / removal
// without notice).
export class TextEditorSurface extends Element
{
    public textBox: TextBox | undefined;

    // Cached layout per logical line. Recomputed in MeasureOverride
    // when Text / font properties change; reused by RenderOverride and
    // by the TextBox's caret-positioning + hit-test helpers.
    private _lines:        LineLayout[] = [];
    private _lineHeight:   number       = 0;
    private _baselineRise: number       = 0;

    // Per-logical-line memoisation. The cache key encodes the logical
    // line text PLUS the wrap budget (no-wrap encoded as -1) so the
    // same logical line measured at two different widths gets two
    // cache entries instead of returning stale layouts. A font-signature
    // change clears the whole cache.
    //
    // Each entry holds the wrap result as RelativeVisualLines (positions
    // relative to the logical line start); the flatten step in
    // MeasureOverride adds the global offset when materialising `_lines`.
    private readonly _lineCache = new Map<string, RelativeVisualLine[]>();
    private _cachedFontSig:     string = '';

    // The TextBox's native <input> while UsesNativeInput is on: the renderer
    // hosts it in a persistent <foreignObject> sized to this surface (the
    // DomHost path), and RenderOverride then paints nothing of its own.
    public get ForeignElement(): HTMLElement | undefined { return this.textBox?.NativeInputElement; }

    public get Lines():        readonly LineLayout[] { return this._lines; }
    public get LineHeight():   number                { return this._lineHeight; }
    public get BaselineRise(): number                { return this._baselineRise; }

    protected override MeasureOverride(availableSize: Size): Size
    {
        const tb = this.textBox;
        if (tb === undefined) return Size.Zero;

        const measurer = this.target?.TextMeasurer ?? APPROXIMATE_TEXT_MEASURER;
        const family   = tb.FontFamily.Source;
        const fontSize = tb.FontSize;
        const weight   = tb.FontWeight;
        const style    = tb.FontStyle;

        // Font-signature change invalidates the entire per-line cache.
        // Within the same signature, lines that match cache keys reuse
        // their LineLayout — typing in line 0 of a 50-line TextBox now
        // only re-measures line 0 instead of all 50 lines per keystroke.
        const fontSig = `${family}|${fontSize}|${weight}|${style}`;
        if (fontSig !== this._cachedFontSig)
        {
            this._lineCache.clear();
            this._cachedFontSig = fontSig;
        }

        // Single-line TextBoxes (AcceptsReturn === false) ignore the
        // TextWrapping DP. Wrap only makes sense in multi-line, and
        // forcing NoWrap here keeps the horizontal scroll path uniform
        // for the single-line case regardless of what the consumer set.
        const wrap     = tb.AcceptsReturn && tb.TextWrapping === TextWrapping.Wrap;
        const wrapBudget = wrap && Number.isFinite(availableSize.Width)
            ? availableSize.Width
            : -1;
        const cacheKeyMode = `${wrapBudget}`;

        // Split on \n into logical lines. Always at least one entry
        // (the empty string) so caret rendering at an empty TextBox
        // still has a valid line / position to anchor against.
        const text  = tb.DisplayText;
        const logicalLines = text.split('\n');

        const out: LineLayout[] = [];
        const used = new Set<string>();
        let maxWidth = 0;
        let globalOffset = 0;

        for (const lineText of logicalLines)
        {
            const cacheKey = `${cacheKeyMode}:${lineText}`;
            const cached = this._lineCache.get(cacheKey);
            let visualLines: RelativeVisualLine[];
            if (cached === undefined)
            {
                visualLines = wrap
                    ? wrapLine(lineText, wrapBudget, measurer, family, fontSize, weight, style)
                    : [{
                        Text:     lineText,
                        Metrics:  measurer.Measure(lineText, family, fontSize, weight, style),
                        CharX:    computeCharXPositions(lineText, measurer, family, fontSize, weight, style),
                        RelStart: 0,
                    }];
                this._lineCache.set(cacheKey, visualLines);
            }
            else
            {
                visualLines = cached;
            }
            used.add(cacheKey);

            // Flatten this logical line's visual breakdown into _lines,
            // adding the global offset on top of each entry's RelStart.
            for (const vl of visualLines)
            {
                out.push({
                    Text:        vl.Text,
                    Metrics:     vl.Metrics,
                    CharX:       vl.CharX,
                    GlobalStart: globalOffset + vl.RelStart,
                });
                if (vl.Metrics.Width > maxWidth) maxWidth = vl.Metrics.Width;
            }

            // +1 accounts for the '\n' that separates this logical line
            // from the next. The last logical line has no trailing '\n'
            // but we still bump (harmlessly — the loop ends after this).
            globalOffset += lineText.length + 1;
        }

        // Evict cache entries not referenced by the current text so the
        // cache size stays proportional to the number of distinct
        // (logical line + width) pairs currently in the TextBox. Without
        // this, typing a long sequence of distinct lines (and then
        // deleting them) would let the cache grow unbounded; same for
        // shrinking the viewport (each old width leaves residual entries).
        if (this._lineCache.size > used.size)
        {
            for (const key of this._lineCache.keys())
            {
                if (!used.has(key)) this._lineCache.delete(key);
            }
        }

        // Use the first line's metrics as the canonical line height.
        // ApproximateTextMeasurer returns identical heights for every
        // line of the same font, and a FontMetricsMeasurer is also
        // constant per-font, so this is a fair pick.
        const probeMetrics  = out[0]!.Metrics.Height > 0
            ? out[0]!.Metrics
            : measurer.Measure('M', family, fontSize, weight, style);
        const lineHeight    = probeMetrics.Height > 0 ? probeMetrics.Height : fontSize * 1.2;
        const ascent        = probeMetrics.Ascent  > 0 ? probeMetrics.Ascent : fontSize * 0.85;

        this._lines        = out;
        this._lineHeight   = lineHeight;
        this._baselineRise = ascent;

        return new Size(maxWidth, lineHeight * out.length);
    }

    protected override ArrangeOverride(finalSize: Size): Size
    {
        // Caret + selection paint in MeasureOverride's local space; we
        // just return whatever slot we were given. The TextBox above
        // sized us via the Border's Padding inset, so finalSize already
        // reflects the textual rect.
        return finalSize;
    }

    protected override RenderOverride(dc: DrawingContext): void
    {
        const tb = this.textBox;
        if (tb === undefined) return;
        if (tb.IsNativeInputActive) return;   // the native input draws text, caret and selection
        if (this._lines.length === 0 || this._lineHeight === 0) return;

        // ── 1. Selection backgrounds ──────────────────────────────
        // Render BEFORE the text so glyph fills paint on top of the
        // tinted rectangle. Only renders when there's actually a
        // selection (anchor !== caret) — collapsed caret is just the
        // blinking bar drawn last.
        const selStart = tb.SelectionStart;
        const selEnd   = selStart + tb.SelectionLength;
        if (selEnd > selStart)
        {
            // SelectionBrush rides the default `Style[TargetType=TextBox]`
            // setter via DynamicResource (@SecondaryContainer) so a
            // theme switch re-tints live. Skip painting if undefined
            // — happens only when no theme is active.
            const selBrush = tb.SelectionBrush;
            if (selBrush !== undefined)
            {
                this.paintSelection(dc, selBrush, selStart, selEnd);
            }
        }

        // ── 2. Text lines ─────────────────────────────────────────
        // One DrawText per non-empty line, stacked at lineHeight
        // intervals. Empty lines are skipped (nothing to paint) — the
        // line still occupies vertical space because we step by
        // lineHeight regardless. Foreground rides the default
        // `Style[TargetType=TextBox]` setter (@OnSurface via
        // DynamicResource) — theme switches re-tint live.
        const foreground = tb.Foreground;
        for (let i = 0; i < this._lines.length; i++)
        {
            const line = this._lines[i]!;
            if (line.Text.length === 0) continue;
            const formatted = new FormattedText(
                line.Text,
                tb.FontFamily.Source,
                tb.FontSize,
                foreground,
                tb.FontWeight,
                tb.FontStyle,
                line.Metrics,
                0,
                tb.TextDecorations,
            );
            dc.DrawText(formatted, new Point(0, i * this._lineHeight));
        }

        // ── 2b. Placeholder ───────────────────────────────────────
        // Painted only when the box is empty, at the first line's origin.
        // Render-only (never measured), so it can't widen the field; the
        // brush falls back to Foreground when PlaceholderBrush is unset.
        if (tb.Text.length === 0 && tb.Placeholder.length > 0)
        {
            const measurer = this.target?.TextMeasurer ?? APPROXIMATE_TEXT_MEASURER;
            const metrics  = measurer.Measure(
                tb.Placeholder, tb.FontFamily.Source, tb.FontSize, tb.FontWeight, tb.FontStyle);
            const formatted = new FormattedText(
                tb.Placeholder,
                tb.FontFamily.Source,
                tb.FontSize,
                tb.PlaceholderBrush ?? foreground,
                tb.FontWeight,
                tb.FontStyle,
                metrics,
                0,
                tb.TextDecorations,
            );
            dc.DrawText(formatted, new Point(0, 0));
        }

        // ── 3. Caret ──────────────────────────────────────────────
        // Drawn only when the TextBox is focused AND the caret-blink
        // phase is on. Width is 1 DIP — adequate for most font sizes;
        // a future "thick caret" preference can layer here.
        if (tb.IsFocused && tb.CaretVisible)
        {
            // CaretBrush rides the default Style setter (@OnSurface
            // via DynamicResource); skip the caret when nothing
            // resolves so we don't paint with `undefined` (renderer's
            // hardcoded fill would diverge from the text body).
            const caretBrush = tb.CaretBrush;
            if (caretBrush !== undefined)
            {
                const pos = this.PositionFor(tb.CaretIndex);
                dc.DrawRectangle(caretBrush, undefined,
                    new Rect(pos.X, pos.Y, 1, this._lineHeight));
            }
        }
    }

    // Paint per-line selection rectangles between `start` and `end`
    // character indices (in TextBox.Text). Walks visual lines, using
    // each line's GlobalStart to clip the selection range — handles
    // both hard newlines and soft-wrap breaks transparently.
    private paintSelection(
        dc:    DrawingContext,
        brush: Brush,
        start: number,
        end:   number,
    ): void
    {
        for (let i = 0; i < this._lines.length; i++)
        {
            const line          = this._lines[i]!;
            const lineGlobalEnd = line.GlobalStart + line.Text.length;
            if (end <= line.GlobalStart) break;            // selection ends before this line
            if (start >= lineGlobalEnd && i < this._lines.length - 1)
            {
                // selection starts after this line's visible text — but
                // may still extend into the wrap/newline gap before the
                // next line. Continue so the tail-rect branch below can
                // paint that gap.
            }
            const colStart = Math.max(0, start - line.GlobalStart);
            const colEnd   = Math.min(line.Text.length, end - line.GlobalStart);
            if (colEnd < colStart) continue;
            const x0 = line.CharX[colStart] ?? 0;
            const x1 = line.CharX[colEnd]   ?? line.Metrics.Width;
            // Selection extending past this line's visible end into the
            // wrap / newline gap — paint a small "tail" so the line
            // break itself reads as part of the selection.
            const hasTrailingBreak = i < this._lines.length - 1 && end > lineGlobalEnd;
            const trailingTail     = hasTrailingBreak ? Math.max(4, this._lineHeight * 0.25) : 0;
            const width            = Math.max(0, x1 - x0) + trailingTail;
            if (width > 0)
            {
                dc.DrawRectangle(brush, undefined,
                    new Rect(x0, i * this._lineHeight, width, this._lineHeight));
            }
        }
    }

    // ── Caret / hit-test helpers ──────────────────────────────────

    /** Editor-local (x, y) of the leading edge of character index. The
     *  y origin is the top of the visual line; in Wrap mode multiple
     *  visual lines may share one logical line, and `charIndex` falls
     *  into the visual line whose GlobalStart..GlobalEnd range contains
     *  it (inclusive on both ends — the boundary index lives at the
     *  trailing edge of the earlier line). */
    public PositionFor(charIndex: number): { X: number; Y: number }
    {
        if (this._lines.length === 0) return { X: 0, Y: 0 };
        const idx = Math.max(0, Math.min(this.TotalLength(), charIndex));
        const lineIndex = this.lineIndexForCharIndex(idx);
        const line      = this._lines[lineIndex]!;
        const col       = Math.max(0, Math.min(line.Text.length, idx - line.GlobalStart));
        const x         = line.CharX[col] ?? line.Metrics.Width;
        return { X: x, Y: lineIndex * this._lineHeight };
    }

    /** Character index nearest the editor-local (x, y). */
    public IndexAt(x: number, y: number): number
    {
        if (this._lines.length === 0) return 0;
        const lineIndex = Math.max(0, Math.min(this._lines.length - 1,
            Math.floor(y / this._lineHeight)));
        const line = this._lines[lineIndex]!;
        const col  = colForX(line, x);
        return line.GlobalStart + col;
    }

    public TotalLength(): number
    {
        return this.textBox?.DisplayText.length ?? 0;
    }

    // Find the visual-line index that contains the absolute char index.
    // Inclusive on both ends — when an index sits exactly on a wrap /
    // newline boundary it belongs to the EARLIER line so the caret
    // displays at the trailing edge of that line rather than the start
    // of the next (matches WPF / browser behaviour).
    public lineIndexForCharIndex(idx: number): number
    {
        for (let i = 0; i < this._lines.length; i++)
        {
            const line = this._lines[i]!;
            const end  = line.GlobalStart + line.Text.length;
            if (idx <= end) return i;
        }
        return this._lines.length - 1;
    }
}

// Soft-wrap a single logical line into one or more visual lines that
// fit `maxWidth`. Greedy word-wrap with a char-wrap fallback for any
// single word that exceeds the wrap budget — matches the user's
// "Char-wrap fallback" choice and CSS `overflow-wrap: anywhere`.
//
// Algorithm per visual line: binary-search the longest substring
// `text[i..j]` whose measured width fits `maxWidth`. If `j < text.length`
// (i.e. we'd have to break), prefer the last space within (i, j] as the
// break point and skip the space (whitespace-eating wrap). If no space
// is available we break at j directly (char-wrap fallback). Progress is
// guaranteed even for `maxWidth = 0` by forcing at least one character
// per visual line.
//
// Returns positions RELATIVE to the start of the logical line; the
// caller's flatten step adds the global offset of the logical line on top.
function wrapLine(
    text:     string,
    maxWidth: number,
    measurer: TextMeasurer,
    family:   string,
    fontSize: number,
    weight:   string,
    style:    string,
): RelativeVisualLine[]
{
    const emit = (start: number, end: number): RelativeVisualLine => {
        const sub      = text.substring(start, end);
        const metrics  = measurer.Measure(sub, family, fontSize, weight, style);
        const charX    = computeCharXPositions(sub, measurer, family, fontSize, weight, style);
        return { Text: sub, Metrics: metrics, CharX: charX, RelStart: start };
    };

    // Empty logical line still gets ONE empty visual slot — caret + selection
    // paint anchor against it; without an entry the loop above skips it
    // entirely and an empty line becomes invisible.
    if (text.length === 0) return [emit(0, 0)];

    // Fast path: whole line fits, no break work.
    const fullW = measurer.Measure(text, family, fontSize, weight, style).Width;
    if (fullW <= maxWidth) return [emit(0, text.length)];

    const out: RelativeVisualLine[] = [];
    let i = 0;
    while (i < text.length)
    {
        // Binary-search the largest j in (i, text.length] such that
        // width(text[i..j]) <= maxWidth. Measurer hit per step; O(log N)
        // steps per visual line.
        let j  = i;
        let lo = i + 1;
        let hi = text.length;
        while (lo <= hi)
        {
            const mid = (lo + hi) >>> 1;
            const w   = measurer.Measure(text.substring(i, mid), family, fontSize, weight, style).Width;
            if (w <= maxWidth) { j = mid; lo = mid + 1; }
            else               { hi = mid - 1; }
        }
        // Progress guarantee: at least one glyph per visual line even
        // when the budget can't fit a single character (avoid an
        // infinite loop, accept the overflow on that one glyph).
        if (j <= i) j = i + 1;

        if (j < text.length)
        {
            // Word-break attempt: prefer the last whitespace at or before
            // j as the visual line's trailing edge, then skip past the
            // space so it doesn't appear at the start of the next visual
            // line. `lastIndexOf(' ', j - 1)` searches the [0, j-1]
            // range; the `> i` guard rejects spaces at the very start of
            // the slice (we don't want to emit an empty visual line).
            const lastSpace = text.lastIndexOf(' ', j - 1);
            if (lastSpace > i)
            {
                out.push(emit(i, lastSpace));
                i = lastSpace + 1;
                continue;
            }
        }
        // Either end-of-text or char-wrap fallback (no break opportunity).
        out.push(emit(i, j));
        i = j;
    }
    return out;
}

// Compute per-column X positions for a single line of text.
//
// Fast path: when the measurer exposes a MeasureCharPositions method
// (SvgTextMeasurer does — it sets the text once and reads every
// getSubStringLength against the same layout), call it directly. That
// collapses N substring measurements into one layout pass + N cheap
// reads.
//
// Slow path: fall back to N Measure calls on growing substrings. With
// ApproximateTextMeasurer that's O(N) per call (concat + AVG_GLYPH_RATIO
// multiply) → O(N²) total — fine for a TextBox holding a few hundred
// characters per line, which is all we currently support.
function computeCharXPositions(
    text:     string,
    measurer: TextMeasurer,
    family:   string,
    fontSize: number,
    weight:   string,
    style:    string,
): number[]
{
    const fast = (measurer as MeasureCharPositionsCapable).MeasureCharPositions;
    if (typeof fast === 'function')
    {
        return fast.call(measurer, text, family, fontSize, weight, style);
    }
    const xs: number[] = new Array(text.length + 1);
    xs[0] = 0;
    for (let i = 1; i <= text.length; i++)
    {
        xs[i] = measurer.Measure(text.substring(0, i), family, fontSize, weight, style).Width;
    }
    return xs;
}

// Optional capability on a TextMeasurer: one-shot per-character prefix
// widths. Avoids the O(N²) substring concat cost when the measurer
// can reuse a single layout across reads. SvgTextMeasurer implements
// this; other measurers fall through to per-prefix Measure calls.
interface MeasureCharPositionsCapable
{
    MeasureCharPositions?(
        text:     string,
        family:   string,
        fontSize: number,
        weight:   string,
        style:    string,
    ): number[];
}

// Find the visual line + column for an absolute character index. Used
// by TextBox's key handler for Up / Down / Home / End — operates in
// visual-line space so navigation steps one wrapped row at a time
// (matches every notes app / browser behaviour for soft-wrapped text).
//
// Inclusive on both ends of each line's range; an index that sits on a
// wrap or newline boundary belongs to the earlier line so the caret
// displays at the trailing edge rather than the start of the next line.
function lineColFor(lines: readonly LineLayout[], idx: number):
    { line: number; col: number }
{
    if (lines.length === 0) return { line: 0, col: 0 };
    for (let i = 0; i < lines.length; i++)
    {
        const line = lines[i]!;
        const end  = line.GlobalStart + line.Text.length;
        if (idx <= end)
        {
            return {
                line: i,
                col:  Math.max(0, Math.min(line.Text.length, idx - line.GlobalStart)),
            };
        }
    }
    // Overshoot: last line absorbs.
    const last = lines[lines.length - 1]!;
    return { line: lines.length - 1, col: last.Text.length };
}

// Inverse — character index from (visual line, column).
function indexFor(lines: readonly LineLayout[], line: number, col: number): number
{
    if (lines.length === 0) return 0;
    const target = lines[Math.max(0, Math.min(lines.length - 1, line))]!;
    return target.GlobalStart + Math.max(0, Math.min(target.Text.length, col));
}

// Nearest column whose leading edge minimizes |x − CharX[col]|. Linear
// scan; cost dwarfed by the substring measure cost above.
function colForX(line: LineLayout, x: number): number
{
    let bestCol  = 0;
    let bestDist = Math.abs((line.CharX[0] ?? 0) - x);
    for (let c = 1; c <= line.Text.length; c++)
    {
        const dist = Math.abs((line.CharX[c] ?? line.Metrics.Width) - x);
        if (dist < bestDist) { bestDist = dist; bestCol = c; }
    }
    return bestCol;
}

// Sum a Visual's ArrangedRect chain up to the surface root — returns the
// visual's absolute position in target-host coordinates. Same shape as
// ComboBox's absoluteOrigin helper.
function absoluteOrigin(v: Visual): { x: number; y: number }
{
    let x = 0;
    let y = 0;
    let cur: Visual | undefined = v;
    while (cur !== undefined)
    {
        x += cur.ArrangedRect.X;
        y += cur.ArrangedRect.Y;
        cur = cur.GetVisualParent();
    }
    return { x, y };
}

// ── TextBox ────────────────────────────────────────────────────────

// Multi-line text editor with selection + clipboard. The control owns
// the textual model (text, anchor, caret, selection); a templated
// TextEditorSurface child paints the result and the surrounding
// Border provides the focus-aware chrome.
//
// Public DPs:
//   Text             — the textual content (\n-separated lines).
//   AcceptsReturn    — when true, Enter inserts '\n'. When false, Enter
//                      is left unhandled so a parent (form submit, etc.)
//                      can act on it via bubble.
//   AcceptsTab       — when true, Tab inserts '\t'. When false, Tab
//                      bubbles so the host can move focus.
//   IsReadOnly       — when true, key / clipboard handlers ignore
//                      every mutation but selection still moves.
//   SelectionStart   — index of the selection's leftmost character.
//   SelectionLength  — non-negative length of the selection.
//   CaretIndex       — index where new text inserts. Equals
//                      SelectionStart when caret is at the start of
//                      the selection; SelectionStart + SelectionLength
//                      when at the end. Tracked separately from the
//                      derived SelectionStart / SelectionLength so the
//                      directionality of the user's drag survives.
//   FontFamily / FontSize / FontWeight / FontStyle / Foreground —
//                      same shape as TextBlock; inherited from
//                      ancestors via MetaData.Inherits.
//   CaretBrush       — colour of the blinking caret. Defaults to the
//                      Theme fieldText brush.
//   SelectionBrush   — colour of the selection background.
//
// Authoring:
//   TextBox[Text=$body, AcceptsReturn=true, Width=320, Height=200]
//
// The control takes focus on PointerDown, sets / extends selection on
// drag, edits via OnKeyDown (arrows / Backspace / Delete / Home / End /
// Ctrl+A / clipboard chord) and OnTextInput (printable characters).
// M3 text-field variant enum. Filled = filled-surface look (state-
// layer container, bottom underline); Outlined = stroked border on all
// four sides. Per WPF parity the enum lives next to the owner class so
// consumers can write `new TextBox(); tb.Variant = TextBoxVariant.Filled`
// without an extra import.
export enum TextBoxVariant
{
    Filled   = 'Filled',
    Outlined = 'Outlined',
    // Chrome-less field — no border / background / padding of its own.
    // For inline editors that supply their own frame: the editable
    // ComboBox embeds a Plain TextBox in its selection box, a SpinEdit
    // its value field, etc. The caret / selection / text still render.
    Plain    = 'Plain',
}

export class TextBox extends TemplatedControl
{
    // A binding can feed `Text` a non-string value — a PropertyGrid number /
    // color row binds its numeric `Value` straight at `TextBox.Text`. The
    // editor + layout code treats Text as a string (split, length,
    // FormattedText), so coerce any bound value to a string here: the single
    // point that enforces the DP's declared `string` type. Non-string in,
    // string out — nulls become the empty default.
    private static CoerceText(_model: MuralBase, value: unknown): string
    {
        if (typeof value === 'string')
        {
            return value;
        }
        return value === undefined || value === null ? '' : String(value);
    }

    public static readonly TextKey             = MuralBase.RegisterProperty<string>(           TextBox, 'Text',              '',                  MetaData.Measure | MetaData.BindsTwoWayByDefault, TextBox.CoerceText);
    public static readonly AcceptsReturnKey    = MuralBase.RegisterProperty<boolean>(          TextBox, 'AcceptsReturn',     false,               MetaData.Measure);
    // When true (with AcceptsReturn), a plain Return is left UNHANDLED — it
    // bubbles so an ancestor KeyDown trigger can treat it as "submit" — and
    // inserts no newline; Shift+Return still inserts '\n'. Lets a multiline
    // TextBox act as a chat composer (Enter sends, Shift+Enter newline).
    public static readonly SubmitsOnEnterKey   = MuralBase.RegisterProperty<boolean>(          TextBox, 'SubmitsOnEnter',    false,               MetaData.None);
    // Masked entry: layout + paint substitute MaskChar for every glyph while
    // Text keeps the true value (render-only; indices map 1:1). Cut/Copy are
    // suppressed so the secret never reaches the clipboard.
    public static readonly IsPasswordKey       = MuralBase.RegisterProperty<boolean>(          TextBox, 'IsPassword',        false,               MetaData.Measure | MetaData.Render);
    public static readonly AcceptsTabKey       = MuralBase.RegisterProperty<boolean>(          TextBox, 'AcceptsTab',        false,               MetaData.None);
    public static readonly IsReadOnlyKey       = MuralBase.RegisterProperty<boolean>(          TextBox, 'IsReadOnly',        false,               MetaData.None);
    // Wrap policy. Default Wrap matches the notes-app shape the demo
    // platform leans on; consumers wanting a code-editor feel set NoWrap
    // explicitly. Single-line TextBoxes (AcceptsReturn = false) ignore
    // this and force horizontal scrolling regardless.
    public static readonly TextWrappingKey     = MuralBase.RegisterProperty<TextWrapping>(     TextBox, 'TextWrapping',      TextWrapping.Wrap,   MetaData.Measure);
    // Pure read-mirrors of the internal (anchor, caret) model — TextBox
    // itself paints nothing, so flagging these Render-dirty would only
    // force the SVG renderer to pointlessly clear and repaint TextBox's
    // empty <g> on every keystroke. The actual re-render happens via the
    // explicit _editor.InvalidateVisual() call inside applySelection /
    // insertText / move*.
    public static readonly SelectionStartKey   = MuralBase.RegisterProperty<number>(           TextBox, 'SelectionStart',    0,                   MetaData.None);
    public static readonly SelectionLengthKey  = MuralBase.RegisterProperty<number>(           TextBox, 'SelectionLength',   0,                   MetaData.None);
    public static readonly CaretIndexKey       = MuralBase.RegisterProperty<number>(           TextBox, 'CaretIndex',        0,                   MetaData.None);
    public static readonly FontFamilyKey       = MuralBase.RegisterProperty<FontFamily>(       TextBox, 'FontFamily',        new FontFamily('system-ui, sans-serif'),
                                                                                                                                              MetaData.Measure | MetaData.Render | MetaData.Inherits);
    public static readonly FontSizeKey         = MuralBase.RegisterProperty<number>(           TextBox, 'FontSize',          14,                  MetaData.Measure | MetaData.Render | MetaData.Inherits);
    public static readonly FontWeightKey       = MuralBase.RegisterProperty<FontWeight>(       TextBox, 'FontWeight',        FontWeight.Normal,   MetaData.Measure | MetaData.Render | MetaData.Inherits);
    public static readonly FontStyleKey        = MuralBase.RegisterProperty<FontStyle>(        TextBox, 'FontStyle',         FontStyle.Normal,    MetaData.Measure | MetaData.Render | MetaData.Inherits);
    public static readonly TextDecorationsKey  = MuralBase.RegisterProperty<TextDecorations>(  TextBox, 'TextDecorations',   TextDecorations.None, MetaData.Render | MetaData.Inherits);
    public static readonly ForegroundKey       = MuralBase.RegisterProperty<Brush | undefined>(TextBox, 'Foreground',        undefined,           MetaData.Render  | MetaData.Inherits);
    public static readonly CaretBrushKey       = MuralBase.RegisterProperty<Brush | undefined>(TextBox, 'CaretBrush',        undefined,           MetaData.Render);
    public static readonly SelectionBrushKey   = MuralBase.RegisterProperty<Brush | undefined>(TextBox, 'SelectionBrush',    undefined,           MetaData.Render);
    // Prompt text painted (muted) when the box is empty; never contributes to
    // DesiredSize (Render-only), so it can't widen the field. PlaceholderBrush
    // falls back to Foreground when unset.
    public static readonly PlaceholderKey      = MuralBase.RegisterProperty<string>(           TextBox, 'Placeholder',       '',                  MetaData.Render);
    public static readonly PlaceholderBrushKey = MuralBase.RegisterProperty<Brush | undefined>(TextBox, 'PlaceholderBrush',  undefined,           MetaData.Render);
    // Edit through a real browser <input> instead of mural's painted editor
    // (single-line only; AcceptsReturn keeps the painted editor). The browser
    // then does the editing, so IME / dead keys, autofill and password
    // managers, mobile soft keyboards and assistive technology all work. Only
    // takes effect in a browser document (HtmlTarget); elsewhere (Node tests)
    // the painted editor stays. Off by default: existing apps are unchanged.
    public static readonly UsesNativeInputKey  = MuralBase.RegisterProperty<boolean>(          TextBox, 'UsesNativeInput',   false,               MetaData.Render);
    // What the text is for (email, username, current password, ...): sets the
    // native input's autocomplete token, type and on-screen keyboard. Read
    // only with UsesNativeInput.
    public static readonly InputPurposeKey     = MuralBase.RegisterProperty<InputPurpose>(     TextBox, 'InputPurpose',      InputPurpose.None,   MetaData.None);

    // M3 text-field variant - Filled (filled surface + bottom underline,
    // M3 spec default) and Outlined (1dp stroked border on all four
    // sides). mural defaults to Outlined despite M3 saying Filled,
    // because every pre-Phase-8.1 demo authored against the Outlined
    // chrome and the framework-side SpinEdit composes around an
    // Outlined-shaped inner TextBox (a Filled inner would clash with
    // the SpinEdit @Surface outer panel). Consumers opting in to the
    // M3 default write Variant = Filled explicitly.
    public static readonly VariantKey = MuralBase.RegisterProperty<TextBoxVariant>(
        TextBox, 'Variant', TextBoxVariant.Outlined, MetaData.None);

    public get Variant(): TextBoxVariant { return this.get_property_value(TextBox.VariantKey); }
    public set Variant(v: TextBoxVariant) { this.set_property_value(TextBox.VariantKey, v); }

    static
    {
        MuralBase.OverrideMetadata(TextBox, Element.DefaultStyleKeyKey, { default_value: TextBox });
    }

    // Override-able by tests / consumers: replace with an in-memory
    // sink so Ctrl+C / Ctrl+V can be exercised in Node without a
    // platform clipboard. Static so a single override affects every
    // TextBox instance in the process.
    public static Clipboard: ClipboardSink = DEFAULT_CLIPBOARD;

    // Bullet substituted for every glyph when IsPassword is true.
    public static readonly MaskChar: string = '•'

    // Template parts — resolved from the active TextBox template. Not
    // readonly: a Variant swap (Outlined → Plain, etc.) re-fires the Style
    // trigger, which swaps the Template DP and rebuilds the visual tree with
    // FRESH parts. adoptTemplateParts() re-resolves and re-wires them on every
    // rebuild — otherwise these would dangle at the old (torn-down) instance
    // and the new editor, never handed its `textBox` back-reference, would
    // measure to nothing (a zero-height, unclickable field).
    private _border!: Border;
    private _scroll!: ScrollViewer;
    private _editor!: TextEditorSurface;

    // Selection model — separated from the public DPs so we keep track
    // of the user's drag direction. _anchor stays put while _caret
    // moves; the derived SelectionStart / SelectionLength / CaretIndex
    // DPs are mirrored out at the end of each mutation.
    private _anchor: number = 0;
    private _caret:  number = 0;

    // Sticky preferred column for vertical arrow nav. When the user
    // moves down through a long line into a short line, then back up
    // into the long line, the caret returns to the original column.
    // Reset to undefined on any horizontal motion / editing op.
    private _preferredColumn: number | undefined;

    // Drag state — true while a pointer-down + drag is in progress so
    // OnPointerMove knows to extend selection. Captured / released via
    // the pointer-capture sink on PointerEventArgs.
    private _dragging = false;

    // Suppresses recursive DP write loops between the selection-state
    // setters and Mirror*() helpers. ComboBox uses the same pattern.
    private _suppressSelectionSync = false;

    // Caret blink phase. Toggled by a setInterval started in
    // OnGotFocus and cleared in OnLostFocus. Read by the editor's
    // RenderOverride.
    public CaretVisible: boolean = false;
    private _blinkTimer: ReturnType<typeof setInterval> | undefined;

    // The native <input> behind UsesNativeInput; created on first use in a
    // browser document and kept (hidden while inactive) for the control's life.
    private _native: NativeTextInput | undefined;

    constructor()
    {
        super();
        this.Focusable = true;

        // applyDefaultStyle resolves Style[TargetType=TextBox] from the
        // active theme dictionary → writes Template DP → TemplatedControl's
        // rebuildTemplate materialises the variant template and attaches root.
        // rebuildTemplate() (overridden below) runs adoptTemplateParts() as
        // part of that stamp, so _border / _scroll / _editor are wired here.
        this.applyDefaultStyle();

        // Border focus / hover chrome rides declarative triggers in
        // the DefaultTextBox template — `when(IsMouseOver)` swaps to
        // @OnSurface, `when(IsFocused)` swaps to @Primary, both via
        // DynamicResource so theme switches re-tint live. No imperative
        // refresh hook on this side.

        // Wire the host ScrollViewer's per-axis enable flags against
        // TextWrapping + AcceptsReturn:
        //   * Single-line (AcceptsReturn=false) → horizontal scroll on,
        //     vertical off (one row, can't grow downward).
        //   * Multi-line Wrap     → horizontal scroll off (editor wraps
        //     to width), vertical on.
        //   * Multi-line NoWrap   → both axes on (code-editor scroll).
        // The initial call runs inside adoptTemplateParts (it configures the
        // current _scroll); these listeners re-run it on later changes.
        this.PropertyChanged(TextBox.TextWrappingKey).subscribe(  () => this.refreshScrollAxes());
        this.PropertyChanged(TextBox.AcceptsReturnKey).subscribe( () => this.refreshScrollAxes());

        // Foreground / CaretBrush / SelectionBrush are painted by the
        // editor surface, not by TextBox itself, and they're Render-only
        // (no Measure). A DynamicResource-driven change — e.g. the
        // Style[TextBox] @OnSurface re-resolving on a theme / scheme swap
        // — updates the DP but marks only TextBox's own (empty) visual
        // render-dirty, so the editor keeps the stale colour. Forward
        // these to the editor so a live scheme switch re-tints the text
        // immediately (same hand-rolled invalidation the Text setter uses).
        const repaintEditor = (): void => this._editor?.InvalidateVisual();
        this.PropertyChanged(TextBox.ForegroundKey).subscribe(       repaintEditor);
        this.PropertyChanged(TextBox.CaretBrushKey).subscribe(       repaintEditor);
        this.PropertyChanged(TextBox.SelectionBrushKey).subscribe(   repaintEditor);
        this.PropertyChanged(TextBox.PlaceholderKey).subscribe(      repaintEditor);
        this.PropertyChanged(TextBox.PlaceholderBrushKey).subscribe( repaintEditor);

        // Repaint on ANY Text change — including binding / VM-driven writes that
        // bypass the `set Text` accessor (where the explicit editor invalidation
        // otherwise lives). Without this a two-way-bound TextBox cleared from its
        // view-model updates the DP but keeps painting the old glyphs. The direct
        // edit paths (set Text / insertText / replaceRange) also invalidate
        // explicitly; the extra call here is idempotent.
        // Guarded: a binding / VM-driven Text write can land while the TextBox is being stamped inside a
        // DataTemplate (ContentPresenter slotting), before adoptTemplateParts has wired PART_Editor. The
        // template stamp re-invalidates the editor (see adoptTemplateParts), so skipping here is safe.
        this.PropertyChanged(TextBox.TextKey).subscribe(() => {
            this._editor?.InvalidateMeasure();
            this._editor?.InvalidateVisual();
        });

        // Keep the native input (when there is one) in step with every
        // property it mirrors; switching UsesNativeInput / AcceptsReturn also
        // repaints the editor, which paints itself only while the input is off.
        const syncNative = (): void => this._native?.Sync(this.IsNativeInputActive);
        for (const key of [TextBox.TextKey, TextBox.IsPasswordKey, TextBox.InputPurposeKey, TextBox.PlaceholderKey,
            TextBox.PlaceholderBrushKey, TextBox.IsReadOnlyKey, TextBox.FontFamilyKey, TextBox.FontSizeKey,
            TextBox.FontWeightKey, TextBox.FontStyleKey, TextBox.ForegroundKey, TextBox.CaretBrushKey, Element.IsEnabledKey,
            Element.IsHitTestVisibleKey])
        {
            this.PropertyChanged(key).subscribe(syncNative);
        }
        for (const key of [TextBox.UsesNativeInputKey, TextBox.AcceptsReturnKey])
        {
            this.PropertyChanged(key).subscribe(() =>
            {
                syncNative();
                this._editor?.InvalidateVisual();
            });
        }
    }

    public get UsesNativeInput(): boolean { return this.get_property_value(TextBox.UsesNativeInputKey); }
    public set UsesNativeInput(v: boolean) { this.set_property_value(TextBox.UsesNativeInputKey, v); }

    public get InputPurpose(): InputPurpose { return this.get_property_value(TextBox.InputPurposeKey); }
    public set InputPurpose(v: InputPurpose) { this.set_property_value(TextBox.InputPurposeKey, v); }

    // True while the native input edits this TextBox: UsesNativeInput on a
    // single-line box in a browser document.
    public get IsNativeInputActive(): boolean
    {
        return this.UsesNativeInput && !this.AcceptsReturn && this.NativeDocument() !== undefined;
    }

    // The native <input> the editor surface hosts; undefined until the
    // TextBox first becomes native-input active (then kept, hidden when off).
    public get NativeInputElement(): HTMLElement | undefined
    {
        if (this._native === undefined && this.IsNativeInputActive)
        {
            this._native = new NativeTextInput(this, this.NativeDocument()!);
        }
        return this._native?.Element;
    }

    // Document the native input is created in (as DomHost.OwnerDocument):
    // defaults to the ambient browser document; tests and off-screen hosts
    // assign one before the TextBox first becomes native-input active.
    public OwnerDocument: Document | undefined;

    private NativeDocument(): Document | undefined
    {
        return this.OwnerDocument ?? (globalThis as { document?: Document }).document;
    }

    // Re-resolve and re-wire the template parts against the CURRENT template
    // instance. Runs on every template stamp — the first (from
    // applyDefaultStyle in the ctor) and every later one (a Variant swap
    // rebuilds the tree with fresh parts). Without the re-wire on swap, the
    // new TextEditorSurface never receives its `textBox` back-reference and
    // measures to zero — the field renders no text and can't be clicked into.
    private adoptTemplateParts(): void
    {
        this._border = this.templateRoot as Border;
        this._scroll = this.GetTemplateChild('PART_Scroll') as ScrollViewer;
        this._editor = this.GetTemplateChild('PART_Editor') as TextEditorSurface;
        this._editor.textBox = this;
        // Configure the (possibly brand-new) scroll host.
        this.refreshScrollAxes();
        // TextBoxes use the macOS / native-app convention: scrollbars hidden
        // by default, appearing only while scrolling. Discoverability isn't an
        // issue (the user typed the text, they know it's there); a persistent
        // gutter would only steal pixels from already-tight input fields.
        this._scroll.IsAutoHideScrollBars = true;
        // The freshly-wired editor must (re)measure now that it can read the
        // model text through its back-reference.
        this._editor.InvalidateMeasure();
        this._editor.InvalidateVisual();
    }

    // Re-adopt parts after the base rebuilds the template subtree. Fires on
    // the initial stamp and on every Variant-driven Template swap.
    protected override rebuildTemplate(): void
    {
        super.rebuildTemplate();
        this.adoptTemplateParts();
    }

    private refreshScrollAxes(): void
    {
        const multiline = this.AcceptsReturn;
        const wrap      = multiline && this.TextWrapping === TextWrapping.Wrap;
        // Per-axis enable rules:
        //   * single-line       → both axes disabled. The bar would
        //                         clutter a field-shaped input; native
        //                         `<input>` never shows one either.
        //                         HorizontalOffset is still writable
        //                         so caret-into-view scrolls the text
        //                         invisibly as the user types past the
        //                         viewport edge.
        //   * multi-line Wrap   → vertical only; the editor wraps to
        //                         width so horizontal scroll is moot.
        //   * multi-line NoWrap → both axes; code-editor feel.
        // Guarded: TextWrapping / AcceptsReturn can change before PART_Scroll is wired (pre-template stamp);
        // adoptTemplateParts calls this again once the scroll host exists.
        if (this._scroll === undefined) return;
        this._scroll.HorizontalScrollEnabled = multiline && !wrap;
        this._scroll.VerticalScrollEnabled   = multiline;
    }

    // Pan the host ScrollViewer so the caret rect is on-screen. Called
    // after every typed character, deletion, paste, arrow, click, drag,
    // and programmatic selection / caret write — basically any path that
    // moves `_caret`. Deferred via microtask so the editor's measure
    // pass has already refreshed `_lines` (and therefore `PositionFor`)
    // before we read it; calling synchronously would scroll against the
    // pre-mutation layout and lag by one frame.
    //
    // Idempotent: when the caret is already inside the viewport,
    // ScrollIntoView is a no-op (no Offset DP write, no extra Flush
    // scheduled).
    private _caretIntoViewQueued = false;
    private bringCaretIntoView(): void
    {
        if (this._caretIntoViewQueued) return;
        this._caretIntoViewQueued = true;
        queueMicrotask(() => {
            this._caretIntoViewQueued = false;
            if (this._editor === undefined || this._scroll === undefined) return;   // not stamped yet
            const lineH = this._editor.LineHeight;
            if (lineH === 0) return;     // editor hasn't measured yet
            const pos = this._editor.PositionFor(this._caret);
            this._scroll.ScrollIntoView(new Rect(pos.X, pos.Y, 1, lineH));
        });
    }

    // ── Public DPs ─────────────────────────────────────────────────

    public get Text(): string { return this.get_property_value(TextBox.TextKey); }
    public set Text(value: string)
    {
        const old = this.Text;
        if (old === value) return;
        this.set_property_value(TextBox.TextKey, value);
        // Clamp selection to the new text length. A consumer who set
        // Text = 'short' while a caret was at position 99 would
        // otherwise end up with an out-of-range caret. Read the value
        // BACK from the DP: `value` may be a non-string (a binding can
        // deliver a number / null), which the Text DP's coerce normalises
        // to a string — measure the clamp against that, never the raw input.
        const max = this.Text.length;
        this._anchor = Math.min(this._anchor, max);
        this._caret  = Math.min(this._caret,  max);
        this._preferredColumn = undefined;
        this.mirrorSelectionDPs();
        // Both invalidations matter: Measure rebuilds the per-line
        // CharX cache against the new content; Visual is what actually
        // adds the editor to renderDirty so the SVG renderer's walk
        // hits `repaintOwn` on this pass. Without the Visual call the
        // editor sits at the new measure but stays painted with the
        // old glyphs until something else (the 500ms caret-blink tick)
        // marks it render-dirty — perceived as a multi-frame typing lag.
        this._editor?.InvalidateMeasure();
        this._editor?.InvalidateVisual();
    }

    public get AcceptsReturn(): boolean { return this.get_property_value(TextBox.AcceptsReturnKey); }
    public set AcceptsReturn(v: boolean) { this.set_property_value(TextBox.AcceptsReturnKey, v); }

    public get SubmitsOnEnter(): boolean { return this.get_property_value(TextBox.SubmitsOnEnterKey); }
    public set SubmitsOnEnter(v: boolean) { this.set_property_value(TextBox.SubmitsOnEnterKey, v); }

    public get IsPassword(): boolean { return this.get_property_value(TextBox.IsPasswordKey); }
    public set IsPassword(v: boolean)
    {
        this.set_property_value(TextBox.IsPasswordKey, v);
        this._editor?.InvalidateMeasure();
        this._editor?.InvalidateVisual();
    }

    /** The string the editor surface lays out and paints: MaskChar x Text.length
     *  in password mode (same length as Text, so every index stays valid),
     *  otherwise Text itself. */
    public get DisplayText(): string
    {
        const text = this.Text ?? '';
        return this.IsPassword ? TextBox.MaskChar.repeat(text.length) : text;
    }

    public get AcceptsTab(): boolean { return this.get_property_value(TextBox.AcceptsTabKey); }
    public set AcceptsTab(v: boolean) { this.set_property_value(TextBox.AcceptsTabKey, v); }

    public get IsReadOnly(): boolean { return this.get_property_value(TextBox.IsReadOnlyKey); }
    public set IsReadOnly(v: boolean) { this.set_property_value(TextBox.IsReadOnlyKey, v); }

    // Soft-wrap policy. When `Wrap`, long lines break at word boundaries
    // (and char-wrap as a fallback for an over-wide single word) so the
    // editor never overflows horizontally. When `NoWrap`, long lines
    // extend past the viewport and the host ScrollViewer scrolls them
    // into view. Forced to NoWrap-like behaviour for single-line
    // TextBoxes (see effectiveWrapping()).
    public get TextWrapping(): TextWrapping { return this.get_property_value(TextBox.TextWrappingKey); }
    public set TextWrapping(v: TextWrapping) { this.set_property_value(TextBox.TextWrappingKey, v); }

    public get SelectionStart():  number { return this.get_property_value(TextBox.SelectionStartKey);  }
    public set SelectionStart(v:  number) { this.applySelection(v, this.SelectionLength); }

    public get SelectionLength(): number { return this.get_property_value(TextBox.SelectionLengthKey); }
    public set SelectionLength(v: number) { this.applySelection(this.SelectionStart, v); }

    public get CaretIndex(): number { return this.get_property_value(TextBox.CaretIndexKey); }
    public set CaretIndex(v: number) { this.applyCaret(v); }

    public get FontFamily(): FontFamily { return FontFamily.from(this.get_property_value(TextBox.FontFamilyKey)); }
    public set FontFamily(v: FontFamily | string) { this.set_property_value(TextBox.FontFamilyKey, FontFamily.from(v)); }
    public get FontSize(): number { return this.get_property_value(TextBox.FontSizeKey); }
    public set FontSize(v: number) { this.set_property_value(TextBox.FontSizeKey, v); }
    public get FontWeight(): FontWeight { return this.get_property_value(TextBox.FontWeightKey); }
    public set FontWeight(v: FontWeight) { this.set_property_value(TextBox.FontWeightKey, v); }
    public get FontStyle(): FontStyle { return this.get_property_value(TextBox.FontStyleKey); }
    public set FontStyle(v: FontStyle) { this.set_property_value(TextBox.FontStyleKey, v); }
    public get TextDecorations(): TextDecorations { return this.get_property_value(TextBox.TextDecorationsKey); }
    public set TextDecorations(v: TextDecorations) { this.set_property_value(TextBox.TextDecorationsKey, v); }
    public get Foreground(): Brush | undefined { return this.get_property_value(TextBox.ForegroundKey); }
    public set Foreground(v: Brush | undefined) { this.set_property_value(TextBox.ForegroundKey, v); }

    public get Placeholder(): string { return this.get_property_value(TextBox.PlaceholderKey); }
    public set Placeholder(v: string) { this.set_property_value(TextBox.PlaceholderKey, v); }

    public get PlaceholderBrush(): Brush | undefined { return this.get_property_value(TextBox.PlaceholderBrushKey); }
    public set PlaceholderBrush(v: Brush | undefined) { this.set_property_value(TextBox.PlaceholderBrushKey, v); }
    public get CaretBrush(): Brush | undefined { return this.get_property_value(TextBox.CaretBrushKey); }
    public set CaretBrush(v: Brush | undefined) { this.set_property_value(TextBox.CaretBrushKey, v); }
    public get SelectionBrush(): Brush | undefined { return this.get_property_value(TextBox.SelectionBrushKey); }
    public set SelectionBrush(v: Brush | undefined) { this.set_property_value(TextBox.SelectionBrushKey, v); }

    // ── Public selection API ──────────────────────────────────────

    public Select(start: number, length: number): void
    {
        this.applySelection(start, length);
    }

    public SelectAll(): void
    {
        this._anchor = 0;
        this._caret  = this.Text.length;
        this._preferredColumn = undefined;
        this.mirrorSelectionDPs();
        this._editor?.InvalidateVisual();
    }

    // Composite controls (SpinEdit and friends) embed a TextBox as a
    // template part and want to hide its outer chrome — they paint
    // their own surrounding Border instead. This getter grants those
    // composers access to the internal PART_Border so they can flip
    // BorderThickness to zero (or restyle it) without going through
    // FindName from outside the TextBox's NameScope. Same shape as
    // ScrollBar.Track / ScrollBar.Thumb.
    public get InnerBorder(): Border { return this._border; }

    // visualChildren / propagate_target_to_visual_children /
    // MeasureOverride / ArrangeOverride / RenderOverride all inherited
    // from TemplatedControl — they delegate to templateRoot (the outer
    // PART_Border).

    // ── Input handling ─────────────────────────────────────────────

    protected override OnPointerDown(args: PointerEventArgs): void
    {
        if (this.IsNativeInputActive) return;   // the native input owns pointer editing
        // Take focus + capture so the drag-extends-selection flow works
        // even when the pointer wanders outside the editor's bounds.
        args.SetFocus(this);
        args.CapturePointer(this);

        const idx = this.indexAtPointer(args);
        if (hasModifier(args.Modifiers, ModifierKeys.Shift))
        {
            // Shift+click extends selection from the existing anchor.
            this._caret = idx;
        }
        else
        {
            this._anchor = idx;
            this._caret  = idx;
        }
        this._preferredColumn = undefined;
        this._dragging = true;
        this.mirrorSelectionDPs();
        this._editor.InvalidateVisual();
        args.Handled = true;
    }

    protected override OnPointerMove(args: PointerEventArgs): void
    {
        if (!this._dragging || this.IsNativeInputActive) return;
        const idx = this.indexAtPointer(args);
        if (idx === this._caret) return;
        this._caret = idx;
        this._preferredColumn = undefined;
        this.mirrorSelectionDPs();
        this._editor.InvalidateVisual();
        args.Handled = true;
    }

    protected override OnPointerUp(args: PointerEventArgs): void
    {
        if (!this._dragging) return;
        this._dragging = false;
        args.ReleasePointerCapture();
        args.Handled = true;
    }

    protected override OnGotFocus(_args: FocusEventArgs): void
    {
        if (this.IsNativeInputActive)
        {
            // mural focus arrived some other way (Tab, code): hand it to the
            // input, creating it if the first paint has not happened yet (the
            // input then takes focus once it is attached).
            if (this.NativeInputElement !== undefined)
            {
                this._native?.Focus();
            }
            return;
        }
        this.CaretVisible = true;
        this.startBlink();
        this._editor.InvalidateVisual();
    }

    protected override OnLostFocus(_args: FocusEventArgs): void
    {
        this._native?.Blur();
        this.CaretVisible = false;
        this.stopBlink();
        this._dragging = false;
        this._editor.InvalidateVisual();
    }

    protected override OnKeyDown(args: KeyEventArgs): void
    {
        // The native input edits; only Enter / Escape reach here, left
        // unhandled so they bubble (submit triggers and the like).
        if (this.IsNativeInputActive) return;
        const mods   = args.Modifiers;
        const shift  = hasModifier(mods, ModifierKeys.Shift);
        const ctrl   = hasModifier(mods, ModifierKeys.Control)
                    || hasModifier(mods, ModifierKeys.Windows);   // Cmd on macOS, Ctrl elsewhere

        switch (args.Key)
        {
            case Key.Left:
                this.moveHorizontal(-1, shift, ctrl);
                args.Handled = true; return;
            case Key.Right:
                this.moveHorizontal(+1, shift, ctrl);
                args.Handled = true; return;
            case Key.Up:
                this.moveVertical(-1, shift);
                args.Handled = true; return;
            case Key.Down:
                this.moveVertical(+1, shift);
                args.Handled = true; return;
            case Key.Home:
                this.moveLineEdge('start', shift, ctrl);
                args.Handled = true; return;
            case Key.End:
                this.moveLineEdge('end', shift, ctrl);
                args.Handled = true; return;
            case Key.Back:
                if (!this.IsReadOnly) this.deleteBefore();
                args.Handled = true; return;
            case Key.Delete:
                if (!this.IsReadOnly) this.deleteAfter();
                args.Handled = true; return;
            case Key.Return:
                if (this.AcceptsReturn && !this.IsReadOnly)
                {
                    // Composer mode: plain Return bubbles (no newline) so an
                    // ancestor submit trigger can send; Shift+Return newlines.
                    if (this.SubmitsOnEnter && !shift) return;
                    this.insertText('\n');
                    args.Handled = true;
                }
                return;
            case Key.Tab:
                if (this.AcceptsTab && !this.IsReadOnly)
                {
                    this.insertText('\t');
                    args.Handled = true;
                }
                return;
        }

        // Ctrl chord — clipboard + select-all. `ctrl` already folds in
        // Cmd on macOS.
        if (ctrl)
        {
            const k = args.Key;
            if (k === Key.A) { this.SelectAll(); args.Handled = true; return; }
            if (k === Key.C) { void this.copyToClipboard(); args.Handled = true; return; }
            if (k === Key.X)
            {
                if (!this.IsReadOnly) { void this.cutToClipboard(); }
                else { void this.copyToClipboard(); }
                args.Handled = true; return;
            }
            if (k === Key.V)
            {
                if (!this.IsReadOnly) void this.pasteFromClipboard();
                args.Handled = true; return;
            }
        }
    }

    protected override OnTextInput(args: TextInputEventArgs): void
    {
        if (this.IsReadOnly || this.IsNativeInputActive) return;
        if (args.Text.length === 0) return;
        this.insertText(args.Text);
        args.Handled = true;
    }

    // ── Editing primitives ─────────────────────────────────────────

    private indexAtPointer(args: PointerEventArgs): number
    {
        const origin = absoluteOrigin(this._editor);
        const localX = args.HostX - origin.x;
        const localY = args.HostY - origin.y;
        return this._editor.IndexAt(localX, localY);
    }

    // Insert `text` at the caret (or replace the current selection).
    // Always called via the keyboard / text-input paths; clamped at the
    // top of the routing so OnTextInput can stay simple.
    private insertText(text: string): void
    {
        const [start, end] = this.selectionRange();
        const before = this.Text.substring(0, start);
        const after  = this.Text.substring(end);
        const next   = before + text + after;
        const caretAfter = start + text.length;
        this.set_property_value(TextBox.TextKey, next);
        this._anchor = caretAfter;
        this._caret  = caretAfter;
        this._preferredColumn = undefined;
        this.mirrorSelectionDPs();
        // Measure rebuilds CharX, Visual is what actually triggers
        // repaint on this Flush. See the `set Text` setter for the
        // longer rationale; without the Visual call the typed glyph
        // doesn't appear until the next caret-blink tick.
        this._editor.InvalidateMeasure();
        this._editor.InvalidateVisual();
    }

    private deleteBefore(): void
    {
        const [start, end] = this.selectionRange();
        if (start < end)
        {
            this.replaceRange(start, end, '');
            return;
        }
        if (start === 0) return;
        this.replaceRange(start - 1, start, '');
    }

    private deleteAfter(): void
    {
        const [start, end] = this.selectionRange();
        if (start < end)
        {
            this.replaceRange(start, end, '');
            return;
        }
        if (end >= this.Text.length) return;
        this.replaceRange(end, end + 1, '');
    }

    private replaceRange(start: number, end: number, replacement: string): void
    {
        const before = this.Text.substring(0, start);
        const after  = this.Text.substring(end);
        this.set_property_value(TextBox.TextKey, before + replacement + after);
        const caretAfter = start + replacement.length;
        this._anchor = caretAfter;
        this._caret  = caretAfter;
        this._preferredColumn = undefined;
        this.mirrorSelectionDPs();
        // See `set Text` — both invalidations needed; the Visual one is
        // what gets the editor into renderDirty for the post-keydown
        // Flush so deleting / pasting paints on the same frame.
        this._editor.InvalidateMeasure();
        this._editor.InvalidateVisual();
    }

    // ── Navigation ─────────────────────────────────────────────────

    private moveHorizontal(direction: -1 | 1, extend: boolean, byWord: boolean): void
    {
        // Plain (non-extend) arrow when selection is non-collapsed
        // collapses TO the edge, not by one — Windows / WPF semantics.
        const [start, end] = this.selectionRange();
        if (!extend && start < end)
        {
            const collapsed = direction < 0 ? start : end;
            this._anchor = collapsed;
            this._caret  = collapsed;
            this._preferredColumn = undefined;
            this.mirrorSelectionDPs();
            this._editor.InvalidateVisual();
            return;
        }

        const nextRaw = byWord
            ? this.nextWordBoundary(this._caret, direction)
            : this._caret + direction;
        const next = Math.max(0, Math.min(this.Text.length, nextRaw));
        if (next === this._caret) return;
        this._caret = next;
        if (!extend) this._anchor = next;
        this._preferredColumn = undefined;
        this.mirrorSelectionDPs();
        this._editor.InvalidateVisual();
    }

    private moveVertical(direction: -1 | 1, extend: boolean): void
    {
        const lines = this._editor.Lines;
        if (lines.length === 0) return;
        const { line, col } = lineColFor(lines, this._caret);
        const targetLine = line + direction;
        if (targetLine < 0 || targetLine >= lines.length)
        {
            // Moving off the first / last line collapses to text edge.
            const collapsed = direction < 0 ? 0 : this.Text.length;
            this._caret = collapsed;
            if (!extend) this._anchor = collapsed;
            this.mirrorSelectionDPs();
            this._editor.InvalidateVisual();
            return;
        }
        const preferred = this._preferredColumn ?? col;
        this._preferredColumn = preferred;
        const targetCol = Math.min(preferred, lines[targetLine]!.Text.length);
        const next = indexFor(lines, targetLine, targetCol);
        this._caret = next;
        if (!extend) this._anchor = next;
        this.mirrorSelectionDPs();
        this._editor.InvalidateVisual();
    }

    private moveLineEdge(edge: 'start' | 'end', extend: boolean, wholeText: boolean): void
    {
        const lines = this._editor.Lines;
        if (lines.length === 0) return;
        let next: number;
        if (wholeText)
        {
            next = edge === 'start' ? 0 : this.Text.length;
        }
        else
        {
            const { line } = lineColFor(lines, this._caret);
            next = edge === 'start'
                ? indexFor(lines, line, 0)
                : indexFor(lines, line, lines[line]!.Text.length);
        }
        this._caret = next;
        if (!extend) this._anchor = next;
        this._preferredColumn = undefined;
        this.mirrorSelectionDPs();
        this._editor.InvalidateVisual();
    }

    // Word-break for Ctrl+ArrowLeft / Right. Skips a run of whitespace
    // then a run of non-whitespace (going right), or the symmetric
    // pattern going left. Matches the Windows / Linux convention; macOS
    // Option+Arrow is similar.
    private nextWordBoundary(from: number, direction: -1 | 1): number
    {
        // Masked text must not leak word structure through Ctrl+Arrow.
        if (this.IsPassword) return direction > 0 ? this.Text.length : 0;
        const text = this.Text;
        if (direction > 0)
        {
            let i = from;
            // Skip current-position whitespace.
            while (i < text.length && isWordSep(text[i]!)) i++;
            // Skip non-whitespace run.
            while (i < text.length && !isWordSep(text[i]!)) i++;
            return i;
        }
        else
        {
            let i = from;
            // Step back past prior whitespace.
            while (i > 0 && isWordSep(text[i - 1]!)) i--;
            // Step back through word characters.
            while (i > 0 && !isWordSep(text[i - 1]!)) i--;
            return i;
        }
    }

    // ── Clipboard ──────────────────────────────────────────────────

    private async copyToClipboard(): Promise<void>
    {
        if (this.IsPassword) return;
        const [start, end] = this.selectionRange();
        if (start === end) return;
        await TextBox.Clipboard.Write(this.Text.substring(start, end));
    }

    private async cutToClipboard(): Promise<void>
    {
        // Password mode: never place the secret on the clipboard (and do not
        // delete it either, so Ctrl+X is a full no-op).
        if (this.IsPassword) return;
        const [start, end] = this.selectionRange();
        if (start === end) return;
        // Capture + delete are SYNCHRONOUS so the text model settles
        // before the keydown handler returns; the clipboard write
        // fires off as a fire-and-forget tail. Reversing the order
        // (await first, then delete) would leave the text intact
        // until the next microtask — observable to any code that
        // checks `tb.Text` immediately after the keypress.
        const captured = this.Text.substring(start, end);
        this.replaceRange(start, end, '');
        await TextBox.Clipboard.Write(captured);
    }

    private async pasteFromClipboard(): Promise<void>
    {
        const text = await TextBox.Clipboard.Read();
        if (text.length === 0) return;
        const [start, end] = this.selectionRange();
        this.replaceRange(start, end, text);
    }

    // ── Selection helpers ──────────────────────────────────────────

    private selectionRange(): [number, number]
    {
        return this._anchor <= this._caret
            ? [this._anchor, this._caret]
            : [this._caret,  this._anchor];
    }

    // Coerce SelectionStart / SelectionLength writes into the
    // anchor / caret model. Clamped to text bounds; out-of-range writes
    // normalise rather than throwing.
    private applySelection(start: number, length: number): void
    {
        if (this._suppressSelectionSync) return;
        const max  = this.Text.length;
        const s    = Math.max(0, Math.min(max, start));
        const ln   = Math.max(0, Math.min(max - s, length));
        this._anchor = s;
        this._caret  = s + ln;
        this._preferredColumn = undefined;
        this.mirrorSelectionDPs();
        this._editor?.InvalidateVisual();
    }

    private applyCaret(idx: number): void
    {
        if (this._suppressSelectionSync) return;
        const c = Math.max(0, Math.min(this.Text.length, idx));
        this._anchor = c;
        this._caret  = c;
        this._preferredColumn = undefined;
        this.mirrorSelectionDPs();
        this._editor?.InvalidateVisual();
    }

    // Push the internal anchor / caret out to the public DPs so
    // bindings (status bar showing line: col, etc) see the change.
    // Wrapped in the suppress guard so the resulting set_property_value
    // calls don't recurse back through the public setters.
    //
    // Also schedules caret-into-view via the queued microtask hook.
    // Every caret-moving path in TextBox flows through this helper
    // (typing, deletion, navigation, click, drag-select, programmatic
    // SelectionStart / CaretIndex writes) — so centralising the scroll
    // hook here covers them all without scattering bringCaretIntoView
    // calls at each individual mutation site.
    private mirrorSelectionDPs(): void
    {
        this._suppressSelectionSync = true;
        const [s, e] = this.selectionRange();
        this.set_property_value(TextBox.SelectionStartKey,  s);
        this.set_property_value(TextBox.SelectionLengthKey, e - s);
        this.set_property_value(TextBox.CaretIndexKey,      this._caret);
        this._suppressSelectionSync = false;
        // A selection set from code (Select / SelectAll / CaretIndex) reaches
        // the native input; the input's own reports are not echoed back.
        if (this.IsNativeInputActive)
        {
            this._native?.SetSelection(s, e);
        }
        this.bringCaretIntoView();
    }

    // ── Caret blink ────────────────────────────────────────────────

    private startBlink(): void
    {
        if (this._blinkTimer !== undefined) return;
        const timer = setInterval(() => {
            this.CaretVisible = !this.CaretVisible;
            this._editor.InvalidateVisual();
        }, 500);
        // Unref the timer so a stray TextBox doesn't keep a Node test
        // process alive past its assertions. setInterval in the browser
        // doesn't have unref; the optional chain skips it there.
        const tHandle = timer as unknown as { unref?: () => void };
        tHandle.unref?.();
        this._blinkTimer = timer;
    }

    private stopBlink(): void
    {
        if (this._blinkTimer === undefined) return;
        clearInterval(this._blinkTimer);
        this._blinkTimer = undefined;
    }
}

// ── Local helpers ──────────────────────────────────────────────────

// Whitespace test for word-break navigation. Treats every Unicode
// whitespace + a few common punctuation glyphs as a word separator —
// matches what most desktop editors do for Ctrl+Arrow.
function isWordSep(ch: string): boolean
{
    if (ch === ' ' || ch === '\t' || ch === '\n') return true;
    if (ch === '.' || ch === ',' || ch === ';' || ch === ':') return true;
    if (ch === '(' || ch === ')' || ch === '[' || ch === ']' || ch === '{' || ch === '}') return true;
    if (ch === '"' || ch === "'") return true;
    return false;
}
