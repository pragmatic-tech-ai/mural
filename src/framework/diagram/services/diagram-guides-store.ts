import { AlignmentAxis, type PersistentGuide } from '../../../runtime/index.js'
import type { DiagramDocument } from '../diagram-document.js'

export interface DiagramGuidesState { readonly guides: readonly PersistentGuide[] }

// Persistent ruler guides travel with the .diagram file in the document's opaque
// metadata (DiagramDocument.Metadata) under a namespaced key, exactly like the
// camera (DiagramCameraStore). Applies to every .diagram.
export class DiagramGuidesStore
{
    // Persisted key - changing the value orphans previously saved guides.
    private static readonly MetadataKey = 'guides'
    private static readonly AxisX = AlignmentAxis.X
    private static readonly AxisY = AlignmentAxis.Y

    private static IsGuide(v: unknown): v is PersistentGuide
    {
        if (typeof v !== 'object' || v === null) return false
        const r = v as Record<string, unknown>
        return (r.axis === DiagramGuidesStore.AxisX || r.axis === DiagramGuidesStore.AxisY)
            && typeof r.position === 'number' && Array.isArray(r.glued)
    }

    private static IsState(v: unknown): v is DiagramGuidesState
    {
        if (typeof v !== 'object' || v === null) return false
        const g = (v as Record<string, unknown>).guides
        return Array.isArray(g) && g.every(x => DiagramGuidesStore.IsGuide(x))
    }

    // The guides recorded on the document, or undefined when none is set (or the
    // stored value is malformed). Undefined lets the caller keep the empty default.
    public static Read(doc: DiagramDocument): DiagramGuidesState | undefined
    {
        const raw = doc.Metadata[DiagramGuidesStore.MetadataKey]
        if (!DiagramGuidesStore.IsState(raw)) return undefined
        return {
            guides: (raw.guides as PersistentGuide[]).map(g => ({
                axis: g.axis, position: g.position, glued: g.glued.map(x => ({ ...x })),
            })),
        }
    }

    // Merge the guides into the document metadata, preserving any other keys. The
    // caller persists by saving the document.
    public static Write(doc: DiagramDocument, state: DiagramGuidesState): void
    {
        doc.Metadata = { ...doc.Metadata, [DiagramGuidesStore.MetadataKey]: { guides: state.guides } }
    }
}
