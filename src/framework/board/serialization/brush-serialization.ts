// Brush / Pen serialization codec — the single fill & stroke wire form
// shared by every node serializer (the shape/container `data` records and
// the `visuals` card style). Extracting it here kills the near-identical
// `visibleHex` / `solidHex` helpers the two paths used to carry.
//
// Wire form (compact + backward-compatible):
//   * undefined brush (Format Shape "None")  → null
//   * SolidColorBrush                         → "#rrggbbaa" string, with the
//        brush's Opacity folded into the alpha (Transparency slider rides
//        Brush.Opacity, a scalar separate from Color.A — fold or lose it).
//        A legacy bare 6/8-digit hex string still deserialises unchanged.
//   * Linear / Radial / Pattern / Image       → a tagged object.
// Solids stay strings so existing .board files re-save byte-identical;
// only the richer brushes cost an object.

import {
    AlignmentX, AlignmentY, BitmapImage, Brush, Color, DashStyle, GradientStop,
    ImageBrush, LineCap, LineJoin, LinearGradientBrush, PatternBrush, PatternKind,
    Pen, Point, RadialGradientBrush, SolidColorBrush, Stretch,
} from '../../../visual-engine/index.js';

// Object-form discriminator (solids are bare strings, None is null, so these
// tags only cover the brushes that need structure).
export enum SerializedBrushKind
{
    Linear  = 'linear',
    Radial  = 'radial',
    Pattern = 'pattern',
    Image   = 'image',
}

interface SerializedStop { hex: string; at: number; }

interface SerializedLinear
{
    k:     SerializedBrushKind.Linear;
    stops: SerializedStop[];
    p:     [number, number, number, number];   // x1, y1, x2, y2
    o?:    number;                              // Opacity when ≠ 1
}
interface SerializedRadial
{
    k:     SerializedBrushKind.Radial;
    stops: SerializedStop[];
    c:     [number, number];                    // centre x, y
    r:     [number, number];                    // radius x, y
    o?:    number;
}
interface SerializedPattern
{
    k:      SerializedBrushKind.Pattern;
    kind:   PatternKind;
    fg:     string;
    bg:     string;
    size:   number;
    angle:  number;
    stroke: number;
    o?:     number;
}
interface SerializedImage
{
    k:       SerializedBrushKind.Image;
    uri:     string;
    stretch: Stretch;
    ax?:     AlignmentX;                         // omitted at the Center default
    ay?:     AlignmentY;
    o?:      number;
}

// The full wire union: a bare hex string (solid), null (None), or a tagged
// object (the richer brushes).
export type SerializedBrush =
    | string
    | null
    | SerializedLinear
    | SerializedRadial
    | SerializedPattern
    | SerializedImage;

// A solid's colour with its Brush.Opacity folded into the alpha channel.
function foldedHex(color: Color, opacity: number): string
{
    const alpha = Math.round(color.A * opacity);
    return color.WithAlpha(alpha).ToHex();
}

// True when a brush paints anything — used by consumers (e.g. the card store)
// that omit an invisible fill rather than record it. A solid is invisible when
// its effective alpha is 0; every other brush paints something.
export function isBrushVisible(brush: Brush | undefined): boolean
{
    if (brush === undefined) return false;
    if (brush instanceof SolidColorBrush) return Math.round(brush.Color.A * brush.Opacity) > 0;
    return true;
}

/** Encode a brush to its wire form (null for a "None"/undefined brush). */
export function serializeBrush(brush: Brush | undefined): SerializedBrush
{
    if (brush === undefined) return null;
    if (brush instanceof SolidColorBrush) return foldedHex(brush.Color, brush.Opacity);

    const stops = (b: LinearGradientBrush | RadialGradientBrush): SerializedStop[] =>
        b.GradientStops.map(s => ({ hex: s.Color.ToHex(), at: s.Offset }));
    const withOpacity = <T extends object>(o: T, brush: Brush): T =>
        brush.Opacity !== 1 ? { ...o, o: brush.Opacity } : o;

    if (brush instanceof LinearGradientBrush)
    {
        return withOpacity<SerializedLinear>({
            k: SerializedBrushKind.Linear,
            stops: stops(brush),
            p: [brush.StartPoint.X, brush.StartPoint.Y, brush.EndPoint.X, brush.EndPoint.Y],
        }, brush);
    }
    if (brush instanceof RadialGradientBrush)
    {
        return withOpacity<SerializedRadial>({
            k: SerializedBrushKind.Radial,
            stops: stops(brush),
            c: [brush.Center.X, brush.Center.Y],
            r: [brush.RadiusX, brush.RadiusY],
        }, brush);
    }
    if (brush instanceof PatternBrush)
    {
        return withOpacity<SerializedPattern>({
            k: SerializedBrushKind.Pattern,
            kind: brush.Kind,
            fg: brush.Foreground.ToHex(),
            bg: brush.Background.ToHex(),
            size: brush.Size,
            angle: brush.Angle,
            stroke: brush.StrokeThickness,
        }, brush);
    }
    if (brush instanceof ImageBrush)
    {
        const out: SerializedImage = {
            k: SerializedBrushKind.Image,
            uri: (brush.ImageSource as BitmapImage | undefined)?.Uri ?? '',
            stretch: brush.Stretch,
        };
        if (brush.AlignmentX !== AlignmentX.Center) out.ax = brush.AlignmentX;
        if (brush.AlignmentY !== AlignmentY.Center) out.ay = brush.AlignmentY;
        return withOpacity(out, brush);
    }
    // Unknown brush subtype — nothing structured to persist.
    return null;
}

/** Reconstruct a brush from its wire form. null / undefined → undefined. */
export function deserializeBrush(s: SerializedBrush | undefined): Brush | undefined
{
    if (s === undefined || s === null) return undefined;
    if (typeof s === 'string') return new SolidColorBrush(Color.FromHex(s));

    const stops = (arr: SerializedStop[]): GradientStop[] =>
        arr.map(st => new GradientStop(Color.FromHex(st.hex), st.at));

    switch (s.k)
    {
        case SerializedBrushKind.Linear:
        {
            const b = new LinearGradientBrush(stops(s.stops));
            b.StartPoint = new Point(s.p[0], s.p[1]);
            b.EndPoint   = new Point(s.p[2], s.p[3]);
            if (s.o !== undefined) b.Opacity = s.o;
            return b;
        }
        case SerializedBrushKind.Radial:
        {
            const b = new RadialGradientBrush(stops(s.stops));
            b.Center  = new Point(s.c[0], s.c[1]);
            b.RadiusX = s.r[0];
            b.RadiusY = s.r[1];
            if (s.o !== undefined) b.Opacity = s.o;
            return b;
        }
        case SerializedBrushKind.Pattern:
        {
            const b = new PatternBrush(s.kind, Color.FromHex(s.fg));
            b.Background      = Color.FromHex(s.bg);
            b.Size            = s.size;
            b.Angle           = s.angle;
            b.StrokeThickness = s.stroke;
            if (s.o !== undefined) b.Opacity = s.o;
            return b;
        }
        case SerializedBrushKind.Image:
        {
            const b = new ImageBrush(new BitmapImage(s.uri));
            b.Stretch = s.stretch;
            if (s.ax !== undefined) b.AlignmentX = s.ax;
            if (s.ay !== undefined) b.AlignmentY = s.ay;
            if (s.o !== undefined) b.Opacity = s.o;
            return b;
        }
    }
}

// ── Stroke (a Pen: brush + width + dash/caps/join/miter) ──────────────
//
// Kept as sibling fields (stroke / strokeWidth / …) rather than a nested
// object so legacy `{ stroke: "#hex", strokeWidth: 2 }` records still read.
// dash / cap / join / miter are omitted at their Pen defaults.
export interface StrokeFields
{
    stroke?:      SerializedBrush;
    strokeWidth?: number;
    strokeDash?:  number[];
    strokeCap?:   LineCap;
    strokeJoin?:  LineJoin;
    strokeMiter?: number;
}

/** Encode a Pen into the sibling stroke* fields (spread into the record). */
export function serializeStroke(pen: Pen | undefined): StrokeFields
{
    if (pen === undefined) return {};
    const out: StrokeFields = { stroke: serializeBrush(pen.Brush), strokeWidth: pen.Thickness };
    if (pen.DashStyle.Dashes.length > 0) out.strokeDash  = [...pen.DashStyle.Dashes];
    if (pen.LineCap    !== LineCap.Flat) out.strokeCap    = pen.LineCap;
    if (pen.LineJoin   !== LineJoin.Miter) out.strokeJoin = pen.LineJoin;
    if (pen.MiterLimit !== 10)           out.strokeMiter  = pen.MiterLimit;
    return out;
}

/** Reconstruct a Pen from the sibling stroke* fields; undefined when none. */
export function deserializeStroke(data: StrokeFields): Pen | undefined
{
    const hasBrush = 'stroke' in data && data.stroke !== undefined;
    const hasWidth = data.strokeWidth !== undefined;
    if (!hasBrush && !hasWidth) return undefined;
    const brush = hasBrush ? deserializeBrush(data.stroke) : undefined;
    const pen = new Pen(brush, data.strokeWidth ?? 1);
    if (data.strokeDash  !== undefined) pen.DashStyle  = new DashStyle(data.strokeDash);
    if (data.strokeCap   !== undefined) pen.LineCap    = data.strokeCap;
    if (data.strokeJoin  !== undefined) pen.LineJoin   = data.strokeJoin;
    if (data.strokeMiter !== undefined) pen.MiterLimit = data.strokeMiter;
    return pen;
}
