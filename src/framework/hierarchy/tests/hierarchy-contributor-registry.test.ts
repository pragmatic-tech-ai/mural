import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceProvider, ServiceKey } from '../../../runtime/index.js';
import {
    HierarchyContributorRegistry, HierarchyContributorDefinition,
    HierarchyModel, NodeSeverity,
    NodeContribution as LegacyNodeContribution,
    type HierarchyNode,
} from '../index.js';
import { NodeContribution, type IHierarchyContributor } from '../hierarchy-contribution.js';
import type { CommandContext } from '../../shell/commands/command-context.js';
import type { HierarchyItem } from '../hierarchy-item.js';

function pnode(key: string, ext: unknown, caption = key): HierarchyNode
{
    return { Key: key, Caption: caption, IconKey: '', ExtObject: ext, Severity: NodeSeverity.Ok };
}

class FakeContributor implements IHierarchyContributor
{
    constructor(public readonly ParentKeys: readonly string[], public readonly Order: number, private readonly tag: string) {}
    public Contribute(_p: HierarchyItem): NodeContribution { return new NodeContribution([]); }
    public Resolve(_id: string, _ctx: CommandContext) { return undefined; }
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

    const subB = reg.Register(defFor(kB, ['solution'], 0));
    reg.Register(defFor(kA, ['solution', 'project'], 10));

    assert.deepEqual(reg.For('solution').map((c) => (c as FakeContributor).Tag), ['B', 'A']); // Order 0 then 10
    assert.deepEqual(reg.For('project').map((c) => (c as FakeContributor).Tag), ['A']);        // multi-ParentKey

    subB.dispose();
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
    const sub = reg.Register(defFor(k, ['solution'], 0));
    sub.dispose();
    assert.equal(fired, 2);
});

test('NotifyContributionsChanged re-contributes a realized root live', () =>
{
    const provider = new ServiceProvider();
    let count = 0;
    const listing = new ServiceKey<IHierarchyContributor>('listing');
    // Uses the LEGACY NodeContribution (hierarchy-node.js): HierarchyModel.RealizeChildren
    // still does `instanceof` against that class (Task 11 reconciles it), so a contribution
    // built from the new hierarchy-contribution.js class would not be recognized here.
    provider.registerInstance(listing, { ParentKeys: ['solution'], Order: 0,
        Contribute: () => new LegacyNodeContribution(count === 0 ? [] : [pnode('project', { id: 'p' })]),
        Resolve: (_id: string, _ctx: CommandContext) => undefined } as IHierarchyContributor);
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

    // Same LEGACY NodeContribution note as above — HierarchyModel still instanceof-checks
    // against hierarchy-node.js's class.
    const contributor: IHierarchyContributor = {
        ParentKeys: ['solution'], Order: 0,
        Contribute: () => new LegacyNodeContribution([pnode('project', { id: 'p' })]),
        Resolve: (_id: string, _ctx: CommandContext) => undefined,
    };
    const sub = registry.RegisterInstance(contributor);          // Changed -> re-contribute root
    assert.equal(registry.For('solution').length, 1);
    assert.equal(model.ChildrenOf(root).length, 1);

    sub.dispose();
    assert.equal(registry.For('solution').length, 0);
    assert.equal(model.ChildrenOf(root).length, 0);
});
