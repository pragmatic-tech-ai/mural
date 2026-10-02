import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceKey, ServiceProvider, Disposable, type IDisposable } from '../../../runtime/index.js';
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

// Tracks how many live subscriptions it currently holds.
class CountingProvider implements IHierarchyProvider
{
    public Live = 0;
    private child: HierarchyItem | undefined;
    constructor(public readonly ProviderId: string) {}
    public Realize(_item: HierarchyItem, context: IRealizeContext): IDisposable
    {
        if (this.child === undefined) this.child = context.NewItem('c', { Caption: 'C' });
        context.InsertChild(this.child);
        this.Live += 1;
        return new Disposable(() => { this.Live -= 1; });
    }
    public Integrate(): void {}
    public GetCanonicalName(): string { return ''; }
    public ParseCanonicalName(): HierarchyItem | undefined { return undefined; }
    public CanAccept(): boolean { return false; }
}

function build(prov: IHierarchyProvider, parentKey: string): { h: Hierarchy }
{
    const k = new ServiceKey<IHierarchyContributor>('prov');
    const sp = new ServiceProvider();
    sp.registerInstance(k, {
        ParentKeys: [parentKey], Order: 0,
        Contribute: () => new ProviderContribution(prov),
        Resolve: (_id: string, _ctx: CommandContext) => undefined,
    } as IHierarchyContributor);
    const registry = new HierarchyContributorRegistry(sp);
    const d = new HierarchyContributorDefinition();
    d.ParentKeys = [parentKey]; d.Contributor = k; d.Order = 0;
    registry.Register(d);
    return { h: new Hierarchy(registry, noopHost()) };
}

describe('Hierarchy — lifecycle / disposal', () =>
{
    test('collapse/expand/collapse returns subscriber count to baseline', () =>
    {
        const prov = new CountingProvider('p');
        const { h } = build(prov, 'folder');
        const root = h.SeedRoot('folder');
        assert.equal(prov.Live, 1, 'realized once');
        h.Collapse(root);
        assert.equal(prov.Live, 0, 'collapse released the provider subscription');
        h.Realize(root);
        assert.equal(prov.Live, 1, 're-expand re-subscribes');
        h.Collapse(root);
        assert.equal(prov.Live, 0, 'back to baseline');
    });

    test('dispose() is idempotent and releases provider subscriptions', () =>
    {
        const prov = new CountingProvider('p');
        const { h } = build(prov, 'folder');
        h.SeedRoot('folder');
        assert.equal(prov.Live, 1);
        h.dispose();
        assert.equal(prov.Live, 0);
        h.dispose();   // must not throw or double-release
        assert.equal(prov.Live, 0);
    });
});
