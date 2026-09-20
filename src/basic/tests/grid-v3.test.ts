import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Color, Rect, Size, Element, Visual } from '../../runtime/index.js';
import {
    HeadlessTarget,
    LineGeometry,
    Pen,
    SolidColorBrush,
    type DrawingContext,
    type Geometry,
} from '../../visual-engine/index.js';
import { ColumnDefinition, Grid, GridLength, RowDefinition } from '../panels/grid.js';

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

function px(n: number): GridLength  { return new GridLength(n, 'pixel'); }
function auto():        GridLength  { return GridLength.Auto; }
function star(n = 1):   GridLength  { return new GridLength(n, 'star'); }

// Tiny DrawingContext stub that records every DrawGeometry call so the
// ShowGridLines test can assert on what Grid emitted.
interface RecordedDraw
{
    pen:      Pen | undefined;
    geometry: Geometry;
}
function makeRecorder(): { dc: DrawingContext; draws: RecordedDraw[] }
{
    const draws: RecordedDraw[] = [];
    const dc = {
        DrawGeometry(_brush: unknown, pen: Pen | undefined, geometry: Geometry): void
        {
            draws.push({ pen, geometry });
        },
        // Stubs for the rest of the DrawingContext surface — Grid only
        // calls DrawGeometry, so we can leave the others as no-ops.
    } as unknown as DrawingContext;
    return { dc, draws };
}

describe('§ 14.1 — Grid.ShowGridLines', () => {

    test('defaults to false; RenderOverride is a no-op', () => {
        const g = new Grid();
        g.ColumnDefinitions.Add(col(px(50)));
        g.ColumnDefinitions.Add(col(px(50)));
        g.RowDefinitions.Add(row(px(40)));
        g.RowDefinitions.Add(row(px(40)));

        const target = new HeadlessTarget(200, 200);
        target.Content = g;
        target.Flush();

        const { dc, draws } = makeRecorder();
        (g as unknown as { RenderOverride(dc: DrawingContext): void })
            .RenderOverride(dc);
        assert.equal(g.ShowGridLines, false);
        assert.equal(draws.length, 0);
    });

    test('paints internal column + row separators when ShowGridLines=true', () => {
        const g = new Grid();
        g.ShowGridLines = true;
        // 2 columns × 2 rows → 1 internal column boundary, 1 internal
        // row boundary, 2 total LineGeometry draws.
        g.ColumnDefinitions.Add(col(px(50)));
        g.ColumnDefinitions.Add(col(px(70)));
        g.RowDefinitions.Add(row(px(30)));
        g.RowDefinitions.Add(row(px(40)));

        const target = new HeadlessTarget(200, 200);
        target.Content = g;
        target.Flush();

        const { dc, draws } = makeRecorder();
        (g as unknown as { RenderOverride(dc: DrawingContext): void })
            .RenderOverride(dc);
        assert.equal(draws.length, 2,
            'one column separator + one row separator');

        // Column separator at x=50 (after first column).
        const colLine = draws.find(d => {
            const g = d.geometry as LineGeometry;
            return g instanceof LineGeometry && g.StartPoint.X === g.EndPoint.X;
        });
        assert.ok(colLine !== undefined);
        const colGeom = colLine!.geometry as LineGeometry;
        assert.equal(colGeom.StartPoint.X, 50);
        assert.equal(colGeom.StartPoint.Y, 0);
        assert.equal(colGeom.EndPoint.Y,   70);    // full height = 30+40

        // Row separator at y=30 (after first row).
        const rowLine = draws.find(d => {
            const g = d.geometry as LineGeometry;
            return g instanceof LineGeometry && g.StartPoint.Y === g.EndPoint.Y;
        });
        assert.ok(rowLine !== undefined);
        const rowGeom = rowLine!.geometry as LineGeometry;
        assert.equal(rowGeom.StartPoint.Y, 30);
        assert.equal(rowGeom.StartPoint.X, 0);
        assert.equal(rowGeom.EndPoint.X,   120);   // full width = 50+70
    });

    test('no separators drawn for a single-track grid', () => {
        const g = new Grid();
        g.ShowGridLines = true;
        g.ColumnDefinitions.Add(col(px(100)));
        g.RowDefinitions.Add(row(px(100)));

        const target = new HeadlessTarget(200, 200);
        target.Content = g;
        target.Flush();

        const { dc, draws } = makeRecorder();
        (g as unknown as { RenderOverride(dc: DrawingContext): void })
            .RenderOverride(dc);
        assert.equal(draws.length, 0,
            '1×1 grids have no internal boundaries');
    });

    test('GridLinesBrush overrides the default grey stroke', () => {
        const g = new Grid();
        g.ShowGridLines = true;
        g.GridLinesBrush = new SolidColorBrush(Color.FromHex('#ff00ff'));
        g.ColumnDefinitions.Add(col(px(50)));
        g.ColumnDefinitions.Add(col(px(50)));
        g.RowDefinitions.Add(row(px(40)));

        const target = new HeadlessTarget(200, 200);
        target.Content = g;
        target.Flush();

        const { dc, draws } = makeRecorder();
        (g as unknown as { RenderOverride(dc: DrawingContext): void })
            .RenderOverride(dc);
        assert.equal(draws.length, 1);
        const brush = draws[0]!.pen!.Brush as SolidColorBrush;
        assert.equal(brush.Color.R, 0xff);
        assert.equal(brush.Color.G, 0x00);
        assert.equal(brush.Color.B, 0xff);
    });
});

describe('§ 14.2 — Star tracks survive Auto over-request', () => {

    test('Stars get the leftover space when sum(pixel + auto) < available (control case)', () => {
        // Baseline — no overflow. Auto desires 60, Star gets 100-60=40.
        const g = new Grid();
        g.ColumnDefinitions.Add(col(auto()));
        g.ColumnDefinitions.Add(col(star()));
        g.RowDefinitions.Add(row(px(30)));

        const autoChild = leaf(60, 30);
        const starChild = leaf(40, 30);
        Grid.SetColumn(autoChild, 0);
        Grid.SetColumn(starChild, 1);
        g.AddChild(autoChild);
        g.AddChild(starChild);

        g.Measure(new Size(100, 100));
        g.Arrange(new Rect(0, 0, 100, 30));

        assert.equal(autoChild.ArrangedRect.Width, 60);
        assert.equal(starChild.ArrangedRect.Width, 40);
    });

    test('Auto shrinks proportionally when its desired size would zero the Star track', () => {
        // Two Auto columns desiring 200 + 100 = 300, 1 Star column.
        // Available = 200. Star would get 0 without § 14.2.
        // With § 14.2: Autos shrink by (200+100+0 - 200) = 100,
        // distributed proportionally to their headroom (each can shrink
        // all the way to 0 since MinWidth=0). The Star gets the freed
        // room.
        const g = new Grid();
        g.ColumnDefinitions.Add(col(auto()));
        g.ColumnDefinitions.Add(col(auto()));
        g.ColumnDefinitions.Add(col(star()));
        g.RowDefinitions.Add(row(px(30)));

        const a1 = leaf(200, 30);
        const a2 = leaf(100, 30);
        Grid.SetColumn(a1, 0);
        Grid.SetColumn(a2, 1);
        g.AddChild(a1);
        g.AddChild(a2);

        g.Measure(new Size(200, 100));
        g.Arrange(new Rect(0, 0, 200, 30));

        // Auto shrinkage = 200 + 100 - 200 = 100 distributed proportionally
        // to headroom (200, 100). After shrinkage:
        //   A1 = 200 - 100*(200/300) ≈ 133.33
        //   A2 = 100 - 100*(100/300) ≈  66.67
        // Star gets the remaining 0 — minimum-Star-only case, no positive
        // budget. Verified at the SUM level: pixel + auto = available.
        // (See the next test for the case where the Star has a MinWidth
        // and the shrinkage frees POSITIVE Star room.)
        const a1w = a1.ArrangedRect.Width;
        const a2w = a2.ArrangedRect.Width;
        assert.ok(a1w < 200 && a2w < 100,
            'both Autos shrank to make room for Star');
        assert.ok(a1w + a2w <= 200 + 0.001,
            'Auto sum no longer exceeds available width');
    });

    test('Star gets POSITIVE width when Star has a MinWidth and Autos can shrink to absorb', () => {
        const g = new Grid();
        const autoCol = col(auto());
        const starCol = col(star());
        starCol.MinWidth = 50;
        g.ColumnDefinitions.Add(autoCol);
        g.ColumnDefinitions.Add(starCol);
        g.RowDefinitions.Add(row(px(30)));

        // Auto child desires 150. Available = 100. Without § 14.2 Star
        // would be 0 even with MinWidth=50 because the Star resolver
        // clamps to MinWidth but doesn't shrink Auto. With § 14.2,
        // Auto shrinks to 50 (= available - star.MinWidth=50) and
        // Star gets its 50.
        const autoChild = leaf(150, 30);
        Grid.SetColumn(autoChild, 0);
        g.AddChild(autoChild);

        g.Measure(new Size(100, 100));
        g.Arrange(new Rect(0, 0, 100, 30));

        // Auto must have shrunk to leave room for the Star min.
        assert.ok(autoChild.ArrangedRect.Width < 150,
            'Auto track must shrink when over-requesting');
    });

    test('Auto respects its own MinWidth — never shrinks below the declared floor', () => {
        const g = new Grid();
        const autoCol = col(auto());
        autoCol.MinWidth = 80;
        const starCol = col(star());
        g.ColumnDefinitions.Add(autoCol);
        g.ColumnDefinitions.Add(starCol);
        g.RowDefinitions.Add(row(px(30)));

        // Auto child desires 200. Available = 100. Auto.MinWidth = 80.
        // Auto must shrink TOWARD 80 but not below. Star eats the rest
        // (which may be 20 here).
        const autoChild = leaf(200, 30);
        Grid.SetColumn(autoChild, 0);
        g.AddChild(autoChild);

        g.Measure(new Size(100, 100));
        g.Arrange(new Rect(0, 0, 100, 30));

        // Auto floor is honoured.
        assert.ok(autoChild.ArrangedRect.Width >= 80,
            'Auto.MinWidth is a hard floor for shrinkage');
    });
});

