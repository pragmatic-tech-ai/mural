import type { DiagramDocument } from '../diagram-document.js'

export interface DiagramCameraState { readonly zoom: number; readonly offsetX: number; readonly offsetY: number }

// The diagram camera (zoom + scroll offset) is serialized WITH the diagram, in
// the document's opaque metadata (DiagramDocument.Metadata) under a namespaced
// key, so it travels with the .diagram file and restores on open. Applies to
// every .diagram, not just architecture ones - hence the generic key.
//
// Zoom is the diagram's LayoutTransform scale; the offset is the ScrollViewer's
// scroll offset.
export class DiagramCameraStore
{
    // Persisted key - changing the value orphans previously saved cameras.
    private static readonly MetadataKey = 'camera'

    private static IsState(v: unknown): v is DiagramCameraState
    {
        if (typeof v !== 'object' || v === null) return false
        const r = v as Record<string, unknown>
        return typeof r.zoom === 'number' && typeof r.offsetX === 'number' && typeof r.offsetY === 'number'
    }

    // The camera recorded on the document, or undefined when none is set (or the
    // stored value is malformed). Undefined lets the caller keep the identity default.
    public static Read(doc: DiagramDocument): DiagramCameraState | undefined
    {
        const raw = doc.Metadata[DiagramCameraStore.MetadataKey]
        if (!DiagramCameraStore.IsState(raw)) return undefined
        return { zoom: raw.zoom, offsetX: raw.offsetX, offsetY: raw.offsetY }
    }

    // Merge the camera into the document metadata, preserving any other keys. The
    // caller persists by saving the document.
    public static Write(doc: DiagramDocument, state: DiagramCameraState): void
    {
        doc.Metadata = {
            ...doc.Metadata,
            [DiagramCameraStore.MetadataKey]: { zoom: state.zoom, offsetX: state.offsetX, offsetY: state.offsetY },
        }
    }
}
