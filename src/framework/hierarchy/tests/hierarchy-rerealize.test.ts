import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceKey, ServiceProvider, type IDisposable } from '../../../runtime/index.js';
import { Hierarchy } from '../hierarchy.js';
import { HierarchyContributorRegistry } from '../hierarchy-contributor-registry.js';
import { HierarchyContributorDefinition } from '../hierarchy-contributor-definition.js';
import { ProviderContribution, type IHierarchyContributor } from '../hierarchy-contribution.js';
import type { IHierarchyProvider, IRealizeContext } from '../hierarchy-provider.js';
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

class MarkProvider implements IHierarchyProvider
{
    public readonly ProviderId: string;
    public Disposed = false;
    private child: HierarchyItem | undefined;

    constructor(providerId: string, private readonly caption: string)
    {
        this.ProviderId = providerId;
    }

    public Realize(_item: HierarchyItem, ctx: IRealizeContext): IDisposable
    {
        if (this.child === undefined) this.child = ctx.NewItem('c', { Caption: this.caption });
        ctx.InsertChild(this.child);
        return { dispose: () => { this.Disposed = true; } };
    }

    public Integrate(): void {}
    public GetCanonicalName(): string { return ''; }
    public ParseCanonicalName(): HierarchyItem | undefined { return undefined; }
    public CanAccept(): boolean { return false; }
}

describe('Hierarchy — non-destructive re-realization', () =>
{
    test('re-realization adds/removes providers without disposing the survivor', () =>
    {
        const survivor = new MarkProvider('survivor', 'Survivor');
        const departing = new MarkProvider('departing', 'Departing');
        const kSurv = new ServiceKey<IHierarchyContributor>('surv');
        const kDep = new ServiceKey<IHierarchyContributor>('dep');
        const sp = new ServiceProvider();
        sp.registerInstance(kSurv, { ParentKeys: ['root'], Order: 10, Contribute: () => new ProviderContribution(survivor), Resolve: (_i: string, _c: CommandContext) => undefined } as IHierarchyContributor);
        sp.registerInstance(kDep, { ParentKeys: ['root'], Order: 20, Contribute: () => new ProviderContribution(departing), Resolve: (_i: string, _c: CommandContext) => undefined } as IHierarchyContributor);
        const registry = new HierarchyContributorRegistry(sp);
        const dS = new HierarchyContributorDefinition(); dS.ParentKeys = ['root']; dS.Contributor = kSurv; dS.Order = 10;
        const dD = new HierarchyContributorDefinition(); dD.ParentKeys = ['root']; dD.Contributor = kDep; dD.Order = 20;
        registry.Register(dS);
        const depSub = registry.Register(dD);
        const h = new Hierarchy(registry, noopHost());
        h.SeedRoot('root');
        assert.deepEqual(h.Roots.ToArray().map(i => i.Caption), ['Survivor', 'Departing']);

        depSub.dispose();
        registry.NotifyContributionsChanged();

        assert.equal(survivor.Disposed, false);
        assert.equal(departing.Disposed, true);
        assert.deepEqual(h.Roots.ToArray().map(i => i.Caption), ['Survivor']);
    });
});
