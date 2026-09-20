import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Application, Visual, Size, Rect, Panel } from '../../runtime/index.js';
import { Border, Canvas } from '../../basic/index.js';
import { SvgRenderer, VISUAL_BACKREF } from '../index.js';

function makeDom(): { document: Document; surface: SVGSVGElement }
{
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const doc = dom.window.document;
    const surface = doc.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    doc.body.appendChild(surface);
    return { document: doc, surface };
}

function outerOf(surface: SVGSVGElement, v: Visual): Element | null
{
    for (const g of surface.querySelectorAll('g.mural-visual'))
        if ((g as unknown as { [VISUAL_BACKREF]?: Visual })[VISUAL_BACKREF] === v) return g;
    return null;
}

describe('SvgRenderer — ZIndex DOM order', () => {
    beforeEach(() => { Application.current = null; });

    test('reordering children by ZIndex moves the outer <g>', () => {
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });
        const canvas = new Canvas();
        const a = new Border(); const b = new Border();
        canvas.AddChild(a); canvas.AddChild(b);
        canvas.Measure(new Size(200, 200));
        canvas.Arrange(new Rect(0, 0, 200, 200));
        renderer.Render(canvas, undefined, null, null);

        const canvasOuter = outerOf(surface, canvas)!;
        const order1 = [...canvasOuter.querySelectorAll(':scope > g.mural-visual')];
        assert.equal(order1[0], outerOf(surface, a));
        assert.equal(order1[1], outerOf(surface, b));

        Panel.SetZIndex(a, 1);                       // bring a to front -> paints last
        renderer.Render(canvas, undefined, null, null);
        const order2 = [...canvasOuter.querySelectorAll(':scope > g.mural-visual')];
        assert.equal(order2[0], outerOf(surface, b));
        assert.equal(order2[1], outerOf(surface, a));
    });

    test('a render with unchanged order issues no DOM move', () => {
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });
        const canvas = new Canvas();
        canvas.AddChild(new Border()); canvas.AddChild(new Border());
        canvas.Measure(new Size(200, 200));
        canvas.Arrange(new Rect(0, 0, 200, 200));
        renderer.Render(canvas, undefined, null, null);

        const canvasOuter = outerOf(surface, canvas)! as unknown as {
            insertBefore(node: Node, ref: Node | null): Node;
        };
        let moves = 0;
        const orig = canvasOuter.insertBefore.bind(canvasOuter);
        canvasOuter.insertBefore = (node: Node, ref: Node | null) => { moves++; return orig(node, ref); };
        renderer.Render(canvas, undefined, null, null);   // identical order
        assert.equal(moves, 0);
    });
});
