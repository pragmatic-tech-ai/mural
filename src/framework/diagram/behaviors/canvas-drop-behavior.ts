import {
    DragDropEffects,
    Point,
    type DataObject,
    type DragEventArgs,
    type Visual,
} from '../../../runtime/index.js';
import type { Diagram } from '../diagram.js';
import type { ContainerFigure } from '../container-figure.js';
import { MuralDataFormat, parseUriList, type ExternalDroppedArgs } from '../external-drop.js';

// Promoted from the demo's canvas-drop-behavior.mjs. Wires a Visual
// to accept drag-drops and translate the cursor host-coordinates into
// canvas-local coordinates (origin = Diagram.ItemsPanel's top-left,
// adjusted for the enclosing ScrollViewer's offset).
//
// On Drop, fires Diagram.ItemDropped with the canvas-local Position +
// the raw DataObject. The framework doesn't interpret the data — the
// consumer's listener inspects format strings (mural/node-kind,
// mural/file, …) and materializes accordingly.
//
// Receiver vs. originVisual:
//   * receiver     — where the routed listeners attach. Must be on the
//                    bubble path of every place a user might legitimately
//                    drop. Usually the surrounding surface Border or
//                    ScrollViewer, NOT the Diagram itself — a naive
//                    Diagram receiver misses drops on the scrollbar
//                    (the scrollbar lives outside the Diagram's visual
//                    subtree so its DragOver/Drop never bubble through).
//   * diagram      — the Diagram whose ItemsPanel defines (0,0) of the
//                    canvas-local coordinate frame. Always required.
//
// Coordinate conversion delegates to Diagram.HostToContent, which sums the
// ArrangedRect chain (already carrying the ScrollViewer's -offset) and divides
// by the zoom (PART_Camera's LayoutTransform scale) — so a drop lands correctly
// after the user has scrolled AND at any zoom level.

/** @internal */
export function attachCanvasDropBehavior(receiver: Visual, diagram: Diagram): () => void
{
    (receiver as unknown as { AllowDrop: boolean }).AllowDrop = true;

    const localPosition = (args: DragEventArgs): Point => diagram.HostToContent(args.HostX, args.HostY);

    const onDragOver = (args: DragEventArgs): void => {
        // Accept toolbox-item payloads AND OS drops (files dragged from the file
        // manager, links dragged from a browser). Setting Copy shows the affordance.
        if (args.Data.Has(TOOLBOX_ITEM_FORMAT)
            || args.Data.Has(MuralDataFormat.Files)
            || args.Data.Has(MuralDataFormat.UriList))
            args.Effect = DragDropEffects.Copy;
    };

    const onDrop = (args: DragEventArgs): void => {
        const position = localPosition(args);
        // The container the drop point lands inside (innermost), if any. Lets
        // the drop router / factory nest the new node into it — generic
        // containers adopt freely (mural); a model-backed container is left to
        // the host factory to validate. Undefined over empty canvas.
        const container = diagram.ContainerPlacement.containerAt(position);

        if (args.Data.Has(TOOLBOX_ITEM_FORMAT))
        {
            // A drop is a diagram interaction — take keyboard focus so the just-dropped
            // node is immediately editable/deletable via shortcuts. No-op when the
            // diagram isn't Focusable (the Visual.Focus contract).
            diagram.Focus();
            diagram._fireItemDropped({ Data: args.Data, Position: position, TargetContainer: container });
            return;
        }

        // Not a toolbox item — try to interpret it as an OS drop.
        const external = buildExternalArgs(args.Data, position, container);
        if (external === undefined) return;
        diagram.Focus();
        diagram._fireExternalDropped(external);
    };

    receiver.AddRoutedEventListener('DragOver', onDragOver as unknown as (a: unknown) => void);
    receiver.AddRoutedEventListener('Drop',     onDrop     as unknown as (a: unknown) => void);

    return (): void => {
        (receiver as unknown as { AllowDrop: boolean }).AllowDrop = false;
        receiver.RemoveRoutedEventListener('DragOver', onDragOver as unknown as (a: unknown) => void);
        receiver.RemoveRoutedEventListener('Drop',     onDrop     as unknown as (a: unknown) => void);
    };
}

// Pull the OS payload (dropped files + dragged URIs) out of a DataObject into
// ExternalDroppedArgs. Returns undefined when the payload carries neither — the
// caller then ignores the drop. Extracted from onDrop so it's unit-testable
// without the routed-event machinery.
export function buildExternalArgs(
    data: DataObject, position: Point, container: ContainerFigure | undefined,
): ExternalDroppedArgs | undefined
{
    const fileList = data.Get<FileList>(MuralDataFormat.Files);
    const uriText  = data.Get<string>(MuralDataFormat.UriList);
    const files    = fileList !== undefined ? Array.from(fileList) : [];
    const uris     = uriText !== undefined && uriText.length > 0 ? parseUriList(uriText) : [];
    if (files.length === 0 && uris.length === 0) return undefined;
    return { Files: files, Uris: uris, Position: position, TargetContainer: container };
}

export interface ItemDroppedArgs
{
    readonly Data:     DataObject;
    readonly Position: Point;
    // The innermost container under the drop point (undefined over empty canvas).
    readonly TargetContainer?: ContainerFigure;
}

export type ItemDroppedListener = (args: ItemDroppedArgs) => void;

// The single toolbox drag format: the payload carries the dropped item's
// id (`dataObject.Set(TOOLBOX_ITEM_FORMAT, item.Id)`). The behavior gates
// DragOver/Drop on the presence of this key; payloads without it are
// ignored. The drop router (attach-standard-mutations) looks the item up in
// the ToolboxRepository and calls its factory.
export const TOOLBOX_ITEM_FORMAT = '@pragmatic-tech-ai/mural/toolbox-item';
