import {
    Matrix,
    MetaData,
    MuralBase,
    Point,
    Size,
    type DrawingContext,
} from '../../runtime/index.js';
import {
    ArcSegment,
    LineSegment,
    MatrixTransform,
    PathFigure,
    PathGeometry,
    SweepDirection,
    type Geometry,
} from '../../visual-engine/index.js';
import { Shape } from './shape.js';

// M3 Puffy — square (or 45°-rotated diamond) with each edge bumped
// outward by `BumpsPerSide` half-circle / elliptical-arc lobes. The
// inner-rect / bump-radius split is tuned so the lobes fit inside the
// layout slot:
//
//   bumpR = min(W, H) / (2 · (BumpsPerSide + 1))
//   innerW = W − 2·bumpR,  innerH = H − 2·bumpR
//   chord_top / chord_bottom = innerW / BumpsPerSide
//   chord_left / chord_right = innerH / BumpsPerSide
//
// At a square aspect (W = H) and the default BumpsPerSide = 2 each lobe
// is a perfect half-circle. Anisotropic rects produce elliptical lobes;
// the silhouette stays correct but the lobes flatten / stretch.
//
// `Base = Diamond` post-rotates the figure 45° around the layout-rect
// centre. To keep the rotated silhouette inside the slot, the figure is
// pre-shrunk by 1/√2 — matches the M3 catalog's PuffyDiamond layout.
//
// Stroke insets by half-thickness.
export enum PuffyBase
{
    Square  = 'Square',
    Diamond = 'Diamond',
}

export class Puffy extends Shape
{
    public static readonly BumpsPerSideKey    = MuralBase.RegisterProperty<number>(           Puffy, 'BumpsPerSide',    2,         MetaData.Render);
    public static readonly BaseKey            = MuralBase.RegisterProperty<PuffyBase>(        Puffy, 'Base',            PuffyBase.Square, MetaData.Render);

    public get BumpsPerSide(): number { return this.get_property_value(Puffy.BumpsPerSideKey); }
    public set BumpsPerSide(v: number) { this.set_property_value(Puffy.BumpsPerSideKey, v); }

    public get Base(): PuffyBase { return this.get_property_value(Puffy.BaseKey); }
    public set Base(v: PuffyBase) { this.set_property_value(Puffy.BaseKey, v); }

    // Hit / clip outline = the OUTER silhouette (inset 0), with the
    // diamond rotation baked into the geometry's Transform so
    // Geometry.Contains (which inverts Transform) matches the drawn shape.
    // RenderOverride keeps its own dc.PushTransform — do NOT delegate, or
    // the rotation would apply twice.
    protected override buildGeometry(size: Size): Geometry | undefined
    {
        return this.buildOutline(size, 0);
    }

    // The puffy silhouette inset uniformly by `inset` px per edge.
    private buildOutline(size: Size, inset: number): Geometry | undefined
    {
        if (size.Width <= 0 || size.Height <= 0) return undefined;

        const w    = Math.max(0, size.Width  - 2 * inset);
        const h    = Math.max(0, size.Height - 2 * inset);

        const isDiamond = this.Base === PuffyBase.Diamond;
        const scale  = isDiamond ? Math.SQRT1_2 : 1;
        const innerW = w * scale;
        const innerH = h * scale;
        const offX   = inset + (w - innerW) / 2;
        const offY   = inset + (h - innerH) / 2;

        const geom = new PathGeometry([buildPuffyFigure(
            offX, offY, innerW, innerH,
            Math.max(1, Math.floor(this.BumpsPerSide)))]);

        if (isDiamond)
        {
            const cx = inset + w / 2;
            const cy = inset + h / 2;
            const a  = Math.PI / 4;
            const c  = Math.cos(a);
            const s  = Math.sin(a);
            const ox = cx - (cx * c + cy * s);
            const oy = cy - (cx * (-s) + cy * c);
            geom.Transform = new MatrixTransform(new Matrix(c, -s, s, c, ox, oy));
        }
        return geom;
    }

    protected override RenderOverride(dc: DrawingContext): void
    {
        const size = this.RenderSize;
        if (size.Width <= 0 || size.Height <= 0) return;

        const stroke = this.Stroke;
        const t      = stroke?.Thickness ?? 0;
        const half = t / 2;
        const w    = Math.max(0, size.Width  - 2 * half);
        const h    = Math.max(0, size.Height - 2 * half);

        const isDiamond = this.Base === PuffyBase.Diamond;
        // Pre-shrink so the 45° rotation stays inside the slot.
        const scale  = isDiamond ? Math.SQRT1_2 : 1;
        const innerW = w * scale;
        const innerH = h * scale;
        const offX   = half + (w - innerW) / 2;
        const offY   = half + (h - innerH) / 2;

        const figure = buildPuffyFigure(
            offX, offY, innerW, innerH,
            Math.max(1, Math.floor(this.BumpsPerSide)));

        if (!isDiamond)
        {
            dc.DrawGeometry(this.Fill, stroke, new PathGeometry([figure]));
            return;
        }

        // Rotate around the layout-rect centre. Matrix encodes
        // translate(−cx, −cy) · rotate(45°) · translate(cx, cy).
        const cx = half + w / 2;
        const cy = half + h / 2;
        const a  = Math.PI / 4;
        const c  = Math.cos(a);
        const s  = Math.sin(a);
        // Row-vector form: x' = x·c + y·s + ... ; y' = x·(-s) + y·c + ...
        const ox = cx - (cx * c + cy * s);
        const oy = cy - (cx * (-s) + cy * c);
        const rot = new Matrix(c, -s, s, c, ox, oy);

        dc.PushTransform(new MatrixTransform(rot));
        dc.DrawGeometry(this.Fill, stroke, new PathGeometry([figure]));
        dc.Pop();
    }
}

// PuffyDiamond — Puffy with `Base = Diamond` baked in.
export class PuffyDiamond extends Puffy
{
    static
    {
        MuralBase.OverrideMetadata(PuffyDiamond, Puffy.BaseKey, { default_value: PuffyBase.Diamond });
    }
}

function buildPuffyFigure(
    offX: number, offY: number, w: number, h: number, N: number,
): PathFigure
{
    const bumpR  = Math.min(w, h) / (2 * (N + 1));
    const innerW = w - 2 * bumpR;
    const innerH = h - 2 * bumpR;
    const chordTop  = innerW / N;
    const chordSide = innerH / N;

    const xL = offX + bumpR;
    const xR = offX + bumpR + innerW;
    const yT = offY + bumpR;
    const yB = offY + bumpR + innerH;

    const segs: (LineSegment | ArcSegment)[] = [];

    // Top edge — N bumps left → right, each protruding upward.
    for (let i = 0; i < N; i++)
    {
        const x0 = xL + i * chordTop;
        const x1 = x0 + chordTop;
        segs.push(new ArcSegment(
            new Point(x1, yT),
            new Size(chordTop / 2, bumpR),
            0, false, SweepDirection.Clockwise));
    }
    // Right edge — N bumps top → bottom, each protruding rightward.
    for (let i = 0; i < N; i++)
    {
        const y0 = yT + i * chordSide;
        const y1 = y0 + chordSide;
        segs.push(new ArcSegment(
            new Point(xR, y1),
            new Size(bumpR, chordSide / 2),
            0, false, SweepDirection.Clockwise));
    }
    // Bottom edge — N bumps right → left, each protruding downward.
    for (let i = 0; i < N; i++)
    {
        const x0 = xR - i * chordTop;
        const x1 = x0 - chordTop;
        segs.push(new ArcSegment(
            new Point(x1, yB),
            new Size(chordTop / 2, bumpR),
            0, false, SweepDirection.Clockwise));
    }
    // Left edge — N bumps bottom → top, each protruding leftward.
    for (let i = 0; i < N; i++)
    {
        const y0 = yB - i * chordSide;
        const y1 = y0 - chordSide;
        segs.push(new ArcSegment(
            new Point(xL, y1),
            new Size(bumpR, chordSide / 2),
            0, false, SweepDirection.Clockwise));
    }

    return new PathFigure(new Point(xL, yT), segs, true);
}
