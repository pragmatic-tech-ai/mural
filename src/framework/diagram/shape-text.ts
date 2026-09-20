import {
    Element,
    Key,
    type KeyEventArgs,
    MetaData,
    MuralBase,
    Point,
    type PropertyDescriptor,
    Rect,
    Size,
    Thickness,
    Visual,
} from '../../runtime/index.js';
import { Brush, Color, FontFamily, FontStyle, FontWeight, RotateTransform, ScaleTransform, SolidColorBrush, TextAlignment, TextDecorations, TransformGroup, VerticalAlignment } from '../../visual-engine/index.js';
import { TextWrapping } from '../../basic/text-block.js';
import { RichTextBox } from '../../basic/rich-text-box.js';
import { FlowDocument } from '../../basic/documents/flow-document.js';
import { DocumentParagraphs } from '../../basic/documents/text-navigation.js';
import { ParagraphRuns } from '../../basic/documents/text-pointer.js';
import { type Run } from '../../basic/documents/inlines.js';
import { DiagramSettings } from './diagram-settings.js';

// Normalise FontFamily (string | FontFamily | undefined) to a family-name
// string so a toolbar picker's `Text` DP reflects it and a `<< Is(...)`-free
// binding round-trips. Shared shape with rich-text-box's helper of the same name.
function familyName(v: FontFamily | string | undefined): string | undefined
{
    if (v === undefined) return undefined;
    return typeof v === 'string' ? v : v.Source;
}
import { Control } from '../base/control.js';
import {
    cloneFlowDocument,
    flowDocumentFromPlainText,
    flowDocumentToPlainText,
    isEffectivelyPlainDocument,
} from './serialization/shape-text-document.js';

// The block-level text-style surface FormatMirror seeds from and broadcasts to.
// ShapeText satisfies it (a geometric shape's caption), and a content view-model
// whose label lives outside a ShapeText (an arch node's `$Label` tile) can expose
// its own `ITextStyleTarget` so the Format Shape Text page reaches that label too
// — the character/paragraph analogue of FormatMirror's Fill/Stroke paint-target
// redirect. Apply* mutate the style; Current* read it back for toolbar seeding.
export interface ITextStyleTarget
{
    ApplyFontFamily(family: FontFamily | string): void;
    ApplyFontSize(size: number): void;
    ApplyForeground(brush: Brush): void;
    ApplyBold(on: boolean): void;
    ApplyItalic(on: boolean): void;
    ApplyUnderline(on: boolean): void;
    ApplyStrikethrough(on: boolean): void;
    ApplyParagraphAlignment(align: TextAlignment): void;
    CurrentFontFamily(): string;
    CurrentFontSize(): number;
    CurrentForeground(): Brush | undefined;
    CurrentBold(): boolean;
    CurrentItalic(): boolean;
    CurrentUnderline(): boolean;
    CurrentStrikethrough(): boolean;
    CurrentParagraphAlignment(): TextAlignment;
}

// ShapeText — a diagram shape's text block, modelled as a first-class
// sub-control (the Visio "text block"). A Figure / Group / Connector owns
// one and hosts it in its template; ShapeText renders its own content +
// formatting reactively from its DPs via TemplateBindings, so mutating
// `Content` (or any formatting DP) repaints without the holder wiring a
// per-property subscription — the "nested binding path isn't reactive"
// trap that a `$$Text.Content` label on the Figure would otherwise hit.
//
// This is the spine the diagram-text layers build on (§ diagram-text):
//   * Slice 1: content + character/paragraph formatting + margins +
//     background, centred over the shape.
//   * Slice 3 (here): the independent text-block transform — Offset /
//     BlockWidth / BlockHeight / Angle / Placement presets + vertical
//     alignment within the block. ShapeText fills the shape footprint and
//     lays its block out itself (custom Measure / Arrange), so a VM or the
//     text-block adorner can move / size / rotate the label without the
//     holder wiring anything.
//   * Slice 4 (here): optional rich content. A `Document` (FlowDocument)
//     rides ALONGSIDE the plain `Content` string and wins for display when
//     set; `Content` stays the plain projection (and the LabelText sugar).
//     In-place editing always goes through a RichTextBox — Esc / click-away
//     commit (Enter is a paragraph break). A committed edit that carries no
//     formatting collapses back to a plain `Content` label, so simple
//     captions never turn "rich" behind the user's back.
//
// Default Template (diagram.template.mu, @DefaultShapeText): a Border
// (Fill + Padding) hosting a TextBlock whose Text / alignment / font
// ride TemplateBindings to the DPs below. Placement / Offset / Angle are
// NOT template bindings — ShapeText positions + rotates the template root
// itself in MeasureOverride / ArrangeOverride so an off-centre or rotated
// block needs no extra markup.

// Default label ink — black (Visio/drawio convention). Shared module const
// used as the Foreground DP default, mirroring Figure's shared DEFAULT_FILL;
// never mutated in place (no text-foreground editor), so sharing is safe.
const DEFAULT_INK = new SolidColorBrush(Color.Black);

// Where the text block sits relative to the shape footprint (the Visio
// "text block position" presets). The nine INSIDE anchors pin the block —
// at its BlockWidth × BlockHeight, or the full footprint when auto — to a
// point within the shape; the four OUTSIDE anchors float it just beyond an
// edge (auto-sized to its content), centred along that edge. `Offset`
// fine-tunes any of them; `Angle` rotates the placed block about its own
// centre. Set programmatically / by the text-block adorner / on load; not
// yet markup-facing (a distinct property name would be needed to coexist
// with Popup's `Placement` / `PlacementMode`), so it's kept out of the
// compiler symbol table for now.
export enum TextPlacement
{
    Center      = 'center',
    Top         = 'top',
    Bottom      = 'bottom',
    Left        = 'left',
    Right       = 'right',
    TopLeft     = 'top-left',
    TopRight    = 'top-right',
    BottomLeft  = 'bottom-left',
    BottomRight = 'bottom-right',
    // Outside the footprint, centred along the named edge.
    Above       = 'above',
    Below       = 'below',
    LeftOf      = 'left-of',
    RightOf     = 'right-of',
}

// Outside placements float the block beyond the footprint and auto-size to
// content; inside placements fill / anchor within the footprint.
export function isOutsideTextPlacement(p: TextPlacement): boolean
{
    return p === TextPlacement.Above || p === TextPlacement.Below
        || p === TextPlacement.LeftOf || p === TextPlacement.RightOf;
}

// For an auto-sized INSIDE placement, whether the block fills the footprint
// along an axis (so the anchor is centred and TextAlignment /
// VerticalTextAlignment still position the text within the FULL footprint) vs.
// hugs its content and pins to an edge (so the 9-grid visibly moves the label).
// A horizontally-centred placement (Center / Top / Bottom) fills the WIDTH; a
// vertically-centred one (Center / Left / Right) fills the HEIGHT. Edge / corner
// placements hug content on the pinned axis. Center fills both → identical to a
// footprint-filling block (no regression for the default). Only consulted when
// BlockWidth / BlockHeight are auto (NaN); an explicit block size always wins.
function fillsFootprintWidth(p: TextPlacement): boolean
{
    return p === TextPlacement.Center || p === TextPlacement.Top || p === TextPlacement.Bottom;
}
function fillsFootprintHeight(p: TextPlacement): boolean
{
    return p === TextPlacement.Center || p === TextPlacement.Left || p === TextPlacement.Right;
}

// Top-left of a `bw × bh` block placed at `placement` within an `fw × fh`
// footprint. Shared by ShapeText's ArrangeOverride and the text-block
// adorner so on-canvas chrome tracks the rendered block exactly.
export function computeTextBlockAnchor(
    placement: TextPlacement, fw: number, fh: number, bw: number, bh: number,
): { x: number; y: number }
{
    const cx = (fw - bw) / 2;   // horizontally centred
    const cy = (fh - bh) / 2;   // vertically centred
    const rx = fw - bw;         // right-aligned
    const by = fh - bh;         // bottom-aligned
    switch (placement)
    {
        case TextPlacement.Center:      return { x: cx, y: cy };
        case TextPlacement.Top:         return { x: cx, y: 0  };
        case TextPlacement.Bottom:      return { x: cx, y: by };
        case TextPlacement.Left:        return { x: 0,  y: cy };
        case TextPlacement.Right:       return { x: rx, y: cy };
        case TextPlacement.TopLeft:     return { x: 0,  y: 0  };
        case TextPlacement.TopRight:    return { x: rx, y: 0  };
        case TextPlacement.BottomLeft:  return { x: 0,  y: by };
        case TextPlacement.BottomRight: return { x: rx, y: by };
        case TextPlacement.Above:       return { x: cx, y: -bh };
        case TextPlacement.Below:       return { x: cx, y: fh  };
        case TextPlacement.LeftOf:      return { x: -bw, y: cy };
        case TextPlacement.RightOf:     return { x: fw,  y: cy };
        default:                        return { x: cx, y: cy };
    }
}

// Text auto-fit modes (§ diagram-text Slice 7), mirroring Visio's text
// block auto-size. None: text wraps / overflows the block as-is. ShrinkText:
// the block scales its content down so it fits the footprint (crisp vector
// downscale). GrowShape: the OWNER shape grows to contain the label — a
// Figure-only mode the Figure implements by observing this DP (a connector
// has no shape to grow, so it treats GrowShape as None).
export enum TextAutoFit
{
    None       = 'none',
    ShrinkText = 'shrink',
    GrowShape  = 'grow',
}

export class ShapeText extends Control implements ITextStyleTarget
{
    static
    {
        // Without this, applyDefaultStyle() silently no-ops and the control
        // renders no template (see memory: diagram-control-default-style-key).
        MuralBase.OverrideMetadata(ShapeText, Element.DefaultStyleKeyKey, { default_value: ShapeText });
    }

    // The text itself. Measure-affecting so a re-word relays out the block.
    public static readonly ContentKey = MuralBase.RegisterProperty<string>(
        ShapeText, 'Content', '', MetaData.Measure);

    // Optional rich content (§ Slice 4). When set, the shape displays a
    // RichTextBlock over this FlowDocument, and it WINS over Content for
    // display; Content stays the plain-text projection (kept in sync on
    // commit) and backs the LabelText sugar. Measure — a doc swap re-lays
    // out the block.
    public static readonly DocumentKey = MuralBase.RegisterProperty<FlowDocument | undefined>(
        ShapeText, 'Document', undefined, MetaData.Measure);
    // Derived mirror of "Document is set", kept in sync in OnPropertyChanged.
    // The template's display swap needs a boolean a `when (…)` trigger can
    // test (a trigger can't compare Document against null directly).
    public static readonly HasRichContentKey = MuralBase.RegisterProperty<boolean>(
        ShapeText, 'HasRichContent', false, MetaData.None);

    // ── Character formatting ────────────────────────────────────────
    // Defaults tuned for a diagram label (12dp, normal weight). Foreground
    // defaults to black ink (Visio/drawio convention) so labels read the same
    // regardless of the ambient theme; assign a Brush to override per label.
    public static readonly FontSizeKey = MuralBase.RegisterProperty<number>(
        ShapeText, 'FontSize', 12, MetaData.Measure | MetaData.Render);
    public static readonly FontWeightKey = MuralBase.RegisterProperty<FontWeight>(
        ShapeText, 'FontWeight', FontWeight.Normal, MetaData.Measure | MetaData.Render);
    public static readonly FontStyleKey = MuralBase.RegisterProperty<FontStyle>(
        ShapeText, 'FontStyle', FontStyle.Normal, MetaData.Measure | MetaData.Render);
    public static readonly ForegroundKey = MuralBase.RegisterProperty<Brush | undefined>(
        ShapeText, 'Foreground', DEFAULT_INK, MetaData.Render);
    // Font family (a CSS-style stack, tolerant of a raw string like TextBlock).
    // undefined → the template TextBlock's own default. Measure — a family swap
    // re-metrics the text.
    public static readonly FontFamilyKey = MuralBase.RegisterProperty<FontFamily | string | undefined>(
        ShapeText, 'FontFamily', undefined, MetaData.Measure | MetaData.Render);
    // Block-level text decorations (underline / strikethrough) for a PLAIN label.
    // Rich content carries decorations per-Run instead; this drives the plain
    // PART_Text display via a TemplateBinding.
    public static readonly TextDecorationsKey = MuralBase.RegisterProperty<TextDecorations>(
        ShapeText, 'TextDecorations', TextDecorations.None, MetaData.Render);

    // ── Paragraph / block formatting ────────────────────────────────
    // M3/Visio default: centred, wrapping within the block.
    public static readonly TextAlignmentKey = MuralBase.RegisterProperty<TextAlignment>(
        ShapeText, 'TextAlignment', TextAlignment.Center, MetaData.Render);
    public static readonly TextWrappingKey = MuralBase.RegisterProperty<TextWrapping>(
        ShapeText, 'TextWrapping', TextWrapping.Wrap, MetaData.Measure);
    // Inner text inset (Visio's Left/Right/Top/BottomMargin — rendered as the
    // host Border's Padding). Named `Padding` to avoid colliding with Visual's
    // outer layout `Margin`. Default a small inset so text doesn't kiss the edge.
    public static readonly PaddingKey = MuralBase.RegisterProperty<Thickness>(
        ShapeText, 'Padding', new Thickness(2), MetaData.Measure);
    // The optional fill behind the text (Visio's text background, for
    // readability over a busy shape fill) reuses the inherited Visual.Fill
    // — it IS this control's background. Undefined → transparent.

    // ── Text-block transform (§ diagram-text Slice 3) ───────────────
    // ShapeText fills the shape footprint; these DPs place / size / rotate
    // the visible block WITHIN that footprint via the control's own
    // Measure / Arrange (not template bindings — see class header).
    //
    // Placement — anchor preset within (or just outside) the footprint.
    // Re-anchors the block → Measure (an inside↔outside flip changes the
    // measure constraint too).
    public static readonly PlacementKey = MuralBase.RegisterProperty<TextPlacement>(
        ShapeText, 'Placement', TextPlacement.Center, MetaData.Measure);
    // Offset — fine-tune translation from the placement anchor, in the
    // block's own (pre-rotation) frame. The adorner's move drag writes here.
    public static readonly OffsetKey = MuralBase.RegisterProperty<Point>(
        ShapeText, 'Offset', new Point(0, 0), MetaData.Arrange);
    // Angle — rotation in degrees about the block centre. Applied as a
    // RenderTransform on the template root (post-layout), so it never
    // re-measures; the manual OnPropertyChanged hook keeps the transform in
    // sync. MetaData.None accordingly.
    public static readonly AngleKey = MuralBase.RegisterProperty<number>(
        ShapeText, 'Angle', 0, MetaData.None);
    // BlockWidth / BlockHeight — explicit block size. NaN (default) → the
    // block fills the footprint for inside placements, or auto-sizes to its
    // content for outside placements. Distinct from the control's own
    // Width / Height (which stay auto so ShapeText fills the host).
    public static readonly BlockWidthKey = MuralBase.RegisterProperty<number>(
        ShapeText, 'BlockWidth', Number.NaN, MetaData.Measure);
    public static readonly BlockHeightKey = MuralBase.RegisterProperty<number>(
        ShapeText, 'BlockHeight', Number.NaN, MetaData.Measure);
    // VerticalTextAlignment — how the text sits vertically within the block
    // (top / centre / bottom), the vertical sibling of TextAlignment. Rides
    // a TemplateBinding to the inner TextBlock's VerticalAlignment.
    public static readonly VerticalTextAlignmentKey = MuralBase.RegisterProperty<VerticalAlignment>(
        ShapeText, 'VerticalTextAlignment', VerticalAlignment.Center, MetaData.None);

    // Auto-fit mode (§ Slice 7). ShrinkText re-scales the block down to fit
    // its footprint (handled in this control's Measure/Arrange); GrowShape is
    // observed by the owning Figure, which grows to contain the label.
    // Measure — a mode change re-runs the fit.
    public static readonly AutoFitKey = MuralBase.RegisterProperty<TextAutoFit>(
        ShapeText, 'AutoFit', TextAutoFit.None, MetaData.Measure);

    // ── In-place editing (§ diagram-text Slice 2) ───────────────────
    // IsEditing drives the template's TextBlock↔TextBox swap (a `when
    // (IsEditing)` trigger). Double-click on the shape / F2 begins an edit;
    // Enter or click-away commits, Escape cancels. MetaData.None — it's a
    // trigger-observed state flag, not a layout input.
    public static readonly IsEditingKey = MuralBase.RegisterProperty<boolean>(
        ShapeText, 'IsEditing', false, MetaData.None);

    // The template's editable part — a RichTextBox (§ Slice 4: all in-place
    // editing is rich), cached after applyDefaultStyle so BeginEdit can seed
    // / focus it. Undefined if a re-template omits it.
    private _editor: RichTextBox | undefined;

    // The block's render transform: a scale∘rotate group on the template
    // root with a centre pivot (RenderTransformOrigin = 0.5,0.5). _rotate
    // carries the Angle DP; _scale carries the ShrinkText auto-fit factor.
    // Mutating either repaints via the Freezable owner path; held as fields
    // so the Angle hook and the arrange-time fit can drive them without
    // re-reading the tree.
    private readonly _scale:  ScaleTransform  = new ScaleTransform();
    private readonly _rotate: RotateTransform = new RotateTransform();

    constructor()
    {
        super();
        this.applyDefaultStyle();
        // Seed the label's default font size from settings (default 12). A ctor
        // write, not the DP's class-static default, so a user's "Default label
        // font size" applies to freshly-created labels; an author / deserialize
        // FontSize write later overrides it.
        this.set_property_value(ShapeText.FontSizeKey, DiagramSettings.TextDefaultFontSize());
        // Same for label ink (default black) — a ctor write so a "Shape label ink"
        // override applies to fresh labels; an explicit Foreground later wins.
        this.set_property_value(ShapeText.ForegroundKey, DiagramSettings.ShapeLabelInk());
        this._editor = this.GetTemplateChild('PART_Edit') as RichTextBox | undefined;
        // Click-away (the editor losing focus) commits, matching Visio.
        this._editor?.AddRoutedEventListener('LostFocus', () =>
        {
            if (this.IsEditing) this.CommitEdit();
        });
        // Forward the editor's caret/selection changes so a diagram alignment
        // toolbar can re-reflect the caret paragraph's alignment live.
        this._editor?.AddSelectionChangedListener(() => this._fireEditSelectionChanged());
        // Pin the scale∘rotate group to the template root, pivoting about the
        // block centre. Both stay identity until Angle / ShrinkText drive them.
        const root = this.templateRoot;
        if (root !== undefined)
        {
            const group = new TransformGroup();
            group.Children.Add(this._scale);
            group.Children.Add(this._rotate);
            root.RenderTransform       = group;
            root.RenderTransformOrigin = new Point(0.5, 0.5);
        }
    }

    public get IsEditing(): boolean { return this.get_property_value(ShapeText.IsEditingKey); }
    public set IsEditing(v: boolean) { this.set_property_value(ShapeText.IsEditingKey, v); }

    // Enter in-place edit: seed the RichTextBox with a throwaway copy of the
    // current content — a clone of the Document when rich, else a fresh
    // single-run document built from the plain Content (carrying the shape's
    // alignment so promoting to rich keeps it) — then swap it in (via the
    // trigger), focus, and select all so typing replaces. No-op when already
    // editing or when the template carries no PART_Edit. Editing a COPY lets
    // CancelEdit restore and avoids the display host and the editor fighting
    // over the same FlowDocument's Parent.
    public BeginEdit(): void
    {
        if (this.IsEditing || this._editor === undefined) return;
        const src = this.Document;
        this._editor.Document = src !== undefined
            ? cloneFlowDocument(src)
            : flowDocumentFromPlainText(this.Content, this.TextAlignment);
        this.IsEditing = true;                  // trigger reveals the editor
        this._editor.Focus();
        this._editor.SelectAll();
    }

    // Commit the edit. The editor's document becomes the content: released
    // from the editor first (so the display host can adopt its Parent), then
    // adopted — as a plain Content string when it carries no formatting
    // (Content wins, Document cleared), or as a rich Document otherwise
    // (Content kept as the plain projection). Idempotent.
    public CommitEdit(): void
    {
        if (!this.IsEditing) return;
        const editor = this._editor;
        const doc = editor?.Document;
        if (editor !== undefined) editor.Document = undefined;   // release Parent
        if (doc !== undefined)
        {
            const plain = flowDocumentToPlainText(doc);
            if (isEffectivelyPlainDocument(doc))
            {
                this.Content  = plain;
                this.Document = undefined;
            }
            else
            {
                this.Content  = plain;   // plain projection stays in sync
                this.Document = doc;
            }
        }
        this.IsEditing = false;
    }

    // Abandon the edit — the working copy is discarded, Content / Document
    // unchanged. Release the editor's throwaway document.
    public CancelEdit(): void
    {
        if (!this.IsEditing) return;
        if (this._editor !== undefined) this._editor.Document = undefined;
        this.IsEditing = false;
    }

    // ── Paragraph-alignment routing (§ diagram-text Part 2) ─────────────
    // The alignment toolbar targets the right thing per mode:
    //   * editing → the caret paragraph(s) in the live editor
    //   * rich    → every paragraph of the Document (+ the block default)
    //   * plain   → the block-level TextAlignment (Part 1)
    public ApplyParagraphAlignment(align: TextAlignment): void
    {
        if (this.IsEditing && this._editor !== undefined)
        {
            this._editor.SetSelectionAlignment(align);
            return;
        }
        const doc = this.Document;
        if (doc !== undefined)
        {
            for (const p of DocumentParagraphs(doc)) p.TextAlignment = align;
        }
        // Keep the block default in sync so plain content aligns and a
        // rich→plain collapse on the next edit preserves the choice.
        this.TextAlignment = align;
    }

    // The alignment the toolbar should show as active for THIS shape.
    public CurrentParagraphAlignment(): TextAlignment
    {
        if (this.IsEditing && this._editor !== undefined)
        {
            return this._editor.SelectionAlignment ?? this.TextAlignment;
        }
        const doc = this.Document;
        if (doc !== undefined)
        {
            const paras = DocumentParagraphs(doc);
            if (paras.length > 0) return paras[0]!.TextAlignment;
        }
        return this.TextAlignment;
    }

    // ── Character-format routing (§ diagram-text text style) ────────────
    // Mirrors the paragraph-alignment routing: while editing → the selected text
    // runs in the live editor; rich content (not editing) → every run of the
    // Document; plain → the block-level character DPs. FormatMirror seeds via
    // Current*/broadcasts via Apply* so a shape's text-style toolbar reflects +
    // edits the right scope (whole label when selected, sub-run when editing).

    // Every run of the rich Document, flattened across paragraphs.
    private _allRuns(doc: FlowDocument): Run[]
    {
        const out: Run[] = [];
        for (const p of DocumentParagraphs(doc))
            for (const slot of ParagraphRuns(p)) out.push(slot.run);
        return out;
    }

    public ApplyBold(on: boolean): void { this._applyWeight(on ? FontWeight.Bold : FontWeight.Normal, on); }
    public ApplyItalic(on: boolean): void { this._applyStyle(on ? FontStyle.Italic : FontStyle.Normal, on); }
    public ApplyUnderline(on: boolean): void { this._applyDecoration(TextDecorations.Underline, on); }
    public ApplyStrikethrough(on: boolean): void { this._applyDecoration(TextDecorations.Strikethrough, on); }

    private _applyWeight(w: FontWeight, on: boolean): void
    {
        if (this.IsEditing && this._editor !== undefined) { this._editor.SetSelectionBold(on); return; }
        const doc = this.Document;
        if (doc !== undefined) for (const r of this._allRuns(doc)) r.FontWeight = w;
        this.FontWeight = w;
    }
    private _applyStyle(s: FontStyle, on: boolean): void
    {
        if (this.IsEditing && this._editor !== undefined) { this._editor.SetSelectionItalic(on); return; }
        const doc = this.Document;
        if (doc !== undefined) for (const r of this._allRuns(doc)) r.FontStyle = s;
        this.FontStyle = s;
    }
    private _applyDecoration(flag: TextDecorations, on: boolean): void
    {
        if (this.IsEditing && this._editor !== undefined)
        {
            if (flag === TextDecorations.Strikethrough) this._editor.SetSelectionStrikethrough(on);
            else this._editor.SetSelectionUnderline(on);
            return;
        }
        const set = (cur: TextDecorations): TextDecorations => on ? (cur | flag) : (cur & ~flag);
        const doc = this.Document;
        if (doc !== undefined) for (const r of this._allRuns(doc)) r.TextDecorations = set(r.TextDecorations);
        this.TextDecorations = set(this.TextDecorations);
    }

    public ApplyFontFamily(family: FontFamily | string): void
    {
        if (this.IsEditing && this._editor !== undefined) { this._editor.SetSelectionFontFamily(family); return; }
        const doc = this.Document;
        if (doc !== undefined) for (const r of this._allRuns(doc)) r.FontFamily = family;
        this.FontFamily = family;
    }
    public ApplyFontSize(size: number): void
    {
        if (this.IsEditing && this._editor !== undefined) { this._editor.SetSelectionFontSize(size); return; }
        const doc = this.Document;
        if (doc !== undefined) for (const r of this._allRuns(doc)) r.FontSize = size;
        this.FontSize = size;
    }
    public ApplyForeground(brush: Brush): void
    {
        if (this.IsEditing && this._editor !== undefined) { this._editor.SetSelectionForeground(brush); return; }
        const doc = this.Document;
        if (doc !== undefined) for (const r of this._allRuns(doc)) r.Foreground = brush;
        this.Foreground = brush;
    }

    public CurrentBold(): boolean
    {
        if (this.IsEditing && this._editor !== undefined) return this._editor.SelectionBold;
        const doc = this.Document;
        if (doc !== undefined) { const rs = this._allRuns(doc); return rs.length > 0 && rs.every((r) => r.FontWeight === FontWeight.Bold); }
        return this.FontWeight === FontWeight.Bold;
    }
    public CurrentItalic(): boolean
    {
        if (this.IsEditing && this._editor !== undefined) return this._editor.SelectionItalic;
        const doc = this.Document;
        if (doc !== undefined) { const rs = this._allRuns(doc); return rs.length > 0 && rs.every((r) => r.FontStyle === FontStyle.Italic); }
        return this.FontStyle === FontStyle.Italic;
    }
    public CurrentUnderline(): boolean { return this._currentDecoration(TextDecorations.Underline, () => this._editor!.SelectionUnderline); }
    public CurrentStrikethrough(): boolean { return this._currentDecoration(TextDecorations.Strikethrough, () => this._editor!.SelectionStrikethrough); }

    private _currentDecoration(flag: TextDecorations, editorRead: () => boolean): boolean
    {
        if (this.IsEditing && this._editor !== undefined) return editorRead();
        const doc = this.Document;
        if (doc !== undefined) { const rs = this._allRuns(doc); return rs.length > 0 && rs.every((r) => (r.TextDecorations & flag) !== 0); }
        return (this.TextDecorations & flag) !== 0;
    }

    public CurrentFontFamily(): string
    {
        if (this.IsEditing && this._editor !== undefined) return this._editor.SelectionFontFamily ?? familyName(this.FontFamily) ?? '';
        const doc = this.Document;
        if (doc !== undefined) { const rs = this._allRuns(doc); if (rs.length > 0) { const f = familyName(rs[0]!.FontFamily); if (f !== undefined) return f; } }
        return familyName(this.FontFamily) ?? '';
    }
    public CurrentFontSize(): number
    {
        if (this.IsEditing && this._editor !== undefined) return this._editor.SelectionFontSize ?? this.FontSize;
        const doc = this.Document;
        if (doc !== undefined) { const rs = this._allRuns(doc); if (rs.length > 0 && rs[0]!.FontSize !== undefined) return rs[0]!.FontSize; }
        return this.FontSize;
    }
    public CurrentForeground(): Brush | undefined
    {
        if (this.IsEditing && this._editor !== undefined) return this._editor.SelectionForeground ?? this.Foreground;
        const doc = this.Document;
        if (doc !== undefined) { const rs = this._allRuns(doc); if (rs.length > 0 && rs[0]!.Foreground !== undefined) return rs[0]!.Foreground; }
        return this.Foreground;
    }

    // Fires when the editor's caret / selection moves (while editing) or when
    // edit mode toggles — the signal a diagram alignment toolbar re-seeds on.
    private readonly _editSelListeners: Array<() => void> = [];
    public AddEditSelectionChangedListener(l: () => void): void { this._editSelListeners.push(l); }
    public RemoveEditSelectionChangedListener(l: () => void): void
    {
        const i = this._editSelListeners.indexOf(l);
        if (i >= 0) this._editSelListeners.splice(i, 1);
    }
    private _fireEditSelectionChanged(): void
    {
        for (const l of [...this._editSelListeners]) l();
    }

    // Escape cancels while editing (bubbles up from the focused editor).
    // Enter is NOT a commit — the RichTextBox treats it as a paragraph break;
    // commit is via click-away (LostFocus) or Escape-then-nothing. A cancel
    // hands focus back to the nearest focusable ancestor (the Diagram) so the
    // hidden editor doesn't swallow subsequent keys.
    protected override OnKeyDown(args: KeyEventArgs): void
    {
        if (this.IsEditing && args.Key === Key.Escape)
        {
            this.CancelEdit();
            this.returnFocusToDiagram();
            args.Handled = true;
            return;
        }
        super.OnKeyDown(args);
    }

    private returnFocusToDiagram(): void
    {
        let cur: Visual | undefined = this.GetVisualParent();
        while (cur !== undefined)
        {
            if (cur instanceof Element && cur.Focusable) { cur.Focus(); return; }
            cur = cur.GetVisualParent();
        }
    }

    // ── Text-block layout (§ diagram-text Slice 3) ──────────────────
    // ShapeText fills the shape footprint (the host Border sizes it), then
    // places / sizes / rotates the visible block WITHIN that footprint.
    // The template root (PART_Bg) is arranged at the computed block rect
    // instead of filling — so an off-centre, resized, or rotated label
    // needs no per-holder wiring.

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor, oldValue: unknown, newValue: unknown): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        // Rotation is post-layout — drive the RenderTransform directly so
        // no measure / arrange pass is spent on an Angle change.
        if (descriptor === ShapeText.AngleKey.descriptor)
        {
            this._rotate.Angle = typeof newValue === 'number' ? newValue : 0;
        }
        // Keep the display-swap flag in sync with rich-content presence.
        else if (descriptor === ShapeText.DocumentKey.descriptor)
        {
            this.set_property_value(ShapeText.HasRichContentKey, newValue !== undefined);
        }
        // Entering / leaving edit mode changes what the alignment toolbar
        // reflects (caret paragraph vs. block), so re-seed it.
        else if (descriptor === ShapeText.IsEditingKey.descriptor)
        {
            this._fireEditSelectionChanged();
        }
    }

    protected override MeasureOverride(availableSize: Size): Size
    {
        const root = this.templateRoot;
        if (root === undefined) return Size.Zero;
        const p = this.Placement;
        // ShrinkText measures the natural (unclamped) height so Arrange can
        // tell the content overflows the footprint and scale it to fit.
        const shrink = this.AutoFit === TextAutoFit.ShrinkText;
        const bw = this.BlockWidth, bh = this.BlockHeight;
        // Constrain the block measure PER AXIS: an explicit block size wins; else
        // constrain to the footprint ONLY on axes the block fills (so wrapping /
        // vertical fill happen against the footprint and TextAlignment / vertical
        // alignment position within it). On a hug axis (an edge/corner placement,
        // or any outside placement) measure unconstrained so root.DesiredSize is
        // the NATURAL content size — computeBlockRect then hugs + pins to it,
        // which is what makes the placement grid visibly move the label. The
        // inner display parts are Stretch, so a constrained axis would otherwise
        // report the constraint (not the content) and every anchor would collapse.
        const fillW = fillsFootprintWidth(p);
        const fillH = fillsFootprintHeight(p) && !shrink;
        const mw = !Number.isNaN(bw) ? bw
            : (fillW && Number.isFinite(availableSize.Width)  ? availableSize.Width  : Number.POSITIVE_INFINITY);
        const mh = !Number.isNaN(bh) ? bh
            : (fillH && Number.isFinite(availableSize.Height) ? availableSize.Height : Number.POSITIVE_INFINITY);
        root.Measure(new Size(mw, mh));
        // Occupy the footprint slot when finite (fill the host); else shrink
        // to the block's own desired size.
        const w = Number.isFinite(availableSize.Width)  ? availableSize.Width  : root.DesiredSize.Width;
        const h = Number.isFinite(availableSize.Height) ? availableSize.Height : root.DesiredSize.Height;
        return new Size(w, h);
    }

    protected override ArrangeOverride(finalSize: Size): Size
    {
        const root = this.templateRoot;
        if (root === undefined) return finalSize;
        const rect = this.computeBlockRect(finalSize.Width, finalSize.Height, root.DesiredSize);
        root.Arrange(rect);
        this.applyShrinkScale(rect, root.DesiredSize);
        return finalSize;
    }

    // ShrinkText auto-fit: scale the (already-arranged) block down so its
    // natural content fits the block rect. None / GrowShape leave it at 1.
    private applyShrinkScale(rect: Rect, desired: Size): void
    {
        let f = 1;
        if (this.AutoFit === TextAutoFit.ShrinkText)
        {
            if (desired.Width  > rect.Width  && desired.Width  > 0) f = Math.min(f, rect.Width  / desired.Width);
            if (desired.Height > rect.Height && desired.Height > 0) f = Math.min(f, rect.Height / desired.Height);
        }
        this._scale.ScaleX = f;
        this._scale.ScaleY = f;
    }

    // The block's rect within the footprint (this control's own frame),
    // resolving auto size against `desired` and applying Placement + Offset.
    //
    // Auto (NaN) block size resolves per-axis: an explicit BlockWidth/Height
    // always wins; else an OUTSIDE placement hugs content; else an inside
    // placement fills the footprint on axes it centres on (Center / edge-centre)
    // and hugs content (clamped to the footprint) on axes it pins to an edge.
    // Without the per-axis hug an auto block fills the whole footprint, so every
    // inside anchor collapses to (0,0) and Placement has NO visible effect —
    // that was the "label-placement toolbar does nothing" bug.
    private computeBlockRect(fw: number, fh: number, desired: Size): Rect
    {
        const p = this.Placement;
        const outside = isOutsideTextPlacement(p);
        const bw = !Number.isNaN(this.BlockWidth)  ? this.BlockWidth
            : outside                ? desired.Width
            : fillsFootprintWidth(p) ? fw
            :                          Math.min(desired.Width, fw);
        const bh = !Number.isNaN(this.BlockHeight) ? this.BlockHeight
            : outside                 ? desired.Height
            : fillsFootprintHeight(p) ? fh
            :                           Math.min(desired.Height, fh);
        const anchor = computeTextBlockAnchor(p, fw, fh, bw, bh);
        const off = this.Offset;
        return new Rect(anchor.x + off.X, anchor.y + off.Y, bw, bh);
    }

    // The block's rect in THIS control's coordinate frame — the same rect
    // ArrangeOverride uses. The text-block adorner reads it (plus the
    // holder's canvas origin) to draw move / rotate chrome exactly over the
    // rendered block. Returns Rect.Empty before first arrange.
    public GetBlockRect(): Rect
    {
        const ar = this.ArrangedRect;
        if (ar === undefined) return Rect.Zero;
        const root = this.templateRoot;
        const desired = root?.DesiredSize ?? Size.Zero;
        return this.computeBlockRect(ar.Width, ar.Height, desired);
    }

    // ── DP accessors ────────────────────────────────────────────────
    public get Content(): string { return this.get_property_value(ShapeText.ContentKey); }
    public set Content(v: string) { this.set_property_value(ShapeText.ContentKey, v); }

    public get Document(): FlowDocument | undefined { return this.get_property_value(ShapeText.DocumentKey); }
    public set Document(v: FlowDocument | undefined) { this.set_property_value(ShapeText.DocumentKey, v); }

    public get HasRichContent(): boolean { return this.get_property_value(ShapeText.HasRichContentKey); }

    public get FontSize(): number { return this.get_property_value(ShapeText.FontSizeKey); }
    public set FontSize(v: number) { this.set_property_value(ShapeText.FontSizeKey, v); }

    public get FontWeight(): FontWeight { return this.get_property_value(ShapeText.FontWeightKey); }
    public set FontWeight(v: FontWeight) { this.set_property_value(ShapeText.FontWeightKey, v); }

    public get FontStyle(): FontStyle { return this.get_property_value(ShapeText.FontStyleKey); }
    public set FontStyle(v: FontStyle) { this.set_property_value(ShapeText.FontStyleKey, v); }

    public get Foreground(): Brush | undefined { return this.get_property_value(ShapeText.ForegroundKey); }
    public set Foreground(v: Brush | undefined) { this.set_property_value(ShapeText.ForegroundKey, v); }

    public get FontFamily(): FontFamily | string | undefined { return this.get_property_value(ShapeText.FontFamilyKey); }
    public set FontFamily(v: FontFamily | string | undefined) { this.set_property_value(ShapeText.FontFamilyKey, v); }

    public get TextDecorations(): TextDecorations { return this.get_property_value(ShapeText.TextDecorationsKey); }
    public set TextDecorations(v: TextDecorations) { this.set_property_value(ShapeText.TextDecorationsKey, v); }

    public get TextAlignment(): TextAlignment { return this.get_property_value(ShapeText.TextAlignmentKey); }
    public set TextAlignment(v: TextAlignment) { this.set_property_value(ShapeText.TextAlignmentKey, v); }

    public get TextWrapping(): TextWrapping { return this.get_property_value(ShapeText.TextWrappingKey); }
    public set TextWrapping(v: TextWrapping) { this.set_property_value(ShapeText.TextWrappingKey, v); }

    public get Padding(): Thickness { return this.get_property_value(ShapeText.PaddingKey); }
    public set Padding(v: Thickness) { this.set_property_value(ShapeText.PaddingKey, v); }

    public get Placement(): TextPlacement { return this.get_property_value(ShapeText.PlacementKey); }
    public set Placement(v: TextPlacement) { this.set_property_value(ShapeText.PlacementKey, v); }

    public get Offset(): Point { return this.get_property_value(ShapeText.OffsetKey); }
    public set Offset(v: Point) { this.set_property_value(ShapeText.OffsetKey, v); }

    public get Angle(): number { return this.get_property_value(ShapeText.AngleKey); }
    public set Angle(v: number) { this.set_property_value(ShapeText.AngleKey, v); }

    public get BlockWidth(): number { return this.get_property_value(ShapeText.BlockWidthKey); }
    public set BlockWidth(v: number) { this.set_property_value(ShapeText.BlockWidthKey, v); }

    public get BlockHeight(): number { return this.get_property_value(ShapeText.BlockHeightKey); }
    public set BlockHeight(v: number) { this.set_property_value(ShapeText.BlockHeightKey, v); }

    public get VerticalTextAlignment(): VerticalAlignment { return this.get_property_value(ShapeText.VerticalTextAlignmentKey); }
    public set VerticalTextAlignment(v: VerticalAlignment) { this.set_property_value(ShapeText.VerticalTextAlignmentKey, v); }

    public get AutoFit(): TextAutoFit { return this.get_property_value(ShapeText.AutoFitKey); }
    public set AutoFit(v: TextAutoFit) { this.set_property_value(ShapeText.AutoFitKey, v); }

    // Fill (the text-readability fill) is inherited from Visual.

    // Convenience: true when there's nothing to paint. Holders can skip
    // hosting an empty block if they want (the Figure hosts it always —
    // an empty Border is cheap and keeps the edit path simple).
    public get IsEmpty(): boolean
    {
        const doc = this.Document;
        return doc !== undefined ? flowDocumentToPlainText(doc).length === 0 : this.Content.length === 0;
    }

    // Formatting DPs drive the template TextBlock through TemplateBindings
    // (first-segment reactive on this control), so no OnPropertyChanged
    // push is needed — a set of `Content` / `FontSize` / … repaints via the
    // template binding alone.
}
