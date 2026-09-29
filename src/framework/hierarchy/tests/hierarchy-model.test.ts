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

// A provider whose ObserveChildren emits controllable deltas and records disposal.
class FakeProvider implements IHierarchyProvider
{
    public readonly ProviderId = 'fake';
    public Sink: ((c: HierarchyChange) => void) | undefined;
    public Disposed = false;
    public ObserveChildren(_n: HierarchyItemId, sink: (c: HierarchyChange) => void): () => void
    {
        this.Sink = sink;
        return () => { this.Disposed = true; };
    }
    public GetProperty(): unknown { return undefined; }
    public GetCanonicalName(): string { return ''; }
    public ParseCanonicalName(): HierarchyItemId { return HierarchyItemId.Nil; }
    public CanAccept(): boolean { return false; }
}

function registryWith(provider: ServiceProvider, contributors: { token: ServiceKey<IHierarchyContributor>, parents: string[] }[]): HierarchyContributorRegistry
{
    const reg = new HierarchyContributorRegistry(provider);
    for (const c of contributors)
    {
        const d = new HierarchyContributorDefinition();
        d.ParentKeys = c.parents; d.Contributor = c.token; d.Order = 0;
        reg.Register(d);
    }
    return reg;
}

test('realize = subscribe: initial ChildAdded and a later ChildAdded patch the same collection', () =>
{
    const provider = new ServiceProvider();
    const fake = new FakeProvider();
    const tok = new ServiceKey<IHierarchyContributor>('files');
    provider.registerInstance(tok, { ParentKeys: ['project'], Order: 0,
        Contribute: () => new ProviderContribution(fake) } as IHierarchyContributor);
    const model = new HierarchyModel(registryWith(provider, [{ token: tok, parents: ['project'] }]));

    const root = model.SeedRoot(node('project', { id: 'p' }));
    model.RealizeChildren(root);
    assert.equal(model.ChildrenOf(root).length, 0);            // nothing yet — subscribed, no deltas
    fake.Sink!(new ChildAdded(node('file', { id: 'f1' })));    // initial load
    assert.equal(model.ChildrenOf(root).length, 1);
    fake.Sink!(new ChildAdded(node('file', { id: 'f2' })));    // later external add — SAME channel
    assert.equal(model.ChildrenOf(root).length, 2);
});

test('ChildUpdated keeps the same id (selection survives); ChildRemoved drops it', () =>
{
    const provider = new ServiceProvider();
    const fake = new FakeProvider();
    const tok = new ServiceKey<IHierarchyContributor>('files');
    provider.registerInstance(tok, { ParentKeys: ['project'], Order: 0,
        Contribute: () => new ProviderContribution(fake) } as IHierarchyContributor);
    const model = new HierarchyModel(registryWith(provider, [{ token: tok, parents: ['project'] }]));
    const root = model.SeedRoot(node('project', {}));
    model.RealizeChildren(root);
    fake.Sink!(new ChildAdded(node('file', { id: 'f1' }, 'old')));
    const id = model.ChildrenOf(root)[0];
    fake.Sink!(new ChildUpdated(id));
    assert.equal(model.ChildrenOf(root)[0], id);               // same identity
    fake.Sink!(new ChildRemoved(id));
    assert.equal(model.ChildrenOf(root).length, 0);
});

test('keyed regime: NodeContribution children come from the registry; provider boundary stops it', () =>
{
    const provider = new ServiceProvider();
    const listing = new ServiceKey<IHierarchyContributor>('listing');
    provider.registerInstance(listing, { ParentKeys: ['solution'], Order: 0,
        Contribute: () => new NodeContribution([node('project', { id: 'p' })]) } as IHierarchyContributor);
    const files = new ServiceKey<IHierarchyContributor>('files');
    const fake = new FakeProvider();
    provider.registerInstance(files, { ParentKeys: ['project'], Order: 0,
        Contribute: () => new ProviderContribution(fake) } as IHierarchyContributor);
    let projectConsulted = 0;
    const spy = new ServiceKey<IHierarchyContributor>('spy');
    provider.registerInstance(spy, { ParentKeys: ['project'], Order: 1,
        Contribute: () => { projectConsulted++; return new NodeContribution([]); } } as IHierarchyContributor);

    const model = new HierarchyModel(registryWith(provider, [
        { token: listing, parents: ['solution'] },
        { token: files, parents: ['project'] },
        { token: spy, parents: ['project'] },
    ]));
    const root = model.SeedRoot(node('solution', {}));
    model.RealizeChildren(root);
    const projectId = model.ChildrenOf(root)[0];
    model.RealizeChildren(projectId);
    assert.equal(projectConsulted, 0);   // registry not consulted below a provider boundary
});

test('collapse disposes the provider subscription; later deltas are ignored', () =>
{
    const provider = new ServiceProvider();
    const fake = new FakeProvider();
    const tok = new ServiceKey<IHierarchyContributor>('files');
    provider.registerInstance(tok, { ParentKeys: ['project'], Order: 0,
        Contribute: () => new ProviderContribution(fake) } as IHierarchyContributor);
    const model = new HierarchyModel(registryWith(provider, [{ token: tok, parents: ['project'] }]));
    const root = model.SeedRoot(node('project', {}));
    model.RealizeChildren(root);
    model.Collapse(root);
    assert.equal(fake.Disposed, true);
    fake.Sink!(new ChildAdded(node('file', {})));
    assert.equal(model.ChildrenOf(root).length, 0);
});

test('stable identity: same (parent,key,ExtObject) re-realized keeps the id', () =>
{
    const provider = new ServiceProvider();
    const ext = { id: 'p' };
    const listing = new ServiceKey<IHierarchyContributor>('listing');
    provider.registerInstance(listing, { ParentKeys: ['solution'], Order: 0,
        Contribute: () => new NodeContribution([node('project', ext)]) } as IHierarchyContributor);
    const model = new HierarchyModel(registryWith(provider, [{ token: listing, parents: ['solution'] }]));
    const root = model.SeedRoot(node('solution', {}));
    model.RealizeChildren(root);
    const first = model.ChildrenOf(root)[0];
    model.RealizeChildren(root);
    assert.equal(model.ChildrenOf(root)[0], first);
});
