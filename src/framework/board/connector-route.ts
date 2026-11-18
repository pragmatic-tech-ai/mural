import { Point } from '../../visual-engine/index.js';
import { Rect } from '../../runtime/index.js';

// ─────────────────────────────────────────────────────────────────────
// Pure polyline geometry for connector labels (§ board-text Slice 5).
// A connector's rendered route is a point polyline (Connector.CurrentRoutePoints);
// a label rides it at a parameter t ∈ [0, 1] measured by ARC LENGTH, so
// t = 0.5 is the true midpoint of the drawn path (not the middle vertex).
// These functions place a label at t and, for the drag, find the t nearest
// a cursor — both independent of the rendering / layout tiers so they unit-test
// on plain point arrays.

export interface RoutePoint
{
    readonly point:   Point;
    readonly tangent: number;   // radians, direction of the route at `point`
}

function distance(a: Point, b: Point): number
{
    return Math.hypot(b.X - a.X, b.Y - a.Y);
}

// Total arc length of the polyline — backs the connector's {Length} field.
export function polylineLength(points: readonly Point[]): number
{
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) total += distance(points[i]!, points[i + 1]!);
    return total;
}

// The point (and route direction) at arc-length fraction `t` along the
// polyline. Clamps t to [0, 1]; degenerate inputs collapse to the first point.
export function pointAlongPolyline(points: readonly Point[], t: number): RoutePoint
{
    if (points.length === 0) return { point: Point.Zero, tangent: 0 };
    if (points.length === 1) return { point: points[0]!, tangent: 0 };

    let total = 0;
    for (let i = 0; i < points.length - 1; i++) total += distance(points[i]!, points[i + 1]!);
    if (total === 0) return { point: points[0]!, tangent: 0 };

    const target = Math.max(0, Math.min(1, t)) * total;
    let acc = 0;
    for (let i = 0; i < points.length - 1; i++)
    {
        const a = points[i]!, b = points[i + 1]!;
        const len = distance(a, b);
        if (len === 0) continue;
        if (acc + len >= target)
        {
            const local = (target - acc) / len;
            return {
                point:   new Point(a.X + (b.X - a.X) * local, a.Y + (b.Y - a.Y) * local),
                tangent: Math.atan2(b.Y - a.Y, b.X - a.X),
            };
        }
        acc += len;
    }
    // Numerical tail — pin to the final vertex.
    const a = points[points.length - 2]!, b = points[points.length - 1]!;
    return { point: b, tangent: Math.atan2(b.Y - a.Y, b.X - a.X) };
}

// The arc-length fraction t ∈ [0, 1] whose polyline point is closest to `p`.
// Backs the label drag: the label slides ALONG the route to the nearest point
// under the cursor instead of following it off the path. Degenerate inputs → 0.
export function nearestTOnPolyline(points: readonly Point[], p: Point): number
{
    if (points.length < 2) return 0;

    let total = 0;
    for (let i = 0; i < points.length - 1; i++) total += distance(points[i]!, points[i + 1]!);
    if (total === 0) return 0;

    let acc = 0;
    let bestArc = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < points.length - 1; i++)
    {
        const a = points[i]!, b = points[i + 1]!;
        const len = distance(a, b);
        if (len === 0) continue;
        // Project p onto segment a→b, clamped to the segment.
        const dx = b.X - a.X, dy = b.Y - a.Y;
        let u = ((p.X - a.X) * dx + (p.Y - a.Y) * dy) / (len * len);
        u = Math.max(0, Math.min(1, u));
        const projX = a.X + dx * u, projY = a.Y + dy * u;
        const d = Math.hypot(p.X - projX, p.Y - projY);
        if (d < bestDist)
        {
            bestDist = d;
            bestArc  = acc + len * u;
        }
        acc += len;
    }
    return bestArc / total;
}

// The point at ABSOLUTE arc length `s` along the polyline (clamped to
// [0, total]). Companion to pointAlongPolyline, which takes a [0,1]
// fraction — the split below works in absolute arc length so it can
// compare label-rect crossings across segments.
function pointAtArc(points: readonly Point[], s: number): Point
{
    if (points.length === 0) return Point.Zero;
    let acc = 0;
    for (let i = 0; i < points.length - 1; i++)
    {
        const a = points[i]!, b = points[i + 1]!;
        const len = distance(a, b);
        if (len === 0) continue;
        if (acc + len >= s)
        {
            const local = Math.max(0, (s - acc) / len);
            return new Point(a.X + (b.X - a.X) * local, a.Y + (b.Y - a.Y) * local);
        }
        acc += len;
    }
    return points[points.length - 1]!;
}

// The vertices of the polyline between arc lengths `s0` and `s1`, with the
// two endpoints interpolated onto the path. Interior vertices strictly
// between the bounds are kept; a near-zero-length leading/trailing stub
// (endpoint landing exactly on a kept vertex) is dropped so the result has
// no duplicate points.
function sliceByArc(points: readonly Point[], s0: number, s1: number): Point[]
{
    if (s1 - s0 <= 1e-6) return [];
    const out: Point[] = [pointAtArc(points, s0)];
    let acc = 0;
    for (let i = 0; i < points.length - 1; i++)
    {
        const a = points[i]!, b = points[i + 1]!;
        const len = distance(a, b);
        acc += len;
        if (acc > s0 + 1e-6 && acc < s1 - 1e-6) out.push(b);
    }
    out.push(pointAtArc(points, s1));
    // Drop consecutive coincident points (e.g. s0 exactly on a vertex).
    const deduped: Point[] = [];
    for (const p of out)
    {
        const prev = deduped[deduped.length - 1];
        if (prev === undefined || distance(prev, p) > 1e-6) deduped.push(p);
    }
    return deduped;
}

// Liang–Barsky clip of segment a→b to the axis-aligned `rect`. Returns the
// [t0, t1] sub-range (0..1 of the segment) that lies inside the rect, or
// undefined when the segment misses it entirely.
function clipSegmentToRect(a: Point, b: Point, rect: Rect): [number, number] | undefined
{
    const dx = b.X - a.X, dy = b.Y - a.Y;
    const left = rect.X, right = rect.X + rect.Width;
    const top = rect.Y, bottom = rect.Y + rect.Height;
    const p = [-dx, dx, -dy, dy];
    const q = [a.X - left, right - a.X, a.Y - top, bottom - a.Y];
    let t0 = 0, t1 = 1;
    for (let i = 0; i < 4; i++)
    {
        if (p[i] === 0)
        {
            if (q[i]! < 0) return undefined;   // parallel to this edge and outside
            continue;
        }
        const r = q[i]! / p[i]!;
        if (p[i]! < 0) { if (r > t1) return undefined; if (r > t0) t0 = r; }
        else           { if (r < t0) return undefined; if (r < t1) t1 = r; }
    }
    return [t0, t1];
}

// Break a route polyline where a label rectangle sits on it, so the drawn
// line stops at the rect's near edge and resumes at its far edge (the
// "line gap" connector-label style). Returns the surviving runs:
//   * two polylines — the leading and trailing runs, when the rect cuts
//     through the middle of the route;
//   * one polyline — the whole route unchanged when the rect misses it, or
//     the single surviving run when the rect covers an end;
//   * none — when the rect swallows the entire route.
// The gap spans from the FIRST point the route enters the rect to the LAST
// point it leaves; a label on a bend therefore clears the corner too.
export function splitPolylineAroundRect(points: readonly Point[], rect: Rect): readonly Point[][]
{
    if (points.length < 2) return [points as Point[]];

    let enter = Number.POSITIVE_INFINITY;
    let exit = Number.NEGATIVE_INFINITY;
    let acc = 0;
    for (let i = 0; i < points.length - 1; i++)
    {
        const a = points[i]!, b = points[i + 1]!;
        const len = distance(a, b);
        const clip = len === 0 ? undefined : clipSegmentToRect(a, b, rect);
        if (clip !== undefined)
        {
            enter = Math.min(enter, acc + clip[0] * len);
            exit  = Math.max(exit,  acc + clip[1] * len);
        }
        acc += len;
    }

    if (!Number.isFinite(enter)) return [points as Point[]];   // rect misses the route

    const total = acc;
    const lead = sliceByArc(points, 0, enter);
    const tail = sliceByArc(points, exit, total);
    const runs = [lead, tail].filter((r) => r.length >= 2);
    return runs;   // empty when the rect swallows the whole route
}
