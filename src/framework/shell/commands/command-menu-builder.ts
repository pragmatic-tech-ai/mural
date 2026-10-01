import type { IServiceProvider, ICommand } from '../../../runtime/index.js';
import type { ICommandDispatcher } from './command-dispatcher.js';
import type { CommandContext } from './command-context.js';
import type { ICommandContributor } from './command-contributor.js';
import type { ICommandChildRealizer } from './command-child-realizer.js';
import { CommandDefinition } from './command-definition.js';
import { CommandViewModel } from './command-view-model.js';

// Builds a CommandViewModel tree from CommandDefinition roots for a menu surface:
// resolves each command through the active ICommandDispatcher (so the rendered
// item dispatches + gates exactly like the toolbar), and realizes a node's
// children lazily on submenu-open — declared CommandDefinition.Children first,
// then any ChildrenContributor's output (resolved via the provider). One builder
// instance per menu-open; disposing the root VM tears the whole tree down.
//
// RULING (R-isToggle): a plain menu node is never a toggle — Build always
// constructs a plain CommandViewModel. Toggle STATE still rides
// CommandViewModel.IsChecked; the CommandToggleViewModel path is reintroduced in
// the checkable-menu-item task once a real condition (the menu node's group
// presentation) drives it — no dead branch kept here in the meantime.
export class CommandMenuBuilder implements ICommandChildRealizer
{
    constructor(
        private readonly dispatcher: ICommandDispatcher,
        private readonly provider:   IServiceProvider,
        private readonly context:    CommandContext,
    )
    {
    }

    // Wrap one definition (command resolved now; children deferred to EnsureExpanded).
    public Build(definition: CommandDefinition): CommandViewModel
    {
        const command = this.dispatcher.Resolve(definition.Id, this.context) as ICommand;
        const vm = new CommandViewModel(definition, command, false);
        if (definition.Children.Count > 0 || definition.ChildrenContributor !== undefined)
        {
            vm.SetChildRealizer(this);
        }
        return vm;
    }

    // ICommandChildRealizer — declared children first, contributed after.
    public RealizeChildren(parent: CommandViewModel): void
    {
        for (const childDef of parent.Definition.Children)
        {
            parent.Children.Add(this.Build(childDef));
        }
        const token = parent.Definition.ChildrenContributor;
        if (token !== undefined)
        {
            const contributor = this.provider.getRequired(token) as ICommandContributor;
            for (const childDef of contributor.Contribute(parent.Definition, this.context))
            {
                parent.Children.Add(this.Build(childDef));
            }
        }
    }
}
