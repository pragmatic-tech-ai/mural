import { Brush, FontFamily, FontStyle, FontWeight, type ImageSource, type Stretch, TextDecorations } from '../../visual-engine/index.js';
import { type Inline } from './text-element.js';
import { Run, Span, ImageInline, type ImageDisplay } from './inlines.js';
import { Paragraph } from './paragraph.js';
import { FlowDocument } from './flow-document.js';
import { type BlockCollection } from './block.js';
import { List, ListItem } from './list.js';
import { TextPointer, ParagraphRuns, ParagraphLength, ResolveOffset } from './text-pointer.js';
import { OrderPointers, ComparePointers, DocumentParagraphs, NextParagraph, PrevParagraph } from './text-navigation.js';

// ─────────────────────────────────────────────────────────────────────
// Editing operations — pure mutations on a FlowDocument at TextPointers.
// MuralBase changes bubble through the element Parent chain to re-measure the
// host. Every operation returns the caret's new TextPointer.
//
// Internal representation: the editor NORMALISES each edited paragraph to a
// flat list of independently-styled Runs — Bold / Italic / Underline / Span
// (and Hyperlink, losing only its link target) collapse into Run-level
// FontWeight / FontStyle / TextDecorations / Foreground / Font* DPs. The
// render is identical (a Run with FontWeight=Bold paints bold), but every
// op below becomes a clean array operation on the paragraph's top-level
// Inlines. First-cut limitation: InlineUIContainer inside an edited
// paragraph is dropped; Hyperlink keeps its text (underlined) but not its
// NavigateUri / Command.

interface Style
{
    family:      FontFamily | string | undefined;
    size:        number | undefined;
    weight:      FontWeight | undefined;
    style:       FontStyle | undefined;
    foreground:  Brush | undefined;
    decorations: TextDecorations;
}

const BLANK: Style = { family: undefined, size: undefined, weight: undefined, style: undefined, foreground: undefined, decorations: TextDecorations.None };

function runStyle(r: Run): Style
{
    return {
        family: r.FontFamily, size: r.FontSize, weight: r.FontWeight,
        style: r.FontStyle, foreground: r.Foreground, decorations: r.TextDecorations,
    };
}

function styledRun(text: string, s: Style): Run
{
    const r = new Run(text);
    if (s.family     !== undefined) r.FontFamily = s.family;
    if (s.size       !== undefined) r.FontSize = s.size;
    if (s.weight     !== undefined) r.FontWeight = s.weight;
    if (s.style      !== undefined) r.FontStyle = s.style;
    if (s.foreground !== undefined) r.Foreground = s.foreground;
    if (s.decorations !== TextDecorations.None) r.TextDecorations = s.decorations;
    return r;
}

/** Flatten a paragraph to a flat list of styled Runs (idempotent). Spans
 *  collapse into per-Run DPs; empty runs are dropped. ImageInlines are kept
 *  in place as atomic non-text inlines (they don't participate in the text
 *  offset model, but survive editing + re-render). Leaves a paragraph of
 *  top-level Runs interleaved with any ImageInlines. */
export function NormalizeParagraph(p: Paragraph): void
{
    // Already flat (only Runs and Images)? nothing to do.
    if (p.Inlines.ToArray().every((i) => i instanceof Run || i instanceof ImageInline)) return;

    const flat: Inline[] = [];
    const walk = (inlines: readonly Inline[], ctx: Style): void =>
    {
        for (const el of inlines)
        {
            if (el instanceof Run)
            {
                const merged: Style = { ...ctx };
                const own = runStyle(el);
                if (own.family     !== undefined) merged.family = own.family;
                if (own.size       !== undefined) merged.size = own.size;
                if (own.weight     !== undefined) merged.weight = own.weight;
                if (own.style      !== undefined) merged.style = own.style;
                if (own.foreground !== undefined) merged.foreground = own.foreground;
                merged.decorations |= own.decorations;
                if (el.Text.length > 0) flat.push(styledRun(el.Text, merged));
            }
            else if (el instanceof ImageInline)
            {
                // Atomic — kept as-is (identity preserved) at its position.
                flat.push(el);
            }
            else if (el instanceof Span)
            {
                const child: Style = { ...ctx };
                if (el.FontFamily !== undefined) child.family = el.FontFamily;
                if (el.FontSize   !== undefined) child.size = el.FontSize;
                if (el.FontWeight !== undefined) child.weight = el.FontWeight;
                if (el.FontStyle  !== undefined) child.style = el.FontStyle;
                if (el.Foreground !== undefined) child.foreground = el.Foreground;
                child.decorations |= el.TextDecorations;
                walk(el.Inlines.ToArray(), child);
            }
            // LineBreak / InlineUIContainer: dropped (first-cut limitation).
        }
    };
    walk(p.Inlines.ToArray(), { ...BLANK });

    p.Inlines.Clear();
    for (const el of flat) p.Inlines.Add(el);
}

// ── Container helpers ─────────────────────────────────────────────────
interface ParaContainer { blocks: BlockCollection; index: number; item: ListItem | undefined }

function paraContainer(p: Paragraph): ParaContainer | undefined
{
    const parent = p.Parent;
    if (parent instanceof FlowDocument) return { blocks: parent.Blocks, index: parent.Blocks.IndexOf(p), item: undefined };
    if (parent instanceof ListItem)     return { blocks: parent.Blocks, index: parent.Blocks.IndexOf(p), item: parent };
    return undefined;
}

// Remove a paragraph and clean up an emptied ListItem / List chain.
function removeParagraph(p: Paragraph): void
{
    const c = paraContainer(p);
    if (c === undefined) return;
    c.blocks.Remove(p);
    if (c.item !== undefined && c.item.Blocks.Count === 0) removeListItem(c.item);
}

function removeListItem(item: ListItem): void
{
    const list = item.Parent;
    if (!(list instanceof List)) return;
    list.ListItems.Remove(item);
    if (list.ListItems.Count === 0)
    {
        // List emptied — drop it from its own block container.
        const parent = list.Parent;
        if (parent instanceof FlowDocument) parent.Blocks.Remove(list);
        else if (parent instanceof ListItem) { parent.Blocks.Remove(list); if (parent.Blocks.Count === 0) removeListItem(parent); }
    }
}

// ── Insertion ─────────────────────────────────────────────────────────
/** Insert plain text at a pointer, inheriting the caret run's style. */
export function InsertText(_doc: FlowDocument, ptr: TextPointer, text: string): TextPointer
{
    if (text === '') return ptr.Clone();
    NormalizeParagraph(ptr.Paragraph);
    const at = ResolveOffset(ptr.Paragraph, ptr.Offset);
    if (at === undefined)
    {
        // Empty paragraph — seed a Run.
        ptr.Paragraph.Inlines.Add(new Run(text));
        return new TextPointer(ptr.Paragraph, text.length);
    }
    const run = at.slot.run;
    run.Text = run.Text.slice(0, at.index) + text + run.Text.slice(at.index);
    return new TextPointer(ptr.Paragraph, ptr.Offset + text.length);
}

/** Insert an image inline at a pointer, splitting the caret run so the image
 *  lands between the two halves. The image is atomic (not part of the text
 *  offset space), so the returned caret keeps the same offset — it now sits
 *  just before the image. Returns the (unchanged-offset) caret. */
export function InsertImage(
    _doc: FlowDocument, ptr: TextPointer, source: ImageSource,
    opts?: { width?: number; height?: number; stretch?: Stretch; display?: ImageDisplay },
): TextPointer
{
    NormalizeParagraph(ptr.Paragraph);
    const img = new ImageInline(source, opts);
    const at = ResolveOffset(ptr.Paragraph, ptr.Offset);
    if (at === undefined)
    {
        // Empty paragraph — the image is the sole inline.
        ptr.Paragraph.Inlines.Add(img);
        return ptr.Clone();
    }
    const run = at.slot.run;
    const idx = ptr.Paragraph.Inlines.IndexOf(run);
    if (at.index <= 0)
    {
        ptr.Paragraph.Inlines.Insert(idx, img);                 // before the run
    }
    else if (at.index >= run.Text.length)
    {
        ptr.Paragraph.Inlines.Insert(idx + 1, img);             // after the run
    }
    else
    {
        // Straddles — split the run and drop the image between the halves.
        const right = styledRun(run.Text.slice(at.index), runStyle(run));
        run.Text = run.Text.slice(0, at.index);
        ptr.Paragraph.Inlines.Insert(idx + 1, img);
        ptr.Paragraph.Inlines.Insert(idx + 2, right);
    }
    return ptr.Clone();
}

/** Remove an image inline from its paragraph. */
export function RemoveImage(_doc: FlowDocument, image: ImageInline): void
{
    const p = image.Parent;
    if (p instanceof Paragraph) p.Inlines.Remove(image);
}

// ── Deletion ──────────────────────────────────────────────────────────
// Delete [start, end) within ONE paragraph (of flat Runs).
function deleteWithinParagraph(p: Paragraph, start: number, end: number): void
{
    if (end <= start) return;
    // Walk a snapshot; mutate/remove runs by overlap.
    for (const slot of ParagraphRuns(p))
    {
        const rStart = slot.start;
        const rEnd = rStart + slot.run.Text.length;
        const lo = Math.max(start, rStart);
        const hi = Math.min(end, rEnd);
        if (hi <= lo) continue;
        const a = lo - rStart, b = hi - rStart;
        slot.run.Text = slot.run.Text.slice(0, a) + slot.run.Text.slice(b);
    }
    // Drop runs emptied by the delete.
    for (const r of p.Inlines.ToArray()) if (r instanceof Run && r.Text.length === 0) p.Inlines.Remove(r);
}

// Move all of `src`'s runs to the end of `dst`, then remove `src`.
function mergeParagraphInto(dst: Paragraph, src: Paragraph): void
{
    NormalizeParagraph(dst);
    NormalizeParagraph(src);
    for (const r of src.Inlines.ToArray()) { src.Inlines.Remove(r); dst.Inlines.Add(r); }
    removeParagraph(src);
}

/** Delete the content between two pointers, merging paragraphs when the
 *  range spans them. Returns the caret at the (normalised) low end. */
export function DeleteRange(doc: FlowDocument, a: TextPointer, b: TextPointer): TextPointer
{
    const [lo, hi] = OrderPointers(doc, a, b);
    if (lo.Equals(hi)) return lo.Clone();

    if (lo.Paragraph === hi.Paragraph)
    {
        NormalizeParagraph(lo.Paragraph);
        deleteWithinParagraph(lo.Paragraph, lo.Offset, hi.Offset);
        return new TextPointer(lo.Paragraph, lo.Offset);
    }

    // Cross-paragraph: trim the tail of lo, the head of hi, drop the
    // paragraphs strictly between, then merge hi's remainder into lo.
    NormalizeParagraph(lo.Paragraph);
    NormalizeParagraph(hi.Paragraph);
    deleteWithinParagraph(lo.Paragraph, lo.Offset, ParagraphLength(lo.Paragraph));
    deleteWithinParagraph(hi.Paragraph, 0, hi.Offset);

    const all = DocumentParagraphs(doc);
    const loI = all.indexOf(lo.Paragraph);
    const hiI = all.indexOf(hi.Paragraph);
    for (let i = loI + 1; i < hiI; i++) removeParagraph(all[i]!);

    const caret = new TextPointer(lo.Paragraph, lo.Offset);
    mergeParagraphInto(lo.Paragraph, hi.Paragraph);
    return caret;
}

/** Backspace: delete the char before the caret, or (at offset 0) outdent a
 *  list item / merge with the previous paragraph. */
export function DeleteBack(doc: FlowDocument, ptr: TextPointer): TextPointer
{
    if (ptr.Offset > 0)
        return DeleteRange(doc, new TextPointer(ptr.Paragraph, ptr.Offset - 1), ptr);

    // At paragraph start.
    const c = paraContainer(ptr.Paragraph);
    if (c !== undefined && c.item !== undefined && c.index === 0)
        return OutdentParagraph(doc, ptr);   // first para of a list item → outdent

    const prev = PrevParagraph(doc, ptr.Paragraph);
    if (prev === undefined) return ptr.Clone();   // start of document
    const caret = new TextPointer(prev, ParagraphLength(prev));
    mergeParagraphInto(prev, ptr.Paragraph);
    return caret;
}

/** Delete: remove the char after the caret, or (at paragraph end) pull the
 *  next paragraph up into this one. */
export function DeleteForward(doc: FlowDocument, ptr: TextPointer): TextPointer
{
    const len = ParagraphLength(ptr.Paragraph);
    if (ptr.Offset < len)
        return DeleteRange(doc, ptr, new TextPointer(ptr.Paragraph, ptr.Offset + 1));

    const next = NextParagraph(doc, ptr.Paragraph);
    if (next === undefined) return ptr.Clone();
    const caret = ptr.Clone();
    mergeParagraphInto(ptr.Paragraph, next);
    return caret;
}

// ── Paragraph split (Enter) ───────────────────────────────────────────
/** Split the paragraph at the caret. In a list, an EMPTY item exits the
 *  list; otherwise a new item is created after the current one. Returns the
 *  caret at the start of the new paragraph. */
export function SplitParagraph(doc: FlowDocument, ptr: TextPointer): TextPointer
{
    NormalizeParagraph(ptr.Paragraph);
    const c = paraContainer(ptr.Paragraph);

    // Enter in an empty list item → exit the list.
    if (c !== undefined && c.item !== undefined && ParagraphLength(ptr.Paragraph) === 0)
        return OutdentParagraph(doc, ptr);

    // Build the trailing paragraph from content at/after the caret.
    const tail = new Paragraph();
    const runs = ParagraphRuns(ptr.Paragraph);
    for (const slot of runs)
    {
        const rEnd = slot.start + slot.run.Text.length;
        if (rEnd <= ptr.Offset) continue;                    // fully before caret — stays
        if (slot.start >= ptr.Offset)                        // fully after — moves whole
        {
            ptr.Paragraph.Inlines.Remove(slot.run);
            tail.Inlines.Add(slot.run);
        }
        else                                                 // straddles — split
        {
            const cut = ptr.Offset - slot.start;
            const right = styledRun(slot.run.Text.slice(cut), runStyle(slot.run));
            slot.run.Text = slot.run.Text.slice(0, cut);
            tail.Inlines.Add(right);
        }
    }

    if (c !== undefined && c.item !== undefined)
    {
        // In a list: new sibling ListItem after the current one.
        const list = c.item.Parent as List;
        const item = new ListItem();
        item.AddChild(tail);
        list.ListItems.Insert(list.ListItems.IndexOf(c.item) + 1, item);
    }
    else if (c !== undefined)
    {
        c.blocks.Insert(c.index + 1, tail);
    }
    return new TextPointer(tail, 0);
}

// ── Formatting toggles (Ctrl+B / I / U) ───────────────────────────────
export enum FormatKind { Bold = 'bold', Italic = 'italic', Underline = 'underline', Strikethrough = 'strikethrough' }

// Split the run straddling `offset` so a run boundary lands exactly there.
function splitRunAt(p: Paragraph, offset: number): void
{
    for (const slot of ParagraphRuns(p))
    {
        const rEnd = slot.start + slot.run.Text.length;
        if (offset > slot.start && offset < rEnd)
        {
            const cut = offset - slot.start;
            const right = styledRun(slot.run.Text.slice(cut), runStyle(slot.run));
            slot.run.Text = slot.run.Text.slice(0, cut);
            const cont = p.Inlines.IndexOf(slot.run);
            p.Inlines.Insert(cont + 1, right);
            return;
        }
    }
}

function runHasFormat(r: Run, kind: FormatKind): boolean
{
    if (kind === FormatKind.Bold)      return r.FontWeight === FontWeight.Bold;
    if (kind === FormatKind.Italic)    return r.FontStyle === FontStyle.Italic;
    const flag = kind === FormatKind.Strikethrough ? TextDecorations.Strikethrough : TextDecorations.Underline;
    return (r.TextDecorations & flag) !== 0;
}

function setRunFormat(r: Run, kind: FormatKind, on: boolean): void
{
    if (kind === FormatKind.Bold)   { r.FontWeight = on ? FontWeight.Bold : FontWeight.Normal; return; }
    if (kind === FormatKind.Italic) { r.FontStyle  = on ? FontStyle.Italic : FontStyle.Normal; return; }
    const flag = kind === FormatKind.Strikethrough ? TextDecorations.Strikethrough : TextDecorations.Underline;
    r.TextDecorations = on ? (r.TextDecorations | flag) : (r.TextDecorations & ~flag);
}

// The runs of paragraph `p` fully inside [start, end).
function runsInRange(p: Paragraph, start: number, end: number): Run[]
{
    const out: Run[] = [];
    for (const slot of ParagraphRuns(p))
    {
        const rEnd = slot.start + slot.run.Text.length;
        if (slot.start >= start && rEnd <= end) out.push(slot.run);
    }
    return out;
}

// Split at the selection endpoints so run boundaries align to [a,b), then
// return the runs fully inside the selection. Shared by every selection-scoped
// character-format op (toggle, set, query) so they all split + gather identically.
function coveredRuns(doc: FlowDocument, a: TextPointer, b: TextPointer): Run[]
{
    const [lo, hi] = OrderPointers(doc, a, b);
    if (lo.Equals(hi)) return [];

    const all = DocumentParagraphs(doc);
    const loI = all.indexOf(lo.Paragraph);
    const hiI = all.indexOf(hi.Paragraph);

    for (let i = loI; i <= hiI; i++)
    {
        const p = all[i]!;
        NormalizeParagraph(p);
        const start = i === loI ? lo.Offset : 0;
        const end   = i === hiI ? hi.Offset : ParagraphLength(p);
        splitRunAt(p, start);
        splitRunAt(p, end);
    }

    const covered: Run[] = [];
    for (let i = loI; i <= hiI; i++)
    {
        const p = all[i]!;
        const start = i === loI ? lo.Offset : 0;
        const end   = i === hiI ? hi.Offset : ParagraphLength(p);
        covered.push(...runsInRange(p, start, end));
    }
    return covered;
}

/** Toggle a character format over a selection. If every covered run already
 *  carries the format it is removed, else it is applied (WPF toggle). */
export function ToggleFormat(doc: FlowDocument, a: TextPointer, b: TextPointer, kind: FormatKind): void
{
    const covered = coveredRuns(doc, a, b);
    if (covered.length === 0) return;
    const allSet = covered.every((r) => runHasFormat(r, kind));
    for (const r of covered) setRunFormat(r, kind, !allSet);
}

/** Set (not toggle) a character format on every run in the selection. */
export function SetFormat(doc: FlowDocument, a: TextPointer, b: TextPointer, kind: FormatKind, on: boolean): void
{
    for (const r of coveredRuns(doc, a, b)) setRunFormat(r, kind, on);
}

/** Apply an arbitrary run mutation (font family / size / colour) to every run
 *  in the selection, splitting at the endpoints first. */
export function SetRunStyle(doc: FlowDocument, a: TextPointer, b: TextPointer, apply: (r: Run) => void): void
{
    for (const r of coveredRuns(doc, a, b)) apply(r);
}

// Runs whose extent intersects [a,b) — WITHOUT splitting. Read-only queries use
// this so reflecting the toolbar never mutates the document (splitting on every
// caret move would churn the run structure needlessly). A run straddling an
// endpoint counts: it covers part of the selection, so its format is relevant.
function overlappingRuns(doc: FlowDocument, a: TextPointer, b: TextPointer): Run[]
{
    const [lo, hi] = OrderPointers(doc, a, b);
    if (lo.Equals(hi)) return [];
    const all = DocumentParagraphs(doc);
    const loI = all.indexOf(lo.Paragraph);
    const hiI = all.indexOf(hi.Paragraph);
    if (loI < 0 || hiI < 0) return [];
    const out: Run[] = [];
    for (let i = loI; i <= hiI; i++)
    {
        const p = all[i]!;
        const start = i === loI ? lo.Offset : 0;
        const end   = i === hiI ? hi.Offset : ParagraphLength(p);
        for (const slot of ParagraphRuns(p))
        {
            const rEnd = slot.start + slot.run.Text.length;
            if (slot.start < end && rEnd > start) out.push(slot.run);
        }
    }
    return out;
}

/** True when the format `kind` covers a run — read-only. `strict` (default)
 *  requires EVERY overlapping run to carry it (the "is the whole selection
 *  bold?" toolbar question). */
export function QueryFormatActive(doc: FlowDocument, a: TextPointer, b: TextPointer, kind: FormatKind): boolean
{
    const runs = overlappingRuns(doc, a, b);
    return runs.length > 0 && runs.every((r) => runHasFormat(r, kind));
}

/** True when a single run carries `kind` — for reflecting a collapsed caret. */
export function RunHasFormat(r: Run, kind: FormatKind): boolean { return runHasFormat(r, kind); }

/** Read a value common to every run overlapping the selection, or `undefined`
 *  when the selection is empty OR the runs disagree (mixed → no single toolbar
 *  value). Read-only. `read` should return a primitive so equality is by value. */
export function QueryRunValue<T>(doc: FlowDocument, a: TextPointer, b: TextPointer, read: (r: Run) => T): T | undefined
{
    const runs = overlappingRuns(doc, a, b);
    if (runs.length === 0) return undefined;
    const first = read(runs[0]!);
    for (const r of runs) if (read(r) !== first) return undefined;
    return first;
}

// ── List indent / outdent (Tab / Shift+Tab) ───────────────────────────
/** Indent a list item one level: it becomes a sub-item of the preceding
 *  sibling. No-op if the paragraph isn't in a list or has no previous
 *  sibling. Returns the caret unchanged (same paragraph). */
export function IndentParagraph(_doc: FlowDocument, ptr: TextPointer): TextPointer
{
    const c = paraContainer(ptr.Paragraph);
    if (c === undefined || c.item === undefined) return ptr.Clone();
    const item = c.item;
    const list = item.Parent as List;
    const idx = list.ListItems.IndexOf(item);
    if (idx <= 0) return ptr.Clone();   // need a preceding sibling to nest under

    const prev = list.ListItems.Get(idx - 1)!;
    // Reuse a trailing nested List on the previous item, else create one.
    const blocks = prev.Blocks.ToArray();
    let nested = blocks.length > 0 && blocks[blocks.length - 1] instanceof List
        ? blocks[blocks.length - 1] as List : undefined;
    if (nested === undefined)
    {
        nested = new List();
        nested.MarkerStyle = list.MarkerStyle;
        prev.AddChild(nested);
    }
    list.ListItems.Remove(item);
    nested.ListItems.Add(item);
    return ptr.Clone();
}

/** Outdent a list item one level: a nested item moves up to sit after its
 *  parent item in the grandparent list; a top-level item leaves the list,
 *  its paragraphs becoming blocks in the FlowDocument. Returns the caret. */
export function OutdentParagraph(_doc: FlowDocument, ptr: TextPointer): TextPointer
{
    const c = paraContainer(ptr.Paragraph);
    if (c === undefined || c.item === undefined) return ptr.Clone();
    const item = c.item;
    const list = item.Parent as List;
    const listParent = list.Parent;

    if (listParent instanceof ListItem)
    {
        // Nested → move item up after its parent item in the grandparent list.
        const grand = listParent.Parent as List;
        const gi = grand.ListItems.IndexOf(listParent);
        list.ListItems.Remove(item);
        grand.ListItems.Insert(gi + 1, item);
        // Remove the now-empty nested list from its owning parent item.
        if (list.ListItems.Count === 0) listParent.Blocks.Remove(list);
        return new TextPointer(ptr.Paragraph, ptr.Offset);
    }

    // Top-level list → item exits into the FlowDocument as plain paragraphs,
    // inserted right after the list.
    if (listParent instanceof FlowDocument)
    {
        const listIdx = listParent.Blocks.IndexOf(list);
        const moved = item.Blocks.ToArray();
        list.ListItems.Remove(item);
        let insertAt = listIdx + 1;
        for (const b of moved) { item.Blocks.Remove(b); listParent.Blocks.Insert(insertAt++, b); }
        if (list.ListItems.Count === 0) listParent.Blocks.Remove(list);
        return new TextPointer(ptr.Paragraph, ptr.Offset);
    }
    return ptr.Clone();
}

// Re-exported for the host so it can order pointers for selection display.
export { ComparePointers };
