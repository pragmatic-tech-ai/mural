import {
    Element,
    MetaData,
    MuralBase,
    Rect,
    Size,
    type PointerEventArgs,
    type PropertyDescriptor,
} from '../../runtime/index.js';
import { resolveKey } from '../../runtime/model-internals.js';
import {
    type Geometry,
    PathGeometry,
    Pen,
    Point,
    RotateTransform,
    ScaleTransform,
    TransformGroup,
    type Visual,
} from '../../visual-engine/index.js';
import { Shape } from '../../basic/shapes/shape.js';
import { Canvas } from '../../basic/panels/canvas.js';
import { DataTemplate } from '../../basic/templates/data-template.js';
import { ShapeText } from './shape-text.js';
import { FieldKind, resolveFields } from './shape-text-field.js';
import { nearestTOnPolyline, pointAlongPolyline, polylineLength, splitPolylineAroundRect } from './connector-route.js';
import { diagramSpaceRect, type SpatialNode } from './coordinate-space.js';
import { ConnectorEndpoint } from './connector-endpoint.js';
import { ConnectorCapDataContext } from './caps/connector-cap-data-context.js';
import { Figure } from './figure.js';
import { NodeViewModel } from './node-view-model.js';
import { type ISideEndpointHost } from './side-endpoint-host.js';
import {
    type IPortHost,
    Port,
    PortResolver,
    PortSide,
    type ResolvedPortSide,
} from './port.js';
import {
    ConnectorEnd,
    type ResolvedAnchor,
    type RouteSpec,
    RouterRegistry,
    RoutingMode,
} from './routing/router.js';
import {
    pathGeometryToPolyline,
    polylinesToPathGeometry,
    polylineToPathGeometry,
    shortenPolyline,
} from './caps/cap-inset.js';
import { DiagramSettings } from './diagram-settings.js';
import { type RouteWaypoint, routePoints } from './route-waypoint.js';
import { minimiseRoute } from './route-minimiser.js';

// Self-register the three default routers so a consumer that imports a
// Connector — or anything that transitively imports Connector — gets
// a working RouterRegistry without an explicit side-effect import per
// routing mode. Tests that explicitly import a single router still
// work; the register() calls are idempotent (Map.set). Consumers wanting
// a fully custom routing surface can call RouterRegistry.register again
// after this module loads to override.
import './routing/straight-router.js';
import './routing/orthogonal-router.js';
import './routing/bezier-router.js';

// Per-instance Stroke seed comes from DiagramSettings.ConnectorDefaultStroke()
// (cloned in the ctor with the width from ConnectorStrokeWidth()) so PenEditor's
// in-place mutation can't leak across instances — same convention as figure.ts.

// How the geometric-clip fallback (resolution path 5 of § 3.2) treats
// the host's footprint. Bbox is fast — clip against ArrangedRect.
// Geometry is precise but expensive (full path clipping). v1 ships
// Bbox only; Geometry mode lands when a demo motivates it.
export enum AnchorClip
{
    Bbox     = 'Bbox',
    Geometry = 'Geometry',
}

// Skeleton Connector — DPs + endpoint resolution + route compute +
// reactivity. Cap visuals (§ 3.6), HitTestGeometry widening, and
// interactive edit (§ 4) land in later steps. Inherits Stroke / Fill /
// StrokeThickness / Geometry from Shape; the route compute writes the
// resolved PathGeometry onto Shape.Geometry, and Shape's RenderOverride
// paints it.
//
// MeasureOverride stays as Shape's `=> Size.Zero` — the route is
// reactively computed via OnPropertyChanged on the input DPs and on
// the source / target nodes' position changes, not from the measure
// pass. See "Why not MeasureOverride" in § 3.4 of
// [docs/connectors.md](../../../docs/connectors.md).
//
// The invisible pointer hit band around a route (see Shape.HitTestStrokeWidth)
// is seeded per-instance in the ctor from DiagramSettings.ConnectorHitWidth()
// (default 14 → ±7px tolerance) so a settings override takes effect for new
// connectors without a class-static default.

export class Connector extends Shape
{
    // Route applyDefaultStyle() to Style[TargetType=Connector] (the
    // DefaultConnector entry in diagram.template.mu, which sets the
    // default TargetCapTemplate=@ArrowCap). Without this the ctor's
    // applyDefaultStyle() resolves nothing and connectors get no default
    // cap. Same pattern as Figure ([figure.ts:77-79](./figure.ts#L77)).
    static {
        MuralBase.OverrideMetadata(Connector, Element.DefaultStyleKeyKey, { default_value: Connector });
    }

    // Default z-order for a materialized connector and its caps/label: below
    // the figure default (0) so a pristine connector paints behind figures. A
    // z-order command overrides this by renumbering the unified figure+connector
    // stack; the DiagramConnectorsMaterializer keeps caps/label in step.
    public static readonly DefaultZIndex = -1;

    public static readonly SourceKey      = MuralBase.RegisterProperty<ConnectorEndpoint | undefined>(
        Connector, 'Source',      undefined,             MetaData.None);
    public static readonly TargetKey      = MuralBase.RegisterProperty<ConnectorEndpoint | undefined>(
        Connector, 'Target',      undefined,             MetaData.None);
    public static readonly WaypointsKey   = MuralBase.RegisterProperty<readonly RouteWaypoint[] | undefined>(
        Connector, 'Waypoints',   undefined,             MetaData.None);
    public static readonly RoutingModeKey = MuralBase.RegisterProperty<string>(
        Connector, 'RoutingMode', RoutingMode.Orthogonal, MetaData.None);
    public static readonly AnchorClipKey  = MuralBase.RegisterProperty<AnchorClip>(
        Connector, 'AnchorClip',  AnchorClip.Bbox,       MetaData.None);

    // Per-end cap template DPs. When set, the connector instantiates
    // the template's visual at construction-of-the-cap time, reads
    // CapInset off the materialized root, shortens the route polyline
    // by that amount, and rotates the cap by tangentAt(end). Default
    // undefined = no cap at that end. § 3.4 + § 3.6 of
    // [docs/connectors.md](../../../docs/connectors.md).
    public static readonly SourceCapTemplateKey = MuralBase.RegisterProperty<DataTemplate | undefined>(
        Connector, 'SourceCapTemplate', undefined, MetaData.None);
    public static readonly TargetCapTemplateKey = MuralBase.RegisterProperty<DataTemplate | undefined>(
        Connector, 'TargetCapTemplate', undefined, MetaData.None);

    // Per-end cap size multipliers. 1 = the cap template's authored size;
    // the formatting UI lets the user scale a cap between 0.5× and 1.5×.
    // The factor scales BOTH the cap visual (a ScaleTransform composed
    // with the orientation RotateTransform about the hot-point origin) and
    // the CapInset used to shorten the painted line, so the line keeps
    // meeting the resized cap's back edge. A change re-routes to re-place +
    // re-inset the cap.
    public static readonly SourceCapScaleKey = MuralBase.RegisterProperty<number>(
        Connector, 'SourceCapScale', 1, MetaData.None);
    public static readonly TargetCapScaleKey = MuralBase.RegisterProperty<number>(
        Connector, 'TargetCapScale', 1, MetaData.None);

    // Connector label (§ diagram-text Slice 5). The connector owns a
    // first-class ShapeText created in the ctor; LabelPosition is the
    // arc-length fraction along the rendered route where the label centres
    // (0.5 = midpoint). Both MetaData.None — a change repositions the label
    // imperatively (Canvas.Left/Top), not through a measure/arrange input.
    public static readonly TextKey = MuralBase.RegisterProperty<ShapeText | undefined>(
        Connector, 'Text', undefined, MetaData.None);
    public static readonly LabelPositionKey = MuralBase.RegisterProperty<number>(
        Connector, 'LabelPosition', 0.5, MetaData.None);

    // CapInset is an attached property on Visual — set by the cap
    // template author on the cap's template root to tell the connector
    // how far back to shorten the painted line. Registered here with
    // Connector as the owner so markup `[Connector.CapInset]=12` resolves.
    public static readonly CapInsetKey = MuralBase.RegisterAttachedProperty<number>(
        Connector, 'CapInset', 0, MetaData.None);

    public static GetCapInset(v: Visual): number { return v.get_property_value(Connector.CapInsetKey); }
    public static SetCapInset(v: Visual, value: number): void { v.set_property_value(Connector.CapInsetKey, value); }

    // Keep the invisible click/hover band a constant ON-SCREEN width regardless of
    // the diagram camera zoom (the route geometry is scaled by the camera transform,
    // so the band must be divided by the zoom to render at a constant pixel width).
    // Called by the owning Diagram on zoom change.
    public applyCameraZoom(zoom: number): void
    {
        this.set_property_value(Shape.HitTestStrokeWidthKey, DiagramSettings.ConnectorHitWidth() / Math.max(zoom, 0.0001));
    }

    public get Source():       ConnectorEndpoint | undefined { return this.get_property_value(Connector.SourceKey); }
    public set Source(v:       ConnectorEndpoint | undefined) { this.set_property_value(Connector.SourceKey, v); }
    public get Target():       ConnectorEndpoint | undefined { return this.get_property_value(Connector.TargetKey); }
    public set Target(v:       ConnectorEndpoint | undefined) { this.set_property_value(Connector.TargetKey, v); }
    public get Waypoints():    readonly RouteWaypoint[] | undefined  { return this.get_property_value(Connector.WaypointsKey); }
    public set Waypoints(v:    readonly RouteWaypoint[] | undefined) { this.set_property_value(Connector.WaypointsKey, v); }
    public get RoutingMode():  string                        { return this.get_property_value(Connector.RoutingModeKey); }
    public set RoutingMode(v:  string)                       { this.set_property_value(Connector.RoutingModeKey, v); }
    public get AnchorClip():   AnchorClip                    { return this.get_property_value(Connector.AnchorClipKey); }
    public set AnchorClip(v:   AnchorClip)                   { this.set_property_value(Connector.AnchorClipKey, v); }
    public get SourceCapTemplate(): DataTemplate | undefined { return this.get_property_value(Connector.SourceCapTemplateKey); }
    public set SourceCapTemplate(v: DataTemplate | undefined) { this.set_property_value(Connector.SourceCapTemplateKey, v); }
    public get TargetCapTemplate(): DataTemplate | undefined { return this.get_property_value(Connector.TargetCapTemplateKey); }
    public set TargetCapTemplate(v: DataTemplate | undefined) { this.set_property_value(Connector.TargetCapTemplateKey, v); }
    public get SourceCapScale(): number { return this.get_property_value(Connector.SourceCapScaleKey); }
    public set SourceCapScale(v: number) { this.set_property_value(Connector.SourceCapScaleKey, v); }
    public get TargetCapScale(): number { return this.get_property_value(Connector.TargetCapScaleKey); }
    public set TargetCapScale(v: number) { this.set_property_value(Connector.TargetCapScaleKey, v); }

    // Derived (system-projected) connector: reconstructed from an external source
    // of truth — a model→diagram binding re-projects it on every reconcile. Such a
    // connector is EXCLUDED from serialization AND from the undo-history snapshot:
    // persisting it would duplicate on reload, and recording it would litter history
    // with projection churn (create / delete / re-route) that the reconcile re-
    // derives anyway. User-drawn connectors (and a standalone diagram's) default to
    // false and round-trip normally. Plain field — no view binds it.
    private _isDerived = false;
    public get IsDerived(): boolean { return this._isDerived; }
    public set IsDerived(v: boolean) { this._isDerived = v; }

    // The label text block — always present (seeded in the ctor). LabelText
    // is sugar over Text.Content for the common "just caption it" path.
    public get Text(): ShapeText               { return this.get_property_value(Connector.TextKey)!; }
    public get LabelText(): string             { return this.Text?.Content ?? ''; }
    public set LabelText(v: string)            { if (this.Text !== undefined) this.Text.Content = v; }
    public get LabelPosition(): number         { return this.get_property_value(Connector.LabelPositionKey); }
    public set LabelPosition(v: number)        { this.set_property_value(Connector.LabelPositionKey, v); }
    // The mounted label visual — the connectors materializer mounts this as a
    // connectors-layer sibling (like caps); _placeLabel positions it.
    public get LabelInstance(): ShapeText      { return this.Text; }

    // Materialized cap visuals. Lifetime: created when the
    // corresponding *CapTemplate DP is set, replaced when it flips,
    // dropped when it clears. Tests inspect these to verify the
    // cap pipeline produced the expected visual + transform.
    //
    // These cap visuals are mounted onto the diagram canvas as siblings
    // of the connector by the DiagramConnectorsMaterializer, which also
    // keeps their ZIndex in step with the connector's. The pipeline here
    // computes the shortened Geometry, the cap's RenderTransform, and the
    // cap's Canvas.Left / Top.
    private _sourceCapInstance: Visual | undefined = undefined;
    private _targetCapInstance: Visual | undefined = undefined;
    public get SourceCapInstance(): Visual | undefined { return this._sourceCapInstance; }
    public get TargetCapInstance(): Visual | undefined { return this._targetCapInstance; }

    // Per-end cap DataContexts — the paint surface a cap template binds
    // ($Brush / $Pen) so the cap tracks THIS connector's Stroke. Created
    // lazily the first time an end gets a cap; kept synced from Stroke by
    // _resyncCapContexts (on cap creation + on every Stroke change). The
    // same context instance lives for the connector's lifetime so the
    // cap's bindings stay live across re-routes. Exposed for tests to
    // assert the cap colour follows the connector.
    private _sourceCapContext: ConnectorCapDataContext | undefined = undefined;
    private _targetCapContext: ConnectorCapDataContext | undefined = undefined;
    public get SourceCapContext(): ConnectorCapDataContext | undefined { return this._sourceCapContext; }
    public get TargetCapContext(): ConnectorCapDataContext | undefined { return this._targetCapContext; }

    // Tracked Pen whose `Brush` we listen on. A Stroke reference swap
    // re-points this; an in-place pen.Brush REFERENCE swap (PenEditor
    // assigning a new brush onto the same Pen) fires _onCapStrokeBrushChanged
    // → re-sync so filled caps (bound to $Brush) recolour too. In-place
    // brush-COLOUR mutation needs nothing here: the cap's Fill IS that
    // same brush instance, and Shape's own fill listener repaints it.
    private _trackedCapPen: Pen | undefined = undefined;
    private readonly _onCapStrokeBrushChanged = (): void => { this._resyncCapContexts(); };

    // Last resolved anchors from _scheduleRecompute. Edit-mode handle
    // adorners read these to position endpoint dots in canvas-host
    // coords without redoing the 5-path resolution dance themselves.
    // undefined when either endpoint is missing (Geometry is also
    // undefined in that state, so nothing to adorn).
    private _currentSrcAnchor: ResolvedAnchor | undefined = undefined;
    private _currentTgtAnchor: ResolvedAnchor | undefined = undefined;
    public get CurrentSourceAnchor(): ResolvedAnchor | undefined { return this._currentSrcAnchor; }
    public get CurrentTargetAnchor(): ResolvedAnchor | undefined { return this._currentTgtAnchor; }

    // The full rendered route as a point polyline — source anchor, every
    // bend the router emitted (including the L/Z corners an Orthogonal
    // route computes from ZERO user waypoints), then the target anchor.
    // This is the route the user actually SEES, so the edit adorner places
    // mid-segment drag handles against it rather than against Waypoints
    // (which only holds user-authored bends — usually none). Taken from
    // the UNCAPPED route geometry so the corners sit on the port outward
    // rays (cap inset only shortens the two end tips). undefined when the
    // route isn't a polyline (Bezier) or either endpoint is missing.
    private _currentRoutePoints: readonly Point[] | undefined = undefined;
    public get CurrentRoutePoints(): readonly Point[] | undefined { return this._currentRoutePoints; }

    // The polyline actually DRAWN (post cap-inset), from which the final
    // Geometry is built — split into two runs when a label breaks the line
    // (the "line gap" style). undefined for a Bezier route or a missing
    // endpoint, where Geometry is written verbatim and no gap applies.
    // Cached so a label drag / edit (which does not re-route) can re-break
    // the line at the label's new spot via _applyLabelGap without a full
    // route recompute.
    private _drawnPolyline: readonly Point[] | undefined = undefined;

    // Breathing room, in host units, added around the label's box so the
    // route stops a hair short of the glyphs rather than kissing them.
    private static readonly LabelGapMargin = 3;

    // Tracked previous endpoint references so OnPropertyChanged can
    // detach listeners from the OLD endpoint before re-attaching to
    // the NEW one. _trackedSourceNode / _trackedTargetNode play the
    // same role for the inner Node DP.
    private _trackedSource:     ConnectorEndpoint | undefined = undefined;
    private _trackedTarget:     ConnectorEndpoint | undefined = undefined;
    private _trackedSourceNode: MuralBase | undefined = undefined;
    private _trackedTargetNode: MuralBase | undefined = undefined;
    // Ancestor containers whose Left/Top this connector watches, so a nested
    // endpoint re-routes when an ANCESTOR moves (its own Left/Top don't tick).
    // Refreshed whenever the endpoint node's own Left/Top ticks (reparent writes
    // them) — the only signal the ContainerParent chain changed.
    private _sourceAncestors: MuralBase[] = [];
    private _targetAncestors: MuralBase[] = [];

    // Side-anchored endpoint registration on the host Figure or VM (any
    // ISideEndpointHost). When an endpoint settles on (host, PortSide S)
    // with no PortName / PortIndex / FreePoint set, the connector registers
    // it in the host's side-endpoint list so its slot index participates in
    // the distribution rule. Subsequent endpoint changes re-register;
    // teardown (Source/Target swap, ctor cleanup) unregisters.
    private _trackedSourceFigure: ISideEndpointHost | undefined = undefined;
    private _trackedSourceSide:   ResolvedPortSide | undefined = undefined;
    private _trackedTargetFigure: ISideEndpointHost | undefined = undefined;
    private _trackedTargetSide:   ResolvedPortSide | undefined = undefined;

    // Re-entry guard. _scheduleRecompute writes to ep.PortSide during
    // the bake step (bare-Node endpoint legacy path), which fires
    // OnPropertyChanged → _on*EndpointInputChanged → _scheduleRecompute
    // RECURSIVELY. Without the guard, the nested call would resolve +
    // route with the freshly-baked side (correct, centered via path 3a)
    // and assign Geometry — and then the outer call would continue with
    // its STALE pre-bake anchors and clobber that Geometry with the
    // off-center first-pass route. The guard skips nested calls; the
    // outer call detects the bake and re-resolves locally to keep the
    // recompute coherent.
    private _recomputing: boolean = false;

    // Label drag state (§ Slice 5). _labelDragging spans the label's
    // PointerDown → PointerUp; the offset converts host → canvas coords
    // (translation-only canvas) so nearest-t projects the cursor onto the
    // route. _onLabelContentChanged re-syncs hit-testing + re-centres when
    // the label's text (hence size) changes.
    private _labelDragging = false;
    private _labelOffsetX = 0;
    private _labelOffsetY = 0;
    private readonly _onLabelContentChanged = (): void => { this._syncLabelHitTest(); this._placeLabel(); this._applyLabelGap(); this._refreshLabelFields(); };

    // Bound callbacks — required for symmetric Add/Remove on the
    // MuralBase PropertyChangedListener API.
    private readonly _onSourceEndpointInputChanged = (): void => {
        this._reattachSourceNodeListener();
        this._reregisterSourceSide();
        this._scheduleRecompute();
    };
    private readonly _onTargetEndpointInputChanged = (): void => {
        this._reattachTargetNodeListener();
        this._reregisterTargetSide();
        this._scheduleRecompute();
    };
    // The endpoint node's OWN Left/Top ticked — drag, or a reparent (which writes
    // parent-relative coords). Refresh the ancestor set first (reparent is the only
    // thing that changes the chain, and it always writes these), then re-route. The
    // refresh touches ANCESTOR listeners, never this node's, so it's re-entrancy-safe.
    private readonly _onSourceNodeMoved = (): void => { this._refreshSourceAncestorListeners(); this._onAttachedNodeMoved(); };
    private readonly _onTargetNodeMoved = (): void => { this._refreshTargetAncestorListeners(); this._onAttachedNodeMoved(); };
    // An ANCESTOR container of a nested endpoint moved — re-route only (the chain
    // is unchanged by an ancestor move, so no re-subscribe here; that would detach
    // the very listener mid-dispatch).
    private readonly _onSourceAncestorMoved = (): void => { this._onAttachedNodeMoved(); };
    private readonly _onTargetAncestorMoved = (): void => { this._onAttachedNodeMoved(); };

    // An attached figure moved (Left / Top changed). Waypoints are absolute
    // canvas coordinates, so they don't follow the figure — a manually routed /
    // segment-dragged bend would be left stranded and the router would bend the
    // new route awkwardly around it. A moved figure therefore reroutes FULLY:
    // every waypoint is recomputed against the figure's new position, including
    // the user-pinned (userAltered) vertices — moving a node discards the manual
    // route so the connector re-routes clean. Clearing the Waypoints DP itself
    // schedules the recompute; with nothing to clear, recompute directly.
    private _onAttachedNodeMoved(): void
    {
        if (this.Waypoints !== undefined)
        {
            this.Waypoints = undefined;   // drop auto AND pinned vertices → clean reroute
        }
        else
        {
            this._scheduleRecompute();
        }
    }
    // An attached figure RESIZED (Width / Height changed) — from an adorner
    // handle drag or a Size & Position editor edit. Unlike a move, a resize
    // keeps the figure roughly in place, so we reroute against the new rect
    // (re-resolving the perimeter anchors) WITHOUT discarding user waypoints.
    private readonly _onSourceNodeResized = (): void => { this._scheduleRecompute(); };
    private readonly _onTargetNodeResized = (): void => { this._scheduleRecompute(); };
    private readonly _onSourceSideRebalance = (): void => { this._scheduleRecompute(); };
    private readonly _onTargetSideRebalance = (): void => { this._scheduleRecompute(); };

    constructor()
    {
        super();
        // Per-instance default Stroke. Connector inherits Shape's
        // Stroke=undefined default — DrawGeometry treats that as "paint
        // nothing", which makes every freshly-constructed connector
        // invisible. Same per-instance allocation pattern as Figure so
        // PenEditor's in-place mutation can't leak across connectors.
        this.set_property_value(
            Connector.StrokeKey,
            new Pen(DiagramSettings.ConnectorDefaultStroke(), DiagramSettings.ConnectorStrokeWidth()));
        // Seed the pointer hit band from settings (default 14 → ±7px). A
        // per-instance write rather than a class-static default so a settings
        // override applies to freshly-drawn connectors; consumers can still
        // override per-connector via HitTestStrokeWidth.
        this.set_property_value(Shape.HitTestStrokeWidthKey, DiagramSettings.ConnectorHitWidth());

        // Default Style lands TargetCapTemplate=@ArrowCap (and any future
        // Connector chrome). Called AFTER the per-instance Stroke so the
        // cap context — created when the Style applies the cap template —
        // seeds from the right pen. Same per-instance-Pen-then-Style order
        // Figure uses ([figure.ts:268-284](./figure.ts#L268)).
        //
        // The default Stroke stays an imperative per-instance clone above
        // rather than a Style setter ON PURPOSE: a markup setter would
        // hand every connector the SAME Pen instance, and PenEditor's
        // in-place mutation would then leak across connectors. Figure
        // seeds its Stroke the same way for the same reason.
        //
        // No-ops when no framework theme is registered (bare unit-test
        // `new Connector()`), so test connectors stay cap-less until a
        // template is set explicitly.
        this.applyDefaultStyle();

        // Label (§ Slice 5): a first-class ShapeText that rides the route.
        // Created after applyDefaultStyle so it resolves the theme; the
        // connectors materializer mounts it as a connectors-layer sibling and
        // _placeLabel positions it. Empty by default (invisible + non-hit).
        const label = new ShapeText();
        this.set_property_value(Connector.TextKey, label);
        this._wireLabel(label);
        this._syncLabelHitTest();
    }

    // Wire the label's own gestures — a connector label has no owning Figure,
    // so it handles its own double-click-to-edit and slide-along-route drag —
    // plus the content/edit listeners that keep hit-testing + centring honest.
    private _wireLabel(label: ShapeText): void
    {
        label.AddPropertyChangedListener(ShapeText.ContentKey,   this._onLabelContentChanged);
        label.AddPropertyChangedListener(ShapeText.DocumentKey,  this._onLabelContentChanged);
        label.AddPropertyChangedListener(ShapeText.IsEditingKey, this._onLabelContentChanged);

        label.AddRoutedEventListener('PointerDown', ((args: PointerEventArgs) => {
            if (args.IsDoubleClick) { label.BeginEdit(); args.Handled = true; return; }
            if (label.IsEditing) return;                    // editor owns the pointer
            const pts = this._currentRoutePoints;
            if (pts === undefined || pts.length < 2) return;
            // Host → canvas offset from the label's known route point at press.
            const rp = pointAlongPolyline(pts, this.LabelPosition).point;
            this._labelOffsetX = rp.X - args.HostX;
            this._labelOffsetY = rp.Y - args.HostY;
            this._labelDragging = true;
            args.CapturePointer(label, 'grab');
            args.Handled = true;
        }) as (a: unknown) => void);

        label.AddRoutedEventListener('PointerMove', ((args: PointerEventArgs) => {
            if (!this._labelDragging) return;
            const pts = this._currentRoutePoints;
            if (pts === undefined || pts.length < 2) return;
            const cursor = new Point(args.HostX + this._labelOffsetX, args.HostY + this._labelOffsetY);
            this.LabelPosition = nearestTOnPolyline(pts, cursor);   // slides along the route
            args.Handled = true;
        }) as (a: unknown) => void);

        label.AddRoutedEventListener('PointerUp', ((args: PointerEventArgs) => {
            if (!this._labelDragging) return;
            this._labelDragging = false;
            args.ReleasePointerCapture();
            args.Handled = true;
        }) as (a: unknown) => void);
    }

    // Hit-test the label only when it carries content (or is being edited) —
    // an empty label must not swallow clicks on the route beneath it.
    private _syncLabelHitTest(): void
    {
        const label = this.Text;
        if (label !== undefined) label.IsHitTestVisible = !label.IsEmpty || label.IsEditing;
    }

    // Centre the label on its route point (arc-length t = LabelPosition).
    // Falls back to the anchor midpoint for a Bezier / degenerate route
    // (no polyline). Measures the label to size it before centring.
    private _placeLabel(): void
    {
        const label = this.Text;
        if (label === undefined) return;
        let cx: number, cy: number;
        const pts = this._currentRoutePoints;
        if (pts !== undefined && pts.length >= 2)
        {
            const rp = pointAlongPolyline(pts, this.LabelPosition);
            cx = rp.point.X; cy = rp.point.Y;
        }
        else
        {
            const s = this._currentSrcAnchor, t = this._currentTgtAnchor;
            if (s === undefined || t === undefined) return;
            cx = (s.x + t.x) / 2; cy = (s.y + t.y) / 2;
        }
        label.Measure(new Size(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY));
        const d = label.DesiredSize;
        Canvas.SetLeft(label, cx - d.Width / 2);
        Canvas.SetTop(label,  cy - d.Height / 2);
    }

    // The label's placed box in host coords, inflated by LabelGapMargin — the
    // region the route should break around. undefined when there is nothing to
    // break around: no label, an empty label that isn't being edited, or an
    // unmeasured (zero-size) label. Reads the position _placeLabel wrote, so
    // it must run after it.
    private _labelGapRect(): Rect | undefined
    {
        const label = this.Text;
        if (label === undefined) return undefined;
        if (label.IsEmpty && !label.IsEditing) return undefined;
        const w = label.DesiredSize.Width, h = label.DesiredSize.Height;
        if (!(w > 0) || !(h > 0)) return undefined;
        const m = Connector.LabelGapMargin;
        return new Rect(Canvas.GetLeft(label) - m, Canvas.GetTop(label) - m, w + 2 * m, h + 2 * m);
    }

    // Finalize Geometry from the drawn polyline, breaking the line around the
    // label (line-gap style). A no-op for Bezier routes (_drawnPolyline
    // undefined — the curve was already written). Called from the recompute
    // body and, without a re-route, whenever the label moves or its content
    // changes (drag / edit) so the gap tracks the label.
    private _applyLabelGap(): void
    {
        const poly = this._drawnPolyline;
        if (poly === undefined) return;
        this.Geometry = this._gappedGeometry(poly, this._labelGapRect()) as unknown as Geometry;
    }

    // The route Geometry built from the drawn polyline, broken into two open
    // figures around `gap` when a label sits on the line, or a single figure
    // when there is nothing to break around (no gap, or the rect misses the
    // route). Split out from _applyLabelGap so the assembly is unit-testable
    // without a mounted, measured label.
    private _gappedGeometry(poly: readonly Point[], gap: Rect | undefined): PathGeometry
    {
        if (gap === undefined) return polylineToPathGeometry(poly);
        const runs = splitPolylineAroundRect(poly, gap);
        return runs.length > 1 ? polylinesToPathGeometry(runs) : polylineToPathGeometry(runs[0] ?? poly);
    }

    // Double-clicking the route (not the label) captions a bare connector —
    // begins editing the midpoint label, matching Visio.
    protected override OnPointerDown(args: PointerEventArgs): void
    {
        if (args.IsDoubleClick && this.Text !== undefined)
        {
            this.Text.BeginEdit();
            args.Handled = true;
            return;
        }
        super.OnPointerDown(args);
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue:   unknown,
        newValue:   unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (descriptor === Connector.SourceKey.descriptor)
        {
            // Reregister BEFORE reattach. _reregisterSourceSide unregisters
            // via this._trackedSource (the OLD endpoint instance, set by
            // the prior _reattachSourceEndpoint); _reattachSourceEndpoint
            // then updates _trackedSource to the NEW instance. Swapping
            // the order would have _reregisterSourceSide call
            // _unregisterSideEndpoint with the NEW endpoint, which the
            // side list doesn't know about (no-op), leaving the OLD
            // endpoint stuck in the registry and starving the rebalance
            // fan-out — sibling connectors on the same side wouldn't
            // shift when this connector's endpoint is reassigned to
            // a FreePoint, breaking the dynamic-port rebalance promise.
            this._reregisterSourceSide();
            this._reattachSourceEndpoint();
            this._scheduleRecompute();
        }
        else if (descriptor === Connector.TargetKey.descriptor)
        {
            this._reregisterTargetSide();
            this._reattachTargetEndpoint();
            this._scheduleRecompute();
        }
        else if (descriptor === Connector.WaypointsKey.descriptor
              || descriptor === Connector.RoutingModeKey.descriptor
              || descriptor === Connector.AnchorClipKey.descriptor)
        {
            this._scheduleRecompute();
        }
        else if (descriptor === Connector.SourceCapTemplateKey.descriptor)
        {
            if (this.SourceCapTemplate !== undefined && this._sourceCapContext === undefined)
            {
                this._sourceCapContext = new ConnectorCapDataContext();
            }
            this._resyncCapContexts();
            this._sourceCapInstance = instantiateCap(this.SourceCapTemplate, this._sourceCapContext);
            this._scheduleRecompute();
        }
        else if (descriptor === Connector.TargetCapTemplateKey.descriptor)
        {
            if (this.TargetCapTemplate !== undefined && this._targetCapContext === undefined)
            {
                this._targetCapContext = new ConnectorCapDataContext();
            }
            this._resyncCapContexts();
            this._targetCapInstance = instantiateCap(this.TargetCapTemplate, this._targetCapContext);
            this._scheduleRecompute();
        }
        else if (descriptor === Connector.SourceCapScaleKey.descriptor
              || descriptor === Connector.TargetCapScaleKey.descriptor)
        {
            // Re-route so the cap's scale∘rotate transform and the scaled
            // CapInset are both reapplied.
            this._scheduleRecompute();
        }
        else if (descriptor === Connector.StrokeKey.descriptor)
        {
            // Stroke reference swap: re-point the pen.Brush listener and
            // push the new colour / Pen into both cap contexts so caps
            // recolour with the connector. (Shape's super handler already
            // re-subscribed Stroke for the connector's OWN repaint.)
            this._reattachCapStrokeBrushListener();
            this._resyncCapContexts();
        }
        else if (descriptor === Connector.LabelPositionKey.descriptor)
        {
            // Slide the label to its new arc-length fraction without a reroute,
            // and re-break the line at the label's new spot.
            this._placeLabel();
            this._applyLabelGap();
        }
    }

    // Push the current Stroke's Brush + Pen into whichever cap contexts
    // exist. Idempotent — safe to call on cap creation and on every
    // Stroke change. set_property_value short-circuits equal values, so
    // a no-op resync won't churn the caps' bindings.
    private _resyncCapContexts(): void
    {
        const pen   = this.Stroke;
        const brush = pen?.Brush;
        if (this._sourceCapContext !== undefined)
        {
            this._sourceCapContext.Pen   = pen;
            this._sourceCapContext.Brush = brush;
        }
        if (this._targetCapContext !== undefined)
        {
            this._targetCapContext.Pen   = pen;
            this._targetCapContext.Brush = brush;
        }
    }

    // (Re)subscribe to the current Stroke Pen's `Brush` property so a
    // PenEditor that swaps the brush reference onto the same Pen still
    // recolours filled caps (bound to $Brush). Detaches from the prior
    // Pen first; symmetric with the Shape-level Stroke subscription.
    private _reattachCapStrokeBrushListener(): void
    {
        const prev = this._trackedCapPen;
        if (prev !== undefined)
        {
            prev.RemovePropertyChangedListener(
                resolveKey(prev, undefined, 'Brush'), this._onCapStrokeBrushChanged);
        }
        const pen = this.Stroke;
        this._trackedCapPen = pen;
        if (pen !== undefined)
        {
            pen.AddPropertyChangedListener(
                resolveKey(pen, undefined, 'Brush'), this._onCapStrokeBrushChanged);
        }
    }

    // Per-property subscription bundle. Each Connector tracks ONE
    // source endpoint and ONE target endpoint at a time; the bundle
    // detaches en masse when the endpoint reference flips.
    private _reattachSourceEndpoint(): void
    {
        const prev = this._trackedSource;
        if (prev !== undefined)
        {
            prev.RemovePropertyChangedListener(ConnectorEndpoint.NodeKey,      this._onSourceEndpointInputChanged);
            prev.RemovePropertyChangedListener(ConnectorEndpoint.FreePointKey, this._onSourceEndpointInputChanged);
            prev.RemovePropertyChangedListener(ConnectorEndpoint.PortNameKey,  this._onSourceEndpointInputChanged);
            prev.RemovePropertyChangedListener(ConnectorEndpoint.PortSideKey,  this._onSourceEndpointInputChanged);
            prev.RemovePropertyChangedListener(ConnectorEndpoint.PortIndexKey, this._onSourceEndpointInputChanged);
        }
        this._trackedSource = this.Source;
        const cur = this._trackedSource;
        if (cur !== undefined)
        {
            cur.AddPropertyChangedListener(ConnectorEndpoint.NodeKey,      this._onSourceEndpointInputChanged);
            cur.AddPropertyChangedListener(ConnectorEndpoint.FreePointKey, this._onSourceEndpointInputChanged);
            cur.AddPropertyChangedListener(ConnectorEndpoint.PortNameKey,  this._onSourceEndpointInputChanged);
            cur.AddPropertyChangedListener(ConnectorEndpoint.PortSideKey,  this._onSourceEndpointInputChanged);
            cur.AddPropertyChangedListener(ConnectorEndpoint.PortIndexKey, this._onSourceEndpointInputChanged);
        }
        this._reattachSourceNodeListener();
    }

    private _reattachTargetEndpoint(): void
    {
        const prev = this._trackedTarget;
        if (prev !== undefined)
        {
            prev.RemovePropertyChangedListener(ConnectorEndpoint.NodeKey,      this._onTargetEndpointInputChanged);
            prev.RemovePropertyChangedListener(ConnectorEndpoint.FreePointKey, this._onTargetEndpointInputChanged);
            prev.RemovePropertyChangedListener(ConnectorEndpoint.PortNameKey,  this._onTargetEndpointInputChanged);
            prev.RemovePropertyChangedListener(ConnectorEndpoint.PortSideKey,  this._onTargetEndpointInputChanged);
            prev.RemovePropertyChangedListener(ConnectorEndpoint.PortIndexKey, this._onTargetEndpointInputChanged);
        }
        this._trackedTarget = this.Target;
        const cur = this._trackedTarget;
        if (cur !== undefined)
        {
            cur.AddPropertyChangedListener(ConnectorEndpoint.NodeKey,      this._onTargetEndpointInputChanged);
            cur.AddPropertyChangedListener(ConnectorEndpoint.FreePointKey, this._onTargetEndpointInputChanged);
            cur.AddPropertyChangedListener(ConnectorEndpoint.PortNameKey,  this._onTargetEndpointInputChanged);
            cur.AddPropertyChangedListener(ConnectorEndpoint.PortSideKey,  this._onTargetEndpointInputChanged);
            cur.AddPropertyChangedListener(ConnectorEndpoint.PortIndexKey, this._onTargetEndpointInputChanged);
        }
        this._reattachTargetNodeListener();
    }

    // Node-move reactivity per § 7.2 option (a): hardcoded
    // subscription on 'Left' / 'Top'. Skip silently for nodes without
    // those DPs — the duck-typed contract from
    // [docs/connectors.md](../../../docs/connectors.md) treats
    // non-Figure item Models as "supplies position somehow" but does
    // not require Left / Top by name.
    private _reattachSourceNodeListener(): void
    {
        const prev = this._trackedSourceNode;
        if (prev !== undefined && MuralBase.HasProperty(prev.constructor, 'Left'))
        {
            prev.RemovePropertyChangedListener(resolveKey(prev, undefined, 'Left'), this._onSourceNodeMoved);
            prev.RemovePropertyChangedListener(resolveKey(prev, undefined, 'Top'),  this._onSourceNodeMoved);
        }
        if (prev !== undefined
            && MuralBase.HasProperty(prev.constructor, 'Width')
            && MuralBase.HasProperty(prev.constructor, 'Height'))
        {
            prev.RemovePropertyChangedListener(resolveKey(prev, undefined, 'Width'),  this._onSourceNodeResized);
            prev.RemovePropertyChangedListener(resolveKey(prev, undefined, 'Height'), this._onSourceNodeResized);
        }
        const node = this.Source?.Node;
        this._trackedSourceNode = node;
        if (node !== undefined
            && MuralBase.HasProperty(node.constructor, 'Left')
            && MuralBase.HasProperty(node.constructor, 'Top'))
        {
            node.AddPropertyChangedListener(resolveKey(node, undefined, 'Left'), this._onSourceNodeMoved);
            node.AddPropertyChangedListener(resolveKey(node, undefined, 'Top'),  this._onSourceNodeMoved);
        }
        // Resize reactivity: reroute (preserving waypoints) when the figure's
        // Width / Height change. Duck-typed like Left / Top — nodes without the
        // DPs simply don't fire.
        if (node !== undefined
            && MuralBase.HasProperty(node.constructor, 'Width')
            && MuralBase.HasProperty(node.constructor, 'Height'))
        {
            node.AddPropertyChangedListener(resolveKey(node, undefined, 'Width'),  this._onSourceNodeResized);
            node.AddPropertyChangedListener(resolveKey(node, undefined, 'Height'), this._onSourceNodeResized);
        }
        this._refreshSourceAncestorListeners();
    }

    private _reattachTargetNodeListener(): void
    {
        const prev = this._trackedTargetNode;
        if (prev !== undefined && MuralBase.HasProperty(prev.constructor, 'Left'))
        {
            prev.RemovePropertyChangedListener(resolveKey(prev, undefined, 'Left'), this._onTargetNodeMoved);
            prev.RemovePropertyChangedListener(resolveKey(prev, undefined, 'Top'),  this._onTargetNodeMoved);
        }
        if (prev !== undefined
            && MuralBase.HasProperty(prev.constructor, 'Width')
            && MuralBase.HasProperty(prev.constructor, 'Height'))
        {
            prev.RemovePropertyChangedListener(resolveKey(prev, undefined, 'Width'),  this._onTargetNodeResized);
            prev.RemovePropertyChangedListener(resolveKey(prev, undefined, 'Height'), this._onTargetNodeResized);
        }
        const node = this.Target?.Node;
        this._trackedTargetNode = node;
        if (node !== undefined
            && MuralBase.HasProperty(node.constructor, 'Left')
            && MuralBase.HasProperty(node.constructor, 'Top'))
        {
            node.AddPropertyChangedListener(resolveKey(node, undefined, 'Left'), this._onTargetNodeMoved);
            node.AddPropertyChangedListener(resolveKey(node, undefined, 'Top'),  this._onTargetNodeMoved);
        }
        // Resize reactivity — see _reattachSourceNodeListener.
        if (node !== undefined
            && MuralBase.HasProperty(node.constructor, 'Width')
            && MuralBase.HasProperty(node.constructor, 'Height'))
        {
            node.AddPropertyChangedListener(resolveKey(node, undefined, 'Width'),  this._onTargetNodeResized);
            node.AddPropertyChangedListener(resolveKey(node, undefined, 'Height'), this._onTargetNodeResized);
        }
        this._refreshTargetAncestorListeners();
    }

    // Re-point the ancestor-container Left/Top subscriptions at the CURRENT chain
    // of an endpoint's node, so a nested endpoint re-routes when an ANCESTOR moves.
    // Detach the previously-tracked ancestors first (distinct objects from the
    // node, so calling this from the node-moved handler is re-entrancy-safe).
    private _refreshSourceAncestorListeners(): void
    {
        for (const anc of this._sourceAncestors)
            if (MuralBase.HasProperty(anc.constructor, 'Left'))
            {
                anc.RemovePropertyChangedListener(resolveKey(anc, undefined, 'Left'), this._onSourceAncestorMoved);
                anc.RemovePropertyChangedListener(resolveKey(anc, undefined, 'Top'),  this._onSourceAncestorMoved);
            }
        this._sourceAncestors = ancestorChain(this.Source?.Node);
        for (const anc of this._sourceAncestors)
            if (MuralBase.HasProperty(anc.constructor, 'Left'))
            {
                anc.AddPropertyChangedListener(resolveKey(anc, undefined, 'Left'), this._onSourceAncestorMoved);
                anc.AddPropertyChangedListener(resolveKey(anc, undefined, 'Top'),  this._onSourceAncestorMoved);
            }
    }

    private _refreshTargetAncestorListeners(): void
    {
        for (const anc of this._targetAncestors)
            if (MuralBase.HasProperty(anc.constructor, 'Left'))
            {
                anc.RemovePropertyChangedListener(resolveKey(anc, undefined, 'Left'), this._onTargetAncestorMoved);
                anc.RemovePropertyChangedListener(resolveKey(anc, undefined, 'Top'),  this._onTargetAncestorMoved);
            }
        this._targetAncestors = ancestorChain(this.Target?.Node);
        for (const anc of this._targetAncestors)
            if (MuralBase.HasProperty(anc.constructor, 'Left'))
            {
                anc.AddPropertyChangedListener(resolveKey(anc, undefined, 'Left'), this._onTargetAncestorMoved);
                anc.AddPropertyChangedListener(resolveKey(anc, undefined, 'Top'),  this._onTargetAncestorMoved);
            }
    }

    // Side-endpoint registration: the endpoint registers with its host
    // Figure's side list iff it's pinned to (Figure, ResolvedPortSide)
    // with no PortName / PortIndex / FreePoint set (path 3a's gate).
    // Any input change re-checks the gate and re-attaches.
    private _reregisterSourceSide(): void
    {
        if (this._trackedSourceFigure !== undefined && this._trackedSourceSide !== undefined && this._trackedSource !== undefined)
        {
            this._trackedSourceFigure._unregisterSideEndpoint(this._trackedSourceSide, this._trackedSource);
        }
        this._trackedSourceFigure = undefined;
        this._trackedSourceSide   = undefined;
        const ep = this.Source;
        if (ep === undefined) return;
        const slot = endpointSideSlot(ep);
        if (slot === undefined) return;
        const [figure, side] = slot;
        this._trackedSourceFigure = figure;
        this._trackedSourceSide   = side;
        figure._registerSideEndpoint(side, ep, this._onSourceSideRebalance, this);
    }

    private _reregisterTargetSide(): void
    {
        if (this._trackedTargetFigure !== undefined && this._trackedTargetSide !== undefined && this._trackedTarget !== undefined)
        {
            this._trackedTargetFigure._unregisterSideEndpoint(this._trackedTargetSide, this._trackedTarget);
        }
        this._trackedTargetFigure = undefined;
        this._trackedTargetSide   = undefined;
        const ep = this.Target;
        if (ep === undefined) return;
        const slot = endpointSideSlot(ep);
        if (slot === undefined) return;
        const [figure, side] = slot;
        this._trackedTargetFigure = figure;
        this._trackedTargetSide   = side;
        figure._registerSideEndpoint(side, ep, this._onTargetSideRebalance, this);
    }

    // Release every host subscription this connector holds — both
    // side-endpoint registrations, the endpoint-input listeners, the
    // node-move (Left / Top) listeners, and the cap-stroke listener —
    // WITHOUT clearing Source / Target, so the model stays intact for a
    // later undo / re-add. Dropping the side registrations fires each
    // host's rebalance, so the connectors that SHARE a side re-space to
    // the new (smaller) slot count — the dynamic-port redistribution the
    // diagram's removal paths (DiagramDocument.DeleteConnectors + the
    // figure-delete cascade) rely on. Idempotent: every branch is guarded
    // by its tracked reference and clears it, so a second call is a no-op.
    //
    // Named DetachFromHosts (not Detach) to stay clear of Element.Detach,
    // which is the visual-tree child-removal primitive.
    public DetachFromHosts(): void
    {
        if (this._trackedSourceFigure !== undefined && this._trackedSourceSide !== undefined && this._trackedSource !== undefined)
        {
            this._trackedSourceFigure._unregisterSideEndpoint(this._trackedSourceSide, this._trackedSource);
        }
        this._trackedSourceFigure = undefined;
        this._trackedSourceSide   = undefined;
        if (this._trackedTargetFigure !== undefined && this._trackedTargetSide !== undefined && this._trackedTarget !== undefined)
        {
            this._trackedTargetFigure._unregisterSideEndpoint(this._trackedTargetSide, this._trackedTarget);
        }
        this._trackedTargetFigure = undefined;
        this._trackedTargetSide   = undefined;

        const src = this._trackedSource;
        if (src !== undefined)
        {
            src.RemovePropertyChangedListener(ConnectorEndpoint.NodeKey,      this._onSourceEndpointInputChanged);
            src.RemovePropertyChangedListener(ConnectorEndpoint.FreePointKey, this._onSourceEndpointInputChanged);
            src.RemovePropertyChangedListener(ConnectorEndpoint.PortNameKey,  this._onSourceEndpointInputChanged);
            src.RemovePropertyChangedListener(ConnectorEndpoint.PortSideKey,  this._onSourceEndpointInputChanged);
            src.RemovePropertyChangedListener(ConnectorEndpoint.PortIndexKey, this._onSourceEndpointInputChanged);
        }
        this._trackedSource = undefined;
        const tgt = this._trackedTarget;
        if (tgt !== undefined)
        {
            tgt.RemovePropertyChangedListener(ConnectorEndpoint.NodeKey,      this._onTargetEndpointInputChanged);
            tgt.RemovePropertyChangedListener(ConnectorEndpoint.FreePointKey, this._onTargetEndpointInputChanged);
            tgt.RemovePropertyChangedListener(ConnectorEndpoint.PortNameKey,  this._onTargetEndpointInputChanged);
            tgt.RemovePropertyChangedListener(ConnectorEndpoint.PortSideKey,  this._onTargetEndpointInputChanged);
            tgt.RemovePropertyChangedListener(ConnectorEndpoint.PortIndexKey, this._onTargetEndpointInputChanged);
        }
        this._trackedTarget = undefined;

        const sn = this._trackedSourceNode;
        if (sn !== undefined && MuralBase.HasProperty(sn.constructor, 'Left'))
        {
            sn.RemovePropertyChangedListener(resolveKey(sn, undefined, 'Left'), this._onSourceNodeMoved);
            sn.RemovePropertyChangedListener(resolveKey(sn, undefined, 'Top'),  this._onSourceNodeMoved);
        }
        this._trackedSourceNode = undefined;
        const tn = this._trackedTargetNode;
        if (tn !== undefined && MuralBase.HasProperty(tn.constructor, 'Left'))
        {
            tn.RemovePropertyChangedListener(resolveKey(tn, undefined, 'Left'), this._onTargetNodeMoved);
            tn.RemovePropertyChangedListener(resolveKey(tn, undefined, 'Top'),  this._onTargetNodeMoved);
        }
        this._trackedTargetNode = undefined;

        for (const anc of this._sourceAncestors)
            if (MuralBase.HasProperty(anc.constructor, 'Left'))
            {
                anc.RemovePropertyChangedListener(resolveKey(anc, undefined, 'Left'), this._onSourceAncestorMoved);
                anc.RemovePropertyChangedListener(resolveKey(anc, undefined, 'Top'),  this._onSourceAncestorMoved);
            }
        this._sourceAncestors = [];
        for (const anc of this._targetAncestors)
            if (MuralBase.HasProperty(anc.constructor, 'Left'))
            {
                anc.RemovePropertyChangedListener(resolveKey(anc, undefined, 'Left'), this._onTargetAncestorMoved);
                anc.RemovePropertyChangedListener(resolveKey(anc, undefined, 'Top'),  this._onTargetAncestorMoved);
            }
        this._targetAncestors = [];

        const pen = this._trackedCapPen;
        if (pen !== undefined)
        {
            pen.RemovePropertyChangedListener(resolveKey(pen, undefined, 'Brush'), this._onCapStrokeBrushChanged);
        }
        this._trackedCapPen = undefined;
    }

    // ── Port-slot reorder (position-based, driven by a segment drag) ──
    // Dragging the route segment that LEAVES a side-anchored port slides
    // this connector among its siblings on that port. The port-adjacent
    // segment runs perpendicular to the port's slot axis, so the
    // perpendicular drag maps straight onto a slot position; the figure
    // rebalances and the siblings redistribute. These four methods expose
    // the (otherwise private) per-end host registration to the edit
    // adorner that owns the gesture.

    /** True when `end` is currently anchored to a figure side slot — the
     *  dynamic-port case the segment-drag reorder acts on. */
    public IsPortAnchored(end: ConnectorEnd): boolean
    {
        return end === ConnectorEnd.Source
            ? this._trackedSourceFigure !== undefined && this._trackedSourceSide !== undefined && this._trackedSource !== undefined
            : this._trackedTargetFigure !== undefined && this._trackedTargetSide !== undefined && this._trackedTarget !== undefined;
    }

    /** Current slot index of `end` on its host side, or undefined when the
     *  end isn't side-anchored. */
    public GetPortSlotIndex(end: ConnectorEnd): number | undefined
    {
        if (end === ConnectorEnd.Source)
        {
            if (this._trackedSourceFigure === undefined || this._trackedSourceSide === undefined || this._trackedSource === undefined) return undefined;
            return this._trackedSourceFigure.GetSideSlot(this._trackedSource, this._trackedSourceSide)?.index;
        }
        if (this._trackedTargetFigure === undefined || this._trackedTargetSide === undefined || this._trackedTarget === undefined) return undefined;
        return this._trackedTargetFigure.GetSideSlot(this._trackedTarget, this._trackedTargetSide)?.index;
    }

    /** Reorder `end`'s slot among its port siblings to the one nearest
     *  `cursor` (diagram-host coords). No-op when `end` isn't
     *  side-anchored or the host doesn't support positional reorder
     *  (e.g. VM shapes not yet wired to a drag gesture). */
    public ReorderPortSlot(end: ConnectorEnd, cursor: Point): void
    {
        if (end === ConnectorEnd.Source)
        {
            if (this._trackedSourceFigure !== undefined && this._trackedSourceSide !== undefined && this._trackedSource !== undefined)
            {
                const f = this._trackedSourceFigure as unknown as { ReorderSideEndpoint?: (s: ResolvedPortSide, e: ConnectorEndpoint, c: Point) => void };
                f.ReorderSideEndpoint?.(this._trackedSourceSide, this._trackedSource, cursor);
            }
            return;
        }
        if (this._trackedTargetFigure !== undefined && this._trackedTargetSide !== undefined && this._trackedTarget !== undefined)
        {
            const f = this._trackedTargetFigure as unknown as { ReorderSideEndpoint?: (s: ResolvedPortSide, e: ConnectorEndpoint, c: Point) => void };
            f.ReorderSideEndpoint?.(this._trackedTargetSide, this._trackedTarget, cursor);
        }
    }

    /** Move `end`'s slot to an explicit index — used by the gesture's
     *  abort path to restore the pre-drag order. No-op when `end` isn't
     *  side-anchored or the host doesn't support index-based reorder. */
    public MovePortSlotToIndex(end: ConnectorEnd, index: number): void
    {
        if (end === ConnectorEnd.Source)
        {
            if (this._trackedSourceFigure !== undefined && this._trackedSourceSide !== undefined && this._trackedSource !== undefined)
            {
                const f = this._trackedSourceFigure as unknown as { MoveSideEndpoint?: (s: ResolvedPortSide, e: ConnectorEndpoint, i: number) => void };
                f.MoveSideEndpoint?.(this._trackedSourceSide, this._trackedSource, index);
            }
            return;
        }
        if (this._trackedTargetFigure !== undefined && this._trackedTargetSide !== undefined && this._trackedTarget !== undefined)
        {
            const f = this._trackedTargetFigure as unknown as { MoveSideEndpoint?: (s: ResolvedPortSide, e: ConnectorEndpoint, i: number) => void };
            f.MoveSideEndpoint?.(this._trackedTargetSide, this._trackedTarget, index);
        }
    }

    // Force a route recompute. Public seam for a host that changed a global
    // routing input the connector doesn't observe per-instance — e.g. the
    // Diagram re-routing every connector when a routing setting (orthogonal
    // stub, lane gap, bezier offset) is edited. Idempotent and cheap; routes
    // synchronously like any input-driven recompute.
    public RecomputeRoute(): void
    {
        this._scheduleRecompute();
    }

    // Synchronous recompute — § 7.4 ("throttle?") is a separate
    // open question. V1 ships sync; rAF-coalescing lands when the
    // first interactive demo flags a measurable cost.
    private _scheduleRecompute(): void
    {
        // Re-entry guard. Bake (below) writes ep.PortSide, which fires
        // OnPropertyChanged → _on*EndpointInputChanged → _scheduleRecompute
        // recursively. If we let that nested call run, it would route
        // with the freshly-baked side (correct) and assign Geometry,
        // then the OUTER call would continue, route with its stale
        // pre-bake anchors, and clobber the correct Geometry. The guard
        // suppresses the nested re-entry; the outer call re-resolves
        // locally after bake to pick up the new sides. _reregister*Side
        // / _reattach*NodeListener still run from the listener — they're
        // not gated, only the Geometry recompute is.
        if (this._recomputing) return;
        this._recomputing = true;
        try
        {
            this._scheduleRecomputeBody();
        }
        finally
        {
            this._recomputing = false;
        }
        // Optimize AFTER the guard is released so the optimizer can re-route
        // this connector too (it swaps slots and re-measures crossings on live
        // geometry). Re-entry is bounded: the rebalance re-enters
        // _scheduleRecompute, but the registry's `_optimizing` flag makes the
        // nested _optimizeAnchoredSides a no-op.
        this._optimizeAnchoredSides();
    }

    private _scheduleRecomputeBody(): void
    {
        const src = this.Source;
        const tgt = this.Target;
        // Leave the connector un-drawn (NOT snapped to the origin) when an
        // endpoint has no anchor to route to:
        //   * UnresolvedNodeId — points at a node absent at load time (its
        //     serializer hadn't registered); a later load re-binds it.
        //   * node-less AND free-less — an orphaned/invalid endpoint (e.g. a
        //     target whose node was removed, or a drop that left no anchor).
        //     Path 1 would resolve it to (0,0); rendering that draws a stray
        //     line to the diagram corner. Hiding it is the runtime invariant:
        //     an endpoint MUST reference a node or a free point to be drawn.
        // Endpoint state is preserved, so nothing is lost while it's hidden.
        if (src === undefined || tgt === undefined
            || src.UnresolvedNodeId !== undefined || tgt.UnresolvedNodeId !== undefined
            || (src.Node === undefined && src.FreePoint === undefined)
            || (tgt.Node === undefined && tgt.FreePoint === undefined))
        {
            this.Geometry = undefined;
            this._currentSrcAnchor = undefined;
            this._currentTgtAnchor = undefined;
            this._currentRoutePoints = undefined;
            return;
        }
        // A FreePoint is meaningful ONLY when Node is undefined (resolution
        // path 1). Once an endpoint has a Node, its FreePoint is vestigial —
        // paths 2-5 read the node's ports/geometry and ignore it. Worse, a
        // lingering FreePoint makes endpointSideSlot bail, so the endpoint
        // drops to a geometric-clip CENTER instead of joining the side-slot
        // fan (connectors then stack on the same center point). Clear it here
        // so the fan engages and the stale value isn't re-serialized. The
        // write re-enters _scheduleRecompute but the _recomputing guard makes
        // that a no-op; this pass continues with the cleaned endpoint.
        if (src.Node !== undefined && src.FreePoint !== undefined) src.FreePoint = undefined;
        if (tgt.Node !== undefined && tgt.FreePoint !== undefined) tgt.FreePoint = undefined;
        // Raw bare points drive anchor direction (waypoint-aware side picking);
        // the router is fed the MINIMISED projection (pins kept, collinear auto
        // dropped) so a moved node re-routes to the fewest bends through the pins.
        const rawPoints = routePoints(this.Waypoints);

        let srcAnchor: ResolvedAnchor;
        let tgtAnchor: ResolvedAnchor;
        ({ srcAnchor, tgtAnchor } = this._resolveAnchors(src, tgt, rawPoints));

        // Auto-bake PortSide for legacy bare-{Node} endpoints (no port
        // refs, no FreePoint, no PortSide). The resolved anchor's `side`
        // becomes the endpoint's pinned side; subsequent resolves go
        // through path 3a and join the side-slot distribution. When
        // either bake fires, re-resolve in-line — the first-pass anchor
        // came from path 4 / 5 (closest port or bbox-centroid geometric
        // clip) and would otherwise stick as an off-center end on a
        // connector the demo wired up as `new ConnectorEndpoint({ Node })`
        // without an explicit PortSide.
        const srcBaked = bakeSideIfBare(src, srcAnchor.side);
        const tgtBaked = bakeSideIfBare(tgt, tgtAnchor.side);
        if (srcBaked || tgtBaked)
        {
            ({ srcAnchor, tgtAnchor } = this._resolveAnchors(src, tgt, rawPoints));
        }
        this._currentSrcAnchor = srcAnchor;
        this._currentTgtAnchor = tgtAnchor;

        const router = RouterRegistry.resolve(this.RoutingMode);
        const sourceRect = nodeRect(src.Node) ?? Rect.Zero;
        const targetRect = nodeRect(tgt.Node) ?? Rect.Zero;
        const waypoints = routePoints(minimiseRoute(
            this.Waypoints ?? [],
            new Point(srcAnchor.x, srcAnchor.y),
            new Point(tgtAnchor.x, tgtAnchor.y),
        ));
        const spec: RouteSpec = {
            sourceRect,
            sourceAnchor: srcAnchor,
            targetRect,
            targetAnchor: tgtAnchor,
            waypoints,
        };
        const routeGeom = router.compute(spec);

        // Snapshot the rendered route as a polyline for the edit adorner's
        // mid-segment handles (undefined for Bezier — not a polyline).
        // Uncapped: the corners stay on the port outward rays so the
        // adorner's materialize-into-Waypoints round-trips cleanly.
        this._currentRoutePoints = pathGeometryToPolyline(routeGeom);

        // Cap insets — only applied to line-polyline routes (Straight +
        // Orthogonal). Bezier output stays untouched; caps overlap the
        // cubic endpoint. § 3.6 + cap-inset.ts documented gap.
        // CapInset scales with the cap so the painted line stops at the
        // resized cap's back edge rather than the authored-size edge.
        const sourceInset = this._sourceCapInstance !== undefined
            ? Connector.GetCapInset(this._sourceCapInstance) * this.SourceCapScale : 0;
        const targetInset = this._targetCapInstance !== undefined
            ? Connector.GetCapInset(this._targetCapInstance) * this.TargetCapScale : 0;

        // The drawn polyline = the route (already snapshotted above) with the
        // cap insets trimmed off each tip. Bezier routes have no polyline —
        // draw the curve verbatim and skip both inset trimming and the label
        // gap. _applyLabelGap (below) finalizes Geometry from _drawnPolyline.
        const basePolyline = this._currentRoutePoints;
        if (basePolyline === undefined)
        {
            this._drawnPolyline = undefined;
            this.Geometry = routeGeom as unknown as Geometry;
        }
        else
        {
            this._drawnPolyline = (sourceInset > 0 || targetInset > 0)
                ? shortenPolyline(basePolyline, sourceInset, targetInset)
                : basePolyline;
        }

        // Cap visual placement: Canvas.Left / Top to the anchor position
        // in diagram-host coords; RenderTransform = RotateTransform with
        // the per-end tangent. Cap orientation contract from
        // [routing/router.ts] tangentAt: source = first-segment direction,
        // target = last-segment-into-target direction.
        placeCap(this._sourceCapInstance, srcAnchor, router.tangentAt(spec, ConnectorEnd.Source), ConnectorEnd.Source, this.SourceCapScale);
        placeCap(this._targetCapInstance, tgtAnchor, router.tangentAt(spec, ConnectorEnd.Target), ConnectorEnd.Target, this.TargetCapScale);

        // Re-place the label on the freshly-computed route (§ Slice 5), break
        // the drawn line around it (line-gap style), and refresh its
        // {Length}/{SourceId}/… fields (§ Slice 6).
        this._placeLabel();
        this._applyLabelGap();
        this._refreshLabelFields();
        // NOTE: side-intersection optimization is NOT run here. It must run
        // only AFTER this connector's `_recomputing` guard is released (see
        // _scheduleRecompute) — otherwise the optimizer's re-route of THIS
        // connector is suppressed by the guard, so it would measure crossings
        // against this connector's stale (pre-swap) geometry and settle on a
        // wrong order. Deferring past the guard lets every connector on the
        // side, including this one, re-route at its trial slot.
    }

    // Ask each side this connector anchors to whether a slot reorder between
    // its registered connectors would reduce crossings. Runs OUTSIDE the
    // `_recomputing` guard (called from _scheduleRecompute after the body) so
    // the optimizer's tentative re-routes take effect for every connector on
    // the side — including this one. _optimizeSideIntersections is part of the
    // ISideEndpointHost contract (the container Figure host implements it), so
    // these are plain typed calls: a host missing it is a compile error, NOT a
    // silently-swallowed no-op.
    // The registry's own `_optimizing` flag short-circuits the re-entrant
    // optimize calls the rebalance triggers.
    private _optimizeAnchoredSides(): void
    {
        if (this._trackedSourceFigure !== undefined && this._trackedSourceSide !== undefined)
        {
            this._trackedSourceFigure._optimizeSideIntersections(this._trackedSourceSide);
        }
        if (this._trackedTargetFigure !== undefined && this._trackedTargetSide !== undefined)
        {
            this._trackedTargetFigure._optimizeSideIntersections(this._trackedTargetSide);
        }
    }

    // Resolve every {field} in the label against this connector's live route.
    private _refreshLabelFields(): void
    {
        const doc = this.Text?.Document;
        if (doc !== undefined) resolveFields(doc, (k) => this._resolveField(k));
    }

    private _resolveField(key: FieldKind): string | undefined
    {
        switch (key)
        {
            case FieldKind.Length:   return String(Math.round(polylineLength(this._currentRoutePoints ?? [])));
            case FieldKind.SourceId: return connectorEndpointId(this.Source);
            case FieldKind.TargetId: return connectorEndpointId(this.Target);
            default:                 return undefined;
        }
    }

    // Two-pass anchor resolve. The pass with the Node-pinned endpoint
    // runs FIRST so the FreePoint endpoint's deriveFreeSide sees a real
    // side from the other end (per § 10.2 + § 10.3's perpendicular-
    // respecting derivation). When both endpoints are free or both are
    // Node, default to source-first. Pulled out as a helper so the
    // recompute can call it twice — once for the initial route, again
    // after bake to pick up the freshly-pinned PortSide.
    private _resolveAnchors(
        src: ConnectorEndpoint,
        tgt: ConnectorEndpoint,
        waypoints: readonly Point[],
    ): { srcAnchor: ResolvedAnchor; tgtAnchor: ResolvedAnchor }
    {
        const srcIsFree = src.Node === undefined;
        const tgtIsFree = tgt.Node === undefined;
        let srcAnchor: ResolvedAnchor;
        let tgtAnchor: ResolvedAnchor;
        if (srcIsFree && !tgtIsFree)
        {
            const srcApprox = endpointApproxAnchor(src);
            tgtAnchor = resolveEndpoint(tgt, srcApprox, waypoints, false, this.AnchorClip, false);
            srcAnchor = resolveEndpoint(src, tgtAnchor, waypoints, true,  this.AnchorClip, true);
        }
        else
        {
            const tgtApprox = endpointApproxAnchor(tgt);
            srcAnchor = resolveEndpoint(src, tgtApprox, waypoints, true,  this.AnchorClip, false);
            tgtAnchor = resolveEndpoint(tgt, srcAnchor, waypoints, false, this.AnchorClip, !srcIsFree);
        }
        return { srcAnchor, tgtAnchor };
    }
}

function instantiateCap(
    template: DataTemplate | undefined,
    context:  ConnectorCapDataContext | undefined,
): Visual | undefined
{
    if (template === undefined) return undefined;
    // The cap's paint binds against this context ($Brush / $Pen) so it
    // tracks the owning connector's Stroke. DataTemplate.Apply doesn't
    // set DataContext (the factory's DataContextBindings read the
    // inherited value), so we set it on the materialized root here. Caps
    // with no bindings simply ignore it. § 3.6 of
    // [docs/connectors.md](../../../docs/connectors.md).
    const root = template.Apply(undefined);
    if (context !== undefined) root.DataContext = context;
    return root;
}

function placeCap(cap: Visual | undefined, anchor: ResolvedAnchor, tangentRadians: number, end: ConnectorEnd, scale: number): void
{
    if (cap === undefined) return;
    Canvas.SetLeft(cap, anchor.x);
    Canvas.SetTop(cap, anchor.y);
    // RotateTransform.Angle is in DEGREES (per
    // [drawing/transform.ts:137](../../visual-engine/drawing/transform.ts#L137)
    // — the matrix builder converts to radians internally). Reuse the
    // existing transform when present so a re-route doesn't churn
    // a fresh allocation per tick.
    //
    // tangentAt returns the source→target TRAVEL direction at both ends
    // ([routing/router.ts] § tangentAt). Caps are authored once, hot-point
    // at local origin with the body trailing into −X (i.e. pointing along
    // +X = travel). At the target that already points the cap INTO the
    // node — correct. At the source the raw travel tangent would point the
    // cap toward the target (into the line); a source cap conventionally
    // points outward, back at its own node. So flip the source by 180° —
    // one shared template then reads correctly at both ends.
    const flip    = end === ConnectorEnd.Source ? 180 : 0;
    const degrees = (tangentRadians * 180) / Math.PI + flip;
    // Cap-local geometry has its hot-point at the origin (0,0), so both the
    // scale and the rotation pivot there — order is immaterial. The render
    // transform is a TransformGroup [Scale, Rotate]; reuse it across
    // re-routes so a route tick doesn't churn a fresh allocation.
    const existing = cap.RenderTransform;
    if (existing instanceof TransformGroup
        && existing.Children.Count === 2
        && existing.Children.Get(0) instanceof ScaleTransform
        && existing.Children.Get(1) instanceof RotateTransform)
    {
        const s = existing.Children.Get(0) as ScaleTransform;
        const r = existing.Children.Get(1) as RotateTransform;
        s.ScaleX = scale;
        s.ScaleY = scale;
        r.Angle  = degrees;
    }
    else
    {
        const s = new ScaleTransform();
        s.ScaleX = scale;
        s.ScaleY = scale;
        const group = new TransformGroup();
        group.Children.Add(s);
        group.Children.Add(new RotateTransform(degrees));
        cap.RenderTransform = group;
    }
}

// A connector endpoint's node id for the {SourceId}/{TargetId} fields —
// empty when the end is free-floating or the node carries no id.
// Handles both Figure (legacy/items-are-Figures path) and NodeViewModel
// (M3+: endpoint.Node is the VM so routing/delete/serialize track the data item).
function connectorEndpointId(ep: ConnectorEndpoint | undefined): string
{
    const n = ep?.Node;
    if (n instanceof Figure)        return n.Id ?? '';
    if (n instanceof NodeViewModel) return n.Id ?? '';
    return '';
}

// ── Endpoint resolution (§ 3.2 paths 1–5) ────────────────────────────

function resolveEndpoint(
    ep:          ConnectorEndpoint,
    otherAnchor: ResolvedAnchor,
    waypoints:   readonly Point[],
    isSource:    boolean,
    anchorClip:  AnchorClip,
    otherIsReal: boolean,
): ResolvedAnchor
{
    // Path 1 — free-floating.
    if (ep.Node === undefined)
    {
        const fp = ep.FreePoint ?? Point.Zero;
        return {
            x:    fp.X,
            y:    fp.Y,
            side: deriveFreeSide({ x: fp.X, y: fp.Y }, otherAnchor, waypoints, isSource, otherIsReal),
        };
    }

    const host  = nodeAsPortHost(ep.Node);
    const ports = nodePorts(ep.Node);

    // Path 2 — named lookup.
    if (ep.PortName !== undefined && ports.length > 0)
    {
        const named = ports.find(p => p.Name === ep.PortName);
        if (named !== undefined) return PortResolver.resolve(named, host);
    }

    // Path 3 — positional lookup (PortSide, PortIndex) against the
    // static provider's port list. Used by consumers that addressed a
    // specific provider-emitted port via its index in a side bucket.
    if (ep.PortSide !== undefined && ep.PortIndex !== undefined && ports.length > 0)
    {
        const positional = lookupPositional(ports, host, ep.PortSide, ep.PortIndex);
        if (positional !== undefined) return PortResolver.resolve(positional, host);
        // Out-of-range → fall through to path 4.
    }

    // Path 3a — side-slot dynamic distribution. When endpoint is pinned
    // to (Figure, PortSide) with no static-port reference (no PortName,
    // no PortIndex, no FreePoint), the figure's side-endpoint registry
    // assigns a slot index; the position is (slot+1)/(count+1) along
    // the side. This is the path side-bar gestures land on; existing
    // connectors registered with the figure participate in distribution.
    const sideSlotAnchor = tryResolveSideSlot(ep, otherAnchor);
    if (sideSlotAnchor !== undefined) return sideSlotAnchor;

    // Path 4 — auto-pick closest port to the OTHER endpoint.
    if (ports.length > 0)
    {
        const closest = pickClosestPort(ports, host, otherAnchor);
        return PortResolver.resolve(closest, host);
    }

    // Path 5 — geometric clip.
    return geometricClip(host.ArrangedRect, otherAnchor, anchorClip);
}

// Path 3a gate. Returns a resolved anchor when the endpoint qualifies
// for side-slot resolution: Node is a Figure registered in the
// side-endpoint registry, PortSide is set, and no PortName / PortIndex /
// FreePoint competes. Otherwise undefined — the caller falls through to
// path 4. The slot info (index + count) comes from Figure.GetSideSlot,
// which Connector keeps in sync via _reregister*Side.
//
// Distribution rule — DYNAMIC slot positions sized to the live connector
// count on the side. Each side hosts exactly `count` slots, distributed
// at t = (i + 1) / (count + 1). The formula yields:
//   * odd count  — one slot lands exactly at t = 0.5 (centered).
//   * even count — slots straddle the center symmetrically (no slot at
//                  t = 0.5).
// Cross-connector reactivity is wired through Figure._fireSideRebalance:
// adding or removing a connector on a side fires every existing
// endpoint's rebalance callback (Connector._on*SideRebalance →
// _scheduleRecompute), so the rest of the connectors on the side shift
// to their new t and the orthogonal router re-runs (including the
// perpendicular-beam intersection optimization) with the updated anchors.
//
// Static Port instances declared on the figure (via ExplicitPorts or a
// PortProvider) deliberately DO NOT capture this path — they're for the
// named / positional addressing in Path 2 / 3. Side-only resolution is
// purely dynamic so the centered / symmetric guarantee holds regardless
// of what the designer happened to bake into Ports.
function tryResolveSideSlot(
    ep: ConnectorEndpoint,
    otherAnchor: ResolvedAnchor,
): ResolvedAnchor | undefined
{
    const slot = endpointSideSlot(ep);
    if (slot === undefined) return undefined;
    const [host, side] = slot;
    const info = host.GetSideSlot(ep, side);
    if (info === undefined) return undefined;
    // Use nodeRect so hosts without a live Arrange pass (early ctor /
    // tests) still pick up positions from Left / Top / Width / Height.
    // Figure.ArrangedRect defaults to Rect.Zero, which would collapse
    // every slot onto the origin and silently break unit-test fixtures.
    const r = nodeRect(host as unknown as MuralBase);
    // A zero-size host (e.g. an arch node whose SizeToContent measure hasn't
    // written Width/Height yet) would collapse every slot onto the origin;
    // bail so the caller falls through to the standard anchor paths instead.
    if (r === undefined || r.Width === 0 || r.Height === 0) return undefined;
    const t = (info.index + 1) / (info.count + 1);
    const x = side === PortSide.E ? r.X + r.Width
            : side === PortSide.W ? r.X
            : r.X + t * r.Width;
    const y = side === PortSide.S ? r.Y + r.Height
            : side === PortSide.N ? r.Y
            : r.Y + t * r.Height;
    return { x, y, side, laneOffset: laneOffsetFor(side, info.index, info.count, x, y, otherAnchor) };
}

// Orthogonal lane offset for a side-anchored slot. Connectors sharing a
// side fan their perpendicular stubs out by offset × gap so parallel runs
// don't stack — but the ORDER of the fan must nest with the routes or the
// inner connectors' verticals get crossed by the outer ones' approaches.
//
// The nesting direction depends on which way the route leaves toward the
// other endpoint. For an E/W side the runs are vertical, so the deciding
// axis is Y: when the other end sits BELOW the slot the lanes must DECREASE
// with slot index (top slot → outermost lane); when it sits above, they
// INCREASE. N/S sides are the same argument with the X axis. A single slot
// (count 1) always stays on the base lane (offset 0).
function laneOffsetFor(
    side: ResolvedPortSide,
    index: number,
    count: number,
    slotX: number,
    slotY: number,
    otherAnchor: ResolvedAnchor,
): number
{
    if (count <= 1) return 0;
    const horizontalSide = side === PortSide.E || side === PortSide.W;
    const otherIsPast = horizontalSide
        ? otherAnchor.y > slotY     // other endpoint below this slot
        : otherAnchor.x > slotX;    // other endpoint right of this slot
    return otherIsPast ? (count - 1 - index) : index;
}

// Duck-typed cast: returns the node as ISideEndpointHost when it exposes
// the GetSideSlot method (i.e. it is a Figure — the container Figure is the sole
// side-endpoint host). Kept duck-typed so the side-slot path stays decoupled
// from the concrete host class.
function asSideSlotHost(node: unknown): ISideEndpointHost | undefined
{
    return node !== undefined && typeof (node as { GetSideSlot?: unknown }).GetSideSlot === 'function'
        ? (node as ISideEndpointHost) : undefined;
}

// Endpoint qualifies for the side-anchored registry when its Node
// implements ISideEndpointHost (a Figure), its PortSide is a
// cardinal (not Auto), and no competing port reference (PortName /
// PortIndex) or FreePoint is set. Same gate used by Connector's
// `_reregister*Side` registration and by path 3a.
function endpointSideSlot(ep: ConnectorEndpoint): [ISideEndpointHost, ResolvedPortSide] | undefined
{
    const host = asSideSlotHost(ep.Node);
    if (host === undefined) return undefined;
    if (ep.PortName  !== undefined) return undefined;
    if (ep.PortIndex !== undefined) return undefined;
    if (ep.FreePoint !== undefined) return undefined;
    const side = ep.PortSide;
    if (side === undefined || side === PortSide.Auto) return undefined;
    return [host, side];
}

// Bake PortSide into a legacy bare-{Node} endpoint so it joins the
// side-slot distribution on the next resolve. The check mirrors
// endpointSideSlot's gate minus the PortSide test — we only bake if no
// side is set yet, otherwise the assignment would no-op and risk
// triggering an unnecessary OnPropertyChanged loop (set_property_value
// short-circuits on equal values, but the equality check happens after
// any user-installed converters; cheaper to skip altogether).
//
// Returns true iff the gate matched and PortSide was actually written.
// The caller uses this to decide whether to re-resolve anchors inside
// the same _scheduleRecompute call (the side just baked turns the
// endpoint from "bare → path 4/5 off-center" into "side-anchored →
// path 3a side-center"; without a re-resolve the outer call would route
// against stale anchors).
function bakeSideIfBare(ep: ConnectorEndpoint, side: ResolvedPortSide): boolean
{
    if (asSideSlotHost(ep.Node) === undefined) return false;
    if (ep.PortName  !== undefined) return false;
    if (ep.PortIndex !== undefined) return false;
    if (ep.FreePoint !== undefined) return false;
    if (ep.PortSide  !== undefined && ep.PortSide !== PortSide.Auto) return false;
    ep.PortSide = side;
    return true;
}

function deriveFreeSide(
    myPos:       { x: number; y: number },
    other:       ResolvedAnchor,
    waypoints:   readonly Point[],
    isSource:    boolean,
    otherIsReal: boolean,
): ResolvedPortSide
{
    // Waypoint-aware: read direction from the adjacent waypoint when
    // one exists. The first / last segments around the waypoint dominate
    // the visible side semantics; the OTHER endpoint's resolved side
    // doesn't matter for derivation in this branch.
    if (waypoints.length > 0)
    {
        const wp = isSource ? waypoints[0]! : waypoints[waypoints.length - 1]!;
        const dx = isSource ? wp.X - myPos.x : myPos.x - wp.X;
        const dy = isSource ? wp.Y - myPos.y : myPos.y - wp.Y;
        return dominantSide(dx, dy);
    }

    // Real-other path: the other endpoint has a pinned side
    // (Node-resolved). Pick our side to produce the minimum-corner
    // perpendicular-preserving route per § 10.2 + § 10.3.
    if (otherIsReal)
    {
        return pickFreeSideForRoute(other.side, { x: other.x, y: other.y }, myPos);
    }

    // Both endpoints free (Case C): no real side anywhere. Fall back to
    // the geometric "toward the other end" derivation. Mostly used for
    // hand-authored free-floating Orthogonal connectors; gives a
    // reasonable side without needing a third reference point.
    const dx = isSource ? other.x - myPos.x : myPos.x - other.x;
    const dy = isSource ? other.y - myPos.y : myPos.y - other.y;
    return dominantSide(dx, dy);
}

function dominantSide(dx: number, dy: number): ResolvedPortSide
{
    if (dx === 0 && dy === 0) return PortSide.E;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? PortSide.E : PortSide.W;
    return dy >= 0 ? PortSide.S : PortSide.N;
}

// Pick the free endpoint's side relative to the pinned other endpoint
// such that an orthogonal route honoring both perpendicularity
// invariants (§ 10.2) has the minimum corner count. The derived side
// determines what the router treats as the free end's outward direction:
//
//   * Free in the pinned end's outward half-plane — L-shape (1 corner)
//     or straight line (0 corners) works. Pick the cardinal that puts
//     the L's last leg perpendicular to the pinned side.
//   * Free at or behind the pinned outward direction — needs a U-shape
//     (2 corners). Pick the SAME side as the pinned end so the route
//     overshoots and comes back in matching direction.
function pickFreeSideForRoute(
    pinnedSide: ResolvedPortSide,
    pinnedPos:  { x: number; y: number },
    freePos:    { x: number; y: number },
): ResolvedPortSide
{
    const dx = freePos.x - pinnedPos.x;
    const dy = freePos.y - pinnedPos.y;
    if (pinnedSide === PortSide.E || pinnedSide === PortSide.W)
    {
        const outward = pinnedSide === PortSide.E ? 1 : -1;
        if (dx * outward > 0)
        {
            if (dy === 0) return pinnedSide === PortSide.E ? PortSide.W : PortSide.E;
            return dy > 0 ? PortSide.N : PortSide.S;
        }
        return pinnedSide;
    }
    const outward = pinnedSide === PortSide.S ? 1 : -1;
    if (dy * outward > 0)
    {
        if (dx === 0) return pinnedSide === PortSide.N ? PortSide.S : PortSide.N;
        return dx > 0 ? PortSide.W : PortSide.E;
    }
    return pinnedSide;
}

// Bucket ports by their RESOLVED side, sort each bucket by primary
// axis (X for N/S, Y for E/W), look up bucket[side][index]. Returns
// undefined when the requested index is out of range — the caller
// falls through to path 4.
function lookupPositional(
    ports: readonly Port[],
    host:  IPortHost,
    side:  PortSide,
    index: number,
): Port | undefined
{
    if (side === PortSide.Auto) return undefined;
    const sideCardinal = side as ResolvedPortSide;
    const bucket: { port: Port; primary: number }[] = [];
    for (const p of ports)
    {
        const a = PortResolver.resolve(p, host);
        if (a.side !== sideCardinal) continue;
        const primary = (sideCardinal === PortSide.N || sideCardinal === PortSide.S) ? a.x : a.y;
        bucket.push({ port: p, primary });
    }
    if (index < 0 || index >= bucket.length) return undefined;
    bucket.sort((a, b) => a.primary - b.primary);
    return bucket[index]!.port;
}

// Closest port to `other` by Euclidean distance (line-of-sight from
// the OTHER endpoint per § 3.2). Tie-break by smaller (Side, Index)
// lex order — implemented as smaller resolved-position-string compare
// so ties between equidistant ports give a deterministic winner
// independent of provider emit order.
function pickClosestPort(
    ports: readonly Port[],
    host:  IPortHost,
    other: ResolvedAnchor,
): Port
{
    let best: { port: Port; dist: number; sideRank: number; idx: number } | undefined;
    for (let i = 0; i < ports.length; i++)
    {
        const p = ports[i]!;
        const a = PortResolver.resolve(p, host);
        const dx = a.x - other.x;
        const dy = a.y - other.y;
        const d  = dx * dx + dy * dy;
        const sideRank = SIDE_RANK[a.side];
        if (best === undefined
            || d < best.dist
            || (d === best.dist && (sideRank < best.sideRank || (sideRank === best.sideRank && i < best.idx))))
        {
            best = { port: p, dist: d, sideRank, idx: i };
        }
    }
    return best!.port;
}

const SIDE_RANK: { readonly [k in ResolvedPortSide]: number } = {
    [PortSide.N]: 0,
    [PortSide.E]: 1,
    [PortSide.S]: 2,
    [PortSide.W]: 3,
};

// Path 5 — clip a line from rect centroid toward `other` against
// rect's bbox. Bbox-mode only in v1; Geometry-clip throws per § 3.5.
function geometricClip(
    rect:       Rect,
    other:      ResolvedAnchor,
    anchorClip: AnchorClip,
): ResolvedAnchor
{
    if (anchorClip === AnchorClip.Geometry)
    {
        throw new Error(
            'Connector: AnchorClip.Geometry mode not implemented in v1; '
            + 'use AnchorClip.Bbox or attach a PortProvider to the host.',
        );
    }
    const cx = rect.X + rect.Width  / 2;
    const cy = rect.Y + rect.Height / 2;
    const dx = other.x - cx;
    const dy = other.y - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy, side: PortSide.E };

    let best: { t: number; side: ResolvedPortSide } | undefined;
    const consider = (t: number, side: ResolvedPortSide): void => {
        if (t < 0) return;
        if (best === undefined || t < best.t) best = { t, side };
    };
    if (dx > 0) consider((rect.Right  - cx) / dx, PortSide.E);
    if (dx < 0) consider((rect.Left   - cx) / dx, PortSide.W);
    if (dy > 0) consider((rect.Bottom - cy) / dy, PortSide.S);
    if (dy < 0) consider((rect.Top    - cy) / dy, PortSide.N);
    if (best === undefined) return { x: cx, y: cy, side: PortSide.E };
    return { x: cx + best.t * dx, y: cy + best.t * dy, side: best.side };
}

// ── Node duck-typing helpers ─────────────────────────────────────────

// Node IS a MuralBase; we read its bbox + ports through narrow duck-typed
// interfaces so non-Figure item Models still work as endpoint targets.
// See § 3.5 / § 7.2 of
// [docs/connectors.md](../../../docs/connectors.md).

// The container-ancestor chain of a (possibly nested) endpoint node, outermost
// last. Duck-typed on ContainerParent (a plain Figure field, not a DP) — same
// contract nodeRect reads. Empty for a root node.
interface ContainerParentLike { ContainerParent?: ContainerParentLike | undefined; }
function ancestorChain(node: unknown): MuralBase[]
{
    const out: MuralBase[] = [];
    let c = (node as ContainerParentLike | undefined)?.ContainerParent;
    while (c !== undefined) { out.push(c as unknown as MuralBase); c = c.ContainerParent; }
    return out;
}

function nodeRect(node: MuralBase | undefined): Rect | undefined
{
    if (node === undefined) return undefined;
    // Prefer Left / Top / Width / Height (always fresh on the next DP
    // tick) over ArrangedRect, which only updates on the next Arrange
    // pass. Without this order, alignment commands and other batch
    // Left / Top mutations recompute the route using the *previous*
    // ArrangedRect — connectors would render at the figure's old
    // position until something else triggers a re-arrange.
    const obj = node as unknown as { Left?: number; Top?: number; Width?: number; Height?: number; ContainerParent?: unknown };
    if (typeof obj.Left === 'number' && typeof obj.Top === 'number'
        && typeof obj.Width === 'number' && !Number.isNaN(obj.Width)
        && typeof obj.Height === 'number' && !Number.isNaN(obj.Height))
    {
        // A nested node's Left/Top are container-local; resolve to absolute
        // diagram-host space (the space connectors route in) by walking its
        // container-ancestor chain. Root nodes take the raw rect.
        if (obj.ContainerParent !== undefined)
        {
            return diagramSpaceRect(node as unknown as SpatialNode);
        }
        return new Rect(obj.Left, obj.Top, obj.Width, obj.Height);
    }
    // Non-Figure item Models without Left / Top fall back to
    // ArrangedRect (computed by their presenter).
    const ar = (node as unknown as { ArrangedRect?: Rect }).ArrangedRect;
    if (ar !== undefined && ar.Width > 0 && ar.Height > 0) return ar;
    if (typeof obj.Left === 'number' && typeof obj.Top === 'number')
    {
        const w = (typeof obj.Width  === 'number' && !Number.isNaN(obj.Width))  ? obj.Width  : 0;
        const h = (typeof obj.Height === 'number' && !Number.isNaN(obj.Height)) ? obj.Height : 0;
        return new Rect(obj.Left, obj.Top, w, h);
    }
    return undefined;
}

/** @internal test-only — the endpoint rect the router reads (diagram-space aware). */
export function __nodeRectForTesting(node: MuralBase | undefined): Rect | undefined { return nodeRect(node); }

function nodeAsPortHost(node: MuralBase): IPortHost
{
    return {
        ArrangedRect: nodeRect(node) ?? Rect.Zero,
        Geometry:     (node as unknown as { Geometry?: Geometry }).Geometry,
    };
}

function nodePorts(node: MuralBase): readonly Port[]
{
    return (node as unknown as { Ports?: readonly Port[] }).Ports ?? [];
}

// Approx position used as "other" placeholder when source resolves
// before target. Centroid for Node-bearing endpoints, FreePoint
// otherwise.
function endpointApproxAnchor(ep: ConnectorEndpoint): ResolvedAnchor
{
    if (ep.Node !== undefined)
    {
        const r = nodeRect(ep.Node);
        if (r !== undefined)
        {
            return { x: r.X + r.Width / 2, y: r.Y + r.Height / 2, side: PortSide.W };
        }
    }
    const fp = ep.FreePoint;
    if (fp !== undefined) return { x: fp.X, y: fp.Y, side: PortSide.W };
    return { x: 0, y: 0, side: PortSide.W };
}
