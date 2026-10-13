import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    Bold, Border, FlowDocument, Hyperlink, Image, InlineUIContainer, Italic, LineBreak,
    List, ListItem, Paragraph, Run, Span, Table, TextAlignment, ListMarkerStyle,
} from '../../index.js';
import { BitmapImage, FontStyle, TextDecorations } from '../../../visual-engine/index.js';
import { MarkdownRenderer, type MarkdownRenderContext } from '../markdown-renderer.js';

function blocks(md: string, ctx: MarkdownRenderContext = {}): unknown[] { return MarkdownRenderer.Render(md, ctx).Blocks.ToArray(); }
function inlines(p: Paragraph): unknown[] { return p.Inlines.ToArray(); }
// The inlines of the first block, treating it as a Paragraph.
function firstInlines(md: string, ctx: MarkdownRenderContext = {}): unknown[] { return inlines(blocks(md, ctx)[0] as Paragraph); }

test('renders a FlowDocument', () =>
{
    assert.ok(MarkdownRenderer.Render('hi') instanceof FlowDocument);
});

test('heading is sized by depth and emphasised', () =>
{
    const h1 = blocks('# Title')[0] as Paragraph;
    const h3 = blocks('### Sub')[0] as Paragraph;
    assert.ok(h1.FontSize! > h3.FontSize!);
    assert.ok(inlines(h1)[0] instanceof Bold);
});

test('paragraph maps bold, italic, code chip, strikethrough', () =>
{
    const parts = firstInlines('a **b** _i_ `c` ~~s~~');
    assert.ok(parts.some((x) => x instanceof Bold));
    assert.ok(parts.some((x) => x instanceof Italic));
    const chip = parts.find((x) => x instanceof InlineUIContainer) as InlineUIContainer | undefined;
    assert.ok(chip?.Child instanceof Border);
    const del = parts.find((x) => x instanceof Span && !(x instanceof Bold) && !(x instanceof Italic)) as Span | undefined;
    assert.ok(del !== undefined);
    assert.equal(del!.TextDecorations & TextDecorations.Strikethrough, TextDecorations.Strikethrough);
});

test('link becomes a Hyperlink with uri and a working click handler', () =>
{
    let opened: string | undefined;
    const open = (uri: string): void => { opened = uri; };
    const link = firstInlines('see [docs](https://x.test/p)', { openLink: open }).find((x) => x instanceof Hyperlink) as Hyperlink;
    assert.equal(link.NavigateUri, 'https://x.test/p');
    link.Click?.();
    assert.equal(opened, 'https://x.test/p');
});

test('soft line breaks render as spaces', () =>
{
    const parts = firstInlines('line one\nline two');
    assert.equal((parts[0] as Run).Text, 'line one line two');
});

test('unordered list is a disc List; task items get a checkbox glyph', () =>
{
    const list = blocks('- a\n- [ ] todo\n- [x] done')[0] as List;
    assert.ok(list instanceof List);
    assert.equal(list.MarkerStyle, ListMarkerStyle.Disc);
    const items = list.ListItems.ToArray();
    assert.equal(items.length, 3);
    const para = (md: ListItem): Paragraph => md.Blocks.ToArray()[0] as Paragraph;
    const firstRun = (md: ListItem): string => (para(md).Inlines.ToArray()[0] as Run).Text;
    assert.ok(firstRun(items[1] as ListItem).includes('☐'));
    assert.ok(firstRun(items[2] as ListItem).includes('☑'));
});

test('ordered list is decimal and honours the start number', () =>
{
    const list = blocks('3. three\n4. four')[0] as List;
    assert.equal(list.MarkerStyle, ListMarkerStyle.Decimal);
    assert.equal(list.StartIndex, 3);
    assert.equal(list.ListItems.ToArray().length, 2);
});

test('fenced code highlights into multiple coloured runs; plain mode does not', () =>
{
    const hp = blocks('```js\nconst x = 1\n```')[0] as Paragraph;
    assert.ok(/mono/i.test(String(hp.FontFamily)));
    const hlRuns = inlines(hp).filter((x) => x instanceof Run) as Run[];
    assert.ok(hlRuns.length > 1);                                        // split by scope
    assert.equal(hlRuns.map((r) => r.Text).join(''), 'const x = 1');     // round-trips source

    const plain = blocks('```js\nconst x = 1\n```', { highlight: false })[0] as Paragraph;
    assert.equal(inlines(plain).filter((x) => x instanceof Run).length, 1);
});

test('multi-line code breaks lines and preserves indentation', () =>
{
    const p = blocks('```\na\n    b\n```', { highlight: false })[0] as Paragraph;
    const parts = inlines(p);
    assert.ok(parts.some((x) => x instanceof LineBreak));
    const runs = parts.filter((x) => x instanceof Run) as Run[];
    assert.ok(runs.some((r) => r.Text.startsWith(' ')));     // NBSP-preserved indent
});

test('GFM table becomes a Table with a bold header and column alignment', () =>
{
    const md = ['| L | R |', '|:--|--:|', '| 1 | 2 |'].join('\n');
    const t = blocks(md)[0] as Table;
    assert.ok(t instanceof Table);
    const rows = t.Rows.ToArray();
    assert.equal(rows[0]!.IsHeader, true);
    const headerPara = rows[0]!.Cells.ToArray()[0]!.Blocks.ToArray()[0] as Paragraph;
    assert.ok(headerPara.Inlines.ToArray()[0] instanceof Bold);
    const bodyCells = rows[1]!.Cells.ToArray();
    const align = (i: number): TextAlignment => (bodyCells[i]!.Blocks.ToArray()[0] as Paragraph).TextAlignment;
    assert.equal(align(0), TextAlignment.Left);
    assert.equal(align(1), TextAlignment.Right);
});

test('horizontal rule renders as a hairline border in a paragraph', () =>
{
    const p = blocks('---')[0] as Paragraph;
    const box = inlines(p).find((x) => x instanceof InlineUIContainer) as InlineUIContainer;
    assert.ok(box.Child instanceof Border);
    assert.equal((box.Child as Border).Height, 1);
});

test('image renders inline when an image context is given, else falls back to alt text', () =>
{
    const withImg = firstInlines('![diagram](a.png)', { image: { baseDir: '', measure: async () => undefined } });
    const box = withImg.find((x) => x instanceof InlineUIContainer) as InlineUIContainer;
    assert.ok(box.Child instanceof Image);

    const noImg = firstInlines('![diagram](a.png)');
    assert.equal((noImg[0] as Run).Text, '[image: diagram]');
});

test('inline raw html maps whitelisted tags and nests', () =>
{
    const parts = firstInlines('a <b>bold</b> c');
    assert.deepEqual(parts.map((x) => (x as object).constructor.name), ['Run', 'Bold', 'Run']);
    assert.equal(((parts[1] as Bold).Inlines.ToArray()[0] as Run).Text, 'bold');
});

test('block raw html strips unknown tags but keeps text', () =>
{
    const p = blocks('<div>kept text</div>')[0] as Paragraph;
    assert.ok(p instanceof Paragraph);
    assert.equal((inlines(p)[0] as Run).Text, 'kept text');
});

// The rendered image for the first block, or undefined if it isn't an SVG image.
function svgImage(md: string): { w: number; h: number; uri: string } | undefined
{
    const c = inlines(blocks(md)[0] as Paragraph)[0];
    if (!(c instanceof InlineUIContainer) || !(c.Child instanceof Image)) return undefined;
    const src = c.Child.Source as BitmapImage;
    return { w: src.NaturalSize.Width, h: src.NaturalSize.Height, uri: src.Uri };
}

test('a ```svg fence is DRAWN at its author-set size, not shown as source', () =>
{
    const img = svgImage('```svg\n<svg width="512" height="512" viewBox="0 0 256 256"><path d="M0 0"/></svg>\n```');
    assert.ok(img !== undefined);
    assert.equal(img!.w, 512);
    assert.equal(img!.h, 512);
    assert.ok(img!.uri.startsWith('data:image/svg+xml'));
});

test('a raw <svg> block is DRAWN at its author-set size (not stripped to nothing)', () =>
{
    const img = svgImage('<svg width="128" height="64"><rect/></svg>');
    assert.ok(img !== undefined);
    assert.equal(img!.w, 128);
    assert.equal(img!.h, 64);
});

test('a non-SVG fence is still highlighted source, not an image', () =>
{
    const p = blocks('```js\nconst x = 1\n```')[0] as Paragraph;
    assert.ok(inlines(p).every((x) => x instanceof Run));   // code runs, no image container
});

test('an inline <svg> inside a table cell is DRAWN at its set size (icon grid)', () =>
{
    const md = [
        '| home |',
        '| :-: |',
        '| <svg width="32" height="32" viewBox="0 0 24 24"><path d="M1 2"/></svg> |',
    ].join('\n');
    const table = blocks(md)[0] as Table;
    const bodyCell = table.Rows.ToArray()[1]!.Cells.ToArray()[0]!;
    const cellPara = bodyCell.Blocks.ToArray()[0] as Paragraph;
    const c = inlines(cellPara)[0];
    assert.ok(c instanceof InlineUIContainer);
    const img = (c as InlineUIContainer).Child as Image;
    assert.ok(img instanceof Image);
    assert.equal((img.Source as BitmapImage).NaturalSize.Width, 32);
});

test('an inline <svg> among prose is drawn without dropping the surrounding text', () =>
{
    const parts = firstInlines('icon <svg width="16" height="16"><rect/></svg> done');
    assert.ok(parts.some((x) => x instanceof InlineUIContainer && (x as InlineUIContainer).Child instanceof Image));
    assert.ok(parts.some((x) => x instanceof Run && (x as Run).Text.includes('icon')));
    assert.ok(parts.some((x) => x instanceof Run && (x as Run).Text.includes('done')));
});

test('blockquote renders italic and muted', () =>
{
    const p = blocks('> quoted')[0] as Paragraph;
    assert.equal(p.FontStyle, FontStyle.Italic);
});

test('never throws on odd or partial input', () =>
{
    assert.doesNotThrow(() => MarkdownRenderer.Render('```\nunterminated'));
    assert.doesNotThrow(() => MarkdownRenderer.Render('| broken | table'));
    assert.doesNotThrow(() => MarkdownRenderer.Render(''));
});

// Review-Focus: rendering a remote image with no `measure` seam must not throw in
// a non-DOM (headless) test — the decode is fire-and-forget.
test('a remote image with no measure seam does not throw (headless)', () =>
{
    assert.doesNotThrow(() => MarkdownRenderer.Render('![x](https://x.test/y.png)', { image: { baseDir: '' } }));
});
