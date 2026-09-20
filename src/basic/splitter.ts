import {
    Adorner,
    AdornerLayer,
    DynamicResource,
    MetaData,
    MuralBase,
    PropertyDescriptor,
    Rect,
    Size,
    Element, Visual,
    type DrawingContext,
    type KeyEventArgs,
    Key,
} from '../runtime/index.js';
import { resolveKey } from '../runtime/model-internals.js';
import { Brush } from '../visual-engine/index.js';
import { Orientation } from './panels/orientation.js';
import { Thumb, type DragDeltaEventArgs, type DragStartedEventArgs, type DragCompletedEventArgs } from './scroll/thumb.js';

// Default brush for the drag-preview adorner — Material Primary so
// the bar tints with the active theme. Consumers pin a specific
// colour via the PreviewBrush DP.

// Splitter — a standalone orientation-aware drag bar for non-Grid
// containers (StackPanel, DockPanel, …). On drag, mutates the PREVIOUS
// LOGICAL SIBLING's Width (Vertical splitter) or Height (Horizontal
// splitter).
//
// Orientation convention (matches Slider / ScrollBar):
//   Horizontal — the splitter is a horizontal bar that drags vertically
//                and resizes a row above (or below, when reversed).
//                ns-resize cursor.
//   Vertical   — the splitter is a vertical bar that drags horizontally
//                and resizes a column to the left (or right, when
//                reversed). ew-resize cursor.
//
// Direction:
//   ReverseDirection=false (default) — drag right/down GROWS target.
//     Use for left-edge / top-edge panels: the panel is declared
//     first, splitter second, panel sits on splitter's leading side.
//     `[Panel][Splitter][rest fills]`.
//   ReverseDirection=true — drag right/down SHRINKS target.
//     Use for right-edge / bottom-edge panels: in a DockPanel, declare
//     the panel first with `Dock=Right/Bottom` (so it lands in the
//     outermost slot), then the splitter with the same `Dock`. The
//     panel ends up at `idx-1` in `visualChildren` (the previous
//     sibling) but sits on the splitter's TRAILING side in layout —
//     so drag LEFT/UP needs to grow it. ReverseDirection negates the
//     drag delta to make this match the user's spatial intuition.
//
// GridSplitter is the better choice inside a Grid (it understands Star
// sizing and SharedSizeGroups). Use Splitter when the surrounding
// container is a DockPanel / StackPanel / Canvas and the previous
// sibling has an explicit Width or Height DP — Splitter writes Pixel
// values into that DP.
//
// If the previous sibling has no explicit Width/Height (its size comes
// from layout), Splitter falls back to writing the ArrangedRect's
// dimension as the new explicit Width/Height. The drag still works but
// the first move "commits" the sibling to an explicit pixel size.
export class Splitter extends Thumb
{
    public static readonly OrientationKey = MuralBase.RegisterProperty<Orientation>(
        Splitter, 'Orientation', Orientation.Vertical, MetaData.Render);

    public static readonly ReverseDirectionKey = MuralBase.RegisterProperty<boolean>(
        Splitter, 'ReverseDirection', false, MetaData.None);

    public static readonly ShowsPreviewKey = MuralBase.RegisterProperty<boolean>(
        Splitter, 'ShowsPreview', false, MetaData.None);

    public static readonly DragIncrementKey = MuralBase.RegisterProperty<number>(
        Splitter, 'DragIncrement', 1, MetaData.None);

    public static readonly KeyboardIncrementKey = MuralBase.RegisterProperty<number>(
        Splitter, 'KeyboardIncrement', 10, MetaData.None);

    public static readonly PreviewBrushKey = MuralBase.RegisterProperty<Brush | undefined>(
        Splitter, 'PreviewBrush', undefined, MetaData.None);

    // Resting divider brush. undefined (default) keeps the historic faint
    // @OutlineVariant line; set it (e.g. to the surrounding chrome colour) to
    // make the divider blend in at rest while hover/drag still tint it to the
    // accent. Bind a `@Token` DynamicResource so a theme switch re-tints live.
    public static readonly RestBrushKey = MuralBase.RegisterProperty<Brush | undefined>(
        Splitter, 'RestBrush', undefined, MetaData.None);

    static
    {
        MuralBase.OverrideMetadata(Splitter, Element.DefaultStyleKeyKey, { default_value: Splitter });
    }

    private _resizeTarget: Visual | undefined;
    private _startSize: number = 0;
    private _accumDelta = 0;
    private _previewAdorner: SplitterPreviewAdorner | undefined;
    private _previewLayer:   AdornerLayer | undefined;

    constructor()
    {
        super();
        this.AddDragStartedListener(args => this.onDragStarted(args));
        this.AddDragDeltaListener(args => this.onDragDelta(args));
        this.AddDragCompletedListener(args => this.onDragCompleted(args));
        this.refreshCursor();
        this.refreshChrome();
    }

    public get Orientation(): Orientation { return this.get_property_value(Splitter.OrientationKey); }
    public set Orientation(v: Orientation) { this.set_property_value(Splitter.OrientationKey, v); }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue:   unknown,
        newValue:   unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        // Markup writes bypass the TS setter and go through the descriptor,
        // so the cursor refresh has to live here to catch parser-driven
        // Orientation writes (e.g. `Splitter [Orientation=Horizontal]`).
        if (descriptor.Name === 'Orientation') this.refreshCursor();
        // VSCode-sash chrome reacts to hover, drag, and orientation — all
        // DPs on this instance, so route them through the one hook.
        if (descriptor.Name === 'Orientation'
            || descriptor.Name === 'IsMouseOver'
            || descriptor.Name === 'IsDragging'
            || descriptor.Name === 'RestBrush')
        {
            this.refreshChrome();
        }
    }

    public get ShowsPreview(): boolean { return this.get_property_value(Splitter.ShowsPreviewKey); }
    public set ShowsPreview(v: boolean) { this.set_property_value(Splitter.ShowsPreviewKey, v); }

    public get DragIncrement(): number { return this.get_property_value(Splitter.DragIncrementKey); }
    public set DragIncrement(v: number) { this.set_property_value(Splitter.DragIncrementKey, v); }

    public get KeyboardIncrement(): number { return this.get_property_value(Splitter.KeyboardIncrementKey); }
    public set KeyboardIncrement(v: number) { this.set_property_value(Splitter.KeyboardIncrementKey, v); }

    public get PreviewBrush(): Brush | undefined { return this.get_property_value(Splitter.PreviewBrushKey); }
    public set PreviewBrush(v: Brush | undefined) { this.set_property_value(Splitter.PreviewBrushKey, v); }

    public get RestBrush(): Brush | undefined { return this.get_property_value(Splitter.RestBrushKey); }
    public set RestBrush(v: Brush | undefined) { this.set_property_value(Splitter.RestBrushKey, v); }

    public get ReverseDirection(): boolean { return this.get_property_value(Splitter.ReverseDirectionKey); }
    public set ReverseDirection(v: boolean) { this.set_property_value(Splitter.ReverseDirectionKey, v); }

    private refreshCursor(): void
    {
        this.Cursor = this.Orientation === Orientation.Vertical ? 'ew-resize' : 'ns-resize';
    }

    // Resting thickness of the visible divider line (px). The splitter's
    // hit area is its host-assigned Width/Height; the line sits inside it.
    private static readonly REST_THICKNESS = 1;

    // VSCode-sash chrome. At rest the divider is a thin, faint line; on
    // hover or drag it tints to the accent and thickens to fill the hit
    // area. Driven off the inherited Thumb.Border handle because Thumb
    // renders a hardcoded Border (visualChildren = [_border]) rather than a
    // ControlTemplate — a markup trigger template would never apply. The
    // thin axis follows Orientation: a Vertical splitter (ew-resize) is a
    // narrow vertical line (constrained width); a Horizontal one a short
    // horizontal line (constrained height). The cross axis always stretches
    // to the full length of the bar.
    private refreshChrome(): void
    {
        const border   = this.Border;
        const active   = this.IsMouseOver || this.IsDragging;
        const vertical = this.Orientation === Orientation.Vertical;
        const rest     = Splitter.REST_THICKNESS;

        border.MaxWidth  = (vertical  && !active) ? rest : Number.POSITIVE_INFINITY;
        border.MaxHeight = (!vertical && !active) ? rest : Number.POSITIVE_INFINITY;
        const fillKey = resolveKey(border, undefined, 'Fill');
        if (active)
        {
            // Hover / drag → accent tint. DynamicResource so a theme switch
            // re-tints live (matches how Thumb seeds the resting brush).
            border.set_property_value(fillKey, DynamicResource(border, 'Primary'));
        }
        else if (this.RestBrush !== undefined)
        {
            // Consumer-supplied resting brush (e.g. chrome colour to blend in).
            // Already a resolved Brush from its own DynamicResource binding, so a
            // theme switch re-fires OnPropertyChanged(RestBrush) → refreshChrome.
            border.set_property_value(fillKey, this.RestBrush);
        }
        else
        {
            border.set_property_value(fillKey, DynamicResource(border, 'OutlineVariant'));
        }
    }

    // ── Drag lifecycle ────────────────────────────────────────────

    private onDragStarted(_args: DragStartedEventArgs): void
    {
        this._accumDelta = 0;
        const target = this.findPreviousSibling();
        if (target === undefined)
        {
            this._resizeTarget = undefined;
            return;
        }
        this._resizeTarget = target;
        const isVertical = this.Orientation === Orientation.Vertical;
        // Prefer the explicit DP if it's set; otherwise pin the current
        // arranged size so the drag has a stable starting point.
        const explicit = isVertical ? target.Width : target.Height;
        const arranged = isVertical ? target.ArrangedRect.Width : target.ArrangedRect.Height;
        this._startSize = Number.isFinite(explicit) ? explicit : arranged;
        if (this.ShowsPreview)
        {
            const layer = AdornerLayer.GetAdornerLayer(this);
            if (layer !== undefined)
            {
                // PreviewBrush rides the default
                // `Style[TargetType=Splitter]` setter via DynamicResource
                // (@Primary) so a theme switch re-tints the adorner
                // live; the imperative `?? Theme.primary` fallback is
                // unnecessary now that the DP default flows through
                // the resource chain.
                const brush = this.PreviewBrush;
                if (brush === undefined) return;
                const adorner = new SplitterPreviewAdorner(this, this.Orientation, brush);
                layer.Add(adorner);
                this._previewAdorner = adorner;
                this._previewLayer   = layer;
            }
        }
    }

    private onDragDelta(args: DragDeltaEventArgs): void
    {
        if (this._resizeTarget === undefined) return;
        const raw = this.Orientation === Orientation.Vertical
            ? args.HorizontalChange
            : args.VerticalChange;
        const stepped = this.snapToIncrement(raw);
        if (stepped === 0) return;
        this._accumDelta += stepped;
        if (this.ShowsPreview)
        {
            this._previewAdorner?.SetDelta(this._accumDelta);
            this._previewLayer?.InvalidateArrange();
        }
        else
        {
            this.applyResize(this._accumDelta);
        }
    }

    private onDragCompleted(args: DragCompletedEventArgs): void
    {
        if (this._resizeTarget === undefined) return;
        if (this.ShowsPreview && !args.Canceled)
        {
            this.applyResize(this._accumDelta);
        }
        if (this._previewAdorner !== undefined && this._previewLayer !== undefined)
        {
            this._previewLayer.Remove(this._previewAdorner);
        }
        this._previewAdorner = undefined;
        this._previewLayer   = undefined;
    }

    private findPreviousSibling(): Visual | undefined
    {
        const parent = this.GetVisualParent();
        if (parent === undefined) return undefined;
        const siblings = parent.visualChildren;
        const idx = siblings.indexOf(this);
        if (idx <= 0) return undefined;
        return siblings[idx - 1];
    }

    // Negate the raw drag delta for ReverseDirection layouts so that
    // dragging LEFT grows a right-edge panel and dragging UP grows a
    // bottom-edge panel — consistent with the user-visible expectation
    // even though the target sibling sits on the splitter's trailing
    // side in layout.
    private effectiveDelta(delta: number): number
    {
        return this.ReverseDirection ? -delta : delta;
    }

    private snapToIncrement(raw: number): number
    {
        const inc = this.DragIncrement;
        if (inc <= 1) return raw;
        return Math.round(raw / inc) * inc;
    }

    private applyResize(delta: number): void
    {
        const target = this._resizeTarget;
        if (target === undefined) return;
        const next = Math.max(0, this._startSize + this.effectiveDelta(delta));
        if (this.Orientation === Orientation.Vertical)
        {
            target.Width  = next;
        }
        else
        {
            target.Height = next;
        }
    }

    // ── Keyboard nudges ────────────────────────────────────────────

    protected override OnKeyDown(args: KeyEventArgs): void
    {
        super.OnKeyDown(args);
        if (args.Handled || this.IsDragging) return;
        const inc = this.KeyboardIncrement;
        const isVertical = this.Orientation === Orientation.Vertical;
        let delta: number;
        switch (args.Key)
        {
            case Key.Left:  if (!isVertical) return; delta = -inc; break;
            case Key.Right: if (!isVertical) return; delta =  inc; break;
            case Key.Up:    if (isVertical)  return; delta = -inc; break;
            case Key.Down:  if (isVertical)  return; delta =  inc; break;
            default: return;
        }
        const target = this.findPreviousSibling();
        if (target === undefined) return;
        const isVerticalAgain = isVertical;
        const explicit = isVerticalAgain ? target.Width : target.Height;
        const arranged = isVerticalAgain ? target.ArrangedRect.Width : target.ArrangedRect.Height;
        const start = Number.isFinite(explicit) ? explicit : arranged;
        const next = Math.max(0, start + this.effectiveDelta(delta));
        if (isVerticalAgain) target.Width = next;
        else                  target.Height = next;
        args.Handled = true;
    }
}

class SplitterPreviewAdorner extends Adorner
{
    private _delta = 0;
    private readonly _orientation: Orientation;
    private readonly _brush: Brush;

    constructor(splitter: Splitter, orientation: Orientation, brush: Brush)
    {
        super(splitter);
        this._orientation = orientation;
        this._brush = brush;
        this.IsHitTestVisible = false;
    }

    public SetDelta(delta: number): void
    {
        if (this._delta === delta) return;
        this._delta = delta;
        this.InvalidateArrange();
        this.GetVisualParent()?.InvalidateArrange();
    }

    public override Placement(adornedRect: Rect, _desired: Size): Rect
    {
        if (this._orientation === Orientation.Vertical)
        {
            return new Rect(adornedRect.X + this._delta, adornedRect.Y,
                            adornedRect.Width, adornedRect.Height);
        }
        return new Rect(adornedRect.X, adornedRect.Y + this._delta,
                        adornedRect.Width, adornedRect.Height);
    }

    protected override MeasureOverride(_a: Size): Size { return Size.Zero; }

    protected override RenderOverride(dc: DrawingContext): void
    {
        const s = this.RenderSize;
        if (s.Width <= 0 || s.Height <= 0) return;
        dc.DrawRectangle(this._brush, undefined, new Rect(0, 0, s.Width, s.Height));
    }
}
