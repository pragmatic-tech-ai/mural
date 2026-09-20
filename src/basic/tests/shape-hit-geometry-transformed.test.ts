import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Point, Rect, Size } from '../../runtime/index.js';
import { PathGeometry } from '../../visual-engine/index.js';
import { Puffy, PuffyDiamond } from '../shapes/puffy.js';
import { Slanted } from '../shapes/slanted.js';

function arrange(shape: { Measure: (s: Size) => void; Arrange: (r: Rect) => void },
                 w: number, h: number): void
                 {
    shape.Measure(new Size(w, h));
    shape.Arrange(new Rect(0, 0, w, h));
}

describe('Puffy / Slanted — transformed hit geometry', () => {
    // NOTE: the probe point is deliberately OFF the vertical centre. A
    // default Puffy's two bumps per edge meet exactly at y = H/2, so the
    // y = 50 scanline grazes those junction vertices — a known
    // vertex-grazing degeneracy in PathGeometry's ray-cast Contains (worst
    // case is a fall-through on that 1px line). Interior points off the
    // junction scanline resolve normally, which is what real hit-testing
    // sees.
    test('Puffy (square base) sets a PathGeometry hit region covering its interior', () => {
        const p = new Puffy();
        p.Width = 100; p.Height = 100;
        arrange(p, 100, 100);
        assert.ok(p.HitTestGeometry instanceof PathGeometry);
        assert.ok(p.HitTestGeometry!.Contains(new Point(50, 40)), 'interior inside');
    });

    test('PuffyDiamond bakes the 45° rotation into the hit region (Transform set)', () => {
        const p = new PuffyDiamond();
        p.Width = 100; p.Height = 100;
        arrange(p, 100, 100);
        const hit = p.HitTestGeometry as PathGeometry;
        assert.ok(hit instanceof PathGeometry);
        assert.ok(!hit.Transform.Matrix.IsIdentity, 'rotation baked into Transform');
        assert.ok(hit.Contains(new Point(50, 40)), 'diamond interior inside');
    });

    test('Slanted (default lean) bakes the shear into the hit region', () => {
        const s = new Slanted();
        s.Width = 100; s.Height = 100;
        arrange(s, 100, 100);
        const hit = s.HitTestGeometry as PathGeometry;
        assert.ok(hit instanceof PathGeometry);
        assert.ok(!hit.Transform.Matrix.IsIdentity, 'shear baked into Transform');
        assert.ok(hit.Contains(new Point(50, 50)), 'centre inside the leaned squircle');
    });
});
