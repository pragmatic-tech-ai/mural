import {
    ArcSegment,
    CubicBezierSegment,
    LineSegment,
    PathGeometry,
    Point,
    QuadraticBezierSegment,
    type Geometry,
    type PathSegment,
} from '../../visual-engine/index.js';

// Half-pixel flatten target. Subdivision recursion stops when each
// control point is within this distance of the segment's chord —
// gives ~0.5 px max chord-deviation error on typical catalog shapes.
// V1 ships this as a single fixed value (no caller override): § 3.1
// of [docs/connectors.md](../../../docs/connectors.md) keys
// the flatten cache by (Geometry identity, flattenTolerance), so
// exposing a per-call tolerance would require a two-tier cache; the
// uniform value is cheaper and matches every board-catalog
// downstream use today.
const OUTLINE_FLATTEN_TOLERANCE = 0.5;

// A polyline approximation of a Geometry's outline, with cumulative
// arc length stored at each vertex so walks at a normalized t map to
// a position in O(log N). Centroid is the bbox center — robust for
// the typical convex / mildly-concave catalog shapes; non-convex
// shapes (heart, star) inherit the bbox-center approximation, which
// is what § 3.8's outward-normal-from-centroid heuristic is built on.
export interface FlattenedOutline
{
    readonly points:      readonly Point[];
    readonly cumLength:   readonly number[];
    readonly totalLength: number;
    readonly centroid:    Point;
}

// Cache: keyed by Geometry reference identity. WeakMap auto-evicts
// when the Geometry is garbage-collected, so a long-running session
// doesn't pin retired Geometry instances. See § 7.1 — the WeakMap
// approach sidesteps both the "WeakRef sweep" and the
// "explicit invalidate" alternatives the doc lays out.
const _flattenCache = new WeakMap<Geometry, FlattenedOutline>();

// Test instrumentation — see [tests/port-outline.test.ts] for the
// cache-hit verification. The counter increments on every full
// flatten (cache MISS). Production code never reads this; if it
// proves load-bearing, gate behind a flag.
const _stats = { flattenCount: 0 };
export const _outlineFlattenStatsForTesting = {
    get flattenCount(): number { return _stats.flattenCount; },
    reset(): void { _stats.flattenCount = 0; },
};

export function getFlattenedOutline(g: Geometry): FlattenedOutline
{
    const cached = _flattenCache.get(g);
    if (cached !== undefined) return cached;
    const fresh = flattenGeometry(g);
    _flattenCache.set(g, fresh);
    return fresh;
}

function flattenGeometry(g: Geometry): FlattenedOutline
{
    _stats.flattenCount++;
    if (g instanceof PathGeometry) return flattenPathGeometry(g);
    throw new Error(
        `PortResolver: outline-mode flattening supports PathGeometry only in v1 `
        + `(received '${g.constructor.name}'). Other Geometry subclasses can lower `
        + `to PathGeometry before resolution.`,
    );
}

function flattenPathGeometry(pg: PathGeometry): FlattenedOutline
{
    const empty = { points: [], cumLength: [], totalLength: 0, centroid: new Point(0, 0) };
    if (pg.Figures.length === 0) return empty;

    // V1 walks the FIRST figure only. Multi-figure geometries (shapes
    // with holes) use the outer ring's outline for port resolution;
    // hole-edge ports aren't a v1 use case. Documented in § 3.1 / § 7.1.
    const fig = pg.Figures[0]!;
    const points: Point[] = [fig.StartPoint];
    let pen = fig.StartPoint;
    for (const seg of fig.Segments)
    {
        pen = appendSegmentPoints(pen, seg, points);
    }
    if (fig.IsClosed) points.push(fig.StartPoint);

    return buildArcLengthTable(points);
}

function buildArcLengthTable(points: readonly Point[]): FlattenedOutline
{
    const cum: number[] = [0];
    let total = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    if (points.length > 0)
    {
        const p0 = points[0]!;
        minX = maxX = p0.X;
        minY = maxY = p0.Y;
    }
    for (let i = 1; i < points.length; i++)
    {
        const a = points[i - 1]!;
        const b = points[i]!;
        total += Math.hypot(b.X - a.X, b.Y - a.Y);
        cum.push(total);
        if (b.X < minX) minX = b.X; else if (b.X > maxX) maxX = b.X;
        if (b.Y < minY) minY = b.Y; else if (b.Y > maxY) maxY = b.Y;
    }
    // bbox center as a stable shape centroid — avoids the "centroid
    // counts the closing-point twice" bias of a plain vertex average
    // and stays sane on non-uniformly-sampled outlines.
    const centroid = points.length === 0
        ? new Point(0, 0)
        : new Point((minX + maxX) / 2, (minY + maxY) / 2);
    return { points, cumLength: cum, totalLength: total, centroid };
}

function appendSegmentPoints(pen: Point, seg: PathSegment, out: Point[]): Point
{
    if (seg instanceof LineSegment)
    {
        out.push(seg.Point);
        return seg.Point;
    }
    if (seg instanceof CubicBezierSegment)
    {
        flattenCubic(pen, seg.Point1, seg.Point2, seg.Point3, out);
        return seg.Point3;
    }
    if (seg instanceof QuadraticBezierSegment)
    {
        // Lift quadratic → cubic via the standard formula:
        //   C1 = P0 + 2/3 (Q1 - P0)
        //   C2 = P2 + 2/3 (Q1 - P2)
        // then flatten as a cubic.
        const c1 = new Point(
            pen.X + (2 / 3) * (seg.Point1.X - pen.X),
            pen.Y + (2 / 3) * (seg.Point1.Y - pen.Y));
        const c2 = new Point(
            seg.Point2.X + (2 / 3) * (seg.Point1.X - seg.Point2.X),
            seg.Point2.Y + (2 / 3) * (seg.Point1.Y - seg.Point2.Y));
        flattenCubic(pen, c1, c2, seg.Point2, out);
        return seg.Point2;
    }
    if (seg instanceof ArcSegment)
    {
        // ArcSegment flattening lands when a real catalog shape needs
        // it; today's catalog emits only Line + Cubic + Quad, so arc
        // support is a documented gap rather than a blocker.
        throw new Error(
            'PortResolver: ArcSegment outline flattening not implemented yet — '
            + 'no catalog shape exercises this path in v1.',
        );
    }
    return pen;
}

// Recursive De Casteljau subdivision until each subsegment is within
// OUTLINE_FLATTEN_TOLERANCE of its chord. Pushes ONLY the endpoint —
// the start of each segment is already the previous segment's end
// in `out`, so duplicating it would create zero-length entries that
// pollute the cumulative arc-length table.
function flattenCubic(p0: Point, p1: Point, p2: Point, p3: Point, out: Point[]): void
{
    if (isCubicFlatEnough(p0, p1, p2, p3))
    {
        out.push(p3);
        return;
    }
    const m01   = mid(p0,   p1);
    const m12   = mid(p1,   p2);
    const m23   = mid(p2,   p3);
    const m012  = mid(m01,  m12);
    const m123  = mid(m12,  m23);
    const m0123 = mid(m012, m123);
    flattenCubic(p0,    m01,  m012, m0123, out);
    flattenCubic(m0123, m123, m23,  p3,    out);
}

function isCubicFlatEnough(p0: Point, p1: Point, p2: Point, p3: Point): boolean
{
    return perpDistance(p1, p0, p3) <= OUTLINE_FLATTEN_TOLERANCE
        && perpDistance(p2, p0, p3) <= OUTLINE_FLATTEN_TOLERANCE;
}

function perpDistance(p: Point, a: Point, b: Point): number
{
    const dx = b.X - a.X;
    const dy = b.Y - a.Y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return Math.hypot(p.X - a.X, p.Y - a.Y);
    return Math.abs(dy * p.X - dx * p.Y + b.X * a.Y - b.Y * a.X) / len;
}

function mid(a: Point, b: Point): Point
{
    return new Point((a.X + b.X) / 2, (a.Y + b.Y) / 2);
}

// Walk the flattened outline by normalized arc length t ∈ [0, 1].
// Out-of-range t clamps to the endpoints — defensive but the caller
// (PortResolver) already validates via Port.OutlineT semantics.
export function walkOutline(flat: FlattenedOutline, t: number): { point: Point; tangentAngle: number }
{
    if (flat.points.length === 0)
    {
        return { point: new Point(0, 0), tangentAngle: 0 };
    }
    if (flat.points.length === 1)
    {
        return { point: flat.points[0]!, tangentAngle: 0 };
    }
    const clamped = Math.max(0, Math.min(1, t));
    const target  = clamped * flat.totalLength;

    // Binary search for the segment containing `target`. Invariant:
    // cumLength[lo] <= target <= cumLength[hi].
    let lo = 0;
    let hi = flat.cumLength.length - 1;
    while (lo + 1 < hi)
    {
        const m = (lo + hi) >> 1;
        if (flat.cumLength[m]! <= target) lo = m;
        else                              hi = m;
    }
    const segLen   = flat.cumLength[hi]! - flat.cumLength[lo]!;
    const fraction = segLen === 0 ? 0 : (target - flat.cumLength[lo]!) / segLen;
    const a = flat.points[lo]!;
    const b = flat.points[hi]!;
    const x = a.X + (b.X - a.X) * fraction;
    const y = a.Y + (b.Y - a.Y) * fraction;
    const tangentAngle = Math.atan2(b.Y - a.Y, b.X - a.X);
    return { point: new Point(x, y), tangentAngle };
}
