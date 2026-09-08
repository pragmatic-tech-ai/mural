import { BitmapImage, FontStyle, FontWeight, Stretch, TextAlignment, TextDecorations } from '../../../visual-engine/index.js';
import { FlowDocument } from '../../../basic/documents/flow-document.js';
import { Paragraph } from '../../../basic/documents/paragraph.js';
import { ImageDisplay, ImageInline, Run } from '../../../basic/documents/inlines.js';
import { DocumentParagraphs, ParagraphText } from '../../../basic/documents/text-navigation.js';
import { NormalizeParagraph } from '../../../basic/documents/text-editing.js';
import { Field, FieldKind } from '../shape-text-field.js';

// ─────────────────────────────────────────────────────────────────────
// ShapeText rich-content bridge (§ diagram-text Slice 4). A ShapeText's
// optional Document is a FlowDocument; these free functions convert it to
// and from a compact JSON form for Save/Load, project it to plain text
// (for the LabelText/Content fallback), build one from plain text (to seed
// the in-place RichTextBox editor), clone it (so the editor works on a copy
// the user can cancel), and decide whether a document is "really" rich.
//
// Scope: the in-place editor produces flat styled Runs varying only in
// bold / italic / underline (its Ctrl+B/I/U chords) plus per-paragraph
// alignment, so that is exactly what round-trips. Per-run font size / family
// / colour aren't editable in place yet and aren't persisted — they'd be
// dead fields. A later slice widens both together.

// An image inline's persisted form. `uri` is the ImageSource URI verbatim — a
// `data:` URI embeds the bytes (self-contained), an `http`/`blob` URI references
// (so both embed and external-reference modes ride one field). Size / stretch /
// display are omitted at their defaults.
export interface SerializedImage
{
    readonly uri:      string;
    readonly w?:       number;
    readonly h?:       number;
    readonly stretch?: Stretch;       // omitted when Uniform
    readonly display?: ImageDisplay;  // omitted when Inline
}

export interface SerializedRun
{
    readonly t: string;          // text (empty for a field / image)
    readonly b?: boolean;        // bold
    readonly i?: boolean;        // italic
    readonly u?: boolean;        // underline
    readonly f?: FieldKind;      // field key (§ Slice 6) — present iff this run is a Field
    readonly img?: SerializedImage;  // present iff this inline is an ImageInline
}

export interface SerializedParagraph
{
    readonly align?: TextAlignment;   // omitted when Left (the default)
    readonly runs:   readonly SerializedRun[];
}

export type SerializedDoc = readonly SerializedParagraph[];

// Snapshot a FlowDocument to JSON. Normalises each paragraph first so the
// inline tree is a flat run list (the form the editor already keeps).
export function serializeFlowDocument(doc: FlowDocument): SerializedDoc
{
    const out: SerializedParagraph[] = [];
    for (const p of DocumentParagraphs(doc))
    {
        NormalizeParagraph(p);
        const runs: SerializedRun[] = [];
        for (const inline of p.Inlines.ToArray())
        {
            if (inline instanceof ImageInline)
            {
                const src = inline.Source;
                if (src === undefined) continue;   // nothing to persist
                const img: { uri: string; w?: number; h?: number; stretch?: Stretch; display?: ImageDisplay } = { uri: src.Uri };
                if (inline.Width  !== undefined)          img.w = inline.Width;
                if (inline.Height !== undefined)          img.h = inline.Height;
                if (inline.Stretch !== Stretch.Uniform)   img.stretch = inline.Stretch;
                if (inline.Display !== ImageDisplay.Inline) img.display = inline.Display;
                runs.push({ t: '', img });
                continue;
            }
            if (!(inline instanceof Run)) continue;
            // A Field persists its key, not its resolved text (recomputed on
            // load by the owner). Check Field first — it extends Run.
            const r: { t: string; b?: boolean; i?: boolean; u?: boolean; f?: FieldKind } =
                inline instanceof Field ? { t: '', f: inline.FieldKey } : { t: inline.Text };
            if (inline.FontWeight === FontWeight.Bold)                        r.b = true;
            if (inline.FontStyle === FontStyle.Italic)                       r.i = true;
            if ((inline.TextDecorations & TextDecorations.Underline) !== 0)   r.u = true;
            runs.push(r);
        }
        const sp: { align?: TextAlignment; runs: SerializedRun[] } = { runs };
        if (p.TextAlignment !== TextAlignment.Left) sp.align = p.TextAlignment;
        out.push(sp);
    }
    return out;
}

// Rebuild a FlowDocument from its JSON snapshot.
export function deserializeFlowDocument(data: SerializedDoc): FlowDocument
{
    const doc = new FlowDocument();
    for (const sp of data)
    {
        const p = new Paragraph();
        if (sp.align !== undefined) p.TextAlignment = sp.align;
        for (const sr of sp.runs)
        {
            if (sr.img !== undefined)
            {
                p.Inlines.Add(new ImageInline(new BitmapImage(sr.img.uri), {
                    width: sr.img.w, height: sr.img.h, stretch: sr.img.stretch, display: sr.img.display,
                }));
                continue;
            }
            const run = sr.f !== undefined ? new Field(sr.f) : new Run(sr.t);
            if (sr.b === true) run.FontWeight      = FontWeight.Bold;
            if (sr.i === true) run.FontStyle       = FontStyle.Italic;
            if (sr.u === true) run.TextDecorations = TextDecorations.Underline;
            p.Inlines.Add(run);
        }
        doc.Blocks.Add(p);
    }
    return doc;
}

// Deep copy via the JSON form — used so the editor mutates a throwaway copy
// the user can cancel back to the original.
export function cloneFlowDocument(doc: FlowDocument): FlowDocument
{
    return deserializeFlowDocument(serializeFlowDocument(doc));
}

// The document's plain text — paragraphs joined by newlines. Backs the
// Content / LabelText projection for a rich label.
export function flowDocumentToPlainText(doc: FlowDocument): string
{
    return DocumentParagraphs(doc).map(ParagraphText).join('\n');
}

// A single-run paragraph per line — the seed for the in-place editor when a
// label is still plain. `align` (from the shape's TextAlignment) is stamped
// on each paragraph so promoting to rich keeps the caption's alignment.
export function flowDocumentFromPlainText(text: string, align: TextAlignment = TextAlignment.Left): FlowDocument
{
    const doc = new FlowDocument();
    for (const line of text.split('\n'))
    {
        const p = new Paragraph();
        if (align !== TextAlignment.Left) p.TextAlignment = align;
        p.Inlines.Add(new Run(line));
        doc.Blocks.Add(p);
    }
    return doc;
}

// True when a document carries nothing a plain string + the shape's own
// format DPs can't express: at most one paragraph, and every run in default
// weight / style / decoration. Alignment is ignored (the shape's
// TextAlignment covers it), so a plain centred caption stays plain after an
// edit instead of promoting to a heavier rich document.
export function isEffectivelyPlainDocument(doc: FlowDocument): boolean
{
    const paras = DocumentParagraphs(doc);
    if (paras.length > 1) return false;
    for (const p of paras)
    {
        NormalizeParagraph(p);
        for (const inline of p.Inlines.ToArray())
        {
            if (inline instanceof Field) return false;    // a live field is inherently rich
            if (!(inline instanceof Run)) return false;   // LineBreak / embedded visual → rich
            if (inline.FontWeight === FontWeight.Bold)                      return false;
            if (inline.FontStyle === FontStyle.Italic)                     return false;
            if ((inline.TextDecorations & TextDecorations.Underline) !== 0) return false;
        }
    }
    return true;
}
