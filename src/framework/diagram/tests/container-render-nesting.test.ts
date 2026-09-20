// Integration guard for the "children don't follow the container" bug: a child
// Figure nested into a container (ContainerPlacement → the container's ChildHost)
// must render with its outer <g> as a DOM DESCENDANT of the container's outer
// <g>, so the container's transform composes onto it and moving the container
// moves the child. The pure placement tests assert the VISUAL tree
// (GetVisualParent / ContainerParent); this asserts the RENDERED SVG DOM, the
// gap that let the regression through.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { ObservableCollection, Size, Rect, type Visual } from '../../../runtime/index.js';
import { Border, ItemsPanelTemplate } from '../../../basic/index.js';
import { PaginatedCanvas } from '../../../basic/panels/paginated-canvas.js';
import { SvgRenderer, VISUAL_BACKREF } from '../../../visual-engine/index.js';
import { Diagram } from '../diagram.js';
import { Figure } from '../figure.js';
import { ContainerFigure } from '../container-figure.js';

function makeDom(): { document: Document; surface: SVGSVGElement }
{
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const d = dom.window.document;
    const surface = d.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    d.body.appendChild(surface);
    return { document: d, surface };
}

const outerOf = (surface: SVGSVGElement, v: Visual): SVGElement | undefined =>
    [...surface.querySelectorAll('g.mural-visual')]
        .find(g => (g as unknown as { [k: symbol]: Visual })[VISUAL_BACKREF] === v) as SVGElement | undefined;

describe('diagram container — child renders nested in the DOM and follows a move', () => {
    beforeEach(() => { initTestApp(); });

    function build(): { surface: Border; diagram: Diagram; container: ContainerFigure; child: Figure }
    {
        const diagram = new Diagram();
        diagram.ItemsPanel = new ItemsPanelTemplate(() => new PaginatedCanvas());
        const surface = new Border();
        surface.SetChild(diagram);

        const container = new ContainerFigure();
        container.Id = 'C'; container.Left = 200; container.Top = 200; container.Width = 260; container.Height = 220;
        const child = Figure.fromKind('rectangle', 40, 60, { width: 80, height: 80 });
        child.Id = 'n1';
        child.ParentId = 'C';   // declare membership so placeAll nests it

        const col = new ObservableCollection<Figure>();
        col.Add(container); col.Add(child);
        diagram.ItemsSource = col;

        surface.Measure(new Size(900, 700));
        surface.Arrange({ X: 0, Y: 0, Width: 900, Height: 700 } as never);
        diagram.ContainerPlacement.placeAll();   // nest child into the container's ChildHost
        return { surface, diagram, container, child };
    }

    test('nested child outer <g> is a DOM descendant of the container outer <g>', () => {
        const { surface, container, child } = build();
        assert.equal(child.ContainerParent, container, 'precondition: child is nested in the visual tree');

        const { document, surface: svgSurface } = makeDom();
        const renderer = new SvgRenderer(svgSurface, { document });
        renderer.Render(surface as unknown as Visual, undefined, null, null);

        const contOuter = outerOf(svgSurface, container)!;
        const childOuter = outerOf(svgSurface, child)!;
        assert.ok(contOuter, 'container is rendered');
        assert.ok(childOuter, 'child is rendered');
        assert.equal(contOuter.contains(childOuter), true,
            'child outer <g> renders nested inside the container outer <g>');
    });

    test('moving the container keeps the child nested and shifts the container transform', () => {
        const { surface, diagram, container, child } = build();

        const { document, surface: svgSurface } = makeDom();
        const renderer = new SvgRenderer(svgSurface, { document });
        renderer.Render(surface as unknown as Visual, undefined, null, null);

        const contOuter = outerOf(svgSurface, container)!;
        const childOuter = outerOf(svgSurface, child)!;
        const beforeTransform = contOuter.getAttribute('transform');

        // Move the container. The child's parent-relative Left/Top do NOT change;
        // its on-screen position rides on the container's composed transform.
        container.Left = 480; container.Top = 360;
        surface.Measure(new Size(900, 700));
        surface.Arrange({ X: 0, Y: 0, Width: 900, Height: 700 } as never);
        renderer.Render(surface as unknown as Visual, undefined, null, null);

        // Same elements (DOM identity preserved), child still nested, container
        // translate reflects the new position.
        assert.equal(outerOf(svgSurface, container), contOuter, 'container outer <g> stable');
        assert.equal(outerOf(svgSurface, child), childOuter, 'child outer <g> stable');
        assert.equal(contOuter.contains(childOuter), true, 'child stays nested after the move');
        assert.notEqual(contOuter.getAttribute('transform'), beforeTransform, 'container transform shifted');
        assert.equal(contOuter.getAttribute('transform'), 'translate(480,360)', 'container at its new position');
    });
});
