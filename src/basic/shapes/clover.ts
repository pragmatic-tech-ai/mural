import {
    MetaData,
    MuralBase,
    Point,
    Size,
    type DrawingContext,
} from '../../runtime/index.js';
import {
    LineSegment,
    PathFigure,
    PathGeometry,
    type Geometry,
} from '../../visual-engine/index.js';
import { Shape } from './shape.js';

// M3 Clover — N-lobed radial petal shape. The radius oscillates around
// the inscribing ellipse:
//
//   r(θ) = r_outer · ((1 − CuspDepth/2) + (CuspDepth/2) · cos(N · θ))
//
// Peaks (`cos = +1`) touch the ellipse; cusps (`cos = −1`) pull inward
// to `r_outer · (1 − CuspDepth)`. CuspDepth = 0 collapses to an ellipse;
// CuspDepth = 1 pulls the cusps to the centre (sharp star).
//
// Parameters:
//   * Leaves     — lobe count. Default 4 (M3 "FourLeafClover").
//   * CuspDepth  — 0…1. Default 0.6 — matches the M3 named clover's
//                 r_inner / r_outer ratio of ~0.4.
//   * Rotation   — degrees. Default −90 — first lobe peak points up.
//   * Samples    — sampling resolution per leaf. Default 24 — smooth
//                 enough at typical UI sizes; consumers can dial up for
//                 large hero artwork.
//
// The curve is rendered as a closed polyline (LineSegments). At 24
// samples per leaf the visible curvature is indistinguishable from a
// continuous cosine; a future refinement could swap to cubic Beziers.
//
// Stroke insets by half-thickness.
export class Clover extends Shape
{
    public static readonly LeavesKey          = MuralBase.RegisterProperty<number>(           Clover, 'Leaves',          4,         MetaData.Render);
    public static readonly CuspDepthKey       = MuralBase.RegisterProperty<number>(           Clover, 'CuspDepth',       0.6,       MetaData.Render);
    public static readonly RotationKey        = MuralBase.RegisterProperty<number>(           Clover, 'Rotation',        -90,       MetaData.Render);
    public static readonly SamplesKey         = MuralBase.RegisterProperty<number>(           Clover, 'Samples',         24,        MetaData.Render);

    public get Leaves(): number { return this.get_property_value(Clover.LeavesKey); }
    public set Leaves(v: number) { this.set_property_value(Clover.LeavesKey, v); }

    public get CuspDepth(): number { return this.get_property_value(Clover.CuspDepthKey); }
    public set CuspDepth(v: number) { this.set_property_value(Clover.CuspDepthKey, v); }

    public get Rotation(): number { return this.get_property_value(Clover.RotationKey); }
    public set Rotation(v: number) { this.set_property_value(Clover.RotationKey, v); }

    public get Samples(): number { return this.get_property_value(Clover.SamplesKey); }
    public set Samples(v: number) { this.set_property_value(Clover.SamplesKey, v); }

    // Hit / clip outline = the OUTER silhouette (inset 0).
    protected override buildGeometry(size: Size): Geometry | undefined
    {
        return this.buildOutline(size, 0);
    }

    // The silhouette inset uniformly by `inset` px per edge.
    private buildOutline(size: Size, inset: number): Geometry | undefined
    {
        if (size.Width <= 0 || size.Height <= 0) return undefined;

        const w    = Math.max(0, size.Width  - 2 * inset);
        const h    = Math.max(0, size.Height - 2 * inset);
        const rx   = w / 2;
        const ry   = h / 2;
        const cx   = inset + rx;
        const cy   = inset + ry;

        const N     = Math.max(1, Math.floor(this.Leaves));
        const cusp  = Math.max(0, Math.min(1, this.CuspDepth));
        const phi0  = this.Rotation * Math.PI / 180;
        const perLf = Math.max(4, Math.floor(this.Samples));
        const total = N * perLf;

        const base = 1 - cusp / 2;
        const amp  = cusp / 2;

        const samples: Point[] = [];
        for (let i = 0; i < total; i++)
        {
            const t01   = i / total;
            const θ     = phi0 + 2 * Math.PI * t01;
            const scale = base + amp * Math.cos(N * 2 * Math.PI * t01);
            samples.push(new Point(
                cx + rx * scale * Math.cos(θ),
                cy + ry * scale * Math.sin(θ),
            ));
        }

        const segs: LineSegment[] = [];
        for (let i = 1; i < samples.length; i++) segs.push(new LineSegment(samples[i]!));
        const figure = new PathFigure(samples[0]!, segs, true);

        return new PathGeometry([figure]);
    }

    protected override RenderOverride(dc: DrawingContext): void
    {
        const geom = this.buildOutline(this.RenderSize, (this.Stroke?.Thickness ?? 0) / 2);
        if (geom === undefined) return;
        dc.DrawGeometry(this.Fill, this.Stroke, geom);
    }
}

// ────────────────────────────────────────────────────────────────────
// Named clover variants — thin subclasses that override `Leaves` via
// metadata for ergonomic markup.
// ────────────────────────────────────────────────────────────────────

export class FourLeafClover extends Clover
{
    static
    {
        MuralBase.OverrideMetadata(FourLeafClover, Clover.LeavesKey, { default_value: 4 });
    }
}

export class EightLeafClover extends Clover
{
    static
    {
        MuralBase.OverrideMetadata(EightLeafClover, Clover.LeavesKey, { default_value: 8 });
    }
}
