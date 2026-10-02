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

// A two-level provider: under the seeded root it owns an expandable BRANCH; when that
// branch is realized it owns a nested LEAF and returns a counting subscription, so Live
// tracks whether the nested (second-level) provider handle is still alive.
class TwoLevelProvider implements IHierarchyProvider
{
    public Live = 0;
    private branch: HierarchyItem | undefined;
    private leaf: HierarchyItem | undefined;
    constructor(public readonly ProviderId: string, private readonly branchKey: string) {}
    public Realize(item: HierarchyItem, context: IRealizeContext): IDisposable
    {
        if (item.Key === this.branchKey)
        {
            if (this.leaf === undefined) this.leaf = context.NewItem('leaf', { Caption: 'Leaf' });
            context.InsertChild(this.leaf);
            this.Live += 1;
            return new Disposable(() => { this.Live -= 1; });
        }
        if (this.branch === undefined) this.branch = context.NewItem(this.branchKey, { Caption: 'Branch', IsExpandable: true });
        context.InsertChild(this.branch);
        return new Disposable(() => {});
    }
    public Integrate(): void {}
    public GetCanonicalName(): string { return ''; }
    public ParseCanonicalName(): HierarchyItem | undefined { return undefined; }
    public CanAccept(): boolean { return false; }
    public get Branch(): HierarchyItem | undefined { return this.branch; }
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

    test('collapsing a parent tears down an expanded child subtree\'s nested provider subscription', () =>
    {
        const prov = new TwoLevelProvider('p', 'branch');
        const { h } = build(prov, 'root');
        const root = h.SeedRoot('root');
        const branch = prov.Branch!;
        assert.equal(prov.Live, 0, 'branch not yet expanded');
        h.Realize(branch);
        assert.equal(prov.Live, 1, 'expanding the branch realized the nested provider');
        h.Collapse(root);
        assert.equal(prov.Live, 0, 'collapsing the root recursively released the nested subscription');
        h.Realize(root);
        h.Realize(prov.Branch!);
        assert.equal(prov.Live, 1, 're-expanding the subtree re-subscribes');
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
