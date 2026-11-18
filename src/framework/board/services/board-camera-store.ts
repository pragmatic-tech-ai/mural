import type { BoardDocument } from '../board-document.js'

export interface BoardCameraState { readonly zoom: number; readonly offsetX: number; readonly offsetY: number }

// The board camera (zoom + scroll offset) is serialized WITH the board, in
// the document's opaque metadata (BoardDocument.Metadata) under a namespaced
// key, so it travels with the .board file and restores on open. Applies to
// every .board, not just architecture ones - hence the generic key.
//
// Zoom is the board's LayoutTransform scale; the offset is the ScrollViewer's
// scroll offset.
export class BoardCameraStore
{
    // Persisted key - changing the value orphans previously saved cameras.
    private static readonly MetadataKey = 'camera'

    private static IsState(v: unknown): v is BoardCameraState
    {
        if (typeof v !== 'object' || v === null) return false
        const r = v as Record<string, unknown>
        return typeof r.zoom === 'number' && typeof r.offsetX === 'number' && typeof r.offsetY === 'number'
    }

    // The camera recorded on the document, or undefined when none is set (or the
    // stored value is malformed). Undefined lets the caller keep the identity default.
    public static Read(doc: BoardDocument): BoardCameraState | undefined
    {
        const raw = doc.Metadata[BoardCameraStore.MetadataKey]
        if (!BoardCameraStore.IsState(raw)) return undefined
        return { zoom: raw.zoom, offsetX: raw.offsetX, offsetY: raw.offsetY }
    }

    // Merge the camera into the document metadata, preserving any other keys. The
    // caller persists by saving the document.
    public static Write(doc: BoardDocument, state: BoardCameraState): void
    {
        doc.Metadata = {
            ...doc.Metadata,
            [BoardCameraStore.MetadataKey]: { zoom: state.zoom, offsetX: state.offsetX, offsetY: state.offsetY },
        }
    }
}
