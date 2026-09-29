import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    HierarchyItemId, NodeSeverity, ChildAdded, ChildRemoved, ChildUpdated,
    NodeContribution, ProviderContribution, HierarchyContribution, type HierarchyNode,
} from '../index.js';

function node(key: string, ext: unknown): HierarchyNode
{
    return { Key: key, Caption: key, IconKey: '', ExtObject: ext, Severity: NodeSeverity.Ok };
}

test('HierarchyItemId sentinels are distinct and stable', () =>
{
    assert.notEqual(HierarchyItemId.Root, HierarchyItemId.Nil);
    assert.equal(HierarchyItemId.Root, HierarchyItemId.Root);
});

test('contribution classes carry their payload and are instanceof HierarchyContribution', () =>
{
    const n = new NodeContribution([node('project', {})]);
    assert.ok(n instanceof HierarchyContribution);
    assert.equal(n.Nodes.length, 1);
    const p = new ProviderContribution({ ProviderId: 'x' } as never);
    assert.ok(p instanceof HierarchyContribution);
    assert.equal(p.Provider.ProviderId, 'x');
});

test('change deltas carry node / id', () =>
{
    const add = new ChildAdded(HierarchyItemId.Nil, node('a', 1));
    assert.equal(add.Node.Key, 'a');
    assert.equal(add.Id, HierarchyItemId.Nil);
    assert.equal(new ChildRemoved(HierarchyItemId.Nil).Id, HierarchyItemId.Nil);
    assert.equal(new ChildUpdated(HierarchyItemId.Nil, node('a', 1)).Id, HierarchyItemId.Nil);
    assert.equal(new ChildUpdated(HierarchyItemId.Nil, node('a', 1)).Node.Key, 'a');
});
