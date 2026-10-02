import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceKey, ServiceProvider, type IDisposable } from '../../../runtime/index.js';
import { Hierarchy } from '../hierarchy.js';
import { HierarchyContributorRegistry } from '../hierarchy-contributor-registry.js';
import { HierarchyContributorDefinition } from '../hierarchy-contributor-definition.js';
import { NodeContribution, ProviderContribution, type IHierarchyContributor, type HierarchyNodeSpec } from '../hierarchy-contribution.js';
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
function spec(key: string, ext: unknown, caption: string): HierarchyNodeSpec
{
    return { Key: key, ExtObject: ext, Caption: caption, IsExpandable: false };
}

class OwningProvider implements IHierarchyProvider
{
    public Integrated: readonly NodeContribution[] = [];
    public Child: HierarchyItem | undefined;
    constructor(public readonly ProviderId: string, private readonly childCaption: string) {}
    public Realize(_item: HierarchyItem, context: IRealizeContext): IDisposable
    {
        if (this.Child === undefined)
        {
            this.Child = context.NewItem('provchild', { Caption: this.childCaption, CanonicalSegment: this.childCaption, IsExpandable: true });
        }
        context.InsertChild(this.Child);
        return { dispose: () => {} };
    }
    public Integrate(_item: HierarchyItem, contributions: readonly NodeContribution[]): void { this.Integrated = contributions; }
    public GetCanonicalName(item: HierarchyItem): string { return item.CanonicalSegment ?? item.Key; }
    public ParseCanonicalName(): HierarchyItem | undefined { return undefined; }
    public CanAccept(): boolean { return false; }
}

function build(entries: readonly { key: ServiceKey<IHierarchyContributor>; c: IHierarchyContributor }[]): Hierarchy
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

describe('Hierarchy — ownership + integration + canonical disambiguation', () =>
{
    test('registry NodeContributions for a provider-owned node route through provider.Integrate', () =>
    {
        const prov = new OwningProvider('p', 'Branch');
        const kProv = new ServiceKey<IHierarchyContributor>('prov');
        const kInject = new ServiceKey<IHierarchyContributor>('inject');
        const h = build([
            { key: kProv, c: { ParentKeys: ['solution'], Order: 0, Contribute: () => new ProviderContribution(prov), Resolve: (_i: string, _c: CommandContext) => undefined } as IHierarchyContributor },
            { key: kInject, c: { ParentKeys: ['provchild'], Order: 0, Contribute: () => new NodeContribution([spec('leaf', {}, 'Injected')]), Resolve: (_i: string, _c: CommandContext) => undefined } as IHierarchyContributor },
        ]);
        h.SeedRoot('solution');
        h.Realize(prov.Child!);
        assert.equal(prov.Integrated.length, 1);
        assert.equal(prov.Integrated[0].Nodes[0].Caption, 'Injected');
    });

    test('canonical names disambiguate colliding sibling segments', () =>
    {
        const a = new OwningProvider('a', 'x');
        const b = new OwningProvider('b', 'x');
        const kA = new ServiceKey<IHierarchyContributor>('a');
        const kB = new ServiceKey<IHierarchyContributor>('b');
        const h = build([
            { key: kA, c: { ParentKeys: ['root'], Order: 10, Contribute: () => new ProviderContribution(a), Resolve: (_i: string, _c: CommandContext) => undefined } as IHierarchyContributor },
            { key: kB, c: { ParentKeys: ['root'], Order: 20, Contribute: () => new ProviderContribution(b), Resolve: (_i: string, _c: CommandContext) => undefined } as IHierarchyContributor },
        ]);
        h.SeedRoot('root');
        const names = h.Roots.ToArray().map(i => h.CanonicalNameOf(i));
        assert.equal(new Set(names).size, 2);
    });
});
