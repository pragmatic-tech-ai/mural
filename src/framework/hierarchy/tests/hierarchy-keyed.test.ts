import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceKey, ServiceProvider } from '../../../runtime/index.js';
import { Hierarchy } from '../hierarchy.js';
import { HierarchyContributorRegistry } from '../hierarchy-contributor-registry.js';
import { HierarchyContributorDefinition } from '../hierarchy-contributor-definition.js';
import { NodeContribution, type IHierarchyContributor, type HierarchyNodeSpec } from '../hierarchy-contribution.js';
import type { HierarchyItem, IHierarchyItemHost } from '../hierarchy-item.js';
import { CommandContext } from '../../shell/commands/command-context.js';

function noopHost(): IHierarchyItemHost
{
    return {
        Activate: () => {},
        CommitRename: () => {},
        OnItemRemoved: () => {},
    };
}
function spec(key: string, ext: unknown, caption: string): HierarchyNodeSpec
{
    return { Key: key, ExtObject: ext, Caption: caption, IsExpandable: false };
}
function nodeContributor(parentKeys: readonly string[], order: number, nodes: readonly HierarchyNodeSpec[]): IHierarchyContributor
{
    return {
        ParentKeys: parentKeys, Order: order,
        Contribute: (_p: HierarchyItem) => new NodeContribution(nodes),
        Resolve: (_id: string, _ctx: CommandContext) => undefined,
    };
}
function hierarchyWith(entries: readonly { key: ServiceKey<IHierarchyContributor>; c: IHierarchyContributor }[]): Hierarchy
{
    const provider = new ServiceProvider();
    for (const e of entries) provider.registerInstance(e.key, e.c);
    const registry = new HierarchyContributorRegistry(provider);
    for (const e of entries)
    {
        const d = new HierarchyContributorDefinition();
        d.ParentKeys = e.c.ParentKeys as string[]; d.Contributor = e.key; d.Order = e.c.Order;
        registry.Register(d);
    }
    return new Hierarchy(registry, noopHost());
}

describe('Hierarchy — keyed realization', () =>
{
    test('SeedRoot realizes keyed children into Roots, interned by ExtObject identity', () =>
    {
        const extA = {}; const extB = {};
        const key = new ServiceKey<IHierarchyContributor>('projects');
        const h = hierarchyWith([{ key, c: nodeContributor(['solution'], 0, [spec('project', extA, 'A'), spec('project', extB, 'B')]) }]);
        const root = h.SeedRoot('solution');
        assert.equal(h.Roots.Count, 2);
        assert.deepEqual(h.Roots.ToArray().map(i => i.Caption), ['A', 'B']);
        assert.equal(root.Key, 'solution');
    });

    test('two NodeContributors compose in Order (low Order first)', () =>
    {
        const kHi = new ServiceKey<IHierarchyContributor>('hi');
        const kLo = new ServiceKey<IHierarchyContributor>('lo');
        const h = hierarchyWith([
            { key: kHi, c: nodeContributor(['solution'], 20, [spec('ref', {}, 'Refs')]) },
            { key: kLo, c: nodeContributor(['solution'], 10, [spec('proj', {}, 'Projects')]) },
        ]);
        h.SeedRoot('solution');
        assert.deepEqual(h.Roots.ToArray().map(i => i.Caption), ['Projects', 'Refs']);
    });

    test('re-realizing a parent reuses the interned item for a surviving ExtObject', () =>
    {
        const ext = {};
        const key = new ServiceKey<IHierarchyContributor>('files');
        const h = hierarchyWith([{ key, c: nodeContributor(['folder'], 0, [spec('file', ext, 'f.ts')]) }]);
        const parent = h.SeedRoot('folder');
        const first = h.Roots.ToArray()[0];
        h.Collapse(parent);
        h.Realize(parent);
        const second = h.Roots.ToArray().filter(i => i.Caption === 'f.ts')[0];
        assert.equal(second, first, 'same ExtObject re-interns to the same HierarchyItem instance');
    });
});
