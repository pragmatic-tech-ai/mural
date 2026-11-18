// The figure-clipboard payload: a self-contained snapshot of a SELECTION —
// nodes (content), their geometry (visuals, keyed by id), and the connectors
// wholly within the selection. It rides the OS clipboard as JSON text, tagged
// with a `kind` marker so paste can tell our data from arbitrary clipboard text.
//
// The shapes are the same SerializedNode / NodeVisual / SerializedConnector the
// document's Save/Load uses, but the codec treats them opaquely (it only does
// JSON + the marker check) so it stays decoupled from those record types — the
// document casts them back to their known shapes on paste.

export const CLIPBOARD_KIND = 'mural-board-clipboard';
export const CLIPBOARD_VERSION = 1;

export interface ClipboardPayload
{
    readonly nodes:      readonly unknown[];
    readonly visuals:    Record<string, unknown>;
    readonly connectors: readonly unknown[];
}

// The tagged envelope written to the clipboard.
interface ClipboardEnvelope extends ClipboardPayload
{
    readonly kind:    string;
    readonly version: number;
}

/** Serialize a payload to the tagged clipboard-text form. */
export function encodeClipboard(payload: ClipboardPayload): string
{
    const envelope: ClipboardEnvelope = {
        kind:       CLIPBOARD_KIND,
        version:    CLIPBOARD_VERSION,
        nodes:      payload.nodes,
        visuals:    payload.visuals,
        connectors: payload.connectors,
    };
    return JSON.stringify(envelope);
}

/**
 * Parse clipboard text back into a payload. Returns undefined for anything that
 * isn't our envelope — non-JSON, or JSON without the `kind` marker (foreign
 * clipboard text) — so paste can no-op rather than materialize garbage.
 */
export function decodeClipboard(text: string): ClipboardPayload | undefined
{
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { return undefined; }
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const env = parsed as Partial<ClipboardEnvelope>;
    if (env.kind !== CLIPBOARD_KIND) return undefined;
    return {
        nodes:      Array.isArray(env.nodes) ? env.nodes : [],
        visuals:    typeof env.visuals === 'object' && env.visuals !== null ? env.visuals : {},
        connectors: Array.isArray(env.connectors) ? env.connectors : [],
    };
}
