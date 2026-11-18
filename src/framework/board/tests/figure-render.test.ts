import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Size, Rect } from '../../../runtime/index.js';
import { PathGeometry, RectangleGeometry, SvgRenderer, type Geometry } from '../../../visual-engine/index.js';
import { Figure } from '../figure.js';

// The design contract lives on the geometry seams the inherited Visual paint +
// child-clip read: buildPaintGeometry (own paint), buildChildClipGeometry
// (children mask), buildClipGeometry (hit / clip-to-bounds). A catalog Figure
// surfaces its scaled silhouette (a PathGeometry) through all three; a shapeless
// container falls back to the base bounds rect (a RectangleGeometry) and paints
// nothing (RenderOverride guard).
//
// Own-paint emission is NOT covered by the base Visual/Border tests: Figure's
// chain runs Figure → ContentControl → Control, and Control.RenderOverride is a
// deliberate no-op (the template subtree paints itself). So Figure must draw its
// silhouette itself in RenderOverride — a `super` delegation would paint nothing
// (the "figures render as empty boxes" regression). The DOM test at the bottom
// renders through the real SvgRenderer (with a theme, so RenderSize > 0) to guard
// that; a headless Figure without a theme has RenderSize 0 and can't.

interface Seams
{
    buildPaintGeometry(size: Size, inset: number): Geometry;
    buildClipGeometry(size: Size): Geometry;
    buildChildClipGeometry(size: Size): Geometry | undefined;
}
const seams = (f: Figure): Seams => f as unknown as Seams;

test('a catalog Figure surfaces its silhouette (a PathGeometry) as paint + clip geometry', () => {
    const f = Figure.fromKind('ellipse', 0, 0, { width: 80, height: 60 });
    f.Width = 80; f.Height = 60;
    const paint = seams(f).buildPaintGeometry(new Size(80, 60), 0);
    const clip = seams(f).buildClipGeometry(new Size(80, 60));
    assert.ok(paint instanceof PathGeometry, 'paint geometry is the silhouette, not a bounds rect');
    assert.ok(clip instanceof PathGeometry);
    const b = paint.GetBounds();
    assert.ok(Math.abs(b.Width - 80) < 1 && Math.abs(b.Height - 60) < 1);
});

test('a bare Figure has no shape: clips its content to the bounds rect (ClipToBounds default true)', () => {
    const f = new Figure();
    assert.equal(f.ClipToBounds, true);
    assert.equal(f._getSource(), undefined);
    const paint = seams(f).buildPaintGeometry(new Size(40, 40), 0);
    assert.ok(paint instanceof RectangleGeometry, 'no silhouette → base bounds rect (guard paints nothing)');
    const childClip = seams(f).buildChildClipGeometry(new Size(40, 40));
    assert.ok(childClip instanceof RectangleGeometry, 'shapeless node clips children to the bounds rect');
});

test('a shaped Figure turns ClipToBounds on and clips children to the silhouette', () => {
    const f = Figure.fromKind('ellipse', 0, 0, { width: 80, height: 60 });
    f.Width = 80; f.Height = 60;
    assert.equal(f.ClipToBounds, true);
    const childClip = seams(f).buildChildClipGeometry(new Size(80, 60));
    assert.ok(childClip instanceof PathGeometry);
});

test('resize rescales the silhouette', () => {
    const f = Figure.fromKind('rectangle', 0, 0, { width: 40, height: 40 });
    f.Width = 120; f.Height = 30;
    const b = seams(f).buildPaintGeometry(new Size(120, 30), 0).GetBounds();
    assert.ok(Math.abs(b.Width - 120) < 1 && Math.abs(b.Height - 30) < 1);
});

// Regression: a shaped Figure, arranged with a theme (RenderSize > 0) and painted
// through the real renderer, MUST emit a filled silhouette path. Before the fix
// RenderOverride delegated to super (Control's no-op) and drew nothing — the node
// rendered as an empty box (only its hit pad + template content, no silhouette).
test('a shaped Figure renders a filled silhouette path through the SvgRenderer', () => {
    initTestApp();
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const doc = dom.window.document;
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    doc.body.appendChild(svg);
    const renderer = new SvgRenderer(svg, { document: doc });

    const f = Figure.fromKind('ellipse', 0, 0, { width: 80, height: 60 });
    f.Measure(new Size(80, 60));
    f.Arrange(new Rect(0, 0, 80, 60));
    assert.ok(f.RenderSize.Width > 0 && f.RenderSize.Height > 0, 'theme applied → non-zero RenderSize');

    renderer.Render(f, undefined, null, null);

    const painted = [...svg.querySelectorAll('path')].some(
        (p) => (p.getAttribute('d') ?? '').length > 0
            && p.getAttribute('fill') !== null
            && p.getAttribute('fill') !== 'none',
    );
    assert.ok(painted, 'figure must emit a filled silhouette path, not an empty box');
});
