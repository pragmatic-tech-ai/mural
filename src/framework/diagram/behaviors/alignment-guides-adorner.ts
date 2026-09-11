import {
    DynamicResource,
    Point,
    Rect,
    Size,
    type Visual,
    type Disposable,
} from '../../../runtime/index.js';
import { Adorner, type Brush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/index.js';
import { Diagram } from '../diagram.js';
import type { AlignmentGuide } from './alignment-guides-behavior.js';
import { DiagramSettings } from '../diagram-settings.js';

// Promoted from the demo's alignment-guides-adorner.mjs. Read-only
// overlay that paints dashed vertical / horizontal lines through the
// alignment-edge positions written by AlignmentGuidesBehavior. Lives
// in the AdornerLayer of the Diagram's ItemsPanel so it scrolls with
// the canvas automatically.
//
// Subscribes to Diagram.AlignmentGuidesKey. On change, InvalidateArrange
// so ArrangeOverride re-reads the guide list and re-positions the
// pooled line visuals.
//
// Pool size = 32; guide counts are bounded by 3 edges × N peers and
// in practice almost never > 12, so the pool absorbs every realistic
// scene without per-frame allocations.

const POOL_SIZE = 32;
const HIDE_OFFSCREEN = -10000;

export class AlignmentGuidesAdorner extends Adorner
{
    private readonly _diagram: Diagram;
    private readonly _pool:    Border[] = [];
    private readonly _onChange: () => void;
    private _sub: Disposable | undefined;

    constructor(adornedElement: Visual, diagram: Diagram)
    {
        super(adornedElement);
        this._diagram = diagram;
        // Adorner pad transparent → guide overlay never catches pointer
        // events. The guides are purely decorative.
        this.IsHitTestVisible = false;

        for (let i = 0; i < POOL_SIZE; i++)
        {
            const v = new Border();
            // Snap-guide accent = theme @Primary (live via DynamicResource, adapts
            // light/dark), matching the selection bbox / group outline / text-block.
            v.set_property_value(Border.FillKey, DynamicResource(v, 'Primary') as unknown as Brush);
            v.IsHitTestVisible = false;
            // Leave Width/Height UNSET (NaN). Border defaults to Stretch on both
            // axes, so each line fills the exact rect ArrangeOverride gives it
            // (thickness × H for a vertical guide, W × thickness for horizontal).
            // Pinning Width/Height = 0 here would win over the arrange rect —
            // Visual.Arrange treats an explicit size (even 0) as authoritative —
            // collapsing every guide line to 0×0 (computed guides, nothing drawn).
            this.AttachVisual(v);
            this._pool.push(v);
        }

        this._onChange = (): void => this.InvalidateArrange();
        this._sub = diagram.PropertyChanged(Diagram.AlignmentGuidesKey).subscribe(this._onChange);
    }

    public override get visualChildren(): Visual[] { return this._pool.slice(); }

    public override MeasureOverride(_available: Size): Size
    {
        const big = new Size(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
        for (const v of this._pool) v.Measure(big);
        return Size.Zero;
    }

    public override ArrangeOverride(finalSize: Size): Size
    {
        const guides: readonly AlignmentGuide[] = this._diagram.AlignmentGuides;
        const W = finalSize.Width;
        const H = finalSize.Height;
        const thickness = DiagramSettings.GuideThickness();
        // Guide positions are CONTENT coordinates (figure Left/Top space). The
        // AdornerLayer sits OUTSIDE PART_Camera, so project each position through
        // the content->layer matrix (camera zoom + pan) or the line drifts to raw
        // canvas coords — same mechanism the connector/selection adorners use. The
        // camera is scale+translate only (no rotation), so a vertical guide's
        // layer-x depends only on the content x, a horizontal's layer-y only on y;
        // each line still spans the full layer (0..W / 0..H) and keeps its
        // constant on-screen thickness.
        const m = this.AdornedToLayerMatrix;
        const used = Math.min(guides.length, this._pool.length);
        for (let i = 0; i < used; i++)
        {
            const g = guides[i]!;
            const v = this._pool[i]!;
            if (g.axis === 'x')
            {
                // Vertical line at the projected x, spanning the full height.
                const x = m.IsIdentity ? g.position : m.Transform(new Point(g.position, 0)).X;
                v.Arrange(new Rect(x - thickness / 2, 0, thickness, H));
            }
            else
            {
                // Horizontal line at the projected y, spanning the full width.
                const y = m.IsIdentity ? g.position : m.Transform(new Point(0, g.position)).Y;
                v.Arrange(new Rect(0, y - thickness / 2, W, thickness));
            }
        }
        // Park unused pool slots off-screen so they don't get hit-tested
        // or affect bounding-rect math.
        for (let i = used; i < this._pool.length; i++)
        {
            this._pool[i]!.Arrange(new Rect(HIDE_OFFSCREEN, HIDE_OFFSCREEN, 0, 0));
        }
        return finalSize;
    }

    public Dispose(): void
    {
        this._sub?.dispose();
        this._sub = undefined;
    }
}
