import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { Application, Size, Rect } from '../../runtime/index.js';
import { DomHost } from '../dom-host.js';
import { SvgRenderer } from '../../visual-engine/index.js';

// Fresh JSDOM per test (matches svg-renderer.test.ts). The renderer takes the
// document explicitly; DomHost.OwnerDocument is pointed at the SAME document so
// the host <div> and the surface share one document (Node has no global DOM).
function makeDom(): { document: Document; surface: SVGSVGElement }
{
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const doc = dom.window.document;
    const surface = doc.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    doc.body.appendChild(surface);
    return { document: doc, surface };
}

function arrangedHost(document: Document, w: number, h: number): DomHost
{
    const host = new DomHost();
    host.OwnerDocument = document;
    // Materialise the host element (a consumer would do this to mount into it).
    host.HostElement;
    host.Measure(new Size(w, h));
    host.Arrange(new Rect(0, 0, w, h));
    return host;
}

describe('DomHost — foreignObject hosting', () => {
    beforeEach(() => { Application.current = null; });

    test('renders a <foreignObject> wrapping HostElement, sized to the arrange box', () => {
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });
        const host = arrangedHost(document, 400, 300);

        renderer.Render(host, undefined, null, null);

        const fo = surface.querySelector('foreignObject');
        assert.ok(fo !== null, 'a <foreignObject> is emitted');
        assert.equal(fo.getAttribute('width'), '400');
        assert.equal(fo.getAttribute('height'), '300');
        assert.equal(fo.firstChild, host.HostElement, 'HostElement is the foreignObject child');
        // Parked in the outer group (survives repaint), NOT inside mural-own.
        assert.equal(fo.parentElement?.classList.contains('mural-visual'), true);
    });

    test('a render-only repaint keeps the SAME foreignObject + HostElement', () => {
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });
        const host = arrangedHost(document, 200, 100);
        renderer.Render(host, undefined, null, null);
        const before = surface.querySelector('foreignObject');
        const el = host.HostElement;

        // Render-only invalidation targeting the host.
        renderer.Render(host, undefined, new Set([host]), new Set());

        const after = surface.querySelector('foreignObject');
        assert.equal(after, before, 'same <foreignObject> node — not recreated');
        assert.equal(after?.firstChild, el, 'same HostElement — the embed is preserved');
        assert.equal(surface.querySelectorAll('foreignObject').length, 1, 'no duplicate created');
    });

    test('resizing re-sizes the same foreignObject', () => {
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });
        const host = arrangedHost(document, 200, 100);
        renderer.Render(host, undefined, null, null);

        host.Arrange(new Rect(0, 0, 320, 240));
        renderer.Render(host, undefined, new Set(), new Set([host]));

        const fo = surface.querySelector('foreignObject');
        assert.equal(fo?.getAttribute('width'), '320');
        assert.equal(fo?.getAttribute('height'), '240');
    });

    test('a subclass overrides CreateHostElement to host its own content', () => {
        // A subclass builds on the base slot-filling div and mounts its own
        // element into it — the pattern real embeds (a Monaco editor) use.
        class TaggedHost extends DomHost
        {
            protected override CreateHostElement(document: Document): HTMLElement
            {
                const el = super.CreateHostElement(document);
                const child = document.createElement('span');
                child.className = 'embedded-content';
                el.appendChild(child);
                return el;
            }
        }
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });
        const host = new TaggedHost();
        host.OwnerDocument = document;
        host.HostElement;
        host.Measure(new Size(120, 80));
        host.Arrange(new Rect(0, 0, 120, 80));

        renderer.Render(host, undefined, null, null);

        const fo = surface.querySelector('foreignObject');
        assert.ok(fo !== null, 'the subclass host still renders through a foreignObject');
        // Base styling is preserved (the subclass called super) and its content is inside.
        assert.equal(host.HostElement.style.width, '100%');
        assert.equal(fo.querySelector('.embedded-content') !== null, true, 'subclass content is hosted');
    });

    test('a host materialised AFTER first paint still gets a foreignObject on the next render', () => {
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });
        // First paint BEFORE the consumer mounts anything: no host element yet.
        const host = new DomHost();
        host.OwnerDocument = document;
        host.Measure(new Size(150, 90));
        host.Arrange(new Rect(0, 0, 150, 90));
        renderer.Render(host, undefined, null, null);
        assert.equal(surface.querySelector('foreignObject'), null, 'no foreignObject before the host element exists');

        // Consumer mounts → host element materialises → next render wraps it.
        host.HostElement;
        renderer.Render(host, undefined, new Set([host]), new Set());

        const fo = surface.querySelector('foreignObject');
        assert.ok(fo !== null, 'foreignObject appears once the host element exists');
        assert.equal(fo.getAttribute('width'), '150');
        assert.equal(fo.getAttribute('height'), '90');
    });
});
