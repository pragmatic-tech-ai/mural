import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceKey, ServiceProvider, RelayCommand, type ICommand } from '../../../runtime/index.js';
import { Hierarchy } from '../hierarchy.js';
import { HierarchyContext } from '../hierarchy-context.js';
import { HierarchyContributorRegistry } from '../hierarchy-contributor-registry.js';
import { HierarchyContributorDefinition } from '../hierarchy-contributor-definition.js';
import { NodeContribution, type IHierarchyContributor, type HierarchyNodeSpec } from '../hierarchy-contribution.js';
import type { HierarchyItem, IHierarchyItemHost } from '../hierarchy-item.js';
import type { CommandContext } from '../../shell/commands/command-context.js';

function noopHost(): IHierarchyItemHost
{
    return { Activate: () => {}, CommitRename: () => {}, OnItemRemoved: () => {} };
}

function spec(key: string, caption: string): HierarchyNodeSpec
{
    return { Key: key, ExtObject: {}, Caption: caption, IsExpandable: false };
}

describe('Hierarchy — ICommandContextSource', () =>
{
    function setup(): { h: Hierarchy }
    {
        const kProj = new ServiceKey<IHierarchyContributor>('proj');
        const sp = new ServiceProvider();
        const proj: IHierarchyContributor = {
            ParentKeys: ['solution'],
            Order: 0,
            Contribute: () => new NodeContribution([spec('project', 'MyProj')]),
            Resolve: (id: string, _c: CommandContext): ICommand | undefined => new RelayCommand(() => id),
        };
        sp.registerInstance(kProj, proj);
        const registry = new HierarchyContributorRegistry(sp);

        const def = new HierarchyContributorDefinition();
        def.ParentKeys = ['solution'];
        def.Contributor = kProj;
        def.Order = 0;
        registry.Register(def);

        const h = new Hierarchy(registry, noopHost(), { Services: new ServiceProvider() });
        return { h };
    }

    test('CommandContexts is the interned union of the selected nodes Keys', () =>
    {
        const { h } = setup();                 // seeds a 'project' child under 'solution' root
        h.SeedRoot('solution');
        const project = h.Roots.ToArray()[0]!;
        h.SelectSingle(project);
        assert.deepEqual(
            [...h.CommandContexts],
            [HierarchyContext.For(project.Key)]);
    });

    test('CommandContexts is empty when there is no selection', () =>
    {
        const { h } = setup();
        h.SeedRoot('solution');
        assert.deepEqual([...h.CommandContexts], []);
    });
});
