// §19-deferred #1 — outline widening (stroke → fill).
//
// Given a Geometry + a Pen, produces a `PathGeometry` whose filled area
// reproduces what the renderer would paint when stroking the input
// geometry with that Pen. Useful for board tooling that needs to:
//
//   * hit-test against thick lines without false misses through the
//     space between adjacent strokes;
//   * boolean-combine a stroke outline with a fill (mural's existing
//     `combine()` operates on filled regions, so a stroke first has to
//     be widened);
//   * export "outlined text" / "outlined stroke" SVG that won't depend
//     on the renderer's stroke implementation.
//
// Implementation: flatten the input to polylines, walk each polyline
// emitting parallel offsets at ±width/2 with join + cap handling. The
// output is a closed polygon (open contours) or a pair of closed rings
// (closed contours). This is the Tiller-Hanson "flatten then offset"
// approach; v1 emits LineSegments only — Bezier round-tripping is
// available downstream via `pathGeometryFromSvgD` / boolean ops that
// run on whichever segment type comes through. WPF parity surface:
// `Pen.Thickness` / `LineCap` / `LineJoin` / `MiterLimit`. Dashes are
// out of scope for v1 — the user has to dash-flatten before calling.
//
// References (in `third_party/skia/`):
//   * SkStroke.cpp                — Skia's reference implementation.
//   * SkStrokerPriv.cpp           — the cap / join lookup tables.
//   * SkPathStroker.cpp           — adaptive-tolerance offset walker.
// The port here is a simpler "polyline-first" cousin of Skia's exact
// cubic-offset method; the visual fidelity tradeoff lands as a §19-
// deferred follow-up if profiling or a demo needs the upgrade.

import { arcToCubics } from './pathops/arc-to-cubic.js';
import { Point, Size } from '../primitives.js';
import {
    ArcSegment,
    CubicBezierSegment,
    EllipseGeometry,
    type Geometry,
    GeometryGroup,
    LineGeometry,
    LineSegment,
    PathFigure,
    PathGeometry,
    QuadraticBezierSegment,
    RectangleGeometry,
    SweepDirection,
} from './geometry.js';
import { LineCap, LineJoin, type Pen } from '../drawing/pen.js';

// ── public surface ──────────────────────────────────────────────────

const DEFAULT_TOLERANCE = 0.25;   // device-pixel-ish
const ROUND_JOIN_STEPS  = 16;     // segments per full 2π for round joins / caps

export function widen(g: Geometry, pen: Pen, tolerance: number = DEFAULT_TOLERANCE): PathGeometry
{
    const w = pen.Thickness;
    if (w <= 0) return new PathGeometry([]);
    const half = w / 2;

    const figures: PathFigure[] = [];
    for (const poly of flattenGeometry(g, tolerance))
    {
        if (poly.points.length < 2) continue;
        widenPolyline(poly, half, pen.LineCap, pen.LineJoin, pen.MiterLimit, figures);
    }
    return new PathGeometry(figures);
}

// ── flatten geometry → polylines ────────────────────────────────────

interface Polyline { points: Point[]; closed: boolean; }

function flattenGeometry(g: Geometry, tol: number): Polyline[]
{
    if (g instanceof LineGeometry)
    {
        return [{ points: [g.StartPoint, g.EndPoint], closed: false }];
    }
    if (g instanceof RectangleGeometry)
    {
        const r  = g.Rect;
        const rx = Math.max(0, Math.min(g.RadiusX, r.Width  / 2));
        const ry = Math.max(0, Math.min(g.RadiusY, r.Height / 2));
        if (r.Width <= 0 || r.Height <= 0) return [];
        if (rx === 0 || ry === 0)
        {
            return [{ points: [
                new Point(r.Left,  r.Top),
                new Point(r.Right, r.Top),
                new Point(r.Right, r.Bottom),
                new Point(r.Left,  r.Bottom),
            ], closed: true }];
        }
        // Rounded rect — lower to a single PathFigure first, then flatten.
        return flattenGeometry(roundedRectAsPathGeometry(g, rx, ry), tol);
    }
    if (g instanceof EllipseGeometry)
    {
        if (g.RadiusX <= 0 || g.RadiusY <= 0) return [];
        return flattenGeometry(ellipseAsPathGeometry(g), tol);
    }
    if (g instanceof PathGeometry)
    {
        return flattenPathGeometry(g, tol);
    }
    if (g instanceof GeometryGroup)
    {
        const out: Polyline[] = [];
        for (const child of g.Children) out.push(...flattenGeometry(child, tol));
        return out;
    }
    return [];
}

function flattenPathGeometry(g: PathGeometry, tol: number): Polyline[]
{
    const out: Polyline[] = [];
    for (const figure of g.Figures)
    {
        const pts: Point[] = [figure.StartPoint];
        let pen = figure.StartPoint;
        for (const seg of figure.Segments)
        {
            if (seg instanceof LineSegment)
            {
                pts.push(seg.Point);
                pen = seg.Point;
            }
            else if (seg instanceof QuadraticBezierSegment)
            {
                flattenQuadInto(pen, seg.Point1, seg.Point2, tol, pts);
                pen = seg.Point2;
            }
            else if (seg instanceof CubicBezierSegment)
            {
                flattenCubicInto(pen, seg.Point1, seg.Point2, seg.Point3, tol, pts);
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
                    pts.push(seg.Point);
                }
                else
                {
                    for (const c of cubics)
                    {
                        flattenCubicInto(
                            new Point(c.fPts[0]!.fX, c.fPts[0]!.fY),
                            new Point(c.fPts[1]!.fX, c.fPts[1]!.fY),
                            new Point(c.fPts[2]!.fX, c.fPts[2]!.fY),
                            new Point(c.fPts[3]!.fX, c.fPts[3]!.fY),
                            tol, pts);
                    }
                }
                pen = seg.Point;
            }
        }
        if (pts.length >= 2) out.push({ points: pts, closed: figure.IsClosed });
    }
    return out;
}

// Adaptive midpoint subdivision until the control polygon's max
// distance from its endpoint chord falls under `tol`.
function flattenCubicInto(a: Point, b: Point, c: Point, d: Point, tol: number, out: Point[]): void
{
    if (cubicFlatEnough(a, b, c, d, tol))
    {
        out.push(d);
        return;
    }
    const ab  = mid(a, b);
    const bc  = mid(b, c);
    const cd  = mid(c, d);
    const abc = mid(ab, bc);
    const bcd = mid(bc, cd);
    const abcd = mid(abc, bcd);
    flattenCubicInto(a, ab, abc, abcd, tol, out);
    flattenCubicInto(abcd, bcd, cd, d, tol, out);
}

function flattenQuadInto(a: Point, b: Point, c: Point, tol: number, out: Point[]): void
{
    if (quadFlatEnough(a, b, c, tol))
    {
        out.push(c);
        return;
    }
    const ab = mid(a, b);
    const bc = mid(b, c);
    const abc = mid(ab, bc);
    flattenQuadInto(a, ab, abc, tol, out);
    flattenQuadInto(abc, bc, c, tol, out);
}

function mid(a: Point, b: Point): Point { return new Point((a.X + b.X) / 2, (a.Y + b.Y) / 2); }

function cubicFlatEnough(a: Point, b: Point, c: Point, d: Point, tol: number): boolean
{
    const dB = distancePointToSegment(b, a, d);
    const dC = distancePointToSegment(c, a, d);
    return Math.max(dB, dC) <= tol;
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
    // Perpendicular distance via cross-product magnitude / segment length.
    const num = Math.abs((p.X - a.X) * dy - (p.Y - a.Y) * dx);
    return num / Math.sqrt(len2);
}

// ── lower RectangleGeometry / EllipseGeometry to PathGeometry ───────

function roundedRectAsPathGeometry(g: RectangleGeometry, rx: number, ry: number): PathGeometry
{
    const r = g.Rect;
    const L = r.Left, T = r.Top, R = r.Right, B = r.Bottom;
    const sz = new Size(rx, ry);
    return new PathGeometry([new PathFigure(
        new Point(L + rx, T),
        [
            new LineSegment(new Point(R - rx, T)),
            new ArcSegment(new Point(R, T + ry), sz, 0, false, SweepDirection.Clockwise),
            new LineSegment(new Point(R, B - ry)),
            new ArcSegment(new Point(R - rx, B), sz, 0, false, SweepDirection.Clockwise),
            new LineSegment(new Point(L + rx, B)),
            new ArcSegment(new Point(L, B - ry), sz, 0, false, SweepDirection.Clockwise),
            new LineSegment(new Point(L, T + ry)),
            new ArcSegment(new Point(L + rx, T), sz, 0, false, SweepDirection.Clockwise),
        ],
        true,
    )]);
}

function ellipseAsPathGeometry(g: EllipseGeometry): PathGeometry
{
    // Compose with arcToCubics so the flattener sees cubic curves.
    const cx = g.Center.X, cy = g.Center.Y, rx = g.RadiusX, ry = g.RadiusY;
    const start = new Point(cx + rx, cy);
    const cubics = [
        ...arcToCubics(cx + rx, cy, cx - rx, cy, rx, ry, 0, true, true),
        ...arcToCubics(cx - rx, cy, cx + rx, cy, rx, ry, 0, true, true),
    ];
    const segs = cubics.map(c => new CubicBezierSegment(
        new Point(c.fPts[1]!.fX, c.fPts[1]!.fY),
        new Point(c.fPts[2]!.fX, c.fPts[2]!.fY),
        new Point(c.fPts[3]!.fX, c.fPts[3]!.fY),
    ));
    return new PathGeometry([new PathFigure(start, segs, true)]);
}

// ── offset polyline (the meat of widening) ──────────────────────────

interface Vec { x: number; y: number; }
const vec = (a: Point, b: Point): Vec => ({ x: b.X - a.X, y: b.Y - a.Y });
const length = (v: Vec): number => Math.hypot(v.x, v.y);
const normalize = (v: Vec): Vec => { const l = length(v); return l === 0 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l }; };
const perpLeft = (v: Vec): Vec => ({ x: -v.y, y: v.x });   // 90° CCW; "left" side of A→B in y-down coords is rotated CCW.

// Append a join transition (from `prevEnd` around vertex `v` to
// `nextStart`) onto `out`, picking miter / round / bevel per join
// style. `outwardSign` is +1 if we're walking the outside of the
// vertex's bend, -1 if walking the inside (mitering an inside corner
// can produce a long spike — Skia uses an inside-bevel fallback;
// mural follows the same rule).
function appendJoin(out: Point[],
                    prevEnd: Point, nextStart: Point, vertex: Point,
                    prevDir: Vec, nextDir: Vec, half: number,
                    join: LineJoin, miterLimit: number,
                    outwardSign: 1 | -1): void
{
    // Concave (inside) corner — clip both offsets to their intersection
    // so the inside polygon meets at a single point. A straight bevel
    // here would emit a diagonal that "carves" a notch into the inside
    // of the corner (visible as a 45° chamfer on a rectangle's inner
    // ring).
    if (outwardSign < 0)
    {
        const m = lineIntersection(prevEnd, prevDir, nextStart, nextDir);
        if (m === undefined)
        {
            out.push(nextStart);
            return;
        }
        // Replace prevEnd in `out` with the intersection — the previous
        // offset overshot to its raw endpoint, we want it clipped at the
        // intersection.
        if (out.length > 0 && out[out.length - 1]!.X === prevEnd.X
                          && out[out.length - 1]!.Y === prevEnd.Y)
        {
            out[out.length - 1] = m;
        }
        else
        {
            out.push(m);
        }
        return;
    }
    if (join === LineJoin.Bevel)
    {
        out.push(nextStart);
        return;
    }
    if (join === LineJoin.Miter)
    {
        // Miter point = intersect (prevEnd + t·prevDir) ∩ (nextStart - s·nextDir).
        const m = lineIntersection(prevEnd, prevDir, nextStart, nextDir);
        if (m === undefined)
        {
            out.push(nextStart);
            return;
        }
        const miterLen = Math.hypot(m.X - vertex.X, m.Y - vertex.Y);
        if (miterLen / half > miterLimit)
        {
            // Fall back to bevel.
            out.push(nextStart);
            return;
        }
        out.push(m);
        out.push(nextStart);
        return;
    }
    // LineJoin.Round — emit an arc-polyline from prevEnd to nextStart
    // centered at vertex with radius `half`.
    appendArcPolyline(out, vertex, prevEnd, nextStart, half);
}

// Compute the intersection of two infinite lines, each defined by a
// point + a direction vector. Returns undefined if parallel.
function lineIntersection(p1: Point, d1: Vec, p2: Point, d2: Vec): Point | undefined
{
    const denom = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(denom) < 1e-12) return undefined;
    const dx = p2.X - p1.X;
    const dy = p2.Y - p1.Y;
    const t = (dx * d2.y - dy * d2.x) / denom;
    return new Point(p1.X + t * d1.x, p1.Y + t * d1.y);
}

// Append a polyline approximation of an arc from `start` to `end`
// centered at `c` with radius `r`. Walks the shorter (≤π) arc in
// whichever direction puts start before end going CCW.
function appendArcPolyline(out: Point[], c: Point, start: Point, end: Point, r: number): void
{
    const a0 = Math.atan2(start.Y - c.Y, start.X - c.X);
    let a1 = Math.atan2(end.Y - c.Y, end.X - c.X);
    // Normalize sweep to (-π, π] in either direction; pick the shorter way.
    let delta = a1 - a0;
    while (delta >  Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    const steps = Math.max(2, Math.ceil(Math.abs(delta) / (2 * Math.PI) * ROUND_JOIN_STEPS));
    for (let i = 1; i <= steps; ++i)
    {
        const a = a0 + delta * (i / steps);
        out.push(new Point(c.X + r * Math.cos(a), c.Y + r * Math.sin(a)));
    }
}

// Append a cap polyline. `tipDir` is the unit vector from the contour's
// endpoint pointing *outward* (continuation of the contour beyond the
// endpoint). `endpoint` is the contour endpoint itself.
function appendCap(out: Point[], endpoint: Point, tipDir: Vec, half: number, cap: LineCap): void
{
    if (cap === LineCap.Flat) return;
    const left  = perpLeft(tipDir);
    if (cap === LineCap.Square)
    {
        // Extend by half along tipDir on each side.
        const e1 = new Point(endpoint.X + tipDir.x * half + left.x * half,
                              endpoint.Y + tipDir.y * half + left.y * half);
        const e2 = new Point(endpoint.X + tipDir.x * half - left.x * half,
                              endpoint.Y + tipDir.y * half - left.y * half);
        out.push(e1);
        out.push(e2);
        return;
    }
    if (cap === LineCap.Round)
    {
        // Half-circle from `endpoint + left*half` around `endpoint` to
        // `endpoint - left*half`, bulging outward in `tipDir`.
        const start = new Point(endpoint.X + left.x * half, endpoint.Y + left.y * half);
        const end   = new Point(endpoint.X - left.x * half, endpoint.Y - left.y * half);
        // For a round cap we need a half-arc on the outward side. The
        // `appendArcPolyline` picks shortest; explicitly walk π in the
        // outward (tipDir-side) direction.
        const a0 = Math.atan2(start.Y - endpoint.Y, start.X - endpoint.X);
        // Sweep direction: pick the one whose midpoint lies on +tipDir side.
        let dir = 1;
        const probe = new Point(
            endpoint.X + half * Math.cos(a0 + dir * Math.PI / 2),
            endpoint.Y + half * Math.sin(a0 + dir * Math.PI / 2));
        const dot = (probe.X - endpoint.X) * tipDir.x + (probe.Y - endpoint.Y) * tipDir.y;
        if (dot < 0) dir = -1;
        const steps = ROUND_JOIN_STEPS / 2;
        for (let i = 1; i <= steps; ++i)
        {
            const a = a0 + dir * Math.PI * (i / steps);
            out.push(new Point(endpoint.X + half * Math.cos(a),
                                endpoint.Y + half * Math.sin(a)));
        }
        out.push(end);
    }
}

// Walk a single polyline; emit one or two figures into `outFigures`.
function widenPolyline(poly: Polyline, half: number,
                       cap: LineCap, join: LineJoin, miterLimit: number,
                       outFigures: PathFigure[]): void
{
    const pts = poly.points;
    const n = pts.length;
    if (n < 2) return;

    // Walk and emit left + right offset polylines using normals.
    // Convention: "left" offset = points shifted by +perpLeft(segDir) * half.
    //            "right" offset = points shifted by -perpLeft(segDir) * half.
    // Left side traces forward; right side traces backward to close.

    if (!poly.closed)
    {
        widenOpenPolyline(pts, half, cap, join, miterLimit, outFigures);
        return;
    }
    widenClosedPolyline(pts, half, join, miterLimit, outFigures);
}

function widenOpenPolyline(pts: Point[], half: number,
                            cap: LineCap, join: LineJoin, miterLimit: number,
                            outFigures: PathFigure[]): void
{
    // Build left offset (start → end) then right offset reversed.
    const left:  Point[] = [];
    const right: Point[] = [];

    const dir0 = normalize(vec(pts[0]!, pts[1]!));
    const n0   = perpLeft(dir0);
    left.push(new Point(pts[0]!.X + n0.x * half, pts[0]!.Y + n0.y * half));
    right.push(new Point(pts[0]!.X - n0.x * half, pts[0]!.Y - n0.y * half));

    for (let i = 1; i < pts.length - 1; ++i)
    {
        const prev = normalize(vec(pts[i - 1]!, pts[i]!));
        const next = normalize(vec(pts[i]!,     pts[i + 1]!));
        const np = perpLeft(prev);
        const nn = perpLeft(next);
        // y-down screen coords: positive cross = CCW math turn = CW screen
        // turn, so the convex/outer corner is on the RIGHT of the walk
        // direction. Negative cross flips it onto the LEFT.
        const cross = prev.x * next.y - prev.y * next.x;
        const outwardLeft:  1 | -1 = cross >= 0 ? -1 : 1;
        const outwardRight: 1 | -1 = cross >= 0 ? 1 : -1;

        const prevLeftEnd  = new Point(pts[i]!.X + np.x * half, pts[i]!.Y + np.y * half);
        const nextLeftStart = new Point(pts[i]!.X + nn.x * half, pts[i]!.Y + nn.y * half);
        appendJoin(left, prevLeftEnd, nextLeftStart, pts[i]!,
                    prev, next, half, join, miterLimit, outwardLeft);

        const prevRightEnd  = new Point(pts[i]!.X - np.x * half, pts[i]!.Y - np.y * half);
        const nextRightStart = new Point(pts[i]!.X - nn.x * half, pts[i]!.Y - nn.y * half);
        appendJoin(right, prevRightEnd, nextRightStart, pts[i]!,
                    prev, next, half, join, miterLimit, outwardRight);
    }

    const dirN = normalize(vec(pts[pts.length - 2]!, pts[pts.length - 1]!));
    const nN   = perpLeft(dirN);
    left.push(new Point(pts[pts.length - 1]!.X + nN.x * half,
                         pts[pts.length - 1]!.Y + nN.y * half));
    right.push(new Point(pts[pts.length - 1]!.X - nN.x * half,
                          pts[pts.length - 1]!.Y - nN.y * half));

    // Glue: left → tail-cap → reversed(right) → start-cap → close.
    const polygon: Point[] = [];
    for (const p of left) polygon.push(p);
    appendCap(polygon, pts[pts.length - 1]!, dirN, half, cap);
    for (let i = right.length - 1; i >= 0; --i) polygon.push(right[i]!);
    appendCap(polygon, pts[0]!, { x: -dir0.x, y: -dir0.y }, half, cap);

    outFigures.push(polylineToFigure(polygon, true));
}

function widenClosedPolyline(pts: Point[], half: number,
                              join: LineJoin, miterLimit: number,
                              outFigures: PathFigure[]): void
{
    // Closed polyline — emit outer ring (left offset) and inner ring
    // (right offset, reversed). Two separate PathFigures so a Nonzero
    // FillRule walker reads them as opposite windings (the outline).
    const left:  Point[] = [];
    const right: Point[] = [];
    const n = pts.length;
    for (let i = 0; i < n; ++i)
    {
        const prev = normalize(vec(pts[(i - 1 + n) % n]!, pts[i]!));
        const next = normalize(vec(pts[i]!, pts[(i + 1) % n]!));
        const np = perpLeft(prev);
        const nn = perpLeft(next);
        // y-down screen coords: positive cross = CCW math turn = CW screen
        // turn, so the convex/outer corner is on the RIGHT of the walk
        // direction. Negative cross flips it onto the LEFT.
        const cross = prev.x * next.y - prev.y * next.x;
        const outwardLeft:  1 | -1 = cross >= 0 ? -1 : 1;
        const outwardRight: 1 | -1 = cross >= 0 ? 1 : -1;

        const prevLeftEnd   = new Point(pts[i]!.X + np.x * half, pts[i]!.Y + np.y * half);
        const nextLeftStart = new Point(pts[i]!.X + nn.x * half, pts[i]!.Y + nn.y * half);
        appendJoin(left, prevLeftEnd, nextLeftStart, pts[i]!,
                    prev, next, half, join, miterLimit, outwardLeft);

        const prevRightEnd   = new Point(pts[i]!.X - np.x * half, pts[i]!.Y - np.y * half);
        const nextRightStart = new Point(pts[i]!.X - nn.x * half, pts[i]!.Y - nn.y * half);
        appendJoin(right, prevRightEnd, nextRightStart, pts[i]!,
                    prev, next, half, join, miterLimit, outwardRight);
    }
    outFigures.push(polylineToFigure(left, true));
    // Inner ring reversed so the two rings have opposite winding.
    const innerReversed = right.slice().reverse();
    outFigures.push(polylineToFigure(innerReversed, true));
}

function polylineToFigure(pts: Point[], closed: boolean): PathFigure
{
    if (pts.length === 0) return new PathFigure(new Point(0, 0), [], false);
    const segs: LineSegment[] = [];
    for (let i = 1; i < pts.length; ++i) segs.push(new LineSegment(pts[i]!));
    return new PathFigure(pts[0]!, segs, closed);
}

