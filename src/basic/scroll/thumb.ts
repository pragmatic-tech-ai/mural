import {
    DynamicResource,
    Element,
    MetaData,
    MuralBase,
    Rect,
    Size,
    Visual,
    type DrawingContext,
    type KeyEventArgs,
    Key,
    type PointerEventArgs,
} from '../../runtime/index.js';
import { resolveKey } from '../../runtime/model-internals.js';
import { Border } from '../border.js';

// Thumb — WPF System.Windows.Controls.Primitives.Thumb analog. A
// drag-aware Visual that owns the pointer-capture + drag-delta
// bookkeeping consumers (ScrollBar thumbs, GridSplitter, Slider thumbs)
// need without re-implementing it per control. On press Thumb captures
// the pointer, fires DragStarted with the press offset, then fires
// DragDelta on every subsequent move sample, and DragCompleted on
// release (or CancelDrag).
//
// Delta convention matches WPF:
//   * DragStarted has the press's local offset inside the Thumb.
//   * DragDelta carries the INCREMENTAL change since the previous
//     sample (HorizontalChange / VerticalChange in host-coord pixels).
//     Consumers integrate themselves if they want a running total.
//   * DragCompleted carries the TOTAL change since DragStarted plus a
//     Canceled flag (true when CancelDrag() ran during the drag).
//
// Hosts take focus on press so keyboard nudges (arrow keys on
// GridSplitter, Esc to cancel) land somewhere obvious. Esc handling
// lives in this base — it calls CancelDrag, which fires DragCompleted
// with Canceled=true; subclasses can detect that and roll back any
// optimistic write.
//
// Default chrome is inline-built (a soft neutral Border) so importing
// Thumb doesn't drag in the full controls.template.mu cycle — that
// matters for subclasses (GridSplitter, Splitter) that DO need the
// theme and would otherwise hit a TDZ on `extends Thumb` during
// module-load. Consumers that want a richer Thumb skin author a
// `Style [TargetType=Thumb] { Template = … }` and apply it explicitly;
// the Style's Template wins through the standard property pipeline.

// Default brush for a Thumb constructed without a Style/Template — a
// soft neutral. Routed through Theme so it follows the active palette
// (M3 OutlineVariant flips between light and dark schemes). The bundled
// Thumb template overrides this via @OutlineVariant on PART_Border;
// this constructor-time assignment only paints when no template
// applies (typically during tests or before the default Style merges).

export interface DragStartedEventArgs
{
    /** Pointer's X offset from the Thumb's top-left at press time. */
    readonly HorizontalOffset: number;
    /** Pointer's Y offset from the Thumb's top-left at press time. */
    readonly VerticalOffset:   number;
}

export interface DragDeltaEventArgs
{
    /** X delta in host-coord pixels since the last DragDelta sample. */
    readonly HorizontalChange: number;
    /** Y delta in host-coord pixels since the last DragDelta sample. */
    readonly VerticalChange:   number;
}

export interface DragCompletedEventArgs
{
    /** Total X delta since DragStarted, in host-coord pixels. */
    readonly HorizontalChange: number;
    /** Total Y delta since DragStarted, in host-coord pixels. */
    readonly VerticalChange:   number;
    /** True when the drag ended via CancelDrag() / Esc; false on normal release. */
    readonly Canceled:         boolean;
}

export class Thumb extends Element
{
    // Theme-agnostic resting-chrome token. Every scheme aliases it to its
    // own neutral divider colour (Material @OutlineVariant, Pragmatic
    // @BorderStrong), so the inline Border resolves the right value under
    // any theme without hardcoding an M3 name here.
    protected static readonly TrackTokenName = 'ControlTrack';

    // Read-only DP exposing the drag state so triggers can react.
    // Backing store flips through setIsDraggingInternal so external
    // writers can't desync the state machine.
    public static readonly IsDraggingKey = MuralBase.RegisterReadOnlyProperty<boolean>(
        Thumb, 'IsDragging', false, MetaData.Render);

    // Inline-built chrome — a Border that paints the Thumb. Kept as a
    // field so subclasses can re-tint without re-templating.
    private readonly _border: Border;

    private _dragStartHostX = 0;
    private _dragStartHostY = 0;
    private _lastHostX      = 0;
    private _lastHostY      = 0;

    private readonly _onDragStarted   = new Set<(args: DragStartedEventArgs)   => void>();
    private readonly _onDragDelta     = new Set<(args: DragDeltaEventArgs)     => void>();
    private readonly _onDragCompleted = new Set<(args: DragCompletedEventArgs) => void>();

    constructor()
    {
        super();
        this.Focusable = true;
        this._border = new Border();
        // Fill tracks the active theme via DynamicResource —
        // a theme switch re-resolves @ControlTrack against the new
        // dictionary and re-paints without an imperative refresh.
        this._border.set_property_value(
            resolveKey(this._border, undefined, 'Fill'),
            DynamicResource(this._border, Thumb.TrackTokenName),
        );
        this.AttachVisual(this._border);
    }

    public get IsDragging(): boolean { return this.get_property_value(Thumb.IsDraggingKey); }

    public override get visualChildren(): readonly Visual[]
    {
        return [this._border];
    }

    protected override propagate_target_to_visual_children(): void
    {
        this._border['SetTarget'](this['target']);
    }

    // Expose the chrome handle so consumers can re-tint without
    // re-templating (the underlying Border is the standard mural Border
    // — Fill, BorderBrush, CornerRadius, etc. all reachable).
    public get Border(): Border { return this._border; }

    public AddDragStartedListener(cb: (args: DragStartedEventArgs) => void): void   { this._onDragStarted.add(cb); }
    public RemoveDragStartedListener(cb: (args: DragStartedEventArgs) => void): void { this._onDragStarted.delete(cb); }

    public AddDragDeltaListener(cb: (args: DragDeltaEventArgs) => void): void   { this._onDragDelta.add(cb); }
    public RemoveDragDeltaListener(cb: (args: DragDeltaEventArgs) => void): void { this._onDragDelta.delete(cb); }

    public AddDragCompletedListener(cb: (args: DragCompletedEventArgs) => void): void   { this._onDragCompleted.add(cb); }
    public RemoveDragCompletedListener(cb: (args: DragCompletedEventArgs) => void): void { this._onDragCompleted.delete(cb); }

    // Cancel an in-progress drag — fires DragCompleted with
    // Canceled=true and releases pointer capture. No-op when not
    // dragging. Used by Esc handling and by host controls that want to
    // abort the drag programmatically (a Splitter discovering the
    // adjacent column would shrink past MinWidth, for instance).
    public CancelDrag(): void
    {
        if (!this.IsDragging) return;
        const totalX = this._lastHostX - this._dragStartHostX;
        const totalY = this._lastHostY - this._dragStartHostY;
        this.setIsDraggingInternal(false);
        this.fireDragCompleted({ HorizontalChange: totalX, VerticalChange: totalY, Canceled: true });
    }

    // ── Pointer handling ───────────────────────────────────────────

    protected override OnPointerDown(args: PointerEventArgs): void
    {
        args.SetFocus(this);
        args.CapturePointer(this);
        this._dragStartHostX = args.HostX;
        this._dragStartHostY = args.HostY;
        this._lastHostX      = args.HostX;
        this._lastHostY      = args.HostY;
        this.setIsDraggingInternal(true);
        // Press offset INSIDE the Thumb — walk ancestor offsets to get
        // the Thumb's host-coord origin so the result is local to the
        // Thumb's own frame.
        let oX = 0, oY = 0;
        let cur: Visual | undefined = this;
        while (cur !== undefined)
        {
            oX += cur.ArrangedRect.X;
            oY += cur.ArrangedRect.Y;
            cur = cur.GetVisualParent();
        }
        this.fireDragStarted({
            HorizontalOffset: args.HostX - oX,
            VerticalOffset:   args.HostY - oY,
        });
        args.Handled = true;
    }

    protected override OnPointerMove(args: PointerEventArgs): void
    {
        if (!this.IsDragging) return;
        const dx = args.HostX - this._lastHostX;
        const dy = args.HostY - this._lastHostY;
        this._lastHostX = args.HostX;
        this._lastHostY = args.HostY;
        if (dx !== 0 || dy !== 0)
        {
            this.fireDragDelta({ HorizontalChange: dx, VerticalChange: dy });
        }
        args.Handled = true;
    }

    protected override OnPointerUp(args: PointerEventArgs): void
    {
        if (!this.IsDragging) return;
        const totalX = args.HostX - this._dragStartHostX;
        const totalY = args.HostY - this._dragStartHostY;
        this.setIsDraggingInternal(false);
        args.ReleasePointerCapture();
        this.fireDragCompleted({ HorizontalChange: totalX, VerticalChange: totalY, Canceled: false });
        args.Handled = true;
    }

    // Esc during drag cancels — same shape WPF uses (the drag aborts,
    // hosts roll back any optimistic write through Canceled=true).
    protected override OnKeyDown(args: KeyEventArgs): void
    {
        if (this.IsDragging && args.Key === Key.Escape)
        {
            this.CancelDrag();
            args.Handled = true;
        }
    }

    // ── Internal helpers ───────────────────────────────────────────

    private setIsDraggingInternal(v: boolean): void
    {
        this.set_property_value_with_key(Thumb.IsDraggingKey, v);
    }

    private fireDragStarted(args: DragStartedEventArgs): void
    {
        for (const cb of [...this._onDragStarted]) cb(args);
    }
    private fireDragDelta(args: DragDeltaEventArgs): void
    {
        for (const cb of [...this._onDragDelta]) cb(args);
    }
    private fireDragCompleted(args: DragCompletedEventArgs): void
    {
        for (const cb of [...this._onDragCompleted]) cb(args);
    }

    protected override MeasureOverride(availableSize: Size): Size
    {
        this._border.Measure(availableSize);
        return this._border.DesiredSize;
    }

    protected override ArrangeOverride(finalSize: Size): Size
    {
        this._border.Arrange(new Rect(0, 0, finalSize.Width, finalSize.Height));
        return finalSize;
    }

    protected override RenderOverride(_dc: DrawingContext): void { /* border paints */ }
}
