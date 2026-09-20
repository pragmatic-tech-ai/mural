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

// M3 RadialWave — convex N-lobed star / burst silhouette. The radius
// oscillates around the inscribing ellipse:
//
//   profile(θ)   = sign(cos(N·θ)) · |cos(N·θ)|^(1 + 5·Sharpness)
//   r(θ)         = r_outer · (1 − Amplitude/2 + Amplitude/2 · profile(θ))
//
// `Amplitude` (0…1, fraction of r_outer) sets peak-to-valley range:
// peaks reach r_outer; valleys sit at r_outer · (1 − Amplitude). Set
// Amplitude=0 for a perfect ellipse, Amplitude=1 for cusps at the centre
// (Clover territory).
//
// `Sharpness` (0…1) bends the cosine profile. 0 = pure sinusoid (smooth
// lobes); 1 = power-of-6 cosine (narrow, pointy peaks — the "burst"
// look). The blend keeps peak amplitude constant so dialing sharpness
// changes the lobe profile but not its envelope.
//
// Sampling: `Lobes × Samples` points connected with LineSegments. At
// Samples=24 the visible curvature is indistinguishable from continuous;
// dial higher for hero artwork at large sizes.
//
// Stroke insets by half-thickness.
export class RadialWave extends Shape
{
    public static readonly LobesKey           = MuralBase.RegisterProperty<number>(           RadialWave, 'Lobes',           8,         MetaData.Render);
    public static readonly AmplitudeKey       = MuralBase.RegisterProperty<number>(           RadialWave, 'Amplitude',       0.20,      MetaData.Render);
    public static readonly SharpnessKey       = MuralBase.RegisterProperty<number>(           RadialWave, 'Sharpness',       0,         MetaData.Render);
    public static readonly RotationKey        = MuralBase.RegisterProperty<number>(           RadialWave, 'Rotation',        -90,       MetaData.Render);
    public static readonly SamplesKey         = MuralBase.RegisterProperty<number>(           RadialWave, 'Samples',         24,        MetaData.Render);

    public get Lobes(): number { return this.get_property_value(RadialWave.LobesKey); }
    public set Lobes(v: number) { this.set_property_value(RadialWave.LobesKey, v); }

    public get Amplitude(): number { return this.get_property_value(RadialWave.AmplitudeKey); }
    public set Amplitude(v: number) { this.set_property_value(RadialWave.AmplitudeKey, v); }

    public get Sharpness(): number { return this.get_property_value(RadialWave.SharpnessKey); }
    public set Sharpness(v: number) { this.set_property_value(RadialWave.SharpnessKey, v); }

    public get Rotation(): number { return this.get_property_value(RadialWave.RotationKey); }
    public set Rotation(v: number) { this.set_property_value(RadialWave.RotationKey, v); }

    public get Samples(): number { return this.get_property_value(RadialWave.SamplesKey); }
    public set Samples(v: number) { this.set_property_value(RadialWave.SamplesKey, v); }

    // Hit / clip outline = the OUTER silhouette (inset 0), so the whole
    // shape including its stroke band is grabbable.
    protected override buildGeometry(size: Size): Geometry | undefined
    {
        return this.buildOutline(size, 0);
    }

    // The lobed burst silhouette inset uniformly by `inset` px on every edge.
    // buildGeometry uses inset 0 (outer, for hit); RenderOverride paints at
    // inset = t/2 so a centred stroke lands fully inside the outline.
    private buildOutline(size: Size, inset: number): Geometry | undefined
    {
        if (size.Width <= 0 || size.Height <= 0) return undefined;

        const w    = Math.max(0, size.Width  - 2 * inset);
        const h    = Math.max(0, size.Height - 2 * inset);
        const rx   = w / 2;
        const ry   = h / 2;
        const cx   = inset + rx;
        const cy   = inset + ry;

        const N         = Math.max(1, Math.floor(this.Lobes));
        const amp       = Math.max(0, Math.min(1, this.Amplitude));
        const sharpness = Math.max(0, Math.min(1, this.Sharpness));
        const phi0      = this.Rotation * Math.PI / 180;
        const perLobe   = Math.max(4, Math.floor(this.Samples));
        const total     = N * perLobe;

        const baseScale = 1 - amp / 2;
        const ampHalf   = amp / 2;
        const exponent  = 1 + 5 * sharpness;

        const samples: Point[] = [];
        for (let i = 0; i < total; i++)
        {
            const t01 = i / total;
            const θ   = phi0 + 2 * Math.PI * t01;
            const c   = Math.cos(N * 2 * Math.PI * t01);
            // Power-with-sign so the cosine retains its alternating
            // sign through the exponent; exponent = 1 collapses to the
            // raw cosine for the smooth case.
            const profile = Math.sign(c) * Math.pow(Math.abs(c), exponent);
            const scale   = baseScale + ampHalf * profile;
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
// Named radial-wave variants — thin subclasses that override Lobes /
// Amplitude / Sharpness via metadata so markup can use the named shape
// directly. Sharpness mappings:
//   smooth → 0
//   sharp  → 0.6
// Amplitude mappings (fraction of r_outer):
//   low    → 0.15
//   medium → 0.20
//   high   → 0.30
// ────────────────────────────────────────────────────────────────────

// Sunny — 8 smooth lobes at low amplitude.
export class Sunny extends RadialWave
{
    static
    {
        MuralBase.OverrideMetadata(Sunny, RadialWave.LobesKey,     { default_value: 8    });
        MuralBase.OverrideMetadata(Sunny, RadialWave.AmplitudeKey, { default_value: 0.15 });
        MuralBase.OverrideMetadata(Sunny, RadialWave.SharpnessKey, { default_value: 0    });
    }
}

// VerySunny — 8 smooth lobes at high amplitude.
export class VerySunny extends RadialWave
{
    static
    {
        MuralBase.OverrideMetadata(VerySunny, RadialWave.LobesKey,     { default_value: 8    });
        MuralBase.OverrideMetadata(VerySunny, RadialWave.AmplitudeKey, { default_value: 0.30 });
        MuralBase.OverrideMetadata(VerySunny, RadialWave.SharpnessKey, { default_value: 0    });
    }
}

// Burst — 12 sharp lobes at medium amplitude.
export class Burst extends RadialWave
{
    static
    {
        MuralBase.OverrideMetadata(Burst, RadialWave.LobesKey,     { default_value: 12   });
        MuralBase.OverrideMetadata(Burst, RadialWave.AmplitudeKey, { default_value: 0.20 });
        MuralBase.OverrideMetadata(Burst, RadialWave.SharpnessKey, { default_value: 0.6  });
    }
}

// SoftBurst — 12 smooth lobes at medium amplitude.
export class SoftBurst extends RadialWave
{
    static
    {
        MuralBase.OverrideMetadata(SoftBurst, RadialWave.LobesKey,     { default_value: 12   });
        MuralBase.OverrideMetadata(SoftBurst, RadialWave.AmplitudeKey, { default_value: 0.20 });
        MuralBase.OverrideMetadata(SoftBurst, RadialWave.SharpnessKey, { default_value: 0    });
    }
}

// Boom — 14 sharp lobes at high amplitude.
export class Boom extends RadialWave
{
    static
    {
        MuralBase.OverrideMetadata(Boom, RadialWave.LobesKey,     { default_value: 14   });
        MuralBase.OverrideMetadata(Boom, RadialWave.AmplitudeKey, { default_value: 0.30 });
        MuralBase.OverrideMetadata(Boom, RadialWave.SharpnessKey, { default_value: 0.6  });
    }
}

// SoftBoom — 14 smooth lobes at high amplitude.
export class SoftBoom extends RadialWave
{
    static
    {
        MuralBase.OverrideMetadata(SoftBoom, RadialWave.LobesKey,     { default_value: 14   });
        MuralBase.OverrideMetadata(SoftBoom, RadialWave.AmplitudeKey, { default_value: 0.30 });
        MuralBase.OverrideMetadata(SoftBoom, RadialWave.SharpnessKey, { default_value: 0    });
    }
}

// Flower — 10 smooth lobes at medium amplitude.
export class Flower extends RadialWave
{
    static
    {
        MuralBase.OverrideMetadata(Flower, RadialWave.LobesKey,     { default_value: 10   });
        MuralBase.OverrideMetadata(Flower, RadialWave.AmplitudeKey, { default_value: 0.20 });
        MuralBase.OverrideMetadata(Flower, RadialWave.SharpnessKey, { default_value: 0    });
    }
}
