import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceProvider, ServiceKey } from '../../../runtime/index.js';
import { HierarchyActionContributorRegistry } from '../hierarchy-action-contributor-registry.js';
import { HierarchyActionDefinition } from '../hierarchy-action-contributor.js';
import { HierarchyAction } from '../hierarchy-action.js';
import type { HierarchyItemVM } from '../hierarchy-item-vm.js';
import type { HierarchyActionContext } from '../hierarchy-action.js';
import type { IHierarchyActionContributor } from '../hierarchy-action-contributor.js';

const anchor = { Key: 'project' } as unknown as HierarchyItemVM;
const ctx: HierarchyActionContext = { Anchor: anchor, Selection: [anchor] };

test('ActionsFor returns registered contributors ordered by Order', () =>
{
    const reg = new HierarchyActionContributorRegistry(new ServiceProvider());
    const a: IHierarchyActionContributor = { ActionKeys: ['project'], ActionsFor: () => [HierarchyAction.Command('A', () => {})] };
    const b: IHierarchyActionContributor = { ActionKeys: ['project'], ActionsFor: () => [HierarchyAction.Command('B', () => {})] };
    reg.RegisterInstance(b);   // registered first
    reg.RegisterInstance(a);
    const labels = reg.ActionsFor('project', ctx).map((x) => x.Label);
    assert.deepEqual(labels, ['B', 'A']);   // insertion order preserved (both Order 0)
});

test('a Register(def) with a Contributor CLASS resolves the service under tokenFor(class)', () =>
{
    // Mirrors the `.hierarchyActions:` DSL: the def carries the contributor class, and
    // the service is registered under tokenFor(class) === class.Key. resolve() normalizes.
    class DemoContributor implements IHierarchyActionContributor
    {
        public static readonly Key = new ServiceKey<DemoContributor>('DemoContributor');
        public readonly ActionKeys = ['project'];
        public ActionsFor(): readonly HierarchyAction[] { return [HierarchyAction.Command('Demo', () => {})]; }
    }
    const provider = new ServiceProvider();
    provider.registerInstance(DemoContributor.Key, new DemoContributor());
    const reg = new HierarchyActionContributorRegistry(provider);
    const def = new HierarchyActionDefinition();
    def.ActionKeys = ['project'];
    def.Contributor = DemoContributor as unknown as typeof def.Contributor;   // the class, as the DSL stores it
    reg.Register(def);
    assert.deepEqual(reg.ActionsFor('project', ctx).map((a) => a.Label), ['Demo']);
});

test('RegisterInstance remover unregisters', () =>
{
    const reg = new HierarchyActionContributorRegistry(new ServiceProvider());
    const off = reg.RegisterInstance({ ActionKeys: ['file'], ActionsFor: () => [HierarchyAction.Command('X', () => {})] });
    assert.equal(reg.ActionsFor('file', ctx).length, 1);
    off();
    assert.equal(reg.ActionsFor('file', ctx).length, 0);
});
