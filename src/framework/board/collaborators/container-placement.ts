import { Panel } from '../../../runtime/index.js';
import { Point } from '../../../visual-engine/index.js';
import { boardSpaceRect, toParentSpace } from '../coordinate-space.js';
import { ContainerFigure, CONTAINER_PADDING } from '../container-figure.js';
import { Figure } from '../figure.js';
import type { Board } from '../board.js';

// Board-owned collaborator that turns each node's ParentId (membership tag)
// into visual-tree structure: a child Figure is re-parented OUT of the root
// items host and INTO its container's clipped ChildHost, keeping its board-
// space position (its stored Left/Top become parent-relative). Because children
// then are real visual descendants, move-together / clip / hit-test are free.
//
// Authoritative pass: placeAll() — enumerate realized nodes, register every
// ContainerFigure, then apply each node's ParentId. Called after load / mount
// and whenever a VM container binds (ContainerBound). reparent() is the
// imperative entry the drag and wrap/unwrap paths use. Deferred attach: a child
// whose container is not registered yet is queued and flushed when it registers,
// so record/realization order does not matter.
export class ContainerPlacement
{
    private readonly _board: Board;
    private readonly _containers = new Map<string, ContainerFigure>();   // id -> container
    private readonly _pending = new Map<string, Figure[]>();             // parentId -> children awaiting it
    private _rootHost: Panel | undefined;

    constructor(board: Board)
    {
        this._board = board;
        // VM content nodes (e.g. arch tiles) fire ContainerBound as they realize
        // with geometry seeded; re-run the pass so their nesting applies with the
        // right coordinates. Self-container Figures are handled by placeAll().
        board.AddContainerBoundListener(() => this.placeAll());
    }

    // RESTORE pass (load / mount): register every realized container, then link +
    // attach each node to its ParentId container WITHOUT moving it — a saved
    // node's Left/Top are already parent-relative, so no coordinate conversion.
    // Idempotent.
    public placeAll(): void
    {
        for (const node of this._realizedNodes()) this._register(node);
        for (const node of this._realizedNodes()) this._restore(node);
    }

    // MOVE reparent (drag-in/out, wrap/unwrap): change the node's frame while
    // preserving its on-screen (board-space) position — its Left/Top convert
    // from the current frame to the target's content frame (or to root).
    public reparent(node: Figure, parentId: string | undefined): void
    {
        const old = node.ParentId;                // container membership before the move
        const before = boardSpaceRect(node);    // current on-screen rect
        node.ParentId = parentId;
        if (parentId === undefined)
        {
            if (node.ContainerParent === undefined) return;   // already root — no membership change
            this._detach(node);
            node.ContainerParent = undefined;
            node.Left = before.X;
            node.Top  = before.Y;
            this._rootHost?.AddVisualChild(node);
            this._board._fireNodeReparented({ Node: node, OldParentId: old, NewParentId: undefined });
            return;
        }
        const target = this._containers.get(parentId);
        if (target === undefined) { this._queue(parentId, node); return; }
        if (target === node || this._isDescendant(target, node)) return;   // cycle guard
        if (node.ContainerParent === target) return;                       // already there
        const host = target.ChildHost;
        if (host === undefined) return;
        this._detach(node);
        node.ContainerParent = target;
        const local = toParentSpace(new Point(before.X, before.Y), target);
        node.Left = local.X;
        node.Top  = local.Y;
        host.AddVisualChild(node);
        this._growToFit(target, node);
        this._board._fireNodeReparented({ Node: node, OldParentId: old, NewParentId: parentId });
    }

    // Grow (never shrink) `container` so `child`'s just-placed local rect fits
    // inside the child region with CONTAINER_PADDING to spare. child.Left/Top are
    // already in container-local space at call time.
    private _growToFit(container: ContainerFigure, child: Figure): void
    {
        const needW = container.ContentOrigin.X + child.Left + child.Width  + CONTAINER_PADDING;
        const needH = container.ContentOrigin.Y + child.Top  + child.Height + CONTAINER_PADDING;
        if (needW > container.Width)  container.Width  = needW;
        if (needH > container.Height) container.Height = needH;
    }

    // Move every realized child of `container` out to the container's own parent
    // (or root), preserving each child's on-screen position (reparent = MOVE), then
    // forget the container. Used by unwrap and by container deletion so children are
    // never destroyed with their box (data-loss guard). No-op-safe if the container
    // has no realized children.
    public reHome(container: ContainerFigure): void
    {
        const kids: Figure[] = [];
        for (const n of this._realizedNodes()) if (n.ContainerParent === container) kids.push(n);
        for (const child of kids) this.reparent(child, container.ParentId);
        if (container.Id !== undefined) this._containers.delete(container.Id);
    }

    // The container that currently holds `point` (board-space), innermost first,
    // excluding `exclude` and any descendant of it (cycle guard). Used by drag-in.
    public containerAt(point: Point, exclude?: Figure): ContainerFigure | undefined
    {
        let best: ContainerFigure | undefined;
        for (const c of this._containers.values())
        {
            if (c === exclude || (exclude !== undefined && this._isDescendant(c, exclude))) continue;
            const r = boardSpaceRect(c);
            if (point.X < r.X || point.Y < r.Y || point.X > r.X + r.Width || point.Y > r.Y + r.Height) continue;
            // Innermost wins: prefer the deeper-nested container.
            if (best === undefined || this._isDescendant(c, best)) best = c;
        }
        return best;
    }

    // ── Drop-candidate highlight (drag affordance) ──────────────────────
    private _candidate: ContainerFigure | undefined;

    // Highlight the container the given board-space point would drop into
    // (innermost, excluding `exclude` + its descendants), clearing any prior
    // highlight. Called on each drag move.
    public highlightCandidate(point: Point, exclude: Figure): void
    {
        const next = this.containerAt(point, exclude);
        if (next === this._candidate) return;
        if (this._candidate !== undefined) this._candidate.IsDropCandidate = false;
        this._candidate = next;
        if (next !== undefined) next.IsDropCandidate = true;
    }

    // Drop any active candidate highlight (drag ended / cancelled).
    public clearCandidate(): void
    {
        if (this._candidate !== undefined) this._candidate.IsDropCandidate = false;
        this._candidate = undefined;
    }

    private _register(node: Figure): void
    {
        this._captureRootHost(node);
        if (!(node instanceof ContainerFigure) || node.Id === undefined) return;
        this._containers.set(node.Id, node);
        const waiting = this._pending.get(node.Id);
        if (waiting !== undefined)
        {
            this._pending.delete(node.Id);
            for (const child of waiting) this._restore(child);
        }
    }

    // Link + attach a node to its ParentId container using its already-correct
    // parent-relative coords (no conversion). Queues if the container is not
    // registered yet (record order irrelevant). A root node needs nothing —
    // it stays on the root host with root coords.
    private _restore(node: Figure): void
    {
        const parentId = node.ParentId;
        if (parentId === undefined) return;
        const target = this._containers.get(parentId);
        if (target === undefined) { this._queue(parentId, node); return; }
        if (target === node || this._isDescendant(target, node)) return;   // cycle guard
        if (node.ContainerParent === target) return;                       // already placed
        const host = target.ChildHost;
        if (host === undefined) return;
        this._detach(node);
        node.ContainerParent = target;
        host.AddVisualChild(node);   // coords kept as-is (already parent-relative)
    }

    private _detach(node: Figure): void
    {
        // Realized containers are VISUAL-only children of their host (the
        // ItemsControl uses AddVisualChild), so re-parent through the visual
        // tree, not the logical AddChild/RemoveChild path.
        const parent = node.GetVisualParent();
        if (parent instanceof Panel) parent.RemoveVisualChild(node);
    }

    private _queue(parentId: string, node: Figure): void
    {
        const arr = this._pending.get(parentId) ?? [];
        if (!arr.includes(node)) arr.push(node);
        this._pending.set(parentId, arr);
    }

    private _isDescendant(maybe: Figure, ancestor: Figure): boolean
    {
        for (let c = maybe.ContainerParent; c !== undefined; c = c.ContainerParent)
            if (c === ancestor) return true;
        return false;
    }

    // The root items host is the visual parent of a realized, un-nested node.
    private _captureRootHost(node: Figure): void
    {
        if (this._rootHost !== undefined || node.ContainerParent !== undefined) return;
        const p = node.GetVisualParent();
        if (p instanceof Panel) this._rootHost = p;
    }

    private *_realizedNodes(): Iterable<Figure>
    {
        const src = this._board.ItemsSource as { ToArray?: () => unknown[] } | undefined;
        for (const item of src?.ToArray?.() ?? [])
        {
            const container = item instanceof Figure
                ? item
                : this._board.Generator.ContainerFromItem(item);
            if (container instanceof Figure) yield container;
        }
    }
}
