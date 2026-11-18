import {
    LineSegment,
    PathFigure,
    PathGeometry,
    Point,
} from '../../../visual-engine/index.js';

// Pure-function polyline shortening. Trims `sourceInset` units off the
// source end (the polyline's start) and `targetInset` units off the
// target end (the polyline's tail), measured along the polyline's
// arc length. Returns the shortened vertex list.
//
// Behavior at edges:
//   * inset <= 0          → identity at that end.
//   * inset == segmentLen → drops the corresponding vertex.
//   * inset >  totalLen   → collapses the polyline to a single point
//                            (or empty if both insets together exceed
//                            total length). Callers receiving fewer
//                            than 2 vertices typically skip drawing.
//
// V1 scope: line-segment polylines only. The PathGeometry → polyline
// extractor [pathGeometryToPolyline] enforces that — cubic / quadratic
// paths return undefined and the caller skips inset trimming, leaving
// caps visually overshooting the curve. Step 7's documented gap; the
// arc-length-walk approach in [outline-flatten.ts] is the path forward.
export function shortenPolyline(
    points:      readonly Point[],
    sourceInset: number,
    targetInset: number,
): readonly Point[]
{
    if (points.length < 2) return points;
    if (sourceInset <= 0 && targetInset <= 0) return points;

    let work: Point[] = [...points];

    if (sourceInset > 0)
    {
        let remaining = sourceInset;
        while (work.length >= 2 && remaining > 0)
        {
            const a = work[0]!;
            const b = work[1]!;
            const segLen = Math.hypot(b.X - a.X, b.Y - a.Y);
            if (segLen >= remaining)
            {
                const t = segLen === 0 ? 0 : remaining / segLen;
                work[0] = new Point(a.X + t * (b.X - a.X), a.Y + t * (b.Y - a.Y));
                remaining = 0;
            }
            else
            {
                work.shift();
                remaining -= segLen;
            }
        }
    }

    if (targetInset > 0)
    {
        let remaining = targetInset;
        while (work.length >= 2 && remaining > 0)
        {
            const a = work[work.length - 1]!;
            const b = work[work.length - 2]!;
            const segLen = Math.hypot(a.X - b.X, a.Y - b.Y);
            if (segLen >= remaining)
            {
                const t = segLen === 0 ? 0 : remaining / segLen;
                work[work.length - 1] = new Point(
                    a.X + t * (b.X - a.X),
                    a.Y + t * (b.Y - a.Y));
                remaining = 0;
            }
            else
            {
                work.pop();
                remaining -= segLen;
            }
        }
    }

    return work;
}

// Extract the polyline-as-Points view of a PathGeometry. Returns
// undefined when the figure contains anything other than LineSegments
// — the caller treats that as a "can't shorten" signal and writes the
// route's Geometry verbatim. Single-figure-only by V1 contract.
export function pathGeometryToPolyline(g: PathGeometry): readonly Point[] | undefined
{
    if (g.Figures.length !== 1) return undefined;
    const fig = g.Figures[0]!;
    const points: Point[] = [fig.StartPoint];
    for (const seg of fig.Segments)
    {
        if (!(seg instanceof LineSegment)) return undefined;
        points.push(seg.Point);
    }
    return points;
}

// Build a single-figure PathGeometry from a polyline. Symmetric with
// pathGeometryToPolyline — the round-trip preserves the underlying
// Geometry shape so the renderer treats the inset-shortened route
// identically to the un-shortened one.
export function polylineToPathGeometry(points: readonly Point[]): PathGeometry
{
    if (points.length < 2)
    {
        // Degenerate inset: emit an "empty" figure to keep the
        // PathGeometry / PathFigure shape intact for downstream
        // renderers. Callers expecting visible output should clamp
        // CapInset values upstream.
        const start = points[0] ?? new Point(0, 0);
        return new PathGeometry([new PathFigure(start, [], false)]);
    }
    const segments: LineSegment[] = [];
    for (let i = 1; i < points.length; i++) segments.push(new LineSegment(points[i]!));
    return new PathGeometry([new PathFigure(points[0]!, segments, false)]);
}

// Build a multi-figure PathGeometry — one open figure per polyline run.
// Backs the connector "line gap" label style, where a route is drawn as
// two disjoint runs that break around the label. Runs shorter than two
// points are skipped; an all-empty input yields a single empty figure so
// the PathGeometry / PathFigure shape stays intact for the renderer.
export function polylinesToPathGeometry(runs: readonly (readonly Point[])[]): PathGeometry
{
    const figures: PathFigure[] = [];
    for (const points of runs)
    {
        if (points.length < 2) continue;
        const segments: LineSegment[] = [];
        for (let i = 1; i < points.length; i++) segments.push(new LineSegment(points[i]!));
        figures.push(new PathFigure(points[0]!, segments, false));
    }
    if (figures.length === 0) figures.push(new PathFigure(new Point(0, 0), [], false));
    return new PathGeometry(figures);
}
