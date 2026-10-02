import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceProvider, ServiceKey } from '../../../runtime/index.js';
import { HierarchyContributorRegistry, HierarchyContributorDefinition } from '../index.js';
import { NodeContribution, type IHierarchyContributor } from '../hierarchy-contribution.js';
import type { CommandContext } from '../../shell/commands/command-context.js';
import type { HierarchyItem } from '../hierarchy-item.js';
import { CommandDefinition } from '../../shell/commands/command-definition.js';

class FakeContributor implements IHierarchyContributor
{
    constructor(public readonly ParentKeys: readonly string[], public readonly Order: number, private readonly tag: string) {}
    public Contribute(_p: HierarchyItem): NodeContribution { return new NodeContribution([]); }
    public Resolve(_id: string, _ctx: CommandContext) { return undefined; }
    public get Tag(): string { return this.tag; }
}

function defFor(token: ServiceKey<IHierarchyContributor>, parents: string[], order: number): HierarchyContributorDefinition
{
    const d = new HierarchyContributorDefinition();
    d.ParentKeys = parents; d.Order = order; d.Contributor = token;
    return d;
}

test('runtime Register indexes by every ParentKey, ordered by Order; disposer removes', () =>
{
    const provider = new ServiceProvider();
    const kA = new ServiceKey<IHierarchyContributor>('A');
    const kB = new ServiceKey<IHierarchyContributor>('B');
    provider.registerInstance(kA, new FakeContributor(['solution', 'project'], 10, 'A'));
    provider.registerInstance(kB, new FakeContributor(['solution'], 0, 'B'));
    const reg = new HierarchyContributorRegistry(provider);

    const subB = reg.Register(defFor(kB, ['solution'], 0));
    reg.Register(defFor(kA, ['solution', 'project'], 10));

    assert.deepEqual(reg.For('solution').map((c) => (c as FakeContributor).Tag), ['B', 'A']); // Order 0 then 10
    assert.deepEqual(reg.For('project').map((c) => (c as FakeContributor).Tag), ['A']);        // multi-ParentKey

    subB.dispose();
    assert.deepEqual(reg.For('solution').map((c) => (c as FakeContributor).Tag), ['A']);
});

test('Changed fires on register and on remove', () =>
{
    const provider = new ServiceProvider();
    const k = new ServiceKey<IHierarchyContributor>('K');
    provider.registerInstance(k, new FakeContributor(['solution'], 0, 'K'));
    const reg = new HierarchyContributorRegistry(provider);
    let fired = 0;
    reg.PropertyChanged('Contributors').subscribe(() => { fired++; });
    const sub = reg.Register(defFor(k, ['solution'], 0));
    sub.dispose();
    assert.equal(fired, 2);
});

test('NotifyContributionsChanged fires the Contributors signal', () =>
{
    const provider = new ServiceProvider();
    const k = new ServiceKey<IHierarchyContributor>('K');
    provider.registerInstance(k, new FakeContributor(['solution'], 0, 'K'));
    const registry = new HierarchyContributorRegistry(provider);
    registry.Register(defFor(k, ['solution'], 0));

    let fired = 0;
    registry.PropertyChanged('Contributors').subscribe(() => { fired++; });

    registry.NotifyContributionsChanged();
    assert.equal(fired, 1);
});

test('ActionBindings pairs each definition action with its resolved contributor', () =>
{
    const kProj = new ServiceKey<IHierarchyContributor>('proj');
    const sp = new ServiceProvider();
    const proj: IHierarchyContributor = {
        ParentKeys: ['solution'],
        Order: 0,
        Contribute: () => new NodeContribution([]),
        Resolve: () => undefined,
    };
    sp.registerInstance(kProj, proj);
    const registry = new HierarchyContributorRegistry(sp);

    const rename = new CommandDefinition(); rename.Id = 'project.rename'; rename.Title = 'Rename';
    const def = new HierarchyContributorDefinition();
    def.ParentKeys = ['solution', 'folder'];   // two parents — action must appear ONCE
    def.Contributor = kProj;
    def.Actions = [rename];
    registry.Register(def);

    const bindings = registry.ActionBindings();
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0]!.Action.Id, 'project.rename');
    assert.equal(bindings[0]!.Dispatcher, proj);
});

test('RegisterInstance carries its optional actions into ActionBindings, dispatched through the instance', () =>
{
    const provider = new ServiceProvider();
    const registry = new HierarchyContributorRegistry(provider);
    const instance = new FakeContributor(['solution'], 0, 'INST');

    const extra = new CommandDefinition(); extra.Id = 'instance.extra'; extra.Title = 'Extra';
    registry.RegisterInstance(instance, [extra]);

    const bindings = registry.ActionBindings();
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0]!.Action.Id, 'instance.extra');
    assert.equal(bindings[0]!.Dispatcher, instance);
});

test('RegisterInstance with no actions argument contributes none (back-compat default)', () =>
{
    const provider = new ServiceProvider();
    const registry = new HierarchyContributorRegistry(provider);
    registry.RegisterInstance(new FakeContributor(['solution'], 0, 'INST'));

    assert.deepEqual(registry.ActionBindings(), []);
});
