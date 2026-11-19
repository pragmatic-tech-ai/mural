// Layout-preview overlay data. A consumer (e.g. a layout inspector) computes a
// proposed arrangement WITHOUT committing it and publishes it on
// `Board.LayoutPreview`; the LayoutPreviewAdorner then paints an opaque
// preview of that arrangement over the live canvas — a faint block per node at
// its proposed rect, and a connector line per edge — so the user can compare
// before applying. Coordinates are in the board's CONTENT space (the same
// space as Figure.Left/Top); the adorner projects them through the camera.
export interface LayoutPreviewNode
{
    // The node's id, so edges can resolve their endpoints to node rects.
    readonly id:     string
    readonly left:   number
    readonly top:    number
    readonly width:  number
    readonly height: number
}

// A proposed connector, by the node ids it joins. The adorner draws a straight
// line between the two nodes' centres — enough to read the new structure.
export interface LayoutPreviewEdge
{
    readonly from: string
    readonly to:   string
}

// A full proposed arrangement. `undefined`/empty on the Board means no preview
// is active and the overlay is hidden.
export interface LayoutPreview
{
    readonly nodes: readonly LayoutPreviewNode[]
    readonly edges: readonly LayoutPreviewEdge[]
}
