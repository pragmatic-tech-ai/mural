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
import type { ICommandContributor } from '../../shell/commands/command-contributor.js';

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

        const build = action('build', 'Build', 'project', 20);
        build.AddChild(action('build.verbose', 'Verbose', 'project', 0));   // submenu child — Review Focus 1

        const def = new HierarchyContributorDefinition();
        def.ParentKeys = ['solution'];
        def.Contributor = kProj;
        def.Order = 0;
        def.Actions = [action('rename', 'Rename', 'project', 10), build,
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

    test('a nested child command id routes through the supplying contributor (Review Focus 1 — descendant routing)', () =>
    {
        const { h, executed } = setup();

        // setup()'s 'build' action carries a submenu child ('build.verbose');
        // mapRoutes must register the CHILD id too, not just 'build' itself, so
        // the routing dispatcher can resolve it once CommandMenuBuilder's
        // RealizeChildren builds it lazily on submenu-open.
        h.SeedRoot('solution');
        const project = h.Roots.ToArray()[0]!;
        const menu = project.BuildActions(new HierarchyActionContext(project, [project]));

        const buildVm = menu.ToArray().find(vm => vm.Title === 'Build')!;
        buildVm.EnsureExpanded();
        const childVm = buildVm.Children.ToArray()[0]!;
        assert.equal(childVm.Definition.Id, 'build.verbose');

        childVm.Command.Execute(undefined);
        assert.deepEqual(executed, ['build.verbose']);
    });

    test('a lazily-realized ChildrenContributor submenu command routes through the owning contributor (Review Focus 1 — dynamic ChildrenContributor routing)', () =>
    {
        // Unlike 'build.verbose' above (a STATIC CommandDefinition.Children
        // entry, already covered by Hierarchy.mapRoutes), this child id is
        // produced DYNAMICALLY by an ICommandContributor at submenu-open
        // (CommandMenuBuilder.RealizeChildren) and is never in BuildActions'
        // routes map. HierarchyRoutingDispatcher must fall back to the
        // contributor that owns it.
        const dynamicChildId = 'demo.parent.dynamicChild';
        let flipped = false;

        const kDemo = new ServiceKey<IHierarchyContributor>('demo');
        const sp = new ServiceProvider();
        const demo: IHierarchyContributor = {
            ParentKeys: ['solution'],
            Order: 0,
            Contribute: () => new NodeContribution([spec('project', 'MyProj')]),
            Resolve: (id: string, _c: CommandContext): ICommand | undefined =>
            {
                switch (id)
                {
                    case dynamicChildId: return new RelayCommand(() => { flipped = true; });
                    default: return undefined;
                }
            },
        };
        sp.registerInstance(kDemo, demo);
        const registry = new HierarchyContributorRegistry(sp);

        const kDynamicChildren = new ServiceKey<ICommandContributor>('demo.dynamicChildren');
        const services = new ServiceProvider();
        const dynamicContributor: ICommandContributor = {
            Contribute: (): readonly CommandDefinition[] =>
            {
                const child = new CommandDefinition();
                child.Id = dynamicChildId;
                child.Title = 'Dynamic Child';
                return [child];
            },
        };
        services.registerInstance(kDynamicChildren, dynamicContributor);

        const parentAction = action('demo.parent', 'Demo Parent', 'project', 0);
        parentAction.ChildrenContributor = kDynamicChildren;

        const def = new HierarchyContributorDefinition();
        def.ParentKeys = ['solution'];
        def.Contributor = kDemo;
        def.Order = 0;
        def.Actions = [parentAction];
        registry.Register(def);

        const h = new Hierarchy(registry, noopHost(), { Services: services });
        h.SeedRoot('solution');
        const project = h.Roots.ToArray()[0]!;
        const menu = project.BuildActions(new HierarchyActionContext(project, [project]));

        const parentVm = menu.ToArray()[0]!;
        parentVm.EnsureExpanded();
        const childVm = parentVm.Children.ToArray()[0]!;
        assert.equal(childVm.Definition.Id, dynamicChildId);

        assert.notEqual(childVm.Command, undefined);
        childVm.Command.Execute(undefined);
        assert.equal(flipped, true);
    });
});
