import {
    Color,
    CornerRadius,
    Matrix,
    Panel,
    Point,
    Rect,
    Size,
    Visual,
    type DrawingContext,
    type PointerEventArgs,
    type ObservableCollection,
    type CollectionChange,
    type MuralBase,
    type Disposable,
    hasModifier,
    ModifierKeys,
} from '../../../runtime/index.js';
import {
    Adorner,
    AdornerLayer,
    LineCap,
    LineJoin,
    Pen,
    SolidColorBrush,
} from '../../../visual-engine/index.js';
import { MatrixTransform } from '../../../visual-engine/drawing/transform.js';
import { Border, Shape } from '../../../basic/index.js';
import { SelectionMode } from '../../list/list-box.js';
import { Connector } from '../connector.js';
import { ShapeText } from '../shape-text.js';
import { routePoints } from '../route-waypoint.js';
import { ConnectorCreateBehavior } from './connector-create-behavior.js';
import { ConnectorEditAdorner, segmentIsHorizontal } from './connector-edit-adorner.js';
import { Figure } from '../figure.js';
import { PortSide, type ResolvedPortSide } from '../port.js';
import { ConnectorEnd } from '../routing/router.js';
import type { Diagram } from '../diagram.js';
import { DiagramSettings } from '../diagram-settings.js';

// Demo-grade interactive layer that turns the connector primitives into
// a working drag-create + edit experience. Mounts two adorners in the
// Diagram's ItemsPanel AdornerLayer and brokers pointer events between
// them and the underlying state machines (ConnectorCreateBehavior +
// ConnectorEditAdorner). Owned by Diagram and gated by the
// ConnectorInteractionsEnabled DP — same opt-in pattern as
// AlignmentGuidesEnabled and SelectionResizeEnabled.
//
// Three concerns inside this one behavior so they can share state
// (gesture machine + coord translation + hit-test helpers):
//
//   1. PortHandlesAdorner — while the cursor hovers a Figure, paint a
//      dot at each of its Ports. Hit-testable; PointerDown on a dot
//      starts a create gesture against (Figure, Port).
//   2. EditHandlesAdorner — for every connector in
//      Diagram.SelectedConnectors, paint endpoint + waypoint dots.
//      PointerDown on a dot starts the matching ConnectorEditAdorner
//      gesture (endpoint re-anchor or waypoint move).
//   3. Pointer wiring — single Diagram-level PointerDown / Move / Up
//      bundle. PointerDown classifies the target (port handle vs edit
//      handle vs connector body vs empty) and starts the matching
//      gesture; Move drives the active gesture or, when idle, updates
//      hover; Up commits / aborts / clears selection.

// ── Visual constants ─────────────────────────────────────────────
// Interactive-chrome sizes read live from settings (defaults 3 / 11 / 9 / 9 /
// 7) so an edit re-sizes the handles the next time an adorner rebuilds. Small
// functions so each call resolves the current value.
const sideBarThickness = (): number => DiagramSettings.SideBarThickness();
// Inset each end of a side bar by this fraction of the side length, so
// the bar visually occupies 90% of the side, centered.
const SIDE_BAR_INSET_RATIO = 0.05;
const epHandleSize     = (): number => DiagramSettings.EndpointHandleSize();
const wpHandleSize     = (): number => DiagramSettings.WaypointHandleSize();
// Mid-segment drag handle — square pad centered on a waypoint-to-waypoint
// segment. Slightly smaller than a waypoint dot so it reads as secondary
// to the corner waypoints it sits between.
const segHandleSize    = (): number => DiagramSettings.SegmentHandleSize();
// Port marker — small circle drawn at each dynamic-slot position on a
// hovered figure's side. Pure visual indicator (not hit-testable); the
// side bar behind it owns the click. Sized small enough to read as
// "this is where this connector attaches" without crowding the side.
const portMarkerSize = (): number => DiagramSettings.PortMarkerSize();
// 4 sides per hovered figure (N, S, E, W) — pool sized to one figure
// at a time; on hover transitions the pool re-binds to the new figure.
const POOL_SIDES = 4;
const POOL_EPS   = 8;
const POOL_WPS   = 16;
// Mid-segment handles: at most (waypoints − 1) per connector. Sized to
// match the waypoint pool so a densely-waypointed selection never runs
// short of segment pads before it runs short of waypoint dots.
const POOL_SEGS  = 16;
// Per-side port-marker capacity. Each side rarely has more than a few
// connectors in practice; cap at 8 so the pool stays small while still
// supporting busy hubs (4 sides × 8 = 32 markers worst case).
const POOL_PORTS_PER_SIDE = 8;
const POOL_PORTS = POOL_SIDES * POOL_PORTS_PER_SIDE;
const HIDE_OFFSCREEN = -10000;

// Project a CONTENT-space point into an adorner's OWN local frame via the
// adorned->layer matrix the AdornerLayer hands each adorner every arrange pass
// (see adorner.ts). Under the diagram's LayoutTransform camera the AdornerLayer
// sits OUTSIDE PART_Camera, so chrome positioned from content coordinates —
// side bars, endpoint/waypoint/segment handles, port markers — must map through
// this to hug the zoomed figures/connectors instead of drifting to raw canvas
// coords. Identity (zoom 1, no pan baked in) passes the point through unchanged.
// Same mechanism SelectionBoundsAdorner._mapBounds uses. Handle SIZES are left
// untouched so the chrome stays a constant on-screen size — only positions map.
function projectToLayer(m: Matrix, x: number, y: number): Point
{
    return m.IsIdentity ? new Point(x, y) : m.Transform(new Point(x, y));
}

// Proximity buffer for figure hover + drop-target detection. Cursor
// within this many DIPs of a figure's bbox edge counts as "near" the
// figure: side bars / port handles show, and a release lands a connector
// on it. Hover-show and drop-pick share the same threshold so visual
// feedback and commit semantics stay in lockstep — what lights up is what
// gets connected. Tight (8 DIPs) so the side adorners only react when the
// cursor is genuinely close to an edge, not from across the gap.
const figureProximity = (): number => DiagramSettings.FigureProximity();

// Chrome fills come from DiagramSettings (resolved live at construction so a
// settings override re-tints them). Endpoint dots read distinct from the shared
// "connector handle" orange (waypoint dots + port markers + side bars), and the
// segment pad uses its own blue so "grab to slide the segment" reads differently
// from the orange "move this one point" waypoint dots.
const sideFill   = (): SolidColorBrush => DiagramSettings.ConnectorHandleColor();
const epFill     = (): SolidColorBrush => DiagramSettings.ConnectorEndpointColor();
const wpFill     = (): SolidColorBrush => DiagramSettings.ConnectorHandleColor();
const segFill    = (): SolidColorBrush => DiagramSettings.ConnectorSegmentColor();
const portFill   = (): SolidColorBrush => DiagramSettings.ConnectorHandleColor();

// Hover halo: contrasting accent that mirrors the connector's geometry
// when the cursor hovers an UNSELECTED connector. Hit-testable; clicking
// it picks the connector and seeds the diagram's shared stroke editor.
// Color is the theme @Primary token — the same selection-affordance accent
// the bbox / group outline / snap guides use — resolved LIVE from the theme
// at paint time (adapts light/dark). Falls back to the Material seed when no
// theme is reachable (tests, embeds).
const HOVER_HALO_FALLBACK  = Color.FromHex('#6750A4');
// Minimum effective halo stroke thickness (default 5 DIPs), read live from
// settings. Per-connector thickness can grow past this — the halo always sits
// at least this wide so the hit surface is reliable even on hair-thin
// connectors. The halo brush's opacity is likewise refreshed from settings at
// paint time (see the hover-halo pen build).
const hoverHaloMinThick = (): number => DiagramSettings.HoverHaloMinThickness();

// Custom Visio-style "connect" cursor: a black crosshair (white-haloed
// for contrast on any background) with a small connector-line glyph in
// the bottom-right quadrant. Beats the OS `crosshair` keyword, which
// renders as the system theme's cursor and lands white-on-white on
// most light backgrounds.
//
// Data-URL encoding goes through encodeURIComponent so the SVG body
// reaches every browser's url() parser intact (Safari historically
// required this; modern Chrome / Firefox accept raw, but encoding
// costs nothing). Hotspot at (10, 10) — the center of the crosshair.
const CONNECTOR_CURSOR_SVG =
    "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>"
    + "<line x1='10' y1='3' x2='10' y2='17' stroke='white' stroke-width='3' stroke-linecap='round'/>"
    + "<line x1='3' y1='10' x2='17' y2='10' stroke='white' stroke-width='3' stroke-linecap='round'/>"
    + "<line x1='10' y1='3' x2='10' y2='17' stroke='black' stroke-width='1.5' stroke-linecap='round'/>"
    + "<line x1='3' y1='10' x2='17' y2='10' stroke='black' stroke-width='1.5' stroke-linecap='round'/>"
    + "<circle cx='10' cy='10' r='1.6' fill='black'/>"
    + "<path d='M 14 14 L 21 14 L 21 21' stroke='white' stroke-width='2.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/>"
    + "<path d='M 14 14 L 21 14 L 21 21' stroke='black' stroke-width='1.2' fill='none' stroke-linecap='round' stroke-linejoin='round'/>"
    + "<circle cx='21' cy='21' r='1.6' fill='black'/>"
    + "</svg>";
const CONNECTOR_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(CONNECTOR_CURSOR_SVG)}") 10 10, crosshair`;

const SIDE_CURSOR     = CONNECTOR_CURSOR;
const ENDPOINT_CURSOR = CONNECTOR_CURSOR;
const WAYPOINT_CURSOR = 'move';
// A segment moves perpendicular to itself, so the cursor advertises the
// one axis it can travel: a horizontal segment slides up/down (ns-resize),
// a vertical one slides left/right (ew-resize).
const SEG_CURSOR_H    = 'ns-resize';
const SEG_CURSOR_V    = 'ew-resize';

// ── Handle tagging via WeakMap ───────────────────────────────────
// Each handle visual gets a tag describing (kind + payload) so the
// PointerDown classifier can read what was clicked. WeakMap-keyed so
// detaching the adorner garbage-collects entries without manual cleanup.

enum ConnectorGesture
{
    Create = 'create',
    Edit   = 'edit',
}

enum ConnectorEditKind
{
    Endpoint = 'endpoint',
    Waypoint = 'waypoint',
    Segment  = 'segment',
}

type HandleTag =
    | { readonly kind: 'side';     readonly figure: Figure; readonly side: ResolvedPortSide }
    | { readonly kind: 'endpoint'; readonly connector: Connector; readonly end: ConnectorEnd }
    | { readonly kind: 'waypoint'; readonly connector: Connector; readonly index: number }
    // Mid-segment drag handle for the segment between Waypoints[index]
    // and Waypoints[index+1].
    | { readonly kind: 'segment';  readonly connector: Connector; readonly index: number };

const HANDLE_TAGS: WeakMap<Visual, HandleTag> = new WeakMap();

// ── Shared hover state, kept in a closure ───────────────────────
interface SharedState
{
    hoveredFigure:    Figure    | undefined;
    // The single side of the hovered figure nearest the cursor — the
    // only side bar the SideBarsAdorner shows. Recomputed on pointer
    // move (pickSideOfFigure) so the highlighted edge follows the
    // cursor around the figure. Undefined when no figure is hovered.
    hoverSide:        ResolvedPortSide | undefined;
    hoveredConnector: Connector | undefined;
    activeGesture:    ConnectorGesture | undefined;
    activePointerId:  number   | undefined;
    editKind:         ConnectorEditKind | undefined;
}

// ── SideBarsAdorner ──────────────────────────────────────────────
// 4 orange 3-DIP-thick lines hugging the N / S / E / W edges of the
// currently-hovered figure. Each bar is hit-testable; PointerDown on a
// bar starts a create gesture against (figure, side). When the user
// drags onto a target figure mid-gesture, the target's bars light up
// the same way, giving the user a clear release target. Bars are pooled
// at one set per adorner — only the currently-hovered figure has visible
// bars; transitions to a different figure re-bind the pool.
// Exported for the adorner-zoom regression test only — NOT part of the
// package's public surface (no barrel re-exports this module).
export class SideBarsAdorner extends Adorner
{
    private readonly _state: SharedState;
    private readonly _pool:      Border[] = [];
    private readonly _portPool:  Border[] = [];
    private static readonly _SIDES: readonly ResolvedPortSide[] =
        [PortSide.N, PortSide.S, PortSide.E, PortSide.W];

    constructor(adornedElement: Visual, state: SharedState, onHandleDown: HandleDownCallback)
    {
        super(adornedElement);
        this._state = state;
        // Pad transparent so we don't intercept figure clicks; the
        // individual side-bar Borders keep their own explicit hit pads.
        // See [svg-renderer.ts:488-491](../../../../visual-engine/drawing/svg-renderer.ts#L488-L491).
        this.IsHitTestVisible = false;
        for (let i = 0; i < POOL_SIDES; i++)
        {
            const v = makeBar(sideFill(), SIDE_CURSOR);
            wireHandle(v, onHandleDown);
            this.AttachVisual(v);
            this._pool.push(v);
        }
        // Port-marker dots — one per dynamic slot per side. Non-hit-
        // testable so clicks pass through to the side bar behind them
        // (the bar starts the create gesture; the dot is purely a "this
        // is where slot i sits" visualization).
        for (let i = 0; i < POOL_PORTS; i++)
        {
            const v = makePortMarker();
            this.AttachVisual(v);
            this._portPool.push(v);
        }
    }

    public override get visualChildren(): Visual[]
    {
        return [...this._pool, ...this._portPool];
    }

    public override MeasureOverride(_avail: Size): Size
    {
        const big = new Size(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
        for (const v of this._pool)     v.Measure(big);
        for (const v of this._portPool) v.Measure(big);
        return Size.Zero;
    }

    public override ArrangeOverride(finalSize: Size): Size
    {
        const fig = this._state.hoveredFigure;
        // Only the side nearest the cursor is shown (see SharedState.hoverSide).
        const activeSide = this._state.hoverSide;
        if (fig === undefined || activeSide === undefined)
        {
            this._hideAll();
            return finalSize;
        }
        // Read Left / Top / Width / Height directly off the Figure
        // rather than its ArrangedRect — the DPs update synchronously on
        // any move / resize, while ArrangedRect only refreshes on the
        // next arrange pass. Without this, dragging or aligning a
        // figure repositions its body before the side bars catch up.
        const left   = fig.Left;
        const top    = fig.Top;
        const width  = fig.Width;
        const height = fig.Height;
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
        {
            this._hideAll();
            return finalSize;
        }
        const t      = sideBarThickness();
        const half   = t / 2;
        // Content -> layer projection (camera zoom) the AdornerLayer handed us.
        const m      = this.AdornedToLayerMatrix;
        // Bars span 90% of the side, centered — 5% inset on each end
        // keeps them visually distinct from the corners and clarifies
        // which side the cursor is over near a vertex.
        const inX    = width  * SIDE_BAR_INSET_RATIO;
        const inY    = height * SIDE_BAR_INSET_RATIO;
        // Show the bar for the active side only; park the other three
        // offscreen and drop their handle tags so a stray hit can't start
        // a gesture against a hidden side.
        for (let i = 0; i < SideBarsAdorner._SIDES.length; i++)
        {
            const side = SideBarsAdorner._SIDES[i]!;
            const v = this._pool[i]!;
            if (side !== activeSide)
            {
                HANDLE_TAGS.delete(v);
                v.Arrange(new Rect(HIDE_OFFSCREEN, HIDE_OFFSCREEN, 0, 0));
                continue;
            }
            HANDLE_TAGS.set(v, { kind: 'side', figure: fig, side });
            // Project the bar's two long-axis endpoints through the camera so
            // it hugs the ZOOMED figure edge; keep thickness `t` constant so the
            // bar stays a constant on-screen chrome size. The camera never
            // rotates, so a horizontal (N/S) bar stays horizontal and a vertical
            // (E/W) bar stays vertical after projection.
            switch (side)
            {
                case PortSide.N:
                {
                    const a = projectToLayer(m, left + inX,          top);
                    const b = projectToLayer(m, left + width - inX,  top);
                    v.Arrange(new Rect(a.X, a.Y - half, b.X - a.X, t)); break;
                }
                case PortSide.S:
                {
                    const a = projectToLayer(m, left + inX,          top + height);
                    const b = projectToLayer(m, left + width - inX,  top + height);
                    v.Arrange(new Rect(a.X, a.Y - half, b.X - a.X, t)); break;
                }
                case PortSide.E:
                {
                    const a = projectToLayer(m, left + width, top + inY);
                    const b = projectToLayer(m, left + width, top + height - inY);
                    v.Arrange(new Rect(a.X - half, a.Y, t, b.Y - a.Y)); break;
                }
                case PortSide.W:
                {
                    const a = projectToLayer(m, left, top + inY);
                    const b = projectToLayer(m, left, top + height - inY);
                    v.Arrange(new Rect(a.X - half, a.Y, t, b.Y - a.Y)); break;
                }
            }
        }

        // Port markers — one dot per dynamic-slot position, for the
        // ACTIVE side only (the other sides aren't shown). Slot i
        // (zero-based) of N total sits at t = (i + 1) / (N + 1) along the
        // side — the same formula Path 3a uses in
        // [connector.ts](../connector.ts), kept in lockstep so the
        // markers always match where connectors actually land.
        const mk = portMarkerSize();
        const mkHalf = mk / 2;
        let portIdx = 0;
        const count = Math.min(fig.GetSideEndpointCount(activeSide), POOL_PORTS_PER_SIDE);
        for (let i = 0; i < count && portIdx < this._portPool.length; i++)
        {
            const u = (i + 1) / (count + 1);
            let cx: number, cy: number;
            switch (activeSide)
            {
                case PortSide.N: cx = left + u * width;          cy = top;                  break;
                case PortSide.S: cx = left + u * width;          cy = top + height;         break;
                case PortSide.E: cx = left + width;              cy = top + u * height;     break;
                case PortSide.W: cx = left;                      cy = top + u * height;     break;
            }
            // Project the slot centre through the camera; marker size stays
            // constant (constant on-screen chrome).
            const p = projectToLayer(m, cx, cy);
            this._portPool[portIdx]!.Arrange(new Rect(p.X - mkHalf, p.Y - mkHalf, mk, mk));
            portIdx++;
        }
        for (let i = portIdx; i < this._portPool.length; i++)
        {
            this._portPool[i]!.Arrange(new Rect(HIDE_OFFSCREEN, HIDE_OFFSCREEN, 0, 0));
        }
        return finalSize;
    }

    private _hideAll(): void
    {
        for (const v of this._pool)
        {
            HANDLE_TAGS.delete(v);
            v.Arrange(new Rect(HIDE_OFFSCREEN, HIDE_OFFSCREEN, 0, 0));
        }
        for (const v of this._portPool)
        {
            v.Arrange(new Rect(HIDE_OFFSCREEN, HIDE_OFFSCREEN, 0, 0));
        }
    }
}

// ── EditHandlesAdorner ───────────────────────────────────────────
// Exported for the adorner-zoom regression test only — NOT part of the
// package's public surface (no barrel re-exports this module).
export class EditHandlesAdorner extends Adorner
{
    private readonly _diagram: Diagram;
    private readonly _state:   SharedState;
    private readonly _epPool:  Border[] = [];
    private readonly _wpPool:  Border[] = [];
    private readonly _segPool: Border[] = [];

    constructor(adornedElement: Visual, diagram: Diagram, state: SharedState, onHandleDown: HandleDownCallback)
    {
        super(adornedElement);
        this._diagram = diagram;
        this._state   = state;
        // Adorner pad transparent — same rationale as PortHandlesAdorner.
        // Handle Borders below keep their own explicit hit pads.
        this.IsHitTestVisible = false;
        for (let i = 0; i < POOL_EPS; i++)
        {
            const v = makeDot(epHandleSize(), epFill(), ENDPOINT_CURSOR);
            wireHandle(v, onHandleDown);
            this.AttachVisual(v);
            this._epPool.push(v);
        }
        for (let i = 0; i < POOL_WPS; i++)
        {
            const v = makeDot(wpHandleSize(), wpFill(), WAYPOINT_CURSOR);
            wireHandle(v, onHandleDown);
            this.AttachVisual(v);
            this._wpPool.push(v);
        }
        // Square (no CornerRadius) so the segment pads read as bars, not
        // points. The per-handle cursor is assigned at arrange time from
        // the segment orientation, so the ctor seeds a neutral one.
        for (let i = 0; i < POOL_SEGS; i++)
        {
            const v = makeBar(segFill(), SEG_CURSOR_H);
            v.Width  = segHandleSize();
            v.Height = segHandleSize();
            wireHandle(v, onHandleDown);
            this.AttachVisual(v);
            this._segPool.push(v);
        }
    }

    public override get visualChildren(): Visual[]
    {
        return [...this._epPool, ...this._wpPool, ...this._segPool];
    }

    public override MeasureOverride(_avail: Size): Size
    {
        const big = new Size(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
        for (const v of this._epPool)  v.Measure(big);
        for (const v of this._wpPool)  v.Measure(big);
        for (const v of this._segPool) v.Measure(big);
        return Size.Zero;
    }

    public override ArrangeOverride(finalSize: Size): Size
    {
        const selected = this._diagram.SelectedConnectors;
        const live = this._diagram.Connectors;
        // Content -> layer projection (camera zoom) the AdornerLayer handed us.
        // Anchor / waypoint / segment centres are in content space; project them
        // so the dots track the zoomed connectors. Dot SIZES stay constant.
        const m = this.AdornedToLayerMatrix;
        let epUsed = 0, wpUsed = 0, segUsed = 0;
        for (const conn of selected)
        {
            if (!collectionContains(live, conn)) continue;
            const src = conn.CurrentSourceAnchor;
            const tgt = conn.CurrentTargetAnchor;
            if (src === undefined || tgt === undefined) continue;

            if (epUsed < this._epPool.length)
            {
                const v = this._epPool[epUsed++]!;
                HANDLE_TAGS.set(v, { kind: 'endpoint', connector: conn, end: ConnectorEnd.Source });
                const c = projectToLayer(m, src.x, src.y);
                v.Arrange(new Rect(
                    c.X - epHandleSize() / 2,
                    c.Y - epHandleSize() / 2,
                    epHandleSize(), epHandleSize()));
            }
            if (epUsed < this._epPool.length)
            {
                const v = this._epPool[epUsed++]!;
                HANDLE_TAGS.set(v, { kind: 'endpoint', connector: conn, end: ConnectorEnd.Target });
                const c = projectToLayer(m, tgt.x, tgt.y);
                v.Arrange(new Rect(
                    c.X - epHandleSize() / 2,
                    c.Y - epHandleSize() / 2,
                    epHandleSize(), epHandleSize()));
            }
            const wps = routePoints(conn.Waypoints);
            for (let i = 0; i < wps.length && wpUsed < this._wpPool.length; i++)
            {
                const v = this._wpPool[wpUsed++]!;
                HANDLE_TAGS.set(v, { kind: 'waypoint', connector: conn, index: i });
                const p = wps[i]!;
                const c = projectToLayer(m, p.X, p.Y);
                v.Arrange(new Rect(
                    c.X - wpHandleSize() / 2,
                    c.Y - wpHandleSize() / 2,
                    wpHandleSize(), wpHandleSize()));
            }

            segUsed = this._placeSegmentPads(conn, segUsed, m);
        }

        // Mid-segment pads ALSO show for the hovered (not-selected)
        // connector, alongside its halo — so a segment can be grabbed
        // straight from hover without selecting first. (Endpoint /
        // waypoint dots stay selection-only.) Skip if the hovered
        // connector is already in the selected loop above.
        const hovered = this._state.hoveredConnector;
        if (hovered !== undefined
            && collectionContains(live, hovered)
            && !this._diagram.IsConnectorSelected(hovered)
            && hovered.CurrentSourceAnchor !== undefined
            && hovered.CurrentTargetAnchor !== undefined)
        {
            segUsed = this._placeSegmentPads(hovered, segUsed, m);
        }

        for (let i = epUsed; i < this._epPool.length; i++)
        {
            const v = this._epPool[i]!;
            HANDLE_TAGS.delete(v);
            v.Arrange(new Rect(HIDE_OFFSCREEN, HIDE_OFFSCREEN, 0, 0));
        }
        for (let i = wpUsed; i < this._wpPool.length; i++)
        {
            const v = this._wpPool[i]!;
            HANDLE_TAGS.delete(v);
            v.Arrange(new Rect(HIDE_OFFSCREEN, HIDE_OFFSCREEN, 0, 0));
        }
        for (let i = segUsed; i < this._segPool.length; i++)
        {
            const v = this._segPool[i]!;
            HANDLE_TAGS.delete(v);
            v.Arrange(new Rect(HIDE_OFFSCREEN, HIDE_OFFSCREEN, 0, 0));
        }
        return finalSize;
    }

    // Place a mid-segment pad at the midpoint of every INTERIOR segment of
    // the connector's RENDERED route (source → bends → target). The two
    // port-adjacent segments (first + last) are skipped: a port is NOT a
    // waypoint, so one end of those segments is pinned and they can't slide
    // as a rigid bar — only segments whose BOTH endpoints are real route
    // bends get a pad. (A bare L route — source → corner → target — is all
    // port-adjacent, so it gets no pad; a Z route gets one on its middle
    // segment.) The per-handle cursor advertises the perpendicular travel
    // axis (ns for a horizontal segment, ew for a vertical). Returns the
    // advanced pool cursor. Shared by the selected loop and the hovered pass.
    private _placeSegmentPads(conn: Connector, segUsed: number, m: Matrix): number
    {
        const route = conn.CurrentRoutePoints ?? [];
        // Interior segments only: index i in [1, route.length - 3].
        for (let i = 1; i + 1 < route.length - 1 && segUsed < this._segPool.length; i++)
        {
            const a = route[i]!;
            const b = route[i + 1]!;
            const v = this._segPool[segUsed++]!;
            HANDLE_TAGS.set(v, { kind: 'segment', connector: conn, index: i });
            // Orientation reads the CONTENT-space segment (the camera never
            // rotates, so a horizontal segment stays horizontal after scaling);
            // the pad centre projects through the camera, size stays constant.
            v.Cursor = segmentIsHorizontal(a, b) ? SEG_CURSOR_H : SEG_CURSOR_V;
            const mid = projectToLayer(m, (a.X + b.X) / 2, (a.Y + b.Y) / 2);
            v.Arrange(new Rect(
                mid.X - segHandleSize() / 2,
                mid.Y - segHandleSize() / 2,
                segHandleSize(), segHandleSize()));
        }
        return segUsed;
    }
}

// Shape that paints a Connector's route Geometry VERBATIM — no fit-to-
// slot scaling. The base Shape uniform-scales a 2-D geometry to fill a
// non-degenerate arrange slot (the icon-in-a-box path); a connector route
// is authored in absolute canvas coordinates and must render 1:1. Relying
// on the base's degenerate-slot short-circuit (arrange at Size.Zero) is
// fragile here: the SVG renderer re-emits a visual's own primitives on a
// SIZE change, so a halo that stays 0×0 across the hidden→shown transition
// never repaints. Painting verbatim lets the adorner arrange the halo at
// the layer's real extent — restoring normal size-change repaint tracking
// — while never scaling the route.
// Exported for the hover-halo regression test only — NOT part of the
// package's public surface (no barrel re-exports this module).
export class HaloShape extends Shape
{
    protected override RenderOverride(dc: DrawingContext): void
    {
        const g = this.Geometry;
        if (g === undefined) return;
        dc.DrawGeometry(this.Fill, this.Stroke, g);
    }
}

// ── HoverHaloAdorner ─────────────────────────────────────────────
// Single Shape that mirrors the geometry of the currently-hovered
// (and not-yet-selected) connector. Painted with the @Primary accent
// at HOVER_HALO_OPACITY, stroke thickness clamped to ≥ hoverHaloMinThick()
// so the halo reads as a clear affordance on hair-thin connectors.
//
// Halo is NOT hit-test visible — the mural-hit pad would otherwise
// span the adorner layer's full canvas extent (the halo is arranged
// at (0,0, W, H) so its Geometry coords land in canvas-local space),
// which would swallow every PointerMove regardless of cursor position
// and pin state.hoveredConnector forever. Instead the halo passes
// pointer events through to the underlying connector. Click-to-select
// flows through the existing connector-body PointerDown path in
// onPointerDown — that's where exclusive selection (clear figures)
// and ConnectorSelectionChanged are wired.
class HoverHaloAdorner extends Adorner
{
    private readonly _state: SharedState;
    private readonly _halo:  HaloShape;

    constructor(adornedElement: Visual, state: SharedState)
    {
        super(adornedElement);
        this._state = state;
        // Both the adorner pad AND the halo itself are non-hit-test.
        // See header comment for why.
        this.IsHitTestVisible = false;

        const halo = new HaloShape();
        halo.IsHitTestVisible = false;
        // No Fill — the halo is a stroked outline; Fill would paint
        // the closed path interior of a multi-segment connector as
        // a region, which is meaningless for line art.
        halo.Fill = undefined;
        this.AttachVisual(halo);
        this._halo = halo;
    }

    public override get visualChildren(): Visual[] { return [this._halo]; }

    public override MeasureOverride(_avail: Size): Size
    {
        const big = new Size(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
        this._halo.Measure(big);
        return Size.Zero;
    }

    public override ArrangeOverride(finalSize: Size): Size
    {
        const conn = this._state.hoveredConnector;
        if (conn === undefined || conn.Geometry === undefined)
        {
            this._halo.Geometry = undefined;
            this._halo.Stroke   = undefined;
            this._halo.Arrange(new Rect(HIDE_OFFSCREEN, HIDE_OFFSCREEN, 0, 0));
            return finalSize;
        }
        // Reuse the connector's Geometry instance — the SVG renderer
        // re-emits a path for each Visual independently, so two
        // Visuals sharing one Geometry reference render two distinct
        // <path> elements. Routing recomputes on the connector swap
        // its GeometryKey value; the syncHoverConnector subscription
        // catches that and re-runs this arrange.
        this._halo.Geometry = conn.Geometry;
        this._halo.Stroke   = makeHaloPen(conn);
        // Scale the painted route by the camera. The halo paints the connector's
        // content-space Geometry verbatim, but this adorner lives in the UNSCALED
        // layer frame (outside PART_Camera). A RenderTransform = the adorned->layer
        // matrix maps the route onto the zoomed connector it decorates (pivot at
        // the default 0,0 origin, so it's a plain content->layer apply). Identity
        // at zoom 1 → no transform, verbatim as before.
        const m = this.AdornedToLayerMatrix;
        this._halo.RenderTransform = m.IsIdentity ? undefined : new MatrixTransform(m);
        // Arrange spanning the full adorner-layer extent so the halo's
        // Geometry coordinates (absolute canvas space) land in the same
        // canvas-local frame the connector renders into (offset 0,0). The
        // slot size is deliberately non-degenerate so the SVG renderer's
        // size-change repaint tracking fires on the hidden→shown
        // transition; HaloShape paints the route verbatim, so the slot
        // size never scales the geometry (the old plain-Shape halo
        // uniform-scaled a waypoint route to fill this slot — the blow-up
        // bug this adorner now avoids).
        this._halo.Arrange(new Rect(0, 0, finalSize.Width, finalSize.Height));
        return finalSize;
    }
}

// Build a fresh Pen each arrange — Shape's subscribeAny would otherwise
// re-fire InvalidateVisual on every per-prop change of a long-lived halo
// pen. The pen carries the accent brush, the clamped thickness, and
// round caps / joins so wide halos meet at corners without ugly miter
// spikes (visible on tight-angle connector turns).
function makeHaloPen(conn: Connector): Pen
{
    const p = new Pen();
    // Resolve @Primary live from the theme (adapts light/dark) and build a fresh
    // brush at the settings hover opacity — never mutate the shared theme brush.
    const primary = (conn as unknown as { TryFindResource(k: string): unknown }).TryFindResource('Primary');
    const color   = primary instanceof SolidColorBrush ? primary.Color : HOVER_HALO_FALLBACK;
    const b = new SolidColorBrush(color);
    b.Opacity    = DiagramSettings.HoverHaloOpacity();
    p.Brush      = b;
    p.Thickness  = Math.max(conn.Stroke?.Thickness ?? 0, hoverHaloMinThick());
    p.LineCap    = LineCap.Round;
    p.LineJoin   = LineJoin.Round;
    return p;
}

// ── Helpers ──────────────────────────────────────────────────────

function makeDot(size: number, fill: SolidColorBrush, cursor: string): Border
{
    const v = new Border();
    v.Width  = size;
    v.Height = size;
    const r = size / 2;
    v.CornerRadius = new CornerRadius(r, r, r, r);
    v.Fill   = fill;
    v.IsHitTestVisible = true;
    v.Cursor = cursor;
    return v;
}

// Side bar: rectangular Border with no CornerRadius. Width and Height
// are set later in ArrangeOverride based on the figure's dimensions
// and the side orientation. We don't need a fixed measured size since
// our parent (the adorner) returns Size.Zero from MeasureOverride.
function makeBar(fill: SolidColorBrush, cursor: string): Border
{
    const v = new Border();
    v.Fill       = fill;
    v.IsHitTestVisible = true;
    v.Cursor           = cursor;
    return v;
}

// Port marker dot — a fixed-size round Border the adorner positions at
// each dynamic-slot location on a hovered figure's side. Non-hit-test
// so clicks pass through to the side bar behind it (which owns the
// create gesture); the marker is purely a visual indicator.
function makePortMarker(): Border
{
    const v = new Border();
    v.Width  = portMarkerSize();
    v.Height = portMarkerSize();
    const r = portMarkerSize() / 2;
    v.CornerRadius     = new CornerRadius(r, r, r, r);
    v.Fill       = portFill();
    v.IsHitTestVisible = false;
    return v;
}

// Wire a single handle Border so its OWN bubble-phase PointerDown starts
// the matching gesture. Handle-level listeners are immune to Figure's
// args.Handled = true because the handle isn't a Figure descendant; the
// bubble walk for the handle's PointerDown runs handle → adorner →
// layer → ... → diagram, with no Figure in the route to short-circuit
// it. The listener is permanent for the visual's lifetime; the WeakMap
// tag set in ArrangeOverride tells us which (figure, port) / (connector,
// end) / (connector, index) the click belongs to right now.
type HandleDownCallback = (tag: HandleTag, args: PointerEventArgs) => void;

function wireHandle(handle: Visual, onDown: HandleDownCallback): void
{
    handle.AddRoutedEventListener('PointerDown', (raw: unknown): void => {
        const args = raw as PointerEventArgs;
        const tag = HANDLE_TAGS.get(handle);
        if (tag === undefined) return;
        onDown(tag, args);
    });
}

export function findFigureAncestor(visual: unknown): Figure | undefined
{
    let cur = visual as Visual | undefined;
    while (cur !== undefined && cur !== null)
    {
        if (cur instanceof Figure) return cur;
        cur = (cur as { GetVisualParent?(): Visual | undefined }).GetVisualParent?.();
    }
    return undefined;
}

export function findConnectorAncestor(visual: unknown): Connector | undefined
{
    let cur = visual as Visual | undefined;
    while (cur !== undefined && cur !== null)
    {
        if (cur instanceof Connector) return cur;
        cur = (cur as { GetVisualParent?(): Visual | undefined }).GetVisualParent?.();
    }
    return undefined;
}

// Resolve the connector the pointer is targeting: its painted path (a direct
// visual ancestor) OR its LABEL. The label is a hit-test-visible ShapeText that
// the connectors materializer mounts as a SIBLING of the connector (not a
// child), so an ancestor walk alone misses it — match it against the live
// connectors by LabelInstance. Z-order-correct for free: the materializer
// mirrors the label's ZIndex to the connector's, so a label under a figure is
// occluded (args.Source is the figure) and never resolves here.
// Exported for the label-hit regression test only — NOT part of the package's
// public surface (no barrel re-exports this module).
export function connectorFromSource(diagram: Diagram, source: unknown): Connector | undefined
{
    const direct = findConnectorAncestor(source);
    if (direct !== undefined) return direct;
    // Find the ShapeText the pointer is inside, if any (one ancestor walk).
    let label: ShapeText | undefined = undefined;
    for (let cur = source as Visual | undefined; cur !== undefined && cur !== null;
         cur = (cur as { GetVisualParent?(): Visual | undefined }).GetVisualParent?.())
    {
        if (cur instanceof ShapeText) { label = cur; break; }
    }
    if (label === undefined) return undefined;
    // Match it against the live connectors' mounted labels. (A figure's own
    // label is also a ShapeText but matches no connector → correctly ignored.)
    const connectors = diagram.Connectors;
    if (connectors === undefined) return undefined;
    for (let i = 0; i < connectors.Count; i++)
    {
        const item = connectors.Get(i);
        if (item instanceof Connector && item.LabelInstance === label) return item;
    }
    return undefined;
}

function localPosition(args: PointerEventArgs, diagram: Diagram): Point
{
    // Diagram.HostToContent sums the panel's ArrangedRect chain (already
    // carrying the SCP's -offset in clip-and-translate mode) and divides by the
    // zoom (PART_Camera's LayoutTransform scale), so hovered side bars track the
    // cursor after scrolling AND at any zoom level.
    return diagram.HostToContent(args.HostX, args.HostY);
}

// Resolve the figure the cursor is over (its port adorners follow). For
// OVERLAPPING figures the pick must respect true paint z-order: a figure sent
// to a lower Panel.ZIndex must NOT steal the topmost figure's port adorners.
// Earlier this ranked by collection iteration order, which only coincides with
// paint order until a z-order command (Bring-to-Front / Send-to-Back) reorders
// the stack — the same "trust the true z, not position" fix connectorFromSource
// applies to connector-vs-figure overlap. Falls back to the nearest figure
// within the proximity tolerance when the cursor is outside every bbox — the
// "near" pick used during a drag so target port handles appear without the user
// having to land precisely on the figure body.
// Exported for the overlap-z regression test only — NOT part of the package's
// public surface (no barrel re-exports this module).
export function findFigureAtCanvasPoint(diagram: Diagram, p: Point): Figure | undefined
{
    const items = diagram.ItemsSource;
    if (items === undefined) return undefined;
    let bestInside: Figure | undefined = undefined;
    let bestInsideZ = Number.NEGATIVE_INFINITY;
    let bestNear: Figure | undefined = undefined;
    let bestNearDist = figureProximity();
    for (const item of items as Iterable<unknown>)
    {
        const container = diagram.Generator.ContainerFromItem(item);
        if (container instanceof Figure)
        {
            const r = container.ArrangedRect;
            if (r !== undefined)
            {
                const left   = container.Left;
                const top    = container.Top;
                const right  = left + r.Width;
                const bottom = top  + r.Height;
                if (p.X >= left && p.X <= right && p.Y >= top && p.Y <= bottom)
                {
                    // Rank by real paint z (Panel.ZIndex). `>=` lets a later
                    // sibling win an EQUAL-z tie, matching the canvas's
                    // within-z paint order (later child paints on top).
                    const zi = Panel.GetZIndex(container);
                    if (zi >= bestInsideZ) { bestInside = container; bestInsideZ = zi; }
                }
                else
                {
                    const dx = Math.max(left - p.X, 0, p.X - right);
                    const dy = Math.max(top  - p.Y, 0, p.Y - bottom);
                    const d  = Math.hypot(dx, dy);
                    if (d <= bestNearDist) { bestNear = container; bestNearDist = d; }
                }
            }
        }
    }
    return bestInside ?? bestNear;
}

// Closest cardinal side of `figure` to point `p` in canvas-host coords.
// Returns the side whose edge is nearest the cursor — used when the
// user releases over a figure but not on a side bar (proximity fallback)
// or when picking among the four candidates on EndCreate /
// EndDragOverTarget. Returns East as the degenerate fallback when the
// figure has no ArrangedRect (should never happen post-layout).
function pickSideOfFigure(figure: Figure, p: Point): ResolvedPortSide
{
    const r = figure.ArrangedRect;
    if (r === undefined) return PortSide.E;
    const left   = figure.Left;
    const top    = figure.Top;
    const right  = left + r.Width;
    const bottom = top  + r.Height;
    const dL = Math.abs(p.X - left);
    const dR = Math.abs(p.X - right);
    const dT = Math.abs(p.Y - top);
    const dB = Math.abs(p.Y - bottom);
    const m = Math.min(dL, dR, dT, dB);
    if (m === dL) return PortSide.W;
    if (m === dR) return PortSide.E;
    if (m === dT) return PortSide.N;
    return PortSide.S;
}

function collectionContains(
    collection: ObservableCollection<MuralBase> | undefined,
    item: MuralBase,
): boolean
{
    if (collection === undefined) return false;
    for (let i = 0; i < collection.Count; i++)
    {
        if (collection.Get(i) === item) return true;
    }
    return false;
}

function mountAdorner(panel: Visual, adorner: Adorner): boolean
{
    const layer = AdornerLayer.GetAdornerLayer(panel);
    if (layer === undefined) return false;
    layer.Add(adorner);
    return true;
}

function unmountAdorner(panel: Visual | undefined, adorner: Adorner): void
{
    if (panel === undefined) return;
    const layer = AdornerLayer.GetAdornerLayer(panel);
    layer?.Remove(adorner);
}

// ── attachConnectorInteractions ──────────────────────────────────
// Returns a detach thunk. Called from Diagram's
// ConnectorInteractionsEnabled DP setter, not by consumers directly.

/** @internal */
export function attachConnectorInteractions(diagram: Diagram): () => void
{
    const state: SharedState = {
        hoveredFigure:    undefined,
        hoverSide:        undefined,
        hoveredConnector: undefined,
        activeGesture:    undefined,
        activePointerId:  undefined,
        editKind:         undefined,
    };

    const createBehavior = new ConnectorCreateBehavior(diagram);
    const editAdorner    = new ConnectorEditAdorner();

    let sideAdornerVisual: SideBarsAdorner   | undefined = undefined;
    let editAdornerVisual: EditHandlesAdorner | undefined = undefined;
    let haloAdornerVisual: HoverHaloAdorner  | undefined = undefined;
    let mountedPanel:      Visual             | undefined = undefined;

    // Anchor for Shift+click range-select on connectors. Mirrors
    // Selector._anchor for figures — set on every non-range click, used
    // as the "from" endpoint when Shift makes the next click extend a
    // range. Survives ClearConnectorSelection so a "click a, clear all,
    // Shift+click b" gesture still ranges from a→b; matches Selector's
    // semantics. Stale anchor (connector removed from Connectors) is
    // tolerated — Diagram.SelectConnectorRange no-ops on missing index.
    let connectorAnchor: Connector | undefined = undefined;

    // The side-bar adorner only re-arranges when InvalidateArrange is
    // called. Hovered-figure swap calls it; Left / Top mutation on the
    // SAME hovered figure (e.g. a drag) does not, so we subscribe to
    // the figure's position DPs and refresh the bars on every fire.
    // Width / Height covered too for the resize case. The
    // subscribedHoverFigure handle is kept separate from
    // state.hoveredFigure so detach can run after state has already
    // been cleared.
    let subscribedHoverFigure: Figure | undefined = undefined;
    let hoverFigureSubs: Disposable[] = [];
    const onHoveredFigureGeometryChanged = (): void => {
        sideAdornerVisual?.InvalidateArrange();
    };
    const syncHoverSubscription = (next: Figure | undefined): void => {
        if (subscribedHoverFigure === next) return;
        if (subscribedHoverFigure !== undefined)
        {
            for (const s of hoverFigureSubs) s.dispose();
            hoverFigureSubs = [];
            subscribedHoverFigure.RemoveSideEndpointsChangedListener(onHoveredFigureGeometryChanged);
        }
        subscribedHoverFigure = next;
        if (next !== undefined)
        {
            hoverFigureSubs = [
                next.PropertyChanged(Figure.LeftKey).subscribe(onHoveredFigureGeometryChanged),
                next.PropertyChanged(Figure.TopKey).subscribe(onHoveredFigureGeometryChanged),
                next.PropertyChanged(Visual.WidthKey).subscribe(onHoveredFigureGeometryChanged),
                next.PropertyChanged(Visual.HeightKey).subscribe(onHoveredFigureGeometryChanged),
            ];
            // Re-arrange port markers when a connector registers /
            // unregisters on any side of the hovered figure — the slot
            // count drives the marker count.
            next.AddSideEndpointsChangedListener(onHoveredFigureGeometryChanged);
        }
    };

    // Parallel to syncHoverSubscription but for the connector hover halo.
    // The halo's arrange reads conn.Geometry, conn.Stroke?.Thickness on
    // every pass — so it must re-arrange whenever any of those change.
    //   * Shape.GeometryKey  — routing recompute swaps the Geometry DP.
    //   * Visual.StrokeKey    — user edits the pen-by-reference (FormatMirror
    //                          mutates in place, but a Stroke replacement
    //                          must still re-arm the ThicknessKey listener
    //                          against the new Pen instance).
    //   * Pen.ThicknessKey   — drives the clamp in makeHaloPen.
    let subscribedHoverConnector: Connector | undefined = undefined;
    let subscribedHoverPen:       Pen       | undefined = undefined;
    let hoverConnectorSubs: Disposable[] = [];
    let hoverPenSub: Disposable | undefined = undefined;
    const onHoveredConnectorChanged = (): void => {
        // Stroke swap: rebind the thickness listener against the new pen.
        const conn = subscribedHoverConnector;
        if (conn !== undefined)
        {
            const nextPen = conn.Stroke;
            if (nextPen !== subscribedHoverPen)
            {
                hoverPenSub?.dispose();
                hoverPenSub = undefined;
                subscribedHoverPen = nextPen;
                if (subscribedHoverPen !== undefined)
                {
                    hoverPenSub = subscribedHoverPen.PropertyChanged(Pen.ThicknessKey).subscribe(onHoveredConnectorChanged);
                }
            }
        }
        haloAdornerVisual?.InvalidateArrange();
        // The hovered connector's segment pads live in the edit adorner;
        // re-arrange it too so they track the route as figures move.
        editAdornerVisual?.InvalidateArrange();
    };
    const syncHoverConnectorSubscription = (next: Connector | undefined): void => {
        if (subscribedHoverConnector === next) return;
        if (subscribedHoverConnector !== undefined)
        {
            for (const s of hoverConnectorSubs) s.dispose();
            hoverConnectorSubs = [];
            hoverPenSub?.dispose();
            hoverPenSub = undefined;
            subscribedHoverPen = undefined;
        }
        subscribedHoverConnector = next;
        if (next !== undefined)
        {
            hoverConnectorSubs = [
                next.PropertyChanged(Shape.GeometryKey).subscribe(onHoveredConnectorChanged),
                next.PropertyChanged(Visual.StrokeKey).subscribe(onHoveredConnectorChanged),
            ];
            subscribedHoverPen = next.Stroke;
            if (subscribedHoverPen !== undefined)
            {
                hoverPenSub = subscribedHoverPen.PropertyChanged(Pen.ThicknessKey).subscribe(onHoveredConnectorChanged);
            }
        }
    };

    // Keep the adorners in sync with the Connectors collection: when a
    // connector is removed (the consumer's DeleteRequested listener
    // mutating Connectors), every adorner referencing it must drop — its
    // hover halo, its edit handles, and any in-flight edit drag. Diagram
    // already prunes the SELECTION on removal; this clears the view-side
    // state the adorners hold and repaints them.
    let subscribedConnectors: ObservableCollection<MuralBase> | undefined = undefined;
    let connectorsUnsub: (() => void) | undefined = undefined;
    const onConnectorsChanged = (change: CollectionChange<MuralBase>): void => {
        let gone: Set<MuralBase> | 'all' | undefined;
        if      (change.kind === 'cleared')  gone = 'all';
        else if (change.kind === 'removed')  gone = new Set<MuralBase>(change.items);
        else if (change.kind === 'replaced') gone = new Set<MuralBase>([change.oldItem]);
        else                                 return;   // inserted / moved — no removal
        const isGone = (c: Connector | undefined): boolean =>
            c !== undefined && (gone === 'all' || gone.has(c as unknown as MuralBase));

        // Stale hover halo on a removed connector.
        if (isGone(state.hoveredConnector))
        {
            state.hoveredConnector = undefined;
            syncHoverConnectorSubscription(undefined);
        }
        // An edit drag whose connector vanished mid-gesture.
        if (state.activeGesture === ConnectorGesture.Edit && isGone(editAdorner.ActiveConnector))
        {
            editAdorner.Abort();
            // Close the history transaction opened in onHandleDown so it doesn't leak.
            (diagram as unknown as { _endEdit?(): void })._endEdit?.();
            state.activeGesture   = undefined;
            state.activePointerId = undefined;
            state.editKind        = undefined;
        }
        // Repaint: edit handles for removed connectors arrange away
        // (ArrangeOverride skips connectors no longer in SelectedConnectors
        // / Connectors), and the halo clears.
        haloAdornerVisual?.InvalidateArrange();
        editAdornerVisual?.InvalidateArrange();
    };
    const syncConnectorsSubscription = (): void => {
        const coll = diagram.Connectors;
        if (coll === subscribedConnectors) return;
        connectorsUnsub?.();
        connectorsUnsub = undefined;
        subscribedConnectors = coll;
        if (coll !== undefined) connectorsUnsub = coll.Subscribe(onConnectorsChanged);
    };

    // Per-handle PointerDown callback. Fired directly by each handle
    // Border's own bubble-phase listener (wired in wireHandle), so it
    // dodges Figure.OnPointerDown's Handled short-circuit — the handle
    // isn't a Figure descendant, so the route walks handle → adorner →
    // layer → … → Diagram with no Figure to intercept first.
    const onHandleDown = (tag: HandleTag, args: PointerEventArgs): void => {
        if (state.activeGesture !== undefined) return;
        // One history transaction for the whole connector gesture (create / endpoint
        // / waypoint / segment drag), closed in onPointerUp. A nested ConnectorCreated
        // bracket (on Create) joins this one, so a draw is a single undo step.
        (diagram as unknown as { _beginEdit?(l: string): void })._beginEdit?.('Connector');
        const cursor = localPosition(args, diagram);
        if (tag.kind === 'side')
        {
            createBehavior.BeginCreate(tag.figure, tag.side, cursor);
            const transient = createBehavior.TransientConnector;
            const panel = diagram.ItemsPanelInstance;
            if (panel !== undefined && transient !== undefined)
            {
                (panel as unknown as { AddChild?(v: Visual): void }).AddChild?.(transient);
            }
            state.activeGesture   = ConnectorGesture.Create;
            state.activePointerId = args.PointerId;
            args.CapturePointer(diagram, SIDE_CURSOR);
            args.Handled = true;
            return;
        }
        if (tag.kind === 'endpoint')
        {
            editAdorner.BeginEndpointDrag(tag.connector, tag.end, cursor);
            state.activeGesture   = ConnectorGesture.Edit;
            state.activePointerId = args.PointerId;
            state.editKind        = ConnectorEditKind.Endpoint;
            args.CapturePointer(diagram, ENDPOINT_CURSOR);
            args.Handled = true;
            editAdornerVisual?.InvalidateArrange();
            return;
        }
        if (tag.kind === 'waypoint')
        {
            editAdorner.BeginWaypointDrag(tag.connector, tag.index);
            state.activeGesture   = ConnectorGesture.Edit;
            state.activePointerId = args.PointerId;
            state.editKind        = ConnectorEditKind.Waypoint;
            args.CapturePointer(diagram, WAYPOINT_CURSOR);
            args.Handled = true;
            editAdornerVisual?.InvalidateArrange();
            return;
        }
        if (tag.kind === 'segment')
        {
            // Orientation comes from the rendered route the handle was
            // placed against — read BEFORE BeginSegmentDrag materializes
            // the route into Waypoints and shifts segment indices.
            const route = tag.connector.CurrentRoutePoints;
            const horizontal = route !== undefined && tag.index + 1 < route.length
                ? segmentIsHorizontal(route[tag.index]!, route[tag.index + 1]!)
                : true;
            editAdorner.BeginSegmentDrag(tag.connector, tag.index);
            state.activeGesture   = ConnectorGesture.Edit;
            state.activePointerId = args.PointerId;
            state.editKind        = ConnectorEditKind.Segment;
            // Capture with the perpendicular-travel cursor so the pointer
            // keeps the ns/ew affordance for the whole drag.
            args.CapturePointer(diagram, horizontal ? SEG_CURSOR_H : SEG_CURSOR_V);
            args.Handled = true;
            editAdornerVisual?.InvalidateArrange();
            return;
        }
    };

    const mountAdornersIfReady = (): void => {
        // Idempotent — re-arms if the Connectors DP was swapped. Runs on
        // the mount microtask and on every pointer event (both call here).
        syncConnectorsSubscription();
        if (mountedPanel !== undefined) return;
        const panel = diagram.ItemsPanelInstance;
        if (panel === undefined) return;
        const sideA = new SideBarsAdorner(panel, state, onHandleDown);
        const editA = new EditHandlesAdorner(panel, diagram, state, onHandleDown);
        // Halo mounts BEFORE EditHandles so the endpoint / waypoint dots
        // paint on top of the halo when both are visible mid-transition.
        // In steady state they're mutually exclusive (halo only on
        // unselected, dots only on selected), but a click that flips
        // the connector from hovered → selected re-arranges both
        // adorners in the same layout pass, and the dots should win
        // the overlap in case the halo lingers for a frame.
        const haloA = new HoverHaloAdorner(panel, state);
        const ok1 = mountAdorner(panel, haloA);
        const ok2 = mountAdorner(panel, sideA);
        const ok3 = mountAdorner(panel, editA);
        if (!ok1 || !ok2 || !ok3)
        {
            // Layer not in scope yet — drop all, try again later.
            return;
        }
        sideAdornerVisual = sideA;
        editAdornerVisual = editA;
        haloAdornerVisual = haloA;
        mountedPanel      = panel;
    };

    queueMicrotask(mountAdornersIfReady);

    // Connectors mode gates whether the connector adorners react to the pointer:
    // active when the mode is pinned (the scrollbar toggle) OR the user holds
    // Ctrl (momentary). When inactive, hover + gesture-start are suppressed so
    // figures aren't cluttered with port handles at all times. An in-flight
    // gesture is NOT gated (state.activeGesture guards run first), so releasing
    // Ctrl mid-drag still completes the drag.
    const connectorsModeActive = (args: PointerEventArgs): boolean =>
        diagram.ConnectorsModePinned
        || hasModifier(args.Modifiers, ModifierKeys.Control)
        || hasModifier(args.Modifiers, ModifierKeys.Windows);

    const onPointerDown = (raw: unknown): void => {
        const args = raw as PointerEventArgs;
        mountAdornersIfReady();

        if (state.activeGesture !== undefined) return;
        // Mode gate — outside Connectors mode, connector selection / gesture
        // start is suppressed; the event falls through to normal figure interaction.
        if (!connectorsModeActive(args)) return;

        // Handle clicks land via wireHandle's per-Border listener above,
        // not this Diagram-level path. Anything reaching here is a click
        // on a connector body, a figure body, or empty canvas space.

        const mods    = args.Modifiers;
        const ctrl    = hasModifier(mods, ModifierKeys.Control) || hasModifier(mods, ModifierKeys.Windows);
        const shift   = hasModifier(mods, ModifierKeys.Shift);

        // Connector body click → SelectionMode-aware multi-select that
        // mirrors Selector.HandleContainerClick for figures, with one
        // cross-population rule layered on top:
        //   * Plain click          → exclusive (clear figure selection too).
        //   * Ctrl/Shift           → additive across populations (preserve
        //                            figure selection so Visio-style mixed
        //                            figure+connector selections build up).
        // FormatMirror's ConnectorSelectionChanged listener seeds the
        // shared editor off the freshly-selected connector(s); the editor
        // already broadcasts back to both populations via FormatMirror's
        // _strokeTargets union.
        const conn = connectorFromSource(diagram, args.Source);
        if (conn !== undefined)
        {
            const mode = diagram.SelectionMode;
            // Cross-population rule: only plain click clears figures.
            // Ctrl / Shift always preserve them.
            if (!ctrl && !shift) diagram.ClearSelection();

            if (mode === SelectionMode.Single)
            {
                // Single mode collapses every modifier onto "replace
                // with this one" — same as Selector.HandleContainerClick.
                diagram.ClearConnectorSelection();
                diagram.SelectConnector(conn);
                connectorAnchor = conn;
            }
            else if (mode === SelectionMode.Multiple)
            {
                // Multiple mode: every click toggles. Plain click in
                // Multiple ALSO clears the connector track first (it
                // already cleared figures above) — matches Selector.
                if (!ctrl && !shift) diagram.ClearConnectorSelection();
                if (diagram.IsConnectorSelected(conn))
                {
                    diagram.DeselectConnector(conn);
                }
                else
                {
                    diagram.SelectConnector(conn);
                }
                connectorAnchor = conn;
            }
            else // Extended
            {
                const shiftActive = shift && connectorAnchor !== undefined;
                if (shiftActive)
                {
                    diagram.SelectConnectorRange(connectorAnchor!, conn);
                    // Anchor stays put on shift+click — matches Selector.
                }
                else if (ctrl)
                {
                    if (diagram.IsConnectorSelected(conn))
                    {
                        diagram.DeselectConnector(conn);
                    }
                    else
                    {
                        diagram.SelectConnector(conn);
                    }
                    connectorAnchor = conn;
                }
                else
                {
                    diagram.ClearConnectorSelection();
                    diagram.SelectConnector(conn);
                    connectorAnchor = conn;
                }
            }

            // Halo disappears immediately — the just-selected connector
            // no longer qualifies for hover (selected ⇒ no halo per the
            // scope decision), so clear hover state and re-arrange both
            // adorners.
            state.hoveredConnector = undefined;
            syncHoverConnectorSubscription(undefined);
            haloAdornerVisual?.InvalidateArrange();
            editAdornerVisual?.InvalidateArrange();
            args.Handled = true;
            return;
        }

        // Figure body click → clear connector selection on plain click;
        // additive modifiers (Ctrl / Shift) preserve the connector track
        // so the user can build mixed figure+connector selections from
        // either end. Don't set args.Handled — Figure.OnPointerDown still
        // runs to actually update the figure-side selection through the
        // Selector base.
        if (findFigureAncestor(args.Source) !== undefined)
        {
            if (!ctrl && !shift && diagram.SelectedConnectors.length > 0)
            {
                diagram.ClearConnectorSelection();
                editAdornerVisual?.InvalidateArrange();
            }
            return;
        }

        // Truly empty space → clear connector selection (figure-side
        // empty-space handling stays with the Selector base).
        if (diagram.SelectedConnectors.length > 0)
        {
            diagram.ClearConnectorSelection();
            editAdornerVisual?.InvalidateArrange();
        }
    };

    const onPointerMove = (raw: unknown): void => {
        const args = raw as PointerEventArgs;
        mountAdornersIfReady();
        const cursor = localPosition(args, diagram);

        if (state.activeGesture === ConnectorGesture.Create && args.PointerId === state.activePointerId)
        {
            createBehavior.UpdateCursor(cursor);
        }
        else if (state.activeGesture === ConnectorGesture.Edit && args.PointerId === state.activePointerId)
        {
            editAdorner.UpdateCursor(cursor);
            editAdornerVisual?.InvalidateArrange();
        }

        // Mode gate — when idle and NOT in Connectors mode, the adorners don't
        // react to movement: drop any hover and bail before recomputing it, so
        // moving over figures never lights up port handles outside the mode.
        if (state.activeGesture === undefined && !connectorsModeActive(args))
        {
            clearHover();
            return;
        }

        // Hover update runs ALSO during an active gesture — without it,
        // target figures' port handles would never appear while the user
        // is dragging a new connector or re-anchoring an endpoint, and
        // the user couldn't see where to land for a named port. Drop
        // target on EndCreate / EndDragOverTarget still uses cursor →
        // findFigureAtCanvasPoint + getPortAtCanvasPoint, so hover-show
        // and drop-pick stay in lockstep.
        // Connector hover for the halo, driven by the ACTUAL topmost hit —
        // args.Source respects z-order (it IS the connector's painted path
        // when the connector paints above an overlapping figure, and the
        // figure when the figure is on top). This is why the halo must be
        // resolved from args.Source, not gated on "no figure bbox here":
        // a connector brought in front of a shape still overlaps the shape's
        // bbox, but it is the hit and should show its halo.
        let conn: Connector | undefined = undefined;
        if (state.activeGesture === undefined)
        {
            conn = connectorFromSource(diagram, args.Source);
            // The segment pads shown with the halo are hit-test-visible, so
            // reaching for one makes the PAD the event source — which has no
            // Connector ancestor and would otherwise clear the hover and
            // hide the pad mid-reach. Resolve the pad back to its connector
            // so the hover (halo + pads) stays put while the cursor is on it.
            if (conn === undefined)
            {
                const tag = args.Source instanceof Visual ? HANDLE_TAGS.get(args.Source) : undefined;
                if (tag !== undefined && tag.kind === 'segment') conn = tag.connector;
            }
            // Suppress halo on already-selected connectors — the
            // EditHandlesAdorner endpoint / waypoint dots already
            // signal "selected"; stacking a halo on top would read
            // as noise.
            if (conn !== undefined && diagram.IsConnectorSelected(conn)) conn = undefined;
        }

        // Figure hover (side bars / port handles). While IDLE, resolve the
        // figure from the TRUE topmost hit (args.Source) rather than a bbox
        // scan of ItemsSource: the render hit-test respects nesting (a figure
        // inside a container is NOT in ItemsSource, so the bbox scan can never
        // see it — that's why nested nodes showed no port adorners), silhouette
        // geometry, AND z-order. The figure's own side-bar handle resolves back
        // to its figure so reaching a port doesn't drop the hover (mirrors the
        // segment-pad resolution above). Suppress when a connector is the
        // topmost hit — the user is targeting the connector, not the figure
        // beneath it. The bbox scan stays as the "near" fallback (cursor just
        // off a figure body) and drives the ACTIVE-gesture case, where
        // args.Source is the dragged connector, not the target figure.
        let fig: Figure | undefined;
        if (state.activeGesture === undefined)
        {
            if (conn !== undefined)
            {
                fig = undefined;
            }
            else
            {
                fig = findFigureAncestor(args.Source);
                if (fig === undefined)
                {
                    const tag = args.Source instanceof Visual ? HANDLE_TAGS.get(args.Source) : undefined;
                    if (tag !== undefined && tag.kind === 'side') fig = tag.figure;
                }
                if (fig === undefined) fig = findFigureAtCanvasPoint(diagram, cursor);
            }
        }
        else
        {
            fig = findFigureAtCanvasPoint(diagram, cursor);
        }
        // Only the side nearest the cursor is shown — recompute it on
        // every move so the highlighted edge tracks the pointer around
        // the figure. Re-arrange when EITHER the figure or the chosen
        // side changes (the side flips as the cursor crosses the figure's
        // diagonals); re-subscribe only when the figure itself changes.
        const side = fig !== undefined ? pickSideOfFigure(fig, cursor) : undefined;
        const figChanged = fig !== state.hoveredFigure;
        if (figChanged)
        {
            state.hoveredFigure = fig;
            syncHoverSubscription(fig);
        }
        if (figChanged || side !== state.hoverSide)
        {
            state.hoverSide = side;
            sideAdornerVisual?.InvalidateArrange();
        }

        if (conn !== state.hoveredConnector)
        {
            state.hoveredConnector = conn;
            syncHoverConnectorSubscription(conn);
            haloAdornerVisual?.InvalidateArrange();
            // Segment pads show with the halo (hovered connector), so the
            // edit adorner re-arranges on every hover swap too.
            editAdornerVisual?.InvalidateArrange();
        }
    };

    const onPointerUp = (raw: unknown): void => {
        const args = raw as PointerEventArgs;
        if (args.PointerId !== state.activePointerId) return;
        const cursor = localPosition(args, diagram);

        if (state.activeGesture === ConnectorGesture.Create)
        {
            const transient = createBehavior.TransientConnector;
            const panel = diagram.ItemsPanelInstance;
            if (panel !== undefined && transient !== undefined)
            {
                (panel as unknown as { RemoveChild?(v: Visual): void }).RemoveChild?.(transient);
            }
            const target = findFigureAtCanvasPoint(diagram, cursor);
            if (target !== undefined)
            {
                createBehavior.EndCreate(target, pickSideOfFigure(target, cursor));
            }
            else
            {
                createBehavior.Abort();
            }
        }
        else if (state.activeGesture === ConnectorGesture.Edit)
        {
            if (state.editKind === ConnectorEditKind.Endpoint)
            {
                const target = findFigureAtCanvasPoint(diagram, cursor);
                if (target !== undefined)
                {
                    editAdorner.EndDragOverTarget(target, pickSideOfFigure(target, cursor));
                }
                else
                {
                    editAdorner.EndDragOverEmpty();
                }
            }
            else if (state.editKind === ConnectorEditKind.Waypoint
                  || state.editKind === ConnectorEditKind.Segment)
            {
                editAdorner.EndDragOverEmpty();
            }
            editAdornerVisual?.InvalidateArrange();
        }

        args.ReleasePointerCapture();
        // Close the gesture's history transaction (opened in onHandleDown). We only
        // reach here when our gesture was active (guarded on activePointerId above).
        (diagram as unknown as { _endEdit?(): void })._endEdit?.();
        state.activeGesture   = undefined;
        state.activePointerId = undefined;
        state.editKind        = undefined;
        args.Handled = true;
    };

    // Drop any figure / connector hover and repaint the adorners that showed it.
    // Shared by pointer-leave and the input-mode gate (leaving Connectors mode
    // must clear lingering port dots / halos).
    const clearHover = (): void => {
        if (state.hoveredFigure !== undefined)
        {
            state.hoveredFigure = undefined;
            state.hoverSide     = undefined;
            syncHoverSubscription(undefined);
            sideAdornerVisual?.InvalidateArrange();
        }
        if (state.hoveredConnector !== undefined)
        {
            state.hoveredConnector = undefined;
            syncHoverConnectorSubscription(undefined);
            haloAdornerVisual?.InvalidateArrange();
            editAdornerVisual?.InvalidateArrange();   // hide the hover segment pads
        }
    };

    const onPointerLeave = (_raw: unknown): void => {
        if (state.activeGesture !== undefined) return;
        clearHover();
    };

    // Preview-phase delivery is non-negotiable: Figure.OnPointerDown /
    // Move / Up all set args.Handled = true, which short-circuits the
    // bubble walk before any Diagram-level routed listener runs. The
    // tunnel (preview) pass fires root → target with the same Handled
    // gate, so a Diagram-level preview handler reliably sees the event
    // BEFORE Figure consumes it. The Diagram exposes a framework-internal
    // slot for these handlers; we install on attach, withdraw on detach.
    diagram._setConnectorInteractionsHandlers({
        OnPreviewPointerDown: onPointerDown,
        OnPreviewPointerMove: onPointerMove,
        OnPreviewPointerUp:   onPointerUp,
        OnPointerLeave:       onPointerLeave,
    });

    return (): void => {
        diagram._setConnectorInteractionsHandlers(undefined);

        createBehavior.Abort();
        editAdorner.Abort();
        connectorsUnsub?.();
        connectorsUnsub = undefined;
        subscribedConnectors = undefined;
        syncHoverSubscription(undefined);
        syncHoverConnectorSubscription(undefined);

        if (sideAdornerVisual !== undefined) unmountAdorner(mountedPanel, sideAdornerVisual);
        if (editAdornerVisual !== undefined) unmountAdorner(mountedPanel, editAdornerVisual);
        if (haloAdornerVisual !== undefined) unmountAdorner(mountedPanel, haloAdornerVisual);
        sideAdornerVisual = undefined;
        editAdornerVisual = undefined;
        haloAdornerVisual = undefined;
        mountedPanel      = undefined;
    };
}

// Handler bundle the Diagram delegates its preview pointer virtuals to.
// Exported so connector-interactions-behavior and Diagram speak the
// same shape; the four method names match the framework's pointer
// virtual conventions for clarity at the dispatch site.
export interface ConnectorInteractionsHandlers
{
    OnPreviewPointerDown(args: unknown): void;
    OnPreviewPointerMove(args: unknown): void;
    OnPreviewPointerUp  (args: unknown): void;
    OnPointerLeave      (args: unknown): void;
}
