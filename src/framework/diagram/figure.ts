import {
    Element,
    MetaData,
    MuralBase,
    Rect,
    Size,
    Visual,
    type DrawingContext,
    type PointerEventArgs,
    type PropertyDescriptor,
} from '../../runtime/index.js';
import { type Geometry, type PathGeometry, Point, Pen, RectangleGeometry, RotateTransform } from '../../visual-engine/index.js';
import { Canvas } from '../../basic/panels/canvas.js';
import { Border } from '../../basic/border.js';
import { ShapeText, TextAutoFit } from './shape-text.js';
import { FieldKind, resolveFields } from './shape-text-field.js';
import { ContentControl } from '../base/content-control.js';
import { ScrollViewer } from '../surfaces/scroll-viewer.js';
import { Selector } from '../list/selector.js';
import { SHAPE_CATALOG_MAP, scaleGeometry } from './shape-catalog.js';
import type { Group } from './group.js';
import { type Port, type ResolvedPortSide } from './port.js';
import type { IPortProvider } from './port-providers/port-provider.js';
import { resolveDefaultPortProvider } from './port-providers/default-port-providers.js';
import type { ConnectorEndpoint } from './connector-endpoint.js';
import { SideEndpointRegistry, type ISideAnchoredConnector, type ISideEndpointHost } from './side-endpoint-host.js';
import { ConnectorRoutingScheduler } from './connector-routing-scheduler.js';
import type { RigidConnectorDragHost, RigidConnectorDragSession } from './rigid-connector-drag.js';
import { DiagramSettings } from './diagram-settings.js';
import { PositionAnchor } from './position-anchor.js';

// A movable, content-hosting control intended as the container shape
// inside the diagrammer's ItemsControl (see Diagram). Figure owns
// two things internally so the demo bootstrap doesn't need a behavior:
//
//   * Position — Left / Top DPs flagged BindsTwoWayByDefault so a
//     `$Left` / `$Top` binding in the container Style threads through
//     to the data context (the node VM). Changes to Left / Top mirror
//     onto this control's own Canvas.Left / Canvas.Top, so a parent
//     Canvas places it.
//
//   * Drag-to-move — OnPointerDown captures the pointer and stores the
//     press offset; OnPointerMove writes back to Left / Top; OnPointerUp
//     releases capture. Capture means the drag survives the cursor
//     leaving the node's hit area, so no per-canvas listener wiring is
//     needed. The handler also distinguishes click-vs-drag: any move
//     past CLICK_THRESHOLD_PX commits to drag mode; if the gesture
//     ends without ever crossing the threshold, OnPointerUp calls the
//     owning Selector's HandleContainerClick — same path ListBoxItem
//     uses — so single-click / Ctrl-click / Shift-click on a node go
//     through the standard Selector machinery (anchor-relative range
//     selection, modifier modes, SelectionChanged batching).
//
// Default Template: a single ContentPresenter. ContentControl's content
// resolution does the rest — when Figure.Content is set to a MuralBase
// (the per-item NodeVM data), ContentControl looks up the matching
// [DataType=…] DataTemplate via Application resources and slots the
// produced Visual into the presenter. Consumers who want chrome around
// the content (selection rings, drop shadows, …) can replace Template.
// Default size for a freshly-constructed Figure sourced from
// DiagramSettings.ShapeDefaultSize() — historically 80×80 dp. Overridable on a
// per-instance basis via the fromKind / fromSource factories.

// Figure DP names whose change should re-resolve the label's {field} tokens.
const FIELD_SOURCE_NAMES: ReadonlySet<string> = new Set(['Left', 'Top', 'Width', 'Height', 'Id']);

// Extra per-side allowance (DIPs) a content tile reserves for glyph INK that
// overhangs the measured advance width. Layout measures the advance (the pen
// step), but a glyph's painted ink can extend a couple of DIPs past it (right
// side-bearing); the tile's ClipToBounds is built from the advance box, so
// without this margin the last glyph's ink is shaved. Empirical — the ink
// overhang is font/size/weight dependent, so this is a small fixed cushion that
// covers the diagram's caption fonts rather than an exact per-string value.
const LABEL_INK_BLEED = 3;

// Corner radius (DIP) of a content tile's background card. A shapeless
// SizeToContent container (an arch/content node — no geometric _shape) styles
// like a small rounded-rect card: it paints its own Fill/Stroke and clips its
// content to this silhouette, exactly like a geometric shape paints its _shape.
const CONTENT_TILE_CORNER = 4;

// The default Fill / Stroke brushes for a fresh Figure live in DiagramSettings
// (DiagramSettings.ShapeDefaultFill / .ShapeDefaultStroke) alongside the other
// tunable diagram constants; stroke width comes from .ShapeStrokeWidth().

// The in-place edit lifecycle a content VM (or the Figure's own ShapeText)
// exposes: enter edit mode, commit the pending edit, or cancel it. Applied via
// a named cast (never bracket access) so figure.ts stays decoupled from
// TextNode (no import cycle risk — only the interface lives here). ShapeText
// implements all three; a content VM delegates to its own ShapeText.
export interface IEditable
{
    BeginEdit(): void;
    CommitEdit(): void;
    CancelEdit(): void;
}

// Resolve the editable target for a container Figure: if its Content is an
// IEditable (has its own in-place edit entry), delegate there; otherwise fall
// back to the Figure's own Text (a ShapeText, itself IEditable). Exported so the
// Diagram's F2 handler resolves the same target as double-click. BeginEdit
// presence is the discriminator — the only content type that has it (TextNode)
// implements the whole lifecycle.
export function resolveEditTarget(container: Figure): IEditable | undefined
{
    const content = container.Content;
    if (content !== null && content !== undefined &&
        typeof (content as Partial<IEditable>).BeginEdit === 'function')
    {
        return content as unknown as IEditable;
    }
    return container.Text;
}

export interface FigureFromKindOptions
{
    readonly width?:  number;
    readonly height?: number;
}

// Same size options as fromKind, plus an optional catalog-kind provenance tag
// (see Figure._kind) the combined-geometry / Load path threads through.
export interface FigureFromSourceOptions extends FigureFromKindOptions
{
    readonly kind?: string;
}

// Kind → factory registry for NON-silhouette figure kinds (e.g. 'container',
// whose factory returns a ContainerFigure). It lets fromKind mint subclass
// instances without figure.ts importing them — the subclass registers itself on
// module load, breaking the figure ↔ subclass import cycle. Silhouette shapes
// stay in SHAPE_CATALOG_MAP and fall through to the plain-Figure path.
export type FigureKindFactory = (left: number, top: number, options?: FigureFromKindOptions) => Figure;
const FIGURE_KIND_FACTORIES = new Map<string, FigureKindFactory>();
export function registerFigureKind(kind: string, factory: FigureKindFactory): void
{
    FIGURE_KIND_FACTORIES.set(kind, factory);
}

// The slice of the enclosing Diagram's ContainerPlacement the drag path needs —
// duck-typed to avoid the figure → diagram import cycle (same pattern as
// PositionSnap / RigidConnectorDragHost). `containerAt` returns the container a
// diagram-space point lands in (excluding the dragged node + its descendants).
interface ContainerPlacementLike
{
    reparent(node: Figure, parentId: string | undefined): void;
    containerAt(point: Point, exclude?: Figure): { Id?: string } | undefined;
    highlightCandidate(point: Point, exclude: Figure): void;
    clearCandidate(): void;
}
function placementOf(selector: unknown): ContainerPlacementLike | undefined
{
    return (selector as { ContainerPlacement?: ContainerPlacementLike } | undefined)?.ContainerPlacement;
}

export class Figure extends ContentControl implements ISideEndpointHost
{
    static
    {
        MuralBase.OverrideMetadata(Figure, Element.DefaultStyleKeyKey, { default_value: Figure });
        // Figure's fill is the inherited Visual.Fill; keep Figure's historic
        // default brush by overriding the metadata for the Figure subtree.
        MuralBase.OverrideMetadata(Figure, Visual.FillKey, { default_value: DiagramSettings.ShapeDefaultFill() });
        // Every diagram node clips its content to its box: a shaped node to its
        // silhouette (buildChildClipGeometry = _shape), a shapeless / content
        // node to its bounds rect (the super fallback). ClipToBounds is
        // children-only, so the node's own paint / stroke is never masked.
        MuralBase.OverrideMetadata(Figure, Visual.ClipToBoundsKey, { default_value: true });
    }

    public static readonly LeftKey = MuralBase.RegisterProperty<number>(
        Figure, 'Left', 0, MetaData.Arrange | MetaData.BindsTwoWayByDefault);
    
    public static readonly TopKey = MuralBase.RegisterProperty<number>(
        Figure, 'Top', 0, MetaData.Arrange | MetaData.BindsTwoWayByDefault);

    // Fill brush and Stroke pen are inherited from Visual (Visual.Fill /
    // Visual.Stroke). Figure's historic Fill default rides on the
    // OverrideMetadata in the static block above; the per-instance Stroke
    // Pen is assigned in the constructor (PenEditor mutates Pens in place,
    // so sharing one across figures would leak edits).

    // The shape's text block (the Visio "text block") — a first-class
    // ShapeText sub-control created per-instance in the ctor and hosted in
    // the default template's PART_LabelHost. It renders itself reactively;
    // `LabelText` below is sugar over `Text.Content`. Measure-affecting so a
    // whole-block swap relays out (Content edits invalidate via ShapeText).
    public static readonly TextKey = MuralBase.RegisterProperty<ShapeText | undefined>(
        Figure, 'Text', undefined, MetaData.Measure);

    // Content-sizing mode (mirrors the bound VM's SizeToContent). A content
    // node — an icon+label tile with no geometry — has no meaningful box to
    // fix; it sizes to its rendered content (see _applyContentFit), and the
    // two-way Width/Height bind carries that back to the VM. Geometric shapes
    // leave this false and stay fixed-size + resizable.
    public static readonly SizeToContentKey = MuralBase.RegisterProperty<boolean>(
        Figure, 'SizeToContent', false, MetaData.Measure);
    // Set once the user hand-resizes the node: content auto-fit stops so the
    // explicit size sticks.
    public static readonly UserSizedKey = MuralBase.RegisterProperty<boolean>(
        Figure, 'UserSized', false, MetaData.None);

    // Stable identifier — used by serialize / deserialize and by external
    // consumers that need to refer back to a specific figure after Load.
    public static readonly IdKey = MuralBase.RegisterProperty<string | undefined>(
        Figure, 'Id', undefined, MetaData.None);

    // Selection state — duck-typed by SelectionReflector when the
    // owning Diagram has ReflectSelectionToItems=true.
    public static readonly IsSelectedKey = MuralBase.RegisterProperty<boolean>(
        Figure, 'IsSelected', false, MetaData.None);

    // Visual rotation in degrees (clockwise). Applied as a RenderTransform only —
    // it does NOT affect layout/measure, so Width/Height stay the unrotated Size
    // (matches PowerPoint). Selection/resize adorners remain axis-aligned (a
    // documented follow-up). Two-way so the inspector can bind it.
    public static readonly RotationKey = MuralBase.RegisterProperty<number>(
        Figure, 'Rotation', 0, MetaData.Render | MetaData.BindsTwoWayByDefault);

    // The shape's baseline size, seeded at creation. Scale % in the inspector is
    // size ÷ base × 100. Persisted so scale is stable across load.
    public static readonly BaseWidthKey = MuralBase.RegisterProperty<number>(
        Figure, 'BaseWidth', Number.NaN, MetaData.None);
    public static readonly BaseHeightKey = MuralBase.RegisterProperty<number>(
        Figure, 'BaseHeight', Number.NaN, MetaData.None);

    // Lock aspect ratio during resize — a per-shape intent (PowerPoint keeps it
    // on the shape). Persisted so it survives reload; the Size & Position
    // inspector seeds/writes it through SelectionGeometryMirror.
    public static readonly LockAspectRatioKey = MuralBase.RegisterProperty<boolean>(
        Figure, 'LockAspectRatio', false, MetaData.None);
    // The "From" reference corner the inspector reads/writes this shape's
    // position against (Top-Left vs Center). Per-shape, persisted.
    public static readonly PositionFromKey = MuralBase.RegisterProperty<PositionAnchor>(
        Figure, 'PositionFrom', PositionAnchor.TopLeftCorner, MetaData.None);

    // Per-Figure port-provider override. When set, the `Ports` getter
    // routes through this provider's GetPorts() instead of the
    // framework's kind→provider default table — used for shapes that
    // need a non-default topology for a specific instance (a
    // workflow-style node on a generic rectangle, etc.). Leaving it
    // undefined falls through to resolveDefaultPortProvider() per § 3.8
    // of [docs/connectors.md](../../../docs/connectors.md).
    public static readonly PortProviderKey = MuralBase.RegisterProperty<IPortProvider | undefined>(
        Figure, 'PortProvider', undefined, MetaData.None);

    // Explicit hand-listed Ports. When set, wins over BOTH PortProvider
    // and the kind→provider default — used for shapes whose ports
    // carry semantic data-model meaning (workflow "in" / "out", schema
    // entities). The two-DP shape mirrors the § 3.8 sketch; the
    // ExplicitPorts ?? PortProvider precedence is intentional per
    // § 7.13 (lifting to a concat strategy is the v2 follow-up).
    public static readonly ExplicitPortsKey = MuralBase.RegisterProperty<readonly Port[] | undefined>(
        Figure, 'ExplicitPorts', undefined, MetaData.None);

    // Unit-1 source path for this figure. Cached source-of-truth; resize
    // rebuilds the visible Geometry by scaling this. Combined-geometry
    // figures store the merge result here. View-invisible structural
    // state, so a plain field instead of a DP.
    private _source: PathGeometry | undefined = undefined;

    // The scaled silhouette this Figure paints and clips its children to,
    // rebuilt from _source on resize. Replaces the old Geometry DP; surfaced
    // through the buildPaintGeometry / buildChildClipGeometry / buildClipGeometry
    // seams so the inherited Visual paints it (crisp own stroke) and ChildClip
    // masks the label/content to it. Never routed through the raw Clip DP — that
    // masks own paint too and would shave the stroke, with no arbitrary-path
    // inset to compensate.
    private _shape: PathGeometry | undefined = undefined;

    // Inert catalog-kind provenance tag: set by fromKind (and fromSource's kind
    // option), read only by serialization. Drives NO behavior — ports are
    // bbox-for-all and rendering is geometry-driven. Undefined for a bare Figure
    // or a kindless fromSource.
    private _kind: string | undefined = undefined;

    // Group back-reference. undefined ≡ "top-level". Set by Group when a
    // Figure is added to its Members. Typed via a type-only import to
    // break the figure ↔ group module cycle at runtime; structurally
    // the field is always a Group instance.
    public Parent: Group | undefined = undefined;

    // Container membership tag: the id of the ContainerFigure this node nests in
    // (undefined = a root node). Not layout geometry — the ContainerPlacement
    // collaborator reads it to re-parent this Figure's Visual into that
    // container's child host, and mirrors it to the live ContainerParent link.
    // Persisted via NodeVisualStore; a nested node's Left/Top are parent-relative.
    private _parentId: string | undefined = undefined;
    public get ParentId(): string | undefined { return this._parentId; }
    public set ParentId(v: string | undefined) { this._parentId = v; }

    // Live link to the ContainerFigure this node nests in (undefined = root).
    // Maintained by ContainerPlacement in lock-step with ParentId; read by
    // diagramSpaceRect to walk the ancestor chain. A plain field, not a DP: it is
    // view-tree structure the collaborator owns, not bindable content.
    public ContainerParent: Figure | undefined = undefined;

    // The inset of this node's child host from its own top-left. A plain Figure
    // hosts no children, so (0,0); ContainerFigure overrides with its title band +
    // padding. Part of the ContainerLike shape diagramSpaceRect consumes.
    public get ContentOrigin(): Point { return Point.Zero; }

    // ── Static factories ─────────────────────────────────────────────
    //
    // Three construction paths for a self-painting shape node:
    //
    //   * fromKind(kind, …)      — toolbox drop / CreateNode. Pulls the
    //                              unit-1 source from the catalog.
    //   * fromSource(source, …)  — combined-geometry path (boolean ops,
    //                              custom paths). Caller is responsible
    //                              for normalizing `source` to unit-1.
    //   * fromSource(source, { kind })
    //                            — catalog-derived but pre-extracted by
    //                              the caller (Load with cached d-string).
    //
    // In every case the Figure holds `_source` (a unit-1 PathGeometry)
    // as the source of truth. The visible `Geometry` DP is the scaled
    // copy at (Width, Height).

    public static fromKind(kind: string, left: number, top: number, options?: FigureFromKindOptions): Figure
    {
        // Registered non-silhouette kinds (e.g. 'container') mint their own
        // subclass instance; silhouette shapes fall through to the catalog.
        const factory = FIGURE_KIND_FACTORIES.get(kind);
        if (factory !== undefined) return factory(left, top, options);
        const entry = SHAPE_CATALOG_MAP.get(kind);
        if (entry === undefined)
        {
            throw new Error(`Figure.fromKind: unknown kind '${kind}'`);
        }
        const f = new Figure();
        f.Left = left;
        f.Top  = top;
        f.Width  = options?.width  ?? DiagramSettings.ShapeDefaultSize();
        f.Height = options?.height ?? DiagramSettings.ShapeDefaultSize();
        f._setKindFromCatalog(kind, entry.unit());
        f.BaseWidth  = f.Width;
        f.BaseHeight = f.Height;
        return f;
    }

    public static fromSource(source: PathGeometry, left: number, top: number, options?: FigureFromSourceOptions): Figure
    {
        const f = new Figure();
        f.Left = left;
        f.Top  = top;
        f.Width  = options?.width  ?? DiagramSettings.ShapeDefaultSize();
        f.Height = options?.height ?? DiagramSettings.ShapeDefaultSize();
        f._source = source;
        f._kind   = options?.kind;
        f._rebuildGeometry();
        f.BaseWidth  = f.Width;
        f.BaseHeight = f.Height;
        return f;
    }

    /** @internal — used by fromKind and by Load paths that have a cached source.
     *  `kind` selects the catalog entry at the call site and is stored as an
     *  inert provenance tag (see _kind) for serialization round-trip; it drives
     *  no behavior — every figure realizes uniformly from _source. */
    public _setKindFromCatalog(kind: string, source: PathGeometry): void
    {
        this._kind   = kind;
        this._source = source;
        this._rebuildGeometry();
    }

    /** Subclass-friendly catalog wiring. Sets the Kind DP and the unit-1
     *  source geometry by looking up `kind` in the shape catalog, then
     *  rebuilds the visible Geometry against the current Width / Height.
     *  Throws when the kind isn't in the catalog — symmetric with
     *  Figure.fromKind. Use from a subclass ctor when the per-kind Fill /
     *  LabelText defaults ride on `OverrideMetadata` and the constructor
     *  only needs to point the figure at its catalog geometry. */
    public ApplyCatalogKind(kind: string): void
    {
        const entry = SHAPE_CATALOG_MAP.get(kind);
        if (entry === undefined)
        {
            throw new Error(`Figure.ApplyCatalogKind: unknown kind '${kind}'`);
        }
        this._setKindFromCatalog(kind, entry.unit());
    }

    /** @internal — exposes the unit-1 source for serialize() consumers. */
    public _getSource(): PathGeometry | undefined { return this._source; }

    // Below CLICK_THRESHOLD_PX of movement the gesture stays in
    // "click" mode (no Left / Top writes happen and OnPointerUp routes
    // through Selector.HandleContainerClick). Cross the threshold
    // once and the gesture commits to drag mode for the rest of the
    // session — even if the cursor wobbles back inside the threshold,
    // we keep dragging.
    private static readonly CLICK_THRESHOLD_PX = 4;

    private _dragging:    boolean = false;
    private _moved:       boolean = false;
    private _editBegun:   boolean = false;   // a history transaction is open for this drag
    private _pressHostX:  number  = 0;
    private _pressHostY:  number  = 0;
    private _grabOffsetX: number  = 0;
    private _grabOffsetY: number  = 0;

    // Drag-time ScrollViewer state — the nearest enclosing ScrollViewer,
    // snapshotted at PointerDown so PointerMove can feed the cursor position
    // into the SV's edge auto-scroll evaluator (the canvas pulls along when the
    // cursor nears the viewport edge). Scroll-delta compensation is no longer
    // tracked here: moveSelfToCursor maps through Diagram.HostToContent, which
    // reads the live ArrangedRect chain (already carrying the current -offset).
    // undefined when the node lives outside a ScrollViewer.
    private _dragScrollViewer:     ScrollViewer | undefined;

    // Group-drag partners — snapshotted at PointerDown when `this` is
    // part of the enclosing Selector's multi-selection. PointerMove
    // applies the same Left / Top delta to each partner so the whole
    // selection translates together (PowerPoint / Figma convention).
    // undefined when the press wasn't on a selected container — that
    // case drags only `this` and leaves the existing selection alone.
    private _dragPartners: Figure[] | undefined;

    // Rigid-translate session for the connectors INTERNAL to a multi-drag
    // (both endpoints among the moving figures). Opened at PointerDown
    // against the enclosing Diagram, fed the net delta each PointerMove,
    // closed at PointerUp. undefined when no internal connector carries
    // user waypoints (nothing to preserve). See [rigid-connector-drag.ts].
    private _rigidConnectors: RigidConnectorDragSession | undefined;

    constructor()
    {
        super();
        // Per-instance Stroke. The default DP value can't be shared
        // because PenEditor mutates Pens in place — each Figure needs
        // its own. Cloning keeps the visual default consistent without
        // leaking edits across instances; width comes from settings.
        this.set_property_value(Visual.StrokeKey, new Pen(DiagramSettings.ShapeDefaultStroke(), DiagramSettings.ShapeStrokeWidth()));
        // Default size — gives a freshly-constructed Figure a visible
        // footprint even before fromKind / fromSource has run.
        if (Number.isNaN(this.Width))  this.Width  = DiagramSettings.ShapeDefaultSize();
        if (Number.isNaN(this.Height)) this.Height = DiagramSettings.ShapeDefaultSize();
        // Seed Canvas.Left / Canvas.Top from the registered defaults so
        // a freshly-constructed Figure placed into a Canvas without
        // any binding lands at (0,0) instead of inheriting whatever the
        // attached-property defaults happen to be on the parent path.
        Canvas.SetLeft(this, 0);
        Canvas.SetTop (this, 0);
        // The shape's text block — one per Figure so edits (and the coming
        // in-place editor) don't leak across instances. Set on the Text DP
        // before applyDefaultStyle so anything reading it during style
        // resolution sees the instance.
        this.set_property_value(Figure.TextKey, new ShapeText());
        // Default Template flows from the bundled diagram theme entry
        // under TargetType=Figure (see diagram.template.mu): a Canvas
        // hosting a Shape primitive template-bound to this Figure's
        // Geometry / Fill / Stroke / Width / Height, plus a PART_LabelHost
        // into which the ShapeText is slotted below.
        this.applyDefaultStyle();
        // Host the text block in the template's PART_LabelHost (a Border
        // sized to the shape footprint). The block renders itself; a
        // re-template that omits PART_LabelHost simply drops the label.
        const labelHost = this.GetTemplateChild('PART_LabelHost') as Border | undefined;
        labelHost?.SetChild(this.Text);
        // Keep live {field} tokens resolved (§ Slice 6) and honour GrowShape
        // auto-fit (§ Slice 7) when the label's text / document / mode change;
        // geometry-driven field refresh rides OnPropertyChanged below.
        this.Text.PropertyChanged(ShapeText.DocumentKey).subscribe(this._onLabelChanged);
        this.Text.PropertyChanged(ShapeText.ContentKey).subscribe(this._onLabelChanged);
        this.Text.PropertyChanged(ShapeText.AutoFitKey).subscribe(this._onLabelChanged);
        this._refreshLabelFields();
        this._applyAutoFit();
    }

    private readonly _onLabelChanged = (): void => { this._refreshLabelFields(); this._applyAutoFit(); };

    // TextAutoFit.GrowShape: grow this figure so the label's natural size
    // fits (plus a margin). Grow-only — never shrinks the shape below its
    // current size. No-op for the other modes. Growing Width/Height rebuilds
    // the geometry and reroutes connectors through the usual DP path; the
    // label re-measures to the same natural size, so the fit converges.
    private _applyAutoFit(): void
    {
        const label = this.Text;
        if (label === undefined || label.AutoFit !== TextAutoFit.GrowShape) return;
        label.Measure(new Size(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY));
        const d = label.DesiredSize;
        const margin = DiagramSettings.ShapeLabelMargin();
        const needW = d.Width  + margin * 2;
        const needH = d.Height + margin * 2;
        if (needW > this.Width)  this.Width  = needW;
        if (needH > this.Height) this.Height = needH;
    }

    // Re-entrancy guard for _applyContentFit — setting Width/Height re-invalidates
    // measure, and the fit runs again on the next pass; the guard keeps a single
    // pass from recursing while it writes.
    private _fittingContent = false;

    // Content-node sizing (SizeToContent). A tile with no geometry has no box to
    // fix, so its size follows its rendered content: measure PART_Content at its
    // natural size and write Width/Height to match (both grow AND shrink). The
    // two-way Width/Height bind carries this to the bound VM, so the selection
    // adorner, connectors, layout and serialization all see the true tile bounds.
    // Skipped once the user hand-resizes (UserSized) so the explicit size sticks.
    //
    // Convergence: PART_Content is measured UNCONSTRAINED, so its desired size is
    // independent of this Figure's Width/Height — once they equal it, the next
    // pass writes nothing and layout settles. The tile's own label caps its width
    // (its MaxWidth), so an unconstrained measure still wraps to a bounded size.
    private _applyContentFit(): void
    {
        if (!this.SizeToContent || this.UserSized || this._fittingContent) return;
        // PART_Content is sized to the Figure's box (Width=$$Width), so measure
        // its materialized child — the tile — for the natural content size.
        const presenter = this.GetTemplateChild('PART_Content') as Element | undefined;
        const content = presenter?.visualChildren[0] as Element | undefined;
        if (content === undefined) return;
        content.Measure(new Size(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY));
        const d = content.DesiredSize;
        if (d.Width <= 0 && d.Height <= 0) return;   // not rendered yet
        // Reserve the stroke on every side. A neutral container Figure (no _shape)
        // clips its children through the base buildChildClipGeometry, which insets
        // the child-clip by the FULL stroke thickness — so content sized to the raw
        // DesiredSize would sit flush to the box edge and be sheared by that inset
        // (a label filling the tile lost its last glyph). Growing the box by
        // 2×stroke lets the (centred) content fall inside the inset clip region,
        // exactly as Border reserves its BorderThickness. Shaped Figures clip to
        // the full silhouette (no inset), and their stroke is ~1px, so the reserve
        // is negligible there. On TOP of the stroke, reserve LABEL_INK_BLEED per
        // side so a glyph whose ink overhangs its advance (the layout measures the
        // advance, the clip is built from it) isn't shaved at the tile edge — the
        // residual sliver the stroke reserve alone left. Width only: horizontal ink
        // overhang is the caret-direction bearing; vertical uses the font line box.
        const stroke = this.Stroke?.Thickness ?? 0;
        const targetW = d.Width  + stroke * 2 + LABEL_INK_BLEED * 2;
        const targetH = d.Height + stroke * 2;
        this._fittingContent = true;
        try
        {
            if (Math.abs(targetW - this.Width)  > 0.5) this.Width  = targetW;
            if (Math.abs(targetH - this.Height) > 0.5) this.Height = targetH;
        }
        finally
        {
            this._fittingContent = false;
        }
    }

    protected override MeasureOverride(available: Size): Size
    {
        const measured = super.MeasureOverride(available);
        this._applyContentFit();
        return measured;
    }

    // Resolve every {field} in the label against this figure's live values.
    private _refreshLabelFields(): void
    {
        const doc = this.Text?.Document;
        if (doc !== undefined) resolveFields(doc, (k) => this._resolveField(k));
    }

    private _resolveField(key: FieldKind): string | undefined
    {
        switch (key)
        {
            case FieldKind.Width:  return String(Math.round(this.Width));
            case FieldKind.Height: return String(Math.round(this.Height));
            case FieldKind.Left:   return String(Math.round(this.Left));
            case FieldKind.Top:    return String(Math.round(this.Top));
            case FieldKind.Id:     return this.Id ?? '';
            default:               return undefined;
        }
    }

    public get Left(): number       { return this.get_property_value(Figure.LeftKey); }
    public set Left(value: number)  { this.set_property_value(Figure.LeftKey, value); }
    public get Top(): number        { return this.get_property_value(Figure.TopKey); }
    public set Top(value: number)   { this.set_property_value(Figure.TopKey, value); }
    public get Rotation(): number   { return this.get_property_value(Figure.RotationKey); }
    public set Rotation(value: number) { this.set_property_value(Figure.RotationKey, value); }
    public get BaseWidth(): number  { return this.get_property_value(Figure.BaseWidthKey); }
    public set BaseWidth(value: number)  { this.set_property_value(Figure.BaseWidthKey, value); }
    public get BaseHeight(): number { return this.get_property_value(Figure.BaseHeightKey); }
    public set BaseHeight(value: number) { this.set_property_value(Figure.BaseHeightKey, value); }
    public get LockAspectRatio(): boolean { return this.get_property_value(Figure.LockAspectRatioKey); }
    public set LockAspectRatio(value: boolean) { this.set_property_value(Figure.LockAspectRatioKey, value); }
    public get PositionFrom(): PositionAnchor { return this.get_property_value(Figure.PositionFromKey); }
    public set PositionFrom(value: PositionAnchor) { this.set_property_value(Figure.PositionFromKey, value); }

    // Read-only view of the scaled silhouette (was a DP). Kept because the port
    // resolver's outline mode reads `host.Geometry` (see port.ts / PortResolver);
    // the stored state now lives in _shape, driven by the geometry seams below.
    public get Geometry(): PathGeometry | undefined  { return this._shape; }
    // Inert catalog-kind provenance (serialization only) — see _kind.
    public get Kind(): string | undefined            { return this._kind; }
    public get SizeToContent(): boolean        { return this.get_property_value(Figure.SizeToContentKey); }
    public set SizeToContent(value: boolean)   { this.set_property_value(Figure.SizeToContentKey, value); }
    public get UserSized(): boolean            { return this.get_property_value(Figure.UserSizedKey); }
    public set UserSized(value: boolean)       { this.set_property_value(Figure.UserSizedKey, value); }
    // The text block itself. Always present (seeded in the ctor).
    public get Text(): ShapeText               { return this.get_property_value(Figure.TextKey)!; }
    // LabelText — sugar over Text.Content for the common "just set a caption"
    // path (and back-compat with the old flat string DP).
    public get LabelText(): string             { return this.Text?.Content ?? ''; }
    public set LabelText(value: string)        { if (this.Text !== undefined) this.Text.Content = value; }
    public get Id(): string | undefined        { return this.get_property_value(Figure.IdKey); }
    public set Id(value: string | undefined)   { this.set_property_value(Figure.IdKey, value); }
    public get IsSelected(): boolean           { return this.get_property_value(Figure.IsSelectedKey); }
    public set IsSelected(value: boolean)      { this.set_property_value(Figure.IsSelectedKey, value); }

    public get PortProvider(): IPortProvider | undefined { return this.get_property_value(Figure.PortProviderKey); }
    public set PortProvider(value: IPortProvider | undefined) { this.set_property_value(Figure.PortProviderKey, value); }
    public get ExplicitPorts(): readonly Port[] | undefined { return this.get_property_value(Figure.ExplicitPortsKey); }
    public set ExplicitPorts(value: readonly Port[] | undefined) { this.set_property_value(Figure.ExplicitPortsKey, value); }

    // Unified port read surface — explicit list wins; otherwise
    // delegate to the per-Figure provider; otherwise the framework's
    // kind→provider default. § 7.13 of
    // [docs/connectors.md](../../../docs/connectors.md) tracks
    // the open question on lifting "either-or" to a concat-with-name-collision
    // strategy; v1 ships with the simple precedence below.
    public get Ports(): readonly Port[]
    {
        const explicit = this.ExplicitPorts;
        if (explicit !== undefined) return explicit;
        const provider = this.PortProvider ?? resolveDefaultPortProvider();
        return provider.GetPorts(this);
    }

    // ── Side-anchored endpoint registry ──────────────────────────────
    //
    // Delegated to SideEndpointRegistry (side-endpoint-host.ts).
    // Figure keeps its public API and the _sideEndpointsChangedListeners
    // channel (visual observers — SideBarsAdorner); the registry handles
    // endpoint → slot bookkeeping.  _fireSideRebalance bridges both by
    // calling the registry's connector callbacks first, then the
    // observer channel.
    private readonly _sideHost = new SideEndpointRegistry(
        () => new Rect(this.Left, this.Top, this.Width, this.Height),
    );

    /** @internal — called by Connector when an endpoint settles on this Figure + side. */
    public _registerSideEndpoint(
        side: ResolvedPortSide,
        endpoint: ConnectorEndpoint,
        onRebalance: () => void,
        owner?: ISideAnchoredConnector,
    ): void
    {
        // Delegate to the registry; it calls _fireSideRebalance via its
        // own internal path which only fires connector callbacks.  We
        // intercept the post-register rebalance here to also notify
        // the observer channel.
        this._sideHost._registerSideEndpoint(side, endpoint, onRebalance, owner);
        // NOTE: the registry already fired connector rebalances; we
        // additionally fire observers via _notifySideEndpointsChanged.
        this._notifySideEndpointsChanged();
    }

    /** @internal — called by Connector when an endpoint moves off / clears. */
    public _unregisterSideEndpoint(side: ResolvedPortSide, endpoint: ConnectorEndpoint): void
    {
        this._sideHost._unregisterSideEndpoint(side, endpoint);
        this._notifySideEndpointsChanged();
    }

    /** Slot index + total count for `endpoint` on `side`, or undefined
     *  if the endpoint isn't registered on that side. The slot index is
     *  insertion-order based, which keeps positions stable across
     *  unrelated additions to OTHER sides. */
    public GetSideSlot(
        endpoint: ConnectorEndpoint,
        side: ResolvedPortSide,
    ): { index: number; count: number } | undefined
    {
        return this._sideHost.GetSideSlot(endpoint, side);
    }

    /** Number of side-anchored endpoints currently registered on `side`.
     *  The dynamic-port distribution lays this many slots along the side
     *  via `t = (i + 1) / (count + 1)`; the SideBarsAdorner uses this
     *  count to paint a port-marker dot per slot. */
    public GetSideEndpointCount(side: ResolvedPortSide): number
    {
        return this._sideHost.GetSideEndpointCount(side);
    }

    /** Slot index whose dynamic position is nearest `cursor` along the
     *  side's distribution axis (Y for E/W, X for N/S), inverting the
     *  same Left/Top/Width/Height slot layout the resolver lays out in
     *  [connector.ts]'s tryResolveSideSlot. Returns undefined when the
     *  side is empty or the figure is unsized. */
    public SlotIndexForPosition(side: ResolvedPortSide, cursor: Point): number | undefined
    {
        return this._sideHost.SlotIndexForPosition(side, cursor);
    }

    /** Move `endpoint` to slot `toIndex` on `side`, firing a rebalance so
     *  every connector on the side re-routes at its new slot. The index is
     *  clamped to the list; a no-op move (same index) skips the rebalance.
     *  Backs the position-based segment-drag reorder + its abort restore.
     *
     *  This is a HAND placement, so it freezes the side against the auto
     *  crossing-optimizer — otherwise the optimizer would immediately undo the
     *  user's drag when the new order happens to read as a crossing. */
    public MoveSideEndpoint(side: ResolvedPortSide, endpoint: ConnectorEndpoint, toIndex: number): void
    {
        const list = this._sideHost.getSideList(side);
        const from = list.indexOf(endpoint);
        if (from < 0) return;
        let to = toIndex;
        if (to < 0) to = 0;
        if (to > list.length - 1) to = list.length - 1;
        if (to === from) return;
        list.splice(from, 1);
        list.splice(to, 0, endpoint);
        this._sideHost.markUserOrdered(side);
        this._fireSideRebalance(side);
    }

    /** Reorder `endpoint` on `side` to the slot nearest `cursor` —
     *  SlotIndexForPosition + MoveSideEndpoint. No-op when the side is
     *  empty or the figure is unsized. */
    public ReorderSideEndpoint(side: ResolvedPortSide, endpoint: ConnectorEndpoint, cursor: Point): void
    {
        const idx = this.SlotIndexForPosition(side, cursor);
        if (idx === undefined) return;
        this.MoveSideEndpoint(side, endpoint, idx);
    }

    private _fireSideRebalance(side: ResolvedPortSide): void
    {
        // Fire connector rebalance callbacks via the registry.
        this._sideHost._fireSideRebalance(side);
        // Notify external observers (the SideBarsAdorner port-marker
        // overlay) that the side-endpoint count for at least one side
        // changed. Connectors react via the per-endpoint rebalance
        // callbacks above; this channel is for visual indicators that
        // need to redraw without owning a connector endpoint themselves.
        this._notifySideEndpointsChanged();
    }

    private _notifySideEndpointsChanged(): void
    {
        for (const l of [...this._sideEndpointsChangedListeners]) l();
    }

    private readonly _sideEndpointsChangedListeners: Set<() => void> = new Set();
    public AddSideEndpointsChangedListener   (listener: () => void): void { this._sideEndpointsChangedListeners.add(listener); }
    public RemoveSideEndpointsChangedListener(listener: () => void): void { this._sideEndpointsChangedListeners.delete(listener); }

    /** @internal — re-orders the side's endpoint slots to minimise crossings
     *  between the connectors that both attach to `side`. Triggered by
     *  Connector._scheduleRecompute after every recompute (registration
     *  changes AND figure moves both reach this entry point). Delegates to
     *  the shared registry, which owns the hill-climb + its re-entry guard. */
    public _optimizeSideIntersections(side: ResolvedPortSide): void
    {
        this._sideHost.optimizeIntersections(side);
    }

    private _rebuildGeometry(): void
    {
        if (this._source === undefined)
        {
            this._shape = undefined;
            this.InvalidateArrange();
            this.InvalidateVisual();
            return;
        }
        this._shape = scaleGeometry(this._source, this.Width, this.Height);
        // Re-arrange to rebuild ChildClip from the new _shape and repaint the own
        // silhouette (_shape is a plain field, so invalidate explicitly).
        // ClipToBounds defaults true on Figure (children clip to the shape, or to
        // the bounds rect when shapeless; the own stroke stays crisp).
        this.InvalidateArrange();
        this.InvalidateVisual();
    }

    // The silhouette drives own paint (buildPaintGeometry → inherited
    // Visual.RenderOverride draws Fill + Stroke over it), the children-only clip
    // (buildChildClipGeometry, applied via ClipToBounds), and hit / clip-to-bounds
    // (buildClipGeometry). No inset is applied to the paint geometry: own paint is
    // NOT self-clipped (the raw Clip DP is never set), so a centred stroke straddles
    // the outline exactly as a Shape primitive does. All three fall back to super
    // when there is no shape (a neutral container Figure).
    // A shapeless box node styles like a rounded-rect card — the FIGURE paints its
    // Fill/Stroke and clips its content to that rounded silhouette, exactly like a
    // geometric shape paints its _shape. This is how every box-shaped node (an
    // arch/content tile, a ContainerFigure, a TextNode/Callout) draws and STYLES
    // its box: the node itself owns the paint, so the Format Shape Stroke pen
    // (colour + width) takes effect. A bare neutral Figure opts out (PaintsCardBox
    // stays false) and paints nothing.
    private _isCardTile(): boolean
    {
        return this._shape === undefined && this.PaintsCardBox;
    }

    // Whether a shapeless figure paints its own rounded-rect card box instead of
    // delegating the box to a template Border. Content tiles (SizeToContent) do;
    // the box-node subclasses (ContainerFigure/TextNode/Callout) override this to
    // true so the node — not a Border — draws and styles its box. Kept as a
    // protected getter (not a DP) since it is a fixed per-type trait, not bindable
    // state.
    protected get PaintsCardBox(): boolean { return this.SizeToContent; }

    private _cardGeometry(size: Size): Geometry
    {
        return new RectangleGeometry(
            new Rect(0, 0, size.Width, size.Height),
            CONTENT_TILE_CORNER, CONTENT_TILE_CORNER);
    }

    protected override buildPaintGeometry(size: Size, inset: number): Geometry
    {
        if (this._shape !== undefined) return this._shape;
        if (this._isCardTile())        return this._cardGeometry(size);
        return super.buildPaintGeometry(size, inset);
    }

    protected override buildChildClipGeometry(size: Size): Geometry | undefined
    {
        if (this._shape !== undefined) return this._shape;
        if (this._isCardTile())        return this._cardGeometry(size);
        return super.buildChildClipGeometry(size);
    }

    protected override buildClipGeometry(size: Size): Geometry
    {
        if (this._shape !== undefined) return this._shape;
        if (this._isCardTile())        return this._cardGeometry(size);
        return super.buildClipGeometry(size);
    }

    // Confine picking to the silhouette — the SAME geometry the clip-to-bounds /
    // child-clip seams use (buildClipGeometry), so hit and clip agree by
    // construction. Only when the Figure actually has a shape and the slot is
    // non-degenerate; a neutral container Figure keeps the default AABB hit
    // region (undefined) so its content hit-tests normally. HitTestGeometry is
    // MetaData.None, so writing it here never re-invalidates layout.
    //
    // Use finalSize, NOT this.RenderSize: Visual.Arrange assigns RenderSize the
    // RETURN of this method, so the getter is still stale here (mirrors Shape).
    protected override ArrangeOverride(finalSize: Size): Size
    {
        const arranged = super.ArrangeOverride(finalSize);
        const confine = this._shape !== undefined
            && finalSize.Width > 0 && finalSize.Height > 0;
        this.HitTestGeometry = confine ? this.buildClipGeometry(finalSize) : undefined;
        return arranged;
    }

    // Paint the silhouette as own paint. Guard: a neutral container Figure (no
    // _source → no _shape) paints nothing, rather than the base bounds rect —
    // which also removes the historic stray-rect-behind-the-shape artifact.
    //
    // The paint is inlined from Visual.RenderOverride rather than delegated via
    // super — the inheritance chain runs Figure → ContentControl → Control, and
    // Control.RenderOverride is a deliberate no-op ("the template tree paints
    // itself"). Calling super here would therefore draw NOTHING (the historic
    // "figures render as empty boxes" bug). Fill + Stroke are the inherited
    // Visual DPs; buildPaintGeometry (overridden above) returns the silhouette
    // inset by half the stroke so a centred pen stays inside the outline.
    protected override RenderOverride(dc: DrawingContext): void
    {
        // A geometric shape paints its silhouette; a content tile paints its
        // rounded-rect card (buildPaintGeometry returns each). A bare neutral
        // container (neither) paints nothing — no stray rect behind the content.
        if (this._shape === undefined && !this._isCardTile()) return;
        const fill = this.Fill, stroke = this.Stroke;
        if (fill === undefined && stroke === undefined) return;
        const s = this.RenderSize;
        if (s.Width <= 0 || s.Height <= 0) return;
        const half = (stroke?.Thickness ?? 0) / 2;
        dc.DrawGeometry(fill, stroke, this.buildPaintGeometry(s, half));
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue:   unknown,
        newValue:   unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        // Mirror Left / Top onto Canvas.Left / Canvas.Top so the enclosing
        // Canvas re-positions us on its next Arrange pass. MetaData.Arrange
        // on the DP triggers an InvalidateArrange on this Visual; the
        // Canvas's own Arrange re-reads the attached properties and
        // re-places its children, so position changes propagate without
        // any per-child Canvas subscription.
        //
        // Match by descriptor identity (not by `Name`) since both Figure's
        // own Left/Top DPs and the Canvas.Left/Canvas.Top attached props
        // share the names — comparing strings would loop infinitely as
        // each Canvas.Set re-fires OnPropertyChanged with the same name.
        if (descriptor === Figure.LeftKey.descriptor && typeof newValue === 'number')
        {
            Canvas.SetLeft(this, newValue);
        }
        else if (descriptor === Figure.TopKey.descriptor && typeof newValue === 'number')
        {
            Canvas.SetTop(this, newValue);
        }
        // Resize rebuilds the rendered Geometry from the cached unit-1
        // source. Skipped when _source is undefined (a freshly-constructed
        // Figure without a kind/source assignment yet).
        else if ((descriptor.Name === 'Width' || descriptor.Name === 'Height')
                 && this._source !== undefined)
        {
            this._rebuildGeometry();
        }
        // Rotation renders via a persistent RotateTransform (see _applyRotation).
        else if (descriptor.Name === 'Rotation') this._applyRotation();
        // Slice 6: re-resolve live {field} tokens when a source value changes.
        if (FIELD_SOURCE_NAMES.has(descriptor.Name)) this._refreshLabelFields();
    }

    // Reused RotateTransform assigned to RenderTransform on first non-zero
    // rotation. Angle is MetaData.Render, so updating it repaints. Centering is
    // via RenderTransformOrigin=(0.5,0.5), so the pivot tracks resize for free.
    private _rotate: RotateTransform | undefined;

    private _applyRotation(): void
    {
        const angle = this.Rotation;
        if (this._rotate === undefined)
        {
            if (angle === 0) return;                     // stay transform-free until first rotate
            this._rotate = new RotateTransform();
            this.RenderTransformOrigin = new Point(0.5, 0.5);
            this.RenderTransform = this._rotate;
        }
        this._rotate.Angle = angle;
    }

    protected override OnPointerDown(args: PointerEventArgs): void
    {
        if (args.Handled) return;
        // Double-click begins in-place label editing (Visio). Skip the
        // drag / click-select machinery entirely for this gesture — the
        // editor takes the pointer from here.
        if (args.IsDoubleClick)
        {
            resolveEditTarget(this)?.BeginEdit();
            args.Handled = true;
            return;
        }
        // Press offset = where inside the node the cursor landed. Stored
        // in host (canvas) coordinates against the node's current Left /
        // Top — moving the node is then "wherever the cursor goes,
        // subtract the grab offset to place the top-left."
        this._dragging    = true;
        this._moved       = false;
        this._pressHostX  = args.HostX;
        this._pressHostY  = args.HostY;
        // Grab offset is stored in CONTENT space (computed after the selector is
        // resolved, below) so the node tracks the cursor at any zoom. The
        // enclosing ScrollViewer is snapshotted only for edge auto-scroll —
        // scroll-delta compensation is automatic now: HostToContent reads the
        // live ArrangedRect chain, which already carries the current -offset.
        this._dragScrollViewer   = Figure.findScrollViewer(this);
        // Snapshot group-drag partners. The press-time snapshot pins
        // the partner set for the whole gesture — selection mutations
        // mid-drag (rare, but routed-event ordering is finicky) won't
        // peel partners off mid-translation. `this` is excluded from
        // the partner list and moved separately in OnPointerMove —
        // keeps the delta-from-cursor formula honest (it reads / writes
        // `this.Left` / `this.Top` directly).
        this._dragPartners = undefined;
        const selector = Selector.FromContainer<Selector>(
            this, (v: Visual): v is Selector => v instanceof Selector);
        // Content-space grab offset via the enclosing Diagram (which IS the
        // Selector). Falls back to screen coords when no coordinate host is in
        // scope (e.g. a bare Figure in a unit test) — identity at zoom 1.
        // Drag-out prep: if this node is nested, pop it to the root host FIRST so
        // the whole drag operates in diagram space (its Left/Top become absolute).
        // On drop, OnPointerUp re-nests it into whatever container it lands in.
        if (this.ContainerParent !== undefined) placementOf(selector)?.reparent(this, undefined);
        const coord = selector as unknown as { HostToContent?(x: number, y: number): Point } | undefined;
        const grab = coord?.HostToContent?.(args.HostX, args.HostY);
        this._grabOffsetX = (grab?.X ?? args.HostX) - this.Left;
        this._grabOffsetY = (grab?.Y ?? args.HostY) - this.Top;
        const partners: Figure[] = [];
        // Selection-based partners — if `this` is selected, every other
        // selected container drags along with it (PowerPoint multi-select
        // semantics). Drag from a NON-selected node ignores the existing
        // selection; only `this` moves.
        if (selector !== undefined && Selector.GetIsSelected(this))
        {
            for (const c of selector.SelectedContainers)
            {
                // Skip this node's own container-descendants: they are visual
                // children and already move with it, so shifting them too would
                // double-move them.
                if (c !== this && c instanceof Figure && !Figure.isNestedUnder(c, this)) partners.push(c);
            }
        }
        // Group-membership partners — if the bound data exposes a
        // hierarchical Parent / Members structure (Visio-style groups),
        // every other leaf in `this`'s TOP-LEVEL ancestor drags along
        // regardless of selection state. That matches Visio / PowerPoint:
        // grabbing any member of a group moves the whole group, even
        // when the selection didn't pre-cover it.
        //
        // Structural duck-typing on DataContext — `Parent` (chained up to
        // the root) and `Members` (with `.Count` + `.Get(i)` on the root)
        // are the only contract. Any data shape that fits gets group-drag
        // for free; this framework class doesn't import the demo's
        // GroupVM.
        if (selector !== undefined)
        {
            // Items-are-Figures: the Figure IS the data entity, so the
            // Parent chain lives directly on `this` (a `Parent: Group |
            // undefined` field set by DiagramDocument.Group when the
            // figure is wrapped). The earlier shape read `this.DataContext`,
            // which the framework Diagram no longer sets when items are
            // already Figure instances — so the partner block silently
            // never ran and a member's drag moved it solo.
            //
            // Fallback to DataContext keeps the duck-type contract intact
            // for the legacy ItemsSource-of-VMs path (Diagram.bindContainer
            // sets DataContext when wrapping a non-Figure MuralBase).
            const entity = (this as unknown as { Parent?: unknown }).Parent !== undefined
                ? (this as unknown as { Parent?: unknown })
                : this.DataContext as { Parent?: unknown } | undefined;
            if (entity !== undefined)
            {
                // Walk up to the outermost ancestor. For a leaf with no
                // Parent, root === entity and collectHierarchicalLeaves
                // returns just [entity] — the loop body then degenerates
                // to a no-op (we skip self). For a leaf inside a group,
                // root is the top-level group and the loop adds every
                // other leaf.
                let root: { Parent?: unknown } = entity;
                while (root.Parent !== undefined) root = root.Parent as { Parent?: unknown };
                const leaves: unknown[] = [];
                Figure.collectHierarchicalLeaves(root, leaves);
                for (const leaf of leaves)
                {
                    if (leaf === this) continue;
                    // Items-are-Figures: the leaf already IS its container.
                    // Fall back to the Generator lookup for legacy VM-as-
                    // items consumers, where leaf is a data row and the
                    // container is a wrapping Figure.
                    const container = leaf instanceof Figure
                        ? leaf
                        : selector.Generator.ContainerFromItem(leaf);
                    if (container instanceof Figure && container !== this
                        && !partners.includes(container)
                        && !Figure.isNestedUnder(container, this))
                    {
                        partners.push(container);
                    }
                }
            }
        }
        if (partners.length > 0) this._dragPartners = partners;
        args.CapturePointer(this);
        args.Handled = true;
    }

    // Open the rigid-translate session for connectors internal to the
    // moving set (both endpoints among these figures) so their hand-bent
    // waypoints slide with the selection instead of being cleared by the
    // per-figure reroute. Deferred to the drag-threshold crossing (not
    // PointerDown) so a plain click never scans the connector list. The
    // enclosing Selector IS the Diagram (the connector store); duck-type it
    // to the host interface to avoid the diagram → figure import cycle
    // (same pattern as PositionSnap).
    private beginRigidConnectorDrag(): void
    {
        const movingSet = new Set<MuralBase>([this, ...(this._dragPartners ?? [])]);
        const selector = Selector.FromContainer<Selector>(
            this, (v: Visual): v is Selector => v instanceof Selector);
        const dragHost = selector as unknown as Partial<RigidConnectorDragHost> | undefined;
        this._rigidConnectors = dragHost?.BeginRigidConnectorDrag?.(movingSet);
    }

    protected override OnPointerMove(args: PointerEventArgs): void
    {
        if (!this._dragging) return;
        // Stay in click mode under the threshold so a normal click
        // doesn't drag the node by 1px and turn off the click-to-
        // select path.
        if (!this._moved)
        {
            const dx = args.HostX - this._pressHostX;
            const dy = args.HostY - this._pressHostY;
            if (Math.hypot(dx, dy) < Figure.CLICK_THRESHOLD_PX) return;
            this._moved = true;
            // The gesture is now a drag — snapshot the internal connectors
            // before the first position write clears their waypoints.
            this.beginRigidConnectorDrag();
            // Open ONE history transaction for the whole drag; closed in
            // OnPointerUp after any drop-reparent, so a drag-into-container is a
            // single undo step (the reparent's own bracket nests inside this one).
            const editHost = Selector.FromContainer<Selector>(
                this, (v: Visual): v is Selector => v instanceof Selector) as
                unknown as { _beginEdit?(l: string): void } | undefined;
            editHost?._beginEdit?.('Move');
            this._editBegun = true;
        }
        const sv = this._dragScrollViewer;

        // Snapshot pre-move position — partners get ONE net delta per
        // pointer-move event, after any cascade-driven re-corrections
        // below have settled.
        const preMoveLeft = this.Left;
        const preMoveTop  = this.Top;

        // All the position writes below re-route the attached connectors. On a
        // hub node (many connectors on one side) the crossing optimizer would
        // otherwise run once per attached connector PER TICK — O(k²) full
        // re-routes that freeze the drag. Coalesce the whole tick into one
        // settle: each write only marks connectors/sides dirty, and the Batch
        // exit does a single recompute-per-connector + one optimize-per-side.
        ConnectorRoutingScheduler.Batch(() =>
        {
        // First pass: write this.Left / this.Top using the current effective
        // scroll offset.
        this.moveSelfToCursor(args.HostX, args.HostY);

        // Cascade-correct loop. When the canvas (PaginatedCanvas) shrinks
        // because our write reduced the union extent, the ScrollViewer's
        // effective offset clamps to a smaller value at the next layout
        // pass. The canvas-origin-in-host shifts; the position we just
        // wrote now lands a screen-pixel off the cursor by the clamp
        // delta. The fix: force a layout flush, re-read effective
        // offsets, re-compute the target Left / Top, write again. Iterate
        // until offsets stop changing (or a safety cap is hit — a
        // cyclic shrink/grow scenario shouldn't exist but cap anyway).
        const host = this.FindAncestorPresentationTarget() as
            unknown as { Flush?(): void } | undefined;
        if (sv !== undefined && host?.Flush !== undefined)
        {
            let lastEffX = sv.effectiveHorizontalOffset();
            let lastEffY = sv.effectiveVerticalOffset();
            for (let iter = 0; iter < 4; iter++)
            {
                host.Flush();
                const curEffX = sv.effectiveHorizontalOffset();
                const curEffY = sv.effectiveVerticalOffset();
                if (curEffX === lastEffX && curEffY === lastEffY) break;
                lastEffX = curEffX;
                lastEffY = curEffY;
                this.moveSelfToCursor(args.HostX, args.HostY);
            }
        }

        // Group-drag delta: every partner shifts by the NET vector this
        // ended up moving (initial + any cascade corrections). Applying
        // partners AFTER the converge loop keeps them in lockstep with
        // the final this.Left / this.Top rather than the pre-correction
        // intermediate.
        const netDx = this.Left - preMoveLeft;
        const netDy = this.Top  - preMoveTop;
        if (this._dragPartners !== undefined && (netDx !== 0 || netDy !== 0))
        {
            for (const partner of this._dragPartners)
            {
                partner.Left = partner.Left + netDx;
                partner.Top  = partner.Top  + netDy;
            }
        }

        // Slide the internal connectors' waypoints by the same net delta.
        // Runs AFTER self + partners moved (whose Left/Top writes cleared
        // those waypoints) and re-lays them at snapshot + running total —
        // overwriting the clear within this synchronous tick, so the route
        // never paints in its torn-down state.
        if (this._rigidConnectors !== undefined && (netDx !== 0 || netDy !== 0))
        {
            this._rigidConnectors.Translate(netDx, netDy);
        }
        });

        // Live drop affordance: highlight the container this node would nest into
        // at its current centre (it was popped to root on pointer-down, so Left/Top
        // are diagram-space). Commit still happens on drop (OnPointerUp).
        const dragSelector = Selector.FromContainer<Selector>(
            this, (v: Visual): v is Selector => v instanceof Selector);
        placementOf(dragSelector)?.highlightCandidate(
            new Point(this.Left + this.Width / 2, this.Top + this.Height / 2), this);

        // Edge auto-scroll — the SV starts / continues / stops a tick
        // timer based on cursor proximity to its viewport edges. The
        // pulse re-evaluates on every move; the timer keeps scrolling
        // even when the cursor sits still near an edge.
        sv?.EvaluateEdgeAutoScroll(args.HostX, args.HostY);
        args.Handled = true;
    }

    // Single self-move sub-step used by OnPointerMove. Maps the cursor to a
    // content point via the enclosing Diagram's HostToContent — which divides by
    // the zoom and sums the live ArrangedRect chain (carrying the current scroll
    // -offset), so the node tracks the cursor at any zoom and after a mid-drag
    // auto-scroll / shrink-driven origin shift. Writes Left / Top at the Local
    // tier — the Figure IS the data now (no Style binding underneath), so the
    // write stays at Local and sticks for the next Arrange pass.
    private moveSelfToCursor(hostX: number, hostY: number): void
    {
        const selector = Selector.FromContainer<Selector>(
            this, (v: Visual): v is Selector => v instanceof Selector);
        const coord = selector as unknown as { HostToContent?(x: number, y: number): Point } | undefined;
        const cp = coord?.HostToContent?.(hostX, hostY) ?? { X: hostX, Y: hostY };
        let candidateLeft = cp.X - this._grabOffsetX;
        let candidateTop  = cp.Y - this._grabOffsetY;
        // §19.3 — apply the enclosing Diagram's PositionSnap callback before
        // writing. The callback returns a snapped rect; we honour its X / Y (the
        // rect's top-left in canvas coords) but keep the candidate's Width /
        // Height (snap is positional, not dimensional).
        const ar = this.ArrangedRect;
        const w = ar?.Width  ?? 0;
        const h = ar?.Height ?? 0;
        const snap = (selector as unknown as { PositionSnap?: (r: Rect) => Rect } | undefined)?.PositionSnap;
        if (snap !== undefined)
        {
            const snapped = snap(new Rect(candidateLeft, candidateTop, w, h));
            candidateLeft = snapped.X;
            candidateTop  = snapped.Y;
        }
        this.Left = candidateLeft;
        this.Top  = candidateTop;
    }

    protected override OnPointerUp(args: PointerEventArgs): void
    {
        if (!this._dragging) return;
        const wasDrag = this._moved;
        this._dragging = false;
        this._moved    = false;
        // Drop the press-time partner snapshot — gesture is over.
        this._dragPartners = undefined;
        // Close the rigid-translate session — waypoints already sit at their
        // final translated positions.
        this._rigidConnectors?.End();
        this._rigidConnectors = undefined;
        // Stop any auto-scroll tick we kicked off, regardless of whether
        // the gesture was a drag or a click — StopEdgeAutoScroll is a
        // no-op when no timer is active.
        this._dragScrollViewer?.StopEdgeAutoScroll();
        this._dragScrollViewer = undefined;
        args.ReleasePointerCapture();
        if (wasDrag)
        {
            // Drag-in/out: the node dragged in diagram space (popped to root on
            // down). Re-nest it into whichever container its centre now lands in
            // — or leave it at root when over none. Committing on drop (not
            // mid-drag) avoids boundary thrash.
            const dropSelector = Selector.FromContainer<Selector>(
                this, (v: Visual): v is Selector => v instanceof Selector);
            const placement = placementOf(dropSelector);
            if (placement !== undefined)
            {
                placement.clearCandidate();   // drop commits — drop the live affordance
                const centre = new Point(this.Left + this.Width / 2, this.Top + this.Height / 2);
                const target = placement.containerAt(centre, this);
                placement.reparent(this, target?.Id);
            }
        }
        if (!wasDrag)
        {
            const selector = Selector.FromContainer<Selector>(
                this, (v: Visual): v is Selector => v instanceof Selector);
            // Visio / PowerPoint-style: clicking a member of a Group
            // selects the outermost Group, not the leaf. Walk up the
            // Parent chain to find the top-level entity (a Figure with
            // no Parent, or a Group with no Parent). The Selector takes
            // it as the selected container; SelectionBoundsAdorner /
            // SelectionResize wire bounds around the group bbox, and
            // ALL members move together when the user starts dragging
            // (group-drag partners in OnPointerDown collect siblings
            // anyway, but the selection-bounds adorner needs the Group
            // as a SelectedItems entry to draw around the union).
            let target: Visual = this;
            let parent: unknown = (this as unknown as { Parent?: unknown }).Parent;
            while (parent instanceof Visual)
            {
                target = parent;
                parent = (parent as unknown as { Parent?: unknown }).Parent;
            }
            selector?.HandleContainerClick(target, args.Modifiers);
        }
        // Close the drag's history transaction LAST — after the drop-reparent
        // above — so move + reparent collapse into one undo step.
        if (this._editBegun)
        {
            this._editBegun = false;
            const endHost = Selector.FromContainer<Selector>(
                this, (v: Visual): v is Selector => v instanceof Selector) as
                unknown as { _endEdit?(): void } | undefined;
            endHost?._endEdit?.();
        }
        args.Handled = true;
    }

    // Recursive descent on a hierarchical DataContext, structurally typed.
    // A node with a `Members` collection (anything exposing `.Count` and
    // `.Get(i)` — ObservableCollection or duck-equivalent) recurses into
    // its members; anything else is a leaf and gets appended. Used by
    // OnPointerDown to gather group-drag partners for any node whose
    // bound data sits inside a Visio-/PowerPoint-style group hierarchy.
    // Defined as a static helper so the OnPointerDown body stays linear.
    // True when `node` is nested (directly or transitively) inside `ancestor`
    // via the ContainerParent chain. Drag-partner collection uses it to skip a
    // dragged container's own children (they move as visual descendants already).
    private static isNestedUnder(node: Figure, ancestor: Figure): boolean
    {
        for (let c = node.ContainerParent; c !== undefined; c = c.ContainerParent)
            if (c === ancestor) return true;
        return false;
    }

    private static collectHierarchicalLeaves(entity: unknown, out: unknown[]): void
    {
        const members = (entity as { Members?: { Count?: number; Get?(i: number): unknown } }).Members;
        if (members !== undefined
            && typeof members.Count === 'number'
            && typeof members.Get   === 'function')
        {
            for (let i = 0; i < members.Count; i++)
            {
                Figure.collectHierarchicalLeaves(members.Get(i), out);
            }
            return;
        }
        out.push(entity);
    }

    // Walk up the visual tree to find the closest enclosing ScrollViewer
    // (if any). Used at PointerDown so the auto-scroll / scroll-delta
    // compensation logic in OnPointerMove can read offsets without re-
    // walking on every move.
    private static findScrollViewer(start: Visual): ScrollViewer | undefined
    {
        let cur: Visual | undefined = start.GetVisualParent();
        while (cur !== undefined)
        {
            if (cur instanceof ScrollViewer) return cur;
            cur = cur.GetVisualParent();
        }
        return undefined;
    }
}

// The side-intersection optimizer + its crossing/overlap geometry helpers
// live in side-endpoint-host.ts (the shared SideEndpointRegistry), so any
// Figure host shares one implementation.

