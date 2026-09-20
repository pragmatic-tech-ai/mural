import {
    MetaData,
    MuralBase,
    Panel,
    Rect,
    Size,
    Element, Visual,
    type KeyEventArgs,
    Key,
    type PointerEventArgs,
    type PropertyDescriptor,
} from '../runtime/index.js';
import type { Border } from './border.js';
import { Orientation } from './panels/orientation.js';
import { TemplatedControl } from './templated-control.js';

// Resource-dictionary key — matches the `x:key` literal in
// controls.template.mu's DefaultSlider entry.


// Cross-axis thickness pinned by the Slider's MeasureOverride — same
// pattern ScrollBar uses to declare its own thickness. The thumb sits
// across the full cross-axis; the track and thumb both report the
// same cross-axis size so the slider's overall cross-axis stays 16.
//
// Phase 8.6 — M3 2024 Sliders redesign:
//   * TRACK_THICKNESS grew 4 → 16. Modern M3 sliders draw the track at
//     the same height as the cross-axis affordance, with no inset
//     "skinny track inside a chunky thumb area" visual.
//   * THUMB_PRIMARY 16 → 4. The thumb is now a narrow vertical pill
//     along the drag axis (4dp wide for horizontal sliders). The 4dp
//     wide affordance reads as a precision indicator rather than a
//     drag-grip.
//   * THUMB_CROSS stays 16 — matches TRACK_THICKNESS so the pill spans
//     the full cross-axis of the slider. Combined with @ShapeFull
//     CornerRadius on the thumb in the default template, the visible
//     shape is a vertically-rounded narrow pill, the M3 2024 look.
const THUMB_PRIMARY   = 4;
const THUMB_CROSS     = 16;
const TRACK_THICKNESS = 16;

// Internal Panel hosting track + fill + thumb. The Slider owns the
// metrics (Min, Max, Value → thumb offset) and delegates measure /
// arrange of the three children to ArrangeSliderParts so the DP-driven
// math stays on the Slider itself, not split into the template root.
// Same shape as ScrollBarLayout.
//
// Exported so the bundled `controls.template.mu` can name it; not part
// of the public Controls API.
export class SliderLayout extends Panel
{
    public host: Slider | undefined;

    protected override MeasureOverride(availableSize: Size): Size
    {
        for (const c of this.visualChildren) c.Measure(availableSize);
        return this.host?.MeasureSliderSlot(availableSize) ?? Size.Zero;
    }

    protected override ArrangeOverride(finalSize: Size): Size
    {
        const children = this.visualChildren;
        const track = children[0];
        const fill  = children[1];
        const thumb = children[2];
        if (track === undefined || fill === undefined || thumb === undefined
            || this.host === undefined)
        {
            return finalSize;
        }
        this.host.ArrangeSliderParts(finalSize, track, fill, thumb);
        return finalSize;
    }
}

// Single-thumb range control — WPF Slider analog. The thumb spans the
// cross axis (THUMB_SIZE on both axes by default) and slides along the
// primary axis; the filled portion of the track tints the "[Min, Value]"
// segment so the user reads the position at a glance.
//
// DP semantics:
//   Orientation   — Horizontal (Min on left, Max on right) or Vertical
//                   (Min on bottom, Max on top — WPF convention).
//   Minimum       — lower bound of the range. Reads / writes preserve
//                   the raw value; clamping happens at Arrange time.
//   Maximum       — upper bound.
//   Value         — current position. Out-of-range writes are preserved
//                   on the DP but the painted thumb clamps to the bounds.
//   SmallChange   — increment for ArrowLeft / ArrowRight / ArrowUp /
//                   ArrowDown (default 0.01 of the default 0..1 range).
//   LargeChange   — increment for PageUp / PageDown (default 0.1).
//
// Pointer behaviour:
//   * Press on the thumb + drag → pan the thumb along the primary axis.
//     The drag is anchored at the press point so the thumb doesn't jump
//     under the cursor mid-drag.
//   * Press on the track at any other point → jump the thumb to that
//     point (modern UI default; WPF's track-click LargeChange step is
//     intentionally omitted — for that, use keyboard PageUp/PageDown).
//     The press then immediately initiates a drag so the same gesture
//     supports a "tap-then-drag" pattern.
//
// Keyboard:
//   * ArrowLeft / ArrowDown — Value -= SmallChange.
//   * ArrowRight / ArrowUp  — Value += SmallChange.
//   * PageDown              — Value -= LargeChange.
//   * PageUp                — Value += LargeChange.
//   * Home                  — Value  = Minimum.
//   * End                   — Value  = Maximum.
//   Direction handling: arrows map "lower" → -, "higher" → + on both
//   orientations, matching WPF's default (IsDirectionReversed=false).
//   Vertical-Min-at-bottom means visually "down arrow" = lower value,
//   which is what users expect on a vertical slider.
export class Slider extends TemplatedControl
{
    public static readonly OrientationKey = MuralBase.RegisterProperty<Orientation>(Slider, 'Orientation', Orientation.Horizontal, MetaData.Measure | MetaData.Arrange);
    public static readonly MinimumKey     = MuralBase.RegisterProperty<number>(     Slider, 'Minimum',     0,    MetaData.Arrange);
    public static readonly MaximumKey     = MuralBase.RegisterProperty<number>(     Slider, 'Maximum',     1,    MetaData.Arrange);
    public static readonly ValueKey       = MuralBase.RegisterProperty<number>(     Slider, 'Value',       0,    MetaData.Arrange | MetaData.BindsTwoWayByDefault);
    public static readonly SmallChangeKey = MuralBase.RegisterProperty<number>(     Slider, 'SmallChange', 0.01, MetaData.None);
    public static readonly LargeChangeKey = MuralBase.RegisterProperty<number>(     Slider, 'LargeChange', 0.1,  MetaData.None);
    // Read-only "thumb is being dragged" state, surfaced as a DP so
    // the default template's `when(IsDragging) { PART_Thumb.Fill
    // = @PrimaryPress; }` trigger fires off the same flag the drag
    // handler flips. Internal write-key keeps the setter private to
    // the drag path; consumers see it through the public boolean getter.
    private static readonly _IsDraggingPriv = MuralBase.RegisterReadOnlyProperty<boolean>(
        Slider, 'IsDragging', false, MetaData.None,
    );
    public  static readonly IsDraggingKey  = Slider._IsDraggingPriv;

    static
    {
        MuralBase.OverrideMetadata(Slider, Element.DefaultStyleKeyKey, { default_value: Slider });
    }

    // ── Template parts ─────────────────────────────────────────────
    private readonly _layout: SliderLayout;
    private readonly _track:  Border;
    private readonly _fill:   Border;
    private readonly _thumb:  Border;

    // Drag state. dragOriginPx is the pointer's primary-axis coordinate
    // in HOST surface space at the moment the user grabbed the thumb;
    // dragOriginValue is .Value at that moment. PointerMove computes
    // the new value from a pure delta so dragging never makes the thumb
    // teleport.
    private _dragOriginPx    = 0;
    private _dragOriginValue = 0;

    // ValueChanged subscribers — plain Set so duplicate add is a no-op.
    // Matches ScrollBar's listener surface.
    private readonly _valueListeners = new Set<(value: number) => void>();

    constructor()
    {
        super();
        // Slider takes focus on PointerDown so keyboard nudges land
        // somewhere obvious to the user (otherwise nothing visible
        // happens when they tab to it).
        this.Focusable = true;

        // applyDefaultStyle resolves Style[TargetType=Slider] from the
        // active theme dictionary → writes Template DP → TemplatedControl's
        // rebuildTemplate materialises @DefaultSlider and attaches root.
        this.applyDefaultStyle();
        this._layout = this.templateRoot as SliderLayout;
        this._track  = this.GetTemplateChild('PART_Track') as Border;
        this._fill   = this.GetTemplateChild('PART_Fill')  as Border;
        this._thumb  = this.GetTemplateChild('PART_Thumb') as Border;
        this._layout.host = this;

        // Hover / press visual swap on the thumb is declarative — the
        // DefaultSlider template's `when(PART_Thumb.IsMouseOver)` and
        // `when(IsDragging)` triggers paint PART_Thumb.Fill via
        // DynamicResource, so a theme switch re-tints live and the TS
        // side carries no imperative refresh hook.
    }

    // ── Public DPs ─────────────────────────────────────────────────

    public get Orientation(): Orientation { return this.get_property_value(Slider.OrientationKey); }
    public set Orientation(v: Orientation) { this.set_property_value(Slider.OrientationKey, v); }

    public get Minimum(): number { return this.get_property_value(Slider.MinimumKey); }
    public set Minimum(v: number) { this.set_property_value(Slider.MinimumKey, v); }
    public get Maximum(): number { return this.get_property_value(Slider.MaximumKey); }
    public set Maximum(v: number) { this.set_property_value(Slider.MaximumKey, v); }
    public get Value(): number { return this.get_property_value(Slider.ValueKey); }
    public set Value(v: number) { this.set_property_value(Slider.ValueKey, v); }
    public get SmallChange(): number { return this.get_property_value(Slider.SmallChangeKey); }
    public set SmallChange(v: number) { this.set_property_value(Slider.SmallChangeKey, v); }
    public get LargeChange(): number { return this.get_property_value(Slider.LargeChangeKey); }
    public set LargeChange(v: number) { this.set_property_value(Slider.LargeChangeKey, v); }
    /** True while the thumb is being dragged. Read-only DP — flipped
     *  internally by the pointer-down / pointer-up path; the default
     *  template watches it via `when(IsDragging)` to swap the thumb
     *  brush. */
    public get IsDragging(): boolean { return this.get_property_value(Slider.IsDraggingKey); }
    private setIsDragging(v: boolean): void
    {
        this.set_property_value_with_key(Slider._IsDraggingPriv, v);
    }

    // ── Public events ──────────────────────────────────────────────
    public AddValueChangedListener(listener: (value: number) => void): void
    {
        this._valueListeners.add(listener);
    }
    public RemoveValueChangedListener(listener: (value: number) => void): void
    {
        this._valueListeners.delete(listener);
    }

    // Read-only handles to the template parts — same shape as
    // ScrollBar.Track / .Thumb. Useful for consumers that want to
    // override one piece's brush without replacing the template.
    public get Track(): Border { return this._track; }
    public get TrackFill():  Border { return this._fill;  }
    public get Thumb(): Border { return this._thumb; }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue:   unknown,
        newValue:   unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (descriptor.Name === 'Value' && oldValue !== newValue)
        {
            // Fire AFTER super so listeners observe the committed value.
            // Filter for actual value transitions — the EffectiveValueDescriptor
            // fires OnPropertyChange unconditionally (including stable writes
            // from layout-time arrange recomputes), and notifying a binding
            // sink on those is just noise.
            for (const l of this._valueListeners) l(newValue as number);
        }
        // metricsFor() reads Minimum / Maximum / Value / Orientation. When
        // any of those change, the inner SliderLayout's arrange stays
        // cached unless we kick it — without this push, the bar's own
        // _isArrangeValid clears (DP has MetaData.Arrange) but the
        // layout panel's arrange stays against the same outer rect and
        // the thumb never moves. Same pattern as ScrollBar.
        if (descriptor.Name === 'Value'   || descriptor.Name === 'Minimum'
         || descriptor.Name === 'Maximum' || descriptor.Name === 'Orientation')
        {
            this._layout.InvalidateArrange();
        }
    }

    // ── Layout ──────────────────────────────────────────────────────
    // MeasureOverride / ArrangeOverride / visualChildren /
    // propagate_target_to_visual_children all inherited from
    // TemplatedControl — they delegate to templateRoot which is the
    // SliderLayout the default template produced.

    // Called from SliderLayout.MeasureOverride — reports the desired
    // cross-axis thickness (THUMB_SIZE — the thumb is the widest piece)
    // and the available long-axis size.
    public MeasureSliderSlot(availableSize: Size): Size
    {
        if (this.Orientation === Orientation.Vertical)
        {
            const h = Number.isFinite(availableSize.Height) ? availableSize.Height : 0;
            return new Size(THUMB_CROSS, h);
        }
        const w = Number.isFinite(availableSize.Width) ? availableSize.Width : 0;
        return new Size(w, THUMB_CROSS);
    }

    // Called from SliderLayout.ArrangeOverride — places the track (full
    // primary length, centred on cross-axis), the fill (Min → thumb
    // centre on horizontal; thumb centre → Max-end on vertical, since
    // vertical's Min is at the bottom), and the thumb (THUMB_SIZE
    // square centred on its target position).
    public ArrangeSliderParts(
        finalSize: Size,
        track:     Visual,
        fill:      Visual,
        thumb:     Visual,
    ): void
    {
        const m = this.metricsFor(finalSize);
        if (this.Orientation === Orientation.Vertical)
        {
            // Track: full height, centred on the horizontal (cross) axis.
            // TRACK_THICKNESS = THUMB_CROSS today so the track and the
            // thumb both span the slider's cross-axis; the centring math
            // happens to land at 0 but the formula is preserved for
            // clarity (and so a future asymmetric variant doesn't
            // silently mis-arrange).
            const trackX = (finalSize.Width - TRACK_THICKNESS) / 2;
            track.Arrange(new Rect(trackX, 0, TRACK_THICKNESS, finalSize.Height));

            // Vertical fill — from the thumb centre down to the bottom
            // (Min lives at the bottom). thumbOffset is the offset of
            // the thumb's TOP from the top of the track in the
            // bottom-anchored frame, so:
            //   thumbTopFromTop = trackLength - thumbPrimary - thumbOffset
            //   thumbCentreFromTop = thumbTopFromTop + thumbPrimary/2
            const thumbTopY    = finalSize.Height - THUMB_PRIMARY - m.thumbOffset;
            const thumbCentreY = thumbTopY + THUMB_PRIMARY / 2;
            fill.Arrange(new Rect(
                trackX, thumbCentreY,
                TRACK_THICKNESS, Math.max(0, finalSize.Height - thumbCentreY),
            ));

            // Thumb: narrow vertical pill centred on the cross axis.
            const thumbX = (finalSize.Width - THUMB_CROSS) / 2;
            thumb.Arrange(new Rect(thumbX, thumbTopY, THUMB_CROSS, THUMB_PRIMARY));
            return;
        }

        // Horizontal — Min on the left, Max on the right.
        const trackY = (finalSize.Height - TRACK_THICKNESS) / 2;
        track.Arrange(new Rect(0, trackY, finalSize.Width, TRACK_THICKNESS));

        // Fill from the left edge of the track to the centre of the
        // thumb. m.thumbOffset is the offset of the thumb's LEFT edge.
        const thumbCentreX = m.thumbOffset + THUMB_PRIMARY / 2;
        fill.Arrange(new Rect(0, trackY, thumbCentreX, TRACK_THICKNESS));

        const thumbY = (finalSize.Height - THUMB_CROSS) / 2;
        thumb.Arrange(new Rect(m.thumbOffset, thumbY, THUMB_PRIMARY, THUMB_CROSS));
    }

    // RenderOverride inherited from TemplatedControl (no-op — template paints).

    // ── Pointer ────────────────────────────────────────────────────
    protected override OnPointerDown(args: PointerEventArgs): void
    {
        args.SetFocus(this);

        // Thumb press — start a value-preserving drag.
        if (args.Source === this._thumb)
        {
            this.setIsDragging(true);
            this._dragOriginPx    = this.primary(args.HostX, args.HostY);
            this._dragOriginValue = this.clampedValue();
            args.CapturePointer(this);
            args.Handled = true;
            return;
        }

        // Track press (or any other descendant) — jump-to-point. We
        // compute the value at the pointer's primary-axis coordinate
        // and write it, then initiate a drag so the user can refine
        // without releasing.
        const valueAtPointer = this.valueForPointerPx(this.primary(args.HostX, args.HostY));
        this.setClampedValue(valueAtPointer);
        this.setIsDragging(true);
        this._dragOriginPx    = this.primary(args.HostX, args.HostY);
        this._dragOriginValue = this.clampedValue();
        args.CapturePointer(this);
        args.Handled = true;
    }

    protected override OnPointerMove(args: PointerEventArgs): void
    {
        if (!this.IsDragging) return;
        const m = this.metricsFor(this.ArrangedRect.Size);
        const travel = m.trackLength - THUMB_PRIMARY;
        if (travel <= 0) return;
        const range = Math.max(0, this.Maximum - this.Minimum);
        if (range <= 0) return;

        const deltaPx    = this.primary(args.HostX, args.HostY) - this._dragOriginPx;
        // Vertical: Min at bottom → moving DOWN (positive delta)
        // decreases Value. Sign-flip the per-axis delta accordingly.
        const signedDelta = this.Orientation === Orientation.Vertical ? -deltaPx : deltaPx;
        const deltaValue  = (signedDelta / travel) * range;
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

    // ── Keyboard ───────────────────────────────────────────────────
    protected override OnKeyDown(args: KeyEventArgs): void
    {
        const small = this.SmallChange;
        const large = this.LargeChange;
        switch (args.Key)
        {
            // Lower-value direction: ArrowLeft anywhere, ArrowDown anywhere.
            case Key.Left:
            case Key.Down:
                this.setClampedValue(this.clampedValue() - small);
                args.Handled = true; return;
            // Higher-value direction.
            case Key.Right:
            case Key.Up:
                this.setClampedValue(this.clampedValue() + small);
                args.Handled = true; return;
            case Key.PageDown:
                this.setClampedValue(this.clampedValue() - large);
                args.Handled = true; return;
            case Key.PageUp:
                this.setClampedValue(this.clampedValue() + large);
                args.Handled = true; return;
            case Key.Home:
                this.setClampedValue(this.Minimum);
                args.Handled = true; return;
            case Key.End:
                this.setClampedValue(this.Maximum);
                args.Handled = true; return;
        }
    }

    // ── Internals ──────────────────────────────────────────────────

    // Geometry resolved on every Arrange / pointer event. All distances
    // are along the bar's primary axis (vertical = height, horizontal
    // = width). thumbOffset is the position of the thumb's LEADING edge
    // in primary-axis local space, anchored at the Min end:
    //   horizontal: leading = left edge,   measured from the left.
    //   vertical:   leading = top of thumb in a BOTTOM-anchored frame,
    //               so caller flips with `trackLength - thumbSize - offset`.
    private metricsFor(size: Size): { trackLength: number; thumbOffset: number }
    {
        const trackLength = Math.max(0, this.Orientation === Orientation.Vertical
            ? size.Height : size.Width);

        if (trackLength === 0)
        {
            return { trackLength: 0, thumbOffset: 0 };
        }

        const travel = Math.max(0, trackLength - THUMB_PRIMARY);
        const range  = Math.max(0, this.Maximum - this.Minimum);
        const valuePos = range > 0
            ? ((this.clampedValue() - this.Minimum) / range) * travel
            : 0;
        return { trackLength, thumbOffset: valuePos };
    }

    // Convert a pointer's primary-axis HOST coordinate into a Value.
    // Inverse of metricsFor's mapping: subtract the Slider's absolute
    // primary-axis origin, treat that as the thumb's CENTRE position,
    // and back-solve for the value. Centre-based (not leading-edge)
    // because the visual feedback of "clicking and the thumb jumps to
    // where I clicked" reads better when the thumb is centred under
    // the click, not when its leading edge is under the click.
    private valueForPointerPx(hostPx: number): number
    {
        const arr = this.ArrangedRect;
        const trackLength = this.Orientation === Orientation.Vertical
            ? arr.Height : arr.Width;
        const travel = Math.max(0, trackLength - THUMB_PRIMARY);
        if (travel <= 0) return this.clampedValue();

        const localPx = hostPx - this.primaryOrigin();
        // Convert centre-anchored pointer position to leading-edge
        // offset for the metric model.
        const leadingPx = this.Orientation === Orientation.Vertical
            ? (trackLength - localPx) - THUMB_PRIMARY / 2
            : localPx - THUMB_PRIMARY / 2;

        const range = Math.max(0, this.Maximum - this.Minimum);
        if (range <= 0) return this.Minimum;
        return this.Minimum + (leadingPx / travel) * range;
    }

    private primary(x: number, y: number): number
    {
        return this.Orientation === Orientation.Vertical ? y : x;
    }

    // Absolute primary-axis origin of this Slider on the host surface.
    // Walks the visual-parent chain summing ArrangedRect, the same
    // pattern ScrollBar / ComboBox use.
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
