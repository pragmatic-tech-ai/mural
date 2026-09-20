import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Color, Point, Rect, Size } from '../../runtime/index.js';
import { EllipseGeometry, Pen, PathGeometry, RectangleGeometry, SolidColorBrush } from '../../visual-engine/index.js';
import { Ellipse } from '../shapes/ellipse.js';
import { Rectangle } from '../shapes/rectangle.js';
import { Triangle } from '../shapes/triangle.js';
import { Cookie } from '../shapes/cookie.js';
import { Pill } from '../shapes/pill.js';
import { PixelArt } from '../shapes/pixel-shape.js';
import { Heart } from '../shapes/heart.js';
import { Squircle } from '../shapes/squircle.js';
import { Clover } from '../shapes/clover.js';

function arrange(shape: { Measure: (s: Size) => void; Arrange: (r: Rect) => void },
                 w: number, h: number): void
                 {
    shape.Measure(new Size(w, h));
    shape.Arrange(new Rect(0, 0, w, h));
}

function drawnGeometries(shape: { Render: (dc: never) => void }): unknown[]
{
    const geoms: unknown[] = [];
    shape.Render({
        DrawGeometry: (_b: unknown, _p: unknown, g: unknown) => geoms.push(g),
        DrawRectangle: () => {}, DrawText: () => {},
        PushTransform: () => {}, PushClip: () => {}, Pop: () => {},
    } as never);
    return geoms;
}

describe('Ellipse / Rectangle — stroke-inclusive hit outline', () => {
    test('Ellipse hit region is the un-inset slot ellipse (covers the stroke)', () => {
        const e = new Ellipse();
        e.Stroke = new Pen(new SolidColorBrush(Color.Black), 10);
        e.Width = 100; e.Height = 100;
        arrange(e, 100, 100);

        const hit = e.HitTestGeometry as EllipseGeometry;
        assert.ok(hit instanceof EllipseGeometry);
        assert.equal(hit.RadiusX, 50, 'un-inset radius = slot half-width');
        assert.equal(hit.RadiusY, 50);
        // A point on the stroke band (radius ~48, inside outer edge 50 but
        // outside the inset fill edge 45) is hittable.
        assert.ok(hit.Contains(new Point(50 + 48, 50)), 'stroke band is hittable');
        // A bbox corner is outside the ellipse.
        assert.ok(!hit.Contains(new Point(2, 2)), 'bbox corner falls through');
    });

    test('Ellipse still DRAWS the stroke-inset ellipse (render unchanged)', () => {
        const e = new Ellipse();
        e.Stroke = new Pen(new SolidColorBrush(Color.Black), 10);
        e.Width = 100; e.Height = 100;
        arrange(e, 100, 100);
        const geom = drawnGeometries(e)[0] as EllipseGeometry;
        assert.equal(geom.RadiusX, 45, 'drawn radius is inset by half-stroke');
    });

    test('Rectangle hit region is the un-inset slot rect (covers the stroke)', () => {
        const r = new Rectangle();
        r.Stroke = new Pen(new SolidColorBrush(Color.Black), 10);
        r.RadiusX = 4; r.RadiusY = 4;
        r.Width = 100; r.Height = 60;
        arrange(r, 100, 60);
        const hit = r.HitTestGeometry as RectangleGeometry;
        assert.ok(hit instanceof RectangleGeometry);
        assert.ok(hit.Rect.Equals(new Rect(0, 0, 100, 60)), 'un-inset full slot');
        assert.equal(hit.RadiusX, 4);
    });

    test('Rectangle still DRAWS the stroke-inset rect (render unchanged)', () => {
        const r = new Rectangle();
        r.Stroke = new Pen(new SolidColorBrush(Color.Black), 4);
        r.Width = 100; r.Height = 100;
        arrange(r, 100, 100);
        const geom = drawnGeometries(r)[0] as RectangleGeometry;
        assert.ok(geom.Rect.Equals(new Rect(2, 2, 96, 96)), 'drawn rect inset');
    });
});

describe('Catalog shapes batch A — outline hit region', () => {
    test('Triangle: apex-band point inside, empty top corner falls through', () => {
        const tri = new Triangle();
        tri.Width = 100; tri.Height = 100;
        arrange(tri, 100, 100);
        const hit = tri.HitTestGeometry as PathGeometry;
        assert.ok(hit instanceof PathGeometry);
        // Deep inside the triangle body.
        assert.ok(hit.Contains(new Point(50, 90)), 'inside the base');
        // Top-left bbox corner is outside a point-up triangle.
        assert.ok(!hit.Contains(new Point(5, 5)), 'empty corner falls through');
    });

    test('Cookie (hexagon) sets a PathGeometry hit region', () => {
        const c = new Cookie();
        c.Width = 100; c.Height = 100;
        arrange(c, 100, 100);
        assert.ok(c.HitTestGeometry instanceof PathGeometry);
        assert.ok(c.HitTestGeometry!.Contains(new Point(50, 50)), 'centre inside');
    });

    test('Pill sets a rounded-rect hit region covering its centre', () => {
        const p = new Pill();
        p.Width = 120; p.Height = 40;
        arrange(p, 120, 40);
        assert.ok(p.HitTestGeometry!.Contains(new Point(60, 20)));
    });

    test('PixelArt sets a multi-figure hit region', () => {
        const px = new PixelArt();
        px.Width = 64; px.Height = 64;
        arrange(px, 64, 64);
        assert.ok(px.HitTestGeometry instanceof PathGeometry);
        assert.ok(px.HitTestGeometry!.Contains(new Point(32, 32)), 'centre cell inside');
    });
});

describe('Catalog shapes batch B — outline hit region', () => {
    test('Heart: centre inside, top-centre notch/edge corner falls through', () => {
        const hrt = new Heart();
        hrt.Width = 100; hrt.Height = 100;
        arrange(hrt, 100, 100);
        const hit = hrt.HitTestGeometry as PathGeometry;
        assert.ok(hit instanceof PathGeometry);
        assert.ok(hit.Contains(new Point(50, 55)), 'body centre inside');
        assert.ok(!hit.Contains(new Point(50, 2)), 'top-centre valley notch falls through');
    });

    test('Heart: hit outline is stroke-inclusive (outer); paint insets by half the pen', () => {
        const hrt = new Heart();
        hrt.Stroke = new Pen(new SolidColorBrush(Color.Black), 10);
        hrt.Width = 100; hrt.Height = 100;
        arrange(hrt, 100, 100);
        const hit = (hrt.HitTestGeometry as PathGeometry).GetBounds();
        const paint = (drawnGeometries(hrt)[0] as PathGeometry).GetBounds();
        // Hit outline uses the full slot (inset 0); paint insets by t/2 = 5,
        // so the hit region is strictly larger than what is painted.
        assert.ok(hit.Width > paint.Width, 'hit outline wider than painted');
        assert.ok(hit.Height > paint.Height, 'hit outline taller than painted');
    });

    test('Squircle sets a PathGeometry hit region covering its centre', () => {
        const sq = new Squircle();
        sq.Width = 80; sq.Height = 80;
        arrange(sq, 80, 80);
        assert.ok(sq.HitTestGeometry instanceof PathGeometry);
        assert.ok(sq.HitTestGeometry!.Contains(new Point(40, 40)));
    });

    test('Clover sets a PathGeometry hit region; centre is inside', () => {
        const cl = new Clover();
        cl.Width = 100; cl.Height = 100;
        arrange(cl, 100, 100);
        assert.ok(cl.HitTestGeometry instanceof PathGeometry);
        assert.ok(cl.HitTestGeometry!.Contains(new Point(50, 50)), 'centre inside');
    });
});
