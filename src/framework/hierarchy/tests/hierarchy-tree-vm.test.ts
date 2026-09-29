import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceProvider, ServiceKey } from '../../../runtime/index.js';
import {
    HierarchyModel, HierarchyContributorRegistry, HierarchyContributorDefinition,
    NodeContribution, NodeSeverity, HierarchyTreeVM,
    type IHierarchyContributor, type HierarchyNode, type HierarchyHost,
} from '../index.js';

// A HierarchyHost stub for the tree-VM tests — every method a no-op unless overridden.
function fakeHost(over: Partial<HierarchyHost> = {}): HierarchyHost
{
    return {
        Activate: () => {}, CommitRename: () => {}, Delete: () => {}, ActionsFor: () => [],
        CanDrop: () => false, Drop: () => {}, OnItemRemoved: () => {},
        ...over,
    };
}

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

    const tree = new HierarchyTreeVM(model, root, fakeHost());
    assert.equal(tree.Roots.Count, 1);
    assert.equal(tree.Roots.Get(0)!.Caption, 'A');

    members = [node('project', { id: 'a' }, 'A'), node('project', { id: 'b' }, 'B')];
    registry.NotifyContributionsChanged();
    assert.equal(tree.Roots.Count, 2);
    assert.equal(tree.Roots.Get(1)!.Caption, 'B');
});

// Builds a tree seeded with N project roots over a NodeContribution the test can shrink.
// removeRoot(i) drops member #i and re-contributes → the model emits ChildRemoved.
function makeTreeWithRoots(n: number): { tree: HierarchyTreeVM; removeRoot: (i: number) => void }
{
    const provider = new ServiceProvider();
    let members = Array.from({ length: n }, (_v, i) => node('project', { id: `m${i}` }, `M${i}`));
    const listing = new ServiceKey<IHierarchyContributor>('listing');
    provider.registerInstance(listing, { ParentKeys: ['solution'], Order: 0,
        Contribute: () => new NodeContribution(members) } as IHierarchyContributor);
    const registry = new HierarchyContributorRegistry(provider);
    const d = new HierarchyContributorDefinition();
    d.ParentKeys = ['solution']; d.Contributor = listing; d.Order = 0;
    registry.Register(d);
    const model = new HierarchyModel(registry);
    const root = model.SeedRoot(node('solution', {}));
    const tree = new HierarchyTreeVM(model, root, fakeHost());
    return {
        tree,
        removeRoot: (i) =>
        {
            members = members.filter((_v, idx) => idx !== i);
            registry.NotifyContributionsChanged();
        },
    };
}

test('SelectSingle replaces the set + sets the anchor; Toggle adds/removes', () =>
{
    const { tree } = makeTreeWithRoots(2);
    const [a, b] = [tree.Roots.Get(0)!, tree.Roots.Get(1)!];
    tree.SelectSingle(a);
    assert.deepEqual(tree.Selection.ToArray(), [a]);
    assert.equal(tree.Anchor, a);
    tree.Toggle(b);
    assert.equal(tree.Selection.Count, 2);
    tree.Toggle(b);
    assert.deepEqual(tree.Selection.ToArray(), [a]);
});

test('a removed root is pruned from the selection', () =>
{
    const { tree, removeRoot } = makeTreeWithRoots(2);
    const b = tree.Roots.Get(1)!;
    tree.SelectSingle(b);
    removeRoot(1);                                  // emit ChildRemoved for root #1
    assert.equal(tree.Selection.Count, 0);
    assert.equal(tree.Anchor, undefined);
});

test('dispose tears down the root subscription', () =>
{
    const provider = new ServiceProvider();
    const registry = new HierarchyContributorRegistry(provider);
    const model = new HierarchyModel(registry);
    const root = model.SeedRoot(node('solution', {}));
    const tree = new HierarchyTreeVM(model, root, fakeHost());
    tree.dispose();
    assert.equal(tree.Roots.Count, 0);
});
