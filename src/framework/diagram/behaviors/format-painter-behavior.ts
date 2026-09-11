import { type KeyEventArgs, Key, type PointerEventArgs, type Disposable } from '../../../runtime/index.js';
import { captureFormat, applyFormat, type FormatBundle, type FormatTarget } from '../collaborators/format-bundle.js';
import { Figure } from '../figure.js';
import { findFigureAncestor, findConnectorAncestor } from './connector-interactions-behavior.js';
import type { Diagram } from '../diagram.js';

// The cursor shown over the canvas while the format brush is armed — a hint that
// the next click stamps the picked-up format onto the target. Office's Format
// Painter shows a pointer arrow with a small paintbrush; we mirror that with an
// inline SVG cursor whose hotspot is the arrow tip (1,1). The trailing `copy`
// keyword is a fallback: if a host can't rasterize an SVG cursor the affordance
// degrades to the copy cursor rather than the plain arrow. Encoded with
// encodeURIComponent (available in both Node and the browser — no base64 /
// Latin1 concerns) so the SVG stays readable in source.
const FORMAT_PAINTER_CURSOR_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">' +
    // Pointer arrow — white body, dark outline, tip at (1,1) = the hotspot.
    '<path d="M1 1L1 17L5.2 13.1L7.8 19L10.1 18L7.5 12.3L13 12.3Z" ' +
    'fill="#ffffff" stroke="#1a1a1a" stroke-width="1.2" stroke-linejoin="round"/>' +
    // Paintbrush (Material "brush" glyph) tucked at the lower-right, indigo fill
    // with a white halo (paint-order:stroke) so it reads on light and dark shapes.
    '<g transform="translate(12.5 11) scale(0.62)">' +
    '<path d="M7 14c-1.66 0-3 1.34-3 3 0 1.31-1.16 2-2 2 .92 1.22 2.49 2 4 2 2.21 0 4-1.79 4-4 0-1.66-1.34-3-3-3zm13.71-9.37l-1.34-1.34c-.39-.39-1.02-.39-1.41 0L9 12.25 11.75 15l8.96-8.96c.39-.39.39-1.02 0-1.41z" ' +
    'fill="#5c6bc0" stroke="#ffffff" stroke-width="2.6" paint-order="stroke" stroke-linejoin="round"/>' +
    '</g></svg>';

export const FORMAT_PAINTER_CURSOR =
    `url("data:image/svg+xml,${encodeURIComponent(FORMAT_PAINTER_CURSOR_SVG)}") 1 1, copy`;

// State machine behind the "Copy Format" (format-painter) tool. Holds a single
// captured format bundle; while a bundle is held the tool is ACTIVE and each
// PaintAt stamps it onto a target. Sticky by design — the bundle survives every
// PaintAt so the user can paint many targets, until End() drops it (Esc, an
// empty-canvas click, or the toolbar toggle turning off).
//
// Pure: no pointer / DP wiring lives here, so the pick-up → paint → paint → drop
// cycle is fully testable on its own. attachFormatPainter (below) binds it to
// the Diagram's pointer pipeline and the FormatPainterActive DP.
export class FormatPainter
{
    private _bundle: FormatBundle | undefined = undefined;

    // True once a format has been picked up and not yet dropped.
    public get IsActive(): boolean { return this._bundle !== undefined; }

    // Pick up `source`'s format. Replaces any previously-held bundle.
    public Begin(source: FormatTarget): void
    {
        this._bundle = captureFormat(source);
    }

    // Stamp the held bundle onto `target`. No-op when inactive.
    public PaintAt(target: FormatTarget): void
    {
        if (this._bundle === undefined) return;
        applyFormat(target, this._bundle);
    }

    // Drop the held format — the tool goes inactive.
    public End(): void
    {
        this._bundle = undefined;
    }
}

// The Diagram delegates its preview-pointer-down + key-down virtuals to this
// bundle while the painter is installed (tunnel phase, so it pre-empts the
// descendant Figure's select-on-click). Same shape as the connector-
// interactions / alignment handler slots.
export interface FormatPainterHandlers
{
    OnPreviewPointerDown(args: unknown): void;
    OnKeyDown(args: unknown): void;
}

// The figure / connector the format brush picks up from: the first selected
// item that is (or whose container is) a Figure, else the first selected
// connector. A content node (NodeViewModel) carries no paint of its own — its
// container Figure does, so resolve to it (mirrors DiagramCommands._collectSelected).
export function primaryFormatTarget(diagram: Diagram): FormatTarget | undefined
{
    for (const item of diagram.SelectedItems)
    {
        if (item instanceof Figure) return item;
        const container = diagram.Generator.ContainerFromItem(item);
        if (container instanceof Figure) return container;
    }
    const connectors = diagram.SelectedConnectors;
    return connectors.length > 0 ? connectors[0] : undefined;
}

// Wire a FormatPainter to a Diagram: the FormatPainterActive DP is the single
// source of truth. Flipping it true picks up the primary selection's format
// (and immediately turns back off if nothing formattable is selected); flipping
// it false drops the brush. While active, a preview-pointer-down over a figure /
// connector stamps and stays active (sticky); a click on empty canvas — or Esc —
// turns the DP off. Returns a detach thunk. Constructed once in the Diagram ctor.
export function attachFormatPainter(diagram: Diagram): () => void
{
    const painter = new FormatPainter();
    const D = diagram.constructor as typeof import('../diagram.js').Diagram;

    const setActive = (on: boolean): void => { diagram.FormatPainterActive = on; };

    const onActiveChanged = (): void =>
    {
        if (diagram.FormatPainterActive)
        {
            const source = primaryFormatTarget(diagram);
            if (source === undefined) { setActive(false); return; }   // nothing to copy
            painter.Begin(source);
            diagram.Cursor = FORMAT_PAINTER_CURSOR;   // hint the canvas: click to stamp
        }
        else
        {
            painter.End();
            diagram.Cursor = undefined;
        }
    };
    const activeSub: Disposable = diagram.PropertyChanged(D.FormatPainterActiveKey).subscribe(onActiveChanged);

    const handlers: FormatPainterHandlers = {
        OnPreviewPointerDown(raw: unknown): void
        {
            if (!painter.IsActive) return;
            const args = raw as PointerEventArgs;
            const target = findFigureAncestor(args.Source) ?? findConnectorAncestor(args.Source);
            if (target !== undefined)
            {
                painter.PaintAt(target);
                args.Handled = true;       // suppress the select-on-click
            }
            else
            {
                setActive(false);          // click on empty canvas exits the tool
            }
        },
        OnKeyDown(raw: unknown): void
        {
            if (!painter.IsActive) return;
            const args = raw as KeyEventArgs;
            if (args.Key === Key.Escape) { setActive(false); args.Handled = true; }
        },
    };
    diagram._setFormatPainterHandlers(handlers);

    return (): void =>
    {
        diagram._setFormatPainterHandlers(undefined);
        activeSub.dispose();
        painter.End();
        diagram.Cursor = undefined;
    };
}
