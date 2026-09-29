import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceProvider, ServiceKey } from '../../../runtime/index.js';
import {
    HierarchyModel, HierarchyContributorRegistry, HierarchyContributorDefinition,
    ProviderContribution, ChildAdded, ChildUpdated, ChildRemoved, NodeSeverity, HierarchyItemId,
    HierarchyItemVM,
    type IHierarchyContributor, type IHierarchyProvider, type HierarchyNode, type HierarchyChange,
} from '../index.js';

function node(key: string, ext: unknown, caption = key, sev = NodeSeverity.Ok): HierarchyNode
{
    return { Key: key, Caption: caption, IconKey: key, ExtObject: ext, Severity: sev };
}

class FakeProvider implements IHierarchyProvider
{
    public readonly ProviderId = 'fake';
    public Sink: ((c: HierarchyChange) => void) | undefined;
    public ObserveChildren(_n: HierarchyItemId, sink: (c: HierarchyChange) => void): () => void
    {
        this.Sink = sink; return () => { this.Sink = undefined; };
    }
    public GetProperty(): unknown { return undefined; }
    public GetCanonicalName(): string { return ''; }
    public ParseCanonicalName(): HierarchyItemId { return HierarchyItemId.Nil; }
    public CanAccept(): boolean { return false; }
}

function fileModel(): { model: HierarchyModel; root: HierarchyItemId; fake: FakeProvider }
{
    const provider = new ServiceProvider();
    const fake = new FakeProvider();
    const tok = new ServiceKey<IHierarchyContributor>('files');
    provider.registerInstance(tok, { ParentKeys: ['project'], Order: 0,
        Contribute: () => new ProviderContribution(fake) } as IHierarchyContributor);
    const registry = new HierarchyContributorRegistry(provider);
    const d = new HierarchyContributorDefinition();
    d.ParentKeys = ['project']; d.Contributor = tok; d.Order = 0;
    registry.Register(d);
    const model = new HierarchyModel(registry);
    const root = model.SeedRoot(node('project', { id: 'p' }, 'Proj'));
    return { model, root, fake };
}

test('reads node props from the model', () =>
{
    const { model, root } = fileModel();
    const vm = new HierarchyItemVM(model, root, undefined, () => {});
    assert.equal(vm.Caption, 'Proj');
    assert.equal(vm.IconKey, 'project');
    assert.equal(vm.Severity, NodeSeverity.Ok);
});

test('OnExpand realizes + subscribes; ChildAdded inserts a child VM at the model index', () =>
{
    const { model, root, fake } = fileModel();
    const vm = new HierarchyItemVM(model, root, undefined, () => {});
    vm.OnExpand();
    assert.equal(vm.Children.Count, 0);
    fake.Sink!(new ChildAdded(HierarchyItemId.Mint(), node('file', { id: 'f1' }, 'a')));
    assert.equal(vm.Children.Count, 1);
    assert.equal(vm.Children.Get(0)!.Caption, 'a');
});

test('ChildUpdated refreshes the same child VM in place (no remove/re-add)', () =>
{
    const { model, root, fake } = fileModel();
    const vm = new HierarchyItemVM(model, root, undefined, () => {});
    vm.OnExpand();
    const id = HierarchyItemId.Mint();
    fake.Sink!(new ChildAdded(id, node('file', { id: 'f1' }, 'old')));
    const child = vm.Children.Get(0)!;
    let repainted = 0;
    child.PropertyChanged('Caption').subscribe(() => { repainted++; });
    fake.Sink!(new ChildUpdated(id, node('file', { id: 'f1' }, 'new')));
    assert.equal(vm.Children.Get(0), child);          // same VM instance
    assert.equal(child.Caption, 'new');               // refreshed via the model
    assert.ok(repainted > 0);                         // and repainted
});

test('ChildRemoved drops the child VM', () =>
{
    const { model, root, fake } = fileModel();
    const vm = new HierarchyItemVM(model, root, undefined, () => {});
    vm.OnExpand();
    const id = HierarchyItemId.Mint();
    fake.Sink!(new ChildAdded(id, node('file', {}, 'a')));
    fake.Sink!(new ChildRemoved(id));
    assert.equal(vm.Children.Count, 0);
});

test('OnActivate relays this VM to the injected callback', () =>
{
    const { model, root } = fileModel();
    let activated: HierarchyItemVM | undefined;
    const vm = new HierarchyItemVM(model, root, undefined, (v) => { activated = v; });
    vm.OnActivate();
    assert.equal(activated, vm);
});

test('child VMs carry Parent and Data', () =>
{
    const { model, root, fake } = fileModel();
    const vm = new HierarchyItemVM(model, root, undefined, () => {});
    vm.OnExpand();
    const ext = { id: 'f1' };
    fake.Sink!(new ChildAdded(HierarchyItemId.Mint(), node('file', ext, 'a')));
    const child = vm.Children.Get(0)!;
    assert.equal(child.Parent, vm);
    assert.equal(child.Data, ext);
});
