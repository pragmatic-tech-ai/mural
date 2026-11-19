// Root-cause probe: a Border-templated figure (TextNode / ContainerFigure) must
// paint an outline whose colour AND width follow its Stroke pen — the pen the
// Format Shape editor writes. Renders the figure to SVG with a thick red stroke
// and inspects the emitted stroke/stroke-width.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Size, Rect } from '../../../runtime/index.js';
import { Color, Pen, SolidColorBrush, SvgRenderer } from '../../../visual-engine/index.js';
import { Figure } from '../figure.js';
import '../text-node.js';
import '../container-figure.js';

// Render the figure DIRECTLY (a theme is applied by initTestApp, so RenderSize is
// non-zero) — the same path figure-render.test.ts uses to prove a shape Figure
// self-paints its silhouette. A box node paints its rounded-rect card in
// RenderOverride, so its Stroke pen must reach the SVG.
function renderKind(kind: string): string
{
    const fig = Figure.fromKind(kind, 40, 40, { width: 160, height: 90 });
    (fig as unknown as { Stroke: Pen }).Stroke = new Pen(new SolidColorBrush(Color.FromHex('#ff0000')), 4);
    fig.Measure(new Size(160, 90));
    fig.Arrange(new Rect(0, 0, 160, 90));

    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const svg = dom.window.document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    dom.window.document.body.appendChild(svg);
    const renderer = new SvgRenderer(svg, { document: dom.window.document });
    renderer.Render(fig, undefined, null, null);
    return svg.outerHTML;
}

describe('annotate figures paint their Stroke pen (colour + width)', () => {
    beforeEach(() => { initTestApp(); });

    for (const kind of ['text', 'container'])
    {
        test(`${kind}: rendered outline reflects the Stroke pen (#ff0000, width 4)`, () => {
            const svg = renderKind(kind);
            // The SvgRenderer emits colours as rgb(...) (not hex); accept either.
            const hasRed = /stroke="(#ff0000|red|rgb\(255,\s*0,\s*0\))/i.test(svg);
            const hasWidth4 = /stroke-width="4|stroke-width:\s*4/i.test(svg);
            assert.ok(hasRed, `${kind}: outline should paint the pen brush (#ff0000). SVG had no red stroke.`);
            assert.ok(hasWidth4, `${kind}: outline width should follow the pen thickness (4).`);
        });
    }
});
