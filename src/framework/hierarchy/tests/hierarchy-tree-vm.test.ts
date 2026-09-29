import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceProvider, ServiceKey } from '../../../runtime/index.js';
import {
    HierarchyModel, HierarchyContributorRegistry, HierarchyContributorDefinition,
    NodeContribution, NodeSeverity, HierarchyTreeVM,
    type IHierarchyContributor, type HierarchyNode,
} from '../index.js';

function node(key: string, ext: unknown, caption = key): HierarchyNode
{
    return { Key: key, Caption: caption, IconKey: key, ExtObject: ext, Severity: NodeSeverity.Ok };
}

test('Roots realizes the seeded root children at construction and patches on re-contribute', () =>
{
    const provider = new ServiceProvider();
    let members = [node('project', { id: 'a' }, 'A')];
    const listing = new ServiceKey<IHierarchyContributor>('listing');
    provider.registerInstance(listing, { ParentKeys: ['solution'], Order: 0,
        Contribute: () => new NodeContribution(members) } as IHierarchyContributor);
    const registry = new HierarchyContributorRegistry(provider);
    const d = new HierarchyContributorDefinition();
    d.ParentKeys = ['solution']; d.Contributor = listing; d.Order = 0;
    registry.Register(d);
    const model = new HierarchyModel(registry);
    const root = model.SeedRoot(node('solution', {}));

    const tree = new HierarchyTreeVM(model, root, () => {});
    assert.equal(tree.Roots.Count, 1);
    assert.equal(tree.Roots.Get(0)!.Caption, 'A');

    members = [node('project', { id: 'a' }, 'A'), node('project', { id: 'b' }, 'B')];
    registry.NotifyContributionsChanged();
    assert.equal(tree.Roots.Count, 2);
    assert.equal(tree.Roots.Get(1)!.Caption, 'B');
});

test('dispose tears down the root subscription', () =>
{
    const provider = new ServiceProvider();
    const registry = new HierarchyContributorRegistry(provider);
    const model = new HierarchyModel(registry);
    const root = model.SeedRoot(node('solution', {}));
    const tree = new HierarchyTreeVM(model, root, () => {});
    tree.dispose();
    assert.equal(tree.Roots.Count, 0);
});
