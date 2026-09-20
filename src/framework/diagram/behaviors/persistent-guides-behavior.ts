import {
    Rect, AlignmentAxis, EdgeKind, Key,
    snapGuidePosition, snapRectToGuides, guideCursorFor,
    type PointerEventArgs, type KeyEventArgs, type Visual, type PersistentGuide, type GuideGlue, type GuideSnap,
} from '../../../runtime/index.js';
import { Orientation } from '../../../basic/index.js';
import { Figure } from '../figure.js';
import { NodeViewModel } from '../node-view-model.js';
import { RulerBar } from '../guides/ruler-bar.js';
import { DiagramSettings } from '../diagram-settings.js';
import type { Diagram } from '../diagram.js';

// The interaction coordinator for persistent (Visio-style) ruler guides. Installs
// a preview-phase pointer interceptor (Figure swallows the bubble pass by setting
// Handled, so drag start/end must be observed in the tunnel phase) plus a
// composed PositionSnap link and a Delete-key handler. Interactions:
//   * Create — drag out of a ruler OR out of the thin canvas margin next to it.
//   * Select — click a guide (within grab tolerance) selects it (Diagram.SelectedGuide).
//   * Move   — drag a selected/grabbed guide in its plane (glued nodes follow).
//   * Delete — Delete/Backspace removes the selected guide.
//   * Glue   — dragging a node snaps its edge to a guide and sticks it on drop.
// The Diagram forwards its OnPreviewPointer{Down,Move,Up} + OnKeyDown to the
// bundle installed via _setPersistentGuidesHandlers.

export interface PersistentGuidesHandlers
{
    OnPreviewPointerDown(args: unknown): void;
    OnPreviewPointerMove(args: unknown): void;
    OnPreviewPointerUp  (args: unknown): void;
    OnKeyDown           (args: unknown): void;
}

enum Mode { None, Create, Reposition, NodeDrag }

const MOVE_THRESHOLD = 3;   // content px a create/reposition must travel to "count"
const GRAB_CURSOR = 'grab'; // hover affordance over an existing (grabbable) guide

/** @internal */
export function attachPersistentGuides(diagram: Diagram): () => void
{
    let mode = Mode.None;
    let axis = AlignmentAxis.X;
    let guideIndex = -1;
    let downPos = 0;                     // guide coordinate at pointer-down (move detection)
    let lastPos = 0;                     // last committed guide position (glue delta base)
    let moved = false;
    let activeNode: Figure | undefined;

    const previousSnap = diagram.PositionSnap;
    diagram.PositionSnap = (rect: Rect): Rect => {
        const base = previousSnap !== undefined ? previousSnap(rect) : rect;
        if (mode !== Mode.NodeDrag || activeNode === undefined) return base;
        return snapRectToGuides(base, diagram.Guides).snapped;
    };

    const nodeIdOf = (item: unknown): string | undefined => {
        const id = item instanceof Figure ? item.Id
            : item instanceof NodeViewModel ? item.Id
            : undefined;
        return id !== undefined && id !== '' ? id : undefined;
    };

    const findAncestor = <T>(v: unknown, ctor: new (...a: never[]) => T): T | undefined => {
        let cur = v as { GetVisualParent?(): Visual | undefined } | undefined;
        while (cur !== undefined && cur !== null)
        {
            if (cur instanceof ctor) return cur;
            cur = (cur as { GetVisualParent?(): Visual | undefined }).GetVisualParent?.();
        }
        return undefined;
    };

    const contentPoint = (args: PointerEventArgs): { x: number; y: number } => {
        const p = diagram.HostToContent(args.HostX, args.HostY);
        return { x: p.X, y: p.Y };
    };

    const otherRects = (): Rect[] => {
        const out: Rect[] = [];
        const items = diagram.ItemsSource;
        if (items === undefined) return out;
        for (const it of items as Iterable<unknown>)
        {
            const c = diagram.Generator.ContainerFromItem(it);
            if (!(c instanceof Figure)) continue;
            const r = c.ArrangedRect;
            if (r === undefined || r.Width <= 0) continue;
            out.push(new Rect(c.Left, c.Top, r.Width, r.Height));
        }
        return out;
    };

    // Which existing guide (if any) the point is within grab tolerance of.
    const guideNear = (p: { x: number; y: number }): number => {
        const tol = DiagramSettings.GuideGrabTolerance() / (diagram.Zoom || 1);
        for (let i = 0; i < diagram.Guides.length; i++)
        {
            const g = diagram.Guides[i]!;
            const coord = g.axis === AlignmentAxis.X ? p.x : p.y;
            if (Math.abs(coord - g.position) <= tol) return i;
        }
        return -1;
    };

    // If the point sits in the thin canvas band next to a ruler, the axis of the
    // guide a drag there pulls out (top band -> horizontal Y line, left -> X line).
    const createEdgeAxis = (p: { x: number; y: number }): AlignmentAxis | undefined => {
        const zoom = diagram.Zoom || 1;
        const m = DiagramSettings.GuideCreateMargin() / zoom;
        // Measure from the EFFECTIVE visible edge (live arrange), not raw
        // ScrollX/Y — a stale scroll offset on a fits-content axis would shift the
        // band away from the real edge (that was the vertical-band-shifted bug).
        const origin = diagram.VisibleContentOrigin();
        const topD  = p.y - origin.Y;
        const leftD = p.x - origin.X;
        const nearTop  = topD  >= 0 && topD  <= m;
        const nearLeft = leftD >= 0 && leftD <= m;
        if (nearTop && nearLeft) return topD <= leftD ? AlignmentAxis.Y : AlignmentAxis.X;
        if (nearTop)  return AlignmentAxis.Y;
        if (nearLeft) return AlignmentAxis.X;
        return undefined;
    };

    const startCreate = (a: AlignmentAxis, p: { x: number; y: number }): void => {
        axis = a;
        const pos = a === AlignmentAxis.X ? p.x : p.y;
        const next = diagram.Guides.slice();
        guideIndex = next.length;
        next.push({ axis: a, position: pos, glued: [] });
        diagram.Guides = next;
        mode = Mode.Create; downPos = pos; lastPos = pos; moved = false;
    };

    const setGuidePos = (i: number, pos: number): void => {
        const next = diagram.Guides.slice();
        next[i] = { ...next[i]!, position: pos };
        diagram.Guides = next;
    };

    const removeGuide = (i: number): void => {
        const next = diagram.Guides.slice();
        next.splice(i, 1);
        diagram.Guides = next;
    };

    const moveGluedNodes = (guide: PersistentGuide, delta: number): void => {
        const items = diagram.ItemsSource;
        if (items === undefined || delta === 0 || guide.glued.length === 0) return;
        const byId = new Map<string, Figure>();
        for (const it of items as Iterable<unknown>)
        {
            const id = nodeIdOf(it);
            const c = diagram.Generator.ContainerFromItem(it);
            if (id !== undefined && c instanceof Figure) byId.set(id, c);
        }
        for (const g of guide.glued)
        {
            const c = byId.get(g.nodeId);
            if (c === undefined) continue;
            if (guide.axis === AlignmentAxis.X) c.Left = c.Left + delta;
            else                                c.Top  = c.Top  + delta;
        }
    };

    // Consume the gesture AND take keyboard focus: setting Handled here (tunnel
    // phase) halts the bubble pass, so Diagram.OnPointerDown never runs its own
    // Focus() — without this, Delete on a selected guide wouldn't reach the Diagram.
    const claim = (args: PointerEventArgs): void => {
        args.Handled = true;
        (diagram as unknown as { Focus?(): void }).Focus?.();
    };

    // Clear the transient hover affordance (cursor + preview line).
    const clearHover = (): void => {
        if (diagram.Cursor !== undefined) diagram.Cursor = undefined;
        if (diagram.GuidePreview !== undefined) diagram.GuidePreview = undefined;
    };

    // Idle pointer-move (no active gesture): advertise where a guide could be
    // created / grabbed via the cursor + a faint preview line. Mirrors the
    // onDown zone order so the affordance predicts exactly what a press would do.
    const hover = (args: PointerEventArgs): void => {
        // A modal canvas tool (the format painter) owns the diagram cursor while
        // active — yield to it: don't advertise a guide affordance and, crucially,
        // don't clearHover() (that would stomp the tool's cursor on every move,
        // reverting it to the default arrow). Clear only our own stale preview.
        if (diagram.FormatPainterActive)
        {
            if (diagram.GuidePreview !== undefined) diagram.GuidePreview = undefined;
            return;
        }
        // Over a ruler strip the RulerBar owns its own cursor — leave the canvas clean.
        if (findAncestor(args.Source, RulerBar) !== undefined) { clearHover(); return; }
        const p = contentPoint(args);
        // Over an existing guide -> grab affordance (no preview; it already shows).
        if (guideNear(p) >= 0)
        {
            if (diagram.Cursor !== GRAB_CURSOR) diagram.Cursor = GRAB_CURSOR;
            if (diagram.GuidePreview !== undefined) diagram.GuidePreview = undefined;
            return;
        }
        // In a create band next to a ruler -> resize cursor + preview at the drop line.
        const edge = createEdgeAxis(p);
        if (edge !== undefined)
        {
            const cursor = guideCursorFor(edge);
            if (diagram.Cursor !== cursor) diagram.Cursor = cursor;
            diagram.GuidePreview = { axis: edge, position: edge === AlignmentAxis.X ? p.x : p.y };
            return;
        }
        clearHover();
    };

    const onDown = (args: PointerEventArgs): void => {
        if (args.Handled) return;
        clearHover();   // a gesture is starting; the committed guide (if any) takes over
        // 1) on a ruler -> create (top ruler -> Y guide, left ruler -> X guide)
        const ruler = findAncestor(args.Source, RulerBar);
        if (ruler !== undefined)
        {
            startCreate(ruler.Orientation === Orientation.Horizontal ? AlignmentAxis.Y : AlignmentAxis.X, contentPoint(args));
            claim(args);
            return;
        }
        const p = contentPoint(args);
        // 2) grab an existing guide -> select + reposition
        const gi = guideNear(p);
        if (gi >= 0)
        {
            diagram.SelectedGuide = gi;
            mode = Mode.Reposition; guideIndex = gi; axis = diagram.Guides[gi]!.axis;
            downPos = diagram.Guides[gi]!.position; lastPos = downPos; moved = false;
            claim(args);
            return;
        }
        // 3) drag out of the canvas margin next to a ruler -> create
        const edge = createEdgeAxis(p);
        if (edge !== undefined)
        {
            startCreate(edge, p);
            claim(args);
            return;
        }
        // 4) elsewhere: deselect any guide; arm node-drag glue observation
        if (diagram.SelectedGuide !== -1) diagram.SelectedGuide = -1;
        const fig = findAncestor(args.Source, Figure);
        if (fig !== undefined) { mode = Mode.NodeDrag; activeNode = fig; }
    };

    const onMove = (args: PointerEventArgs): void => {
        if (mode === Mode.None) { hover(args); return; }
        if (mode !== Mode.Create && mode !== Mode.Reposition) return;
        const p = contentPoint(args);
        const raw = axis === AlignmentAxis.X ? p.x : p.y;
        const snapped = snapGuidePosition(axis, raw, otherRects());
        if (Math.abs(snapped - downPos) > MOVE_THRESHOLD) moved = true;
        if (mode === Mode.Reposition) moveGluedNodes(diagram.Guides[guideIndex]!, snapped - lastPos);
        setGuidePos(guideIndex, snapped);
        lastPos = snapped;
    };

    const onUp = (args: PointerEventArgs): void => {
        if (mode === Mode.Create)
        {
            const overRuler = findAncestor(args.Source, RulerBar) !== undefined;
            if (overRuler || !moved) removeGuide(guideIndex);       // click/no-drag or dropped back on ruler -> cancel
            else                     diagram.SelectedGuide = guideIndex;
        }
        else if (mode === Mode.Reposition)
        {
            if (findAncestor(args.Source, RulerBar) !== undefined) { removeGuide(guideIndex); diagram.SelectedGuide = -1; }
        }
        else if (mode === Mode.NodeDrag && activeNode !== undefined)
        {
            const r = activeNode.ArrangedRect;
            const finalRect = new Rect(activeNode.Left, activeNode.Top, r?.Width ?? 0, r?.Height ?? 0);
            const res = snapRectToGuides(finalRect, diagram.Guides);
            const id = nodeIdOf(activeNode) ?? nodeIdOf(diagram.Generator.ItemFromContainer(activeNode));
            if (id !== undefined) reglue(diagram, id, res);
        }
        mode = Mode.None; guideIndex = -1; activeNode = undefined; moved = false;
    };

    const onKeyDown = (args: KeyEventArgs): void => {
        if (args.Handled) return;
        if (args.Key !== Key.Delete && args.Key !== Key.Back) return;
        const sel = diagram.SelectedGuide;
        if (sel < 0 || sel >= diagram.Guides.length) return;
        removeGuide(sel);
        diagram.SelectedGuide = -1;
        args.Handled = true;
    };

    diagram._setPersistentGuidesHandlers({
        OnPreviewPointerDown: onDown    as (a: unknown) => void,
        OnPreviewPointerMove: onMove    as (a: unknown) => void,
        OnPreviewPointerUp:   onUp      as (a: unknown) => void,
        OnKeyDown:            onKeyDown as (a: unknown) => void,
    });

    return (): void => {
        diagram._setPersistentGuidesHandlers(undefined);
        diagram.PositionSnap = previousSnap;
        clearHover();
    };
}

// Rewrite a node's glue: on each axis, glue to the snapped guide (if any) and
// remove the node from every other guide of that axis (drag-away un-glue).
function reglue(diagram: Diagram, nodeId: string, res: GuideSnap): void
{
    const guides = diagram.Guides.map(g => ({ ...g, glued: g.glued.slice() as GuideGlue[] }));
    const applyAxis = (axisSnap: { edge: EdgeKind; guide: number } | undefined, wantAxis: AlignmentAxis): void => {
        for (let i = 0; i < guides.length; i++)
        {
            if (guides[i]!.axis !== wantAxis) continue;
            guides[i]!.glued = guides[i]!.glued.filter(g => g.nodeId !== nodeId);
        }
        if (axisSnap !== undefined) guides[axisSnap.guide]!.glued.push({ nodeId, edge: axisSnap.edge });
    };
    applyAxis(res.x, AlignmentAxis.X);
    applyAxis(res.y, AlignmentAxis.Y);
    diagram.Guides = guides;
}
