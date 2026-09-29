import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceProvider, ServiceKey } from '../../../runtime/index.js';
import {
    HierarchyModel, HierarchyContributorRegistry, HierarchyContributorDefinition,
    NodeContribution, ProviderContribution, ChildAdded, ChildUpdated, ChildRemoved,
    NodeSeverity, HierarchyItemId,
    type IHierarchyContributor, type IHierarchyProvider, type HierarchyNode, type HierarchyChange,
} from '../index.js';

function node(key: string, ext: unknown, caption = key): HierarchyNode
{
    return { Key: key, Caption: caption, IconKey: '', ExtObject: ext, Severity: NodeSeverity.Ok };
}

class FakeProvider implements IHierarchyProvider
{
    public readonly ProviderId = 'fake';
    public Sink: ((c: HierarchyChange) => void) | undefined;
    public ObserveChildren(_n: HierarchyItemId, sink: (c: HierarchyChange) => void): () => void
    {
        this.Sink = sink;
        return () => { this.Sink = undefined; };
    }
    public GetProperty(): unknown { return undefined; }
    public GetCanonicalName(): string { return ''; }
    public ParseCanonicalName(): HierarchyItemId { return HierarchyItemId.Nil; }
    public CanAccept(): boolean { return false; }
}

function reg(provider: ServiceProvider): HierarchyContributorRegistry
{
    return new HierarchyContributorRegistry(provider);
}

function registerContributor(registry: HierarchyContributorRegistry, token: ServiceKey<IHierarchyContributor>, parents: string[]): () => void
{
    const d = new HierarchyContributorDefinition();
    d.ParentKeys = parents; d.Contributor = token; d.Order = 0;
    return registry.Register(d);
}

test('ObserveChildren emits ChildAdded when keyed realize interns a child', () =>
{
    const provider = new ServiceProvider();
    const listing = new ServiceKey<IHierarchyContributor>('listing');
    provider.registerInstance(listing, { ParentKeys: ['solution'], Order: 0,
        Contribute: () => new NodeContribution([node('project', { id: 'p' })]) } as IHierarchyContributor);
    const registry = reg(provider);
    registerContributor(registry, listing, ['solution']);
    const model = new HierarchyModel(registry);
    const root = model.SeedRoot(node('solution', {}));

    const seen: HierarchyChange[] = [];
    model.ObserveChildren(root, (c) => seen.push(c));
    model.RealizeChildren(root);                             // interns the member -> emits ChildAdded

    assert.equal(seen.length, 1);
    assert.ok(seen[0] instanceof ChildAdded);
});

test('ObserveChildren forwards provider deltas (add/update/remove)', () =>
{
    const provider = new ServiceProvider();
    const fake = new FakeProvider();
    const tok = new ServiceKey<IHierarchyContributor>('files');
    provider.registerInstance(tok, { ParentKeys: ['project'], Order: 0,
        Contribute: () => new ProviderContribution(fake) } as IHierarchyContributor);
    const registry = reg(provider);
    registerContributor(registry, tok, ['project']);
    const model = new HierarchyModel(registry);
    const root = model.SeedRoot(node('project', {}));

    const seen: HierarchyChange[] = [];
    model.ObserveChildren(root, (c) => seen.push(c));
    model.RealizeChildren(root);
    const id = HierarchyItemId.Mint();
    fake.Sink!(new ChildAdded(id, node('file', {}, 'a')));
    fake.Sink!(new ChildUpdated(id, node('file', {}, 'b')));
    fake.Sink!(new ChildRemoved(id));

    assert.deepEqual(seen.map((c) => c.constructor.name), ['ChildAdded', 'ChildUpdated', 'ChildRemoved']);
});

test('reRealizeKeyed does NOT re-realize an unexpanded keyed child (no eager provider mount)', () =>
{
    const provider = new ServiceProvider();
    const memberExt = { id: 'p' };                     // STABLE identity so the member survives re-contribute
    const listing = new ServiceKey<IHierarchyContributor>('listing');
    provider.registerInstance(listing, { ParentKeys: ['solution'], Order: 0,
        Contribute: () => new NodeContribution([node('project', memberExt)]) } as IHierarchyContributor);
    let fileConsulted = 0;
    const files = new ServiceKey<IHierarchyContributor>('files');
    provider.registerInstance(files, { ParentKeys: ['project'], Order: 0,
        Contribute: () => { fileConsulted++; return new NodeContribution([]); } } as IHierarchyContributor);
    const registry = reg(provider);
    registerContributor(registry, listing, ['solution']);
    registerContributor(registry, files, ['project']);
    const model = new HierarchyModel(registry);
    const root = model.SeedRoot(node('solution', {}));
    model.RealizeChildren(root);                       // realizes root; member entry created (stable), NOT realized
    assert.equal(fileConsulted, 0);

    // A contributor-set change re-realizes only realized keyed nodes (root). The surviving member
    // entry is NOT realized, so its file contributor must NOT be consulted (no eager provider mount).
    const off = registerContributor(registry, files, ['project']);   // fires Changed -> reRealizeKeyed
    off();
    assert.equal(fileConsulted, 0);
});

test('unsubscribe stops emissions', () =>
{
    const provider = new ServiceProvider();
    const fake = new FakeProvider();
    const tok = new ServiceKey<IHierarchyContributor>('files');
    provider.registerInstance(tok, { ParentKeys: ['project'], Order: 0,
        Contribute: () => new ProviderContribution(fake) } as IHierarchyContributor);
    const registry = reg(provider);
    registerContributor(registry, tok, ['project']);
    const model = new HierarchyModel(registry);
    const root = model.SeedRoot(node('project', {}));
    const seen: HierarchyChange[] = [];
    const off = model.ObserveChildren(root, (c) => seen.push(c));
    model.RealizeChildren(root);
    off();
    fake.Sink!(new ChildAdded(HierarchyItemId.Mint(), node('file', {})));
    assert.equal(seen.length, 0);
});
