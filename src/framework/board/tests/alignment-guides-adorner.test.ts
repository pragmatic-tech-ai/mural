import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application, Matrix, Point, Rect, Size } from '../../../runtime/index.js';
import { Border } from '../../../basic/index.js';
import { Board } from '../board.js';
import { AlignmentGuidesAdorner } from '../behaviors/alignment-guides-adorner.js';

// Regression: the adorner computed guides but rendered NOTHING because each
// pool Border was constructed with Width = 0 / Height = 0. Visual.Arrange treats
// an explicit size (even 0) as authoritative over the arrange rect, so every
// guide line collapsed to 0×0 — invisible. Found via a live Playwright repro
// (guides published, zero blue DOM). The fix leaves Width/Height unset so the
// Stretch default fills the arrange rect.
describe('AlignmentGuidesAdorner rendering', () => {
    test('guide lines arrange to non-zero size (not pinned to 0×0)', () => {
        Application.current = null;
        new Application();
        const board = new Board();
        const host = new Border();
        host.Width = 400; host.Height = 300;
        host.Measure(new Size(400, 300));
        host.Arrange(new Rect(0, 0, 400, 300));

        const adorner = new AlignmentGuidesAdorner(host, board);
        board._setAlignmentGuides([
            { axis: 'x' as const, position: 120, movingEdge: 'min' as const, otherEdge: 'min' as const, otherRect: new Rect(0, 0, 10, 10) },
            { axis: 'y' as const, position: 80,  movingEdge: 'min' as const, otherEdge: 'min' as const, otherRect: new Rect(0, 0, 10, 10) },
        ]);

        adorner.Measure(new Size(400, 300));
        adorner.Arrange(new Rect(0, 0, 400, 300));

        const pool = (adorner as unknown as { _pool: { RenderSize: Size }[] })._pool;
        // pool[0] ↔ guides[0] (vertical line at x=120): thickness × full height.
        assert.ok(pool[0].RenderSize.Width > 0 && pool[0].RenderSize.Height > 0,
            `vertical guide must have non-zero size, got ${pool[0].RenderSize.Width}×${pool[0].RenderSize.Height}`);
        assert.ok(Math.abs(pool[0].RenderSize.Height - 300) < 1, 'vertical guide spans the adorner height');
        // pool[1] ↔ guides[1] (horizontal line at y=80): full width × thickness.
        assert.ok(pool[1].RenderSize.Width > 0 && pool[1].RenderSize.Height > 0,
            `horizontal guide must have non-zero size, got ${pool[1].RenderSize.Width}×${pool[1].RenderSize.Height}`);
        assert.ok(Math.abs(pool[1].RenderSize.Width - 400) < 1, 'horizontal guide spans the adorner width');
        // an unused slot stays collapsed
        assert.equal(pool[5].RenderSize.Width, 0, 'unused slot stays 0-width');
    });

    // Regression: guides rendered at raw content coords, drifting left/up of the
    // panned+zoomed nodes. Positions must project through the AdornerLayer's
    // content->layer matrix (camera zoom + pan), like the connector/selection
    // adorners.
    test('guide positions project through the content->layer (camera) matrix', () => {
        Application.current = null;
        new Application();
        const board = new Board();
        const host = new Border();
        host.Width = 400; host.Height = 300;
        host.Measure(new Size(400, 300));
        host.Arrange(new Rect(0, 0, 400, 300));

        const adorner = new AlignmentGuidesAdorner(host, board);
        // A camera transform: zoom 1.5 + pan. Compose scale then translate.
        const m = Matrix.Scale(1.5, 1.5).Multiply(Matrix.Translate(40, 25));
        adorner._setAdornedToLayerMatrix(m);
        board._setAlignmentGuides([
            { axis: 'x' as const, position: 100, movingEdge: 'min' as const, otherEdge: 'min' as const, otherRect: new Rect(0, 0, 10, 10) },
            { axis: 'y' as const, position: 60,  movingEdge: 'min' as const, otherEdge: 'min' as const, otherRect: new Rect(0, 0, 10, 10) },
        ]);
        adorner.Measure(new Size(400, 300));
        adorner.Arrange(new Rect(0, 0, 400, 300));

        const pool = (adorner as unknown as { _pool: { ArrangedRect: Rect }[] })._pool;
        const expX = m.Transform(new Point(100, 0)).X;   // vertical guide layer-x
        const expY = m.Transform(new Point(0, 60)).Y;    // horizontal guide layer-y
        // thickness default 1 → line centred on the projected coordinate.
        assert.ok(Math.abs(pool[0].ArrangedRect.X - (expX - 0.5)) < 0.5, `vertical guide at projected x (${pool[0].ArrangedRect.X} vs ${expX})`);
        assert.ok(Math.abs(pool[1].ArrangedRect.Y - (expY - 0.5)) < 0.5, `horizontal guide at projected y (${pool[1].ArrangedRect.Y} vs ${expY})`);
        // sanity: projection actually moved them off the raw content coord
        assert.ok(Math.abs(pool[0].ArrangedRect.X - 100) > 1, 'projection changed the raw position');
    });
});
