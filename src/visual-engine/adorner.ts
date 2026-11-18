import { Visual } from './visual.js';
import { Element, Panel, Single } from './element.js';
import { Matrix, Point, Rect, Size } from './primitives.js';
import type { DrawingContext } from './drawing-context.js';

// Adorner — a Visual that decorates another Visual (the "adorned
// element") by painting on top of it within an AdornerLayer.
//
// WPF-parity contract: an Adorner is hosted by an AdornerLayer (NOT
// by the adorned element itself), arranged at the adorned element's
// position within the layer's local coordinate space, and reaches back
// to the adorned element via the AdornedElement property to track its
// size / state. The layer recomputes adorner positioning on every
// arrange pass, so an adorner stays glued to its target as the host
// layout shifts (scroll, panel reflow, container recycle).
//
// Sizing default: an adorner is measured with Infinity available on
// both axes — it picks its own natural size via MeasureOverride.
// Arrange default: the adorner gets the adorned element's bounding
// rect in the layer's frame, capped at the adorner's measured desired
// size; override Placement to offset or scale relative to the
// adorned element.
//
// Hit-testing: adorners are hit-testable by default (like any Visual
// — the renderer stamps `pointer-events="all"` on the mural-hit pad).
// Feedback-only adorners (insertion lines, drag ghosts) should opt
// out by overriding Placement to a zero-area rect or by composing
// with a hit-transparent host (forthcoming IsHitTestVisible DP).
//
// Lifecycle: nothing in this class touches the adorned element itself
// — adding/removing adorners is the host's job via AdornerLayer.Add /
// Remove. If the adorned element is detached from the tree, the
// adorner stays visible at its last-known position; the host is
// responsible for removing the adorner on adorned-element cleanup.
export abstract class Adorner extends Element
{
    private readonly _adornedElement: Visual;

    constructor(adornedElement: Visual)
    {
        super();
        this._adornedElement = adornedElement;
    }

    public get AdornedElement(): Visual { return this._adornedElement; }

    // The composed transform from the adorned element's local space into THIS
    // adorner's own local frame — set by the hosting AdornerLayer each arrange
    // pass. Identity when the adorned element sits in the layer's frame
    // unscaled. Subclasses that position chrome from EXTERNAL coordinates (not
    // the adorned element's own rect) must map those coordinates through this so
    // the chrome tracks an ancestor transform, e.g. a board camera's
    // LayoutTransform scale. Adorners that just fill the adorned rect ignore it.
    private _adornedToLayer: Matrix = Matrix.Identity;
    /** @internal — set by AdornerLayer.ArrangeOverride. */
    public _setAdornedToLayerMatrix(m: Matrix): void { this._adornedToLayer = m; }
    protected get AdornedToLayerMatrix(): Matrix { return this._adornedToLayer; }

    // Returns the rect (in the layer's local coordinate space) where
    // this adorner should be arranged. Default: the adorned element's
    // rect as computed by the layer. Override to offset (e.g. a tooltip
    // bubble above the adorned element), scale (resize-handle overlay
    // padded by handle size), or pin to a corner.
    //
    // `adornedRect` is the layer's measurement of where AdornedElement
    // lives within the layer; `desiredSize` is what MeasureOverride
    // returned. The default fits the adorner inside the adorned rect,
    // honouring `desiredSize` when it's smaller.
    public Placement(adornedRect: Rect, desiredSize: Size): Rect
    {
        void desiredSize;
        return adornedRect;
    }

    protected override MeasureOverride(_availableSize: Size): Size
    {
        return Size.Zero;
    }

    protected override ArrangeOverride(finalSize: Size): Size
    {
        return finalSize;
    }

    protected override RenderOverride(_dc: DrawingContext): void { }
}

// AdornerLayer — Panel that hosts Adorners on top of the adorned
// content tree. Owned by an AdornerDecorator (its parent in the visual
// tree); paints AFTER the decorator's Child so adorners overlay the
// content.
//
// Layout protocol: on Arrange, each adorner's position is computed by
// walking from `adorner.AdornedElement` up through the visual tree
// summing ArrangedRect offsets until reaching the layer's owning
// AdornerDecorator. The accumulated offset is the adorned element's
// position in the layer's local frame; the adorner is then arranged
// at the rect its Placement override returns.
//
// Static AdornerLayer.GetAdornerLayer(visual) walks up from any visual
// looking for an AdornerDecorator's layer — the standard entry point
// for behaviours that want to attach an adorner to a control they're
// hosted on without the consumer threading the layer through manually.
export class AdornerLayer extends Panel
{
    constructor()
    {
        super();
        // The layer itself is a passthrough — its mural-hit pad would
        // catch pointer events on the whole arranged rect, blocking
        // hits to the content underneath (the AdornerDecorator's
        // Child). Opt the layer out at the renderer level; adorners
        // inside still get their own hit-test (their pad keeps explicit
        // "all", which beats the inherited "none" from the layer's
        // outer <g>).
        this.IsHitTestVisible = false;
    }

    public Add(adorner: Adorner): void
    {
        this.AddVisualChild(adorner);
    }

    public Remove(adorner: Adorner): void
    {
        this.RemoveVisualChild(adorner);
    }

    // Snapshot of adorners decorating a given element. WPF parity for
    // AdornerLayer.GetAdorners — null when there are none, an array
    // otherwise. We return undefined for "none" to match the rest of
    // the µ-mural API's "absent" convention.
    public GetAdorners(adornedElement: Visual): readonly Adorner[] | undefined
    {
        let hit: Adorner[] | undefined;
        for (const child of this.visualChildren)
        {
            if (child instanceof Adorner && child.AdornedElement === adornedElement)
            {
                (hit ??= []).push(child);
            }
        }
        return hit;
    }

    protected override MeasureOverride(availableSize: Size): Size
    {
        // Adorners measure with unbounded available — they pick their
        // own natural size. Constraining to availableSize would clip
        // adorners that extend past the adorned element's edges (a
        // halo, a glow, a tooltip overhanging the bottom).
        const unbounded = new Size(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
        for (const child of this.visualChildren)
        {
            child.Measure(unbounded);
        }
        // Layer fills the slot the decorator gave us (which is the
        // decorator's full bounds).
        return availableSize;
    }

    protected override ArrangeOverride(finalSize: Size): Size
    {
        for (const child of this.visualChildren)
        {
            if (!(child instanceof Adorner)) continue;
            const m = this.computeAdornedToLayerMatrix(child);
            const adornedRect = this.rectFromMatrix(m, child.AdornedElement.RenderSize);
            const place = child.Placement(adornedRect, child.DesiredSize);
            // Hand the adorner the transform from the adorned element's local
            // space into the adorner's OWN local frame (layer-local minus the
            // adorner's arranged origin). Chrome positioned from external
            // coordinates (e.g. SelectionBoundsAdorner's selection bounds) maps
            // through this to track an ancestor camera transform.
            const toOwn = (m ?? Matrix.Identity).Multiply(Matrix.Translate(-place.X, -place.Y));
            child._setAdornedToLayerMatrix(toOwn);
            child.Arrange(place);
        }
        return finalSize;
    }

    // The bounding box (in the layer's local frame) of the adorned element's
    // local rect mapped through the composed adorned->layer matrix. `undefined`
    // matrix (adorned element not under this layer) yields a zero rect.
    private rectFromMatrix(m: Matrix | undefined, rs: Size): Rect
    {
        if (m === undefined) return new Rect(0, 0, 0, 0);
        const c0 = m.Transform(new Point(0, 0));
        const c1 = m.Transform(new Point(rs.Width, 0));
        const c2 = m.Transform(new Point(0, rs.Height));
        const c3 = m.Transform(new Point(rs.Width, rs.Height));
        const minX = Math.min(c0.X, c1.X, c2.X, c3.X);
        const minY = Math.min(c0.Y, c1.Y, c2.Y, c3.Y);
        const maxX = Math.max(c0.X, c1.X, c2.X, c3.X);
        const maxY = Math.max(c0.Y, c1.Y, c2.Y, c3.Y);
        return new Rect(minX, minY, maxX - minX, maxY - minY);
    }

    // Builds the transform from the adorned element's local space into THIS
    // layer's LOCAL frame, composing each ancestor's effective transform up to
    // the layer's parent — its ArrangedRect offset, its RenderTransform (pivoted
    // by RenderTransformOrigin), AND its EffectiveLayoutMatrix — in the same
    // order the SVG renderer applies them (layout/render inner, arrange offset
    // outer). This lets adorners track an element a board camera (a
    // RenderTransform or LayoutTransform on an ancestor) has scaled/panned, while
    // adorner glyphs — children of the unscaled layer — stay a constant
    // on-screen size. With no ancestor transform every factor is identity, so it
    // reduces to the old offset-sum (backward compatible). The trailing Translate
    // shifts into the layer's own local frame (SCP-hosted layers sit at
    // (-offX,-offY); decorator-hosted layers at (0,0) — a no-op there). Returns
    // undefined when the adorned element is not under this layer's parent.
    private computeAdornedToLayerMatrix(adorner: Adorner): Matrix | undefined
    {
        const stop = this.GetVisualParent();
        let m = Matrix.Identity;
        let cur: Visual | undefined = adorner.AdornedElement;
        while (cur !== undefined && cur !== stop)
        {
            const rect = cur.ArrangedRect;
            // Effective local transform: layout/render transform THEN the arrange
            // offset (renderer emits `translate(rect) … matrix …`, so the matrix
            // applies first to a child point, the offset last).
            let local = Matrix.Translate(rect.X, rect.Y);
            const rt = cur.RenderTransform;
            if (rt !== undefined && !rt.Matrix.IsIdentity)
            {
                const origin = cur.RenderTransformOrigin;
                const ox = origin.X * rect.Width;
                const oy = origin.Y * rect.Height;
                const pivoted = Matrix.Translate(-ox, -oy).Multiply(rt.Matrix).Multiply(Matrix.Translate(ox, oy));
                local = pivoted.Multiply(local);
            }
            const lm = cur.EffectiveLayoutMatrix;
            if (lm !== undefined && !lm.IsIdentity) local = lm.Multiply(local);
            m = m.Multiply(local);   // child-first accumulation
            cur = cur.GetVisualParent();
        }
        if (cur === undefined) return undefined;
        return m.Multiply(Matrix.Translate(-this.ArrangedRect.X, -this.ArrangedRect.Y));
    }

    // Walks up the visual tree from `visual` looking for any ancestor
    // that exposes an AdornerLayer — typically an AdornerDecorator
    // wrapping a subtree, or a ScrollContentPresenter that carries an
    // inner layer so adorners scroll with content. Returns the FIRST
    // layer found, matching WPF's nearest-ancestor lookup. Returns
    // undefined when nothing in the ancestor chain provides one —
    // callers typically either short-circuit (skip the adornment) or
    // fail loudly so the missing host surfaces.
    //
    // The lookup duck-types on an `AdornerLayer` property of
    // AdornerLayer shape so providers in `Controls/` (SCP) don't
    // create a circular runtime → Controls dependency: any Visual
    // that wants to host adorners just exposes the property.
    public static GetAdornerLayer(visual: Visual): AdornerLayer | undefined
    {
        let cur: Visual | undefined = visual;
        while (cur !== undefined)
        {
            const candidate = (cur as unknown as { AdornerLayer?: unknown }).AdornerLayer;
            if (candidate instanceof AdornerLayer) return candidate;
            cur = cur.GetVisualParent();
        }
        return undefined;
    }

    // DFS the subtree rooted at `visual` for the FIRST AdornerLayer
    // provider and return its layer. Useful when a top-level host
    // (PresentationTarget / HtmlTarget) wants to drop an adornment
    // but doesn't have a specific in-tree anchor to walk up from —
    // the outermost AdornerDecorator typically wraps the app root, so
    // a top-down DFS finds it on the first hit. Returns undefined
    // when no provider exists in the subtree. Same duck-typing as
    // GetAdornerLayer.
    public static FindFirstInSubtree(visual: Visual): AdornerLayer | undefined
    {
        const candidate = (visual as unknown as { AdornerLayer?: unknown }).AdornerLayer;
        if (candidate instanceof AdornerLayer) return candidate;
        for (const child of visual.visualChildren)
        {
            const found = AdornerLayer.FindFirstInSubtree(child);
            if (found !== undefined) return found;
        }
        return undefined;
    }
}

// AdornerDecorator — a single-Child host that provides an AdornerLayer
// painted on top of its Child. Wrap the part of the tree you want
// adornment scope over (typically a page body or pane) in an
// AdornerDecorator; behaviours attached to descendants then locate
// the layer via AdornerLayer.GetAdornerLayer(this) and add their
// adorners there.
//
// Layout: Child fills the decorator; AdornerLayer overlays at the same
// rect. Paint order matches visualChildren order — Child is index 0,
// the layer is index 1, so the renderer walks Child first and the
// layer's adorners paint on top.
// Extends Single (the µ-mural `Decorator` analog) so consumers get the
// standard Child slot machinery — SetChild, Single's visualChildren
// surface, namescope plumbing — without AdornerDecorator
// reimplementing any of it. The internal AdornerLayer is a SECOND
// visual child painted ON TOP of Child; we override visualChildren
// to expose both. logicalChildren stays at Single's [_child] so
// property inheritance / consumer-side iteration ignore the layer.
export class AdornerDecorator extends Single
{
    private readonly _adornerLayer: AdornerLayer;

    constructor()
    {
        super();
        this._adornerLayer = new AdornerLayer();
        this.AttachVisual(this._adornerLayer);
    }

    public get AdornerLayer(): AdornerLayer { return this._adornerLayer; }

    public get Child(): Visual | undefined { return this.child; }
    public set Child(value: Visual | undefined) { this.SetChild(value); }

    public override get visualChildren(): readonly Visual[]
    {
        const c = this.child;
        return c === undefined ? [this._adornerLayer] : [c, this._adornerLayer];
    }

    // logicalChildren falls through to Single's [_child] — the layer
    // is a visual-only host (resources / DataContext don't flow into
    // it logically).

    protected override MeasureOverride(availableSize: Size): Size
    {
        let desired = Size.Zero;
        const c = this.child;
        if (c !== undefined)
        {
            c.Measure(availableSize);
            desired = c.DesiredSize;
        }
        // Layer measured AFTER child so the child drives the
        // decorator's desired size; layer's measure pass just
        // resolves each adorner's DesiredSize for the arrange step.
        this._adornerLayer.Measure(desired);
        return desired;
    }

    protected override ArrangeOverride(finalSize: Size): Size
    {
        const rect = new Rect(0, 0, finalSize.Width, finalSize.Height);
        this.child?.Arrange(rect);
        this._adornerLayer.Arrange(rect);
        return finalSize;
    }

    protected override RenderOverride(_dc: DrawingContext): void { }
}

// Cursor-anchored adorner. Hosts an optional content Visual; the
// adorner's Placement returns a rect at the layer-local position
// pinned via SetPosition. Used by HtmlTarget to host the drag-drop
// ghost inside an AdornerLayer when the visual tree carries an
// AdornerDecorator — the renderer's outer-translate mechanism then
// handles positioning instead of a surface-level overlay <g>.
//
// Content shape:
//   * `SetContent(visual)` — for mode C (DataTemplate-derived previews).
//     The hosted Visual is measured / arranged through the standard
//     visualChildren walk and the renderer paints its subtree under
//     this adorner's outer <g>.
//   * No content — for mode A (HtmlTarget appends a manually-cloned
//     <g> into this adorner's outer <g> after Flush). The adorner is
//     a positioning shell; nothing paints from its own subtree.
export class DragGhostAdorner extends Adorner
{
    private _content: Visual | undefined;
    private _x: number = 0;
    private _y: number = 0;
    private _w: number = 0;
    private _h: number = 0;

    constructor(adornedElement: Visual)
    {
        super(adornedElement);
        // Pointer events must reach the adorned element underneath —
        // the ghost is pure decoration following the cursor and would
        // otherwise swallow the very gestures the drag listener is
        // waiting for (drop targets, hover highlights on potential
        // drop zones, etc.).
        this.IsHitTestVisible = false;
    }

    public SetContent(content: Visual | undefined): void
    {
        if (this._content === content) return;
        if (this._content !== undefined) this.DetachVisual(this._content);
        this._content = content;
        if (content !== undefined) this.AttachVisual(content);
        this.InvalidateMeasure();
    }

    // Pin the adorner at (x, y) in the AdornerLayer's local frame.
    // The host (HtmlTarget) translates cursor host-coords to layer
    // coords once it has located the layer.
    public SetPosition(x: number, y: number): void
    {
        if (this._x === x && this._y === y) return;
        this._x = x;
        this._y = y;
        this.InvalidateArrange();
        // Bubble up so the layer's ArrangeOverride re-runs and picks
        // up the new Placement rect on the next layout pass.
        const parent = this.GetVisualParent();
        parent?.InvalidateArrange();
    }

    public override get visualChildren(): readonly Visual[]
    {
        return this._content === undefined ? [] : [this._content];
    }

    public override Placement(_adornedRect: Rect, _desired: Size): Rect
    {
        return new Rect(this._x, this._y, this._w, this._h);
    }

    protected override MeasureOverride(available: Size): Size
    {
        if (this._content === undefined) return Size.Zero;
        this._content.Measure(available);
        const d = this._content.DesiredSize;
        this._w = d.Width;
        this._h = d.Height;
        return d;
    }

    protected override ArrangeOverride(finalSize: Size): Size
    {
        this._w = finalSize.Width;
        this._h = finalSize.Height;
        this._content?.Arrange(new Rect(0, 0, finalSize.Width, finalSize.Height));
        return finalSize;
    }

    protected override RenderOverride(_dc: DrawingContext): void { }
}
