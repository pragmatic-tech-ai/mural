import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceProvider, ServiceKey } from '../../../runtime/index.js';
import {
    HierarchyContributorRegistry, HierarchyContributorDefinition, NodeContribution,
    HierarchyModel, NodeSeverity,
    type IHierarchyContributor, type HierarchyNode,
} from '../index.js';

function pnode(key: string, ext: unknown, caption = key): HierarchyNode
{
    return { Key: key, Caption: caption, IconKey: '', ExtObject: ext, Severity: NodeSeverity.Ok };
}

class FakeContributor implements IHierarchyContributor
{
    constructor(public readonly ParentKeys: readonly string[], public readonly Order: number, private readonly tag: string) {}
    public Contribute(_p: HierarchyNode): NodeContribution { return new NodeContribution([]); }
    public get Tag(): string { return this.tag; }
}

function defFor(token: ServiceKey<IHierarchyContributor>, parents: string[], order: number): HierarchyContributorDefinition
{
    const d = new HierarchyContributorDefinition();
    d.ParentKeys = parents; d.Order = order; d.Contributor = token;
    return d;
}

test('runtime Register indexes by every ParentKey, ordered by Order; disposer removes', () =>
{
    const provider = new ServiceProvider();
    const kA = new ServiceKey<IHierarchyContributor>('A');
    const kB = new ServiceKey<IHierarchyContributor>('B');
    provider.registerInstance(kA, new FakeContributor(['solution', 'project'], 10, 'A'));
    provider.registerInstance(kB, new FakeContributor(['solution'], 0, 'B'));
    const reg = new HierarchyContributorRegistry(provider);

    const offB = reg.Register(defFor(kB, ['solution'], 0));
    reg.Register(defFor(kA, ['solution', 'project'], 10));

    assert.deepEqual(reg.For('solution').map((c) => (c as FakeContributor).Tag), ['B', 'A']); // Order 0 then 10
    assert.deepEqual(reg.For('project').map((c) => (c as FakeContributor).Tag), ['A']);        // multi-ParentKey

    offB();
    assert.deepEqual(reg.For('solution').map((c) => (c as FakeContributor).Tag), ['A']);
});

test('Changed fires on register and on remove', () =>
{
    const provider = new ServiceProvider();
    const k = new ServiceKey<IHierarchyContributor>('K');
    provider.registerInstance(k, new FakeContributor(['solution'], 0, 'K'));
    const reg = new HierarchyContributorRegistry(provider);
    let fired = 0;
    reg.PropertyChanged('Contributors').subscribe(() => { fired++; });
    const off = reg.Register(defFor(k, ['solution'], 0));
    off();
    assert.equal(fired, 2);
});

test('NotifyContributionsChanged re-contributes a realized root live', () =>
{
    const provider = new ServiceProvider();
    let count = 0;
    const listing = new ServiceKey<IHierarchyContributor>('listing');
    provider.registerInstance(listing, { ParentKeys: ['solution'], Order: 0,
        Contribute: () => new NodeContribution(count === 0 ? [] : [pnode('project', { id: 'p' })]) } as IHierarchyContributor);
    const registry = new HierarchyContributorRegistry(provider);
    const d = new HierarchyContributorDefinition();
    d.ParentKeys = ['solution']; d.Contributor = listing; d.Order = 0;
    registry.Register(d);
    const model = new HierarchyModel(registry);
    const root = model.SeedRoot(pnode('solution', {}));
    model.RealizeChildren(root);
    assert.equal(model.ChildrenOf(root).length, 0);

    count = 1;
    registry.NotifyContributionsChanged();
    assert.equal(model.ChildrenOf(root).length, 1);
});

test('RegisterInstance exposes a per-instance contributor via For + re-contributes; remover unregisters', () =>
{
    const provider = new ServiceProvider();
    const registry = new HierarchyContributorRegistry(provider);
    const model = new HierarchyModel(registry);
    const root = model.SeedRoot(pnode('solution', {}));
    model.RealizeChildren(root);
    assert.equal(model.ChildrenOf(root).length, 0);

    const contributor: IHierarchyContributor = {
        ParentKeys: ['solution'], Order: 0,
        Contribute: () => new NodeContribution([pnode('project', { id: 'p' })]),
    };
    const off = registry.RegisterInstance(contributor);          // Changed -> re-contribute root
    assert.equal(registry.For('solution').length, 1);
    assert.equal(model.ChildrenOf(root).length, 1);

    off();
    assert.equal(registry.For('solution').length, 0);
    assert.equal(model.ChildrenOf(root).length, 0);
});
