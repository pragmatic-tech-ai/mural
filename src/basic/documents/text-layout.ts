import { Brush, FontFamily, FormattedText, type ImageSource, type Stretch, TextAlignment, type TextMetrics } from '../../visual-engine/index.js';
import { Point, Rect, Visual, type DrawingContext } from '../../runtime/index.js';
import { Inline, type LinkTarget, type RunProps } from './text-element.js';
import { Run, Span, LineBreak, InlineUIContainer, ImageInline, ImageDisplay } from './inlines.js';

// ─────────────────────────────────────────────────────────────────────
// Flatten + line layout for the inline content model. The mural analog of
// WPF's TextSource → TextFormatter → TextLine pipeline: the inline tree is
// flattened into an ordered stream of styled runs / breaks / embedded
// objects (each carrying its fully-resolved RunProps), then broken into
// lines of positioned fragments with per-run baseline stacking.

// ── Flatten ──────────────────────────────────────────────────────────

export type FlowItem =
    | { kind: 'text';   text: string; props: RunProps; source: Inline }
    | { kind: 'break' }
    | { kind: 'object'; visual: Visual; source: Inline }
    | { kind: 'image';  image: ImageSource; width: number; height: number; stretch: Stretch; display: ImageDisplay; source: Inline };

// Flatten the inline tree into a flow stream. `base` is the hosting
// TextBlock's own resolved format; each Span overrides it for its subtree.
export function flattenInlines(inlines: readonly Inline[], base: RunProps): FlowItem[]
{
    const out: FlowItem[] = [];
    walk(inlines, base, out);
    return out;
}

// Fold one inline's own (set) character-format DPs onto the inherited
// context, returning a fresh context. Font DPs override; TextDecorations
// accumulate; `applyToContext` lets a Hyperlink add its link target +
// chrome. Shared by Run (a normalised editor run styles itself directly)
// and Span (styles its whole subtree) so both honour element-level format
// through ONE code path.
function foldInlineFormat(ctx: RunProps, el: Inline): RunProps
{
    const c: RunProps = { ...ctx };
    if (el.FontFamily !== undefined) c.family     = FontFamily.from(el.FontFamily).Source;
    if (el.FontSize   !== undefined) c.size       = el.FontSize;
    if (el.FontWeight !== undefined) c.weight     = el.FontWeight;
    if (el.FontStyle  !== undefined) c.style      = el.FontStyle;
    if (el.Foreground !== undefined) c.foreground = el.Foreground;
    c.decorations |= el.TextDecorations;
    el.applyToContext(c);   // Hyperlink: link target + underline
    return c;
}

function walk(inlines: readonly Inline[], ctx: RunProps, out: FlowItem[]): void
{
    for (const el of inlines)
    {
        if (el instanceof Run)
        {
            // A Run carries its own format DPs (the editor normalises each
            // styled span to a self-styled Run). Fold them so Bold / Italic /
            // Underline set on the Run actually paint.
            if (el.Text.length > 0) out.push({ kind: 'text', text: el.Text, props: foldInlineFormat(ctx, el), source: el });
        }
        else if (el instanceof LineBreak)
        {
            out.push({ kind: 'break' });
        }
        else if (el instanceof InlineUIContainer)
        {
            const child = el.Child;
            if (child !== undefined) out.push({ kind: 'object', visual: child, source: el });
        }
        else if (el instanceof ImageInline)
        {
            const src = el.Source;
            if (src !== undefined)
                out.push({ kind: 'image', image: src, width: el.LayoutWidth, height: el.LayoutHeight, stretch: el.Stretch, display: el.Display, source: el });
        }
        else if (el instanceof Span)
        {
            walk(el.Inlines.ToArray(), foldInlineFormat(ctx, el), out);
        }
        // Unknown inline kinds are ignored (forward-compat).
    }
}

// ── Line layout ──────────────────────────────────────────────────────

export type MeasureText   = (text: string, props: RunProps) => TextMetrics;
// `baseline` (optional) is the object's OWN text baseline measured from its top
// — when present, the object is baseline-aligned (its text baseline sits on the
// line baseline, so a padded chip extends BELOW the text). Absent → middle-align.
export type MeasureObject = (v: Visual) => { width: number; height: number; baseline?: number };

export interface TextFragment
{
    readonly kind: 'text';
    readonly text: string;
    readonly props: RunProps;
    readonly metrics: TextMetrics;
    x: number; y: number;
    readonly width: number;
    readonly ascent: number;
    readonly descent: number;
    readonly source: Inline;
    // Character offset within `source` (a Run) where this fragment's text
    // begins — lets the editor map a caret position (Run + local index) to
    // this fragment and back for caret geometry / hit-testing.
    readonly runOffset: number;
}

export interface ObjectFragment
{
    readonly kind: 'object';
    readonly visual: Visual;
    x: number; y: number;
    readonly width: number;
    readonly height: number;
    // Distance above / below the line baseline. Set at commit time — baseline-
    // aligned when `baseline` is set (the object's own text baseline lands on the
    // line baseline), else middle-aligned. ascent + descent still sum to `height`
    // so hit-testing keeps the full box.
    ascent: number;
    descent: number;
    // The object's own text baseline from its top, when it reported one.
    readonly baseline?: number;
    readonly source: Inline;
}

export interface ImageFragment
{
    readonly kind: 'image';
    readonly image: ImageSource;
    readonly stretch: Stretch;
    x: number; y: number;
    readonly width: number;
    readonly height: number;
    // Distance above / below the line baseline — middle-aligned to the text
    // (an inline image has no text baseline of its own). Finalised in commit()
    // like an ObjectFragment; ascent + descent === height for hit-testing.
    ascent: number;
    descent: number;
    readonly source: Inline;
}

export type Fragment = TextFragment | ObjectFragment | ImageFragment;

export interface Line
{
    readonly frags: Fragment[];
    top: number;
    readonly baseline: number;
    readonly height: number;
    width: number;
    // Horizontal alignment offset, applied by the host at arrange/render
    // against the real slot width (fragments are laid out left-aligned).
    shift: number;
}

export interface LayoutResult
{
    readonly lines: Line[];
    readonly width: number;
    readonly height: number;
}

export interface LayoutOptions
{
    availableWidth: number;   // Infinity when unbounded / no-wrap
    wrap: boolean;
    letterSpacing: number;
    lineHeight: number;       // explicit; NaN or <= 0 → natural
    measureText: MeasureText;
    measureObject: MeasureObject;
    // When Justify, wrapped lines have their inter-word gaps widened to fill
    // `availableWidth`; the last line (and hard-break-terminated lines) stay
    // natural. Omitted / Left / Center / Right → fragments stay left-packed
    // and the host applies a single per-line `shift`.
    align?: TextAlignment;
}

// A single styled non-whitespace piece within a word (a word can span
// several pieces of differing props).
interface Piece { text: string; props: RunProps; metrics: TextMetrics; width: number; source: Inline; runOffset: number }

type Token =
    | { kind: 'word';   pieces: Piece[]; width: number }
    | { kind: 'space';  width: number }
    | { kind: 'object'; visual: Visual; width: number; height: number; baseline?: number; source: Inline }
    | { kind: 'image';  image: ImageSource; width: number; height: number; stretch: Stretch; display: ImageDisplay; source: Inline }
    | { kind: 'break' };

export function layoutInlines(items: FlowItem[], opt: LayoutOptions): LayoutResult
{
    const advance = (base: number, glyphs: number): number =>
        opt.letterSpacing === 0 ? base : base + opt.letterSpacing * glyphs;

    // ── Tokenize into wrap units ────────────────────────────────────
    const tokens: Token[] = [];
    let wordPieces: Piece[] = [];
    let wordWidth = 0;
    const flushWord = (): void =>
    {
        if (wordPieces.length > 0) { tokens.push({ kind: 'word', pieces: wordPieces, width: wordWidth }); }
        wordPieces = []; wordWidth = 0;
    };
    for (const item of items)
    {
        if (item.kind === 'break') { flushWord(); tokens.push({ kind: 'break' }); continue; }
        if (item.kind === 'object')
        {
            flushWord();
            const size = opt.measureObject(item.visual);
            tokens.push({ kind: 'object', visual: item.visual, width: size.width, height: size.height, baseline: size.baseline, source: item.source });
            continue;
        }
        if (item.kind === 'image')
        {
            flushWord();
            // Cap to the available width (scaling height proportionally) so a
            // large image never overflows the line; unbounded width → no cap.
            let w = item.width, h = item.height;
            if (Number.isFinite(opt.availableWidth) && w > opt.availableWidth && w > 0)
            {
                h = h * (opt.availableWidth / w);
                w = opt.availableWidth;
            }
            tokens.push({ kind: 'image', image: item.image, width: w, height: h, stretch: item.stretch, display: item.display, source: item.source });
            continue;
        }
        // text — split into alternating non-ws / ws segments, tracking the
        // offset within the run so each word piece knows where it began.
        const segs = item.text.split(/(\s+)/);
        let segStart = 0;
        for (const seg of segs)
        {
            if (seg === '') continue;
            if (/^\s+$/.test(seg))
            {
                flushWord();
                const m = opt.measureText(' ', item.props);
                tokens.push({ kind: 'space', width: advance(m.Width, 1) });
            }
            else
            {
                const m = opt.measureText(seg, item.props);
                const w = advance(m.Width, [...seg].length);
                wordPieces.push({ text: seg, props: item.props, metrics: m, width: w, source: item.source, runOffset: segStart });
                wordWidth += w;
            }
            segStart += seg.length;
        }
    }
    flushWord();

    // ── Greedy line fill ────────────────────────────────────────────
    const lines: Line[] = [];
    let frags: Fragment[] = [];
    let curX = 0;
    let maxAscent = 0;
    let maxDescent = 0;
    let pendingSpace: number | undefined;
    let top = 0;
    let maxLineWidth = 0;

    // Per-line justify bookkeeping (parallel to `lines`): `gaps` holds the
    // frag indices that begin a word/object preceded by an inter-word space,
    // and `soft` marks a line ended by wrap (justify-eligible) vs. by a hard
    // break or end-of-content (the last line — never justified).
    const lineMeta: { gaps: number[]; soft: boolean }[] = [];
    let lineGaps: number[] = [];

    const commit = (soft: boolean): void =>
    {
        if (frags.length === 0) { pendingSpace = undefined; lineGaps = []; return; }
        // maxAscent / maxDescent are the line's TEXT metrics (objects don't feed
        // them during fill). Each embedded object is aligned one of two ways:
        //   * BASELINE-aligned when it reported a `baseline` — its own text
        //     baseline lands on the line baseline, so a padded chip's label reads
        //     level with the surrounding text and the chip box extends BELOW by
        //     its descent + bottom padding. This is the chip case.
        //   * MIDDLE-aligned otherwise — the box is centred on the text's vertical
        //     middle (baseline − (asc−desc)/2). An object-only line centres on its
        //     own middle.
        // Either way ascent + descent === height, so hit-testing keeps the box.
        let lineAscent = maxAscent;
        let lineDescent = maxDescent;
        const hasText = maxAscent > 0 || maxDescent > 0;
        const centreAbove = hasText ? (maxAscent - maxDescent) / 2 : 0;
        for (const f of frags)
        {
            if (f.kind === 'text') continue;
            // object / image: baseline-align if the object reported its own text
            // baseline, else middle-align on the text's vertical middle. An image
            // has no baseline of its own → always middle-aligned.
            const objBaseline = f.kind === 'object' ? f.baseline : undefined;
            if (objBaseline !== undefined && Number.isFinite(objBaseline))
            {
                f.ascent  = objBaseline;
                f.descent = f.height - objBaseline;
            }
            else
            {
                f.ascent  = centreAbove + f.height / 2;   // above baseline
                f.descent = f.height / 2 - centreAbove;   // below (may be < 0 → sits fully above)
            }
            lineAscent  = Math.max(lineAscent,  f.ascent);
            lineDescent = Math.max(lineDescent, f.descent);
        }
        const natural = lineAscent + lineDescent;
        const height = (Number.isFinite(opt.lineHeight) && opt.lineHeight > 0)
            ? Math.max(opt.lineHeight, natural) : natural;
        const baseline = lineAscent + Math.max(0, (height - natural) / 2);
        for (const f of frags) f.y = top + baseline - f.ascent;
        const width = curX;
        lines.push({ frags, top, baseline, height, width, shift: 0 });
        lineMeta.push({ gaps: lineGaps, soft });
        maxLineWidth = Math.max(maxLineWidth, width);
        top += height;
        frags = []; curX = 0; maxAscent = 0; maxDescent = 0; pendingSpace = undefined; lineGaps = [];
    };

    const placePieces = (pieces: Piece[]): void =>
    {
        for (const p of pieces)
        {
            frags.push({
                kind: 'text', text: p.text, props: p.props, metrics: p.metrics,
                x: curX, y: 0, width: p.width, ascent: p.metrics.Ascent, descent: p.metrics.Descent,
                source: p.source, runOffset: p.runOffset,
            });
            curX += p.width;
            maxAscent = Math.max(maxAscent, p.metrics.Ascent);
            maxDescent = Math.max(maxDescent, p.metrics.Descent);
        }
    };

    for (const tok of tokens)
    {
        if (tok.kind === 'break') { commit(false); continue; }
        if (tok.kind === 'space') { pendingSpace = tok.width; continue; }

        // A block image is a figure on its own line: end the current line, place
        // the image alone, end that line. The paragraph's per-line alignment shift
        // centres / right-aligns it at render like any other line.
        if (tok.kind === 'image' && tok.display === ImageDisplay.Block)
        {
            commit(false);
            frags.push({ kind: 'image', image: tok.image, stretch: tok.stretch, x: 0, y: 0, width: tok.width, height: tok.height, ascent: 0, descent: 0, source: tok.source });
            curX += tok.width;
            commit(false);
            pendingSpace = undefined;
            continue;
        }

        const atomWidth = tok.width;
        const spaceBefore = (frags.length > 0 && pendingSpace !== undefined) ? pendingSpace : 0;
        if (opt.wrap && frags.length > 0 && curX + spaceBefore + atomWidth > opt.availableWidth)
        {
            commit(true);   // wrap — the pending space is dropped at the break
        }
        else if (spaceBefore > 0)
        {
            // A real inter-word gap: the frag about to be pushed starts a new
            // word — record its index so Justify can widen the gaps.
            lineGaps.push(frags.length);
            curX += spaceBefore;
        }
        pendingSpace = undefined;

        if (tok.kind === 'word') { placePieces(tok.pieces); }
        else if (tok.kind === 'object')
        {
            // ascent/descent are finalised in commit() (baseline- or middle-
            // align); objects don't inflate the line's text metrics during fill.
            frags.push({
                kind: 'object', visual: tok.visual, x: curX, y: 0,
                width: tok.width, height: tok.height, ascent: 0, descent: 0,
                baseline: tok.baseline, source: tok.source,
            });
            curX += tok.width;
        }
        else /* inline image */
        {
            frags.push({
                kind: 'image', image: tok.image, stretch: tok.stretch, x: curX, y: 0,
                width: tok.width, height: tok.height, ascent: 0, descent: 0, source: tok.source,
            });
            curX += tok.width;
        }
    }
    commit(false);

    // Justify: widen the inter-word gaps of every wrapped line so both edges
    // meet `availableWidth`. The last line (and hard-break-terminated lines)
    // stay natural — that's `soft === false`. Only meaningful with a bounded
    // width and at least one gap to absorb the slack.
    if (opt.align === TextAlignment.Justify && Number.isFinite(opt.availableWidth))
    {
        const slotW = opt.availableWidth;
        for (let li = 0; li < lines.length; li++)
        {
            const meta = lineMeta[li]!;
            if (!meta.soft || meta.gaps.length === 0) continue;
            const line  = lines[li]!;
            const extra = slotW - line.width;
            if (extra <= 0) continue;
            const perGap = extra / meta.gaps.length;
            // Walk the fragments left→right, pushing each one right by the
            // cumulative widening of every gap that precedes it.
            let passed = 0, gi = 0;
            for (let fi = 0; fi < line.frags.length; fi++)
            {
                while (gi < meta.gaps.length && meta.gaps[gi] === fi) { passed++; gi++; }
                line.frags[fi]!.x += passed * perGap;
            }
            line.width = slotW;
        }
        maxLineWidth = Math.max(maxLineWidth, slotW);
    }

    // Fragments are left-aligned (except Justify, applied above); the host
    // applies a per-line `shift` at arrange/render against the real slot
    // width for Center/Right (matching the Text path).
    return { lines, width: maxLineWidth, height: top };
}

// ── Shared paint / arrange / hit-test over a laid-out LayoutResult ─────
// Extracted from TextBlock so every inline host (TextBlock today, each
// Paragraph of a RichText document tomorrow) paints, arranges embedded
// visuals, and hit-tests links through ONE implementation. Colour tokens
// are passed in (the layout layer stays theme-agnostic); `originX/Y` shift
// the whole result (a paragraph sits at its block position in the doc).

export interface RenderLayoutOptions
{
    originX: number;
    originY: number;
    letterSpacing: number;
    // Fallback fill for a run with no explicit Foreground: `link` when the
    // run sits inside a Hyperlink, else `ink`.
    ink:  Brush;
    link: Brush;
}

/** Paint every text fragment of `layout`; object fragments paint
 *  separately as the host's child visuals. */
export function renderLayout(dc: DrawingContext, layout: LayoutResult, o: RenderLayoutOptions): void
{
    for (const line of layout.lines)
    {
        for (const f of line.frags)
        {
            if (f.kind === 'text')
            {
                const fg = f.props.foreground ?? (f.props.link !== undefined ? o.link : o.ink);
                const formatted = new FormattedText(
                    f.text, f.props.family, f.props.size, fg,
                    f.props.weight, f.props.style, f.metrics,
                    o.letterSpacing, f.props.decorations,
                );
                dc.DrawText(formatted, new Point(o.originX + f.x + line.shift, o.originY + f.y));
            }
            else if (f.kind === 'image')
            {
                // Painted directly (not as a child visual) so it renders on the
                // live canvas AND in the SVG/PPTX/PNG export — both DrawingContexts
                // implement DrawImage. ObjectFragments (InlineUIContainer) still
                // paint separately as the host's child visuals (skipped here).
                dc.DrawImage(f.image, new Rect(o.originX + f.x + line.shift, o.originY + f.y, f.width, f.height), f.stretch);
            }
        }
    }
}

/** Every embedded Visual referenced by object fragments, in flow order. */
export function collectObjectVisuals(layout: LayoutResult): Visual[]
{
    const out: Visual[] = [];
    for (const line of layout.lines)
        for (const f of line.frags)
            if (f.kind === 'object') out.push(f.visual);
    return out;
}

/** Arrange each embedded Visual at its computed slot, offset by origin. */
export function arrangeObjectVisuals(layout: LayoutResult, originX: number, originY: number): void
{
    for (const line of layout.lines)
        for (const f of line.frags)
            if (f.kind === 'object')
                f.visual.Arrange(new Rect(originX + f.x + line.shift, originY + f.y, f.width, f.height));
}

/** The link target under a point in the layout's own coordinate space
 *  (caller subtracts the layout origin first), or undefined. */
export function linkAtInLayout(layout: LayoutResult, lx: number, ly: number): LinkTarget | undefined
{
    for (const line of layout.lines)
    {
        for (const f of line.frags)
        {
            if (f.kind !== 'text' || f.props.link === undefined) continue;
            const x = f.x + line.shift;
            if (lx >= x && lx <= x + f.width && ly >= f.y && ly <= f.y + f.ascent + f.descent)
                return f.props.link;
        }
    }
    return undefined;
}
