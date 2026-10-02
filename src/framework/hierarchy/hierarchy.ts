import { Observable, ObservableCollection, CompositeDisposable, ServiceProvider, type IDisposable, type ServiceToken, type IServiceProvider } from '../../runtime/index.js';
import { ItemIdAllocator } from './item-id.js';
import { HierarchyItem, type HierarchyItemInit, type IHierarchyItemOwner, type IHierarchyItemHost } from './hierarchy-item.js';
import { HierarchyContributorRegistry } from './hierarchy-contributor-registry.js';
import { NodeContribution, ProviderContribution, type HierarchyContribution, type IHierarchyContributor } from './hierarchy-contribution.js';
import type { IHierarchyProvider, IRealizeContext } from './hierarchy-provider.js';
import type { HierarchyActionContext } from './hierarchy-action-context.js';
import { CommandRegistry } from '../shell/commands/command-registry.js';
import type { ICommandDispatcher } from '../shell/commands/command-dispatcher.js';
import { CommandMenuBuilder } from '../shell/commands/command-menu-builder.js';
import { CommandViewModel } from '../shell/commands/command-view-model.js';

// Options wiring a Hierarchy's per-node BuildActions onto Milestone A's command
// machinery. All optional — a Hierarchy built with none (the pre-T10 ctor shape)
// keeps BuildActions returning an empty collection for every node.
export interface HierarchyCommandOptions
{
    CommandRegistry?: CommandRegistry;
    Dispatcher?: ICommandDispatcher;
    CommandContexts?: ReadonlyMap<string, ServiceToken<unknown>>;
    Services?: IServiceProvider;
}

// The dispatcher BuildActions falls back to when no HierarchyCommandOptions.Dispatcher
// was supplied — every resolved command is inert (CommandMenuBuilder.Build still
// produces a CommandViewModel, just with an undefined Command).
class NoOpCommandDispatcher implements ICommandDispatcher
{
    public Resolve(): undefined
    {
        return undefined;
    }
}

class Segment
{
    public readonly items: HierarchyItem[] = [];
    public contributor: IHierarchyContributor | undefined;
    public provider: IHierarchyProvider | undefined;
    public providerHandle: IDisposable | undefined;

    constructor(public readonly Order: number)
    {
    }
}

class ParentComposition
{
    public readonly segments: Segment[] = [];
    public readonly teardown = new CompositeDisposable();
}

// The composition engine behind a realized tree: mints HierarchyItem ids, asks the
// HierarchyContributorRegistry what belongs under each realized parent (ordered by
// Order), and projects the root's children onto Roots. Keyed (NodeContribution) nodes
// are interned per (parent, ExtObject) so a Collapse→Realize reuses the surviving
// instance rather than minting a new one; the intern map lives on the Hierarchy
// (internedByParent), not on the per-realize Segment, because the Segment is discarded
// on Collapse while the interning identity must survive it.
export class Hierarchy extends Observable implements IHierarchyItemOwner
{
    private static readonly RootCanonicalName = '/';
    private static readonly CanonicalSeparator = '/';

    public readonly Roots = new ObservableCollection<HierarchyItem>();
    public readonly Selection = new ObservableCollection<HierarchyItem>();
    private readonly allocator = new ItemIdAllocator();
    private readonly composition = new Map<HierarchyItem, ParentComposition>();
    private readonly internedByParent = new Map<HierarchyItem, Map<unknown, HierarchyItem>>();
    private readonly ownerProvider = new Map<HierarchyItem, IHierarchyProvider>();
    private root: HierarchyItem | undefined;
    private _anchor: HierarchyItem | undefined;
    private readonly contributorsSub: IDisposable;
    private disposed = false;

    constructor(
        private readonly registry: HierarchyContributorRegistry,
        private readonly host: IHierarchyItemHost,
        private readonly commandOptions: HierarchyCommandOptions = {},
    )
    {
        super();
        this.contributorsSub = this.registry.PropertyChanged('Contributors').subscribe(() => this.reRealizeAll());
    }

    public SeedRoot(key: string, init: HierarchyItemInit = {}): HierarchyItem
    {
        const root = this.NewItem(key, { ...init, IsExpandable: true });
        this.root = root;
        this.Realize(root);
        return root;
    }

    public NewItem(key: string, init: HierarchyItemInit = {}): HierarchyItem
    {
        return new HierarchyItem(this.allocator.Mint(), key, this, this.host, init);
    }

    public CanonicalNameOf(item: HierarchyItem): string
    {
        if (this.root === undefined || item === this.root || item.Parent === undefined) return '/';
        const parts: string[] = [];
        let cur: HierarchyItem | undefined = item;
        while (cur !== undefined && cur !== this.root)
        {
            parts.unshift(this.segmentOf(cur));
            cur = cur.Parent;
        }
        return '/' + parts.join('/');
    }

    private segmentOf(item: HierarchyItem): string
    {
        const base = item.CanonicalSegment ?? item.Key;
        const owner = this.ownerProvider.get(item);
        return owner !== undefined ? owner.ProviderId + ':' + base : base;
    }

    public get Anchor(): HierarchyItem | undefined { return this._anchor; }

    public SelectSingle(item: HierarchyItem): void
    {
        this.Selection.Clear();
        this.Selection.Add(item);
        this._anchor = item;
    }

    public Toggle(item: HierarchyItem): void
    {
        const at = this.Selection.IndexOf(item);
        if (at >= 0)
        {
            this.Selection.RemoveAt(at);
        }
        else
        {
            this.Selection.Add(item);
            this._anchor = item;
        }
    }

    public Deselect(item: HierarchyItem): void
    {
        const at = this.Selection.IndexOf(item);
        if (at >= 0) this.Selection.RemoveAt(at);
        if (this._anchor === item) this._anchor = undefined;
    }

    public ClearSelection(): void
    {
        this.Selection.Clear();
        this._anchor = undefined;
    }

    public SyncSelection(items: readonly HierarchyItem[], anchor: HierarchyItem | undefined): void
    {
        this.Selection.Clear();
        for (const i of items) this.Selection.Add(i);
        this._anchor = anchor;
    }

    // Walks canonical-name segments from the root, lazily expanding/realizing each
    // hop — including across a provider boundary (segmentOf prefixes ProviderId
    // for provider-owned items) — so a collapsed subtree is re-materialized on
    // the way down instead of requiring everything to already be realized.
    public Reveal(canonicalName: string): HierarchyItem | undefined
    {
        if (this.root === undefined) return undefined;
        if (canonicalName === Hierarchy.RootCanonicalName) return this.root;
        const segments = canonicalName.replace(/^\//, '').split(Hierarchy.CanonicalSeparator);
        let current: HierarchyItem = this.root;
        for (const seg of segments)
        {
            if (!current.IsExpanded && current !== this.root) current.OnExpand();
            else if (current === this.root && !this.composition.has(current)) this.Realize(current);
            const children = current === this.root ? this.Roots.ToArray() : current.Children.ToArray();
            const next = children.find(c => this.segmentOf(c) === seg);
            if (next === undefined) return undefined;
            current = next;
        }
        return current;
    }

    // Builds a FRESH command-view-model tree for `item`'s menu, scoped by its
    // Key: only CommandDefinitions tagged with the ServiceToken that
    // commandOptions.CommandContexts maps `item.Key` to, ordered by Order.
    // No tag for the key, or no CommandRegistry wired in, yields an empty menu.
    // A per-call CommandMenuBuilder means nothing is retained between opens —
    // disposal of the returned VMs is the caller's job (DR6).
    public BuildActions(item: HierarchyItem, context: HierarchyActionContext): ObservableCollection<CommandViewModel>
    {
        const result = new ObservableCollection<CommandViewModel>();
        const token = this.commandOptions.CommandContexts?.get(item.Key);
        const registry = this.commandOptions.CommandRegistry;
        if (token === undefined || registry === undefined) return result;
        const roots = registry.Commands.ToArray()
            .filter(d => d.Context !== undefined && d.Context === token)
            .sort((a, b) => a.Order - b.Order);
        const dispatcher = this.commandOptions.Dispatcher ?? new NoOpCommandDispatcher();
        const services = this.commandOptions.Services ?? new ServiceProvider();
        const builder = new CommandMenuBuilder(dispatcher, services, context);
        for (const root of roots) result.Add(builder.Build(root));
        return result;
    }

    public OnItemDisposed(item: HierarchyItem): void
    {
        this.composition.delete(item);
        this.internedByParent.delete(item);
        this.ownerProvider.delete(item);
    }

    public Realize(item: HierarchyItem): void
    {
        if (this.composition.has(item)) return;
        const owner = this.ownerProvider.get(item);
        if (owner !== undefined)
        {
            const ownedComp = new ParentComposition();
            this.composition.set(item, ownedComp);
            const segment = new Segment(0);
            segment.provider = owner;
            this.insertSegment(ownedComp, segment);
            const ctx = new RealizeContext(this, item, segment);
            const handle = owner.Realize(item, ctx);
            segment.providerHandle = handle;
            ownedComp.teardown.add(handle);
            const injected = this.registry.For(item.Key)
                .map(c => c.Contribute(item))
                .filter((x): x is NodeContribution => x instanceof NodeContribution);
            if (injected.length > 0) owner.Integrate(item, injected);
            return;
        }
        const comp = new ParentComposition();
        this.composition.set(item, comp);
        for (const contributor of this.registry.For(item.Key))
        {
            const segment = new Segment(contributor.Order);
            segment.contributor = contributor;
            this.insertSegment(comp, segment);
            this.applyContribution(item, segment, contributor.Contribute(item));
        }
    }

    public Collapse(item: HierarchyItem): void
    {
        const comp = this.composition.get(item);
        if (comp === undefined) return;
        for (const segment of [...comp.segments])
        {
            for (const child of [...segment.items]) this.removeFromSegment(item, segment, child);
        }
        comp.teardown.dispose();
        this.composition.delete(item);
    }

    public ChildrenOf(item: HierarchyItem): readonly HierarchyItem[]
    {
        return item === this.root ? this.Roots.ToArray() : item.Children.ToArray();
    }

    public dispose(): void
    {
        if (this.disposed) return;
        this.disposed = true;
        this.contributorsSub.dispose();
        for (const comp of this.composition.values()) comp.teardown.dispose();
        this.composition.clear();
        this.internedByParent.clear();
        this.ownerProvider.clear();
        this.Selection.Clear();
        this.Roots.Clear();
    }

    // --- internals shared by T5–T7 ---

    protected applyContribution(parent: HierarchyItem, segment: Segment, contribution: HierarchyContribution): void
    {
        if (contribution instanceof NodeContribution)
        {
            const interned = this.internedFor(parent);
            for (const node of contribution.Nodes)
            {
                const existing = interned.get(node.ExtObject);
                const child = existing ?? this.NewItem(node.Key, node);
                child.ExtObject = node.ExtObject;
                child.Parent = parent;
                interned.set(node.ExtObject, child);
                this.insertIntoSegment(parent, segment, child);
            }
        }
        else if (contribution instanceof ProviderContribution)
        {
            this.attachProvider(parent, segment, contribution);   // T5
        }
    }

    protected attachProvider(parent: HierarchyItem, segment: Segment, contribution: ProviderContribution): void
    {
        const comp = this.composition.get(parent);
        if (comp === undefined) return;
        segment.provider = contribution.Provider;
        const ctx = new RealizeContext(this, parent, segment);
        const handle = contribution.Provider.Realize(parent, ctx);
        segment.providerHandle = handle;
        comp.teardown.add(handle);
    }

    public InsertIntoSegmentPublic(parent: HierarchyItem, segment: Segment, child: HierarchyItem): void
    {
        this.insertIntoSegment(parent, segment, child);
    }

    public RemoveFromSegmentPublic(parent: HierarchyItem, segment: Segment, child: HierarchyItem): void
    {
        this.removeFromSegment(parent, segment, child);
    }

    private reRealizeAll(): void
    {
        for (const parent of [...this.composition.keys()]) this.reRealize(parent);
    }

    private reRealize(parent: HierarchyItem): void
    {
        if (this.ownerProvider.has(parent)) return;   // owner-realized subtree: the provider owns reconciliation
        const comp = this.composition.get(parent);
        if (comp === undefined) return;
        const desired = this.registry.For(parent.Key);
        const desiredSet = new Set(desired);
        for (const segment of [...comp.segments])
        {
            if (segment.contributor !== undefined && !desiredSet.has(segment.contributor))
            {
                this.disposeSegment(parent, comp, segment);
            }
        }
        const present = new Set(comp.segments.map(s => s.contributor));
        for (const contributor of desired)
        {
            if (present.has(contributor)) continue;
            const segment = new Segment(contributor.Order);
            segment.contributor = contributor;
            this.insertSegment(comp, segment);
            this.applyContribution(parent, segment, contributor.Contribute(parent));
        }
    }

    private disposeSegment(parent: HierarchyItem, comp: ParentComposition, segment: Segment): void
    {
        for (const child of [...segment.items])
        {
            this.removeFromSegment(parent, segment, child);
            this.ownerProvider.delete(child);
        }
        segment.providerHandle?.dispose();
        const at = comp.segments.indexOf(segment);
        if (at >= 0) comp.segments.splice(at, 1);
    }

    private internedFor(parent: HierarchyItem): Map<unknown, HierarchyItem>
    {
        let m = this.internedByParent.get(parent);
        if (m === undefined) { m = new Map(); this.internedByParent.set(parent, m); }
        return m;
    }

    private insertSegment(comp: ParentComposition, segment: Segment): void
    {
        let i = 0;
        while (i < comp.segments.length)
        {
            const current = comp.segments[i];
            if (current === undefined || current.Order > segment.Order) break;
            i += 1;
        }
        comp.segments.splice(i, 0, segment);
    }

    private flatBaseOf(comp: ParentComposition, segment: Segment): number
    {
        let base = 0;
        for (const s of comp.segments)
        {
            if (s === segment) break;
            base += s.items.length;
        }
        return base;
    }

    protected insertIntoSegment(parent: HierarchyItem, segment: Segment, child: HierarchyItem): void
    {
        const comp = this.composition.get(parent);
        if (comp === undefined || segment.items.includes(child)) return;
        const within = segment.items.length;
        segment.items.push(child);
        if (segment.provider !== undefined) this.ownerProvider.set(child, segment.provider);
        const target = parent === this.root ? this.Roots : parent.Children;
        target.Insert(this.flatBaseOf(comp, segment) + within, child);
    }

    protected removeFromSegment(parent: HierarchyItem, segment: Segment, child: HierarchyItem): void
    {
        const at = segment.items.indexOf(child);
        if (at < 0) return;
        segment.items.splice(at, 1);
        const target = parent === this.root ? this.Roots : parent.Children;
        const flatAt = target.IndexOf(child);
        if (flatAt >= 0) target.RemoveAt(flatAt);
        this.Deselect(child);
    }
}

// The Order-scoped child sink handed to an IHierarchyProvider.Realize. InsertChild /
// RemoveChild route through the owning Hierarchy's InsertIntoSegmentPublic /
// RemoveFromSegmentPublic shims so a child — even one arriving asynchronously, long
// after Realize returned — lands inside this provider's own Segment (flatBaseOf(segment)
// + within), not appended after whatever segment currently sits last.
class RealizeContext implements IRealizeContext
{
    constructor(
        private readonly hierarchy: Hierarchy,
        private readonly parent: HierarchyItem,
        private readonly segment: Segment,
    )
    {
    }

    public NewItem(key: string, init?: HierarchyItemInit): HierarchyItem
    {
        return this.hierarchy.NewItem(key, init);
    }

    public InsertChild(child: HierarchyItem): void
    {
        child.Parent = this.parent;
        this.hierarchy.InsertIntoSegmentPublic(this.parent, this.segment, child);
    }

    public RemoveChild(child: HierarchyItem): void
    {
        this.hierarchy.RemoveFromSegmentPublic(this.parent, this.segment, child);
    }
}
