import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application, Matrix, Point, Rect, Size } from '../../../runtime/index.js';
import { Border, } from '../../../basic/index.js';
import { RectangleGeometry, LineGeometry, type DrawingContext } from '../../../visual-engine/index.js';
import { Diagram } from '../diagram.js';
import { LayoutPreviewAdorner } from '../layout/layout-preview-adorner.js';
import type { LayoutPreview } from '../layout-preview.js';

// A DrawingContext that records every DrawGeometry call so a headless test can
// assert what the self-painting adorner emitted.
interface DrawCall { brush: unknown; pen: unknown; geometry: unknown }
function recordingDc(): { dc: DrawingContext; calls: DrawCall[] }
{
    const calls: DrawCall[] = [];
    const dc = {
        DrawGeometry: (brush: unknown, pen: unknown, geometry: unknown) => calls.push({ brush, pen, geometry }),
        PushClip: () => {}, PushTransform: () => {}, PushOpacity: () => {}, Pop: () => {},
    } as unknown as DrawingContext;
    return { dc, calls };
}

// Build an adorner arranged over a 400×300 layer, with the given matrix.
function arrangedAdorner(matrix?: Matrix): { adorner: LayoutPreviewAdorner; diagram: Diagram }
{
    Application.current = null;
    new Application();
    const diagram = new Diagram();
    const host = new Border();
    host.Width = 400; host.Height = 300;
    host.Measure(new Size(400, 300));
    host.Arrange(new Rect(0, 0, 400, 300));
    const adorner = new LayoutPreviewAdorner(host, diagram);
    if (matrix !== undefined) adorner._setAdornedToLayerMatrix(matrix);
    adorner.Measure(new Size(400, 300));
    adorner.Arrange(new Rect(0, 0, 400, 300));   // sets RenderSize
    return { adorner, diagram };
}

const PREVIEW: LayoutPreview = {
    nodes: [
        { id: 'a', left: 10,  top: 20, width: 80, height: 40 },
        { id: 'b', left: 200, top: 20, width: 80, height: 40 },
    ],
    edges: [{ from: 'a', to: 'b' }],
};

function render(adorner: LayoutPreviewAdorner): DrawCall[]
{
    const { dc, calls } = recordingDc();
    (adorner as unknown as { RenderOverride(dc: DrawingContext): void }).RenderOverride(dc);
    return calls;
}

describe('LayoutPreviewAdorner rendering', () => {
    test('paints an opaque backdrop, a block per node, and a line per edge', () => {
        const { adorner, diagram } = arrangedAdorner();
        diagram.LayoutPreview = PREVIEW;
        const calls = render(adorner);

        // backdrop first: a rectangle covering the whole layer, filled (brush set).
        const backdrop = calls[0]!;
        assert.ok(backdrop.geometry instanceof RectangleGeometry, 'first draw is the backdrop rect');
        const br = (backdrop.geometry as RectangleGeometry).Rect;
        assert.deepEqual([br.X, br.Y, br.Width, br.Height], [0, 0, 400, 300]);
        assert.ok(backdrop.brush !== undefined, 'backdrop is filled (opaque)');

        const rects = calls.filter((c) => c.geometry instanceof RectangleGeometry);
        const lines = calls.filter((c) => c.geometry instanceof LineGeometry);
        assert.equal(rects.length, 3, 'backdrop + 2 node blocks');
        assert.equal(lines.length, 1, 'one edge line');
    });

    test('node blocks land at their content rects (identity matrix)', () => {
        const { adorner, diagram } = arrangedAdorner();
        diagram.LayoutPreview = PREVIEW;
        const rects = render(adorner).filter((c) => c.geometry instanceof RectangleGeometry).slice(1)  // drop backdrop
            .map((c) => (c.geometry as RectangleGeometry).Rect);
        assert.deepEqual([rects[0]!.X, rects[0]!.Y, rects[0]!.Width, rects[0]!.Height], [10, 20, 80, 40]);
        assert.deepEqual([rects[1]!.X, rects[1]!.Y], [200, 20]);
    });

    test('the edge line joins the two node centres', () => {
        const { adorner, diagram } = arrangedAdorner();
        diagram.LayoutPreview = PREVIEW;
        const line = render(adorner).find((c) => c.geometry instanceof LineGeometry)!.geometry as LineGeometry;
        // centres: a=(50,40), b=(240,40)
        assert.deepEqual([line.StartPoint.X, line.StartPoint.Y], [50, 40]);
        assert.deepEqual([line.EndPoint.X, line.EndPoint.Y], [240, 40]);
    });

    test('node rects project through the content->layer (camera) matrix', () => {
        const m = Matrix.Scale(1.5, 1.5).Multiply(Matrix.Translate(40, 25));
        const { adorner, diagram } = arrangedAdorner(m);
        diagram.LayoutPreview = PREVIEW;
        const firstNode = render(adorner).filter((c) => c.geometry instanceof RectangleGeometry)[1]!.geometry as RectangleGeometry;
        const expTL = m.Transform(new Point(10, 20));
        assert.ok(Math.abs(firstNode.Rect.X - expTL.X) < 0.5 && Math.abs(firstNode.Rect.Y - expTL.Y) < 0.5,
            `node a projected to ${expTL.X},${expTL.Y}, got ${firstNode.Rect.X},${firstNode.Rect.Y}`);
        assert.ok(Math.abs(firstNode.Rect.X - 10) > 1, 'projection changed the raw position');
    });

    test('no preview paints nothing', () => {
        const { adorner } = arrangedAdorner();
        assert.equal(render(adorner).length, 0);
    });
});
