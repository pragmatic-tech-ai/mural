import {
    MetaData,
    MuralBase,
    Panel,
    Rect,
    Size,
    Element, Visual,
    type PointerEventArgs,
    type PropertyDescriptor,
} from '../../runtime/index.js';
import type { Border } from '../border.js';
import { Orientation } from '../panels/orientation.js';
import { TemplatedControl } from '../templated-control.js';



// Default bar thickness on the cross axis. Matches the size browsers
// reserve for native scrollbars in their "thin" variant.
const SCROLLBAR_THICKNESS = 10;
// Smallest practical thumb so a huge extent vs tiny viewport ratio
// still leaves a thumb you can actually grab.
const MIN_THUMB_LENGTH = 24;

// Internal Panel that hosts the track + thumb visual children and
// delegates their positioning back to the owning ScrollBar's metrics.
// Used as the template root so the compiled `.mu` template can return
// a single rooted subtree — the bar's actual layout logic still lives
// on ScrollBar where the DP-driven metrics are.
//
// `host` is a writable property so the panel can be instantiated by
// the template factory (which can't pass constructor args) and wired
// by ScrollBar after Apply. Defensive Measure / Arrange degrade to
// safe defaults when the back-reference is unset.
//
// Exported for the compiled-`.mu` ScrollBar template (not public API).
export class ScrollBarLayout extends Panel
{
    public host: ScrollBar | undefined;

    protected override MeasureOverride(availableSize: Size): Size
    {
        for (const c of this.visualChildren) c.Measure(availableSize);
        return this.host?.MeasureScrollBarSlot(availableSize) ?? Size.Zero;
    }

    protected override ArrangeOverride(finalSize: Size): Size
    {
        // Direct visualChildren are track (0) then thumb (1) — the
        // template asserts that order via the bodies' textual position.
        const children = this.visualChildren;
        const track = children[0];
        const thumb = children[1];
        if (track === undefined || thumb === undefined || this.host === undefined)
        {
            return finalSize;
        }
        this.host.ArrangeScrollBarParts(finalSize, track, thumb);
        return finalSize;
    }
}

// WPF-style range-control surface focused on scrollbar duty. Standalone
// (no event wiring to a parent scroller — the consumer subscribes to
// ValueChanged) so the same control serves both as ScrollViewer's
// default-template scrollbar AND as a general-purpose range slider for
// other contexts.
//
// DP semantics:
//   Minimum / Maximum — range of the underlying scrollable value.
//                       For a ScrollViewer this is (0, ScrollableHeight).
//   Value             — the current position. Clamped during Arrange
//                       so an off-range write is preserved literally
//                       (so a binding source sees what it wrote) and
//                       the painted thumb shows the clamped position.
//   ViewportSize      — proportion of the visible window. Drives the
//                       thumb's length: thumb / track = viewport / extent.
//                       Zero (the default) collapses the thumb to its
//                       minimum length — visible but uninformative.
//   Orientation       — Vertical (right-edge scrollbar) or Horizontal
//                       (bottom-edge scrollbar).
//
// Interaction:
//   * Click the thumb and drag — captures the pointer so the drag
//     survives leaving the bar's bounds.
//   * Click the track above / below the thumb — page-jump by one
//     ViewportSize step, the same as Page Up / Page Down on a native
//     scrollbar.
//
// Value clamping at Arrange time, not setter time, so a consumer can
// bind a VM property whose raw value drifts out of range without the
// scrollbar "fixing" it back. The painted thumb position uses the
// clamped value; reads on `.Value` return whatever was last written.
export class ScrollBar extends TemplatedControl
{
    public static readonly OrientationKey  = MuralBase.RegisterProperty<Orientation>(ScrollBar, 'Orientation',  Orientation.Vertical, MetaData.Measure | MetaData.Arrange);
    public static readonly MinimumKey      = MuralBase.RegisterProperty<number>(     ScrollBar, 'Minimum',      0, MetaData.Arrange);
    public static readonly MaximumKey      = MuralBase.RegisterProperty<number>(     ScrollBar, 'Maximum',      1, MetaData.Arrange);
    public static readonly ValueKey        = MuralBase.RegisterProperty<number>(     ScrollBar, 'Value',        0, MetaData.Arrange);
    public static readonly ViewportSizeKey = MuralBase.RegisterProperty<number>(     ScrollBar, 'ViewportSize', 0, MetaData.Arrange);
    // macOS / Slack-style auto-fade. When true, the track + thumb start
    // invisible and only become opaque on activity (scroll value change,
    // hover, drag). After ~1.5 s idle they fade back out. v1
    // implementation is a discrete show/hide — no smooth tween — but the
    // appear-on-activity / hide-on-idle behavior matches what users
    // expect from the platform convention.
    public static readonly IsAutoHideKey   = MuralBase.RegisterProperty<boolean>(    ScrollBar, 'IsAutoHide',   false, MetaData.None);
    // Read-only "thumb is being dragged" + "bar is in the auto-fade
    // resting state" DPs. Surfaced so the DefaultScrollBar template's
    // `when(IsDragging)` and `when(IsFaded)` triggers fire off the
    // same flags the drag / auto-hide handlers flip. Write-keys stay
    // private to the imperative state-machines; consumers see them
    // through the public boolean getters.
    private static readonly _IsDraggingPriv = MuralBase.RegisterReadOnlyProperty<boolean>(
        ScrollBar, 'IsDragging', false, MetaData.None,
    );
    public  static readonly IsDraggingKey   = ScrollBar._IsDraggingPriv;
    private static readonly _IsFadedPriv    = MuralBase.RegisterReadOnlyProperty<boolean>(
        ScrollBar, 'IsFaded',    false, MetaData.None,
    );
    public  static readonly IsFadedKey      = ScrollBar._IsFadedPriv;

    static
    {
        MuralBase.OverrideMetadata(ScrollBar, Element.DefaultStyleKeyKey, { default_value: ScrollBar });
    }

    // ── Template parts ──────────────────────────────────────────────
    private readonly _layout: ScrollBarLayout;
    private readonly _track:  Border;
    private readonly _thumb:  Border;

    // Drag state. dragOriginPx is the pointer's primary-axis coordinate
    // in HOST surface space at the moment the user grabbed the thumb;
    // dragOriginValue is .Value at that moment. PointerMove computes
    // the new value from a pure delta — no need for per-event
    // local-coord conversion.
    private _dragOriginPx    = 0;
    private _dragOriginValue = 0;

    // Auto-fade state. IsFaded is the visible truth (surfaced as a
    // read-only DP above so the default template can trigger on it);
    // `_idleTimer` schedules the transition back to IsFaded=true after
    // a ~1500 ms gap with no activity.
    private _idleTimer: ReturnType<typeof setTimeout> | undefined;
    private static readonly AUTO_HIDE_IDLE_MS = 1500;

    // Whether the owning scroll region currently reports pointer hover. While
    // true the auto-hide bar stays revealed (VSCode-style hover-to-show) even
    // with no scroll activity; when it clears, the idle timer fades the bar out.
    private _regionActive = false;

    // ValueChanged subscribers. Plain Set so duplicate add is a no-op
    // and remove is precise — same shape as the Closed listener API
    // on Drawer.
    private readonly _valueListeners: Set<(value: number) => void> = new Set();

    constructor()
    {
        super();
        // Markup-defined ScrollBarLayout panel with PART_Track behind
        // PART_Thumb, resolved from DefaultScrollBar in the controls
        // theme. The cosmetic palette (rest / track tints, corner
        // radius, zero border) lives in the template; hover and
        // pressed tints come from theme.ts because ScrollBar swaps
        // them at runtime via state listeners.
        // applyDefaultStyle resolves Style[TargetType=ScrollBar] from the
        // active theme dictionary → writes Template DP → TemplatedControl's
        // rebuildTemplate materialises @DefaultScrollBar and attaches root.
        this.applyDefaultStyle();
        this._layout = this.templateRoot as ScrollBarLayout;
        this._track  = this.GetTemplateChild('PART_Track') as Border;
        this._thumb  = this.GetTemplateChild('PART_Thumb') as Border;
        this._layout.host = this;
        // Hover state on the thumb pulses activity so auto-hide stays
        // visible while the pointer hangs on the bar. Thumb tint comes
        // declaratively from the DefaultScrollBar template's
        // `when(PART_Thumb.IsMouseOver)` trigger — no imperative brush
        // refresh.
        this._thumb.PropertyChanged(Element.IsMouseOverKey).subscribe(() => {
            if (this._thumb.IsMouseOver) this.pulseActivity();
        });
        // Auto-hide reaction to programmatic scroll. The Value DP
        // already fires `_valueListeners`; we tap the same hook to keep
        // the bar visible whenever its position is changing. Filter
        // for actual value transitions — the EffectiveValueDescriptor
        // fires OnPropertyChange unconditionally (including 0→0 stable
        // writes from ScrollViewer.ArrangeOverride on every layout
        // pass), and pulsing on those would re-show the bar every
        // frame regardless of real activity.
        this.PropertyChanged(ScrollBar.ValueKey).subscribe(({ oldValue, newValue }) => {
            if (oldValue !== newValue) this.pulseActivity();
        });

        // Lazy-evaluate the initial visibility state. When IsAutoHide
        // is false (the default) we stay opaque forever. When true,
        // start in the faded state and wait for activity.
        if (this.IsAutoHide) this.fadeOut();
        this.PropertyChanged(ScrollBar.IsAutoHideKey).subscribe(() => {
            if (this.IsAutoHide) this.fadeOut();
            else                 this.fadeIn();
        });
    }

    // Auto-hide activity pulse. Restores the brushes immediately, then
    // (re)starts the idle timer that will fade them back out after the
    // gap. Called on Value change, hover, and pointer-down so any user
    // interaction keeps the bar visible.
    private pulseActivity(): void
    {
        if (!this.IsAutoHide) return;
        this.fadeIn();
        if (this._idleTimer !== undefined) clearTimeout(this._idleTimer);
        const t = setTimeout(() => {
            this._idleTimer = undefined;
            // Hover keeps the bar visible even past the idle gap — either on
            // the thumb itself, mid-drag, or while the owning scroll region is
            // hovered (VSCode hover-to-show). Re-pulse; the pointer leaving
            // clears the flag and the next tick fades it out.
            if (this._thumb.IsMouseOver || this.IsDragging || this._regionActive)
            {
                this.pulseActivity();
                return;
            }
            this.fadeOut();
        }, ScrollBar.AUTO_HIDE_IDLE_MS);
        // Don't keep the Node test process alive for the 1.5 s tail.
        (t as unknown as { unref?: () => void }).unref?.();
        this._idleTimer = t;
    }

    /** The owning ScrollViewer reports whether the pointer is over the scroll
     *  region. While active the auto-hidden bar reveals and stays visible
     *  (VSCode hover-to-show); when it clears, the pending idle timer fades it
     *  out after the gap. No-op unless IsAutoHide. */
    public SetRegionActive(active: boolean): void
    {
        if (this._regionActive === active) return;
        this._regionActive = active;
        if (this.IsAutoHide && active) this.pulseActivity();
        // On deactivate the pending idle timer (always live after a pulse) sees
        // the cleared flag and fades the bar out — no explicit action needed.
    }

    private fadeIn(): void
    {
        if (!this.IsFaded) return;
        this.set_property_value_with_key(ScrollBar._IsFadedPriv, false);
    }

    private fadeOut(): void
    {
        if (this.IsFaded) return;
        this.set_property_value_with_key(ScrollBar._IsFadedPriv, true);
    }

    /** True while the thumb is being dragged. Read-only DP — flipped
     *  by the pointer-down / pointer-up path. Templates trigger on it
     *  to swap the thumb brush. */
    public get IsDragging(): boolean { return this.get_property_value(ScrollBar.IsDraggingKey); }
    private setIsDragging(v: boolean): void
    {
        this.set_property_value_with_key(ScrollBar._IsDraggingPriv, v);
    }
    /** True while the bar is in the auto-hide resting state (track +
     *  thumb invisible). Read-only DP flipped by fadeIn / fadeOut.
     *  Templates trigger on it (typically `Opacity = 0`) to hide the
     *  bar without losing hit-test geometry. */
    public get IsFaded(): boolean { return this.get_property_value(ScrollBar.IsFadedKey); }

    public get Orientation(): Orientation { return this.get_property_value(ScrollBar.OrientationKey); }
    public set Orientation(v: Orientation) { this.set_property_value(ScrollBar.OrientationKey, v); }

    public get Minimum(): number { return this.get_property_value(ScrollBar.MinimumKey); }
    public set Minimum(v: number) { this.set_property_value(ScrollBar.MinimumKey, v); }

    public get Maximum(): number { return this.get_property_value(ScrollBar.MaximumKey); }
    public set Maximum(v: number) { this.set_property_value(ScrollBar.MaximumKey, v); }

    public get Value(): number { return this.get_property_value(ScrollBar.ValueKey); }
    public set Value(v: number) { this.set_property_value(ScrollBar.ValueKey, v); }

    public get ViewportSize(): number { return this.get_property_value(ScrollBar.ViewportSizeKey); }
    public set ViewportSize(v: number) { this.set_property_value(ScrollBar.ViewportSizeKey, v); }

    public get IsAutoHide(): boolean { return this.get_property_value(ScrollBar.IsAutoHideKey); }
    public set IsAutoHide(v: boolean) { this.set_property_value(ScrollBar.IsAutoHideKey, v); }

    // ── Public events ──────────────────────────────────────────────
    public AddValueChangedListener(listener: (value: number) => void): void
    {
        this._valueListeners.add(listener);
    }

    public RemoveValueChangedListener(listener: (value: number) => void): void
    {
        this._valueListeners.delete(listener);
    }

    // Read-only handles to the default-template parts. The parts now
    // live one level deeper than they used to (under the layout panel
    // that the compiled template introduces as the single template
    // root); the getters keep the public access stable so callers
    // don't index `visualChildren` manually.
    public get Track(): Border { return this._track; }
    public get Thumb(): Border { return this._thumb; }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue: unknown,
        newValue: unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (descriptor.Name === 'Value')
        {
            // Fire AFTER super so the value is committed before listeners
            // observe it (matches how AddPropertyChangedListener on DPs
            // observes values).
            for (const l of this._valueListeners) l(newValue as number);
        }
        // metricsFor() reads Minimum / Maximum / Value / ViewportSize +
        // Orientation. When any of those change, the inner ScrollBarLayout
        // panel needs to re-run its ArrangeOverride so ArrangeScrollBarParts
        // recomputes the thumb's offset / length. Without this push the
        // bar's own _isArrangeValid clears (its DP has MetaData.Arrange)
        // but the layout panel's arrange stays cached against the same
        // outer rect, the thumb stays at its old position, and dragging
        // / wheel / programmatic offset changes "do nothing visible".
        if (descriptor.Name === 'Value'       || descriptor.Name === 'Minimum'
         || descriptor.Name === 'Maximum'     || descriptor.Name === 'ViewportSize'
         || descriptor.Name === 'Orientation')
        {
            this._layout.InvalidateArrange();
        }
    }

    // ── Layout ──────────────────────────────────────────────────────
    //
    // DesiredSize is just the bar's cross-axis thickness; the long
    // axis stretches into whatever the parent gives. The actual
    // measure / arrange of track + thumb happens inside
    // ScrollBarLayout (the template root), which calls back into
    // MeasureScrollBarSlot / ArrangeScrollBarParts so the metrics
    // logic stays here. MeasureOverride / ArrangeOverride themselves
    // are inherited from TemplatedControl — they delegate to
    // templateRoot which is the ScrollBarLayout.

    // Called by ScrollBarLayout.MeasureOverride — reports the desired
    // cross-axis thickness (SCROLLBAR_THICKNESS) and the available
    // long-axis size as the layout panel's DesiredSize.
    public MeasureScrollBarSlot(availableSize: Size): Size
    {
        if (this.Orientation === Orientation.Vertical)
        {
            const h = Number.isFinite(availableSize.Height) ? availableSize.Height : 0;
            return new Size(SCROLLBAR_THICKNESS, h);
        }
        const w = Number.isFinite(availableSize.Width) ? availableSize.Width : 0;
        return new Size(w, SCROLLBAR_THICKNESS);
    }

    // Called by ScrollBarLayout.ArrangeOverride — positions the track
    // edge-to-edge and the thumb at the metrics-derived offset and
    // length along the primary axis.
    public ArrangeScrollBarParts(finalSize: Size, track: Visual, thumb: Visual): void
    {
        track.Arrange(new Rect(0, 0, finalSize.Width, finalSize.Height));
        const m = this.metricsFor(finalSize);
        if (this.Orientation === Orientation.Vertical)
        {
            thumb.Arrange(new Rect(0, m.thumbOffset, finalSize.Width, m.thumbLength));
        }
        else
        {
            thumb.Arrange(new Rect(m.thumbOffset, 0, m.thumbLength, finalSize.Height));
        }
    }

    // RenderOverride inherited from TemplatedControl (no-op).

    // ── Pointer behaviour ──────────────────────────────────────────
    protected override OnPointerDown(args: PointerEventArgs): void
    {
        // Any pointer interaction pulses activity so the bar stays
        // visible while the user is touching it (and for the idle
        // window after).
        this.pulseActivity();
        if (args.Source === this._thumb)
        {
            this.setIsDragging(true);
            this._dragOriginPx    = this.primary(args.HostX, args.HostY);
            this._dragOriginValue = this.clampedValue();
            // Capture the pointer so drag survives leaving the bar.
            args.CapturePointer(this);
            args.Handled = true;
            return;
        }
        if (args.Source === this._track)
        {
            // Page jump in whichever direction the click is from the
            // thumb. Negative when above / left, positive when below /
            // right; ViewportSize controls the jump magnitude.
            const m = this.metricsFor(this.ArrangedRect.Size);
            const localPx = this.primary(args.HostX, args.HostY) - this.primaryOrigin();
            const direction = localPx < m.thumbOffset ? -1 : 1;
            this.setClampedValue(this.clampedValue() + direction * Math.max(1, this.ViewportSize));
            args.Handled = true;
        }
    }

    protected override OnPointerMove(args: PointerEventArgs): void
    {
        if (!this.IsDragging) return;
        const m = this.metricsFor(this.ArrangedRect.Size);
        const travel = m.trackLength - m.thumbLength;
        if (travel <= 0) return;
        const range = Math.max(0, this.Maximum - this.Minimum);
        if (range <= 0) return;

        const deltaPx    = this.primary(args.HostX, args.HostY) - this._dragOriginPx;
        const deltaValue = (deltaPx / travel) * range;
        this.setClampedValue(this._dragOriginValue + deltaValue);
        args.Handled = true;
    }

    protected override OnPointerUp(args: PointerEventArgs): void
    {
        if (!this.IsDragging) return;
        this.setIsDragging(false);
        args.ReleasePointerCapture();
        args.Handled = true;
    }

    // ── Internals ──────────────────────────────────────────────────

    // Geometry resolved on every Arrange (and on every pointer event
    // — cheap enough to recompute). All distances are along the bar's
    // primary axis: vertical = height, horizontal = width.
    private metricsFor(size: Size): { trackLength: number; thumbLength: number; thumbOffset: number }
    {
        const trackLength = Math.max(0, this.Orientation === Orientation.Vertical
            ? size.Height : size.Width);

        // Track is hidden — collapse everything so a downstream Arrange
        // doesn't paint into negative space (clamp with min > max
        // returns min, which can put the thumb LONGER than the track
        // — visually broken and confusing for hit-testing).
        if (trackLength === 0)
        {
            return { trackLength: 0, thumbLength: 0, thumbOffset: 0 };
        }

        const range  = Math.max(0, this.Maximum - this.Minimum);
        const visible = Math.max(0, this.ViewportSize);

        // Floor the minimum thumb at trackLength so a tiny track still
        // gets a thumb that FITS, never one that overhangs.
        const minThumb = Math.min(MIN_THUMB_LENGTH, trackLength);

        let thumbLength: number;
        if (range <= 0 || visible >= range + visible)
        {
            // No scroll possible — thumb fills the track.
            thumbLength = trackLength;
        }
        else
        {
            const ratio = visible / (range + visible);
            thumbLength = clamp(trackLength * ratio, minThumb, trackLength);
        }

        const travel = trackLength - thumbLength;
        const valuePos = range > 0
            ? ((this.clampedValue() - this.Minimum) / range) * travel
            : 0;
        return { trackLength, thumbLength, thumbOffset: valuePos };
    }

    // Pick the primary-axis coord from a 2D pair, based on Orientation.
    private primary(x: number, y: number): number
    {
        return this.Orientation === Orientation.Vertical ? y : x;
    }

    // Absolute primary-axis origin of this ScrollBar on the host surface.
    // Walks the visual ancestor chain summing ArrangedRect, the same
    // pattern ComboBox's overlay-position helper uses.
    private primaryOrigin(): number
    {
        let v: Visual | undefined = this;
        let p = 0;
        while (v !== undefined)
        {
            p += this.Orientation === Orientation.Vertical
                ? v.ArrangedRect.Y
                : v.ArrangedRect.X;
            v = v.GetVisualParent();
        }
        return p;
    }

    private clampedValue(): number
    {
        return clamp(this.Value, this.Minimum, this.Maximum);
    }

    private setClampedValue(v: number): void
    {
        const next = clamp(v, this.Minimum, this.Maximum);
        if (next === this.Value) return;
        this.Value = next;
    }

}

function clamp(value: number, min: number, max: number): number
{
    return Math.max(min, Math.min(max, value));
}
