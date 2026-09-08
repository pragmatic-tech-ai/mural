// Built-in node serializer registrations.
//
// This module registers the three default NodeSerializer implementations —
// 'shape' (self-painting Figure), 'text' (TextNode), 'callout' (Callout) —
// as side effects on import.  diagram-document.ts imports this module once for its
// side effects so the registry is populated before any Save/Load call.
//
// Cycle-avoidance: this module imports FROM the concrete classes (Figure,
// TextNode, Callout) and FROM node-serialization (registry).  It does NOT
// import from diagram-document, so there is no cycle.  diagram-document.ts
// imports this module and may also import individual helpers exported here
// (serializeShapeText, applySerializedText).

import { type Brush, FontStyle, FontWeight, pathGeometryFromSvgD, pathGeometryToSvgD, type Pen, TextAlignment, VerticalAlignment } from '../../../visual-engine/index.js';
import { Point } from '../../../runtime/index.js';
import { DiagramSettings } from '../diagram-settings.js';
import { TextAutoFit, TextPlacement, type ShapeText } from '../shape-text.js';
import {
    deserializeFlowDocument,
    serializeFlowDocument,
    type SerializedDoc,
} from './shape-text-document.js';
import { Figure } from '../figure.js';
import { TextNode } from '../text-node.js';
import { Callout } from '../callout.js';
import { ContainerFigure } from '../container-figure.js';
import { SHAPE_CATALOG_MAP } from '../shape-catalog.js';
import { registerNodeSerializer } from './node-serialization.js';
import {
    deserializeBrush, deserializeStroke, serializeBrush, serializeStroke,
    type SerializedBrush, type StrokeFields,
} from './brush-serialization.js';

// A node whose interior + outline the Format Shape pane edits. Shape and
// container Figures share this fill/stroke surface, so they share one codec.
interface Paintable { Fill: Brush | undefined; Stroke: Pen | undefined; }

// Write a node's Fill (every brush variant; null = the explicit "None") plus
// its Pen stroke (brush + width + dash/caps/join/miter) into a record. Fill is
// always written so a user's "None" round-trips; a shape's constructed default
// is a real brush and re-serialises unchanged.
function writeFillStroke(out: Record<string, unknown>, node: Paintable): void
{
    out.fill = serializeBrush(node.Fill);
    Object.assign(out, serializeStroke(node.Stroke));
}

// Restore Fill / Stroke over a node's constructed defaults. Only a field the
// record actually carries is touched: `fill` absent → keep the default;
// `fill: null` → explicit None (undefined); otherwise the decoded brush.
function readFillStroke(data: Record<string, unknown>, node: Paintable): void
{
    if ('fill' in data) node.Fill = deserializeBrush(data.fill as SerializedBrush);
    const pen = deserializeStroke(data as StrokeFields);
    if (pen !== undefined) node.Stroke = pen;
}

// ── SerializedText — internal type shared between text + callout ──────

export interface SerializedText
{
    readonly content:     string;
    readonly fontSize?:   number;
    readonly fontWeight?: FontWeight;
    readonly fontStyle?:  FontStyle;
    readonly align?:      TextAlignment;
    readonly offsetX?:    number;
    readonly offsetY?:    number;
    readonly angle?:      number;
    readonly placement?:  TextPlacement;
    readonly blockW?:     number;
    readonly blockH?:     number;
    readonly vAlign?:     VerticalAlignment;
    readonly autofit?:    TextAutoFit;
    readonly color?:      SerializedBrush;   // Foreground; omitted at the theme default
    readonly family?:     string;            // FontFamily source (CSS stack)
    readonly doc?:        SerializedDoc;
}

// ── Shared text-serialization helpers ────────────────────────────────
//
// These were private to diagram-document.ts; now exported here so that
// diagram-document.ts can import them back (avoiding code duplication).

/** Snapshot a ShapeText, returning undefined when there is nothing to save. */
export function serializeShapeText(st: ShapeText): SerializedText | undefined
{
    if (st.Content.length === 0 && st.Document === undefined) return undefined;
    const out: {
        content: string; fontSize?: number;
        fontWeight?: FontWeight; fontStyle?: FontStyle; align?: TextAlignment;
        offsetX?: number; offsetY?: number; angle?: number; placement?: TextPlacement;
        blockW?: number; blockH?: number; vAlign?: VerticalAlignment;
        autofit?: TextAutoFit; color?: SerializedBrush; family?: string; doc?: SerializedDoc;
    } = { content: st.Content };
    if (st.Document !== undefined)         out.doc        = serializeFlowDocument(st.Document);
    if (st.AutoFit !== TextAutoFit.None)   out.autofit    = st.AutoFit;
    if (st.FontSize      !== 12)                    out.fontSize   = st.FontSize;
    if (st.FontWeight    !== FontWeight.Normal)     out.fontWeight = st.FontWeight;
    if (st.FontStyle     !== FontStyle.Normal)      out.fontStyle  = st.FontStyle;
    if (st.TextAlignment !== TextAlignment.Center)  out.align      = st.TextAlignment;
    if (st.Offset.X !== 0)                          out.offsetX    = st.Offset.X;
    if (st.Offset.Y !== 0)                          out.offsetY    = st.Offset.Y;
    if (st.Angle !== 0)                             out.angle      = st.Angle;
    if (st.Placement !== TextPlacement.Center)      out.placement  = st.Placement;
    if (!Number.isNaN(st.BlockWidth))               out.blockW     = st.BlockWidth;
    if (!Number.isNaN(st.BlockHeight))              out.blockH     = st.BlockHeight;
    if (st.VerticalTextAlignment !== VerticalAlignment.Center) out.vAlign = st.VerticalTextAlignment;
    // Text colour — omit when it still matches the theme default ink so an
    // untouched label stays theme-reactive; a user colour is captured.
    const fg = st.Foreground;
    if (fg !== undefined)
    {
        const hex   = serializeBrush(fg);
        const dflt  = serializeBrush(DiagramSettings.ShapeLabelInk());
        if (JSON.stringify(hex) !== JSON.stringify(dflt)) out.color = hex;
    }
    // Font family — omit when unset (inherits). Store the full CSS stack.
    const fam = st.FontFamily;
    if (fam !== undefined) out.family = typeof fam === 'string' ? fam : fam.Source;
    return out;
}

/** Hydrate a ShapeText from its snapshot. */
export function applySerializedText(st: ShapeText, data: SerializedText): void
{
    st.Content = data.content;
    if (data.fontSize   !== undefined) st.FontSize      = data.fontSize;
    if (data.fontWeight !== undefined) st.FontWeight    = data.fontWeight;
    if (data.fontStyle  !== undefined) st.FontStyle     = data.fontStyle;
    if (data.align      !== undefined) st.TextAlignment = data.align;
    if (data.offsetX !== undefined || data.offsetY !== undefined)
    {
        st.Offset = new Point(data.offsetX ?? 0, data.offsetY ?? 0);
    }
    if (data.angle     !== undefined) st.Angle                 = data.angle;
    if (data.placement !== undefined) st.Placement             = data.placement;
    if (data.blockW    !== undefined) st.BlockWidth            = data.blockW;
    if (data.blockH    !== undefined) st.BlockHeight           = data.blockH;
    if (data.vAlign    !== undefined) st.VerticalTextAlignment = data.vAlign;
    if (data.autofit   !== undefined) st.AutoFit               = data.autofit;
    if (data.color     !== undefined) st.Foreground            = deserializeBrush(data.color);
    if (data.family    !== undefined) st.FontFamily            = data.family;
    if (data.doc       !== undefined) st.Document              = deserializeFlowDocument(data.doc);
}

// ── 'shape' serializer (self-painting Figure) ────────────────────────
//
// Serializers are geometry-free: `serialize` returns content only, `deserialize`
// builds the node at the origin. Geometry (position / size / rotation / scale
// baseline) lives in the `visuals` section and is applied by
// DiagramDocument._deserialize via the NodeVisualStore; the document also
// assigns Id.

registerNodeSerializer({
    type: 'shape',

    // A Figure in doc.Nodes is always a self-painting geometric shape node —
    // container Figures that wrap a content VM are transient and never enter
    // Nodes. Guard on a silhouette source as belt-and-suspenders.
    matches(node: unknown): boolean
    {
        return node instanceof Figure && node._getSource() !== undefined;
    },

    serialize(node: unknown): Record<string, unknown>
    {
        const fig = node as Figure;
        const source = fig._getSource();
        const out: Record<string, unknown> = {
            kind: fig.Kind ?? '',
            d:    source !== undefined ? pathGeometryToSvgD(source) : '',
        };
        // Persist the full Format Shape pane: every fill variant (solid /
        // gradient / pattern / image / None) + the outline Pen.
        writeFillStroke(out, fig);
        // A shape's caption + its text style (Format Shape Text page).
        if (fig.Text !== undefined)
        {
            const title = serializeShapeText(fig.Text);
            if (title !== undefined) out.text = title;
        }
        return out;
    },

    deserialize(data: Record<string, unknown>): Figure
    {
        const kind = typeof data.kind === 'string' ? data.kind : '';
        const d    = typeof data.d    === 'string' ? data.d    : '';
        let fig: Figure;
        if (kind !== '' && SHAPE_CATALOG_MAP.has(kind))
        {
            fig = Figure.fromKind(kind, 0, 0);
        }
        else if (d.length > 0)
        {
            fig = Figure.fromSource(pathGeometryFromSvgD(d), 0, 0, {
                kind: kind !== '' ? kind : undefined,
            });
        }
        else
        {
            // Fallback: empty source — reconstruct as a blank rectangle.
            fig = Figure.fromKind('rectangle', 0, 0);
        }
        // Restore Fill / Stroke over the constructed defaults. Geometry
        // (position / size / rotation / scale baseline) is applied by the
        // document from the visuals section.
        readFillStroke(data, fig);
        if (data.text !== undefined && fig.Text !== undefined)
        {
            applySerializedText(fig.Text, data.text as SerializedText);
        }
        return fig;
    },
});

// ── 'text' serializer (TextNode) ────────────────────────────────────

registerNodeSerializer({
    type: 'text',

    matches(node: unknown): boolean
    {
        // TextNode is a superclass of Callout; exclude Callout
        // so a callout doesn't match here.  The 'callout' serializer is
        // registered after this one and matches Callout explicitly.
        return node instanceof TextNode && !(node instanceof Callout);
    },

    serialize(node: unknown): Record<string, unknown>
    {
        const vm = node as TextNode;
        const out: Record<string, unknown> = { text: serializeShapeText(vm.Text) };
        // A text node is a paintable Figure — persist its Format Shape fill/stroke
        // too, not just its caption (was dropped → styling lost on reopen).
        writeFillStroke(out, vm);
        return out;
    },

    deserialize(data: Record<string, unknown>): TextNode
    {
        const vm = new TextNode();
        if (data.text !== undefined) applySerializedText(vm.Text, data.text as SerializedText);
        readFillStroke(data, vm);
        return vm;
    },
});

// ── 'callout' serializer (Callout) ─────────────────────────────
//
// NOTE: the leader-target wiring is intentionally NOT done here.
// Wiring requires all nodes to exist first.  The `leaderTargetId` is stored
// in `data` so DiagramDocument._deserialize can read it during the second
// pass (pendingLeaders) — exactly as before.  Payload byte-shape is
// identical to M3: { text, leaderTargetId }.

registerNodeSerializer({
    type: 'callout',

    matches(node: unknown): boolean
    {
        return node instanceof Callout;
    },

    serialize(node: unknown): Record<string, unknown>
    {
        const c = node as Callout;
        const out: Record<string, unknown> = {
            text:           serializeShapeText(c.Text),
            leaderTargetId: c.LeaderTargetId,
        };
        // A callout is a paintable Figure — persist its Format Shape fill/stroke
        // too (its bubble body + outline), not just its caption/leader.
        writeFillStroke(out, c);
        return out;
    },

    deserialize(data: Record<string, unknown>): Callout
    {
        const callout = new Callout();
        if (data.text !== undefined) applySerializedText(callout.Text, data.text as SerializedText);
        readFillStroke(data, callout);
        // leaderTargetId is read by DiagramDocument._deserialize during the
        // second pass (pendingLeaders).  Nothing to do here.
        return callout;
    },
});

// ── 'container' serializer (ContainerFigure) ─────────────────────────
//
// A shapeless box that hosts nested nodes. Its title (ShapeText) + Fill/Stroke
// card ride the node record here; geometry AND the parentId of every node
// (including a container nested in another) ride the `visuals` section via
// NodeVisualStore. On load ContainerPlacement re-parents children from parentId,
// so the flat node list + visuals reconstruct the tree regardless of order.
// Registered after 'shape' — a ContainerFigure has no silhouette source, so the
// 'shape' matcher (which requires one) never catches it.

registerNodeSerializer({
    type: 'container',

    matches(node: unknown): boolean
    {
        return node instanceof ContainerFigure;
    },

    serialize(node: unknown): Record<string, unknown>
    {
        const c = node as ContainerFigure;
        const out: Record<string, unknown> = {};
        const title = serializeShapeText(c.Text);
        if (title !== undefined) out.text = title;
        writeFillStroke(out, c);
        return out;
    },

    deserialize(data: Record<string, unknown>): ContainerFigure
    {
        const c = new ContainerFigure();
        if (data.text !== undefined) applySerializedText(c.Text, data.text as SerializedText);
        readFillStroke(data, c);
        return c;
    },
});
