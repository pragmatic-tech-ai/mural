import { Panel } from '../../../runtime/index.js';
import { Figure } from '../figure.js';
import { NodeViewModel } from '../node-view-model.js';
import { PositionAnchor } from '../position-anchor.js';
import {
    deserializeBrush, deserializeStroke, isBrushVisible, serializeBrush, serializeStroke,
    type SerializedBrush, type StrokeFields,
} from './brush-serialization.js';

// A node's visual (geometry) record — the presentation half of the two-section
// serialization format, keyed by node id in the `visuals` section. The base
// four are always present; rotation / scale-baseline / size latches are omitted
// when at their defaults (rotation 0, base NaN, flags false) so the on-disk
// shape stays minimal.  StrokeFields contributes the optional card-outline
// keys (stroke / strokeWidth / strokeDash / strokeCap / strokeJoin / strokeMiter).
export interface NodeVisual extends StrokeFields
{
    left: number;
    top:  number;
    w:    number;
    h:    number;
    rotation?:      number;
    baseWidth?:     number;
    baseHeight?:    number;
    sizeToContent?: boolean;
    userSized?:     boolean;
    // Per-shape Size & Position editor intents (omit-when-default, so old files
    // load unchanged): lock aspect ratio, and the "From" position anchor.
    lockAspect?:    boolean;
    anchor?:        PositionAnchor;
    // Paint z-order (Panel.ZIndex). Omitted when 0 so old files and un-reordered
    // figures serialize unchanged.
    zIndex?:        number;
    // A content tile's optional background-card style (Format Shape), through the
    // shared brush codec — every fill variant, not just solids. Geometric shapes
    // persist their fill/stroke in the node record instead, so these ride the
    // `visuals` section only for content tiles (VM hosts — plain OR container);
    // an unstyled (invisible) card omits them.
    fill?:          SerializedBrush;
    // Container membership: the id of the ContainerFigure this node nests in
    // (omitted when a root node). Its Left/Top are then parent-relative.
    parentId?:      string;
}

// Document-owned `id → NodeVisual` map: the serialization boundary between a
// node's content (its serializer's `data`) and its geometry. `_serialize`
// populates it from the Figure nodes and snapshots it into the `visuals`
// section; `_deserialize` seeds it and applies each record onto the freshly
// built node. (Slice #3 adds live container write-back; serialize/deserialize
// keep talking to this store unchanged.)
export class NodeVisualStore
{
    private readonly _map = new Map<string, NodeVisual>();

    public Get(id: string): NodeVisual | undefined { return this._map.get(id); }
    public Set(id: string, v: NodeVisual): void { this._map.set(id, v); }
    public Remove(id: string): void { this._map.delete(id); }
    public Clear(): void { this._map.clear(); }

    /** Seed from a parsed `visuals` section (load). */
    public Seed(map: Record<string, NodeVisual>): void
    {
        this._map.clear();
        for (const id of Object.keys(map)) this._map.set(id, { ...map[id]! });
    }

    /** Snapshot the map into a plain object for the `visuals` section (save). */
    public Snapshot(): Record<string, NodeVisual>
    {
        const out: Record<string, NodeVisual> = {};
        for (const [id, v] of this._map) out[id] = { ...v };
        return out;
    }

    /** Build a record from a node's live geometry (omit-when-default). */
    public Read(node: Figure): NodeVisual
    {
        const v: NodeVisual = { left: node.Left, top: node.Top, w: node.Width, h: node.Height };
        if (node.Rotation !== 0)             v.rotation      = node.Rotation;
        if (!Number.isNaN(node.BaseWidth))   v.baseWidth     = node.BaseWidth;
        if (!Number.isNaN(node.BaseHeight))  v.baseHeight    = node.BaseHeight;
        if (node.SizeToContent)              v.sizeToContent = true;
        if (node.UserSized)                  v.userSized     = true;
        if (node.LockAspectRatio)            v.lockAspect    = true;
        if (node.PositionFrom !== PositionAnchor.TopLeftCorner) v.anchor = node.PositionFrom;
        const z = Panel.GetZIndex(node);
        if (z !== 0) v.zIndex = z;
        if (node.ParentId !== undefined) v.parentId = node.ParentId;
        // Card style — content tiles only (a geometric shape's fill/stroke rides
        // its node record instead). Keyed on being a VM host, NOT SizeToContent: a
        // CONTAINER content tile (ContentContainerFigure) sizes to its children, so
        // SizeToContent is false, yet its card fill/stroke still belong here. Omit a
        // transparent (unstyled) card.
        if (node.Content instanceof NodeViewModel)
        {
            if (isBrushVisible(node.Fill)) v.fill = serializeBrush(node.Fill);
            if (node.Stroke !== undefined && isBrushVisible(node.Stroke.Brush))
            {
                Object.assign(v, serializeStroke(node.Stroke));
            }
        }
        return v;
    }

    /** Apply a record onto a node's geometry (load). */
    public Apply(v: NodeVisual, node: Figure): void
    {
        node.Left   = v.left;
        node.Top    = v.top;
        node.Width  = v.w;
        node.Height = v.h;
        if (v.rotation      !== undefined) node.Rotation      = v.rotation;
        if (v.baseWidth     !== undefined) node.BaseWidth     = v.baseWidth;
        if (v.baseHeight    !== undefined) node.BaseHeight    = v.baseHeight;
        if (v.sizeToContent !== undefined) node.SizeToContent = v.sizeToContent;
        if (v.userSized     !== undefined) node.UserSized     = v.userSized;
        if (v.lockAspect    !== undefined) node.LockAspectRatio = v.lockAspect;
        if (v.anchor        !== undefined) node.PositionFrom    = v.anchor;
        if (v.zIndex        !== undefined) Panel.SetZIndex(node, v.zIndex);
        if (v.parentId      !== undefined) node.ParentId        = v.parentId;
        // Restore a content tile's card style (Apply runs after bindContainer's
        // transparent defaults, so a styled card overrides them).
        if ('fill' in v)   node.Fill = deserializeBrush(v.fill);
        const pen = deserializeStroke(v);
        if (pen !== undefined) node.Stroke = pen;
    }
}
