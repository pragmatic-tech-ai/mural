import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Rect, Size, Element, Visual } from '../../runtime/index.js';
import { HeadlessTarget } from '../../visual-engine/index.js';
import { ColumnDefinition, Grid, GridLength, RowDefinition } from '../panels/grid.js';
import { StackPanel } from '../panels/stack-panel.js';
import { Orientation } from '../panels/orientation.js';

// Fixed-size leaf — reports a deterministic DesiredSize regardless of
// the parent's available size. Used to assert Grid's allocation math.
class FixedSizeLeaf extends Element
{
    constructor(private box: Size) { super(); }
    protected override MeasureOverride(_a: Size): Size { return this.box; }
}

function leaf(w: number, h: number): FixedSizeLeaf
{
    return new FixedSizeLeaf(new Size(w, h));
}

function col(len: GridLength): ColumnDefinition
{
    const cd = new ColumnDefinition();
    cd.Width = len;
    return cd;
}

function row(len: GridLength): RowDefinition
{
    const rd = new RowDefinition();
    rd.Height = len;
    return rd;
}

function px(n: number): GridLength { return new GridLength(n, 'pixel'); }
function star(n = 1): GridLength    { return new GridLength(n, 'star'); }

describe('Grid — track sizing modes', () => {
    test('pixel column resolves to its declared width', () => {
        const g = new Grid();
        g.ColumnDefinitions.Add(col(px(80)));
        g.ColumnDefinitions.Add(col(px(50)));
        g.RowDefinitions.Add(row(px(40)));
        const c0 = leaf(10, 10);
        const c1 = leaf(10, 10);
        Grid.SetColumn(c1, 1);
        g.AddChild(c0);
        g.AddChild(c1);
        g.Measure(new Size(500, 500));
        g.Arrange(new Rect(0, 0, 500, 500));
        assert.equal(c0.ArrangedRect.X, 0);
        assert.equal(c0.ArrangedRect.Width, 80);
        assert.equal(c1.ArrangedRect.X, 80);
        assert.equal(c1.ArrangedRect.Width, 50);
    });

    test('auto column expands to the largest child desired width', () => {
        const g = new Grid();
        g.ColumnDefinitions.Add(col(GridLength.Auto));
        g.RowDefinitions.Add(row(px(40)));
        const c0 = leaf(75, 10);
        g.AddChild(c0);
        g.Measure(new Size(500, 500));
        g.Arrange(new Rect(0, 0, 500, 500));
        assert.equal(c0.ArrangedRect.Width, 75);
    });

    test('star columns split leftover space proportionally', () => {
        const g = new Grid();
        g.ColumnDefinitions.Add(col(star(1)));
        g.ColumnDefinitions.Add(col(star(2)));
        g.RowDefinitions.Add(row(px(20)));
        const c0 = leaf(1, 1);
        const c1 = leaf(1, 1);
        Grid.SetColumn(c1, 1);
        g.AddChild(c0); g.AddChild(c1);
        g.Measure(new Size(300, 300));
        g.Arrange(new Rect(0, 0, 300, 300));
        // 1:2 split of 300 → 100 / 200.
        assert.equal(c0.ArrangedRect.Width, 100);
        assert.equal(c1.ArrangedRect.X, 100);
        assert.equal(c1.ArrangedRect.Width, 200);
    });

    // WPF parity: with no finite leftover to distribute, a Star track
    // resolves as Auto (content-sized) rather than expanding to the
    // infinite available size. A definition-less Grid inside a horizontal
    // StackPanel (measured with infinite width) is the canonical trigger —
    // e.g. a Ribbon group's header/launcher overlay Grid. Without this the
    // Grid returns an infinite DesiredSize and every ancestor's centering
    // arrange collapses to NaN.
    test('star column measured with infinite width sizes to content, not Infinity', () => {
        const g = new Grid();
        g.ColumnDefinitions.Add(col(star()));
        g.RowDefinitions.Add(row(px(20)));
        const c0 = leaf(66, 12);
        g.AddChild(c0);
        g.Measure(new Size(Number.POSITIVE_INFINITY, 300));
        assert.equal(g.DesiredSize.Width, 66, 'reports content width, not Infinity');
        assert.ok(Number.isFinite(g.DesiredSize.Width));
    });

    test('definition-less Grid in a horizontal StackPanel does not produce Infinity', () => {
        const strip = new StackPanel();
        strip.Orientation = Orientation.Horizontal;
        const g = new Grid();            // implicit 1* col + 1* row
        g.AddChild(leaf(40, 30));
        strip.AddChild(g);
        strip.Measure(new Size(Number.POSITIVE_INFINITY, 100));
        assert.ok(Number.isFinite(g.DesiredSize.Width), 'grid width finite');
        assert.equal(g.DesiredSize.Width, 40);
    });

    test('mixed pixel + auto + star compose correctly', () => {
        const g = new Grid();
        g.ColumnDefinitions.Add(col(px(50)));
        g.ColumnDefinitions.Add(col(GridLength.Auto));
        g.ColumnDefinitions.Add(col(star()));
        g.RowDefinitions.Add(row(px(20)));
        const c0 = leaf(1, 1);
        const c1 = leaf(30, 1);  // drives the auto column
        const c2 = leaf(1, 1);
        Grid.SetColumn(c1, 1);
        Grid.SetColumn(c2, 2);
        g.AddChild(c0); g.AddChild(c1); g.AddChild(c2);
        g.Measure(new Size(200, 200));
        g.Arrange(new Rect(0, 0, 200, 200));
        // pixel = 50, auto = 30, star gets 200 - 50 - 30 = 120.
        assert.equal(c2.ArrangedRect.X, 80);
        assert.equal(c2.ArrangedRect.Width, 120);
    });
});

describe('Grid — attached properties and spans', () => {
    test('Grid.Row / Column place the child in the right cell', () => {
        const g = new Grid();
        g.ColumnDefinitions.Add(col(px(50)));
        g.ColumnDefinitions.Add(col(px(50)));
        g.RowDefinitions.Add(row(px(40)));
        g.RowDefinitions.Add(row(px(60)));
        const c = leaf(10, 10);
        Grid.SetRow(c, 1);
        Grid.SetColumn(c, 1);
        g.AddChild(c);
        g.Measure(new Size(200, 200));
        g.Arrange(new Rect(0, 0, 200, 200));
        assert.equal(c.ArrangedRect.X, 50);
        assert.equal(c.ArrangedRect.Y, 40);
    });

    test('Grid.ColumnSpan = 2 sums the spanned column widths', () => {
        const g = new Grid();
        g.ColumnDefinitions.Add(col(px(30)));
        g.ColumnDefinitions.Add(col(px(40)));
        g.ColumnDefinitions.Add(col(px(50)));
        g.RowDefinitions.Add(row(px(20)));
        const c = leaf(1, 1);
        Grid.SetColumn(c, 0);
        Grid.SetColumnSpan(c, 2);
        g.AddChild(c);
        g.Measure(new Size(200, 200));
        g.Arrange(new Rect(0, 0, 200, 200));
        assert.equal(c.ArrangedRect.X, 0);
        assert.equal(c.ArrangedRect.Width, 70);
    });

    test('a span-2 child over (Auto, Star) does NOT inflate the Auto column', () => {
        // Auto label column + Star editor column. A wide element spanning
        // both (a section title / tab row) must size the editor against the
        // Star track, NOT dump its width into the Auto label column — else
        // a shared label column would be blown out by the widest banner.
        const g = new Grid();
        g.ColumnDefinitions.Add(col(GridLength.Auto));
        g.ColumnDefinitions.Add(col(star()));
        g.RowDefinitions.Add(row(GridLength.Auto));
        g.RowDefinitions.Add(row(GridLength.Auto));

        const label  = leaf(60, 20); Grid.SetRow(label, 0);  Grid.SetColumn(label, 0);
        const editor = leaf(10, 20); Grid.SetRow(editor, 0); Grid.SetColumn(editor, 1);
        const banner = leaf(200, 20);
        Grid.SetRow(banner, 1); Grid.SetColumn(banner, 0); Grid.SetColumnSpan(banner, 2);
        g.AddChild(label); g.AddChild(editor); g.AddChild(banner);

        g.Measure(new Size(300, 200));
        g.Arrange(new Rect(0, 0, 300, 200));

        // Auto column sized to the 60px label, not the 200px banner, so the
        // editor starts at x=60.
        assert.equal(editor.ArrangedRect.X, 60);
        // The banner still occupies the full grid width.
        assert.equal(banner.ArrangedRect.X, 0);
        assert.equal(banner.ArrangedRect.Width, 300);
    });
});

describe('Grid v2.1 — MinWidth / MaxWidth on definitions', () => {
    test('MinWidth raises a star track above its share', () => {
        const g = new Grid();
        const c0 = new ColumnDefinition(); c0.Width = star(1); c0.MinWidth = 200;
        const c1 = new ColumnDefinition(); c1.Width = star(1);
        g.ColumnDefinitions.Add(c0); g.ColumnDefinitions.Add(c1);
        g.RowDefinitions.Add(row(px(20)));
        const a = leaf(1, 1), b = leaf(1, 1);
        Grid.SetColumn(b, 1);
        g.AddChild(a); g.AddChild(b);
        g.Measure(new Size(300, 300));
        g.Arrange(new Rect(0, 0, 300, 300));
        // 1:1 share of 300 = 150 each. Col 0 has MinWidth=200; it
        // grows to 200, leaving 100 for col 1.
        assert.equal(a.ArrangedRect.Width, 200);
        assert.equal(b.ArrangedRect.Width, 100);
        assert.equal(b.ArrangedRect.X,     200);
    });

    test('MaxWidth caps a pixel track', () => {
        const g = new Grid();
        const c0 = new ColumnDefinition(); c0.Width = px(500); c0.MaxWidth = 200;
        g.ColumnDefinitions.Add(c0);
        g.RowDefinitions.Add(row(px(20)));
        const a = leaf(1, 1);
        g.AddChild(a);
        g.Measure(new Size(300, 300));
        g.Arrange(new Rect(0, 0, 300, 300));
        // Pixel width=500 declared; MaxWidth=200 clamps it down.
        assert.equal(a.ArrangedRect.Width, 200);
    });

    test('MaxWidth caps a star track and redistributes the residual to other stars', () => {
        const g = new Grid();
        const c0 = new ColumnDefinition(); c0.Width = star(1); c0.MaxWidth = 80;
        const c1 = new ColumnDefinition(); c1.Width = star(1);
        g.ColumnDefinitions.Add(c0); g.ColumnDefinitions.Add(c1);
        g.RowDefinitions.Add(row(px(20)));
        const a = leaf(1, 1), b = leaf(1, 1);
        Grid.SetColumn(b, 1);
        g.AddChild(a); g.AddChild(b);
        g.Measure(new Size(300, 300));
        g.Arrange(new Rect(0, 0, 300, 300));
        // Naïve 1:1 split = 150 each. Col 0 capped at 80; remaining
        // 300 - 80 = 220 goes entirely to col 1.
        assert.equal(a.ArrangedRect.Width, 80);
        assert.equal(b.ArrangedRect.Width, 220);
    });

    test('MinWidth raises an Auto track above its child desired size', () => {
        const g = new Grid();
        const c0 = new ColumnDefinition(); c0.Width = GridLength.Auto; c0.MinWidth = 150;
        g.ColumnDefinitions.Add(c0);
        g.RowDefinitions.Add(row(px(20)));
        const a = leaf(40, 1);   // would normally size auto col to 40
        g.AddChild(a);
        g.Measure(new Size(300, 300));
        g.Arrange(new Rect(0, 0, 300, 300));
        // MinWidth raises the auto col to 150 even though no child
        // demanded that much.
        assert.equal(a.ArrangedRect.Width, 150);
    });

    test('MaxWidth caps an Auto track even when a child wants more', () => {
        const g = new Grid();
        const c0 = new ColumnDefinition(); c0.Width = GridLength.Auto; c0.MaxWidth = 100;
        g.ColumnDefinitions.Add(c0);
        g.RowDefinitions.Add(row(px(20)));
        const a = leaf(300, 1);  // wants 300 but max is 100
        g.AddChild(a);
        g.Measure(new Size(500, 300));
        g.Arrange(new Rect(0, 0, 500, 300));
        assert.equal(a.ArrangedRect.Width, 100);
    });

    test('redistribution loop converges when multiple star tracks clamp in sequence', () => {
        // Three star tracks each capped to 50. Naïve 1:1:1 of 300 = 100
        // each, all capped down to 50. Total used = 150, with 150 left
        // over and nothing to redistribute to — the result is three
        // 50px tracks, not a forever-loop or an over-allocation.
        const g = new Grid();
        const c0 = new ColumnDefinition(); c0.Width = star(1); c0.MaxWidth = 50;
        const c1 = new ColumnDefinition(); c1.Width = star(1); c1.MaxWidth = 50;
        const c2 = new ColumnDefinition(); c2.Width = star(1); c2.MaxWidth = 50;
        g.ColumnDefinitions.Add(c0); g.ColumnDefinitions.Add(c1); g.ColumnDefinitions.Add(c2);
        g.RowDefinitions.Add(row(px(20)));
        const a = leaf(1, 1), b = leaf(1, 1), c = leaf(1, 1);
        Grid.SetColumn(b, 1); Grid.SetColumn(c, 2);
        g.AddChild(a); g.AddChild(b); g.AddChild(c);
        g.Measure(new Size(300, 300));
        g.Arrange(new Rect(0, 0, 300, 300));
        assert.equal(a.ArrangedRect.Width, 50);
        assert.equal(b.ArrangedRect.Width, 50);
        assert.equal(c.ArrangedRect.Width, 50);
    });

    test('Row MinHeight / MaxHeight work symmetrically', () => {
        const g = new Grid();
        g.ColumnDefinitions.Add(col(px(40)));
        const r0 = new RowDefinition(); r0.Height = star(1); r0.MinHeight = 200;
        const r1 = new RowDefinition(); r1.Height = star(1);
        g.RowDefinitions.Add(r0); g.RowDefinitions.Add(r1);
        const a = leaf(1, 1), b = leaf(1, 1);
        Grid.SetRow(b, 1);
        g.AddChild(a); g.AddChild(b);
        g.Measure(new Size(40, 300));
        g.Arrange(new Rect(0, 0, 40, 300));
        // Naïve 150/150; MinHeight on row 0 raises it to 200, row 1 = 100.
        assert.equal(a.ArrangedRect.Height, 200);
        assert.equal(b.ArrangedRect.Height, 100);
        assert.equal(b.ArrangedRect.Y,      200);
    });
});

describe('Grid v2.2 — SharedSizeGroup cross-Grid coordination', () => {
    // Build two Grids that share a SharedSizeGroup. Mount both under
    // one HeadlessTarget so they live in the same per-target registry.
    function buildPair(): { target: HeadlessTarget; gA: Grid; gB: Grid; root: StackPanel }
    {
        const root = new StackPanel();
        const gA = new Grid();
        const gB = new Grid();
        root.AddChild(gA);
        root.AddChild(gB);
        const target = new HeadlessTarget(400, 400, root);
        // Trigger initial layout so the target back-pointer is wired
        // into every descendant Grid before we add children.
        target.Flush();
        return { target, gA, gB, root };
    }


    test('two Grids in the same group resolve their Auto column to the larger natural size', () => {
        const { target, gA, gB } = buildPair();
        const colA = new ColumnDefinition(); colA.Width = GridLength.Auto; colA.SharedSizeGroup = 'sizeA';
        const colB = new ColumnDefinition(); colB.Width = GridLength.Auto; colB.SharedSizeGroup = 'sizeA';
        gA.ColumnDefinitions.Add(colA);
        gB.ColumnDefinitions.Add(colB);
        gA.RowDefinitions.Add(rowOf(GridLength.Auto));
        gB.RowDefinitions.Add(rowOf(GridLength.Auto));
        const childA = leaf(40, 10);  // gA wants 40
        const childB = leaf(120, 10); // gB wants 120
        gA.AddChild(childA);
        gB.AddChild(childB);
        target.Flush();
        // Both Grids should resolve their shared col to 120 — the
        // max contribution from B.
        assert.equal(childA.ArrangedRect.Width, 120);
        assert.equal(childB.ArrangedRect.Width, 120);
    });

    test('different group names stay independent', () => {
        const { target, gA, gB } = buildPair();
        const colA = new ColumnDefinition(); colA.Width = GridLength.Auto; colA.SharedSizeGroup = 'g1';
        const colB = new ColumnDefinition(); colB.Width = GridLength.Auto; colB.SharedSizeGroup = 'g2';
        gA.ColumnDefinitions.Add(colA);
        gB.ColumnDefinitions.Add(colB);
        gA.RowDefinitions.Add(rowOf(GridLength.Auto));
        gB.RowDefinitions.Add(rowOf(GridLength.Auto));
        gA.AddChild(leaf(40, 10));
        gB.AddChild(leaf(120, 10));
        target.Flush();
        // No coordination across distinct names.
        assert.equal(gA.visualChildren[0]!.ArrangedRect.Width, 40);
        assert.equal(gB.visualChildren[0]!.ArrangedRect.Width, 120);
    });

    test('Pixel and Star tracks ignore SharedSizeGroup even when set', () => {
        const { target, gA, gB } = buildPair();
        // gA has a pixel column declared in group "sg". gB has an
        // auto column also in "sg" with a big child. The pixel column
        // should NOT be raised to the auto track's size — Pixel
        // tracks are not part of the group.
        const colA = new ColumnDefinition(); colA.Width = px(50); colA.SharedSizeGroup = 'sg';
        const colB = new ColumnDefinition(); colB.Width = GridLength.Auto; colB.SharedSizeGroup = 'sg';
        gA.ColumnDefinitions.Add(colA);
        gB.ColumnDefinitions.Add(colB);
        gA.RowDefinitions.Add(rowOf(GridLength.Auto));
        gB.RowDefinitions.Add(rowOf(GridLength.Auto));
        const childA = leaf(1, 10);
        const childB = leaf(200, 10);
        gA.AddChild(childA);
        gB.AddChild(childB);
        target.Flush();
        // Pixel col stays at 50.
        assert.equal(childA.ArrangedRect.Width, 50);
    });

    test('removing a Grid from the tree shrinks the group max if it was the largest contributor', () => {
        const { target, gA, gB, root } = buildPair();
        const colA = new ColumnDefinition(); colA.Width = GridLength.Auto; colA.SharedSizeGroup = 'sg';
        const colB = new ColumnDefinition(); colB.Width = GridLength.Auto; colB.SharedSizeGroup = 'sg';
        gA.ColumnDefinitions.Add(colA);
        gB.ColumnDefinitions.Add(colB);
        gA.RowDefinitions.Add(rowOf(GridLength.Auto));
        gB.RowDefinitions.Add(rowOf(GridLength.Auto));
        const childA = leaf(40, 10);
        const childB = leaf(120, 10);
        gA.AddChild(childA);
        gB.AddChild(childB);
        target.Flush();
        assert.equal(childA.ArrangedRect.Width, 120);

        // Now remove gB. The group's max should drop to 40 (only A
        // remains). gA's col should shrink accordingly.
        root.RemoveChild(gB);
        target.Flush();
        assert.equal(childA.ArrangedRect.Width, 40);
    });

    test('multiple tracks in the same Grid sharing one group pre-aggregate to the largest', () => {
        const { target, gA, gB } = buildPair();
        // gA has TWO auto columns both in group "sg" — cols 0 and 1.
        // The contribution from gA should be max(natural[0], natural[1]).
        // gB has one col in the same group with a smaller child to
        // prove A's max contribution is what wins.
        const a0 = new ColumnDefinition(); a0.Width = GridLength.Auto; a0.SharedSizeGroup = 'sg';
        const a1 = new ColumnDefinition(); a1.Width = GridLength.Auto; a1.SharedSizeGroup = 'sg';
        gA.ColumnDefinitions.Add(a0);
        gA.ColumnDefinitions.Add(a1);
        const b0 = new ColumnDefinition(); b0.Width = GridLength.Auto; b0.SharedSizeGroup = 'sg';
        gB.ColumnDefinitions.Add(b0);
        gA.RowDefinitions.Add(rowOf(GridLength.Auto));
        gB.RowDefinitions.Add(rowOf(GridLength.Auto));
        const c0 = leaf(30, 10);
        const c1 = leaf(90, 10);
        Grid.SetColumn(c1, 1);
        gA.AddChild(c0); gA.AddChild(c1);
        gB.AddChild(leaf(20, 10));
        target.Flush();
        // Both A's auto cols and B's auto col resolve to 90 (A's max
        // contribution from c1).
        assert.equal(c0.ArrangedRect.Width, 90);
        assert.equal(c1.ArrangedRect.Width, 90);
        assert.equal(gB.visualChildren[0]!.ArrangedRect.Width, 90);
    });
});

function rowOf(len: GridLength): RowDefinition
{
    const rd = new RowDefinition();
    rd.Height = len;
    return rd;
}

describe('Grid — fallback when no definitions are declared', () => {
    test('empty rows + columns → a single star cell filling finalSize', () => {
        const g = new Grid();
        const c = leaf(5, 5);
        g.AddChild(c);
        g.Measure(new Size(120, 80));
        g.Arrange(new Rect(0, 0, 120, 80));
        assert.deepEqual(
            [c.ArrangedRect.X, c.ArrangedRect.Y, c.ArrangedRect.Width, c.ArrangedRect.Height],
            [0, 0, 120, 80],
        );
    });
});
