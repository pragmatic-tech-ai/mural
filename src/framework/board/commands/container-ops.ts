import type { MuralBase } from '../../../runtime/index.js';
import { Figure } from '../figure.js';
import { ContainerFigure, CONTAINER_PADDING, CONTAINER_TITLE_BAND } from '../container-figure.js';
import { boardSpaceRect } from '../coordinate-space.js';

// Wrap / Unwrap commands fire framework events on Board (consumer subscribes
// via Board.AddWrapRequestedListener / AddUnwrapRequestedListener), mirroring
// the Group / Ungroup shape in group-ops.ts. The consumer's BoardMutator turns
// the event into a document mutation (create / remove a ContainerFigure + claim /
// release its children). The helpers below are pure — no Board dependency — so
// the command's CanExecute gating and the wrap geometry are unit-testable.

// The board-space box a wrap will give its new container.
export interface ContainerBox { left: number; top: number; width: number; height: number; }

// Event args for the Board's WrapRequested / UnwrapRequested events.
// Wrap.Items: the top-level nodes to enclose. Unwrap.Containers: the containers
// to dissolve.
export interface WrapRequestedArgs   { readonly Items:      readonly MuralBase[]; }
export interface UnwrapRequestedArgs { readonly Containers: readonly MuralBase[]; }
export type WrapRequestedListener   = (args: WrapRequestedArgs)   => void;
export type UnwrapRequestedListener = (args: UnwrapRequestedArgs) => void;

// Fired by ContainerPlacement whenever a node's container membership changes
// (drag-nest, wrap, un-nest, re-home). A consumer that mirrors nesting to a
// model (e.g. the Plexus arch binding) subscribes to write the change back.
// OldParentId / NewParentId are the container node Ids before / after the move;
// undefined means "root" (no container).
export interface NodeReparentedArgs
{
    readonly Node:        Figure;
    readonly OldParentId: string | undefined;
    readonly NewParentId: string | undefined;
}
export type NodeReparentedListener = (args: NodeReparentedArgs) => void;

// The top-level Figures in a selection — the set a wrap encloses. A node already
// nested in a container (ContainerParent set) is skipped: wrapping re-parents a
// root node, and mixing frames would corrupt coordinates.
export function wrapTargets(items: readonly unknown[]): Figure[]
{
    const out: Figure[] = [];
    for (const it of items)
        if (it instanceof Figure && it.ContainerParent === undefined) out.push(it);
    return out;
}

// The ContainerFigures in a selection — the set an unwrap dissolves.
export function selectedContainers(items: readonly unknown[]): ContainerFigure[]
{
    const out: ContainerFigure[] = [];
    for (const it of items) if (it instanceof ContainerFigure) out.push(it);
    return out;
}

// A board-space box enclosing the union of the nodes, inset so each node sits
// CONTAINER_PADDING inside the child region (which itself begins at ContentOrigin
// = (CONTAINER_PADDING, CONTAINER_TITLE_BAND + CONTAINER_PADDING) below the title
// band). Pure geometry — the ContentOrigin inset is a constant, so no realized
// container is needed.
export function containerGeometryFor(nodes: readonly Figure[]): ContainerBox
{
    let minX = Number.POSITIVE_INFINITY, minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY;
    for (const n of nodes)
    {
        const r = boardSpaceRect(n);
        minX = Math.min(minX, r.X);            minY = Math.min(minY, r.Y);
        maxX = Math.max(maxX, r.X + r.Width);  maxY = Math.max(maxY, r.Y + r.Height);
    }
    const originX = CONTAINER_PADDING;
    const originY = CONTAINER_TITLE_BAND + CONTAINER_PADDING;
    return {
        left: minX - originX - CONTAINER_PADDING,
        top:  minY - originY - CONTAINER_PADDING,
        width:  (maxX - minX) + originX + 2 * CONTAINER_PADDING,
        height: (maxY - minY) + originY + 2 * CONTAINER_PADDING,
    };
}
