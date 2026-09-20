import {
    CommandBase,
    MetaData,
    MuralBase,
    Panel,
    Visibility,
    Visual,
    type ICommand,
    type PointerEventArgs,
} from '../../runtime/index.js';
import { Rect, Size } from '../../visual-engine/primitives.js';
import { CommandManager } from '../commands/command-manager.js';
import { Tooltip } from './tooltip.js';

// Placement of a Tooltip relative to its anchor. The service picks one
// of these per show, then applies flip-on-edge if the resulting rect
// would sit outside the host surface.
//
// String values mirror the enum-member names so `.mu` parsers can write
// `[ToolTipService.ToolTipPlacement=Right]` literally.
export enum PlacementMode
{
    // Below the anchor, horizontally centered. M3 / WPF default.
    Bottom = 'Bottom',
    // Above the anchor, horizontally centered.
    Top    = 'Top',
    // Left of the anchor, vertically centered.
    Left   = 'Left',
    // Right of the anchor, vertically centered.
    Right  = 'Right',
    // Overlaps the anchor's center — for status badges where the tooltip
    // sits on the anchor itself.
    Center = 'Center',
    // Trails the pointer's last known position with a small gap.
    Mouse  = 'Mouse',
}

// Pixel gap between the anchor and the tooltip's edge for the cardinal
// placements. M3 spec is 4dp — we use 8 here so the elevation shadow
// reads without the tooltip touching the anchor's chrome.
const ANCHOR_GAP = 8;
// Trailing offset from the pointer for PlacementMode.Mouse.
const POINTER_OFFSET_X = 12;
const POINTER_OFFSET_Y = 18;

// Sum a Visual's ArrangedRect chain up to the surface root. Returns the
// visual's absolute position in target-surface coordinates. Mirrors the
// helper inside combo-box.ts — promoted to the service when a second
// caller appears.
function absoluteOrigin(v: Visual): { x: number; y: number }
{
    let x = 0, y = 0;
    let cur: Visual | undefined = v;
    while (cur !== undefined)
    {
        x += cur.ArrangedRect.X;
        y += cur.ArrangedRect.Y;
        cur = cur.GetVisualParent();
    }
    return { x, y };
}

// Panel that gets mounted on the OverlayLayer and positions a single
// Tooltip child against an anchor's absolute frame. The OverlayLayer
// gives every child a slot at (0, 0, surfaceW, surfaceH) — the host
// arranges the tooltip inside that slot per its placement.
//
// External writes are simple public fields (anchor / placement /
// pointer) so the service can re-target the pooled host without going
// through DP plumbing for one-shot transient state.
export class TooltipPopupHost extends Panel
{
    public anchor:    Visual        | undefined;
    public placement: PlacementMode = PlacementMode.Bottom;
    // Last pointer position recorded by ToolTipService when Placement=Mouse.
    public pointerX:  number = 0;
    public pointerY:  number = 0;

    constructor()
    {
        super();
        // The host is a positioning container — it ARRANGES the tooltip
        // anywhere within the overlay surface, but its own hit pad must
        // NOT capture clicks. The host sits on the OverlayLayer on top
        // of everything; a hit-testable full-surface pad would swallow
        // every click that lands outside the tooltip child, including
        // clicks on the very anchor whose PointerDown is supposed to
        // dismiss the tooltip. Visibility=Collapsed (set by `dismiss`)
        // gates rendering separately, so even a stale-but-hidden host
        // can't snatch input from underneath.
        this.IsHitTestVisible = false;
    }

    protected override MeasureOverride(availableSize: Size): Size
    {
        for (const c of this.visualChildren) c.Measure(availableSize);
        const w = Number.isFinite(availableSize.Width)  ? availableSize.Width  : 0;
        const h = Number.isFinite(availableSize.Height) ? availableSize.Height : 0;
        return new Size(w, h);
    }

    protected override ArrangeOverride(finalSize: Size): Size
    {
        const child = this.visualChildren[0];
        if (child === undefined || this.anchor === undefined) return finalSize;

        const desired = child.DesiredSize;
        const w = desired.Width;
        const h = desired.Height;

        const origin = absoluteOrigin(this.anchor);
        const aRect  = this.anchor.ArrangedRect;
        let { x, y } = pickPlacement(this.placement,
            origin.x, origin.y, aRect.Width, aRect.Height,
            w, h, this.pointerX, this.pointerY);

        // Flip-on-edge — if the chosen rect would spill past the surface
        // ALONG THE PLACEMENT'S OWN AXIS, swap to the opposite cardinal
        // placement. The flip must be axis-aware: a Bottom/Top tooltip only
        // flips on VERTICAL overflow, a Left/Right one only on HORIZONTAL.
        // Otherwise a wide tooltip on a small anchor (its centered x spills
        // sideways) would wrongly flip the vertical axis and — for a top-edge
        // toolbar button — send y negative too, so the final clamp pinned it
        // to (0,0). Cross-axis spill is handled by the clamp below.
        if (overflowsPrimaryAxis(this.placement, x, y, w, h, finalSize))
        {
            const flipped = pickPlacement(flip(this.placement),
                origin.x, origin.y, aRect.Width, aRect.Height,
                w, h, this.pointerX, this.pointerY);
            x = flipped.x;
            y = flipped.y;
        }

        // Final clamp — the flipped placement could still spill on
        // off-axis edges (e.g., a wide tooltip below a left-edge anchor
        // overflows the right edge even after vertical flip).
        if (x + w > finalSize.Width)  x = Math.max(0, finalSize.Width  - w);
        if (y + h > finalSize.Height) y = Math.max(0, finalSize.Height - h);
        if (x < 0) x = 0;
        if (y < 0) y = 0;

        child.Arrange(new Rect(x, y, w, h));
        return finalSize;
    }
}

function pickPlacement(
    mode:     PlacementMode,
    ax: number, ay: number, aW: number, aH: number,
    w: number, h: number,
    px: number, py: number,
): { x: number; y: number }
{
    switch (mode)
    {
        case PlacementMode.Bottom: return { x: ax + (aW - w) / 2, y: ay + aH + ANCHOR_GAP };
        case PlacementMode.Top:    return { x: ax + (aW - w) / 2, y: ay - h  - ANCHOR_GAP };
        case PlacementMode.Left:   return { x: ax - w - ANCHOR_GAP, y: ay + (aH - h) / 2 };
        case PlacementMode.Right:  return { x: ax + aW + ANCHOR_GAP, y: ay + (aH - h) / 2 };
        case PlacementMode.Center: return { x: ax + (aW - w) / 2,   y: ay + (aH - h) / 2 };
        case PlacementMode.Mouse:  return { x: px + POINTER_OFFSET_X, y: py + POINTER_OFFSET_Y };
    }
}

// Does the placed rect spill past the surface ALONG the placement's own
// axis — the only overflow a flip can meaningfully correct? For Bottom/Top
// that's the vertical axis; for Left/Right the horizontal one. Center/Mouse
// have no cardinal axis, so any spill counts (they fall back to Bottom on
// flip). Cross-axis spill is left to the caller's clamp.
function overflowsPrimaryAxis(
    mode: PlacementMode,
    x: number, y: number, w: number, h: number,
    size: Size,
): boolean
{
    switch (mode)
    {
        case PlacementMode.Bottom:
        case PlacementMode.Top:
            return y < 0 || y + h > size.Height;
        case PlacementMode.Left:
        case PlacementMode.Right:
            return x < 0 || x + w > size.Width;
        case PlacementMode.Center:
        case PlacementMode.Mouse:
            return x < 0 || x + w > size.Width || y < 0 || y + h > size.Height;
    }
}

function flip(mode: PlacementMode): PlacementMode
{
    switch (mode)
    {
        case PlacementMode.Bottom: return PlacementMode.Top;
        case PlacementMode.Top:    return PlacementMode.Bottom;
        case PlacementMode.Left:   return PlacementMode.Right;
        case PlacementMode.Right:  return PlacementMode.Left;
        // Center / Mouse don't have a meaningful flip — fall back to Bottom.
        case PlacementMode.Center:
        case PlacementMode.Mouse:  return PlacementMode.Bottom;
    }
}

// Per-anchor bookkeeping. The service uses this to track which visuals
// have an active ToolTip DP, so it can detach listeners when the DP is
// cleared (or when the visual is detached from the tree).
interface AnchorState
{
    onEnter: (a: PointerEventArgs) => void;
    onLeave: (a: PointerEventArgs) => void;
    onMove:  (a: PointerEventArgs) => void;
    onDown:  (a: PointerEventArgs) => void;
}

// M3 spec values (override per anchor via the attached DPs):
//   * Initial show delay   — 500ms
//   * Show duration         — 5s (matches WPF default; M3 leaves it open)
//   * Between-show window   — 1500ms (within this window after a dismiss,
//                                     the next show is instant — feels
//                                     responsive when sweeping a toolbar).
const DEFAULT_INITIAL_DELAY     =  500;
const DEFAULT_SHOW_DURATION     = 5000;
const BETWEEN_SHOW_WINDOW       = 1500;

// Side-effect channel for ToolTipKey writes. CoerceValue fires on every
// set (including binding pushes), so it's the one hook that catches both
// declarative `[ToolTipService.ToolTip="..."]` markup and runtime binding
// updates. The value is returned unchanged — this is purely a "give the
// service a chance to wire/unwire listeners" path.
function coerceToolTip(model: MuralBase, value: unknown): unknown
{
    if (model instanceof Visual)
    {
        ToolTipService.onToolTipChanged(model, value);
    }
    return value;
}

// Static-only service. WPF parity — `ToolTipService.ToolTip="..."` on
// any element wires up hover + focus to a shared overlay-mounted Tooltip.
// One pooled `Tooltip` + one pooled `TooltipPopupHost` are recycled
// across every anchor, so a 50-button toolbar costs the same as a
// single button.
//
// Limitation: the service relies on the attached DP's `coerce_value`
// hook to learn about writes (mural has no PropertyChangedCallback on
// PropertyMetadata yet). That hook is otherwise meant for value
// normalisation; here we use it as a side-effect channel — the returned
// value is the input verbatim. If you read the DP, you get exactly what
// the consumer wrote.
export class ToolTipService
{
    // The tooltip content. `unknown` because consumers pass:
    //   * string  → ContentPresenter wraps it in a TextBlock.
    //   * MuralBase VM → ContentPresenter resolves a matching DataTemplate.
    //   * Visual  → slotted directly.
    // undefined means "no tooltip on this anchor". Default undefined.
    public static readonly ToolTipKey = MuralBase.RegisterAttachedProperty<unknown>(
        ToolTipService, 'ToolTip', undefined, MetaData.None, coerceToolTip);

    // Where the tooltip sits relative to the anchor. Default Bottom
    // (M3 / WPF default).
    public static readonly ToolTipPlacementKey = MuralBase.RegisterAttachedProperty<PlacementMode>(
        ToolTipService, 'ToolTipPlacement', PlacementMode.Bottom, MetaData.None);

    // Per-anchor override of the 500ms initial show delay. Useful for
    // touch-style "instant" tooltips (set to 0) or for inline help that
    // should appear less aggressively (1000+).
    public static readonly InitialShowDelayKey = MuralBase.RegisterAttachedProperty<number>(
        ToolTipService, 'InitialShowDelay', DEFAULT_INITIAL_DELAY, MetaData.None);

    // Per-anchor override of the 5s auto-hide duration. Set to a large
    // number (or Infinity) to keep the tooltip visible until the user
    // moves away.
    public static readonly ShowDurationKey = MuralBase.RegisterAttachedProperty<number>(
        ToolTipService, 'ShowDuration', DEFAULT_SHOW_DURATION, MetaData.None);

    public static GetToolTip         (v: Visual): unknown        { return v.get_property_value(ToolTipService.ToolTipKey); }
    public static SetToolTip         (v: Visual, value: unknown): void { v.set_property_value(ToolTipService.ToolTipKey, value); }
    public static GetToolTipPlacement(v: Visual): PlacementMode  { return v.get_property_value(ToolTipService.ToolTipPlacementKey); }
    public static SetToolTipPlacement(v: Visual, mode: PlacementMode): void { v.set_property_value(ToolTipService.ToolTipPlacementKey, mode); }
    public static GetInitialShowDelay(v: Visual): number         { return v.get_property_value(ToolTipService.InitialShowDelayKey); }
    public static SetInitialShowDelay(v: Visual, ms: number): void { v.set_property_value(ToolTipService.InitialShowDelayKey, ms); }
    public static GetShowDuration    (v: Visual): number         { return v.get_property_value(ToolTipService.ShowDurationKey); }
    public static SetShowDuration    (v: Visual, ms: number): void { v.set_property_value(ToolTipService.ShowDurationKey, ms); }

    // ── Singletons + state ─────────────────────────────────────────
    private static _tooltip: Tooltip            | undefined;
    private static _host:    TooltipPopupHost   | undefined;
    private static _anchors: Map<Visual, AnchorState> = new Map();
    private static _currentAnchor: Visual | undefined;
    private static _showTimer:  ReturnType<typeof setTimeout> | undefined;
    private static _hideTimer:  ReturnType<typeof setTimeout> | undefined;
    private static _lastDismissAt = 0;

    // ── Entry from coerceToolTip ───────────────────────────────────
    public static onToolTipChanged(anchor: Visual, newValue: unknown): void
    {
        const hadEntry = ToolTipService._anchors.has(anchor);
        const willHave = newValue !== undefined;

        if (willHave && !hadEntry)
        {
            ToolTipService.attach(anchor);
        }
        else if (!willHave && hadEntry)
        {
            ToolTipService.detach(anchor);
        }

        // If the value changed while the tooltip is currently showing
        // for THIS anchor, push the new content through AND refresh the
        // shortcut row — a different command may be bound to a different
        // key.
        if (willHave
            && ToolTipService._currentAnchor === anchor
            && ToolTipService._tooltip !== undefined)
        {
            ToolTipService._tooltip.Content  = newValue as never;
            ToolTipService._tooltip.Shortcut = ToolTipService.resolveShortcut(anchor, newValue);
        }
    }

    private static attach(anchor: Visual): void
    {
        const state: AnchorState = {
            onEnter: (a) => ToolTipService.handleEnter(anchor, a),
            onLeave: (_) => ToolTipService.handleLeave(anchor),
            onMove:  (a) => ToolTipService.handleMove(anchor, a),
            onDown:  (_) => ToolTipService.dismiss(),
        };
        anchor.AddRoutedEventListener('PointerEnter', state.onEnter as (a: unknown) => void);
        anchor.AddRoutedEventListener('PointerLeave', state.onLeave as (a: unknown) => void);
        anchor.AddRoutedEventListener('PointerMove',  state.onMove  as (a: unknown) => void);
        anchor.AddRoutedEventListener('PointerDown',  state.onDown  as (a: unknown) => void);
        ToolTipService._anchors.set(anchor, state);
    }

    private static detach(anchor: Visual): void
    {
        const state = ToolTipService._anchors.get(anchor);
        if (state === undefined) return;
        anchor.RemoveRoutedEventListener('PointerEnter', state.onEnter as (a: unknown) => void);
        anchor.RemoveRoutedEventListener('PointerLeave', state.onLeave as (a: unknown) => void);
        anchor.RemoveRoutedEventListener('PointerMove',  state.onMove  as (a: unknown) => void);
        anchor.RemoveRoutedEventListener('PointerDown',  state.onDown  as (a: unknown) => void);
        ToolTipService._anchors.delete(anchor);
        // If the dismissed anchor was the active one, tear down its UI.
        if (ToolTipService._currentAnchor === anchor) ToolTipService.dismiss();
    }

    private static handleEnter(anchor: Visual, args: PointerEventArgs): void
    {
        // Snapshot the pointer position for PlacementMode.Mouse.
        ToolTipService.snapshotPointer(args);
        if (ToolTipService._showTimer !== undefined)
        {
            clearTimeout(ToolTipService._showTimer);
        }
        const since = Date.now() - ToolTipService._lastDismissAt;
        const initial = ToolTipService.GetInitialShowDelay(anchor);
        const delay = since < BETWEEN_SHOW_WINDOW ? 0 : initial;
        ToolTipService._showTimer = setTimeout(() => {
            ToolTipService._showTimer = undefined;
            ToolTipService.show(anchor);
        }, delay);
    }

    private static handleLeave(anchor: Visual): void
    {
        if (ToolTipService._showTimer !== undefined)
        {
            clearTimeout(ToolTipService._showTimer);
            ToolTipService._showTimer = undefined;
        }
        if (ToolTipService._currentAnchor === anchor)
        {
            ToolTipService.dismiss();
        }
    }

    private static handleMove(_anchor: Visual, args: PointerEventArgs): void
    {
        // Keep the pointer snapshot fresh for a possible Placement=Mouse
        // show that hasn't fired yet, AND reposition an already-open
        // Placement=Mouse tooltip so it trails the cursor.
        ToolTipService.snapshotPointer(args);
        if (ToolTipService._host !== undefined
            && ToolTipService._currentAnchor !== undefined
            && ToolTipService.GetToolTipPlacement(ToolTipService._currentAnchor) === PlacementMode.Mouse)
        {
            ToolTipService._host.pointerX = ToolTipService._host.pointerX;
            ToolTipService._host.InvalidateArrange();
        }
    }

    private static snapshotPointer(args: PointerEventArgs): void
    {
        const host = ToolTipService._host;
        if (host === undefined) return;
        // PointerEventArgs carries host-frame coords (HostX/HostY) — same
        // space the overlay layer arranges in.
        const ax = (args as unknown as { HostX?: number }).HostX;
        const ay = (args as unknown as { HostY?: number }).HostY;
        if (typeof ax === 'number') host.pointerX = ax;
        if (typeof ay === 'number') host.pointerY = ay;
    }

    private static show(anchor: Visual): void
    {
        if (ToolTipService._currentAnchor === anchor) return;
        // Tear down any prior show before re-arming.
        if (ToolTipService._currentAnchor !== undefined) ToolTipService.dismiss();

        const content = ToolTipService.GetToolTip(anchor);
        if (content === undefined) return;

        const tooltip = ToolTipService.acquireTooltip();
        const host    = ToolTipService.acquireHost();

        tooltip.Content     = content as never;
        // Shortcut row — when the content is a CommandBase, look up the
        // gesture bound to it in the anchor's tree. Otherwise clear so a
        // prior CommandBase show doesn't leak a shortcut row into a
        // plain-string show that comes after it.
        tooltip.Shortcut    = ToolTipService.resolveShortcut(anchor, content);
        tooltip.Visibility  = Visibility.Visible;
        host.anchor         = anchor;
        host.placement      = ToolTipService.GetToolTipPlacement(anchor);

        try
        {
            anchor.AttachOverlayChild(host);
        }
        catch (_e)
        {
            // Anchor isn't mounted on a target yet — silently skip the
            // show. Common case: pre-attach binding evaluation. Next
            // hover after the anchor mounts will succeed.
            return;
        }
        ToolTipService._currentAnchor = anchor;

        // Auto-hide timer.
        const duration = ToolTipService.GetShowDuration(anchor);
        if (Number.isFinite(duration) && duration > 0)
        {
            ToolTipService._hideTimer = setTimeout(
                () => ToolTipService.dismiss(),
                duration);
        }
    }

    public static dismiss(): void
    {
        if (ToolTipService._hideTimer !== undefined)
        {
            clearTimeout(ToolTipService._hideTimer);
            ToolTipService._hideTimer = undefined;
        }
        const anchor = ToolTipService._currentAnchor;
        const host   = ToolTipService._host;
        if (anchor !== undefined && host !== undefined)
        {
            try { anchor.DetachOverlayChild(host); }
            catch (_e) { /* anchor torn down */ }
        }
        if (ToolTipService._tooltip !== undefined)
        {
            ToolTipService._tooltip.Visibility = Visibility.Collapsed;
        }
        ToolTipService._currentAnchor = undefined;
        ToolTipService._lastDismissAt  = Date.now();
    }

    // If the tooltip content is a CommandBase, look up the shortcut
    // currently bound to it via the anchor's visual tree. The lookup is
    // the framework's general-purpose helper — it walks instance then
    // class InputBindings up the ancestor chain and returns the first
    // KeyBinding's DisplayString. Returns empty when no binding exists
    // or when the content isn't a command at all.
    private static resolveShortcut(anchor: Visual, content: unknown): string
    {
        if (!(content instanceof CommandBase)) return '';
        const text = CommandManager.FindShortcutForCommand(content as ICommand, anchor);
        return text ?? '';
    }

    private static acquireTooltip(): Tooltip
    {
        if (ToolTipService._tooltip === undefined)
        {
            ToolTipService._tooltip = new Tooltip();
        }
        return ToolTipService._tooltip;
    }

    private static acquireHost(): TooltipPopupHost
    {
        if (ToolTipService._host === undefined)
        {
            const host = new TooltipPopupHost();
            host.AddChild(ToolTipService.acquireTooltip());
            ToolTipService._host = host;
        }
        return ToolTipService._host;
    }
}
