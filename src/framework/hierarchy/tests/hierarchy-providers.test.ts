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

class CapturingProvider implements IHierarchyProvider
{
    public readonly ProviderId = 'capturing';
    public Ctx: IRealizeContext | undefined;
    public Disposed = false;
    public Realize(_item: HierarchyItem, context: IRealizeContext): IDisposable
    {
        this.Ctx = context;
        return { dispose: () => { this.Disposed = true; } };
    }
    public Integrate(): void {}
    public GetCanonicalName(): string { return ''; }
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

describe('Hierarchy — providers + composition', () =>
{
    test('a provider child and a keyed sibling compose in Order under one parent', () =>
    {
        const prov = new CapturingProvider();
        const kProv = new ServiceKey<IHierarchyContributor>('prov');
        const kKeyed = new ServiceKey<IHierarchyContributor>('keyed');
        const h = build([
            { key: kProv, c: { ParentKeys: ['solution'], Order: 20, Contribute: () => new ProviderContribution(prov), Resolve: (_i: string, _c: CommandContext) => undefined } as IHierarchyContributor },
            { key: kKeyed, c: { ParentKeys: ['solution'], Order: 10, Contribute: () => new NodeContribution([spec('proj', {}, 'Projects')]), Resolve: (_i: string, _c: CommandContext) => undefined } as IHierarchyContributor },
        ]);
        h.SeedRoot('solution');
        prov.Ctx!.InsertChild(prov.Ctx!.NewItem('conn', { Caption: 'Connections' }));
        assert.deepEqual(h.Roots.ToArray().map(i => i.Caption), ['Projects', 'Connections']);
    });

    test('late provider child lands in its Order slot, before a higher-Order contribution', () =>
    {
        const prov = new CapturingProvider();
        const kProv = new ServiceKey<IHierarchyContributor>('prov');
        const kTail = new ServiceKey<IHierarchyContributor>('tail');
        const h = build([
            { key: kProv, c: { ParentKeys: ['solution'], Order: 10, Contribute: () => new ProviderContribution(prov), Resolve: (_i: string, _c: CommandContext) => undefined } as IHierarchyContributor },
            { key: kTail, c: { ParentKeys: ['solution'], Order: 20, Contribute: () => new NodeContribution([spec('ref', {}, 'References')]), Resolve: (_i: string, _c: CommandContext) => undefined } as IHierarchyContributor },
        ]);
        h.SeedRoot('solution');
        assert.deepEqual(h.Roots.ToArray().map(i => i.Caption), ['References']);
        prov.Ctx!.InsertChild(prov.Ctx!.NewItem('proj', { Caption: 'Projects' }));
        assert.deepEqual(h.Roots.ToArray().map(i => i.Caption), ['Projects', 'References']);
    });

    test('collapsing a parent disposes its provider handle', () =>
    {
        const prov = new CapturingProvider();
        const kProv = new ServiceKey<IHierarchyContributor>('prov');
        const h = build([{ key: kProv, c: { ParentKeys: ['folder'], Order: 0, Contribute: () => new ProviderContribution(prov), Resolve: (_i: string, _c: CommandContext) => undefined } as IHierarchyContributor }]);
        const root = h.SeedRoot('folder');
        assert.equal(prov.Disposed, false);
        h.Collapse(root);
        assert.equal(prov.Disposed, true);
    });
});
