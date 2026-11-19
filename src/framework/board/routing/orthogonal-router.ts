import {
    LineSegment,
    PathFigure,
    PathGeometry,
    Point,
} from '../../../visual-engine/index.js';
import { PortSide, type ResolvedPortSide } from '../port.js';
import {
    ConnectorEnd,
    type IRouter,
    type RouteSpec,
    RouterRegistry,
    RoutingMode,
} from './router.js';
import { BoardSettings } from '../board-settings.js';

// Perpendicularity-preserving 90°-only polyline router. Implements
// [docs/connectors.md](../../../../docs/connectors.md) § 10.2:
// the first segment is collinear with the source-port outward ray and
// the last segment is collinear with the target-port outward ray, in
// every (sourceSide × targetSide) combination.
//
// Algorithm:
//   1. Stub each port outward by ORTHOGONAL_STUB so the first and last
//      segments are explicitly perpendicular to the port's side.
//   2. Route Manhattan-style between the stub endpoints, picking corner
//      placement so the route never U-turns at a stub. The stub
//      extensions guarantee the port-side perpendicularity invariant.
//   3. Collapse collinear consecutive segments so the emitted polyline
//      doesn't carry spurious bends.
//
// Cases the stub-Manhattan combination produces:
//   * Single segment — aligned opposite sides (e.g. E source east of W
//     target on the same Y line). Stubs collapse.
//   * 1 corner (L)  — mixed-axis "happy quadrant".
//   * 2 corners (Z) — natural opposite-side facing pair (E source west
//     of W target, midpoint on perpendicular axis) OR same-side same-
//     axis pair (E + E, midX past both ports).
//   * 3+ corners    — mixed-axis impossible-quadrant cases AND same-
//     axis facing-the-wrong-way cases.
//
// Waypoint case: source → wp[0] and wp[N-1] → target legs are routed
// with side awareness at the port end; inner wp[i] → wp[i+1] legs use
// a simple horizontal-first L. § 10.2's "on-ray" invariant for user-
// authored wp[0] / wp[N-1] is enforced by the editor (ConnectorEdit-
// Adorner), not by the router; off-ray waypoints still render but the
// adjacent legs will look weird.

// Port stub length + per-lane spacing, read live from settings (default 20 / 10)
// so a routing-setting edit re-routes existing connectors. Small functions so
// every call site resolves the current value on each route.
const orthogonalStub = (): number => BoardSettings.ConnectorOrthogonalStub();

// Per-slot stub extension. A side-anchored endpoint at slot index i pushes
// its perpendicular stub out by i × LANE_GAP beyond the base stub, so two
// connectors sharing a side (or a source/target column) settle their
// parallel runs onto distinct lanes instead of painting over each other.
// Small enough to stay visually tidy, large enough to separate strokes.
const laneGap = (): number => BoardSettings.ConnectorLaneGap();

class OrthogonalRouter implements IRouter
{
    public compute(spec: RouteSpec): PathGeometry
    {
        const points = computePoints(spec);
        const segments: LineSegment[] = [];
        for (let i = 1; i < points.length; i++) segments.push(new LineSegment(points[i]!));
        return new PathGeometry([new PathFigure(points[0]!, segments, false)]);
    }

    public tangentAt(spec: RouteSpec, end: ConnectorEnd): number
    {
        const points = computePoints(spec);
        // tangentAt() contract (router.ts): source-end reads the FIRST
        // segment source → next; target-end reads the LAST segment
        // previous → target. Both follow source-to-target travel order.
        if (end === ConnectorEnd.Source)
        {
            const a = points[0]!;
            const b = points.length >= 2 ? points[1]! : a;
            return angleBetween(a.X, a.Y, b.X, b.Y);
        }
        const b = points[points.length - 1]!;
        const a = points.length >= 2 ? points[points.length - 2]! : b;
        return angleBetween(a.X, a.Y, b.X, b.Y);
    }
}

function computePoints(spec: RouteSpec): Point[]
{
    const s = new Point(spec.sourceAnchor.x, spec.sourceAnchor.y);
    const t = new Point(spec.targetAnchor.x, spec.targetAnchor.y);
    const sSide = spec.sourceAnchor.side;
    const tSide = spec.targetAnchor.side;

    const sStub = stubPoint(s, sSide, spec.sourceAnchor.laneOffset ?? 0);
    const tStub = stubPoint(t, tSide, spec.targetAnchor.laneOffset ?? 0);

    if (spec.waypoints.length === 0)
    {
        // Perpendicular-beam intersection optimization. When the source's
        // outward ray and the target's outward ray cross on BOTH forward
        // halves (mixed-axis sides + the "happy quadrant" where the
        // intersection sits beyond both ports along their outward
        // directions), the natural L through that intersection is the
        // cleanest route — one bend, both adjacent segments collinear
        // with their port's outward ray by construction. Spec § 10.2's
        // perpendicularity invariant is honored without any stub.
        //
        // The stub-Manhattan fallback below already collapses to the
        // same 3-point L in roughly half of the mixed-axis quadrants
        // (the L1-friendly E→N, E→S-when-target-right-and-below, etc.,
        // where horizontal-first is U-turn-free at both ends). The
        // OTHER half currently emits a 5-point staircase because the L
        // corner sits at STUB coordinates instead of port coordinates
        // — S→W with target down-right of source is the canonical
        // example. The intersection short-circuit catches both halves
        // uniformly and lets the same-axis Z / impossible-quadrant
        // cases fall through to stub-Manhattan unchanged (parallel
        // beams or backward-ray intersection ⇒ no optimization fires).
        const corner = perpendicularBeamIntersection(s, sSide, t, tSide);
        if (corner !== undefined)
        {
            return collapseCollinear([s, corner, t]);
        }

        const middle = manhattanBetween(sStub, sSide, tStub, tSide, false);
        return collapseCollinear([s, sStub, ...middle, tStub, t]);
    }

    // With user waypoints: the route is source → sStub → wp[0] → ... →
    // wp[N-1] → tStub → target. Each consecutive pair connects with a
    // Manhattan path. Per-leg collapse preserves user-authored waypoints
    // as bend points — without it, a waypoint on the source-stub line
    // would collapse away and the user's intended bend location would
    // disappear.
    //
    // L preference per leg:
    //   * source → wp[0] : default L1 (horizontal first when sSide is
    //                      horizontal); the U-turn check at the source
    //                      end forces L2 when sSide is vertical.
    //   * inner wp pairs : default L1 (horizontal first), matching the
    //                      prior router's intermediate behavior.
    //   * wp[N-1] → tStub: prefer L2 when target side is horizontal so
    //                      the bend lands at the waypoint X, not at
    //                      tStub.X. Without this, an axis-aligned
    //                      user waypoint reads as a pass-through
    //                      instead of a bend.
    const wps = spec.waypoints;
    const tHorizontal = tSide === PortSide.E || tSide === PortSide.W;

    const out: Point[] = [];

    const leg1 = collapseCollinear([
        s, sStub,
        ...manhattanBetween(sStub, sSide, wps[0]!, undefined, false),
        wps[0]!,
    ]);
    pushAll(out, leg1, 0);

    for (let i = 0; i < wps.length - 1; i++)
    {
        const inner = collapseCollinear([
            wps[i]!,
            ...manhattanBetween(wps[i]!, undefined, wps[i + 1]!, undefined, false),
            wps[i + 1]!,
        ]);
        pushAll(out, inner, 1);
    }

    const lastWp = wps[wps.length - 1]!;
    const legN = collapseCollinear([
        lastWp,
        ...manhattanBetween(lastWp, undefined, tStub, tSide, tHorizontal),
        tStub, t,
    ]);
    pushAll(out, legN, 1);
    return out;
}

function pushAll(out: Point[], src: readonly Point[], startIndex: number): void
{
    for (let i = startIndex; i < src.length; i++) out.push(src[i]!);
}

// Manhattan path from `from` to `to`, returning intermediate corners
// only (not `from` or `to`). The fromSide / toSide constraints, if
// supplied, are used to avoid U-turns: the first segment of the middle
// path must not go in -fromSide direction, and the last middle segment
// must not go in +toSide direction (else the next segment, which is
// `to` → outward in -toSide direction, would reverse).
//
// When fromSide / toSide is undefined (inner waypoint pair), the routing
// picks the L variant freely, defaulting to horizontal-first.
function manhattanBetween(
    from:     Point,
    fromSide: ResolvedPortSide | undefined,
    to:       Point,
    toSide:   ResolvedPortSide | undefined,
    preferL2: boolean,
): Point[]
{
    if (from.X === to.X && from.Y === to.Y) return [];

    const fromVec = fromSide !== undefined ? sideVector(fromSide) : { x: 0, y: 0 };
    const toVec   = toSide   !== undefined ? sideVector(toSide)   : { x: 0, y: 0 };
    const sx = sign(to.X - from.X);
    const sy = sign(to.Y - from.Y);

    // Opposite same-axis sides (E↔W or N↔S): natural Z bridge with
    // midpoint between the ports. Honors both sides when the ports
    // face each other; falls back to a perpendicular-axis bridge when
    // they face away (impossible-Z aligned case).
    if (fromSide !== undefined && toSide !== undefined && areOpposite(fromSide, toSide))
    {
        return zNaturalOrPerpendicular(from, fromVec, to);
    }

    // Straight line (0 corners) when from and to share an axis.
    if (from.X === to.X)
    {
        if (!isVUTurnFrom(sy, fromVec) && !isVUTurnTo(sy, toVec)) return [];
        // Aligned but at least one end U-turns: needs a horizontal jog.
        return horizontalBridge(from, to);
    }
    if (from.Y === to.Y)
    {
        if (!isHUTurnFrom(sx, fromVec) && !isHUTurnTo(sx, toVec)) return [];
        return verticalBridge(from, to);
    }

    // L1 = horizontal first, vertical last. Corner (to.X, from.Y).
    // L2 = vertical first, horizontal last. Corner (from.X, to.Y).
    const l1OK = !isHUTurnFrom(sx, fromVec) && !isVUTurnTo(sy, toVec);
    const l2OK = !isVUTurnFrom(sy, fromVec) && !isHUTurnTo(sx, toVec);
    if (preferL2)
    {
        if (l2OK) return [new Point(from.X, to.Y)];
        if (l1OK) return [new Point(to.X, from.Y)];
    }
    else
    {
        if (l1OK) return [new Point(to.X, from.Y)];
        if (l2OK) return [new Point(from.X, to.Y)];
    }

    // Same-side or same-axis facing-away that needs a Z. Pick the bridge
    // axis (vertical or horizontal middle) based on which axis avoids
    // U-turns at both ends.
    if (fromVec.y === 0 && toVec.y === 0)
    {
        // Both ports horizontal — Z with horizontal middle, vertical
        // first/last legs sidestep the horizontal U-turn check.
        const yMid = (from.Y + to.Y) / 2;
        return [new Point(from.X, yMid), new Point(to.X, yMid)];
    }
    if (fromVec.x === 0 && toVec.x === 0)
    {
        const xMid = (from.X + to.X) / 2;
        return [new Point(xMid, from.Y), new Point(xMid, to.Y)];
    }
    // Mixed-axis impossible-quadrant fallback: at least one of the
    // L checks above should have passed. If we get here, the route is
    // an edge case; emit a 2-corner Z using the perpendicular bridge
    // matching the side without a free axis.
    const yMidFallback = (from.Y + to.Y) / 2;
    return [new Point(from.X, yMidFallback), new Point(to.X, yMidFallback)];
}

// E↔W or N↔S aligned (facing each other) — natural Z when geometry
// permits, perpendicular-axis bridge otherwise. The "natural" Z places
// the bend at the midpoint along the axis the ports share; the
// "perpendicular" Z bridges across the perpendicular axis when the
// ports face away from each other.
function zNaturalOrPerpendicular(
    from:    Point,
    fromVec: { x: number; y: number },
    to:      Point,
): Point[]
{
    // Horizontal sides (E↔W). fromVec.x = ±1, toVec.x = ∓1.
    if (fromVec.x !== 0)
    {
        // Natural Z works iff the line from from to to is going in the
        // source's outward direction (toX > fromX for E source).
        // Verify the midX-natural placement avoids U-turn at both ends.
        if (Math.sign(to.X - from.X) === fromVec.x && from.X !== to.X)
        {
            const midX = (from.X + to.X) / 2;
            return [new Point(midX, from.Y), new Point(midX, to.Y)];
        }
        // Facing away (impossible-Z aligned): horizontal-axis bridge
        // doesn't help. Use a perpendicular Y-axis bridge between the
        // stubs at midY.
        let midY = (from.Y + to.Y) / 2;
        if (midY === from.Y) midY = from.Y + orthogonalStub();
        return [new Point(from.X, midY), new Point(to.X, midY)];
    }
    // Vertical sides (N↔S). fromVec.y = ±1, toVec.y = ∓1.
    if (Math.sign(to.Y - from.Y) === fromVec.y && from.Y !== to.Y)
    {
        const midY = (from.Y + to.Y) / 2;
        return [new Point(from.X, midY), new Point(to.X, midY)];
    }
    let midX = (from.X + to.X) / 2;
    if (midX === from.X) midX = from.X + orthogonalStub();
    return [new Point(midX, from.Y), new Point(midX, to.Y)];
}

// Vertical bridge between two horizontally-aligned (same-Y) points that
// would U-turn at one of the ports if connected directly. The bridge
// adds a vertical detour at a midX between the ports — used for
// same-axis facing-away cases where the natural straight line goes the
// wrong way for at least one port. midX is the simple average; both
// vertical legs of the resulting Z stay on the perpendicular axis so
// they don't trigger horizontal U-turn checks.
function verticalBridge(from: Point, to: Point): Point[]
{
    let midX = (from.X + to.X) / 2;
    if (midX === from.X) midX = from.X + orthogonalStub();
    return [new Point(midX, from.Y), new Point(midX, to.Y)];
}

function horizontalBridge(from: Point, to: Point): Point[]
{
    let midY = (from.Y + to.Y) / 2;
    if (midY === from.Y) midY = from.Y + orthogonalStub();
    return [new Point(from.X, midY), new Point(to.X, midY)];
}

// U-turn predicates. The signature mirrors the call-site axis:
//   * isHUTurnFrom(sx, fromVec) checks whether a horizontal segment
//     leaving `from` with X-sign `sx` reverses fromSide.
//   * isVUTurnTo(sy, toVec) checks whether a vertical segment arriving
//     at `to` with Y-sign `sy` continues IN to-side outward direction
//     (which would force the next segment to reverse).
// Each returns false when the side vector is undefined or zero on the
// relevant axis (segment is perpendicular to the side, no U-turn risk).
function isHUTurnFrom(sx: number, fromVec: { x: number; y: number }): boolean
{
    return fromVec.x !== 0 && sx === -fromVec.x;
}

function isHUTurnTo(sx: number, toVec: { x: number; y: number }): boolean
{
    return toVec.x !== 0 && sx === toVec.x;
}

function isVUTurnFrom(sy: number, fromVec: { x: number; y: number }): boolean
{
    return fromVec.y !== 0 && sy === -fromVec.y;
}

function isVUTurnTo(sy: number, toVec: { x: number; y: number }): boolean
{
    return toVec.y !== 0 && sy === toVec.y;
}

// Outward unit vector for each cardinal side. N is screen-up so its Y
// component is negative; S is screen-down so positive.
function sideVector(side: ResolvedPortSide): { x: number; y: number }
{
    switch (side)
    {
        case PortSide.N: return { x: 0,  y: -1 };
        case PortSide.S: return { x: 0,  y: 1  };
        case PortSide.E: return { x: 1,  y: 0  };
        case PortSide.W: return { x: -1, y: 0  };
    }
}

function stubPoint(p: Point, side: ResolvedPortSide, laneOffset: number): Point
{
    const v = sideVector(side);
    const reach = orthogonalStub() + laneOffset * laneGap();
    return new Point(p.X + v.x * reach, p.Y + v.y * reach);
}

// Intersection of the source's and target's outward beams on their
// FORWARD halves. Returns undefined when:
//   * Both beams are on the same axis (parallel — no unique meet point).
//     Same-axis facing-each-other (E↔W, N↔S) and same-side same-axis
//     cases are handled by zNaturalOrPerpendicular under the stub-
//     Manhattan path; this is the same partition the optimization
//     deliberately leaves alone.
//   * The intersection sits on either beam's BACKWARD half (one of the
//     params ≤ 0). Walking the connector through such a corner would
//     either traverse the side wall of the port (negative outward
//     travel) OR collapse the source / target segment to zero length —
//     both violate § 10.2.
//
// The strict ">0" guard on both params also rules out the degenerate
// corner === s or corner === t cases. corner === s ⇔ sParam === 0 (the
// corner sits on the source's line at the source's location), in which
// case the "first segment" would have zero length and the immediately-
// following segment would head along the target's perpendicular axis
// — perpendicular to, not collinear with, the source's outward ray.
// Symmetric reasoning at the target end.
function perpendicularBeamIntersection(
    s: Point, sSide: ResolvedPortSide,
    t: Point, tSide: ResolvedPortSide,
): Point | undefined
{
    const sVec = sideVector(sSide);
    const tVec = sideVector(tSide);
    if (sVec.x !== 0 && tVec.x !== 0) return undefined;  // both horizontal
    if (sVec.y !== 0 && tVec.y !== 0) return undefined;  // both vertical

    let corner: Point;
    let sParam: number;
    let tParam: number;
    if (sVec.x !== 0)
    {
        // Source horizontal, target vertical. Corner sits at the
        // target's X (on the target's vertical beam) and the source's
        // Y (on the source's horizontal beam). sVec.x and tVec.y are
        // each ±1, so the multiplications below collapse to signed
        // forward-distance along the outward direction.
        corner = new Point(t.X, s.Y);
        sParam = (t.X - s.X) * sVec.x;
        tParam = (s.Y - t.Y) * tVec.y;
    }
    else
    {
        // Source vertical, target horizontal.
        corner = new Point(s.X, t.Y);
        sParam = (t.Y - s.Y) * sVec.y;
        tParam = (s.X - t.X) * tVec.x;
    }
    if (sParam <= 0 || tParam <= 0) return undefined;
    return corner;
}

function areOpposite(a: ResolvedPortSide, b: ResolvedPortSide): boolean
{
    return (a === PortSide.E && b === PortSide.W)
        || (a === PortSide.W && b === PortSide.E)
        || (a === PortSide.N && b === PortSide.S)
        || (a === PortSide.S && b === PortSide.N);
}

function sign(n: number): number
{
    return n > 0 ? 1 : n < 0 ? -1 : 0;
}

// Drop intermediate points that lie on the same axis-aligned line as
// their neighbors and travel in the same direction (no actual bend).
// Preserves the start and end. Two consecutive duplicate points are
// also collapsed to a single point.
function collapseCollinear(pts: readonly Point[]): Point[]
{
    if (pts.length <= 2) return pts.slice();
    const out: Point[] = [pts[0]!];
    for (let i = 1; i < pts.length - 1; i++)
    {
        const prev = out[out.length - 1]!;
        const curr = pts[i]!;
        const next = pts[i + 1]!;
        if (prev.X === curr.X && curr.X === next.X)
        {
            // All three share X — skip curr.
            continue;
        }
        if (prev.Y === curr.Y && curr.Y === next.Y)
        {
            continue;
        }
        if (prev.X === curr.X && prev.Y === curr.Y)
        {
            // Duplicate point.
            continue;
        }
        out.push(curr);
    }
    out.push(pts[pts.length - 1]!);
    return out;
}

function angleBetween(x0: number, y0: number, x1: number, y1: number): number
{
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (dx === 0 && dy === 0) return 0;
    return Math.atan2(dy, dx);
}

RouterRegistry.register(RoutingMode.Orthogonal, new OrthogonalRouter());
