// Generic per-VM node serialization registry.
//
// Each node type registers a NodeSerializer against this registry.
// BoardDocument._serialize / _deserialize dispatch through it so
// new node kinds (ArchNodeVM, etc.) never require editing BoardDocument.
//
// This module is deliberately class-free so concrete class modules
// (Figure shapes, TextNode, Callout) can import from here without creating
// circular dependencies.  The concrete registrations live in
// node-serializers-default.ts and are imported by board-document.ts for
// their side-effects.

import type { Figure } from '../figure.js';
import type { NodeViewModel } from '../node-view-model.js';

// ── Shared type aliases ───────────────────────────────────────────────

/** Base positional fields every serialized node record carries. */
export interface NodeBaseRecord
{
    id:   string;
    left: number;
    top:  number;
    w:    number;
    h:    number;
}

/** V2 node record: typed with a `data` bag per serializer. */
export interface SerializedNodeV2 extends NodeBaseRecord
{
    type: string;
    data: Record<string, unknown>;
}

// ── Serializer contract ───────────────────────────────────────────────

export interface NodeSerializer
{
    /** Stable discriminator tag: 'shape' | 'text' | 'callout' | … */
    readonly type: string;

    /** Return true when this serializer handles the given node instance. */
    matches(node: unknown): boolean;

    /**
     * Produce the `data` payload for this node — content only, no geometry.
     * The document writes the id + the `visuals` (geometry) record separately.
     */
    serialize(node: unknown): Record<string, unknown>;

    /**
     * Reconstruct the node from its `data` payload — content only, built at the
     * origin. The document assigns `.Id` and applies geometry from the `visuals`
     * section (via NodeVisualStore) after construction.
     */
    deserialize(data: Record<string, unknown>): Figure | NodeViewModel;
}

// ── Registry ─────────────────────────────────────────────────────────

const REGISTRY: NodeSerializer[] = [];

/** Register a serializer.  Call once per type, typically at module load. */
export function registerNodeSerializer(s: NodeSerializer): void
{
    REGISTRY.push(s);
}

/** Find the serializer that handles this node instance. */
export function serializerFor(node: unknown): NodeSerializer | undefined
{
    return REGISTRY.find(s => s.matches(node));
}

/** Find the serializer for the given stable type tag. */
export function serializerByType(type: string): NodeSerializer | undefined
{
    return REGISTRY.find(s => s.type === type);
}
