import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceKey, ServiceProvider, RelayCommand, type ICommand } from '../../../runtime/index.js';
import { Hierarchy } from '../hierarchy.js';
import { HierarchyContext } from '../hierarchy-context.js';
import { HierarchyContributorRegistry } from '../hierarchy-contributor-registry.js';
import { HierarchyContributorDefinition } from '../hierarchy-contributor-definition.js';
import { NodeContribution, type IHierarchyContributor, type HierarchyNodeSpec } from '../hierarchy-contribution.js';
import { HierarchyActionContext } from '../hierarchy-action-context.js';
import type { HierarchyItem, IHierarchyItemHost } from '../hierarchy-item.js';
import { CommandDefinition } from '../../shell/commands/command-definition.js';
import type { CommandContext } from '../../shell/commands/command-context.js';

function noopHost(): IHierarchyItemHost
{
    return { Activate: () => {}, CommitRename: () => {}, OnItemRemoved: () => {} };
}

function spec(key: string, caption: string): HierarchyNodeSpec
{
    return { Key: key, ExtObject: {}, Caption: caption, IsExpandable: false };
}

function action(id: string, title: string, key: string, order: number): CommandDefinition
{
    const def = new CommandDefinition();
    def.Id = id; def.Title = title; def.Context = HierarchyContext.For(key); def.Order = order;
    return def;
}

describe('Hierarchy — context-driven actions', () =>
{
    function setup(): { h: Hierarchy; executed: string[]; registry: HierarchyContributorRegistry }
    {
        const executed: string[] = [];
        const kProj = new ServiceKey<IHierarchyContributor>('proj');
        const sp = new ServiceProvider();
        // The contributor both produces 'project' children AND dispatches their actions.
        const proj: IHierarchyContributor = {
            ParentKeys: ['solution'],
            Order: 0,
            Contribute: () => new NodeContribution([spec('project', 'MyProj')]),
            Resolve: (id: string, _c: CommandContext): ICommand | undefined => new RelayCommand(() => executed.push(id)),
        };
        sp.registerInstance(kProj, proj);
        const registry = new HierarchyContributorRegistry(sp);

        const def = new HierarchyContributorDefinition();
        def.ParentKeys = ['solution'];
        def.Contributor = kProj;
        def.Order = 0;
        def.Actions = [action('rename', 'Rename', 'project', 10), action('build', 'Build', 'project', 20),
                       action('x', 'X', 'other', 0)];   // 'other' must not show on a project node
        registry.Register(def);

        const h = new Hierarchy(registry, noopHost(), { Services: new ServiceProvider() });
        return { h, executed, registry };
    }

    test('BuildActions returns only the actions whose Context matches the node Key, in Order', () =>
    {
        const { h } = setup();
        h.SeedRoot('solution');
        const project = h.Roots.ToArray()[0]!;
        const menu = project.BuildActions(new HierarchyActionContext(project, [project]));
        assert.deepEqual(menu.ToArray().map(vm => vm.Title), ['Rename', 'Build']);
    });

    test('resolved command executes through the supplying contributor', () =>
    {
        const { h, executed } = setup();
        h.SeedRoot('solution');
        const project = h.Roots.ToArray()[0]!;
        const menu = project.BuildActions(new HierarchyActionContext(project, [project]));
        menu.ToArray()[0]!.Command.Execute(undefined);
        assert.deepEqual(executed, ['rename']);
    });

    test('a node Key with no matching action yields an empty menu', () =>
    {
        const { h } = setup();
        const root = h.SeedRoot('solution');     // 'solution' has no actions
        const menu = root.BuildActions(new HierarchyActionContext(root, [root]));
        assert.equal(menu.Count, 0);
    });

    test('BuildActions builds a fresh collection each call (per-open, no retained state)', () =>
    {
        const { h } = setup();
        h.SeedRoot('solution');
        const project = h.Roots.ToArray()[0]!;
        const first = project.BuildActions(new HierarchyActionContext(project, [project]));
        const second = project.BuildActions(new HierarchyActionContext(project, [project]));
        assert.notEqual(first, second);
        assert.notEqual(first.ToArray()[0], second.ToArray()[0]);
    });

    test('a contributor that produces NO nodes still contributes actions by Key (Review Focus 4)', () =>
    {
        const { h, registry, executed } = setup();
        h.SeedRoot('solution');
        const project = h.Roots.ToArray()[0]!;

        // A second, runtime-registered contributor: no Contribute output of its own,
        // but it dispatches an extra action tagged for the 'project' Key.
        const log: string[] = [];
        const extra: IHierarchyContributor = {
            ParentKeys: ['solution'],
            Order: 1,
            Contribute: () => new NodeContribution([]),
            Resolve: (id: string): ICommand | undefined => new RelayCommand(() => log.push(id)),
        };
        registry.RegisterInstance(extra, [action('project.extra', 'Extra', 'project', 30)]);

        const menu = project.BuildActions(new HierarchyActionContext(project, [project]));
        assert.deepEqual(menu.ToArray().map(vm => vm.Title), ['Rename', 'Build', 'Extra']);

        menu.ToArray()[2]!.Command.Execute(undefined);
        assert.deepEqual(log, ['project.extra']);
        assert.deepEqual(executed, []);   // dispatched through its OWN contributor, not proj's
    });
});
