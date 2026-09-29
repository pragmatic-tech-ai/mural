import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceProvider, ServiceKey } from '../../../runtime/index.js';
import {
    HierarchyModel, HierarchyContributorRegistry, HierarchyContributorDefinition,
    NodeContribution, ProviderContribution, ChildAdded, ChildUpdated, ChildRemoved, NodeSeverity, HierarchyItemId,
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

// Collapsing an expanded row must release its provider subscription — that is what
// drops the mounted ProjectContentStore's file watcher (last observer unsubscribes) —
// and restore the Loading… sentinel so the row stays expandable and reloads on the
// next expand. Without this, watchers accumulate until solution swap.
test('OnCollapse releases the provider subscription and restores the sentinel', () =>
{
    const { model, root, fake } = fileModel();
    const vm = new HierarchyItemVM(model, root, undefined, () => {});
    vm.OnExpand();
    assert.ok(fake.Sink !== undefined);                 // provider subscribed on expand
    fake.Sink!(new ChildAdded(HierarchyItemId.Mint(), node('file', { id: 'f1' }, 'a')));
    assert.equal(vm.Children.Count, 1);

    vm.OnCollapse();
    assert.equal(fake.Sink, undefined);                 // provider unsubscribed → watcher released
    assert.equal(vm.Children.Count, 1);                 // sentinel restored (row stays expandable)
    assert.equal(vm.Children.Get(0)!.Caption, 'Loading…');

    vm.OnExpand();                                      // re-expands: re-subscribes the provider
    assert.ok(fake.Sink !== undefined);
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

// A member row created while its member is still Unopened (IsExpandable=false) must
// gain an expand affordance once the member resolves — a re-contribute that changes
// ONLY IsExpandable (Caption/IconKey/Severity unchanged) has to reach the row: the
// model must emit ChildUpdated (displayDiffers includes IsExpandable) and the VM must
// reconcile its Loading… placeholder + re-raise IsExpandable. Otherwise resolved
// projects show no chevron and can never be expanded.
test('a row that becomes expandable after creation gains a chevron (Unopened→Resolved)', () =>
{
    const provider = new ServiceProvider();
    const registry = new HierarchyContributorRegistry(provider);
    const ext = { id: 'm1' };
    let expandable = false;
    const contributor: IHierarchyContributor =
    {
        ParentKeys: ['root'],
        Order: 0,
        Contribute: (n: HierarchyNode) => n.Key === 'root'
            ? new NodeContribution([{ Key: 'member', Caption: 'M', IconKey: 'member', ExtObject: ext, Severity: NodeSeverity.Ok, IsExpandable: expandable }])
            : new NodeContribution([]),
    };
    registry.RegisterInstance(contributor);
    const model = new HierarchyModel(registry);
    const root = model.SeedRoot(node('root', { id: 'r' }, 'Root'));
    const vm = new HierarchyItemVM(model, root, undefined, () => {});
    vm.OnExpand();

    const memberRow = vm.Children.Get(0)!;
    assert.equal(memberRow.IsExpandable, false);
    assert.equal(memberRow.Children.Count, 0);          // no placeholder → no chevron yet
    let expandableRaised = 0;
    memberRow.PropertyChanged('IsExpandable').subscribe(() => { expandableRaised++; });

    expandable = true;                                  // the member resolves
    registry.NotifyContributionsChanged();              // → re-contribute the same member

    assert.equal(memberRow.IsExpandable, true);
    assert.equal(memberRow.Children.Count, 1);          // Loading… sentinel seeded → chevron
    assert.ok(expandableRaised > 0);
});
