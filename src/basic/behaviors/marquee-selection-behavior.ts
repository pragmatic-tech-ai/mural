import {
    Adorner,
    AdornerLayer,
    Color,
    Rect,
    Size,
    Visual,
    type DrawingContext,
    type PointerEventArgs,
    hasModifier,
    ModifierKeys,
} from '../../runtime/index.js';
import { Pen, SolidColorBrush } from '../../visual-engine/index.js';
import { MarqueeBoundsPolicy, SelectionMode, Selector } from '../../framework/list/selector.js';

// MarqueeSelectionBehavior — Windows Explorer-style rubber-band
// multi-select for any Selector that opts in via
// `AllowMarqueeSelection`. Attaches when the DP flips true; detaches
// when it flips false (or on demand via the returned detach thunk).
//
// Gesture:
//   * PointerDown on the panel background (not on a container)
//     starts a tracking session — initial state, modifier mode, and
//     pointer capture get snapshotted.
//   * The first PointerMove past a small drag threshold realizes the
//     adorner and starts updating the selection live as the rect grows.
//   * PointerUp:
//       — if the drag passed the threshold (marquee was shown),
//         commits the final selection and removes the adorner.
//       — if no drag (plain click on empty space) AND mode is
//         Replace (no Ctrl/Shift), clears the selection. Mirrors
//         Explorer: clicking the empty area of a list deselects all.
//         Ctrl/Shift-click on empty space is a no-op (Explorer parity).
//   * Esc cancels the drag, restoring the snapshot selection.
//
// Modifier modes (Windows Explorer parity):
//   * Plain drag       — Replace: the rect's contents become the new
//                          selection; everything else clears.
//   * Ctrl+drag        — Add: the rect's contents are added to whatever
//                          was selected at PointerDown.
//   * Shift+drag       — Extend from anchor: rect contents are added to
//                          the SelectedItems snapshot taken at
//                          PointerDown (subtly different from Add only
//                          when the snapshot itself was a range — both
//                          land on additive overlay).
//
// Bounds policy:
//   * Intersect (default) — item is included if its arranged rect
//                            overlaps the marquee at all (Explorer).
//   * Contained           — item must be FULLY INSIDE the marquee
//                            (Finder).

// Fallback brushes used only when no theme has registered @MarqueeFill
// / @MarqueeStroke tokens. The active theme's scheme provides these
// (see material/light.mu, dark.mu); the adorner reads them via
// TryFindResource at render time so theme swaps re-paint live.
const FALLBACK_FILL   = new SolidColorBrush(Color.FromHex('#3699cc33'));
const FALLBACK_STROKE = new SolidColorBrush(Color.FromHex('#3699cc'));
const FALLBACK_PEN: Pen = (() => {
    const p = new Pen();
    p.Brush     = FALLBACK_STROKE;
    p.Thickness = 1;
    return p;
})();

// Threshold pixels the pointer must move from PointerDown before the
// adorner appears and selection begins updating. Below the threshold,
// the gesture is treated as a click — the marquee never shows.
const DRAG_THRESHOLD_PX = 4;

class MarqueeAdorner extends Adorner
{
    private _rect: Rect = new Rect(0, 0, 0, 0);

    constructor(adorned: Visual)
    {
        super(adorned);
        this.IsHitTestVisible = false;
    }

    public SetRect(r: Rect): void
    {
        if (this._rect.X === r.X && this._rect.Y === r.Y
            && this._rect.Width === r.Width && this._rect.Height === r.Height) return;
        this._rect = r;
        this.InvalidateArrange();
        this.GetVisualParent()?.InvalidateArrange();
    }

    public override Placement(_adorned: Rect, _desired: Size): Rect
    {
        return this._rect;
    }

    protected override MeasureOverride(_a: Size): Size { return Size.Zero; }

    protected override RenderOverride(dc: DrawingContext): void
    {
        const s = this.RenderSize;
        if (s.Width <= 0 || s.Height <= 0) return;
        // Theme-driven brushes — resolve via the resource chain so a
        // SetTheme() swap re-paints on next render. Falls back to the
        // built-in cyan when no theme has registered the tokens (e.g.
        // bare tests).
        const fill = (this.TryFindResource('MarqueeFill')   as SolidColorBrush | undefined) ?? FALLBACK_FILL;
        const strokeBrush = this.TryFindResource('MarqueeStroke') as SolidColorBrush | undefined;
        const pen = strokeBrush !== undefined ? buildPen(strokeBrush) : FALLBACK_PEN;
        dc.DrawRectangle(fill, pen, new Rect(0, 0, s.Width, s.Height));
    }
}

// One Pen instance per stroke brush identity, cached so repeated
// renders don't allocate. Keyed by Brush identity — when SetTheme
// swaps the underlying brush, the next render builds a fresh Pen.
const _penCache = new WeakMap<SolidColorBrush, Pen>();
function buildPen(brush: SolidColorBrush): Pen
{
    let p = _penCache.get(brush);
    if (p === undefined)
    {
        p = new Pen();
        p.Brush     = brush;
        p.Thickness = 1;
        _penCache.set(brush, p);
    }
    return p;
}

// Sum ArrangedRect.X / .Y from `v` up to but not including `stop` —
// the canonical layer-frame walk (matches list-reorder-behavior's
// helper). When `stop` is undefined, walks to the host root.
function originIn(v: Visual, stop: Visual | undefined): { x: number; y: number }
{
    let x = 0, y = 0;
    let cur: Visual | undefined = v;
    while (cur !== undefined && cur !== stop)
    {
        x += cur.ArrangedRect.X;
        y += cur.ArrangedRect.Y;
        cur = cur.GetVisualParent();
    }
    return { x, y };
}

// Item's arranged rect translated into `frame`'s coordinate space.
// Used to test marquee ∩ container in a shared coord system.
function rectInFrame(v: Visual, frame: Visual): Rect
{
    const o = originIn(v, frame);
    return new Rect(o.x, o.y, v.ArrangedRect.Width, v.ArrangedRect.Height);
}

function rectsIntersect(a: Rect, b: Rect): boolean
{
    return !(a.X + a.Width  <= b.X
          || b.X + b.Width  <= a.X
          || a.Y + a.Height <= b.Y
          || b.Y + b.Height <= a.Y);
}

function rectContains(outer: Rect, inner: Rect): boolean
{
    return inner.X >= outer.X
        && inner.Y >= outer.Y
        && inner.X + inner.Width  <= outer.X + outer.Width
        && inner.Y + inner.Height <= outer.Y + outer.Height;
}

// Walk up from `selector` looking for the nearest ScrollViewer
// ancestor. Used by § 10.7 marquee autoscroll. Structural-typing on
// `EvaluateEdgeAutoScroll` keeps this file from importing
// scroll-viewer.ts (which would cycle through items-control → control →
// basic). Returns undefined when the Selector isn't hosted inside a
// ScrollViewer (e.g., the Selector is the root content of a
// ScrollViewer-less HeadlessTarget).
type EdgeAutoScrollHost = {
    EvaluateEdgeAutoScroll(hostX: number, hostY: number): void;
    StopEdgeAutoScroll(): void;
};
function findScrollViewerAncestor(start: Visual): EdgeAutoScrollHost | undefined
{
    let cursor: Visual | undefined = start.GetVisualParent();
    while (cursor !== undefined)
    {
        const candidate = cursor as unknown as Partial<EdgeAutoScrollHost>;
        if (typeof candidate.EvaluateEdgeAutoScroll === 'function'
            && typeof candidate.StopEdgeAutoScroll === 'function')
        {
            return candidate as EdgeAutoScrollHost;
        }
        cursor = cursor.GetVisualParent();
    }
    return undefined;
}

// Walk up from `source` toward `selector`. If we hit any
// `selector.containerOrderForRange` member first, the click is ON a
// container and the behavior leaves it to the normal click pipeline.
// `containerOrderForRange` is the right seam: it returns ListBoxItems
// for ListBox (direct children) and the recursive walk of TreeViewItems
// for TreeView (so any click inside an item's subtree counts as an
// item click).
function isContainerClick(source: Visual, selector: Selector): boolean
{
    const containers = new Set((selector as unknown as {
        containerOrderForRange(): readonly Visual[];
    }).containerOrderForRange());
    let cur: Visual | undefined = source;
    while (cur !== undefined && cur !== selector)
    {
        if (containers.has(cur)) return true;
        cur = cur.GetVisualParent();
    }
    return false;
}

// Compute the selection set the marquee should produce given current
// rect, modifier mode, and the snapshot taken at PointerDown. Returns
// an array of containers in their `containerOrderForRange` order so
// callers can feed it back into the Selector via setSelectedContainers.
enum MarqueeMode
{
    Replace = 'replace',
    Add     = 'add',
    Extend  = 'extend',
}

function computeMarqueeSelection(
    selector: Selector,
    marquee:  Rect,
    snapshot: ReadonlySet<Visual>,
    mode:     MarqueeMode,
    policy:   MarqueeBoundsPolicy,
    panel:    Visual,
): Visual[]
{
    const order = (selector as unknown as {
        containerOrderForRange(): readonly Visual[];
    }).containerOrderForRange();
    const hit = new Set<Visual>();
    for (const c of order)
    {
        const r = rectInFrame(c, panel);
        const included = policy === MarqueeBoundsPolicy.Contained
            ? rectContains(marquee, r)
            : rectsIntersect(marquee, r);
        if (included) hit.add(c);
    }
    const next = mode === MarqueeMode.Replace
        ? hit
        : new Set([...snapshot, ...hit]);
    // Preserve container order so the primary-row mirror picks the
    // first one visually rather than insertion-order quirks.
    return order.filter(c => next.has(c));
}

export function attachMarqueeSelection(selector: Selector): () => void
{
    // Per-session state. Reset on every PointerDown.
    let armed:    boolean = false;        // PointerDown happened on background
    let active:   boolean = false;        // drag past threshold — adorner visible
    let startHostX: number = 0;
    let startHostY: number = 0;
    let mode: MarqueeMode = MarqueeMode.Replace;
    let snapshot: Set<Visual> = new Set();
    let adorner: MarqueeAdorner | undefined;
    let layer:   AdornerLayer    | undefined;
    let panel:   Visual          | undefined;

    function panelOf(): Visual | undefined
    {
        const p = (selector as unknown as {
            ItemsPanelInstance: Visual | undefined;
        }).ItemsPanelInstance;
        return p;
    }

    function reset(): void
    {
        if (adorner !== undefined && layer !== undefined) layer.Remove(adorner);
        adorner = undefined;
        layer = undefined;
        panel = undefined;
        armed = false;
        active = false;
        snapshot = new Set();
    }

    function onDown(args: PointerEventArgs): void
    {
        // Marquee only makes sense in multi-select modes. Single-mode
        // Selectors leave AllowMarqueeSelection wired but ignore drags.
        const sm = selector.SelectionMode;
        if (sm === SelectionMode.Single) return;
        if (isContainerClick(args.Source, selector)) return;

        panel = panelOf();
        if (panel === undefined) return;

        startHostX = args.HostX;
        startHostY = args.HostY;
        mode = hasModifier(args.Modifiers, ModifierKeys.Control) ? MarqueeMode.Add
             : hasModifier(args.Modifiers, ModifierKeys.Shift)   ? MarqueeMode.Extend
             : MarqueeMode.Replace;
        // Snapshot the current selection — used by add / extend mode to
        // overlay the rect's contents. Replace mode discards it and
        // (when the drag commits OR the click misses) clears.
        snapshot = new Set((selector as unknown as {
            _selectedContainers: Set<Visual>;
        })._selectedContainers);

        armed = true;
        active = false;
        // Capture so PointerMove / Up reach us even when the cursor
        // leaves the panel. Capture goes to the Selector — the routed
        // listener bound here is on the Selector too.
        args.CapturePointer(selector);
        args.Handled = true;
    }

    function onMove(args: PointerEventArgs): void
    {
        if (!armed || panel === undefined) return;
        const dx = args.HostX - startHostX;
        const dy = args.HostY - startHostY;
        if (!active)
        {
            // Stay quiet under the drag threshold so a stray pixel of
            // jitter doesn't flicker into a marquee. Once we exceed it,
            // realize the adorner and (for replace mode) commit the
            // initial clear so existing selection clears even if the
            // user pauses on a 1-pixel rect.
            if (Math.abs(dx) < DRAG_THRESHOLD_PX
                && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
            active = true;
            const lookupRoot = panel;
            layer = AdornerLayer.GetAdornerLayer(lookupRoot);
            if (layer !== undefined)
            {
                adorner = new MarqueeAdorner(panel);
                layer.Add(adorner);
            }
            if (mode === MarqueeMode.Replace)
            {
                // Clear without firing per-row events — BeginUpdate
                // coalesces. The intermediate clear is invisible to
                // listeners; only the final committed selection fires.
                selector.BeginUpdate();
                selector.ClearSelection();
                selector.EndUpdate();
            }
        }

        // Two rects, two coordinate frames:
        //
        //   * PANEL-LOCAL — fed to computeMarqueeSelection, which
        //     compares against each container's rectInFrame(c, panel).
        //     Always the panel's local frame, independent of where
        //     the adorner lives.
        //
        //   * LAYER-LOCAL — fed to adorner.SetRect; the Adorner's
        //     Placement returns this rect in the adorner-layer's
        //     local frame, and the renderer paints there.
        //
        // The two frames coincide when the layer is an inner SCP
        // AdornerLayer arranged at the same rect as the content
        // (word-toolbox / ListBox path). They differ when the layer
        // is a platform-root AdornerDecorator (Board has no SCP,
        // so the layer resolves to the platform root; layer-host-
        // origin = (0, 0), panel-host-origin = wherever the Board
        // sits inside its parent chain). Without this split the
        // marquee draws at (cursorHost - panelHost) instead of
        // (cursorHost - layerHost) and the rect appears offset by
        // -panelOriginInHost.
        const panelOrigin = originIn(panel, undefined);
        const layerOrigin = layer !== undefined
            ? originIn(layer, undefined)
            : panelOrigin;
        const hostMinX = Math.min(startHostX, args.HostX);
        const hostMinY = Math.min(startHostY, args.HostY);
        const w = Math.abs(args.HostX - startHostX);
        const h = Math.abs(args.HostY - startHostY);

        // PANEL-LOCAL hit-test rect. When the Selector exposes a host->content
        // mapping (the Board, whose PART_Camera carries a LayoutTransform
        // zoom), route both endpoints through it so the rect lands in the same
        // content space as each container's rectInFrame(c, panel) — at ANY
        // zoom/pan. originIn() only sums ArrangedRect (a pure translation) and
        // can't see the camera scale, so the plain path is off by the zoom
        // factor once zoom != 1. Mirrors figure.ts / canvas-drop-behavior's use
        // of Board.HostToContent. Non-board Selectors (ListBox, TreeView —
        // no scale in the chain) have no HostToContent and keep the plain path,
        // where content space == panel-local up to the originIn translation.
        const coord = selector as unknown as {
            HostToContent?(x: number, y: number): { X: number; Y: number };
        };
        let panelRect: Rect;
        if (typeof coord.HostToContent === 'function')
        {
            const cs = coord.HostToContent(startHostX, startHostY);
            const ce = coord.HostToContent(args.HostX, args.HostY);
            panelRect = new Rect(
                Math.min(cs.X, ce.X), Math.min(cs.Y, ce.Y),
                Math.abs(ce.X - cs.X), Math.abs(ce.Y - cs.Y));
        }
        else
        {
            panelRect = new Rect(hostMinX - panelOrigin.x, hostMinY - panelOrigin.y, w, h);
        }
        // LAYER-LOCAL adorner rect stays in host/layer space (the AdornerLayer
        // sits OUTSIDE PART_Camera), so it keeps drawing at the cursor 1:1.
        const layerRect = new Rect(hostMinX - layerOrigin.x, hostMinY - layerOrigin.y, w, h);
        adorner?.SetRect(layerRect);

        // Recompute and apply the selection. BeginUpdate / EndUpdate
        // coalesce the per-row IsSelected flips into a single
        // SelectionChanged fire — important when the rect crosses
        // dozens of rows in one move sample.
        const nextSelection = computeMarqueeSelection(
            selector, panelRect, snapshot, mode,
            selector.MarqueeBoundsPolicy, panel);
        const sel = selector as unknown as {
            setSelectedContainers(items: readonly Visual[]): void;
            refreshExposedSelection(): void;
            fireSelectionChanged(): void;
        };
        selector.BeginUpdate();
        sel.setSelectedContainers(nextSelection);
        sel.refreshExposedSelection();
        sel.fireSelectionChanged();
        selector.EndUpdate();

        // § 10.7 — autoscroll while the marquee drags past the wrapping
        // ScrollViewer's edges. Walk up to the first ScrollViewer
        // ancestor and ask it to evaluate edge-gutter velocity from the
        // current cursor; the ScrollViewer's own AutoScrollGutter +
        // AutoScrollStep DPs drive how aggressively the viewport pulls
        // along. Same hook the drag-drop autoscroll uses (§ 8.4), so
        // the two gestures share one tick loop and feel identical.
        const sv = findScrollViewerAncestor(selector);
        sv?.EvaluateEdgeAutoScroll(args.HostX, args.HostY);

        args.Handled = true;
    }

    function onUp(args: PointerEventArgs): void
    {
        if (!armed) return;
        const wasActive = active;
        const wasReplace = mode === MarqueeMode.Replace;
        args.ReleasePointerCapture();
        // Stop any autoscroll left running on the wrapping ScrollViewer
        // (§ 10.7). Safe to call when no autoscroll was active.
        findScrollViewerAncestor(selector)?.StopEdgeAutoScroll();
        reset();
        if (wasActive)
        {
            args.Handled = true;
            return;
        }
        // Click-on-empty-space without drag. Replace-mode (no modifier)
        // clears the selection; Ctrl/Shift clicks leave selection
        // untouched (matches Explorer). ClearSelection internally
        // handles refreshExposedSelection + SelectionChanged; the
        // Begin/EndUpdate just coalesces with anything else racing.
        if (!wasReplace) return;
        selector.BeginUpdate();
        selector.ClearSelection();
        selector.EndUpdate();
        args.Handled = true;
    }

    selector.AddRoutedEventListener('PointerDown', onDown as (a: unknown) => void);
    selector.AddRoutedEventListener('PointerMove', onMove as (a: unknown) => void);
    selector.AddRoutedEventListener('PointerUp',   onUp   as (a: unknown) => void);

    return function detach(): void
    {
        selector.RemoveRoutedEventListener('PointerDown', onDown as (a: unknown) => void);
        selector.RemoveRoutedEventListener('PointerMove', onMove as (a: unknown) => void);
        selector.RemoveRoutedEventListener('PointerUp',   onUp   as (a: unknown) => void);
        reset();
    };
}
