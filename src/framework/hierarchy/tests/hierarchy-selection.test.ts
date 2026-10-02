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
function spec(key: string, ext: unknown, caption: string, seg?: string): HierarchyNodeSpec
{
    return { Key: key, ExtObject: ext, Caption: caption, CanonicalSegment: seg, IsExpandable: false };
}
function nc(parentKeys: readonly string[], order: number, nodes: readonly HierarchyNodeSpec[]): IHierarchyContributor
{
    return { ParentKeys: parentKeys, Order: order, Contribute: () => new NodeContribution(nodes), Resolve: (_i: string, _c: CommandContext) => undefined };
}
function build(entries: readonly { key: ServiceKey<IHierarchyContributor>; c: IHierarchyContributor }[]): Hierarchy
{
    const sp = new ServiceProvider();
    for (const e of entries) sp.registerInstance(e.key, e.c);
    const registry = new HierarchyContributorRegistry(sp);
    for (const e of entries)
    {
        const d = new HierarchyContributorDefinition();
        d.ParentKeys = e.c.ParentKeys as string[]; d.Contributor = e.key; d.Order = e.c.Order;
        registry.Register(d);
    }
    return new Hierarchy(registry, noopHost());
}

// A provider that yields a distinct child depending on which item it is realizing:
// realizing the root-attached parent inserts `branch`; realizing `branch` itself
// (an owner-realized subtree) inserts `leaf`. Both are cached so a Collapse→Realize
// (via OnExpand) reuses the same instances — this is what Reveal must re-descend
// into lazily from a collapsed state.
class BranchProvider implements IHierarchyProvider
{
    public branch: HierarchyItem | undefined;
    public leaf: HierarchyItem | undefined;
    constructor(public readonly ProviderId: string) {}
    public Realize(item: HierarchyItem, ctx: IRealizeContext): IDisposable
    {
        if (this.branch === undefined) this.branch = ctx.NewItem('branch', { Caption: 'Branch', CanonicalSegment: 'branch', IsExpandable: true });
        if (item === this.branch)
        {
            if (this.leaf === undefined) this.leaf = ctx.NewItem('leaf', { Caption: 'Leaf', CanonicalSegment: 'leaf.ts' });
            ctx.InsertChild(this.leaf);
        }
        else
        {
            ctx.InsertChild(this.branch);
        }
        return { dispose: () => {} };
    }
    public Integrate(): void {}
    public GetCanonicalName(i: HierarchyItem): string { return i.CanonicalSegment ?? i.Key; }
    public ParseCanonicalName(): HierarchyItem | undefined { return undefined; }
    public CanAccept(): boolean { return false; }
}

describe('Hierarchy — selection + reveal', () =>
{
    test('SelectSingle sets Selection + Anchor; Toggle adds/removes; ClearSelection empties', () =>
    {
        const k = new ServiceKey<IHierarchyContributor>('x');
        const h = build([{ key: k, c: nc(['root'], 0, [spec('a', {}, 'A'), spec('b', {}, 'B')]) }]);
        h.SeedRoot('root');
        const [a, b] = h.Roots.ToArray();
        h.SelectSingle(a!);
        assert.deepEqual(h.Selection.ToArray(), [a]);
        assert.equal(h.Anchor, a);
        h.Toggle(b!);
        assert.deepEqual(h.Selection.ToArray(), [a, b]);
        h.Toggle(a!);
        assert.deepEqual(h.Selection.ToArray(), [b]);
        h.ClearSelection();
        assert.equal(h.Selection.Count, 0);
    });

    test('removing a selected item prunes it from Selection', () =>
    {
        const k = new ServiceKey<IHierarchyContributor>('x');
        const ext = {};
        const members: HierarchyNodeSpec[] = [spec('a', ext, 'A')];
        const contributor: IHierarchyContributor = { ParentKeys: ['root'], Order: 0, Contribute: () => new NodeContribution(members), Resolve: (_i: string, _c: CommandContext) => undefined };
        const sp = new ServiceProvider(); sp.registerInstance(k, contributor);
        const registry = new HierarchyContributorRegistry(sp);
        const d = new HierarchyContributorDefinition(); d.ParentKeys = ['root']; d.Contributor = k; d.Order = 0; registry.Register(d);
        const h = new Hierarchy(registry, noopHost());
        const root = h.SeedRoot('root');
        const a = h.Roots.ToArray()[0];
        h.SelectSingle(a!);
        members.length = 0;                    // 'a' departs on re-realize
        h.Collapse(root); h.Realize(root);
        assert.equal(h.Selection.Count, 0, 'the removed item was pruned from Selection');
    });

    test('Reveal descends across a provider boundary, lazily re-realizing from a collapsed state', () =>
    {
        const prov = new BranchProvider('fs');
        const kProv = new ServiceKey<IHierarchyContributor>('prov');
        const h = build([
            { key: kProv, c: { ParentKeys: ['root'], Order: 0, Contribute: () => new ProviderContribution(prov), Resolve: (_i: string, _c: CommandContext) => undefined } as IHierarchyContributor },
        ]);
        h.SeedRoot('root');
        const branch = h.Roots.ToArray()[0]!;
        branch.OnExpand();                                     // materialize the leaf once, to read its real canonical name
        const leaf = branch.Children.ToArray()[0]!;
        const target = h.CanonicalNameOf(leaf);                 // '/fs:branch/fs:leaf.ts' — derived, never hand-typed
        branch.OnCollapse();                                    // drop back to collapsed; leaf's HierarchyItem is gone from the tree

        const revealed = h.Reveal(target);

        assert.notEqual(revealed, undefined);
        assert.equal(revealed!.Caption, 'Leaf');
    });
});
