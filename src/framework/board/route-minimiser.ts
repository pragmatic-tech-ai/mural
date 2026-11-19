import type { Point } from '../../visual-engine/index.js';
import { type RouteWaypoint } from './route-waypoint.js';

const EPS = 0.5;   // sub-pixel collinearity tolerance

// Perpendicular distance of p from the line a->b (0 for a degenerate a==b).
function offLine(p: Point, a: Point, b: Point): number
{
    const dx = b.X - a.X, dy = b.Y - a.Y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return Math.hypot(p.X - a.X, p.Y - a.Y);
    return Math.abs((p.X - a.X) * dy - (p.Y - a.Y) * dx) / len;
}

// Reduce the waypoint list to the minimum the route needs: keep every PINNED
// vertex; drop an AUTO vertex that sits (within EPS) on the straight line
// between its neighbours in the full sequence [src, ...wps, tgt].
export function minimiseRoute(
    wps: readonly RouteWaypoint[], src: Point, tgt: Point,
): readonly RouteWaypoint[]
{
    const kept: RouteWaypoint[] = [];
    for (let i = 0; i < wps.length; i++)
    {
        const w = wps[i]!;
        if (w.userAltered) { kept.push(w); continue; }
        const prev = kept.length > 0 ? kept[kept.length - 1]!.point : src;
        const next = i + 1 < wps.length ? wps[i + 1]!.point : tgt;
        if (offLine(w.point, prev, next) > EPS) kept.push(w);
        // else: collinear auto vertex — drop it.
    }
    return kept;
}
