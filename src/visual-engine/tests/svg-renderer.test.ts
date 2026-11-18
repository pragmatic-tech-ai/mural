import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
    Application,
    Visual,
    Visibility,
    Size,
    Rect,
    Color,
    Point,
} from '../../runtime/index.js';
import { Border, Canvas, TextBlock } from '../../basic/index.js';
import {
    SvgRenderer,
    VISUAL_BACKREF,
    Pen,
    SolidColorBrush,
    PathGeometry,
    PathFigure,
    LineSegment,
} from '../index.js';

// Spin up a fresh JSDOM per test so document state doesn't leak. The
// renderer takes the `document` explicitly so tests don't need to
// patch globalThis.document — important because the existing test
// suite runs in Node where there's no DOM otherwise.
function makeDom(): { document: Document; surface: SVGSVGElement }
{
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const doc = dom.window.document;
    const surface = doc.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    doc.body.appendChild(surface);
    return { document: doc, surface };
}

describe('SvgRenderer — initial paint', () => {
    beforeEach(() => { Application.current = null; });

    test('creates one outer <g class="mural-visual"> per Visual', () => {
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });

        // Border > TextBlock, both arranged at non-zero offsets so
        // the transform path also exercises. Border with a Fill
        // and TextBlock with Text both emit own primitives so each
        // outer ends up with a mural-own child after the lazy-attach.
        const border = new Border();
        border.Fill = new SolidColorBrush(Color.FromHex('#4caf50'));
        const child  = new TextBlock('hi');
        border.SetChild(child);
        border.Measure(new Size(200, 80));
        border.Arrange(new Rect(0, 0, 200, 80));

        renderer.Render(border, undefined, null, null);

        const outers = surface.querySelectorAll('g.mural-visual');
        // Border + TextBlock = 2 outer groups.
        assert.equal(outers.length, 2);
        // Both Visuals paint, so each outer has a mural-own child
        // container. Layout-only Visuals (panels, presenters, etc.)
        // are covered by the "lazy-attach own" test below.
        for (const g of outers)
        {
            assert.equal(g.querySelector(':scope > g.mural-own') !== null, true);
        }
    });

    test('layout-only Visuals (no own primitives) get no mural-own group', () => {
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });

        // A bare Canvas paints nothing of its own — it's a pure layout
        // panel. Border with Fill paints a rect; TextBlock with
        // Text paints text. Expectation: 3 outer groups, 2 mural-own
        // (Border + TextBlock), zero on the Canvas.
        const canvas = new Canvas();
        const border = new Border();
        border.Fill = new SolidColorBrush(Color.FromHex('#4caf50'));
        border.Width = 10; border.Height = 10;
        Canvas.SetLeft(border, 0); Canvas.SetTop(border, 0);
        canvas.AddChild(border);
        const label = new TextBlock('hi');
        Canvas.SetLeft(label, 0); Canvas.SetTop(label, 20);
        canvas.AddChild(label);

        canvas.Measure(new Size(200, 200));
        canvas.Arrange(new Rect(0, 0, 200, 200));
        renderer.Render(canvas, undefined, null, null);

        const outers = surface.querySelectorAll('g.mural-visual');
        assert.equal(outers.length, 3);
        const owns = surface.querySelectorAll('g.mural-own');
        // Border + TextBlock paint own primitives; Canvas does not.
        assert.equal(owns.length, 2);

        // The Canvas's outer specifically has NO own child container.
        const canvasOuter = [...outers]
            .find(g => (g as unknown as { [k: symbol]: Visual })[VISUAL_BACKREF] === canvas)!;
        assert.equal(canvasOuter.querySelector(':scope > g.mural-own'), null);
    });

    test('stamps VISUAL_BACKREF on every outer <g> so hit-test can recover the Visual', () => {
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });

        const border = new Border();
        const child  = new TextBlock();
        border.SetChild(child);
        border.Measure(new Size(50, 50));
        border.Arrange(new Rect(0, 0, 50, 50));

        renderer.Render(border, undefined, null, null);

        const outers = [...surface.querySelectorAll('g.mural-visual')] as unknown as { [k: symbol]: Visual }[];
        const refs = outers.map(o => o[VISUAL_BACKREF]);
        // Two outer groups → two back-refs → the two visuals (in any order).
        assert.equal(refs.length, 2);
        assert.ok(refs.includes(border));
        assert.ok(refs.includes(child));
    });

    test('Opacity defaults to 1 — no opacity attribute on outer', () => {
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });

        const border = new Border();
        border.Measure(new Size(50, 50));
        border.Arrange(new Rect(0, 0, 50, 50));

        renderer.Render(border, undefined, null, null);

        const outer = surface.querySelector('g.mural-visual');
        assert.ok(outer);
        assert.equal(outer.hasAttribute('opacity'), false);
    });

    test('Opacity < 1 lands on the outer <g> as the opacity attribute', () => {
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });

        const border = new Border();
        border.Opacity = 0.5;
        border.Measure(new Size(50, 50));
        border.Arrange(new Rect(0, 0, 50, 50));

        renderer.Render(border, undefined, null, null);

        const outer = surface.querySelector('g.mural-visual');
        assert.ok(outer);
        assert.equal(outer.getAttribute('opacity'), '0.5');
    });

    test('Opacity is clamped to [0,1] before emission', () => {
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });

        const border = new Border();
        border.Opacity = 1.5;
        border.Measure(new Size(50, 50));
        border.Arrange(new Rect(0, 0, 50, 50));

        renderer.Render(border, undefined, null, null);

        const outer = surface.querySelector('g.mural-visual');
        assert.ok(outer);
        // Clamped back to 1 → attribute omitted.
        assert.equal(outer.hasAttribute('opacity'), false);

        border.Opacity = -0.3;
        renderer.Render(border, undefined, new Set([border]), new Set());
        assert.equal(outer.getAttribute('opacity'), '0');
    });

    test('translate transform appears on outer when ArrangedRect.X/Y are non-zero', () => {
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });

        const canvas = new Canvas();
        const tile = new Border();
        // Use Canvas.Left/Top attached props to position the child.
        Canvas.SetLeft(tile, 17);
        Canvas.SetTop (tile, 23);
        tile.Width = 10;
        tile.Height = 10;
        canvas.AddChild(tile);
        canvas.Measure(new Size(200, 200));
        canvas.Arrange(new Rect(0, 0, 200, 200));

        renderer.Render(canvas, undefined, null, null);

        // Find the tile's outer group via the back-ref so we don't
        // rely on DOM order.
        const tileOuter = [...surface.querySelectorAll('g.mural-visual')]
            .find(g => (g as unknown as { [k: symbol]: Visual })[VISUAL_BACKREF] === tile)!;
        assert.equal(tileOuter.getAttribute('transform'), 'translate(17,23)');
    });
});

describe('SvgRenderer — incremental updates', () => {
    beforeEach(() => { Application.current = null; });

    test('preserves DOM identity across re-renders (outer <g> instance stable)', () => {
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });

        const border = new Border();
        border.Fill = new SolidColorBrush(Color.FromHex('#4caf50'));
        border.Measure(new Size(100, 30));
        border.Arrange(new Rect(0, 0, 100, 30));

        renderer.Render(border, undefined, null, null);
        const firstPass = surface.querySelector('g.mural-visual');
        assert.ok(firstPass);

        // Mark render-dirty: change Fill, then re-render with
        // an explicit renderDirty Set including this visual.
        border.Fill = new SolidColorBrush(Color.FromHex('#d32f2f'));
        renderer.Render(border, undefined, new Set([border]), new Set());

        const secondPass = surface.querySelector('g.mural-visual');
        // SAME DOM node — the renderer didn't recreate it; it cleared
        // the inner `mural-own` group and re-emitted primitives.
        assert.equal(firstPass, secondPass);

        // The new fill is reflected in the painted rect.
        const fill = secondPass!.querySelector('g.mural-own rect')?.getAttribute('fill');
        assert.equal(fill, 'rgb(211,47,47)');
    });

    test('arrange-dirty re-applies the translate transform without touching own primitives', () => {
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });

        const canvas = new Canvas();
        const tile = new Border();
        tile.Fill = new SolidColorBrush(Color.FromHex('#4caf50'));
        Canvas.SetLeft(tile, 0);
        Canvas.SetTop (tile, 0);
        tile.Width = 20;
        tile.Height = 20;
        canvas.AddChild(tile);
        canvas.Measure(new Size(400, 400));
        canvas.Arrange(new Rect(0, 0, 400, 400));
        renderer.Render(canvas, undefined, null, null);

        // Capture the own group reference so we can verify it's the
        // SAME element after an arrange-only update (no clearing).
        const tileOuter = [...surface.querySelectorAll('g.mural-visual')]
            .find(g => (g as unknown as { [k: symbol]: Visual })[VISUAL_BACKREF] === tile)!;
        const tileOwn = tileOuter.querySelector('g.mural-own')!;
        const tileOwnChild = tileOwn.firstChild;
        assert.ok(tileOwnChild);

        // Move the tile and re-arrange. Canvas.SetLeft alone doesn't
        // invalidate the canvas's arrange cache (the attached prop
        // doesn't ride through the regular DP-invalidation path for
        // the owner Visual), so an explicit InvalidateArrange on the
        // canvas forces a re-arrange of children.
        Canvas.SetLeft(tile, 50);
        Canvas.SetTop (tile, 60);
        canvas.InvalidateArrange();
        canvas.Arrange(new Rect(0, 0, 400, 400));
        renderer.Render(canvas, undefined, new Set(), new Set([tile]));

        assert.equal(tileOuter.getAttribute('transform'), 'translate(50,60)');
        // Own group's first child is the SAME rect element (re-emit
        // didn't fire because tile wasn't render-dirty).
        assert.equal(tileOwn.firstChild, tileOwnChild);
    });

    test('removed visual gets its outer <g> detached and dropped from the map', () => {
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });

        const canvas = new Canvas();
        const a = new Border();
        const b = new Border();
        canvas.AddChild(a);
        canvas.AddChild(b);
        canvas.Measure(new Size(200, 200));
        canvas.Arrange(new Rect(0, 0, 200, 200));
        renderer.Render(canvas, undefined, null, null);

        // Three outers: canvas, a, b.
        assert.equal(surface.querySelectorAll('g.mural-visual').length, 3);

        canvas.RemoveChild(b);
        canvas.Measure(new Size(200, 200));
        canvas.Arrange(new Rect(0, 0, 200, 200));
        renderer.Render(canvas, undefined, null, null);

        // Two outers remain: canvas + a. b's outer was reaped.
        assert.equal(surface.querySelectorAll('g.mural-visual').length, 2);
        const refs = [...surface.querySelectorAll('g.mural-visual')]
            .map(g => (g as unknown as { [k: symbol]: Visual })[VISUAL_BACKREF]);
        assert.ok(refs.includes(canvas));
        assert.ok(refs.includes(a));
        assert.ok(!refs.includes(b));
    });
});

describe('SvgRenderer — visual-tree reparent', () => {
    beforeEach(() => { Application.current = null; });

    // A Visual moved to a NEW visual parent AFTER its first render must have its
    // outer <g> RELOCATED under the new parent's DOM group — otherwise the SVG
    // DOM diverges from the visual tree and ancestor transforms stop composing
    // onto the moved subtree (the board-container "children don't follow the
    // container" bug). Mirrors ContainerPlacement.reparent: RemoveVisualChild
    // from the old host, AddVisualChild into the new one.
    test('moving a child to a new visual parent relocates its outer <g> in the DOM', () => {
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });

        const root = new Canvas();
        const box  = new Canvas();          // stands in for the container's ChildHost
        Canvas.SetLeft(box, 100); Canvas.SetTop(box, 100);
        box.Width = 200; box.Height = 200;
        const leaf = new Border();
        leaf.Fill = new SolidColorBrush(Color.FromHex('#4caf50'));
        Canvas.SetLeft(leaf, 10); Canvas.SetTop(leaf, 10);
        leaf.Width = 20; leaf.Height = 20;
        root.AddChild(box);
        root.AddChild(leaf);
        root.Measure(new Size(400, 400));
        root.Arrange(new Rect(0, 0, 400, 400));
        renderer.Render(root, undefined, null, null);

        const outerOf = (v: Visual) => [...surface.querySelectorAll('g.mural-visual')]
            .find(g => (g as unknown as { [k: symbol]: Visual })[VISUAL_BACKREF] === v)!;
        const boxOuter  = outerOf(box);
        const leafOuter = outerOf(leaf);

        // Initially the leaf is a sibling of the box under root — NOT nested.
        assert.equal(boxOuter.contains(leafOuter), false, 'leaf starts outside the box');

        // Reparent leaf into box (visual-tree move, exactly like ContainerPlacement).
        root.RemoveVisualChild(leaf);
        box.AddVisualChild(leaf);
        root.Measure(new Size(400, 400));
        root.Arrange(new Rect(0, 0, 400, 400));
        renderer.Render(root, undefined, null, null);

        // Same outer <g> instance (DOM identity preserved), now a descendant of
        // the box's outer group so the box's transform composes onto it.
        assert.equal(outerOf(leaf), leafOuter, 'leaf outer <g> is the same element');
        assert.equal(boxOuter.contains(leafOuter), true, 'leaf outer <g> moved under the box');
    });
});

describe('SvgRenderer — back-ref → hit-test integration', () => {
    beforeEach(() => { Application.current = null; });

    test('walking from a painted node up to a g.mural-visual recovers the Visual', () => {
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });

        const border = new Border();
        border.Fill = new SolidColorBrush(Color.FromHex('#4caf50'));
        border.Width = 40;
        border.Height = 40;
        border.Measure(new Size(40, 40));
        border.Arrange(new Rect(0, 0, 40, 40));
        renderer.Render(border, undefined, null, null);

        // Pick any painted primitive (the rect inside the own group)
        // and walk ancestors — same path HtmlTarget.HitTest takes.
        const rect = surface.querySelector('g.mural-own rect');
        assert.ok(rect);
        let cur: Node | null = rect;
        let recovered: Visual | undefined;
        while (cur !== null)
        {
            const back = (cur as unknown as { [k: symbol]: Visual })[VISUAL_BACKREF];
            if (back !== undefined) { recovered = back; break; }
            cur = cur.parentNode;
        }
        assert.equal(recovered, border);
    });
});

describe('SvgRenderer — visibility gate', () => {
    beforeEach(() => { Application.current = null; });

    test('toggling Visibility drives display and leaves it clean while visible', () => {
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });

        const border = new Border();
        border.Fill = new SolidColorBrush(Color.FromHex('#4caf50'));
        border.Measure(new Size(50, 50));
        border.Arrange(new Rect(0, 0, 50, 50));

        // Visible: no display attribute.
        renderer.Render(border, undefined, null, null);
        const outer = surface.querySelector('g.mural-visual')!;
        assert.equal(outer.getAttribute('display'), null);

        // Re-render while still visible: the guard must not add a display attr.
        renderer.Render(border, undefined, null, null);
        assert.equal(outer.getAttribute('display'), null);

        // Hidden → display="none".
        border.Visibility = Visibility.Hidden;
        renderer.Render(border, undefined, null, null);
        assert.equal(outer.getAttribute('display'), 'none');

        // Visible again → attribute cleared.
        border.Visibility = Visibility.Visible;
        renderer.Render(border, undefined, null, null);
        assert.equal(outer.getAttribute('display'), null);
    });
});

describe('SvgRenderer — path-shaped subtree clip', () => {
    beforeEach(() => { Application.current = null; });

    test('a PathGeometry Clip emits a <clipPath> with a <path> and references it on the outer group', () => {
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });

        const border = new Border();
        border.Fill = new SolidColorBrush(Color.FromHex('#4caf50'));
        // Triangle path clip in the Visual's local space.
        const figure = new PathFigure(new Point(0, 0), [
            new LineSegment(new Point(100, 0)),
            new LineSegment(new Point(50, 80)),
        ], true);
        border.Clip = new PathGeometry([figure]);
        border.Measure(new Size(100, 80));
        border.Arrange(new Rect(0, 0, 100, 80));

        renderer.Render(border, undefined, null, null);

        const outer = surface.querySelector('g.mural-visual');
        assert.ok(outer, 'outer group exists');
        assert.ok(outer!.getAttribute('clip-path'), 'outer group references a clip-path');

        const clipPathEl = surface.querySelector('clipPath > path');
        assert.ok(clipPathEl, 'the <clipPath> contains a <path> for the PathGeometry');
        assert.ok(clipPathEl!.getAttribute('d'), 'the clip <path> carries d path-data');
    });
});

describe('SvgRenderer — ClipToBounds children group', () => {
    beforeEach(() => { Application.current = null; });

    test('ChildClip hosts children in a clipped mural-children group; own paint stays out', () => {
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });

        const border = new Border();
        border.Fill = new SolidColorBrush(Color.FromHex('#ffffff'));
        border.Stroke = new Pen(new SolidColorBrush(Color.FromHex('#000000')), 8);
        border.ClipToBounds = true;
        const child = new Border();
        child.Fill = new SolidColorBrush(Color.FromHex('#4caf50'));
        border.SetChild(child);
        border.Measure(new Size(100, 100));
        border.Arrange(new Rect(0, 0, 100, 100));

        renderer.Render(border, undefined, null, null);

        const group = surface.querySelector('g.mural-children');
        assert.ok(group, 'mural-children group exists');
        assert.ok(group!.getAttribute('clip-path'), 'the group is clipped');
        // The child outer lives inside the clipped group.
        assert.ok(group!.querySelector(':scope > g.mural-visual'), 'child outer is inside the group');
        // The Border's own paint is a sibling of the group, not inside it.
        const rootOuter = surface.querySelector('g.mural-visual')!;
        const own = rootOuter.querySelector(':scope > g.mural-own');
        assert.ok(own, 'own paint group exists');
        assert.equal(group!.contains(own!), false, 'own paint stays outside the clipped group');
    });

    test('toggling ClipToBounds off moves children back and removes the group', () => {
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });

        const border = new Border();
        border.Stroke = new Pen(new SolidColorBrush(Color.FromHex('#000000')), 8);
        border.ClipToBounds = true;
        border.SetChild(new Border());
        border.Measure(new Size(100, 100));
        border.Arrange(new Rect(0, 0, 100, 100));
        renderer.Render(border, undefined, null, null);
        assert.ok(surface.querySelector('g.mural-children'), 'group present when on');

        border.ClipToBounds = false;
        border.Measure(new Size(100, 100));
        border.Arrange(new Rect(0, 0, 100, 100));
        renderer.Render(border, undefined, null, null);
        assert.equal(surface.querySelector('g.mural-children'), null, 'group removed when off');
        const rootOuter = surface.querySelector('g.mural-visual')!;
        assert.ok(rootOuter.querySelector(':scope > g.mural-visual'), 'child outer back under the outer group');
    });
});
