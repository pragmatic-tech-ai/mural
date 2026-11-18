import {
    LineSegment,
    PathFigure,
    PathGeometry,
    Point,
} from '../../../visual-engine/index.js';
import {
    ConnectorEnd,
    type IRouter,
    type RouteSpec,
    RouterRegistry,
    RoutingMode,
} from './router.js';

// Polyline from source through each waypoint to target. Single
// segment when waypoints is empty. The simplest routing flavor; cap
// math is trivial because every segment is a line.
class StraightRouter implements IRouter
{
    public compute(spec: RouteSpec): PathGeometry
    {
        const start = new Point(spec.sourceAnchor.x, spec.sourceAnchor.y);
        const end   = new Point(spec.targetAnchor.x, spec.targetAnchor.y);

        // One LineSegment per waypoint, then one final LineSegment to
        // the target. `waypoints` is empty in the common case → just
        // the closing segment, producing a single straight line.
        const segments: LineSegment[] = [];
        for (const wp of spec.waypoints) segments.push(new LineSegment(wp));
        segments.push(new LineSegment(end));

        const figure = new PathFigure(start, segments, false);
        return new PathGeometry([figure]);
    }

    public tangentAt(spec: RouteSpec, end: ConnectorEnd): number
    {
        if (end === ConnectorEnd.Source)
        {
            // Source-end tangent reads the first segment, oriented
            // source → next vertex. The "next vertex" is the first
            // waypoint when present, otherwise the target.
            const next = spec.waypoints.length > 0
                ? spec.waypoints[0]!
                : new Point(spec.targetAnchor.x, spec.targetAnchor.y);
            return angleBetween(
                spec.sourceAnchor.x, spec.sourceAnchor.y, next.X, next.Y,
            );
        }
        // Target-end tangent reads the last segment, oriented
        // previous vertex → target. The "previous vertex" is the last
        // waypoint when present, otherwise the source.
        const prev = spec.waypoints.length > 0
            ? spec.waypoints[spec.waypoints.length - 1]!
            : new Point(spec.sourceAnchor.x, spec.sourceAnchor.y);
        return angleBetween(
            prev.X, prev.Y, spec.targetAnchor.x, spec.targetAnchor.y,
        );
    }
}

// Math.atan2 over the (dx, dy) vector. Returns 0 when both points
// coincide — atan2(0, 0) is implementation-defined, conventionally 0
// in JS, but we normalize explicitly so the contract is testable.
function angleBetween(x0: number, y0: number, x1: number, y1: number): number
{
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (dx === 0 && dy === 0) return 0;
    return Math.atan2(dy, dx);
}

RouterRegistry.register(RoutingMode.Straight, new StraightRouter());
