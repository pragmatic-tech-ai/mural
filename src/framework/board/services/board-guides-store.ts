import { AlignmentAxis, type PersistentGuide } from '../../../runtime/index.js'
import type { BoardDocument } from '../board-document.js'

export interface BoardGuidesState { readonly guides: readonly PersistentGuide[] }

// Persistent ruler guides travel with the .board file in the document's opaque
// metadata (BoardDocument.Metadata) under a namespaced key, exactly like the
// camera (BoardCameraStore). Applies to every .board.
export class BoardGuidesStore
{
    // Persisted key - changing the value orphans previously saved guides.
    private static readonly MetadataKey = 'guides'
    private static readonly AxisX = AlignmentAxis.X
    private static readonly AxisY = AlignmentAxis.Y

    private static IsGuide(v: unknown): v is PersistentGuide
    {
        if (typeof v !== 'object' || v === null) return false
        const r = v as Record<string, unknown>
        return (r.axis === BoardGuidesStore.AxisX || r.axis === BoardGuidesStore.AxisY)
            && typeof r.position === 'number' && Array.isArray(r.glued)
    }

    private static IsState(v: unknown): v is BoardGuidesState
    {
        if (typeof v !== 'object' || v === null) return false
        const g = (v as Record<string, unknown>).guides
        return Array.isArray(g) && g.every(x => BoardGuidesStore.IsGuide(x))
    }

    // The guides recorded on the document, or undefined when none is set (or the
    // stored value is malformed). Undefined lets the caller keep the empty default.
    public static Read(doc: BoardDocument): BoardGuidesState | undefined
    {
        const raw = doc.Metadata[BoardGuidesStore.MetadataKey]
        if (!BoardGuidesStore.IsState(raw)) return undefined
        return {
            guides: (raw.guides as PersistentGuide[]).map(g => ({
                axis: g.axis, position: g.position, glued: g.glued.map(x => ({ ...x })),
            })),
        }
    }

    // Merge the guides into the document metadata, preserving any other keys. The
    // caller persists by saving the document.
    public static Write(doc: BoardDocument, state: BoardGuidesState): void
    {
        doc.Metadata = { ...doc.Metadata, [BoardGuidesStore.MetadataKey]: { guides: state.guides } }
    }
}
