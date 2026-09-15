import { type Geometry, type PathGeometry, type Point } from '../../visual-engine/index.js';
import { type Rect } from '../../runtime/index.js';
import { PortSide, type Port, type ResolvedPortSide } from './port.js';
import type { ConnectorEndpoint } from './connector-endpoint.js';
import { ConnectorRoutingScheduler } from './connector-routing-scheduler.js';

// Duck-typed shape of a Connector for the side-intersection optimizer.
// The optimizer only needs the resolved Geometry to extract a polyline and
// test crossings — anything else stays out of the contract. Lives here (not
// in figure.ts) so any Figure host can share the one optimizer implementation
// the registry owns.
export interface ISideAnchoredConnector
{
    readonly Geometry: Geometry | undefined;
}

// Duck-typed contract for a node that exposes Figure's side-endpoint
// surface. The container Figure is the sole side-endpoint host for every node
// kind (content VMs route through their container). The connector reads it
// duck-typed (via asSideSlotHost) so hosts need not share a common base.
//
// Parameter order for _registerSideEndpoint matches the calling convention
// in connector.ts: (side, ep, onRebalance, owner?) — rebalance before owner.
export interface ISideEndpointHost
{
    readonly Ports: readonly Port[];
    GetSideSlot(ep: ConnectorEndpoint, side: ResolvedPortSide): { index: number; count: number } | undefined;
    GetSideEndpointCount(side: ResolvedPortSide): number;
    SlotIndexForPosition(side: ResolvedPortSide, cursor: Point): number | undefined;
    _registerSideEndpoint(side: ResolvedPortSide, ep: ConnectorEndpoint, onRebalance: () => void, owner?: unknown): void;
    _unregisterSideEndpoint(side: ResolvedPortSide, ep: ConnectorEndpoint): void;
    // Re-order the side's slots to minimise crossings between the connectors
    // that share it. Part of the contract (not a duck-typed optional) so a
    // host missing it is a compile error rather than a silent no-op.
    _optimizeSideIntersections(side: ResolvedPortSide): void;
}

// Reusable implementation of Figure's per-side endpoint registry.
// Holds NO Figure-specific state; bounds are supplied via a `bounds`
// callback so any host (a Figure via its Left/Top/Width/Height) can supply its
// coordinate frame without coupling this class to the host type.
export class SideEndpointRegistry
{
    private readonly _sideEndpoints: Map<ResolvedPortSide, ConnectorEndpoint[]> = new Map();
    private readonly _sideRebalanceCallbacks: Map<ConnectorEndpoint, () => void> = new Map();
    // Endpoint → owning Connector (duck-typed). The side-intersection
    // optimizer reads the owner's Geometry to detect crossings between
    // pairs of connectors on the same side; storing the back-reference
    // here avoids a quadratic scan through diagram.Connectors at every
    // optimize pass.
    private readonly _sideEndpointOwners: Map<ConnectorEndpoint, ISideAnchoredConnector> = new Map();

    // Re-entry guard for optimizeIntersections. The optimizer fires
    // _fireSideRebalance after each tentative swap to re-route the side;
    // that re-route cascades back through the Connector recompute path,
    // which itself calls optimizeIntersections. Without the guard the
    // optimizer would recurse indefinitely.
    private _optimizing = false;

    // Sides whose slot order the USER pinned by hand (a segment-drag reorder).
    // The auto crossing-optimizer must not touch these — a hand-placed order is
    // a decision to respect, not a crossing to "fix". Set by MoveSideEndpoint
    // (the manual-reorder entry point); read by optimizeIntersections.
    private readonly _userOrdered = new Set<ResolvedPortSide>();

    constructor(private readonly bounds: () => Rect) {}

    /** @internal — called by Connector when an endpoint settles on this node + side.
     *  Parameter order mirrors Figure's public API: (side, ep, onRebalance, owner?). */
    public _registerSideEndpoint(
        side: ResolvedPortSide,
        endpoint: ConnectorEndpoint,
        onRebalance: () => void,
        owner?: unknown,
    ): void
    {
        let list = this._sideEndpoints.get(side);
        if (list === undefined) { list = []; this._sideEndpoints.set(side, list); }
        if (list.includes(endpoint)) return;
        list.push(endpoint);
        this._sideRebalanceCallbacks.set(endpoint, onRebalance);
        if (owner !== undefined) this._sideEndpointOwners.set(endpoint, owner as ISideAnchoredConnector);
        this._fireSideRebalance(side);
    }

    /** @internal — called by Connector when an endpoint moves off / clears. */
    public _unregisterSideEndpoint(side: ResolvedPortSide, endpoint: ConnectorEndpoint): void
    {
        const list = this._sideEndpoints.get(side);
        if (list === undefined) return;
        const idx = list.indexOf(endpoint);
        if (idx < 0) return;
        list.splice(idx, 1);
        this._sideRebalanceCallbacks.delete(endpoint);
        this._sideEndpointOwners.delete(endpoint);
        this._fireSideRebalance(side);
    }

    /** Slot index + total count for `endpoint` on `side`, or undefined
     *  if the endpoint isn't registered on that side. The slot index is
     *  insertion-order based, which keeps positions stable across
     *  unrelated additions to OTHER sides. */
    public GetSideSlot(
        endpoint: ConnectorEndpoint,
        side: ResolvedPortSide,
    ): { index: number; count: number } | undefined
    {
        const list = this._sideEndpoints.get(side);
        if (list === undefined) return undefined;
        const idx = list.indexOf(endpoint);
        if (idx < 0) return undefined;
        return { index: idx, count: list.length };
    }

    /** Number of side-anchored endpoints currently registered on `side`. */
    public GetSideEndpointCount(side: ResolvedPortSide): number
    {
        return this._sideEndpoints.get(side)?.length ?? 0;
    }

    /** Slot index whose dynamic position is nearest `cursor` along the
     *  side's distribution axis (Y for E/W, X for N/S), inverting the
     *  same Left/Top/Width/Height slot layout the resolver lays out in
     *  connector.ts's tryResolveSideSlot. Returns undefined when the
     *  side is empty or the host is unsized. */
    public SlotIndexForPosition(side: ResolvedPortSide, cursor: Point): number | undefined
    {
        const list = this._sideEndpoints.get(side);
        if (list === undefined || list.length === 0) return undefined;
        const count = list.length;
        const r = this.bounds();
        const vertical = side === PortSide.E || side === PortSide.W;   // distributes along Y
        const start = vertical ? r.Y    : r.X;
        const len   = vertical ? r.Height : r.Width;
        if (len <= 0) return undefined;
        const pos = vertical ? cursor.Y : cursor.X;
        // slotCenter(i) = start + (i + 1) / (count + 1) * len  →  invert for i.
        let idx = Math.round((pos - start) / len * (count + 1) - 1);
        if (idx < 0) idx = 0;
        if (idx > count - 1) idx = count - 1;
        return idx;
    }

    public _fireSideRebalance(side: ResolvedPortSide): void
    {
        // Routing-suspend scope: during a bulk wire, collapse the O(k) side
        // re-route into a single dirty mark; the scheduler's flush Pass B fires
        // one rebalance + one optimize per side. See connector-routing-scheduler.ts.
        if (ConnectorRoutingScheduler.IsSuspended)
        {
            ConnectorRoutingScheduler.markSideDirty(this, side);
            return;
        }
        const list = this._sideEndpoints.get(side);
        if (list === undefined) return;
        // Snapshot — listener may unregister mid-fire (a rebalance can
        // cascade through a Connector that detaches its previous side).
        for (const ep of [...list])
        {
            this._sideRebalanceCallbacks.get(ep)?.();
        }
    }

    /** Read-only view of the endpoint list for a side — used by the
     *  side optimizer in Figure._optimizeSideIntersections after the
     *  registry moved here. Returns an empty array if the side is absent. */
    public getSideList(side: ResolvedPortSide): ConnectorEndpoint[]
    {
        return this._sideEndpoints.get(side) ?? [];
    }

    /** Owner map accessor for the side optimizer. */
    public getOwner(ep: ConnectorEndpoint): ISideAnchoredConnector | undefined
    {
        return this._sideEndpointOwners.get(ep);
    }

    /** Mark `side` as hand-ordered by the user, freezing it against the auto
     *  crossing-optimizer. Called by the manual segment-drag reorder path. */
    public markUserOrdered(side: ResolvedPortSide): void
    {
        this._userOrdered.add(side);
    }

    /** Re-order `side`'s endpoint slots to minimise the number of crossings
     *  (and collinear overlaps) between the connectors that share the side.
     *
     *  Hill-climbs on the TOTAL side crossing count: it tries every pair
     *  swap, keeps a swap only when it STRICTLY reduces the total, and
     *  reverts otherwise. Each tentative swap re-routes the side via
     *  _fireSideRebalance so the crossing test reads live geometry — this is
     *  the empirical approach, which (unlike a one-shot far-endpoint sort)
     *  handles wrap-around / same-side routes where the crossing-free order
     *  is NOT simply the far-endpoint order. Bounded iteration guards against
     *  a topology (e.g. a pinned waypoint) that no ordering can fully resolve.
     *
     *  Skips entirely unless EVERY connector on the side has a resolved route
     *  (defined Geometry). During load and while a host is still settling its
     *  size, some routes are transient; measuring/mutating them then is what
     *  let a connector be captured at a bad anchor. Requiring all routes
     *  resolved keeps the optimiser off until the side is stable. */
    public optimizeIntersections(side: ResolvedPortSide): void
    {
        if (this._optimizing) return;
        if (this._userOrdered.has(side)) return;
        const list = this._sideEndpoints.get(side);
        if (list === undefined || list.length < 2) return;   // single connector — nothing to optimize
        const owners: ISideAnchoredConnector[] = [];
        for (const ep of list)
        {
            const o = this._sideEndpointOwners.get(ep);
            if (o === undefined) return;              // mixed-ownership side
            if (o.Geometry === undefined) return;     // a route not yet resolved
            owners.push(o);
        }
        this._optimizing = true;
        try
        {
            const total = (): number =>
            {
                let n = 0;
                for (let i = 0; i < owners.length - 1; i++)
                    for (let j = i + 1; j < owners.length; j++)
                        if (connectorsConflict(owners[i]!, owners[j]!)) n++;
                return n;
            };
            let best = total();
            let improved = true;
            let iter = 0;
            while (best > 0 && improved && iter++ < 4)
            {
                improved = false;
                for (let i = 0; i < list.length - 1 && best > 0; i++)
                {
                    for (let j = i + 1; j < list.length && best > 0; j++)
                    {
                        [list[i], list[j]] = [list[j]!, list[i]!];
                        [owners[i], owners[j]] = [owners[j]!, owners[i]!];
                        this._fireSideRebalance(side);
                        const after = total();
                        if (after < best) { best = after; improved = true; }
                        else
                        {
                            [list[i], list[j]] = [list[j]!, list[i]!];
                            [owners[i], owners[j]] = [owners[j]!, owners[i]!];
                            this._fireSideRebalance(side);
                        }
                    }
                }
            }
        }
        finally
        {
            this._optimizing = false;
        }
    }
}

// ── Side-intersection crossing detection ─────────────────────────────────
// Reads only the connectors' resolved Geometry (via ISideAnchoredConnector),
// so it stays decoupled from the concrete Connector class.

// Two connectors "conflict" on a shared side when their routes cross
// transversally OR run collinearly on top of each other. Both are fixed by
// reordering the slots so the routes fan out cleanly.
function connectorsConflict(a: ISideAnchoredConnector, b: ISideAnchoredConnector): boolean
{
    return anySegmentPair(a, b, segmentsProperlyCross) || anySegmentPair(a, b, segmentsOverlap);
}

// Run `pred` over every (A-segment, B-segment) pair and short-circuit on the
// first hit. Both crossing and overlap walk the two polylines identically.
function anySegmentPair(
    a: ISideAnchoredConnector,
    b: ISideAnchoredConnector,
    pred: (ax: number, ay: number, bx: number, by: number,
           cx: number, cy: number, dx: number, dy: number) => boolean,
): boolean
{
    const polyA = polylineOf(a.Geometry);
    const polyB = polylineOf(b.Geometry);
    if (polyA.length < 2 || polyB.length < 2) return false;
    for (let i = 0; i < polyA.length - 1; i++)
    {
        for (let j = 0; j < polyB.length - 1; j++)
        {
            if (pred(
                polyA[i]!.x, polyA[i]!.y, polyA[i + 1]!.x, polyA[i + 1]!.y,
                polyB[j]!.x, polyB[j]!.y, polyB[j + 1]!.x, polyB[j + 1]!.y,
            )) return true;
        }
    }
    return false;
}

// Classic 2D "proper" segment-segment crossing — true iff the segments share a
// single point strictly interior to BOTH (no shared endpoint, no collinear
// overlap).
function segmentsProperlyCross(
    ax: number, ay: number, bx: number, by: number,
    cx: number, cy: number, dx: number, dy: number,
): boolean
{
    const o1 = orient(ax, ay, bx, by, cx, cy);
    const o2 = orient(ax, ay, bx, by, dx, dy);
    const o3 = orient(cx, cy, dx, dy, ax, ay);
    const o4 = orient(cx, cy, dx, dy, bx, by);
    return (o1 > 0) !== (o2 > 0)
        && (o3 > 0) !== (o4 > 0)
        && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number
{
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

// True iff AB and CD are COLLINEAR with a strictly-positive-length overlap
// (they paint over one another). Complements segmentsProperlyCross.
function segmentsOverlap(
    ax: number, ay: number, bx: number, by: number,
    cx: number, cy: number, dx: number, dy: number,
): boolean
{
    const EPS = 1e-6;
    const abx = bx - ax;
    const aby = by - ay;
    if (Math.abs(abx) < EPS && Math.abs(aby) < EPS) return false;
    if (Math.abs(dx - cx) < EPS && Math.abs(dy - cy) < EPS) return false;
    if (Math.abs(orient(ax, ay, bx, by, cx, cy)) > EPS) return false;
    if (Math.abs(orient(ax, ay, bx, by, dx, dy)) > EPS) return false;
    const useX = Math.abs(abx) >= Math.abs(aby);
    const a1 = useX ? ax : ay, b1 = useX ? bx : by;
    const c1 = useX ? cx : cy, d1 = useX ? dx : dy;
    const lo = Math.max(Math.min(a1, b1), Math.min(c1, d1));
    const hi = Math.min(Math.max(a1, b1), Math.max(c1, d1));
    return hi - lo > EPS;
}

// Extract a flat sequence of points from a PathGeometry. The orthogonal
// router emits one PathFigure with LineSegment children; bezier emits
// PathFigure with BezierSegment children (we treat the segment's anchor
// endpoint as the polyline vertex). The first/last points are the route's
// two anchors, which is all farAnchor needs.
function polylineOf(geo: Geometry | undefined): readonly { x: number; y: number }[]
{
    if (geo === undefined) return [];
    // Duck-type the PathGeometry interface — avoids importing the concrete
    // class while staying type-checked at use sites below.
    const pg = geo as unknown as Partial<PathGeometry>;
    if (pg.Figures === undefined) return [];
    const out: { x: number; y: number }[] = [];
    for (const fig of pg.Figures)
    {
        out.push({ x: fig.StartPoint.X, y: fig.StartPoint.Y });
        for (const seg of fig.Segments)
        {
            // LineSegment exposes .Point; BezierSegment exposes .Point3 (the
            // arc endpoint). Tolerate either via duck typing.
            const p = (seg as unknown as { Point?: { X: number; Y: number }; Point3?: { X: number; Y: number } });
            const tip = p.Point ?? p.Point3;
            if (tip !== undefined) out.push({ x: tip.X, y: tip.Y });
        }
    }
    return out;
}
