import type { HierarchyContributorRegistry } from './hierarchy-contributor-registry.js';
import {
    HierarchyItemId, NodeContribution, ProviderContribution,
    ChildAdded, ChildRemoved, ChildUpdated,
    type HierarchyNode, type HierarchyChange, type IHierarchyProvider,
} from './hierarchy-node.js';

// A concrete, model-interned id. Identity is object identity (one instance per
// (parent,key,ExtObject)); consumers compare by ===.
class MintedItemId extends HierarchyItemId
{
    constructor(public readonly Key: string, public readonly Ext: unknown) { super(); }
}

// One realized node's bookkeeping: its node data, its ordered children, and — when a
// provider owns its subtree — the provider + its ObserveChildren disposer.
interface Entry
{
    node: HierarchyNode;
    children: HierarchyItemId[];
    provider?: IHierarchyProvider;
    dispose?: () => void;
    realized?: boolean;   // RealizeChildren has run on this node (gates reRealizeKeyed)
}

// The keyed-regime walker (design §3,§5,§6). Owns keyed-node identity + interning,
// drives the contributor walk, realizes children by SUBSCRIPTION, and patches on
// deltas. Providers own identity within their opaque branches; the boundary is a
// ProviderContribution.
export class HierarchyModel
{
    private readonly entries = new Map<HierarchyItemId, Entry>();
    // keyed-child interning: parentId -> extIdentity -> id.
    private readonly keyedChildren = new Map<HierarchyItemId, Map<unknown, MintedItemId>>();
    // per-node child-delta subscribers (realize = subscribe reaches the presentation layer).
    private readonly childSinks = new Map<HierarchyItemId, Set<(c: HierarchyChange) => void>>();

    constructor(private readonly registry: HierarchyContributorRegistry)
    {
        // Re-contribute already-realized keyed nodes when the contributor set changes
        // (a runtime Register/unregister). Provider-owned subtrees are unaffected — they
        // self-drive via ObserveChildren.
        this.registry.PropertyChanged('Contributors').subscribe(() => this.reRealizeKeyed());
    }

    // Re-run RealizeChildren for every realized node that is NOT provider-owned.
    // Interning keeps survivors' ids stable; new contributions append. Snapshot the ids
    // first — RealizeChildren mutates `entries` while we iterate.
    private reRealizeKeyed(): void
    {
        for (const id of [...this.entries.keys()])
        {
            const entry = this.entries.get(id);
            if (entry !== undefined && entry.realized === true && entry.provider === undefined)
            {
                this.RealizeChildren(id);
            }
        }
    }

    // Subscribe to a node's child deltas. The model emits ChildAdded/ChildUpdated/ChildRemoved
    // as `id`'s children set mutates — from the keyed regime (internKeyed/pruneKeyed) and from
    // provider deltas (patch) alike, so a consumer never sees the keyed/provider boundary.
    public ObserveChildren(id: HierarchyItemId, sink: (c: HierarchyChange) => void): () => void
    {
        let set = this.childSinks.get(id);
        if (set === undefined)
        {
            set = new Set();
            this.childSinks.set(id, set);
        }
        set.add(sink);
        return () =>
        {
            const s = this.childSinks.get(id);
            if (s !== undefined)
            {
                s.delete(sink);
                if (s.size === 0) this.childSinks.delete(id);
            }
        };
    }

    private emit(parentId: HierarchyItemId, change: HierarchyChange): void
    {
        const set = this.childSinks.get(parentId);
        if (set === undefined) return;
        for (const sink of [...set]) sink(change);
    }

    // Canonical name for a keyed node — its own family segment for P0. Full ancestor-path
    // canonical names + provider delegation across the boundary are P6.
    public CanonicalNameOf(id: HierarchyItemId): string
    {
        return this.entry(id).node.Key;
    }

    // Resolve a canonical name back to a realized node id (Nil if none). Minimal P0
    // lookup; the reactive-restore reveal path is P6.
    public Reveal(canonicalName: string): HierarchyItemId
    {
        for (const [id, e] of this.entries)
        {
            if (e.node.Key === canonicalName) return id;
        }
        return HierarchyItemId.Nil;
    }

    public SeedRoot(node: HierarchyNode): HierarchyItemId
    {
        const id = new MintedItemId(node.Key, node.ExtObject);
        this.entries.set(id, { node, children: [] });
        return id;
    }

    public NodeAt(id: HierarchyItemId): HierarchyNode
    {
        return this.entry(id).node;
    }

    public ChildrenOf(id: HierarchyItemId): readonly HierarchyItemId[]
    {
        return this.entry(id).children;
    }

    // Fill (or refill) a node's children. Gathers contributors for the node's Key in
    // Order; a NodeContribution stays in the keyed regime (children interned here); a
    // ProviderContribution hands off — the provider is subscribed and the registry is
    // NOT consulted below this node.
    public RealizeChildren(id: HierarchyItemId): void
    {
        const entry = this.entry(id);
        entry.realized = true;
        const contributed = new Set<unknown>();
        for (const contributor of this.registry.For(entry.node.Key))
        {
            const contribution = contributor.Contribute(entry.node);
            if (contribution instanceof ProviderContribution)
            {
                this.attachProvider(id, entry, contribution.Provider);
                return;   // provider owns the subtree — stop consulting the registry
            }
            if (contribution instanceof NodeContribution)
            {
                for (const childNode of contribution.Nodes)
                {
                    contributed.add(childNode.ExtObject);
                    this.internKeyed(id, entry, childNode);
                }
            }
        }
        this.pruneKeyed(id, entry, contributed);
    }

    // Drop keyed children no longer contributed — a contributor was unregistered (its
    // disposer fires Changed -> reRealizeKeyed -> here) or now yields fewer Nodes.
    // Interning keeps survivors' ids; only the absent identities are removed. Never runs
    // for a provider-owned node (RealizeChildren returns before this on a Provider
    // contribution) — a provider prunes its own subtree via ChildRemoved.
    private pruneKeyed(parentId: HierarchyItemId, parent: Entry, contributed: Set<unknown>): void
    {
        const map = this.keyedChildren.get(parentId);
        if (map === undefined) return;
        for (const [identity, childId] of [...map])
        {
            if (contributed.has(identity)) continue;
            map.delete(identity);
            this.entries.delete(childId);
            const i = parent.children.indexOf(childId);
            if (i >= 0) parent.children.splice(i, 1);
            this.emit(parentId, new ChildRemoved(childId));
        }
    }

    public Collapse(id: HierarchyItemId): void
    {
        const entry = this.entry(id);
        if (entry.dispose !== undefined)
        {
            entry.dispose();
            entry.dispose = undefined;
            entry.provider = undefined;
        }
        entry.realized = false;   // a collapsed node re-realizes on next expand, not via reRealizeKeyed
    }

    private attachProvider(id: HierarchyItemId, entry: Entry, provider: IHierarchyProvider): void
    {
        if (entry.provider === provider) return;   // already subscribed
        entry.provider = provider;
        entry.dispose = provider.ObserveChildren(id, (c) => this.patch(id, entry, c));
    }

    private patch(parentId: HierarchyItemId, entry: Entry, change: HierarchyChange): void
    {
        if (entry.dispose === undefined) return;   // collapsed — ignore late deltas
        if (change instanceof ChildAdded)
        {
            this.entries.set(change.Id, { node: change.Node, children: [] });
            entry.children.push(change.Id);
        }
        else if (change instanceof ChildUpdated)
        {
            const e = this.entries.get(change.Id);
            if (e !== undefined) e.node = change.Node;   // refresh in place; id preserved
        }
        else if (change instanceof ChildRemoved)
        {
            const i = entry.children.indexOf(change.Id);
            if (i >= 0) entry.children.splice(i, 1);
            this.entries.delete(change.Id);
        }
        this.emit(parentId, change);
    }

    private internKeyed(parentId: HierarchyItemId, parent: Entry, childNode: HierarchyNode): void
    {
        let map = this.keyedChildren.get(parentId);
        if (map === undefined)
        {
            map = new Map();
            this.keyedChildren.set(parentId, map);
        }
        const identity = childNode.ExtObject;
        let childId = map.get(identity);
        if (childId === undefined)
        {
            childId = new MintedItemId(childNode.Key, childNode.ExtObject);
            map.set(identity, childId);
            this.entries.set(childId, { node: childNode, children: [] });
            parent.children.push(childId);
            this.emit(parentId, new ChildAdded(childId, childNode));
        }
        else
        {
            const existing = this.entry(childId);
            if (HierarchyModel.displayDiffers(existing.node, childNode))
            {
                existing.node = childNode;   // refresh survivor's node data in place
                this.emit(parentId, new ChildUpdated(childId, childNode));
            }
        }
    }

    // Only a change to a rendered fact is worth a ChildUpdated — avoids churn when an
    // unchanged node is re-contributed (reRealizeKeyed re-runs the whole keyed regime).
    private static displayDiffers(a: HierarchyNode, b: HierarchyNode): boolean
    {
        return a.Caption !== b.Caption || a.IconKey !== b.IconKey
            || a.Severity !== b.Severity || a.Error !== b.Error || a.Key !== b.Key;
    }

    private entry(id: HierarchyItemId): Entry
    {
        const e = this.entries.get(id);
        if (e === undefined) throw new Error('HierarchyModel: unknown HierarchyItemId');
        return e;
    }
}
