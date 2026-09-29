import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceProvider } from '../../../runtime/index.js';
import { HierarchyActionContributorRegistry } from '../hierarchy-action-contributor-registry.js';
import { HierarchyAction } from '../hierarchy-action.js';
import type { HierarchyItemVM } from '../hierarchy-item-vm.js';
import type { IHierarchyActionContributor } from '../hierarchy-action-contributor.js';

const node = { Key: 'project' } as unknown as HierarchyItemVM;

test('ActionsFor returns registered contributors ordered by Order', () =>
{
    const reg = new HierarchyActionContributorRegistry(new ServiceProvider());
    const a: IHierarchyActionContributor = { ActionKeys: ['project'], ActionsFor: () => [HierarchyAction.Command('A', () => {})] };
    const b: IHierarchyActionContributor = { ActionKeys: ['project'], ActionsFor: () => [HierarchyAction.Command('B', () => {})] };
    reg.RegisterInstance(b);   // registered first
    reg.RegisterInstance(a);
    const labels = reg.ActionsFor('project', node).map((x) => x.Label);
    assert.deepEqual(labels, ['B', 'A']);   // insertion order preserved (both Order 0)
});

test('RegisterInstance remover unregisters', () =>
{
    const reg = new HierarchyActionContributorRegistry(new ServiceProvider());
    const off = reg.RegisterInstance({ ActionKeys: ['file'], ActionsFor: () => [HierarchyAction.Command('X', () => {})] });
    assert.equal(reg.ActionsFor('file', node).length, 1);
    off();
    assert.equal(reg.ActionsFor('file', node).length, 0);
});
