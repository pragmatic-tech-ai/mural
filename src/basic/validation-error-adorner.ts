import {
    Adorner,
    AdornerLayer,
    Application,
    Rect,
    Size,
    Validation,
    Visual,
    type DrawingContext,
    type Disposable,
} from '../runtime/index.js';
import { Pen, SolidColorBrush } from '../visual-engine/index.js';

const DEFAULT_ERROR_THICKNESS = 1.5;

// ValidationErrorAdorner — paints a red rectangle around the adorned
// element when Validation.HasError on it is true. Reactive: subscribes
// to the adorned element's Validation.HasError change notifications
// and invalidates its visual whenever the flag flips, so the chrome
// turns on / off without consumers having to poll.
//
// Usage:
//
//   const adorner = new ValidationErrorAdorner(target);
//   AdornerLayer.GetAdornerLayer(target)?.Add(adorner);
//
// Or, in markup-driven scenarios, call AttachTo(visual) which finds
// the layer for you and returns a detach thunk symmetric with the
// behavior-detach contract.
//
// Sizing: the default Placement returns the adorned rect — the stroke
// paints at the adorned element's bounding box. Customise by
// subclassing and overriding Placement / RenderOverride for a
// different chrome (e.g. an icon at the corner, an underline, a
// tooltip-bubble below).
export class ValidationErrorAdorner extends Adorner
{
    private _sub: Disposable | undefined;
    private _brush:     SolidColorBrush | undefined;
    private _thickness: number;

    constructor(adornedElement: Visual,
                brush?: SolidColorBrush,
                thickness: number = DEFAULT_ERROR_THICKNESS)
    {
        super(adornedElement);
        // Explicit consumer-supplied brush wins (LOCAL tier semantics).
        // Otherwise leave `_brush` undefined and resolve `@Error`
        // through Application.Resources at every render so a theme
        // switch repaints the chrome with the new palette without
        // requiring the adorner to re-subscribe to the dictionary.
        this._brush     = brush;
        this._thickness = thickness;
        // The error chrome is decoration — clicks / focus must reach
        // the adorned TextBox / input so the user can still edit and
        // dismiss the error.
        this.IsHitTestVisible = false;
        // Listener fires on every HasError change; InvalidateVisual
        // schedules a repaint that runs through the standard flush
        // convergence loop. No throttle needed — HasError flips at
        // input-event cadence, far below render-budget pressure.
        this._sub = adornedElement.PropertyChanged(Validation.HasErrorKey).subscribe(
            () => { this.InvalidateVisual(); });
    }

    // Dispose hook — symmetric with the behavior detach contract.
    // Removes the property listener so the adorner can be GC'd cleanly.
    // Named Dispose (not Detach) to avoid a name-shadow on Visual's
    // own Detach(child) — same idea, different signature.
    public dispose(): void
    {
        this._sub?.dispose();
        this._sub = undefined;
    }

    // Convenience for the common case: locate the layer, install the
    // adorner, and return a detach thunk that removes both the adorner
    // and the property subscription. Returns undefined when no
    // AdornerDecorator is in scope (consumer can decide whether to
    // fail loudly or silently skip).
    public static AttachTo(target: Visual): (() => void) | undefined
    {
        const layer = AdornerLayer.GetAdornerLayer(target);
        if (layer === undefined) return undefined;
        const adorner = new ValidationErrorAdorner(target);
        layer.Add(adorner);
        return (): void => {
            layer.Remove(adorner);
            adorner.dispose();
        };
    }

    public override Placement(adornedRect: Rect, _desired: Size): Rect
    {
        return adornedRect;
    }

    protected override MeasureOverride(_a: Size): Size { return Size.Zero; }

    protected override RenderOverride(dc: DrawingContext): void
    {
        if (!Validation.GetHasError(this.AdornedElement)) return;
        const size = this.RenderSize;
        if (size.Width <= 0 || size.Height <= 0) return;
        // Resolve @Error against the live Application.Resources at
        // every render so theme switches re-tint the chrome without an
        // imperative refresh / dictionary subscription. Consumer-
        // supplied brush wins (constructor-time override).
        let brush: SolidColorBrush | undefined = this._brush;
        if (brush === undefined)
        {
            const resolved = Application.current?.Resources.Resolve('Error');
            if (resolved instanceof SolidColorBrush) brush = resolved;
        }
        if (brush === undefined) return;
        const pen = new Pen(brush, this._thickness);
        // Inset by half-thickness so the stroke sits inside the
        // adorned bounds rather than straddling them (matches Border's
        // own stroke convention).
        const half = this._thickness / 2;
        dc.DrawRectangle(
            undefined,
            pen,
            new Rect(half, half,
                Math.max(0, size.Width  - this._thickness),
                Math.max(0, size.Height - this._thickness)),
        );
    }
}
