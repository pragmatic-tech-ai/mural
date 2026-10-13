// markdown-renderer.ts — full-fidelity markdown → mural FlowDocument.
//
// Drives marked's lexer (GFM on: tables, strikethrough, task lists, autolinks)
// and walks the token tree into a FlowDocument a RichTextBlock lays out natively.
// Covers the whole CommonMark+GFM grammar and adds syntax-highlighted code
// (highlight.js), inline images (local + remote), and best-effort raw-HTML
// mapping.
//
// PURE except for two injected side-effect seams: opening a link and loading an
// image. Both default to no-ops so the transform stays unit-testable in bare
// node. An instance holds the render context so the block/inline walkers don't
// thread it through every call.
import { lexer, type Token, type Tokens } from 'marked';
import {
    Bold, FlowDocument, Hyperlink, InlineUIContainer, Italic, LineBreak, List, ListItem,
    ListMarkerStyle, Paragraph, Run, Span, Table, TableCell, TableRow, TextAlignment,
    TextElement, Border,
    type Block, type Inline,
} from '../index.js';
import { TextDecorations, FontStyle } from '../../visual-engine/index.js';
import { Thickness } from '../../runtime/index.js';
import { CodeHighlighter, type HighlightToken } from './code-highlighter.js';
import { InlineHtml, HtmlTagKind } from './inline-html.js';
import { MarkdownImage, type MarkdownImageContext } from './markdown-image.js';
import { SvgInline } from './svg-inline.js';
import { FlowStyle } from './flow-style.js';

// Injected context for the render. All fields optional; a bare call renders text,
// emphasis, lists, tables, and code, with links/images inert.
export interface MarkdownRenderContext
{
    // Invoked when a rendered link is clicked (default no-op).
    readonly openLink?: (uri: string) => void;
    // When present, images render (local paths resolve through it); when absent,
    // an image degrades to its alt text.
    readonly image?: MarkdownImageContext;
    // Syntax-highlight fenced code blocks (default true).
    readonly highlight?: boolean;
}

// A sink frame for the inline raw-HTML span stack.
interface InlineSink
{
    name: string;
    add: (i: Inline) => void;
}

export class MarkdownRenderer
{
    private static readonly CheckedGlyph = '☑ ';     // ☑
    private static readonly UncheckedGlyph = '☐ ';   // ☐
    private static readonly ImageFallbackLabel = 'image';
    // The hairline rule is a wide fixed line (flow blocks can't host a stretching
    // Border), a touch narrower than the reading column.
    private static readonly RuleWidth = 640;

    private readonly ctx: MarkdownRenderContext;

    private constructor(ctx: MarkdownRenderContext)
    {
        this.ctx = ctx;
    }

    // Parse markdown into a FlowDocument.
    public static Render(markdown: string, ctx: MarkdownRenderContext = {}): FlowDocument
    {
        return new MarkdownRenderer(ctx).RenderDocument(markdown);
    }

    private RenderDocument(markdown: string): FlowDocument
    {
        const doc = new FlowDocument();
        let tokens: Token[];
        try
        {
            tokens = lexer(markdown.replace(/\r\n?/g, '\n'));
        }
        catch
        {
            // Never throw on odd input — degrade to a single plain paragraph.
            const p = new Paragraph();
            p.AddChild(new Run(markdown));
            doc.AddChild(p);
            return doc;
        }
        for (const tok of tokens)
        {
            for (const block of this.BlocksFor(tok)) doc.AddChild(block);
        }
        return doc;
    }

    // ── Block level ──────────────────────────────────────────────────────────

    // A token may yield zero blocks (space), one, or several (a blockquote's inner
    // paragraphs), so this always returns an array.
    private BlocksFor(tok: Token): Block[]
    {
        switch (tok.type)
        {
            case 'space':      return [];
            case 'heading':    return [this.HeadingBlock(tok as Tokens.Heading)];
            case 'paragraph':  return this.ParagraphBlocks(tok as Tokens.Paragraph);
            case 'text':       return [this.ParagraphBlock(MarkdownRenderer.TextTokenInlines(tok))];
            case 'blockquote': return this.QuoteBlocks(tok as Tokens.Blockquote);
            case 'list':       return [this.ListBlock(tok as Tokens.List)];
            case 'code':       return this.CodeBlocks(tok as Tokens.Code);
            case 'table':      return [this.TableBlock(tok as Tokens.Table)];
            case 'hr':         return [MarkdownRenderer.RuleBlock()];
            case 'html':       return this.HtmlBlock(tok as Tokens.HTML);
            default:           return [];
        }
    }

    private HeadingBlock(tok: Tokens.Heading): Paragraph
    {
        const p = new Paragraph();
        p.FontSize = FlowStyle.HeadingSize[tok.depth - 1] ?? FlowStyle.BaseSize;
        p.Margin = new Thickness(0, tok.depth <= 2 ? 8 : 4, 0, 4);
        // Bold carries the emphasis (h5/h6 that share the base size still read as
        // headings) and composes with inline markup inside the heading.
        const bold = new Bold();
        for (const inline of this.RenderInlines(tok.tokens)) bold.AddChild(inline);
        p.AddChild(bold);
        return p;
    }

    private ParagraphBlock(inlineTokens: Token[]): Paragraph
    {
        const p = new Paragraph();
        p.Margin = FlowStyle.BlockGap();
        p.LineHeight = FlowStyle.BodyLineHeight;
        for (const inline of this.RenderInlines(inlineTokens)) p.AddChild(inline);
        return p;
    }

    // A blockquote renders its inner blocks indented, muted, and italic — mural's
    // flow blocks can't nest a bordered container, so styling stands in for the bar.
    private QuoteBlocks(tok: Tokens.Blockquote): Block[]
    {
        const out: Block[] = [];
        for (const inner of tok.tokens)
        {
            for (const block of this.BlocksFor(inner))
            {
                block.Margin = new Thickness(12, 0, 0, 8);
                block.FontStyle = FontStyle.Italic;                         // inherited by inline runs
                FlowStyle.BindTheme(block, TextElement.ForegroundKey, FlowStyle.Fg2Token);   // muted
                out.push(block);
            }
        }
        return out.length > 0 ? out : [this.ParagraphBlock([])];
    }

    private ListBlock(tok: Tokens.List): List
    {
        const list = new List();
        list.Margin = FlowStyle.BlockGap();
        list.MarkerStyle = tok.ordered ? ListMarkerStyle.Decimal : ListMarkerStyle.Disc;
        if (tok.ordered && typeof tok.start === 'number') list.StartIndex = tok.start;
        for (const item of tok.items) list.AddChild(this.ListItemOf(item));
        return list;
    }

    private ListItemOf(item: Tokens.ListItem): ListItem
    {
        const li = new ListItem();
        const blocks: Block[] = [];
        for (const inner of item.tokens) for (const b of this.BlocksFor(inner)) blocks.push(b);
        if (blocks.length === 0) blocks.push(this.ParagraphBlock([]));

        // A task item prefixes its first paragraph with a checkbox glyph.
        if (item.task && blocks[0] instanceof Paragraph)
        {
            const glyph = new Run(item.checked ? MarkdownRenderer.CheckedGlyph : MarkdownRenderer.UncheckedGlyph);
            blocks[0].Inlines.Insert(0, glyph);
        }
        for (const b of blocks) li.AddChild(b);
        return li;
    }

    // A fenced code block. An ```svg fence whose body is an actual `<svg>` element
    // is DRAWN (sized to its width/height) rather than shown as source — the agent
    // uses the fence to display an image; everything else is a highlighted code
    // paragraph.
    private CodeBlocks(tok: Tokens.Code): Block[]
    {
        if ((tok.lang ?? '').trim().toLowerCase() === 'svg' && SvgInline.LooksLikeSvg(tok.text))
        {
            const svg = SvgInline.Extract(tok.text);
            if (svg !== undefined) return [MarkdownRenderer.SvgImageBlock(svg)];
        }
        return [this.CodeBlock(tok)];
    }

    // A fenced code block — a monospace paragraph, syntax-highlighted unless disabled.
    private CodeBlock(tok: Tokens.Code): Paragraph
    {
        const p = new Paragraph();
        p.FontFamily = FlowStyle.Mono;
        p.Margin = new Thickness(8, 2, 0, 8);
        const tokens: readonly HighlightToken[] = this.ctx.highlight === false
            ? [{ text: tok.text }]
            : CodeHighlighter.Highlight(tok.text, tok.lang);
        MarkdownRenderer.EmitCodeRuns(p, tokens);
        return p;
    }

    // A paragraph that IS a raw `<svg>` (marked emits a single-line svg as a
    // paragraph of inline HTML, not an html block) is DRAWN; anything else is a
    // normal paragraph.
    private ParagraphBlocks(tok: Tokens.Paragraph): Block[]
    {
        if (SvgInline.LooksLikeSvg(tok.text))
        {
            const svg = SvgInline.Extract(tok.text);
            if (svg !== undefined) return [MarkdownRenderer.SvgImageBlock(svg)];
        }
        return [this.ParagraphBlock(tok.tokens)];
    }

    // Block wrapping a drawn `<svg>` (from a fence or a raw HTML block). The image
    // carries its own resolved size; the paragraph just gives it block spacing.
    private static SvgImageBlock(svg: string): Paragraph
    {
        const p = new Paragraph();
        p.Margin = FlowStyle.BlockGap();
        p.AddChild(SvgInline.ToImage(svg));
        return p;
    }

    // Emit highlighted tokens as coloured Runs, breaking on '\n' (LineBreak) and
    // preserving each line's leading indentation.
    private static EmitCodeRuns(p: Paragraph, tokens: readonly HighlightToken[]): void
    {
        let atLineStart = true;
        for (const tok of tokens)
        {
            const segments = tok.text.split('\n');
            segments.forEach((seg, i) =>
            {
                if (i > 0) { p.AddChild(new LineBreak()); atLineStart = true; }
                if (seg.length === 0) return;
                const text = atLineStart ? FlowStyle.PreserveIndent(seg) : seg;
                atLineStart = false;
                const run = new Run(text);
                const token = CodeHighlighter.ScopeToToken(tok.scope);
                if (token !== undefined) FlowStyle.BindTheme(run, TextElement.ForegroundKey, token);
                p.AddChild(run);
            });
        }
    }

    private TableBlock(tok: Tokens.Table): Table
    {
        const table = new Table();
        table.Margin = FlowStyle.BlockGap();
        table.LastColumnFills = true;
        FlowStyle.BindTheme(table, Table.BorderBrushKey, FlowStyle.BorderToken);
        FlowStyle.BindTheme(table, Table.HeaderBackgroundKey, FlowStyle.Bg2Token);

        const aligns = tok.align.map(MarkdownRenderer.ToAlignment);
        table.AddChild(this.TableRowOf(tok.header, aligns, true));
        for (const row of tok.rows) table.AddChild(this.TableRowOf(row, aligns, false));
        return table;
    }

    private TableRowOf(cells: Tokens.TableCell[], aligns: TextAlignment[], header: boolean): TableRow
    {
        const row = new TableRow();
        row.IsHeader = header;
        cells.forEach((cell, ci) => row.AddChild(this.TableCellOf(cell, aligns[ci] ?? TextAlignment.Left, header)));
        return row;
    }

    private TableCellOf(cell: Tokens.TableCell, align: TextAlignment, header: boolean): TableCell
    {
        const td = new TableCell();
        const p = new Paragraph();
        p.LineHeight = FlowStyle.BodyLineHeight;
        p.TextAlignment = align;
        const parsed = this.RenderInlines(cell.tokens);
        if (header)
        {
            const bold = new Bold();
            for (const inline of parsed) bold.AddChild(inline);
            p.AddChild(bold);
        }
        else
        {
            for (const inline of parsed) p.AddChild(inline);
        }
        td.AddChild(p);
        return td;
    }

    private static ToAlignment(a: 'left' | 'center' | 'right' | null): TextAlignment
    {
        return a === 'center' ? TextAlignment.Center : a === 'right' ? TextAlignment.Right : TextAlignment.Left;
    }

    // A horizontal rule — a fixed-width hairline embedded in a paragraph (flow
    // blocks can't host a stretching Border, so the rule is a wide fixed line).
    private static RuleBlock(): Paragraph
    {
        const p = new Paragraph();
        p.Margin = new Thickness(0, 6, 0, 10);
        const rule = new Border();
        rule.Height = 1;
        rule.Width = MarkdownRenderer.RuleWidth;
        FlowStyle.BindTheme(rule, Border.FillKey, FlowStyle.BorderToken);
        p.AddChild(new InlineUIContainer(rule));
        return p;
    }

    // Block-level raw HTML — best-effort: whitelisted tags map to inlines, the
    // rest strip to text, all wrapped in a paragraph. Empty result yields no block.
    private HtmlBlock(tok: Tokens.HTML): Block[]
    {
        // A raw `<svg>…</svg>` block is DRAWN (sized to its width/height) — mural
        // renders no HTML, so without this the element strips to nothing.
        const svg = SvgInline.Extract(tok.text);
        if (svg !== undefined) return [MarkdownRenderer.SvgImageBlock(svg)];
        // Reuse the shared fragment walker (which decodes entities) rather than a
        // second copy here.
        const inlines = InlineHtml.FragmentToInlines(tok.text, (uri) => this.ctx.openLink?.(uri));
        if (inlines.length === 0) return [];
        const p = new Paragraph();
        p.Margin = FlowStyle.BlockGap();
        p.LineHeight = FlowStyle.BodyLineHeight;
        for (const inline of inlines) p.AddChild(inline);
        return [p];
    }

    // ── Inline level ───────────────────────────────────────────────────────────

    // Walk inline tokens into inlines. Inline raw HTML (which marked emits as
    // separate per-tag tokens) is resolved with a span stack so `<b>…</b>` nests
    // correctly.
    private RenderInlines(tokens: Token[] | undefined): Inline[]
    {
        const root: Inline[] = [];
        const stack: InlineSink[] = [{ name: '', add: (i) => root.push(i) }];
        const add = (i: Inline): void => stack[stack.length - 1]!.add(i);

        const toks = tokens ?? [];
        let i = 0;
        while (i < toks.length)
        {
            const tok = toks[i]!;
            // Inline <svg> arrives as a RUN of html tokens (<svg…>, <path/>, …,
            // </svg>) with any whitespace between — reassemble it and DRAW it at
            // its set size. mural renders no HTML, so otherwise the element strips
            // to nothing (the icon-in-a-table-cell case).
            if (tok.type === 'html' && SvgInline.LooksLikeSvg((tok as Tokens.HTML).text))
            {
                const run = MarkdownRenderer.CollectInlineSvg(toks, i);
                if (run !== undefined) { add(SvgInline.ToImage(run.svg)); i = run.next; continue; }
            }
            switch (tok.type)
            {
                case 'text':
                    for (const inline of this.TextTokenInlinesRendered(tok)) add(inline);
                    break;
                case 'escape':
                    add(new Run((tok as Tokens.Escape).text));
                    break;
                case 'strong':
                    add(this.Fill(new Bold(), (tok as Tokens.Strong).tokens));
                    break;
                case 'em':
                    add(this.Fill(new Italic(), (tok as Tokens.Em).tokens));
                    break;
                case 'del':
                {
                    const s = new Span();
                    s.TextDecorations = TextDecorations.Strikethrough;
                    add(this.Fill(s, (tok as Tokens.Del).tokens));
                    break;
                }
                case 'codespan':
                    add(FlowStyle.CodeChip((tok as Tokens.Codespan).text));
                    break;
                case 'link':
                {
                    const l = tok as Tokens.Link;
                    const link = new Hyperlink();
                    link.NavigateUri = l.href;
                    link.Click = (): void => this.ctx.openLink?.(l.href);
                    for (const inline of this.RenderInlines(l.tokens)) link.AddChild(inline);
                    add(link);
                    break;
                }
                case 'image':
                    add(this.ImageInline(tok as Tokens.Image));
                    break;
                case 'br':
                    add(new LineBreak());
                    break;
                case 'html':
                    this.HandleInlineHtml((tok as Tokens.HTML).text, stack);
                    break;
                default:
                {
                    const text = (tok as { text?: string }).text;
                    if (typeof text === 'string' && text.length > 0) add(new Run(MarkdownRenderer.SoftBreak(text)));
                }
            }
            i++;
        }
        return root;
    }

    // Reassemble a complete inline `<svg>…</svg>` starting at token `start`, by
    // concatenating tokens' raw text until one closes the element. Returns the svg
    // source and the index just past it, or undefined if no close is found.
    private static CollectInlineSvg(toks: readonly Token[], start: number): { svg: string; next: number } | undefined
    {
        let raw = '';
        for (let j = start; j < toks.length; j++)
        {
            raw += (toks[j] as { raw?: string }).raw ?? '';
            if (/<\/svg\s*>/i.test((toks[j] as { raw?: string }).raw ?? ''))
            {
                const svg = SvgInline.Extract(raw);
                return svg !== undefined ? { svg, next: j + 1 } : undefined;
            }
        }
        return undefined;
    }

    // A marked 'text' token is either a leaf (its .text) or a wrapper carrying
    // nested inline .tokens. This yields the leaf/nested inlines for the RENDER path.
    private TextTokenInlinesRendered(tok: Token): Inline[]
    {
        const t = tok as Tokens.Text;
        if (t.tokens !== undefined && t.tokens.length > 0) return this.RenderInlines(t.tokens);
        return [new Run(MarkdownRenderer.SoftBreak(t.text))];
    }

    // The inline TOKEN list of a block-level 'text' token (list items / loose
    // text), for feeding ParagraphBlock.
    private static TextTokenInlines(tok: Token): Token[]
    {
        const t = tok as Tokens.Text;
        return t.tokens !== undefined && t.tokens.length > 0 ? t.tokens : [{ type: 'text', raw: t.text, text: t.text } as Token];
    }

    private ImageInline(tok: Tokens.Image): Inline
    {
        if (this.ctx.image !== undefined) return MarkdownImage.Create(tok.href, tok.text, this.ctx.image);
        const alt = tok.text.length > 0 ? tok.text : tok.href;
        return new Run(`[${MarkdownRenderer.ImageFallbackLabel}: ${alt}]`);
    }

    // Fill a span with rendered children and return it.
    private Fill(span: Span, tokens: Token[]): Span
    {
        for (const inline of this.RenderInlines(tokens)) span.AddChild(inline);
        return span;
    }

    // Drive the inline-HTML span stack for one html token (a single tag).
    private HandleInlineHtml(raw: string, stack: InlineSink[]): void
    {
        const tag = InlineHtml.ParseTag(raw);
        if (tag === undefined) { stack[stack.length - 1]!.add(new Run(raw)); return; }
        if (tag.kind === HtmlTagKind.Void)
        {
            if (tag.name === 'br') stack[stack.length - 1]!.add(new LineBreak());
            return;
        }
        if (tag.kind === HtmlTagKind.Open)
        {
            const span = InlineHtml.OpenTagInline(tag, (uri) => this.ctx.openLink?.(uri));
            if (span !== undefined)
            {
                stack[stack.length - 1]!.add(span);
                stack.push({ name: tag.name, add: (i) => span.AddChild(i) });
            }
            else
            {
                const parent = stack[stack.length - 1]!;
                stack.push({ name: tag.name, add: parent.add });   // stripped: children flow up
            }
            return;
        }
        // Close — pop to the matching open.
        for (let k = stack.length - 1; k > 0; k -= 1)
        {
            if (stack[k]!.name === tag.name) { stack.length = k; break; }
        }
    }

    // Soft line breaks (a bare '\n' inside a text run) render as a space, per
    // CommonMark.
    private static SoftBreak(text: string): string
    {
        return text.replace(/\n/g, ' ');
    }
}
