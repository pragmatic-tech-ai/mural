import { MetaData, MuralBase } from '../../runtime/index.js';
import { FlowDocument } from '../../basic/documents/flow-document.js';
import { Paragraph } from '../../basic/documents/paragraph.js';
import { Run } from '../../basic/documents/inlines.js';
import { DocumentParagraphs } from '../../basic/documents/text-navigation.js';

// ─────────────────────────────────────────────────────────────────────
// Text fields (§ board-text Slice 6). A Field is an inline whose text is
// a LIVE value resolved from the owning shape / connector (its width, kind,
// a connector's length, …) rather than authored characters.
//
// Field extends Run on purpose: the whole flow-content pipeline (layout,
// caret navigation, plain-text projection, in-place editing) treats it as
// ordinary text through its computed `.Text`, so nothing in basic/documents
// needs to know fields exist. What distinguishes it is `FieldKey` — the
// identifier that says WHICH value it shows and that PERSISTS (the resolved
// text is recomputed, never stored). The owner pushes the current value into
// `.Text` via resolveFields() on every relevant change.
//
// Fields are inserted programmatically / on load (no in-place field-insert
// UI yet) and are expected at the top level of a paragraph — a field nested
// inside a Span is flattened to a plain Run by NormalizeParagraph and loses
// its key. A markup-facing `Field [Key=Width]` (and symbol-table wiring)
// is a later refinement; for now FieldKind stays internal.

export enum FieldKind
{
    // Figure geometry / identity.
    Width    = 'Width',
    Height   = 'Height',
    Left     = 'Left',
    Top      = 'Top',
    Kind     = 'Kind',
    Id       = 'Id',
    // Connector.
    Length   = 'Length',
    SourceId = 'SourceId',
    TargetId = 'TargetId',
}

// True when `s` names a known field kind — used by the token parser to tell
// a real field from stray braces.
export function isFieldKind(s: string): s is FieldKind
{
    return (Object.values(FieldKind) as string[]).includes(s);
}

export class Field extends Run
{
    // Named FieldKey (not Key) to stay clear of any future generic 'Key'.
    public static readonly FieldKeyKey = MuralBase.RegisterProperty<FieldKind>(
        Field, 'FieldKey', FieldKind.Width, MetaData.None);

    constructor(key: FieldKind = FieldKind.Width, initial = '')
    {
        super(initial);
        this.FieldKey = key;
    }

    public get FieldKey(): FieldKind  { return this.get_property_value(Field.FieldKeyKey); }
    public set FieldKey(v: FieldKind) { this.set_property_value(Field.FieldKeyKey, v); }
}

// Resolve a field's live value, or undefined when the owner doesn't supply
// this kind (a Figure has no Length, a Connector no Width).
export type FieldResolver = (key: FieldKind) => string | undefined;

// Push resolved values into every Field in the document. An unsupported key
// shows its token ({Key}) so a wrong / unhosted field is visible, not blank.
// Setting Field.Text bubbles through the inline tree → the host re-measures
// and repaints, so a resolve after a source change is fully reactive.
export function resolveFields(doc: FlowDocument, resolve: FieldResolver): void
{
    for (const p of DocumentParagraphs(doc))
    {
        for (const inline of p.Inlines.ToArray())
        {
            if (inline instanceof Field)
            {
                const v = resolve(inline.FieldKey);
                inline.Text = v !== undefined ? v : `{${inline.FieldKey}}`;
            }
        }
    }
}

// Author a single-paragraph document from a template string: `{Width}` and
// other `{FieldKind}` tokens become Fields, everything else literal Runs.
// A `{token}` that isn't a known field kind stays literal text. Great for
// demos / tests — `documentWithFields('{Width} × {Height}')`.
export function documentWithFields(template: string): FlowDocument
{
    const doc = new FlowDocument();
    const p = new Paragraph();
    const re = /\{([^}]*)\}/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(template)) !== null)
    {
        if (m.index > last) p.Inlines.Add(new Run(template.slice(last, m.index)));
        const token = m[1]!;
        if (isFieldKind(token)) p.Inlines.Add(new Field(token));
        else                    p.Inlines.Add(new Run(m[0]!));   // stray braces → literal
        last = m.index + m[0]!.length;
    }
    if (last < template.length) p.Inlines.Add(new Run(template.slice(last)));
    doc.Blocks.Add(p);
    return doc;
}
