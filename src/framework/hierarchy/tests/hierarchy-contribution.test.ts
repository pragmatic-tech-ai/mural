import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceKey, ServiceProvider } from '../../../runtime/index.js';
import { NodeContribution, ProviderContribution, type IHierarchyContributor } from '../hierarchy-contribution.js';
import { HierarchyContributorRegistry } from '../hierarchy-contributor-registry.js';
import { HierarchyContributorDefinition } from '../hierarchy-contributor-definition.js';
import type { HierarchyItem } from '../hierarchy-item.js';
import { CommandContext } from '../../shell/commands/command-context.js';

function contributor(parentKeys: readonly string[], order: number, contribution: NodeContribution | ProviderContribution): IHierarchyContributor
{
    return {
        ParentKeys: parentKeys,
        Order: order,
        Contribute: (_parent: HierarchyItem) => contribution,
        Resolve: (_id: string, _ctx: CommandContext) => undefined,
    };
}

describe('HierarchyContributorRegistry (new contributor contract)', () =>
{
    test('For returns every contributor for a parent key, ordered by Order ascending', () =>
    {
        const provider = new ServiceProvider();
        const low = new ServiceKey<IHierarchyContributor>('low');
        const high = new ServiceKey<IHierarchyContributor>('high');
        provider.registerInstance(low, contributor(['project'], 10, new NodeContribution([])));
        provider.registerInstance(high, contributor(['project'], 20, new NodeContribution([])));
        const registry = new HierarchyContributorRegistry(provider);

        const defHigh = new HierarchyContributorDefinition();
        defHigh.ParentKeys = ['project']; defHigh.Contributor = high; defHigh.Order = 20;
        const defLow = new HierarchyContributorDefinition();
        defLow.ParentKeys = ['project']; defLow.Contributor = low; defLow.Order = 10;
        registry.Register(defHigh);
        registry.Register(defLow);

        const got = registry.For('project');
        assert.equal(got.length, 2);
        assert.equal(got[0].Order, 10);
        assert.equal(got[1].Order, 20);
    });

    test('a contributor is also an ICommandDispatcher (Resolve is callable)', () =>
    {
        const c = contributor(['project'], 0, new ProviderContribution({
            ProviderId: 'p', Realize: () => ({ dispose: () => {} }),
            Integrate: () => {}, GetCanonicalName: () => '', ParseCanonicalName: () => undefined, CanAccept: () => false,
        }));
        assert.equal(c.Resolve('any', new CommandContext()), undefined);
    });
});
