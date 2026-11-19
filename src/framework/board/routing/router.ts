import type { PathGeometry, Point, Rect } from '../../../visual-engine/index.js';
import type { ResolvedPortSide } from '../port.js';

// Re-exported from port.ts so the routing layer keeps a single
// import surface. PortResolver collapses PortSide.Auto into a
// concrete cardinal before emitting a ResolvedAnchor; routers
// therefore only ever see the 4 cardinals.
export type { ResolvedPortSide };

// Which end of a connector a router-side call refers to. Used by
// tangentAt() to disambiguate between the source-end and target-end
// caps when rotating their visuals.
export enum ConnectorEnd
{
    Source = 'Source',
    Target = 'Target',
}

// Built-in routing-mode names. Open-ended by design: custom routers
// register through RouterRegistry and consumers pass any string into
// Connector.RoutingModeKey, so the DP is typed `string` rather than
// `BuiltInRoutingMode`. The const-namespace pattern gives the built-ins
// rename-refactor support without closing the universe of router
// names.
export const RoutingMode = {
    Straight:   'Straight',
    Orthogonal: 'Orthogonal',
    Bezier:     'Bezier',
} as const;
export type BuiltInRoutingMode = typeof RoutingMode[keyof typeof RoutingMode];

// One endpoint of a connector, after PortResolver has collapsed the
// ConnectorEndpoint DPs (Node + PortName / PortSide / PortIndex /
// FreePoint) into a concrete board-host-coordinate point + cardinal.
// Routers never see the upstream DP soup — they consume this struct.
export interface ResolvedAnchor
{
    x:    number;
    y:    number;
    side: ResolvedPortSide;
    // Lane index for orthogonal stub staggering. Side-anchored endpoints
    // carry their slot index here so the orthogonal router can push each
    // connector's perpendicular stub out by `laneOffset × gap`, fanning
    // co-located parallel runs into distinct lanes instead of stacking
    // them on one shared line. 0 / undefined = the base stub (single
    // connector on the side, or a router that ignores lanes). Only the
    // orthogonal router reads it; straight / bezier are unaffected.
    laneOffset?: number;
}

// Input contract for every IRouter call. Carries everything a router
// needs to emit a PathGeometry: both endpoints, both rects (for routers
// that need bbox information — Orthogonal uses it to detour around
// the source / target shape's footprint when the natural elbow would
// pass through them), and any consumer-authored waypoints.
//
// Coordinates are all in board-host space (the canvas the router's
// output PathGeometry will paint into); see § 5 of
// [docs/connectors.md](../../../../docs/connectors.md) for
// the coordinate-space contract.
export interface RouteSpec
{
    sourceRect:   Rect;
    sourceAnchor: ResolvedAnchor;
    targetRect:   Rect;
    targetAnchor: ResolvedAnchor;
    waypoints:    readonly Point[];
}

// Pure-function contract — no Visual, no DOM, no DP state. Hot path
// is compute(); cap rotation reads tangentAt() once per re-route per
// end.
//
// tangentAt() returns the angle (radians) of the path's direction of
// travel at the named end, measured CCW from +X:
//   * ConnectorEnd.Source — angle of the FIRST segment, oriented
//     source → next-vertex.
//   * ConnectorEnd.Target — angle of the LAST segment, oriented
//     previous-vertex → target.
// Both follow the source-to-target travel direction. Cap templates
// decide how to orient relative to that tangent.
//
// Degenerate case (source = target, no waypoints, zero-length route):
// implementations return 0 (East). Predictable, non-NaN, lets cap
// rotation still produce a stable transform.
export interface IRouter
{
    compute(spec: RouteSpec):                 PathGeometry;
    tangentAt(spec: RouteSpec, end: ConnectorEnd): number;
}

// Process-wide name → IRouter map. Built-in routers self-register on
// module load (side-effect import of straight-router.js etc.) under
// the names from RoutingMode. Custom routers register at consumer
// startup time, before the first Connector is constructed.
//
// `resolve()` throws on miss with the known names listed so consumers
// can tell a typo from a missing registration. See § 7.10 of
// [docs/connectors.md](../../../../docs/connectors.md) on
// test-isolation teardown.
export class RouterRegistry
{
    private static readonly _routers: Map<string, IRouter> = new Map();

    public static register(name: string, router: IRouter): void
    {
        RouterRegistry._routers.set(name, router);
    }

    public static resolve(name: string): IRouter
    {
        const router = RouterRegistry._routers.get(name);
        if (router === undefined)
        {
            const known = [...RouterRegistry._routers.keys()].join(', ');
            throw new Error(
                `RouterRegistry: no router registered under '${name}'. Known: ${known}`,
            );
        }
        return router;
    }
}
