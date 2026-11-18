import type { Point } from '../../visual-engine/index.js';

// One interior route vertex, in absolute board-host coordinates.
// `userAltered` true = PINNED: a hard constraint the route must pass through,
// preserved across node moves and never re-minimised (only the layout pipeline
// clears it). false = AUTO: a bend the minimiser may move, collapse, or drop.
export interface RouteWaypoint
{
    readonly point:       Point;
    readonly userAltered: boolean;
}

export function waypoint(point: Point, userAltered: boolean = false): RouteWaypoint
{
    return { point, userAltered };
}

// Bare points in order — the router consumes Point[]; undefined -> [].
export function routePoints(wps: readonly RouteWaypoint[] | undefined): readonly Point[]
{
    return wps === undefined ? [] : wps.map(w => w.point);
}

export function hasPinned(wps: readonly RouteWaypoint[] | undefined): boolean
{
    return wps !== undefined && wps.some(w => w.userAltered);
}
