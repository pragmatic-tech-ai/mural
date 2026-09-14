// Port adorners follow the figure the cursor is over. When two figures OVERLAP,
// the pick must respect true paint z-order (Panel.ZIndex), not collection order:
// a figure sent to a LOWER z (Send-to-Back) must not steal the topmost figure's
// port adorners just because it sits later in the items collection. This mirrors
// the connector-vs-figure overlap fix — trust the true z, not the position.
//
// Deliberately lightweight: findFigureAtCanvasPoint only reads ItemsSource +
// Generator.ContainerFromItem, so we drive it with a tiny stub and two figures
// arranged directly — no Diagram, Canvas, surface, or full layout pass to
// allocate.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { ObservableCollection, Panel, Point, Rect, Size } from '../../../runtime/index.js';
import { Figure } from '../figure.js';
import { ContainerFigure } from '../container-figure.js';
import { Diagram } from '../diagram.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { findFigureAtCanvasPoint } from '../behaviors/connector-interactions-behavior.js';

// A minimal stand-in for the two members findFigureAtCanvasPoint touches. The
// items ARE the figures here, so ContainerFromItem is identity.
function stubDiagram(figs: Figure[]): Diagram {
    const items = new ObservableCollection<Figure>();
    for (const f of figs) items.Add(f);
    return {
        ItemsSource: items,
        Generator: { ContainerFromItem: (it: unknown): unknown => it },
    } as unknown as Diagram;
}

// A figure at (x,y) sized 40x30, arranged directly (no layout tree), with an
// explicit paint z.
function fig(x: number, y: number, z: number): Figure {
    const f = Figure.fromKind('rectangle', x, y, { width: 40, height: 30 });
    f.Measure(new Size(40, 30));
    f.Arrange(new Rect(x, y, 40, 30));
    Panel.SetZIndex(f, z);
    return f;
}

describe('figure hover pick respects paint z-order under overlap', () => {
    beforeEach(() => { initTestApp(); });

    test('the higher Panel.ZIndex figure wins, not the later-in-collection one', () => {
        // `top` is added FIRST (earlier iteration) but raised ABOVE `bottom`.
        // The old iteration-order pick returned `bottom` (later ⇒ higher index);
        // the z-order pick must return `top`.
        const top    = fig(10, 10, 5);   // bbox (10,10)-(50,40)
        const bottom = fig(20, 20, -1);  // bbox (20,20)-(60,50); overlaps at (20,20)-(50,40)

        const hit = findFigureAtCanvasPoint(stubDiagram([top, bottom]), new Point(30, 30));
        assert.equal(hit, top, 'topmost by Panel.ZIndex wins regardless of collection order');
    });

    test('equal z falls to the later sibling (matches within-z paint order)', () => {
        const first  = fig(10, 10, 0);
        const second = fig(20, 20, 0);

        const hit = findFigureAtCanvasPoint(stubDiagram([first, second]), new Point(30, 30));
        assert.equal(hit, second, 'equal-z tie goes to the later sibling');
    });
});

// Container-nested nodes live flat in ItemsSource but carry PARENT-RELATIVE
// Left/Top; the pick must resolve them through diagramSpaceRect (canvas coords),
// not by comparing the cursor against parent-relative coords — the reason nested
// nodes were invisible to this scan and its drag drop-target callers.
describe('figure hover pick sees container-nested figures', () => {
    beforeEach(() => { initTestApp(); });

    // A container at (100,100) 220x160 with one child at container-local (22,18)
    // 30x20. ContentOrigin is (8,32), so the child's canvas rect is
    // (100+8+22, 100+32+18) = (130,150) .. (160,170).
    function containerWithChild(): { container: ContainerFigure; child: Figure } {
        const container = new ContainerFigure();
        container.Left = 100; container.Top = 100; container.Width = 220; container.Height = 160;
        container.Measure(new Size(220, 160));
        container.Arrange(new Rect(100, 100, 220, 160));

        const child = Figure.fromKind('rectangle', 22, 18, { width: 30, height: 20 });
        child.ContainerParent = container;      // nested → Left/Top are container-local
        child.Measure(new Size(30, 20));
        child.Arrange(new Rect(0, 0, 30, 20));  // realized; geometry read via diagramSpaceRect
        return { container, child };
    }

    test('a point inside the child resolves to the nested child, not the container', () => {
        const { container, child } = containerWithChild();
        // (140,160) is inside the child's canvas rect — which sits inside the
        // container box, so both contain it; the DEEPER figure must win.
        const hit = findFigureAtCanvasPoint(stubDiagram([container, child]), new Point(140, 160));
        assert.equal(hit, child, 'the nested child wins over its container');
    });

    test('a point inside the container but off the child resolves to the container', () => {
        const { container, child } = containerWithChild();
        // (110,140) is inside the container box but above-left of the child rect.
        const hit = findFigureAtCanvasPoint(stubDiagram([container, child]), new Point(110, 140));
        assert.equal(hit, container, 'the container wins where no child covers the point');
    });
});
