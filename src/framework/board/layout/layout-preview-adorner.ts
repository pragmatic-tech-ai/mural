import { Point, Rect, Size, type DrawingContext, type Visual } from '../../../runtime/index.js';
import { Adorner, Pen, RectangleGeometry, LineGeometry } from '../../../visual-engine/index.js';
import { Board } from '../board.js';
import { BoardSettings } from '../board-settings.js';
import type { LayoutPreview } from '../layout-preview.js';

// Read-only overlay that paints a PROPOSED arrangement (Board.LayoutPreview)
// over the live canvas so the user can compare before committing. Unlike the
// guides adorner (thin lines via child Borders), this OCCLUDES and draws many
// primitives, so it SELF-PAINTS in RenderOverride rather than composing child
// visuals — a child-per-node/edge adorner would have to write measure-affecting
// DPs (Border sizes, Line.X1..Y2) during layout and re-enter the layout pass.
// One Visual, zero children: no re-entrancy.
//
// Draw order: an opaque backdrop over the whole layer (hides the current
// board), then a faint block per proposed node, then a line between the
// centres of each proposed edge's endpoints. Positions are in the board's
// CONTENT space and projected through AdornedToLayerMatrix (camera zoom+pan),
// the same mechanism the guides adorners use. NOT hit-test-visible.
const EDGE_THICKNESS = 1.5;
const NODE_CORNER = 4;

// The Board OWNS this adorner's lifecycle: it mounts a fresh instance whenever
// Board.LayoutPreview is set (or changes) and unmounts it when the preview
// clears. A fresh mount is a first-render (isNew), which is the reliable trigger
// for repaintOwn — a mounted adorner has no _target, so InvalidateVisual /
// InvalidateArrange would NOT re-run its RenderOverride. Unmounting reaps the
// overlay's DOM, guaranteeing the ghost disappears on Apply/Cancel. (A preview is
// a transient compare state, so not tracking a mid-preview pan is acceptable; the
// board remounts to repaint if the preview data changes.)
export class LayoutPreviewAdorner extends Adorner
{
    private readonly _board: Board;

    constructor(adornedElement: Visual, board: Board)
    {
        super(adornedElement);
        this._board = board;
        this.IsHitTestVisible = false;
    }

    // No children; the adorner has no intrinsic size and fills the arrange rect
    // the AdornerLayer gives it (which covers the adorned canvas), so RenderSize
    // is the layer size at paint time.
    public override MeasureOverride(_available: Size): Size { return Size.Zero; }
    public override ArrangeOverride(finalSize: Size): Size { return finalSize; }

    protected override RenderOverride(dc: DrawingContext): void
    {
        const preview: LayoutPreview | undefined = this._board.LayoutPreview;
        const size = this.RenderSize;
        if (preview === undefined || preview.nodes.length === 0 || size.Width <= 0 || size.Height <= 0) return;

        // Opaque backdrop over the whole layer — occludes the current board.
        dc.DrawGeometry(BoardSettings.LayoutPreviewBackdrop(), undefined,
            new RectangleGeometry(new Rect(0, 0, size.Width, size.Height)));

        const m = this.AdornedToLayerMatrix;
        const proj = (x: number, y: number): Point => m.IsIdentity ? new Point(x, y) : m.Transform(new Point(x, y));

        const nodeFill = BoardSettings.LayoutPreviewNodeFill();
        const stroke = BoardSettings.LayoutPreviewStroke();
        const nodePen = new Pen(stroke, 1);

        // Node blocks + a centre lookup for the edges.
        const centre = new Map<string, Point>();
        for (const n of preview.nodes)
        {
            const tl = proj(n.left, n.top);
            const br = proj(n.left + n.width, n.top + n.height);
            const rect = Rect.FromCorners(tl, br);
            dc.DrawGeometry(nodeFill, nodePen, new RectangleGeometry(rect, NODE_CORNER, NODE_CORNER));
            centre.set(n.id, new Point(rect.X + rect.Width / 2, rect.Y + rect.Height / 2));
        }

        // Edge lines between the proposed node centres (an edge whose endpoints
        // aren't both present is skipped).
        const edgePen = new Pen(stroke, EDGE_THICKNESS);
        for (const e of preview.edges)
        {
            const a = centre.get(e.from);
            const b = centre.get(e.to);
            if (a === undefined || b === undefined) continue;
            dc.DrawGeometry(undefined, edgePen, new LineGeometry(a, b));
        }
    }
}
