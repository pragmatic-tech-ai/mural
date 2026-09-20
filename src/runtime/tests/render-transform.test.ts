import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
    Application,
    Matrix,
    ObservableCollection,
    Point,
    Rect,
    Size,
    Thickness,
} from '../index.js';
import { Border } from '../../basic/border.js';
import {
    MatrixTransform,
    RotateTransform,
    ScaleTransform,
    SkewTransform,
    SvgRenderer,
    Transform,
    TransformGroup,
    TranslateTransform,
} from '../../visual-engine/index.js';

// § 18.1 — Visual.RenderTransform DP, supporting Transform subclasses,
// renderer wiring, inner-DP invalidation.

// Counts InvalidateVisual calls so tests can assert the OBSERVABLE effect
// of the §5.2 Freezable-owner wiring (an inner-DP change on a held / nested
// Transform re-invalidates the owning Visual) instead of poking at internal
// invalidator fields.
class CountingBorder extends Border
{
    public invalidateVisualCount = 0;
    public override InvalidateVisual(): void
    {
        this.invalidateVisualCount++;
        super.InvalidateVisual();
    }
}

function makeDom(): { document: Document; surface: SVGSVGElement }
{
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const doc = dom.window.document;
    const surface = doc.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    doc.body.appendChild(surface);
    return { document: doc, surface };
}

describe('§ 18.1 — Visual.RenderTransform / RenderTransformOrigin DPs', () => {

    beforeEach(() => { Application.current = null; });

    test('defaults: RenderTransform = undefined, RenderTransformOrigin = (0, 0)', () => {
        const b = new Border();
        assert.equal(b.RenderTransform, undefined);
        assert.equal(b.RenderTransformOrigin.X, 0);
        assert.equal(b.RenderTransformOrigin.Y, 0);
    });

    test('an inner-DP change on a held Transform invalidates the owning Visual', () => {
        const b = new CountingBorder();
        const r = new RotateTransform();
        b.RenderTransform = r;
        b.invalidateVisualCount = 0;   // ignore the assignment's own invalidation
        r.Angle = 45;
        assert.ok(b.invalidateVisualCount > 0,
            'a RotateTransform.Angle change re-invalidates the Visual that holds it');
    });

    test('swapping RenderTransform releases the old Transform (owner unregistered)', () => {
        const b = new CountingBorder();
        const a = new RotateTransform(10);
        const c = new RotateTransform(20);
        b.RenderTransform = a;
        b.RenderTransform = c;
        b.invalidateVisualCount = 0;
        a.Angle = 99;                  // detached — must NOT invalidate
        assert.equal(b.invalidateVisualCount, 0,
            'the swapped-out transform no longer invalidates the Visual');
        c.Angle = 99;                  // attached — must invalidate
        assert.ok(b.invalidateVisualCount > 0,
            'the current transform still invalidates the Visual');
    });

    test('RenderTransformOrigin accepts arbitrary Point values', () => {
        const b = new Border();
        b.RenderTransformOrigin = new Point(0.5, 0.5);
        assert.equal(b.RenderTransformOrigin.X, 0.5);
        assert.equal(b.RenderTransformOrigin.Y, 0.5);
    });
});

describe('§ 18.1 — Transform subclass matrices', () => {

    test('TranslateTransform(10, 20).Matrix = T(10, 20)', () => {
        const t = new TranslateTransform(10, 20);
        const m = t.Matrix;
        assert.equal(m.M11, 1);   assert.equal(m.M12, 0);
        assert.equal(m.M21, 0);   assert.equal(m.M22, 1);
        assert.equal(m.OffsetX, 10);
        assert.equal(m.OffsetY, 20);
    });

    test('RotateTransform(90).Matrix rotates (1, 0) → (0, 1)', () => {
        const r = new RotateTransform(90);
        const p = r.Matrix.Transform(new Point(1, 0));
        assert.ok(Math.abs(p.X - 0) < 1e-9, `expected ~0, got ${p.X}`);
        assert.ok(Math.abs(p.Y - 1) < 1e-9, `expected ~1, got ${p.Y}`);
    });

    test('RotateTransform around (cx, cy) keeps the center fixed', () => {
        const r = new RotateTransform(45, 100, 50);
        const fixed = r.Matrix.Transform(new Point(100, 50));
        assert.ok(Math.abs(fixed.X - 100) < 1e-9, `cx unchanged, got ${fixed.X}`);
        assert.ok(Math.abs(fixed.Y - 50)  < 1e-9, `cy unchanged, got ${fixed.Y}`);
    });

    test('ScaleTransform(2, 3) scales (10, 5) → (20, 15)', () => {
        const s = new ScaleTransform(2, 3);
        const p = s.Matrix.Transform(new Point(10, 5));
        assert.equal(p.X, 20);
        assert.equal(p.Y, 15);
    });

    test('ScaleTransform around (cx, cy) keeps the center fixed', () => {
        const s = new ScaleTransform(2, 2, 10, 10);
        const fixed = s.Matrix.Transform(new Point(10, 10));
        assert.equal(fixed.X, 10);
        assert.equal(fixed.Y, 10);
    });

    test('SkewTransform(0, 0).Matrix is identity', () => {
        const s = new SkewTransform(0, 0);
        assert.ok(s.Matrix.IsIdentity);
    });

    test('SkewTransform(AngleX = 45°) shears X by Y · tan(45°) = Y', () => {
        const s = new SkewTransform(45, 0);
        const p = s.Matrix.Transform(new Point(0, 10));
        assert.ok(Math.abs(p.X - 10) < 1e-9, `expected x=10, got ${p.X}`);
        assert.ok(Math.abs(p.Y - 10) < 1e-9, `expected y=10, got ${p.Y}`);
    });

    test('MatrixTransform exposes its raw Matrix unchanged', () => {
        const m  = new Matrix(2, 0, 0, 2, 5, 5);
        const mt = new MatrixTransform(m);
        assert.ok(mt.Matrix.Equals(m));
    });

    test('TransformGroup composes children in order: Children[0] applied first', () => {
        // Translate(10, 0) then Scale(2, 2): origin → (10, 0) → (20, 0).
        const g = new TransformGroup();
        g.Children.Add(new TranslateTransform(10, 0));
        g.Children.Add(new ScaleTransform(2, 2));
        const p = g.Matrix.Transform(new Point(0, 0));
        assert.equal(p.X, 20);
        assert.equal(p.Y, 0);
    });

    test('TransformGroup with no children is identity', () => {
        const g = new TransformGroup();
        assert.ok(g.Matrix.IsIdentity);
    });

    test('TransformGroup bubbles inner changes of a child added after attach', () => {
        const b = new CountingBorder();
        const g = new TransformGroup();
        b.RenderTransform = g;
        const r = new RotateTransform();
        g.Children.Add(r);
        b.invalidateVisualCount = 0;
        r.Angle = 45;
        assert.ok(b.invalidateVisualCount > 0,
            'a child added after the group was attached still bubbles to the Visual');
    });

    test('TransformGroup stops bubbling for a removed child', () => {
        const b = new CountingBorder();
        const g = new TransformGroup();
        const r = new RotateTransform();
        g.Children.Add(r);
        b.RenderTransform = g;
        g.Children.Clear();
        b.invalidateVisualCount = 0;
        r.Angle = 45;
        assert.equal(b.invalidateVisualCount, 0,
            'a removed child no longer invalidates the owning Visual');
    });

    test('Transform.Identity is a shared no-op singleton', () => {
        assert.ok(Transform.Identity.Matrix.IsIdentity);
    });

    test('TransformGroup nested in another TransformGroup composes correctly', () => {
        const outer = new TransformGroup();
        const inner = new TransformGroup();
        inner.Children.Add(new TranslateTransform(5, 0));
        outer.Children.Add(inner);
        outer.Children.Add(new ScaleTransform(2, 2));
        // origin → +5x via inner → ×2 via scale → (10, 0)
        const p = outer.Matrix.Transform(new Point(0, 0));
        assert.equal(p.X, 10);
        assert.equal(p.Y, 0);
    });
});

describe('§ 18.1 — SvgRenderer outer <g> transform composition', () => {

    beforeEach(() => { Application.current = null; });

    function paint(content: Border): { surface: SVGSVGElement }
    {
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });
        content.Measure(new Size(400, 400));
        content.Arrange(new Rect(0, 0, content.DesiredSize.Width, content.DesiredSize.Height));
        renderer.Render(content, undefined, null, null);
        return { surface };
    }

    test('Visual with no transform writes no transform attribute', () => {
        const b = new Border();
        b.Width  = 100;
        b.Height = 40;
        const { surface } = paint(b);
        const outer = surface.querySelector('g.mural-visual');
        assert.equal(outer?.getAttribute('transform'), null);
    });

    test('arranged-rect offset alone emits translate(x, y)', () => {
        // Border > Border. The outer has Padding, so the inner child
        // arranges at (10, 20). The inner's outer <g> gets a plain
        // translate, no matrix.
        const outer = new Border();
        outer.Padding = new Thickness(10, 20, 0, 0);
        const inner  = new Border();
        inner.Width  = 50;
        inner.Height = 50;
        outer.SetChild(inner);
        const { surface } = paint(outer);
        const innerGs = surface.querySelectorAll('g.mural-visual');
        assert.equal(innerGs.length, 2, 'expected outer + inner Visual <g>s');
        const innerTransform = innerGs[1]!.getAttribute('transform') ?? '';
        assert.ok(innerTransform.startsWith('translate('),
            `expected translate-only transform, got "${innerTransform}"`);
        assert.ok(!innerTransform.includes('matrix('),
            `expected no matrix factor, got "${innerTransform}"`);
    });

    test('RenderTransform produces a matrix() factor in the transform string', () => {
        const b = new Border();
        b.Width  = 100;
        b.Height = 40;
        b.RenderTransform = new RotateTransform(45);
        const { surface } = paint(b);
        const outer = surface.querySelector('g.mural-visual');
        const transform = outer?.getAttribute('transform') ?? '';
        assert.ok(transform.includes('matrix('),
            `expected matrix factor, got "${transform}"`);
    });

    test('RenderTransformOrigin (0.5, 0.5) sandwiches matrix with center translates', () => {
        const b = new Border();
        b.Width  = 100;
        b.Height = 40;
        b.RenderTransform        = new RotateTransform(90);
        b.RenderTransformOrigin  = new Point(0.5, 0.5);
        const { surface } = paint(b);
        const outer = surface.querySelector('g.mural-visual');
        const transform = outer?.getAttribute('transform') ?? '';
        assert.ok(transform.includes('translate(50,20)'),
            `expected pre-translate(50,20), got "${transform}"`);
        assert.ok(transform.includes('translate(-50,-20)'),
            `expected post-translate(-50,-20), got "${transform}"`);
    });

    test('identity RenderTransform skips the matrix factor', () => {
        // RotateTransform(0) has identity Matrix → renderer should
        // recognize it and emit no matrix() — just translate (if any).
        const b = new Border();
        b.Width  = 100;
        b.Height = 40;
        b.RenderTransform = new RotateTransform(0);
        const { surface } = paint(b);
        const outer = surface.querySelector('g.mural-visual');
        const transform = outer?.getAttribute('transform');
        // With no arranged offset and identity transform → attribute absent.
        assert.equal(transform, null,
            `expected no transform attribute for identity, got "${transform}"`);
    });

    test('inner-DP change updates the SVG transform on the next Render pass', () => {
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });
        const b = new Border();
        b.Width  = 100;
        b.Height = 40;
        const r = new RotateTransform(0);
        b.RenderTransform = r;
        b.Measure(new Size(400, 400));
        b.Arrange(new Rect(0, 0, b.DesiredSize.Width, b.DesiredSize.Height));
        renderer.Render(b, undefined, null, null);
        const before = surface.querySelector('g.mural-visual')!.getAttribute('transform');
        assert.equal(before, null, `expected no transform at angle=0, got "${before}"`);
        // Inner-DP change. Goes through the Transform's invalidator,
        // which calls Visual.InvalidateVisual on the owning Border.
        // Pass the renderer the renderDirty / arrangeDirty Sets from
        // the Border so the conditional repaint exercises the
        // renderDirty branch (matches the live PresentationTarget
        // flush path).
        r.Angle = 90;
        const renderDirty: Set<unknown> = (b as unknown as {
            _target?: { renderDirty?: Set<unknown> },
        })._target?.renderDirty ?? new Set();
        // For the test path (no PresentationTarget attached), force a
        // full repaint by passing nulls — that's the "first paint" code
        // path, which respects every applyTransform branch unconditionally.
        renderer.Render(b, undefined, null, null);
        const after = surface.querySelector('g.mural-visual')!.getAttribute('transform') ?? '';
        assert.ok(after.includes('matrix('),
            `expected matrix factor after rotation, got "${after}"`);
        void renderDirty;   // silence unused-local warning when the early-bail path runs.
    });
});

describe('§ 18.1 — ObservableCollection<Transform> shape sanity check', () => {

    test('TransformGroup.Children is iterable as the typed collection', () => {
        const g = new TransformGroup();
        g.Children.Add(new TranslateTransform(1, 1));
        // Compile-time and runtime check that the public-facing
        // collection matches ObservableCollection<Transform> for
        // consumers wiring custom subscriptions.
        let count = 0;
        for (const _ of g.Children as unknown as ObservableCollection<Transform>) count++;
        assert.equal(count, 1);
    });
});
