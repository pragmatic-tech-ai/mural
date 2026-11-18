import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Size } from '../../../runtime/index.js';
import { PathGeometry, Point, type Geometry } from '../../../visual-engine/index.js';
import { Figure } from '../figure.js';

// Figure confines picking to its silhouette the same way Shapes do: ArrangeOverride
// publishes HitTestGeometry from the same geometry the clip-to-bounds / child-clip
// seams use (buildClipGeometry). A shapeless container Figure keeps the default AABB
// hit region (undefined). A headless Figure has RenderSize 0, so drive ArrangeOverride
// directly with an explicit slot (Visual.Arrange assigns RenderSize the return of this
// method, and the getter is stale during it — hence finalSize is authoritative).

interface Arrangeable
{
    ArrangeOverride(size: Size): Size;
    buildClipGeometry(size: Size): Geometry;
}
const arrange = (f: Figure): Arrangeable => f as unknown as Arrangeable;

describe('Figure — HitTestGeometry from the clip geometry', () => {
    test('a catalog Figure publishes its silhouette as HitTestGeometry after arrange', () => {
        const f = Figure.fromKind('ellipse', 0, 0, { width: 80, height: 60 });
        f.Width = 80; f.Height = 60;
        const slot = new Size(80, 60);
        arrange(f).ArrangeOverride(slot);
        const hit = f.HitTestGeometry;
        assert.ok(hit instanceof PathGeometry, 'HitTestGeometry is the silhouette');
        // Same geometry the clip seam returns — hit and clip agree by construction.
        assert.equal(hit, arrange(f).buildClipGeometry(slot));
        assert.ok(hit!.Contains(new Point(40, 30)), 'centre inside');
        assert.ok(!hit!.Contains(new Point(1, 1)), 'bbox corner outside the ellipse');
    });

    test('a shapeless container Figure keeps the default AABB hit region (undefined)', () => {
        const f = new Figure();
        assert.equal(f._getSource(), undefined);
        arrange(f).ArrangeOverride(new Size(40, 40));
        assert.equal(f.HitTestGeometry, undefined);
    });

    test('a degenerate slot publishes no HitTestGeometry', () => {
        const f = Figure.fromKind('rectangle', 0, 0, { width: 40, height: 40 });
        arrange(f).ArrangeOverride(new Size(0, 0));
        assert.equal(f.HitTestGeometry, undefined);
    });

    test('resize keeps the hit silhouette in step with the clip geometry', () => {
        const f = Figure.fromKind('ellipse', 0, 0, { width: 40, height: 40 });
        f.Width = 120; f.Height = 30;
        const slot = new Size(120, 30);
        arrange(f).ArrangeOverride(slot);
        const hit = f.HitTestGeometry as PathGeometry;
        const b = hit.GetBounds();
        assert.ok(Math.abs(b.Width - 120) < 1 && Math.abs(b.Height - 30) < 1);
        assert.equal(hit, arrange(f).buildClipGeometry(slot));
    });
});
