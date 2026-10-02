import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application, ServiceKey, ServiceProvider, RelayCommand, type ICommand } from '../../../runtime/index.js';
import { Hierarchy } from '../hierarchy.js';
import { HierarchyContributorRegistry } from '../hierarchy-contributor-registry.js';
import { HierarchyContributorDefinition } from '../hierarchy-contributor-definition.js';
import { NodeContribution, type IHierarchyContributor, type HierarchyNodeSpec } from '../hierarchy-contribution.js';
import { HierarchyActionContext } from '../hierarchy-action-context.js';
import type { HierarchyItem, IHierarchyItemHost } from '../hierarchy-item.js';
import { CommandRegistry } from '../../shell/commands/command-registry.js';
import { CommandDefinition } from '../../shell/commands/command-definition.js';
import { CommandContext } from '../../shell/commands/command-context.js';
import type { ICommandDispatcher } from '../../shell/commands/command-dispatcher.js';

function noopHost(): IHierarchyItemHost
{
    return { Activate: () => {}, CommitRename: () => {}, OnItemRemoved: () => {} };
}

function spec(key: string, ext: unknown, caption: string): HierarchyNodeSpec
{
    return { Key: key, ExtObject: ext, Caption: caption, IsExpandable: false };
}

const ProjectContext = new ServiceKey<unknown>('project.commands');
const OtherContext = new ServiceKey<unknown>('other.commands');

describe('Hierarchy — command-driven actions', () =>
{
    function setup(): { h: Hierarchy; executed: string[] }
    {
        const kProj = new ServiceKey<IHierarchyContributor>('proj');
        const sp = new ServiceProvider();
        sp.registerInstance(kProj, {
            ParentKeys: ['solution'],
            Order: 0,
            Contribute: () => new NodeContribution([spec('project', {}, 'MyProj')]),
            Resolve: (_i: string, _c: CommandContext) => undefined,
        } as IHierarchyContributor);
        const registry = new HierarchyContributorRegistry(sp);
        const d = new HierarchyContributorDefinition();
        d.ParentKeys = ['solution'];
        d.Contributor = kProj;
        d.Order = 0;
        registry.Register(d);

        // R-CMDREG: a bare `new ServiceProvider()` has no ApplicationService
        // registered, and CommandRegistry.PopulateFromModules resolves it via
        // getRequired (not tolerant) — so the plain-provider construction the
        // brief sketched throws. Mirror main-menu-service.test.ts instead: an
        // Application supplies ApplicationService for free, and the registry
        // is resolved through its Services container.
        const app = new Application();
        app.Services.register(CommandRegistry.Key, p => new CommandRegistry(p));
        const commandRegistry = app.Services.getRequired(CommandRegistry.Key);

        const rename = new CommandDefinition();
        rename.Id = 'rename'; rename.Title = 'Rename'; rename.Context = ProjectContext; rename.Order = 10;
        const build = new CommandDefinition();
        build.Id = 'build'; build.Title = 'Build'; build.Context = ProjectContext; build.Order = 20;
        const foreign = new CommandDefinition();
        foreign.Id = 'x'; foreign.Title = 'X'; foreign.Context = OtherContext; foreign.Order = 0;
        commandRegistry.Commands.Add(rename);
        commandRegistry.Commands.Add(build);
        commandRegistry.Commands.Add(foreign);

        const executed: string[] = [];
        const dispatcher: ICommandDispatcher = {
            Resolve: (id: string, _ctx: CommandContext): ICommand | undefined => new RelayCommand(() => { executed.push(id); }),
        };

        const h = new Hierarchy(registry, noopHost(), {
            CommandRegistry: commandRegistry,
            Dispatcher: dispatcher,
            CommandContexts: new Map<string, ServiceKey<unknown>>([['project', ProjectContext]]),
            Services: new ServiceProvider(),
        });
        return { h, executed };
    }

    test('BuildActions returns only the roots scoped to the node key, in Order', () =>
    {
        const { h } = setup();
        h.SeedRoot('solution');
        const project = h.Roots.ToArray()[0]!;
        const menu = project.BuildActions(new HierarchyActionContext(project, [project]));
        assert.deepEqual(menu.ToArray().map(vm => vm.Title), ['Rename', 'Build']);
    });

    test('resolved command executes through the injected dispatcher', () =>
    {
        const { h, executed } = setup();
        h.SeedRoot('solution');
        const project = h.Roots.ToArray()[0]!;
        const menu = project.BuildActions(new HierarchyActionContext(project, [project]));
        menu.ToArray()[0]!.Command.Execute(undefined);
        assert.deepEqual(executed, ['rename']);
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

    test('a node key with no context tag yields an empty menu', () =>
    {
        const { h } = setup();
        const root = h.SeedRoot('solution');
        const menu = root.BuildActions(new HierarchyActionContext(root, [root]));   // 'solution' has no tag
        assert.equal(menu.Count, 0);
    });
});
