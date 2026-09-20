import { Point, Rect } from '../../visual-engine/index.js';

// A geometry-bearing diagram node for the coordinate walk. A container node also
// carries a ContentOrigin (the inset of its child host from its own top-left).
// Figure satisfies SpatialNode; ContainerFigure satisfies ContainerLike.
export interface SpatialNode
{
    readonly Left: number;
    readonly Top: number;
    readonly Width: number;
    readonly Height: number;
    readonly ContainerParent?: ContainerLike;
}

export interface ContainerLike extends SpatialNode
{
    readonly ContentOrigin: Point;
}

// The node's rect in absolute diagram-host space. Walks the container-ancestor
// chain: each container contributes its own diagram-space top-left plus its
// ContentOrigin (the inset of its child host). A root node (no ContainerParent)
// is simply (Left, Top, Width, Height). Because a nested node's Left/Top are
// stored parent-relative, this is what connectors and adorners must route on.
export function diagramSpaceRect(node: SpatialNode): Rect
{
    let x = node.Left;
    let y = node.Top;
    let container = node.ContainerParent;
    while (container !== undefined)
    {
        x += container.Left + container.ContentOrigin.X;
        y += container.Top + container.ContentOrigin.Y;
        container = container.ContainerParent;
    }
    return new Rect(x, y, node.Width, node.Height);
}

// Express a diagram-space point in `container`'s content space — the inverse of
// the per-level sum in diagramSpaceRect. Used when re-parenting a node into a
// container so its new parent-relative Left/Top keep it visually put.
export function toParentSpace(point: Point, container: ContainerLike): Point
{
    const origin = diagramSpaceRect(container); // the container's own diagram-space top-left
    return new Point(point.X - origin.X - container.ContentOrigin.X,
                     point.Y - origin.Y - container.ContentOrigin.Y);
}
