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
    fake.Sink!(new ChildAdded(HierarchyItemId.Mint(), node('file', { id: 'f1' })));    // initial load
    assert.equal(model.ChildrenOf(root).length, 1);
    fake.Sink!(new ChildAdded(HierarchyItemId.Mint(), node('file', { id: 'f2' })));    // later external add — SAME channel
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
    fake.Sink!(new ChildAdded(HierarchyItemId.Mint(), node('file', { id: 'f1' }, 'old')));
    const id = model.ChildrenOf(root)[0];
    fake.Sink!(new ChildUpdated(id, node('file', { id: 'f1' }, 'renamed')));
    assert.equal(model.ChildrenOf(root)[0], id);               // same identity
    assert.equal(model.NodeAt(id).Caption, 'renamed');         // refreshed in place
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
    fake.Sink!(new ChildAdded(HierarchyItemId.Mint(), node('file', {})));
    assert.equal(model.ChildrenOf(root).length, 0);
});

test('provider-supplied id: ChildAdded carries the id; ChildUpdated(id, node) refreshes in place', () =>
{
    const provider = new ServiceProvider();
    const fake = new FakeProvider();
    const tok = new ServiceKey<IHierarchyContributor>('files');
    provider.registerInstance(tok, { ParentKeys: ['project'], Order: 0,
        Contribute: () => new ProviderContribution(fake) } as IHierarchyContributor);
    const model = new HierarchyModel(registryWith(provider, [{ token: tok, parents: ['project'] }]));
    const root = model.SeedRoot(node('project', {}));
    model.RealizeChildren(root);

    const id = HierarchyItemId.Mint();
    fake.Sink!(new ChildAdded(id, node('file', { id: 'f1' }, 'old')));
    assert.equal(model.ChildrenOf(root)[0], id);                       // the SAME id instance is stored
    assert.equal(model.NodeAt(id).Caption, 'old');

    fake.Sink!(new ChildUpdated(id, node('file', { id: 'f1' }, 'new')));
    assert.equal(model.ChildrenOf(root)[0], id);                       // identity preserved
    assert.equal(model.NodeAt(id).Caption, 'new');                     // caption refreshed in place

    fake.Sink!(new ChildRemoved(id));
    assert.equal(model.ChildrenOf(root).length, 0);                    // same id instance removes
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

// ── P6b: full ancestor-path canonical names + Reveal ────────────────────────

class OneChildProvider implements IHierarchyProvider
{
    public readonly ProviderId = 'fake-canonical';
    public readonly Child = HierarchyItemId.Mint();
    private sink: ((c: HierarchyChange) => void) | undefined;
    constructor(private readonly relative: string) {}
    // Store the sink; emit only via Emit() AFTER RealizeChildren returns — the model assigns
    // entry.dispose from ObserveChildren's return, so a delta fired synchronously here would be
    // dropped by patch's collapsed-guard. (Mirrors this file's FakeProvider.)
    public ObserveChildren(_node: HierarchyItemId, sink: (c: HierarchyChange) => void): () => void
    {
        this.sink = sink;
        return () => { this.sink = undefined; };
    }
    public Emit(): void
    {
        this.sink?.(new ChildAdded(this.Child, { Key: 'file', Caption: 'f', IconKey: '', ExtObject: {}, Severity: NodeSeverity.Ok }));
    }
    public GetProperty(): unknown { return undefined; }
    public GetCanonicalName(id: HierarchyItemId): string { return id === this.Child ? this.relative : ''; }
    public ParseCanonicalName(name: string): HierarchyItemId { return name === this.relative ? this.Child : HierarchyItemId.Nil; }
    public CanAccept(): boolean { return false; }
}

// solution -> project (keyed, CanonicalSegment `segment`) -> provider boundary. The default
// segment './p1' embeds the '/' separator (as real member paths can), which CanonicalNameOf
// handles fine; Reveal, which PARSES names by splitting on '/', is best-effort and is exercised
// with a separator-free segment.
function canonicalModel(provider: OneChildProvider, segment = './p1'): { model: HierarchyModel; root: HierarchyItemId }
{
    const sp = new ServiceProvider();
    const listing = new ServiceKey<IHierarchyContributor>('listing-c');
    sp.registerInstance(listing, { ParentKeys: ['solution'], Order: 0,
        Contribute: () => new NodeContribution([{ Key: 'project', Caption: 'P', IconKey: '', ExtObject: {}, Severity: NodeSeverity.Ok, CanonicalSegment: segment }]) } as IHierarchyContributor);
    const files = new ServiceKey<IHierarchyContributor>('files-c');
    sp.registerInstance(files, { ParentKeys: ['project'], Order: 0,
        Contribute: () => new ProviderContribution(provider) } as IHierarchyContributor);
    const registry = new HierarchyContributorRegistry(sp);
    for (const [key, pk] of [[listing, 'solution'], [files, 'project']] as const)
    {
        const d = new HierarchyContributorDefinition(); d.ParentKeys = [pk]; d.Contributor = key; d.Order = 0; registry.Register(d);
    }
    const model = new HierarchyModel(registry);
    const root = model.SeedRoot({ Key: 'solution', Caption: 'S', IconKey: '', ExtObject: {}, Severity: NodeSeverity.Ok });
    return { model, root };
}

test('CanonicalNameOf composes the keyed ancestor path using CanonicalSegment', () =>
{
    const { model, root } = canonicalModel(new OneChildProvider('src/app.ts'));
    model.RealizeChildren(root);
    const projectId = model.ChildrenOf(root)[0]!;
    assert.equal(model.CanonicalNameOf(projectId), 'solution/./p1');
});

test('CanonicalNameOf delegates the provider-owned suffix to the owner', () =>
{
    const provider = new OneChildProvider('src/app.ts');
    const { model, root } = canonicalModel(provider);
    model.RealizeChildren(root);
    const projectId = model.ChildrenOf(root)[0]!;
    model.RealizeChildren(projectId);   // subscribes the provider (dispose now assigned)
    provider.Emit();                    // provider emits its child
    const fileId = model.ChildrenOf(projectId)[0]!;
    assert.equal(model.CanonicalNameOf(fileId), 'solution/./p1/src/app.ts');
});

test('CanonicalNameOf yields empty (graceful loss) for a provider node with no relative name', () =>
{
    const provider = new OneChildProvider('');   // provider offers no canonical suffix for its child
    const { model, root } = canonicalModel(provider);
    model.RealizeChildren(root);
    const projectId = model.ChildrenOf(root)[0]!;
    model.RealizeChildren(projectId);
    provider.Emit();
    const fileId = model.ChildrenOf(projectId)[0]!;
    // The node has no distinct canonical identity, so it is unnamed — NOT the bare boundary
    // prefix, which would collide with the project row and over-expand on restore.
    assert.equal(model.CanonicalNameOf(fileId), '');
});

test('Reveal descends and realizes a collapsed keyed target', () =>
{
    const { model } = canonicalModel(new OneChildProvider('src/app.ts'), 'p1');   // nothing realized yet
    const projectId = model.Reveal('solution/p1');
    assert.notEqual(projectId, HierarchyItemId.Nil);
    assert.equal(model.CanonicalNameOf(projectId), 'solution/p1');
});

test('Reveal returns Nil for an unknown name and an unrealized provider target', () =>
{
    const { model } = canonicalModel(new OneChildProvider('src/app.ts'), 'p1');
    assert.equal(model.Reveal('solution/nope'), HierarchyItemId.Nil);
    assert.equal(model.Reveal('solution/p1/does/not/exist'), HierarchyItemId.Nil);
});
