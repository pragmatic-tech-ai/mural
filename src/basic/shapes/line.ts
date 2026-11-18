import { MetaData, MuralBase, Point, Size, type DrawingContext } from '../../runtime/index.js';
import { LineGeometry } from '../../visual-engine/index.js';
import { Orientation } from '../panels/orientation.js';
import { Shape } from './shape.js';

// Straight-line shape. Two modes:
//
// 1. Two-point (default — Orientation unset). Draws a stroked line from
//    (X1, Y1) to (X2, Y2) in its own LOCAL coordinate space. WPF parity:
//    same DPs (X1, Y1, X2, Y2, Stroke, StrokeThickness). The line
//    measures to the bounding box of its endpoints (max(X1,X2) wide ×
//    max(Y1,Y2) tall); negative coordinates clip to zero.
//
//    Board-app usage: the host positions the Line via Canvas.SetLeft /
//    SetTop to the bounding box's top-left in canvas coords, and sets
//    X1/Y1/X2/Y2 RELATIVE to that origin so each connector's hit area
//    stays tight to the line rather than blanket-covering the canvas.
//
// 2. Oriented (Orientation = Horizontal | Vertical). The endpoint DPs
//    are ignored; the line stretches to fill whatever slot the parent
//    hands it and draws across that slot's centre — a Horizontal line
//    spans the full width at mid-height, a Vertical line spans the full
//    height at mid-width. This is the separator / rule use case: drop it
//    in a panel or grid cell and it sizes itself. Cross-axis desired
//    size is the stroke thickness so it never collapses inside a stack;
//    the main axis relies on the default Stretch alignment to fill.
//
// Render: a LineGeometry stroked with `Stroke` × `StrokeThickness`. No
// fill (a line has zero area).
export class Line extends Shape
{
    public static readonly X1Key              = MuralBase.RegisterProperty<number>(           Line, 'X1',              0,         MetaData.Measure | MetaData.Render);
    public static readonly Y1Key              = MuralBase.RegisterProperty<number>(           Line, 'Y1',              0,         MetaData.Measure | MetaData.Render);
    public static readonly X2Key              = MuralBase.RegisterProperty<number>(           Line, 'X2',              0,         MetaData.Measure | MetaData.Render);
    public static readonly Y2Key              = MuralBase.RegisterProperty<number>(           Line, 'Y2',              0,         MetaData.Measure | MetaData.Render);
    public static readonly OrientationKey     = MuralBase.RegisterProperty<Orientation | undefined>(Line, 'Orientation', undefined, MetaData.Measure | MetaData.Render);

    public get X1(): number { return this.get_property_value(Line.X1Key); }
    public set X1(value: number) { this.set_property_value(Line.X1Key, value); }

    public get Y1(): number { return this.get_property_value(Line.Y1Key); }
    public set Y1(value: number) { this.set_property_value(Line.Y1Key, value); }

    public get X2(): number { return this.get_property_value(Line.X2Key); }
    public set X2(value: number) { this.set_property_value(Line.X2Key, value); }

    public get Y2(): number { return this.get_property_value(Line.Y2Key); }
    public set Y2(value: number) { this.set_property_value(Line.Y2Key, value); }

    // Unset → two-point mode. Horizontal / Vertical → stretch-and-fill
    // separator mode (endpoint DPs ignored).
    public get Orientation(): Orientation | undefined { return this.get_property_value(Line.OrientationKey); }
    public set Orientation(value: Orientation | undefined) { this.set_property_value(Line.OrientationKey, value); }

    protected override MeasureOverride(_availableSize: Size): Size
    {
        const half = (this.Stroke?.Thickness ?? 0) / 2;
        const orientation = this.Orientation;
        if (orientation !== undefined)
        {
            // Oriented mode: zero on the main axis so default Stretch
            // alignment fills the parent's slot; stroke thickness on the
            // cross axis so the line keeps a measurable size inside a
            // stack panel (where the main axis is given infinite room).
            const thickness = half * 2;
            return orientation === Orientation.Horizontal
                ? new Size(0, thickness)
                : new Size(thickness, 0);
        }

        // Two-point mode: bounding box of the endpoints + half stroke on
        // each side. Negative coords are clipped — author should keep
        // endpoints non-negative in local space.
        const w = Math.max(0, Math.max(this.X1, this.X2)) + half * 2;
        const h = Math.max(0, Math.max(this.Y1, this.Y2)) + half * 2;
        return new Size(w, h);
    }

    protected override RenderOverride(dc: DrawingContext): void
    {
        const stroke = this.Stroke;
        if (stroke === undefined || stroke.Thickness <= 0) return;

        const orientation = this.Orientation;
        let geom: LineGeometry;
        if (orientation === Orientation.Horizontal)
        {
            const { Width: w, Height: h } = this.RenderSize;
            const y = h / 2;
            geom = new LineGeometry(new Point(0, y), new Point(w, y));
        }
        else if (orientation === Orientation.Vertical)
        {
            const { Width: w, Height: h } = this.RenderSize;
            const x = w / 2;
            geom = new LineGeometry(new Point(x, 0), new Point(x, h));
        }
        else
        {
            geom = new LineGeometry(
                new Point(this.X1, this.Y1),
                new Point(this.X2, this.Y2),
            );
        }
        dc.DrawGeometry(undefined, stroke, geom);
    }
}
