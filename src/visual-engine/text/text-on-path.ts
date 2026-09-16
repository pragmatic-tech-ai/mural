// §19-deferred #4 — text-on-path layout.
//
// Lay text along the curve of a PathGeometry. For each glyph:
//   1. Compute the glyph's horizontal anchor (cumulative advance plus
//      kerning from preceding glyphs);
//   2. Translate that anchor + glyph midpoint into an arclength
//      position on the path;
//   3. Sample (x, y, tangent angle) at that arclength;
//   4. Apply rotate-then-translate so the glyph's baseline tangents
//      the path at the anchor position.
//
// The path is flattened to a polyline first (adaptive cubic /
// quadratic subdivision matching `widen.ts`); arclength lookups go
// through a cumulative-distance table with linear interpolation
// inside each segment. This is the same flatten-first strategy SVG's
// own `<textPath>` uses internally, with the same tradeoff: text
// glyphs slightly over-bunch on tight curves because each glyph is
// placed as a rigid rotated copy rather than each glyph stem being
// independently tangent-aligned.
//
// Glyphs that would land past the end of the path are dropped. A
// `startOffset` lets the caller bias the run forward — useful for
// centering ("startOffset = (totalLen - textWidth) / 2") or trailing
// the path's end.

import type * as opentype from 'opentype.js/dist/opentype.mjs';

import { Point } from '../primitives.js';
import {
    ArcSegment,
    CubicBezierSegment,
    LineSegment,
    PathFigure,
    PathGeometry,
    QuadraticBezierSegment,
    SweepDirection,
} from '../geometry/geometry.js';
import { arcToCubics } from '../geometry/pathops/arc-to-cubic.js';
import { glyphToFigures } from './glyph-to-geometry.js';
import type { FontMetricsMeasurer } from './font-metrics-measurer.js';

export interface TextOnPathOptions
{
    text:        string;
    path:        PathGeometry;
    measurer:    FontMetricsMeasurer;
    fontFamily:  string;
    fontSize:    number;
    fontWeight?: string;
    fontStyle?:  string;
    startOffset?: number;
    // Perpendicular shift of the glyph baseline away from the path, in
    // the same units the path uses. Positive lifts the baseline toward
    // the natural "up" side of the run (with the glyph body already
    // extending in that direction in screen coords, positive values push
    // the whole glyph further off the curve). Negative drops it the
    // other way — text rides under the curve, still right-side-up.
    sideOffset?: number;
    flattenTolerance?: number;
}

const DEFAULT_TOLERANCE = 0.25;

export function textOnPath(opts: TextOnPathOptions): PathGeometry
{
    const font = opts.measurer.ResolveFont(
        opts.fontFamily,
        opts.fontWeight ?? 'normal',
        opts.fontStyle  ?? 'normal',
    );
    if (font === undefined) return new PathGeometry([]);

    const tol = opts.flattenTolerance ?? DEFAULT_TOLERANCE;
    const samples = flattenPathToSamples(opts.path, tol);
    if (samples.length < 2) return new PathGeometry([]);

    const totalLen = samples[samples.length - 1]!.s;
    const scale = opts.fontSize / font.unitsPerEm;
    const sideOffset = opts.sideOffset ?? 0;

    const figures: PathFigure[] = [];
    let cursor = opts.startOffset ?? 0;
    let prev: opentype.Glyph | undefined;
    for (const ch of Array.from(opts.text))
    {
        const glyph = font.charToGlyph(ch);
        if (prev !== undefined)
        {
            cursor += font.getKerningValue(prev, glyph) * scale;
        }
        const advance = (glyph.advanceWidth ?? 0) * scale;
        const anchor  = cursor + advance / 2;
        if (anchor < 0 || anchor > totalLen)
        {
            cursor += advance;
            prev = glyph;
            continue;
        }
        const samp = sampleAt(samples, anchor);
        // The glyph's natural baseline is along +X; rotate so the +X
        // direction aligns with the local tangent, then translate the
        // glyph's center (advance/2, 0) to land at samp.point. With a
        // non-zero sideOffset, push the translation perpendicular to
        // the tangent. In y-down screen coords the natural glyph body
        // sits in the (sin, -cos) direction relative to the tangent
        // (cos, sin); positive sideOffset extends in that same direction.
        const cos = Math.cos(samp.angle);
        const sin = Math.sin(samp.angle);
        const tx = samp.point.X + sideOffset * sin;
        const ty = samp.point.Y - sideOffset * cos;
        const lowering = glyphToFigures(glyph, scale, 0, 0);
        for (const f of lowering.figures)
        {
            figures.push(rotateAndTranslateFigure(f, cos, sin, -advance / 2, 0, new Point(tx, ty)));
        }
        cursor += advance;
        prev = glyph;
    }
    return new PathGeometry(figures);
}

// Linearly interpolate (x, y, angle) at arclength `s` along the
// pre-built sample table.
function sampleAt(samples: ArclengthSample[], s: number): { point: Point; angle: number }
{
    // Binary search for the segment containing `s`.
    let lo = 0, hi = samples.length - 1;
    while (lo + 1 < hi)
    {
        const mid = (lo + hi) >>> 1;
        if (samples[mid]!.s <= s) lo = mid;
        else hi = mid;
    }
    const a = samples[lo]!;
    const b = samples[hi]!;
    const span = b.s - a.s;
    const t = span === 0 ? 0 : (s - a.s) / span;
    return {
        point: new Point(a.x + t * (b.x - a.x), a.y + t * (b.y - a.y)),
        angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
}

// Apply rotate + translate to every point in a PathFigure. The
// figure is treated as a local-space construction: each point P maps
// to (R * (P + offset)) + translation, where R is the 2x2 rotation
// matrix [[cos, -sin], [sin, cos]].
function rotateAndTranslateFigure(
    f: PathFigure,
    cos: number, sin: number,
    offsetX: number, offsetY: number,
    translation: Point,
): PathFigure
{
    const transform = (p: Point): Point => {
        const x = p.X + offsetX;
        const y = p.Y + offsetY;
        return new Point(cos * x - sin * y + translation.X,
                          sin * x + cos * y + translation.Y);
    };
    const newStart = transform(f.StartPoint);
    const newSegs = f.Segments.map(seg => {
        if (seg instanceof LineSegment)        return new LineSegment(transform(seg.Point));
        if (seg instanceof QuadraticBezierSegment) return new QuadraticBezierSegment(transform(seg.Point1), transform(seg.Point2));
        if (seg instanceof CubicBezierSegment)     return new CubicBezierSegment(transform(seg.Point1), transform(seg.Point2), transform(seg.Point3));
        if (seg instanceof ArcSegment)
            return new ArcSegment(transform(seg.Point), seg.Size, seg.RotationAngle + 180 * Math.atan2(sin, cos) / Math.PI, seg.IsLargeArc, seg.SweepDirection);
        return seg;
    });
    return new PathFigure(newStart, newSegs, f.IsClosed);
}

interface ArclengthSample { x: number; y: number; s: number; }

function flattenPathToSamples(path: PathGeometry, tol: number): ArclengthSample[]
{
    const samples: ArclengthSample[] = [];
    let s = 0;
    let lastX: number | undefined = undefined;
    let lastY: number | undefined = undefined;
    const push = (x: number, y: number): void => {
        if (lastX !== undefined)
        {
            s += Math.hypot(x - lastX, y - lastY!);
        }
        samples.push({ x, y, s });
        lastX = x;
        lastY = y;
    };
    for (const figure of path.Figures)
    {
        push(figure.StartPoint.X, figure.StartPoint.Y);
        let pen = figure.StartPoint;
        for (const seg of figure.Segments)
        {
            if (seg instanceof LineSegment)
            {
                push(seg.Point.X, seg.Point.Y);
                pen = seg.Point;
            }
            else if (seg instanceof QuadraticBezierSegment)
            {
                flattenQuad(pen, seg.Point1, seg.Point2, tol, push);
                pen = seg.Point2;
            }
            else if (seg instanceof CubicBezierSegment)
            {
                flattenCubic(pen, seg.Point1, seg.Point2, seg.Point3, tol, push);
                pen = seg.Point3;
            }
            else if (seg instanceof ArcSegment)
            {
                const cubics = arcToCubics(
                    pen.X, pen.Y, seg.Point.X, seg.Point.Y,
                    seg.Size.Width, seg.Size.Height,
                    seg.RotationAngle, seg.IsLargeArc,
                    seg.SweepDirection === SweepDirection.Clockwise);
                if (cubics.length === 0)
                {
                    push(seg.Point.X, seg.Point.Y);
                }
                else
                {
                    for (const c of cubics)
                    {
                        flattenCubic(
                            new Point(c.fPts[0]!.fX, c.fPts[0]!.fY),
                            new Point(c.fPts[1]!.fX, c.fPts[1]!.fY),
                            new Point(c.fPts[2]!.fX, c.fPts[2]!.fY),
                            new Point(c.fPts[3]!.fX, c.fPts[3]!.fY),
                            tol, push);
                    }
                }
                pen = seg.Point;
            }
        }
        if (figure.IsClosed) push(figure.StartPoint.X, figure.StartPoint.Y);
    }
    return samples;
}

function flattenCubic(a: Point, b: Point, c: Point, d: Point, tol: number, push: (x: number, y: number) => void): void
{
    if (cubicFlatEnough(a, b, c, d, tol))
    {
        push(d.X, d.Y);
        return;
    }
    const ab = mid(a, b), bc = mid(b, c), cd = mid(c, d);
    const abc = mid(ab, bc), bcd = mid(bc, cd);
    const abcd = mid(abc, bcd);
    flattenCubic(a, ab, abc, abcd, tol, push);
    flattenCubic(abcd, bcd, cd, d, tol, push);
}

function flattenQuad(a: Point, b: Point, c: Point, tol: number, push: (x: number, y: number) => void): void
{
    if (quadFlatEnough(a, b, c, tol))
    {
        push(c.X, c.Y);
        return;
    }
    const ab = mid(a, b), bc = mid(b, c);
    const abc = mid(ab, bc);
    flattenQuad(a, ab, abc, tol, push);
    flattenQuad(abc, bc, c, tol, push);
}

const mid = (a: Point, b: Point): Point => new Point((a.X + b.X) / 2, (a.Y + b.Y) / 2);

function cubicFlatEnough(a: Point, b: Point, c: Point, d: Point, tol: number): boolean
{
    return Math.max(
        distancePointToSegment(b, a, d),
        distancePointToSegment(c, a, d),
    ) <= tol;
}

function quadFlatEnough(a: Point, b: Point, c: Point, tol: number): boolean
{
    return distancePointToSegment(b, a, c) <= tol;
}

function distancePointToSegment(p: Point, a: Point, b: Point): number
{
    const dx = b.X - a.X, dy = b.Y - a.Y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(p.X - a.X, p.Y - a.Y);
    const num = Math.abs((p.X - a.X) * dy - (p.Y - a.Y) * dx);
    return num / Math.sqrt(len2);
}
