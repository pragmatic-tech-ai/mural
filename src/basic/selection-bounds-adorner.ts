// SelectionBoundsAdorner — framework-level promotion of the diagram
// demo's selection-resize-adorner.mjs (§19.4 follow-up). Decouples the
// resize chrome from any specific VM shape via the SelectionSource
// interface; exposes Stroke / Fill / HandleSize as DPs so consumers
// can theme by overriding the adorner's Style.
//
// Hosting contract (matches demo-local original):
//   * AdornedElement is the items panel of the host (typically a
//     PaginatedCanvas or a plain Canvas) — the adorner's local frame
//     equals canvas-local coords, so child positions go straight in
//     the same space items use for Canvas.Left / Top.
//   * Adorner pad IsHitTestVisible=false. Handle pads override back to
//     hit-test-visible so only the 8 small squares catch pointer
//     events; clicks on the bbox interior pass through.
//
// The 8 handles + their anchor semantics are baked into a fixed
// table (HANDLE_SPEC) — corner / edge mapping is invariant geometry,
// not a customisation point. Consumers theme COLORS, not LAYOUT.

import {
    Adorner,
    AdornerLayer,
    MetaData,
    MuralBase,
    Point,
    Rect,
    Size,
    Visual,
    Color,
} from '../runtime/index.js';
import { Border } from './border.js';
import { Brush, Pen, SolidColorBrush } from '../visual-engine/index.js';
import type { PointerEventArgs } from '../visual-engine/routed-event.js';

// ── Anchor enums ────────────────────────────────────────────────

// Which side of the bbox stays pinned during a resize. NW/SE drags
// keep the OPPOSITE corner anchored. Edge handles zero one axis.
export enum HorizontalAnchor
{
    Left  = 'left',
    Right = 'right',
    None  = 'none',
}
export enum VerticalAnchor
{
    Top    = 'top',
    Bottom = 'bottom',
    None   = 'none',
}

// ── SelectionSource interface ───────────────────────────────────

// What the adorner needs from its consumer. Domain state lives on
// the consumer (e.g., which items are selected, the per-item
// transforms applied); the adorner only reads aggregate bounds and
// forwards resize deltas back. The interface is a structural type,
// not a class — any object exposing the surface satisfies it.
//
// `subscribe` returns an unsubscribe thunk; the adorner calls it on
// Dispose. Every bounds change MUST fire the listener so the adorner
// can InvalidateArrange and reposition the bbox + handles.
export interface SelectionSource
{
    readonly Count:  number;
    readonly Bounds: Rect;

    subscribe(listener: () => void): () => void;

    beginResize(): void;
    applyResize(dw: number, dh: number,
                xAnchor: HorizontalAnchor,
                yAnchor: VerticalAnchor): void;
    endResize(): void;

    // §19.4 — optional animated variant. When the adorner's
    // Animated DP is true AND the source implements this method,
    // resize deltas route here instead of plain applyResize. The
    // source is expected to drive its DP writes via Storyboards so
    // per-entity Width / Height / X / Y transitions tween smoothly
    // over the gesture. Default plain-applyResize falls through
    // when undefined.
    applyResizeAnimated?(dw: number, dh: number,
                         xAnchor: HorizontalAnchor,
                         yAnchor: VerticalAnchor): void;
}

// ── Adorner ─────────────────────────────────────────────────────

const HIDE_OFFSCREEN = -10000;

const DEFAULT_STROKE = new SolidColorBrush(Color.FromHex('#1976d2'));
const DEFAULT_FILL   = new SolidColorBrush(Color.FromHex('#ffffff'));
const DEFAULT_HANDLE_SIZE = 8;

interface HandleSpec
{
    name:    'NW' | 'N' | 'NE' | 'W' | 'E' | 'SW' | 'S' | 'SE';
    dwDir:   -1 | 0 | 1;
    dhDir:   -1 | 0 | 1;
    xAnchor: HorizontalAnchor;
    yAnchor: VerticalAnchor;
    cursor:  string;
    anchorPoint: (x: number, y: number, w: number, h: number) => [number, number];
}

const HANDLE_SPEC: readonly HandleSpec[] = [
    { name: 'NW', dwDir: -1, dhDir: -1, xAnchor: HorizontalAnchor.Right,  yAnchor: VerticalAnchor.Bottom, cursor: 'nwse-resize', anchorPoint: (x, y, _w, _h) => [x,       y      ] },
    { name: 'N',  dwDir:  0, dhDir: -1, xAnchor: HorizontalAnchor.None,   yAnchor: VerticalAnchor.Bottom, cursor: 'ns-resize',   anchorPoint: (x, y, w,  _h) => [x + w/2, y      ] },
    { name: 'NE', dwDir:  1, dhDir: -1, xAnchor: HorizontalAnchor.Left,   yAnchor: VerticalAnchor.Bottom, cursor: 'nesw-resize', anchorPoint: (x, y, w,  _h) => [x + w,   y      ] },
    { name: 'W',  dwDir: -1, dhDir:  0, xAnchor: HorizontalAnchor.Right,  yAnchor: VerticalAnchor.None,   cursor: 'ew-resize',   anchorPoint: (x, y, _w, h ) => [x,       y + h/2] },
    { name: 'E',  dwDir:  1, dhDir:  0, xAnchor: HorizontalAnchor.Left,   yAnchor: VerticalAnchor.None,   cursor: 'ew-resize',   anchorPoint: (x, y, w,  h ) => [x + w,   y + h/2] },
    { name: 'SW', dwDir: -1, dhDir:  1, xAnchor: HorizontalAnchor.Right,  yAnchor: VerticalAnchor.Top,    cursor: 'nesw-resize', anchorPoint: (x, y, _w, h ) => [x,       y + h  ] },
    { name: 'S',  dwDir:  0, dhDir:  1, xAnchor: HorizontalAnchor.None,   yAnchor: VerticalAnchor.Top,    cursor: 'ns-resize',   anchorPoint: (x, y, w,  h ) => [x + w/2, y + h  ] },
    { name: 'SE', dwDir:  1, dhDir:  1, xAnchor: HorizontalAnchor.Left,   yAnchor: VerticalAnchor.Top,    cursor: 'nwse-resize', anchorPoint: (x, y, w,  h ) => [x + w,   y + h  ] },
];

export class SelectionBoundsAdorner extends Adorner
{
    // ── Themable DPs ────────────────────────────────────────────
    // ChromeStroke/Fill rather than plain Stroke/Fill — Visual already
    // ships a Stroke DP for its own painting; collision-free names keep
    // the inherited Stroke usable for whatever the host needs.
    public static readonly ChromeStrokeKey = MuralBase.RegisterProperty<Brush>( SelectionBoundsAdorner, 'ChromeStroke', DEFAULT_STROKE, MetaData.Render);
    public static readonly ChromeFillKey   = MuralBase.RegisterProperty<Brush>( SelectionBoundsAdorner, 'ChromeFill',   DEFAULT_FILL,   MetaData.Render);
    public static readonly HandleSizeKey   = MuralBase.RegisterProperty<number>(SelectionBoundsAdorner, 'HandleSize',   DEFAULT_HANDLE_SIZE, MetaData.Render);

    // §19.4 follow-up — Animated hint. When true AND the consumer's
    // SelectionSource implements `applyResizeAnimated`, the adorner
    // routes resize deltas through that callback instead of plain
    // `applyResize`. The animated variant is expected to drive its
    // own DP writes via Storyboards so per-entity Width / Height /
    // X / Y transitions tween smoothly. When the source doesn't
    // implement the variant, this DP is a no-op (direct writes
    // through plain applyResize). MetaData.None — the DP carries
    // intent, not paint state.
    public static readonly AnimatedKey     = MuralBase.RegisterProperty<boolean>(SelectionBoundsAdorner, 'Animated',     false, MetaData.None);

    public get ChromeStroke():  Brush  { return this.get_property_value(SelectionBoundsAdorner.ChromeStrokeKey); }
    public set ChromeStroke(v:  Brush) { this.set_property_value(SelectionBoundsAdorner.ChromeStrokeKey, v); }
    public get ChromeFill():    Brush  { return this.get_property_value(SelectionBoundsAdorner.ChromeFillKey); }
    public set ChromeFill(v:    Brush) { this.set_property_value(SelectionBoundsAdorner.ChromeFillKey, v); }
    public get HandleSize():    number { return this.get_property_value(SelectionBoundsAdorner.HandleSizeKey); }
    public set HandleSize(v:    number) { this.set_property_value(SelectionBoundsAdorner.HandleSizeKey, v); }
    public get Animated():      boolean { return this.get_property_value(SelectionBoundsAdorner.AnimatedKey); }
    public set Animated(v:      boolean) { this.set_property_value(SelectionBoundsAdorner.AnimatedKey, v); }

    // ── Internal state ──────────────────────────────────────────
    private readonly _source: SelectionSource;
    private readonly _bbox:   Border;
    private readonly _handles: Array<{ spec: HandleSpec; visual: Border }> = [];
    private _unsubscribe: (() => void) | undefined;
    private _dragSpec:    HandleSpec | undefined = undefined;
    private _pressHostX = 0;
    private _pressHostY = 0;

    constructor(adornedElement: Visual, source: SelectionSource)
    {
        super(adornedElement);
        this._source = source;

        this.IsHitTestVisible = false;

        this._bbox = new Border();
        this._bbox.Stroke           = new Pen(this.ChromeStroke, 1);
        this._bbox.IsHitTestVisible = false;
        this.AttachVisual(this._bbox);

        for (const spec of HANDLE_SPEC)
        {
            const v = new Border();
            v.Fill       = this.ChromeFill;
            v.Stroke           = new Pen(this.ChromeStroke, 1);
            v.Width            = this.HandleSize;
            v.Height           = this.HandleSize;
            v.Cursor           = spec.cursor;
            this.AttachVisual(v);
            this._handles.push({ spec, visual: v });
            this._wireHandle(v, spec);
        }

        this._unsubscribe = source.subscribe(() => this.InvalidateArrange());
    }

    public override get visualChildren(): Visual[]
    {
        return [this._bbox, ...this._handles.map(h => h.visual)];
    }

    public override MeasureOverride(_available: Size): Size
    {
        const big = new Size(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
        this._bbox.Measure(big);
        for (const h of this._handles) h.visual.Measure(big);
        return Size.Zero;
    }

    public override ArrangeOverride(finalSize: Size): Size
    {
        // The selection bounds are in the adorned element's (content) space; map
        // them into this adorner's own local frame so the chrome tracks an
        // ancestor camera transform (e.g. the diagram's PART_Camera
        // LayoutTransform scale). Identity when unscaled — the box + handles then
        // sit at the raw bounds exactly as before.
        const b    = this._mapBounds(this._source.Bounds);
        const hide = this._source.Count === 0;
        const hSize = this.HandleSize;
        const half  = hSize / 2;
        if (hide)
        {
            this._bbox.Arrange(new Rect(0, 0, 0, 0));
            for (const h of this._handles)
            {
                h.visual.Arrange(new Rect(HIDE_OFFSCREEN, HIDE_OFFSCREEN, hSize, hSize));
            }
            return finalSize;
        }
        this._bbox.Arrange(b);
        for (const h of this._handles)
        {
            // Sync the handle's Width/Height with the current HandleSize
            // DP so a runtime HandleSize change resizes the visuals as
            // well as their arranged rects. Width / Height feed
            // MeasureOverride; without the sync, a 14 px HandleSize would
            // arrange the rect at 14 px but measure 8 (the ctor value).
            if (h.visual.Width  !== hSize) h.visual.Width  = hSize;
            if (h.visual.Height !== hSize) h.visual.Height = hSize;
            const [ax, ay] = h.spec.anchorPoint(b.X, b.Y, b.Width, b.Height);
            h.visual.Arrange(new Rect(ax - half, ay - half, hSize, hSize));
        }
        return finalSize;
    }

    // Map a content-space rect into this adorner's own local frame via the
    // adorned->layer matrix the AdornerLayer hands us. Under a pure camera scale
    // this scales position + size (the box hugs the zoomed node); the axis-
    // aligned bounding box of the four mapped corners keeps the chrome
    // axis-aligned. Identity matrix → the rect passes through unchanged.
    private _mapBounds(b: Rect): Rect
    {
        const m = this.AdornedToLayerMatrix;
        if (m.IsIdentity) return b;
        const c0 = m.Transform(new Point(b.X,           b.Y));
        const c1 = m.Transform(new Point(b.X + b.Width, b.Y));
        const c2 = m.Transform(new Point(b.X,           b.Y + b.Height));
        const c3 = m.Transform(new Point(b.X + b.Width, b.Y + b.Height));
        const minX = Math.min(c0.X, c1.X, c2.X, c3.X);
        const minY = Math.min(c0.Y, c1.Y, c2.Y, c3.Y);
        const maxX = Math.max(c0.X, c1.X, c2.X, c3.X);
        const maxY = Math.max(c0.Y, c1.Y, c2.Y, c3.Y);
        return new Rect(minX, minY, maxX - minX, maxY - minY);
    }

    // Screen-space handle-drag deltas (host px) -> content-space resize deltas,
    // dividing out the camera scale the adorned element sits under (read off the
    // adorned->layer matrix). Guards a zero/degenerate scale to 1 so a resize
    // never divides by zero. Identity matrix (zoom 1) leaves the deltas as-is.
    private _screenToContentDelta(dxScreen: number, dyScreen: number): { dx: number; dy: number }
    {
        const m = this.AdornedToLayerMatrix;
        const sx = m.M11 !== 0 ? m.M11 : 1;
        const sy = m.M22 !== 0 ? m.M22 : 1;
        return { dx: dxScreen / sx, dy: dyScreen / sy };
    }

    private _wireHandle(visual: Border, spec: HandleSpec): void
    {
        visual.AddRoutedEventListener('PointerDown', ((args: PointerEventArgs) => {
            this._source.beginResize();
            this._dragSpec   = spec;
            this._pressHostX = args.HostX;
            this._pressHostY = args.HostY;
            args.CapturePointer(visual, spec.cursor);
            args.Handled = true;
        }) as (a: unknown) => void);
        visual.AddRoutedEventListener('PointerMove', ((args: PointerEventArgs) => {
            if (this._dragSpec !== spec) return;
            // Handle drags arrive in host (screen) px; divide out the camera
            // scale the adorned element sits under so the resize tracks the
            // cursor 1:1 on screen at any zoom (identity/zoom-1 → unchanged).
            const { dx, dy } = this._screenToContentDelta(
                args.HostX - this._pressHostX, args.HostY - this._pressHostY);
            const dw = spec.dwDir * dx;
            const dh = spec.dhDir * dy;
            // §19.4 — route through the animated variant when the
            // adorner's Animated flag is on AND the source
            // implements it. Falls back to plain applyResize.
            if (this.Animated && this._source.applyResizeAnimated !== undefined)
            {
                this._source.applyResizeAnimated(dw, dh, spec.xAnchor, spec.yAnchor);
            }
            else
            {
                this._source.applyResize(dw, dh, spec.xAnchor, spec.yAnchor);
            }
            args.Handled = true;
        }) as (a: unknown) => void);
        visual.AddRoutedEventListener('PointerUp', ((args: PointerEventArgs) => {
            if (this._dragSpec !== spec) return;
            this._dragSpec = undefined;
            this._source.endResize();
            args.ReleasePointerCapture();
            args.Handled = true;
        }) as (a: unknown) => void);
    }

    public dispose(): void
    {
        this._unsubscribe?.();
        this._unsubscribe = undefined;
    }

    // Helper: mount this adorner into the AdornerLayer that contains
    // the adornedElement. Returns a detach thunk symmetric with the
    // behavior contract. Saves consumers from typing the
    // layer-lookup + Add/Remove + Dispose dance themselves.
    public static Attach(adornedElement: Visual, source: SelectionSource):
        { adorner: SelectionBoundsAdorner; detach: () => void } | undefined
    {
        const layer = AdornerLayer.GetAdornerLayer(adornedElement);
        if (layer === undefined) return undefined;
        const a = new SelectionBoundsAdorner(adornedElement, source);
        layer.Add(a);
        return {
            adorner: a,
            detach: () => {
                layer.Remove(a);
                a.dispose();
            },
        };
    }
}
