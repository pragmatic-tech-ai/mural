import { Point } from '../../../visual-engine/index.js';
import type { Connector } from '../connector.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';
import type { Figure } from '../figure.js';
import { type PortSide, type ResolvedPortSide } from '../port.js';
import { ConnectorEnd } from '../routing/router.js';
import { BoardSettings } from '../board-settings.js';
import { itemOf } from './connector-create-behavior.js';
import { type RouteWaypoint, waypoint, routePoints } from '../route-waypoint.js';

// Snapshot of a ConnectorEndpoint's 5 DPs taken at the start of a
// drag, so an aborted gesture (PointerUp over empty space) can
// restore the endpoint exactly as it was before the drag began.
interface EndpointSnapshot
{
    Node:      MuralBase | undefined;
    PortName:  string | undefined;
    PortSide:  PortSide | undefined;
    PortIndex: number | undefined;
    FreePoint: Point | undefined;
}

// Forwards into the runtime's MuralBase type without dragging an import
// (this file's only contact with MuralBase is through the endpoint).
type MuralBase = ConnectorEndpoint['Node'];

type DragState =
    | { readonly kind: 'idle' }
    | { readonly kind: 'endpoint'; readonly connector: Connector; readonly end: ConnectorEnd; readonly snapshot: EndpointSnapshot }
    | { readonly kind: 'waypoint'; readonly connector: Connector; readonly index: number; readonly snapshot: readonly RouteWaypoint[] }
    // Mid-segment drag: a segment of the RENDERED route (including the
    // L/Z corners an Orthogonal route computes from zero user waypoints)
    // moves as a rigid bar PERPENDICULAR to itself — a horizontal segment
    // up/down, a vertical one left/right. BeginSegmentDrag materializes
    // the route into Waypoints and (for a port-adjacent segment) inserts a
    // fixed jog anchor, leaving exactly two MOVING waypoints that bound the
    // grabbed segment. `moveA`/`moveB` are their indices in Waypoints;
    // `keepA`/`keepB` are their constrained-axis coordinate (X for a
    // horizontal segment, Y for a vertical one) held constant while the
    // free axis tracks the cursor.
    | {
          readonly kind: 'segment';
          readonly connector: Connector;
          readonly horizontal: boolean;
          readonly moveA: number;
          readonly moveB: number;
          readonly keepA: number;
          readonly keepB: number;
          readonly snapshot: readonly RouteWaypoint[];
      }
    // Port-slot reorder: dragging the segment that LEAVES a side-anchored
    // port slides the connector among its siblings on that port. No
    // waypoints — the slot index follows the cursor and the figure
    // rebalances. `slots` holds the affected end(s) (a straight port-to-
    // port segment touches both) with their pre-drag index for Abort.
    | {
          readonly kind: 'portreorder';
          readonly connector: Connector;
          readonly slots: readonly { readonly end: ConnectorEnd; readonly fromIndex: number }[];
      };

// State machine for edit-mode connector gestures per § 4.2 + § 4.3 of
// [docs/connectors.md](../../../../docs/connectors.md).
// Visual rendering of the handles (endpoint dots + waypoint dots +
// mid-segment ghosts) lives in a follow-up; the state machine here is
// what the visual layer's pointer handlers call into.
//
// Endpoint re-anchor (§ 4.2):
//   BeginEndpointDrag(c, end, cursor) — snapshots the endpoint, clears
//     its port-ref fields, sets FreePoint = cursor. The connector
//     immediately re-routes to follow the cursor at that end.
//   UpdateCursor(cursor) — flows into FreePoint.
//   EndDragOverTarget(figure, port) — sets Node = figure, clears
//     FreePoint, writes PortName when port has a Name (anonymous /
//     no-port-hit fall through to path-4 auto-pick).
//   EndDragOverEmpty()   — restores the endpoint from snapshot.
//
// Waypoint editing (§ 4.3):
//   BeginWaypointDrag(c, index) — snapshots the Waypoints array.
//   InsertWaypointAndDrag(c, index, point) — inserts at index then
//     enters waypoint drag at that index (the dragged waypoint is the
//     just-inserted one; abort removes it).
//   UpdateCursor(cursor)   — moves the dragged waypoint.
//   EndDragOverEmpty()     — commits the current position (waypoint
//     drags have no "target" notion; PointerUp anywhere ends the drag
//     at the last cursor).
//   RemoveWaypoint(c, index) — imperative removal (the right-click
//     handler + Backspace path both call into this).
//
// Abort() is shared by both modes: restore from snapshot.
export class ConnectorEditAdorner
{
    private _state: DragState = { kind: 'idle' };

    public get IsActive(): boolean { return this._state.kind !== 'idle'; }

    /** The connector the in-flight gesture targets, or undefined when
     *  idle. Lets the owner abort a drag whose connector was deleted
     *  out from under it. */
    public get ActiveConnector(): Connector | undefined
    {
        return this._state.kind === 'idle' ? undefined : this._state.connector;
    }

    public BeginEndpointDrag(connector: Connector, end: ConnectorEnd, cursor: Point): void
    {
        if (this._state.kind !== 'idle') this.Abort();
        const ep = endpointOf(connector, end);
        if (ep === undefined) return;
        const snapshot: EndpointSnapshot = {
            Node:      ep.Node,
            PortName:  ep.PortName,
            PortSide:  ep.PortSide,
            PortIndex: ep.PortIndex,
            FreePoint: ep.FreePoint,
        };
        // § 4.2: PointerDown clears the node/port refs and re-anchors the end
        // to the cursor. Node is cleared BEFORE FreePoint is set: the recompute
        // invariant clears a FreePoint written while a Node is still present
        // (it's vestigial then), so the free anchor must be set only once Node
        // is gone. The one-recompute node-less window in between is hidden by
        // the connector's unanchored guard (no origin flash).
        ep.Node      = undefined;
        ep.PortName  = undefined;
        ep.PortSide  = undefined;
        ep.PortIndex = undefined;
        ep.FreePoint = cursor;
        this._state = { kind: 'endpoint', connector, end, snapshot };
    }

    public BeginWaypointDrag(connector: Connector, waypointIndex: number): void
    {
        if (this._state.kind !== 'idle') this.Abort();
        const wps = connector.Waypoints;
        if (wps === undefined || waypointIndex < 0 || waypointIndex >= wps.length) return;
        this._state = {
            kind: 'waypoint', connector, index: waypointIndex, snapshot: wps.slice(),
        };
    }

    /** Begin dragging segment `segmentIndex` of the connector's RENDERED
     *  route (`CurrentRoutePoints`: source → bends → target). The segment
     *  translates perpendicular to its own orientation — horizontal
     *  up/down, vertical left/right — staying axis-aligned. Orientation is
     *  locked at grab time so a near-degenerate drag can't flip it.
     *
     *  The route's bends usually aren't user Waypoints (an Orthogonal
     *  route computes its L/Z corners internally from zero waypoints), so
     *  the gesture first MATERIALIZES the route's interior corners into
     *  Waypoints — shape-preserving, because the router reproduces corners
     *  that sit on the port outward rays. A segment touching a pinned port
     *  (source / target) can't translate rigidly on its own, so a fixed
     *  jog anchor plus a coincident moving waypoint are inserted a stub in
     *  from that port: the anchor keeps the port's outward leg while the
     *  moving end and the jog between them follow the cursor. The result
     *  is always two moving waypoints bounding the grabbed segment. */
    public BeginSegmentDrag(connector: Connector, segmentIndex: number): void
    {
        if (this._state.kind !== 'idle') this.Abort();
        const route = connector.CurrentRoutePoints;
        if (route === undefined || segmentIndex < 0 || segmentIndex + 1 >= route.length) return;

        const i = segmentIndex;
        const n = route.length - 1;          // route[n] === target anchor

        // Position-based port-slot reorder takes precedence over the
        // waypoint slide when the grabbed segment leaves a side-anchored
        // port: that segment runs perpendicular to the port's slot axis,
        // so dragging it reorders the connector among its siblings instead
        // of bending the route. A straight port-to-port segment (single
        // segment, both ends anchored) reorders both ends together.
        const reorderSlots: { end: ConnectorEnd; fromIndex: number }[] = [];
        if (i === 0 && connector.IsPortAnchored(ConnectorEnd.Source))
        {
            reorderSlots.push({ end: ConnectorEnd.Source, fromIndex: connector.GetPortSlotIndex(ConnectorEnd.Source) ?? 0 });
        }
        if (i + 1 === n && connector.IsPortAnchored(ConnectorEnd.Target))
        {
            reorderSlots.push({ end: ConnectorEnd.Target, fromIndex: connector.GetPortSlotIndex(ConnectorEnd.Target) ?? 0 });
        }
        if (reorderSlots.length > 0)
        {
            this._state = { kind: 'portreorder', connector, slots: reorderSlots };
            return;
        }

        const near = route[i]!;
        const far  = route[i + 1]!;
        const horizontal = segmentIsHorizontal(near, far);
        const snapshot = (connector.Waypoints ?? []).slice();
        const priors   = priorPinsOf(connector);   // pins to carry through the materialise

        const sourcePinned = i === 0;
        const targetPinned = i + 1 === n;

        // Jog anchor offset from a pinned port. Kept past the router's own
        // port stub so the port→anchor leg collapses to a straight run
        // instead of provoking an extra router bend; clamped to half the
        // segment so the anchor stays inside it (short segments get a
        // proportionally smaller, still-valid jog).
        const segLen = horizontal ? Math.abs(far.X - near.X) : Math.abs(far.Y - near.Y);
        const stub = segJogStub();
        const jog = segLen > 2 * stub ? stub + jogMargin() : segLen / 2;

        // Interior corners strictly outside the grabbed segment carry over
        // unchanged (route[1..i-1] on the left, route[i+2..n-1] on the right).
        const next: Point[] = route.slice(1, i);

        let moveA: number;
        let moveB: number;

        if (sourcePinned)
        {
            const anchor = pointAlong(near, far, jog, horizontal);
            next.push(anchor);                 // fixed jog anchor
            next.push(anchor);                 // moving near end (coincident at start)
            moveA = next.length - 1;
        }
        else
        {
            next.push(near);                   // real corner → moves directly
            moveA = next.length - 1;
        }

        if (targetPinned)
        {
            const anchor = pointAlong(far, near, jog, horizontal);
            next.push(anchor);                 // moving far end (coincident at start)
            moveB = next.length - 1;
            next.push(anchor);                 // fixed jog anchor
        }
        else
        {
            next.push(far);                    // real corner → moves directly
            moveB = next.length - 1;
        }

        next.push(...route.slice(i + 2, n));

        const keepA = horizontal ? next[moveA]!.X : next[moveA]!.Y;
        const keepB = horizontal ? next[moveB]!.X : next[moveB]!.Y;

        connector.Waypoints = tag(next, priors, new Set([moveA, moveB]));
        this._state = { kind: 'segment', connector, horizontal, moveA, moveB, keepA, keepB, snapshot };
    }

    public InsertWaypointAndDrag(connector: Connector, insertIndex: number, point: Point): void
    {
        if (this._state.kind !== 'idle') this.Abort();
        const wps = connector.Waypoints ?? [];
        // Snapshot first — the array BEFORE the insertion. Abort
        // restores by overwriting with the snapshot, which doesn't
        // contain the new waypoint.
        const snapshot = wps.slice();
        const priors = priorPinsOf(connector);
        const pts = routePoints(wps);
        const next: Point[] = [...pts.slice(0, insertIndex), point, ...pts.slice(insertIndex)];
        connector.Waypoints = tag(next, priors, new Set([insertIndex]));   // the inserted point is user intent → pinned
        this._state = { kind: 'waypoint', connector, index: insertIndex, snapshot };
    }

    public UpdateCursor(cursor: Point): void
    {
        if (this._state.kind === 'portreorder')
        {
            for (const s of this._state.slots) this._state.connector.ReorderPortSlot(s.end, cursor);
            return;
        }
        if (this._state.kind === 'endpoint')
        {
            const ep = endpointOf(this._state.connector, this._state.end);
            if (ep !== undefined) ep.FreePoint = cursor;
            return;
        }
        if (this._state.kind === 'waypoint')
        {
            const conn = this._state.connector;
            const next: Point[] = routePoints(conn.Waypoints).slice();
            next[this._state.index] = cursor;
            conn.Waypoints = tag(next, priorPinsOf(conn), new Set([this._state.index]));   // the dragged waypoint is pinned
            return;
        }
        if (this._state.kind === 'segment')
        {
            const { connector, horizontal, moveA, moveB, keepA, keepB } = this._state;
            const next: Point[] = routePoints(connector.Waypoints).slice();
            if (moveA >= next.length || moveB >= next.length) return;
            // Perpendicular translation: the two moving waypoints hold
            // their constrained-axis coordinate (keepA / keepB) and snap
            // their free axis to the cursor. Any fixed jog anchor inserted
            // at a pinned port is left untouched, so it keeps the port's
            // outward leg while the grabbed segment slides.
            if (horizontal)
            {
                next[moveA] = new Point(keepA, cursor.Y);
                next[moveB] = new Point(keepB, cursor.Y);
            }
            else
            {
                next[moveA] = new Point(cursor.X, keepA);
                next[moveB] = new Point(cursor.X, keepB);
            }
            connector.Waypoints = tag(next, priorPinsOf(connector), new Set([moveA, moveB]));
        }
    }

    public EndDragOverTarget(targetFigure: Figure, targetSide: ResolvedPortSide): void
    {
        if (this._state.kind === 'portreorder')
        {
            // Slot already committed during the drag — nothing to re-anchor.
            this._state = { kind: 'idle' };
            return;
        }
        if (this._state.kind !== 'endpoint') return;
        const ep = endpointOf(this._state.connector, this._state.end);
        if (ep === undefined)
        {
            this._state = { kind: 'idle' };
            return;
        }
        // A missing target must NEVER leave the endpoint node-less. Restore the
        // pre-drag anchor instead — identical to releasing over empty space.
        if (targetFigure === undefined || targetFigure === null)
        {
            applyEndpointSnapshot(ep, this._state.snapshot);
            this._state = { kind: 'idle' };
            return;
        }
        // Assign the node/side FIRST, THEN clear the transient free/port refs.
        // Each DP write re-routes synchronously; clearing FreePoint before Node
        // is set would route through a node-less state (→ origin). With Node set
        // first, FreePoint is already ignored by resolution, so its clear is safe.
        //
        // Bind to the container Figure — the sole geometry owner + side-endpoint
        // host. This is what the CREATE path does (makeSideEndpoint → itemOf). A
        // created endpoint and a repositioned one must reference the same object,
        // else they land on different side registries and stack at the side
        // centre instead of fanning.
        ep.Node      = itemOf(targetFigure);
        ep.PortSide  = targetSide;
        ep.PortName  = undefined;
        ep.PortIndex = undefined;
        ep.FreePoint = undefined;
        this._state = { kind: 'idle' };
    }

    public EndDragOverEmpty(): void
    {
        if (this._state.kind === 'portreorder')
        {
            // Commit: the slot was reassigned live during the drag.
            this._state = { kind: 'idle' };
            return;
        }
        if (this._state.kind === 'endpoint')
        {
            // Restore snapshot.
            const ep = endpointOf(this._state.connector, this._state.end);
            if (ep !== undefined) applyEndpointSnapshot(ep, this._state.snapshot);
            this._state = { kind: 'idle' };
            return;
        }
        if (this._state.kind === 'waypoint')
        {
            // Commit: the waypoint stays at its last position.
            this._state = { kind: 'idle' };
            return;
        }
        if (this._state.kind === 'segment')
        {
            // Commit. Drop any coincident waypoints — a grab released with
            // no (or a degenerate) move leaves the jog anchor and its
            // moving twin on the same point; collapsing them keeps the
            // Waypoints list minimal (and undoes a no-op materialize).
            const wps = this._state.connector.Waypoints;
            if (wps !== undefined) this._state.connector.Waypoints = dedupeAdjacent(wps);
            this._state = { kind: 'idle' };
        }
    }

    public Abort(): void
    {
        if (this._state.kind === 'endpoint')
        {
            const ep = endpointOf(this._state.connector, this._state.end);
            if (ep !== undefined) applyEndpointSnapshot(ep, this._state.snapshot);
        }
        else if (this._state.kind === 'waypoint' || this._state.kind === 'segment')
        {
            this._state.connector.Waypoints = this._state.snapshot;
        }
        else if (this._state.kind === 'portreorder')
        {
            for (const s of this._state.slots) this._state.connector.MovePortSlotToIndex(s.end, s.fromIndex);
        }
        this._state = { kind: 'idle' };
    }

    public RemoveWaypoint(connector: Connector, waypointIndex: number): void
    {
        const wps = connector.Waypoints;
        if (wps === undefined || waypointIndex < 0 || waypointIndex >= wps.length) return;
        connector.Waypoints = wps.filter((_, i) => i !== waypointIndex);
    }
}

// A segment counts as horizontal when it spans more along X than Y — for a
// clean orthogonal route that's exact (dy === 0), and the dominant-axis
// tie-break keeps a near-axis-aligned segment from picking the wrong drag
// direction. Equal spans (including a degenerate zero-length segment)
// resolve to horizontal. Shared with the adorner's handle placement +
// cursor so the visual and the gesture always agree on orientation.
export function segmentIsHorizontal(a: Point, b: Point): boolean
{
    return Math.abs(b.X - a.X) >= Math.abs(b.Y - a.Y);
}

// Mirrors the Orthogonal router's port stub. A jog anchor inserted at a pinned
// port must sit at least this far out so the port→anchor leg stays collinear
// with the router's own stub and collapses cleanly instead of provoking an
// extra bend. Plus a small margin past the stub for the same reason. Both read
// live from settings (defaults 20 / 6).
const segJogStub = (): number => BoardSettings.ConnectorSegmentJogStub();
const jogMargin  = (): number => BoardSettings.ConnectorJogMargin();

// A point `dist` from `from` toward `to` along their shared axis. The
// segment is axis-aligned, so only the dominant (segment) axis advances;
// the other coordinate is taken from `from`.
function pointAlong(from: Point, to: Point, dist: number, horizontal: boolean): Point
{
    if (horizontal) return new Point(from.X + Math.sign(to.X - from.X) * dist, from.Y);
    return new Point(from.X, from.Y + Math.sign(to.Y - from.Y) * dist);
}

// Collapse runs of identical adjacent waypoints to one. Used on segment-drag
// commit to shed the coincident jog anchor + moving twin a no-op drag leaves
// behind. When two coincide, a pin wins so a user pin is never dropped.
function dedupeAdjacent(pts: readonly RouteWaypoint[]): RouteWaypoint[]
{
    const out: RouteWaypoint[] = [];
    for (const p of pts)
    {
        const prev = out[out.length - 1];
        if (prev !== undefined && prev.point.X === p.point.X && prev.point.Y === p.point.Y)
        {
            if (p.userAltered && !prev.userAltered) out[out.length - 1] = p;   // pin wins
            continue;
        }
        out.push(p);
    }
    return out;
}

// Sub-pixel coincidence — the primitives Point has no approximate equality.
const COINCIDE_EPS = 0.5;
function coincides(a: Point, b: Point): boolean
{
    return Math.abs(a.X - b.X) < COINCIDE_EPS && Math.abs(a.Y - b.Y) < COINCIDE_EPS;
}

// The absolute points of a connector's currently-pinned waypoints.
function priorPinsOf(c: Connector): readonly Point[]
{
    return (c.Waypoints ?? []).filter(w => w.userAltered).map(w => w.point);
}

// Rebuild a RouteWaypoint[] from bare geometry points: a point is PINNED if its
// index is in `forcePinned` (the vertices the user is dragging) OR it coincides
// with an existing pin. Everything else is AUTO. This preserves user pins across
// the segment-drag materialise-from-rendered-route while flagging exactly what
// the user moved.
function tag(points: readonly Point[], priorPins: readonly Point[], forcePinned: ReadonlySet<number>): RouteWaypoint[]
{
    return points.map((p, i) => waypoint(p, forcePinned.has(i) || priorPins.some(q => coincides(p, q))));
}

function endpointOf(c: Connector, end: ConnectorEnd): ConnectorEndpoint | undefined
{
    return end === ConnectorEnd.Source ? c.Source : c.Target;
}

function applyEndpointSnapshot(ep: ConnectorEndpoint, s: EndpointSnapshot): void
{
    ep.Node      = s.Node;
    ep.PortName  = s.PortName;
    ep.PortSide  = s.PortSide;
    ep.PortIndex = s.PortIndex;
    ep.FreePoint = s.FreePoint;
}

export function attachConnectorEditAdorner(): { adorner: ConnectorEditAdorner; detach: () => void }
{
    const adorner = new ConnectorEditAdorner();
    return {
        adorner,
        detach: (): void => adorner.Abort(),
    };
}
