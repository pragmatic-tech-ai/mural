import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    Color,
    CornerRadius,
    Rect,
    Size,
    Thickness,
    Element,
    type DrawingContext,
} from '../../runtime/index.js';
import { Brush, DashStyle, LineJoin, Pen, RectangleGeometry, SolidColorBrush, type Geometry } from '../../visual-engine/index.js';
import { Border } from '../border.js';

// Border's border width now comes from the Stroke pen (uniform): Stroke.Thickness
// is the painted width AND the child layout inset. There is no BorderThickness DP
// and no per-side border — a one-sided rule is an oriented Line, not a Border.

// Tiny Visual stand-in for Border's child slot — reports a configurable
// DesiredSize so Border's measure math is testable in isolation.
class FixedSize extends Element
{
    constructor(private readonly desired: Size) { super(); }
    protected override MeasureOverride(_availableSize: Size): Size { return this.desired; }
    public last_arrange_rect: Rect | undefined;
    protected override ArrangeOverride(finalSize: Size): Size
    {
        this.last_arrange_rect = (this as unknown as { _arrangedRect: Rect })._arrangedRect;
        return finalSize;
    }
}

interface CapturedRect
{
    brush: Brush | undefined;
    pen: Pen | undefined;
    rect: Rect;
    radiusX?: number;
    radiusY?: number;
}

interface CapturedGeometry
{
    brush: Brush | undefined;
    pen: Pen | undefined;
    geometry: Geometry;
}

class CapturingContext implements DrawingContext
{
    public rects: CapturedRect[] = [];
    public geometries: CapturedGeometry[] = [];
    DrawRectangle(brush: Brush | undefined, pen: Pen | undefined, rect: Rect): void
    {
        this.rects.push({ brush, pen, rect });
    }
    DrawRoundedRectangle(
        brush: Brush | undefined,
        pen: Pen | undefined,
        rect: Rect,
        radiusX: number,
        radiusY: number,
    ): void
    {
        this.rects.push({ brush, pen, rect, radiusX, radiusY });
    }
    DrawGeometry(brush: Brush | undefined, pen: Pen | undefined, geometry: Geometry): void
    {
        this.geometries.push({ brush, pen, geometry });
    }
    DrawText(): void     { throw new Error('not used'); }
    PushTransform(): void { /* no-op for tests */ }
    PushClip(): void      { /* no-op for tests */ }
    Pop(): void           { /* no-op for tests */ }
}

describe('Border defaults', () => {
    test('a fresh Border has no child, no fill, no stroke, zero padding, square corners', () => {
        const b = new Border();
        assert.equal(b.child, undefined);
        assert.equal(b.Fill, undefined);
        assert.equal(b.Stroke, undefined);
        assert.ok(b.Padding.Equals(Thickness.Zero));
        assert.equal(b.CornerRadius, 0);
    });

    test('an empty Border measures to Size.Zero with zero insets', () => {
        const b = new Border();
        b.Measure(new Size(500, 500));
        assert.ok(b.DesiredSize.Equals(Size.Zero));
    });

    test('constructor accepts a child Visual and sets it', () => {
        const child = new FixedSize(new Size(50, 30));
        const b = new Border(child);
        assert.equal(b.child, child);
    });
});

describe('Border baseline probe (ContentChild / TopContentInset)', () => {
    test('exposes the single child and the inset above it (Stroke thickness + Padding.Top)', () => {
        const child = new FixedSize(new Size(30, 12));
        const b = new Border(child);
        b.Stroke = new Pen(new SolidColorBrush(Color.Black), 2);   // width 2
        b.Padding = new Thickness(5, 3, 5, 4);                     // top 3
        assert.equal(b.ContentChild, child);
        assert.equal(b.TopContentInset, 5);                       // 2 + 3
    });

    test('no Stroke brush → the inset above the child is Padding.Top only', () => {
        const child = new FixedSize(new Size(30, 12));
        const b = new Border(child);
        b.Padding = new Thickness(5, 3, 5, 4);
        assert.equal(b.TopContentInset, 3);
    });
});

describe('Border ClipToBounds', () => {
    const arranged = (b: Border, w: number, h: number): void => {
        b.Measure(new Size(500, 500));
        b.Arrange(new Rect(0, 0, w, h));
    };

    test('off by default → Border sets no child clip', () => {
        const b = new Border(new FixedSize(new Size(40, 20)));
        arranged(b, 40, 20);
        assert.equal(b.ChildClip, undefined);
    });

    test('on → a rounded RectangleGeometry matching the render size + uniform radius', () => {
        const b = new Border(new FixedSize(new Size(40, 20)));
        b.CornerRadius = 6;
        b.ClipToBounds = true;
        arranged(b, 40, 20);
        const clip = b.ChildClip as RectangleGeometry;
        assert.ok(clip instanceof RectangleGeometry);
        assert.equal(clip.Rect.Width, 40);
        assert.equal(clip.Rect.Height, 20);
        assert.equal(clip.RadiusX, 6);
        assert.equal(clip.RadiusY, 6);
    });

    test('a Stroke insets the child clip by the pen thickness on each side', () => {
        const b = new Border(new FixedSize(new Size(40, 20)));
        b.Stroke = new Pen(new SolidColorBrush(Color.Black), 3);
        b.CornerRadius = 6;
        b.ClipToBounds = true;
        arranged(b, 40, 20);
        const clip = b.ChildClip as RectangleGeometry;
        assert.ok(clip instanceof RectangleGeometry);
        // Inner rect inset by 3 each side; radius reduced by 3.
        assert.equal(clip.Rect.X, 3);
        assert.equal(clip.Rect.Y, 3);
        assert.equal(clip.Rect.Width, 34);
        assert.equal(clip.Rect.Height, 14);
        assert.equal(clip.RadiusX, 3);
    });

    test('asymmetric CornerRadius clips to a plain rectangle (no per-corner clip path)', () => {
        const b = new Border(new FixedSize(new Size(40, 20)));
        b.CornerRadius = new CornerRadius(8, 0, 0, 8);
        b.ClipToBounds = true;
        arranged(b, 40, 20);
        const clip = b.ChildClip as RectangleGeometry;
        assert.ok(clip instanceof RectangleGeometry);
        assert.equal(clip.RadiusX, 0);
        assert.equal(clip.RadiusY, 0);
    });

    test('toggling ClipToBounds off clears the clip it applied', () => {
        const b = new Border(new FixedSize(new Size(40, 20)));
        b.CornerRadius = 6;
        b.ClipToBounds = true;
        arranged(b, 40, 20);
        assert.ok(b.ChildClip !== undefined);
        b.ClipToBounds = false;
        b.Arrange(new Rect(0, 0, 40, 20));
        assert.equal(b.ChildClip, undefined);
    });

    test('a CornerRadius change refreshes the clip radius on re-arrange', () => {
        const b = new Border(new FixedSize(new Size(40, 20)));
        b.CornerRadius = 6;
        b.ClipToBounds = true;
        arranged(b, 40, 20);
        b.CornerRadius = 10;
        b.Arrange(new Rect(0, 0, 40, 20));
        assert.equal((b.ChildClip as RectangleGeometry).RadiusX, 10);
    });
});

describe('Border layout — insets reduce child available size and inflate desired', () => {
    test('Padding alone shrinks child available, grows Border desired', () => {
        const child = new FixedSize(new Size(100, 50));
        const b = new Border(child);
        b.Padding = new Thickness(10, 20, 30, 40); // L T R B

        b.Measure(new Size(500, 500));

        // Border consumed 40 horizontally (10 + 30), 60 vertically (20 + 40).
        assert.ok(b.DesiredSize.Equals(new Size(140, 110)));
    });

    test('the Stroke thickness adds on top of Padding', () => {
        const child = new FixedSize(new Size(100, 50));
        const b = new Border(child);
        b.Stroke  = new Pen(new SolidColorBrush(Color.Black), 2); // uniform 2
        b.Padding = new Thickness(5);                             // uniform 5

        b.Measure(new Size(500, 500));

        // Each side eats (2 + 5) = 7. Horizontal = 14, vertical = 14.
        assert.ok(b.DesiredSize.Equals(new Size(114, 64)));
    });

    test('a Stroke with no brush reserves no width (Padding only)', () => {
        const child = new FixedSize(new Size(100, 50));
        const b = new Border(child);
        b.Stroke  = new Pen(undefined, 4); // no brush → no visible border, no reserve
        b.Padding = new Thickness(5);

        b.Measure(new Size(500, 500));
        assert.ok(b.DesiredSize.Equals(new Size(110, 60)));
    });

    test('an empty Border still reports inset-only desired size', () => {
        const b = new Border();
        b.Padding = new Thickness(10);
        b.Measure(new Size(500, 500));
        assert.ok(b.DesiredSize.Equals(new Size(20, 20)));
    });

    test('insets larger than availableSize clamp child available to 0 (no negative)', () => {
        const child = new FixedSize(new Size(100, 50));
        const b = new Border(child);
        b.Padding = new Thickness(1000);

        b.Measure(new Size(50, 50));
        assert.ok(b.DesiredSize.Equals(new Size(100 + 2000, 50 + 2000)));
    });
});

describe('Border layout — Arrange positions child after insets', () => {
    test('child is arranged inside (Stroke thickness + Padding) on each side', () => {
        const child = new FixedSize(new Size(100, 50));
        const b = new Border(child);
        b.Stroke  = new Pen(new SolidColorBrush(Color.Black), 2);
        b.Padding = new Thickness(10, 20, 30, 40);

        b.Measure(new Size(500, 500));
        b.Arrange(new Rect(0, 0, 200, 200));

        // Child rect: offset (2+10, 2+20) = (12, 22)
        // Size: 200 - (2+10) - (2+30) = 156 wide; 200 - (2+20) - (2+40) = 136 tall
        assert.ok(child.last_arrange_rect!.Equals(new Rect(12, 22, 156, 136)));
    });

    test('with no insets, child fills the Border rect at origin', () => {
        const child = new FixedSize(new Size(50, 30));
        const b = new Border(child);
        b.Measure(new Size(200, 200));
        b.Arrange(new Rect(5, 7, 200, 200));
        assert.ok(child.last_arrange_rect!.Equals(new Rect(0, 0, 200, 200)));
    });

    test('insets larger than finalSize clamp child rect size to 0', () => {
        const child = new FixedSize(new Size(50, 30));
        const b = new Border(child);
        b.Padding = new Thickness(1000);
        b.Measure(new Size(2200, 2200));
        b.Arrange(new Rect(0, 0, 100, 100));
        assert.ok(child.last_arrange_rect!.Equals(new Rect(1000, 1000, 0, 0)));
    });
});

// Read the Rect + corner radii from a RectangleGeometry emitted via DrawGeometry.
function rectOf(g: CapturedGeometry): { rect: Rect; rx: number; ry: number }
{
    const rg = g.geometry as RectangleGeometry;
    return { rect: rg.Rect, rx: rg.RadiusX, ry: rg.RadiusY };
}

describe('Border render — Fill + uniform Stroke', () => {
    test('no Fill and no Stroke emits no draw calls', () => {
        const b = new Border();
        b.Measure(new Size(100, 100));
        b.Arrange(new Rect(0, 0, 100, 100));
        const dc = new CapturingContext();
        b.Render(dc);
        assert.deepEqual(dc.rects, []);
        assert.deepEqual(dc.geometries, []);
    });

    test('Fill-only paints one geometry covering the full RenderSize', () => {
        const b = new Border();
        b.Fill = new SolidColorBrush(Color.Red);
        b.Measure(new Size(100, 100));
        b.Arrange(new Rect(0, 0, 100, 100));

        const dc = new CapturingContext();
        b.Render(dc);

        assert.equal(dc.geometries.length, 1);
        const g = dc.geometries[0]!;
        assert.equal(g.brush, b.Fill);
        assert.equal(g.pen, undefined);
        assert.ok(rectOf(g).rect.Equals(new Rect(0, 0, 100, 100)));
    });

    test('Stroke strokes a geometry inset by half the pen thickness, at the pen width', () => {
        const b = new Border();
        const brush = new SolidColorBrush(Color.Black);
        b.Stroke = new Pen(brush, 4);
        b.Measure(new Size(100, 100));
        b.Arrange(new Rect(0, 0, 100, 100));

        const dc = new CapturingContext();
        b.Render(dc);

        assert.equal(dc.geometries.length, 1);
        const g = dc.geometries[0]!;
        assert.equal(g.brush, undefined);
        assert.equal(g.pen!.Brush, brush);
        assert.equal(g.pen!.Thickness, 4);
        // Centred stroke → geometry inset by 2 (half of 4) on each side.
        assert.ok(rectOf(g).rect.Equals(new Rect(2, 2, 96, 96)));
    });

    test('Stroke dash/cap/join carry onto the pen used to paint', () => {
        const b = new Border();
        const pen = new Pen(new SolidColorBrush(Color.Black), 2);
        pen.DashStyle = DashStyle.Dash; pen.LineJoin = LineJoin.Round;
        b.Stroke = pen;
        b.Measure(new Size(40, 40)); b.Arrange(new Rect(0, 0, 40, 40));
        const dc = new CapturingContext();
        b.Render(dc);
        const eff = dc.geometries[0]!.pen!;
        assert.equal(eff.DashStyle, DashStyle.Dash);
        assert.equal(eff.LineJoin, LineJoin.Round);
    });

    test('Fill + Stroke emits ONE geometry carrying both fill and stroke', () => {
        const b = new Border();
        const brush = new SolidColorBrush(Color.Black);
        b.Fill   = new SolidColorBrush(Color.White);
        b.Stroke = new Pen(brush, 1);

        b.Measure(new Size(50, 50));
        b.Arrange(new Rect(0, 0, 50, 50));

        const dc = new CapturingContext();
        b.Render(dc);

        assert.equal(dc.geometries.length, 1);
        assert.equal(dc.geometries[0]!.brush, b.Fill);
        assert.equal(dc.geometries[0]!.pen!.Brush, brush);
    });

    test('Stroke with zero thickness emits no stroke', () => {
        const b = new Border();
        b.Stroke = new Pen(new SolidColorBrush(Color.Black), 0);
        b.Measure(new Size(100, 100));
        b.Arrange(new Rect(0, 0, 100, 100));

        const dc = new CapturingContext();
        b.Render(dc);
        assert.deepEqual(dc.rects, []);
        assert.deepEqual(dc.geometries, []);
    });

    test('Stroke with no brush emits no stroke', () => {
        const b = new Border();
        b.Stroke = new Pen(undefined, 3);
        b.Measure(new Size(100, 100));
        b.Arrange(new Rect(0, 0, 100, 100));

        const dc = new CapturingContext();
        b.Render(dc);
        assert.deepEqual(dc.geometries, []);
    });
});

describe('Border render — CornerRadius (uniform + asymmetric)', () => {
    test('CornerRadius=0 → geometry with zero corner radius', () => {
        const b = new Border();
        b.Fill = new SolidColorBrush(Color.Red);
        b.Measure(new Size(100, 100));
        b.Arrange(new Rect(0, 0, 100, 100));

        const dc = new CapturingContext();
        b.Render(dc);

        assert.equal(dc.geometries.length, 1);
        assert.equal(rectOf(dc.geometries[0]!).rx, 0, 'square corners');
    });

    test('CornerRadius>0 fills a rounded geometry at the outer radius', () => {
        const b = new Border();
        b.Fill = new SolidColorBrush(Color.Red);
        b.CornerRadius = 12;
        b.Measure(new Size(100, 100));
        b.Arrange(new Rect(0, 0, 100, 100));

        const dc = new CapturingContext();
        b.Render(dc);

        assert.equal(dc.geometries.length, 1);
        const g = dc.geometries[0]!;
        const { rect, rx, ry } = rectOf(g);
        assert.equal(rx, 12);
        assert.equal(ry, 12);
        assert.ok(rect.Equals(new Rect(0, 0, 100, 100)));
    });

    test('CornerRadius>0 with stroke insets the corner by half the pen thickness', () => {
        const b = new Border();
        b.Stroke       = new Pen(new SolidColorBrush(Color.Black), 4);
        b.CornerRadius = 12;
        b.Measure(new Size(100, 100));
        b.Arrange(new Rect(0, 0, 100, 100));

        const dc = new CapturingContext();
        b.Render(dc);

        assert.equal(dc.geometries.length, 1);
        const g = dc.geometries[0]!;
        assert.equal(g.brush, undefined);
        assert.equal(g.pen!.Thickness, 4);
        const { rect, rx, ry } = rectOf(g);
        // Inner radius = outer 12 - half-stroke 2 = 10; rect inset by 2.
        assert.equal(rx, 10);
        assert.equal(ry, 10);
        assert.ok(rect.Equals(new Rect(2, 2, 96, 96)));
    });

    test('CornerRadius smaller than half-stroke clamps inner radius to 0', () => {
        const b = new Border();
        b.Stroke       = new Pen(new SolidColorBrush(Color.Black), 20); // half = 10
        b.CornerRadius = 4;                                             // less than half
        b.Measure(new Size(100, 100));
        b.Arrange(new Rect(0, 0, 100, 100));

        const dc = new CapturingContext();
        b.Render(dc);

        assert.equal(rectOf(dc.geometries[0]!).rx, 0,
            'inner radius clamped to zero — corner becomes sharp');
    });

    test('CornerRadius.Full clamps to min(width, height)/2 — wide rect → stadium', () => {
        const b = new Border();
        b.Fill   = new SolidColorBrush(Color.Red);
        b.CornerRadius = CornerRadius.Full;
        b.Measure(new Size(200, 40));
        b.Arrange(new Rect(0, 0, 200, 40));

        const dc = new CapturingContext();
        b.Render(dc);

        assert.equal(dc.geometries.length, 1);
        const { rx, ry } = rectOf(dc.geometries[0]!);
        assert.equal(rx, 20);
        assert.equal(ry, 20);
    });

    test('single-argument CornerRadius renders a UNIFORM rounded rect (regression: (n) tuple)', () => {
        // The compiler lowers a 1-element markup tuple `CornerRadius = (6)` to
        // `new CornerRadius(6)`. That must round all four corners equally — a
        // clean RectangleGeometry with rx = ry = 6 — NOT leave three corners
        // non-finite (folded to Full) which traced a lopsided per-corner path
        // (one square corner + three circular). This is what made the header
        // close/overflow buttons render a non-circular blob on hover.
        const b = new Border();
        b.Fill = new SolidColorBrush(Color.Red);
        b.CornerRadius = new CornerRadius(6);
        b.Measure(new Size(100, 100));
        b.Arrange(new Rect(0, 0, 100, 100));

        const dc = new CapturingContext();
        b.Render(dc);

        assert.equal(dc.geometries.length, 1, 'uniform corners lower to ONE RectangleGeometry, not a per-corner path');
        const { rx, ry } = rectOf(dc.geometries[0]!);
        assert.equal(rx, 6, 'all four corners rounded to 6');
        assert.equal(ry, 6);
    });

    test('asymmetric corners + uniform stroke trace a per-corner path (DrawGeometry, not a rounded-rect)', () => {
        // A connected-bar / segmented shape: rounded left ends, square right.
        // With the uniform-Stroke model this now STROKES correctly (the old
        // four-rect path could not) — the geometry flows through DrawGeometry.
        const b = new Border();
        b.Fill   = new SolidColorBrush(Color.Red);
        b.Stroke = new Pen(new SolidColorBrush(Color.Black), 1);
        b.CornerRadius = new CornerRadius(
            Number.POSITIVE_INFINITY, 0, 0, Number.POSITIVE_INFINITY);
        b.Measure(new Size(200, 40));
        b.Arrange(new Rect(0, 0, 200, 40));

        const dc = new CapturingContext();
        b.Render(dc);

        assert.equal(dc.rects.length, 0);
        assert.equal(dc.geometries.length, 1);
        assert.equal(dc.geometries[0]!.brush, b.Fill);
        assert.equal(dc.geometries[0]!.pen!.Brush, (b.Stroke as Pen).Brush);
    });
});

describe('Border invalidation — property changes route through Visual.OnPropertyChanged', () => {
    test('changing Padding invalidates measure and arrange', () => {
        const b = new Border();
        b.Measure(new Size(100, 100));
        b.Arrange(new Rect(0, 0, 100, 100));
        assert.equal(b.IsMeasureValid, true);
        assert.equal(b.IsArrangeValid, true);

        b.Padding = new Thickness(5);
        assert.equal(b.IsMeasureValid, false);
        assert.equal(b.IsArrangeValid, false);
    });

    test('changing Fill leaves measure and arrange valid (Render-only)', () => {
        const b = new Border();
        b.Measure(new Size(100, 100));
        b.Arrange(new Rect(0, 0, 100, 100));

        b.Fill = new SolidColorBrush(Color.Red);
        assert.equal(b.IsMeasureValid, true);
        assert.equal(b.IsArrangeValid, true);
    });
});

// Thickness has its own focused suite — it underpins Padding, Margin, and
// CornerRadius tuples, so its constructor overloads and derived getters need
// pinning even though Border no longer has a Thickness-typed width.
describe('Thickness value type', () => {
    test('single-arg constructor sets all four sides equal', () => {
        const t = new Thickness(7);
        assert.equal(t.Left, 7);
        assert.equal(t.Top, 7);
        assert.equal(t.Right, 7);
        assert.equal(t.Bottom, 7);
    });

    test('two-arg constructor sets horizontal and vertical pairs', () => {
        const t = new Thickness(5, 10);
        assert.equal(t.Left, 5);
        assert.equal(t.Right, 5);
        assert.equal(t.Top, 10);
        assert.equal(t.Bottom, 10);
    });

    test('four-arg constructor sets each side independently', () => {
        const t = new Thickness(1, 2, 3, 4);
        assert.equal(t.Left, 1);
        assert.equal(t.Top, 2);
        assert.equal(t.Right, 3);
        assert.equal(t.Bottom, 4);
    });

    test('Horizontal and Vertical sum opposite sides', () => {
        const t = new Thickness(1, 2, 3, 4);
        assert.equal(t.Horizontal, 1 + 3);
        assert.equal(t.Vertical,   2 + 4);
    });

    test('IsZero is true only when every side is 0', () => {
        assert.equal(Thickness.Zero.IsZero, true);
        assert.equal(new Thickness(0).IsZero, true);
        assert.equal(new Thickness(0, 0, 0, 1).IsZero, false);
    });

    test('Equals compares structurally', () => {
        const a = new Thickness(1, 2, 3, 4);
        const b = new Thickness(1, 2, 3, 4);
        const c = new Thickness(1, 2, 3, 5);
        assert.equal(a.Equals(b), true);
        assert.equal(a.Equals(c), false);
    });
});
