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

    constructor(private readonly registry: HierarchyContributorRegistry)
    {
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
                for (const childNode of contribution.Nodes) this.internKeyed(id, entry, childNode);
            }
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
    }

    private attachProvider(id: HierarchyItemId, entry: Entry, provider: IHierarchyProvider): void
    {
        if (entry.provider === provider) return;   // already subscribed
        entry.provider = provider;
        entry.dispose = provider.ObserveChildren(id, (c) => this.patch(entry, c));
    }

    private patch(entry: Entry, change: HierarchyChange): void
    {
        if (entry.dispose === undefined) return;   // collapsed — ignore late deltas
        if (change instanceof ChildAdded)
        {
            const childId = new MintedItemId(change.Node.Key, change.Node.ExtObject);
            this.entries.set(childId, { node: change.Node, children: [] });
            entry.children.push(childId);
        }
        else if (change instanceof ChildUpdated)
        {
            // Identity preserved; a node-data refresh (caption/icon) lands here. No
            // structural change — the id stays, so selection/expansion survive.
        }
        else if (change instanceof ChildRemoved)
        {
            const i = entry.children.indexOf(change.Id);
            if (i >= 0) entry.children.splice(i, 1);
            this.entries.delete(change.Id);
        }
    }

    private internKeyed(parentId: HierarchyItemId, parent: Entry, childNode: HierarchyNode): void
    {
        let map = this.keyedChildren.get(parentId);
        if (map === undefined) { map = new Map(); this.keyedChildren.set(parentId, map); }
        const identity = childNode.ExtObject;
        let childId = map.get(identity);
        if (childId === undefined)
        {
            childId = new MintedItemId(childNode.Key, childNode.ExtObject);
            map.set(identity, childId);
            this.entries.set(childId, { node: childNode, children: [] });
            parent.children.push(childId);
        }
        else
        {
            this.entry(childId).node = childNode;   // refresh survivor's node data in place
        }
    }

    private entry(id: HierarchyItemId): Entry
    {
        const e = this.entries.get(id);
        if (e === undefined) throw new Error('HierarchyModel: unknown HierarchyItemId');
        return e;
    }
}
