import type { MuralBase } from '../../runtime/index.js';

// Rigid-translate handshake between the figure-drag mechanics (Figure
// owns the pointer gesture + the moving set) and the connector store
// (Board owns the Connectors collection). When a multi-selection
// drags, connectors INTERNAL to the selection — both endpoints' nodes in
// the moving set — should translate rigidly, preserving the user's
// hand-bent waypoints, instead of the per-figure reroute clearing them.
//
// Figure can't see the connector list (connectors live on the Board),
// and Board doesn't own the drag, so the two cooperate through this
// pair of interfaces. Figure resolves its enclosing Board and casts it
// to RigidConnectorDragHost (the cross-class-internals pattern — a named,
// greppable interface rather than bracket access), avoiding the
// board → figure import cycle that a direct type reference would add.
// Internal to mural; never part of the published surface.

export interface RigidConnectorDragSession
{
    /** Apply an INCREMENTAL drag delta (the net vector the figures moved
     *  this pointer-move). The session keeps a running total and re-lays
     *  each tracked connector's waypoints at snapshot + total, so repeated
     *  ticks never drift and the per-figure reroute that just cleared them
     *  is overwritten within the same synchronous tick (no flash). */
    Translate(dx: number, dy: number): void;

    /** End the gesture. Waypoints already sit at their final translated
     *  positions; this only drops the snapshot references. */
    End(): void;
}

export interface RigidConnectorDragHost
{
    /** Begin a rigid translation of `movingSet` (the figures a multi-drag
     *  is about to move together). Snapshots the internal connectors —
     *  both endpoints' nodes in the set — that carry user waypoints.
     *  Returns undefined when none qualify, so the caller can skip the
     *  per-tick translate entirely. */
    BeginRigidConnectorDrag(movingSet: ReadonlySet<MuralBase>): RigidConnectorDragSession | undefined;
}
