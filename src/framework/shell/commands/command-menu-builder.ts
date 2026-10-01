import type { IServiceProvider, ICommand } from '../../../runtime/index.js';
import type { ICommandDispatcher } from './command-dispatcher.js';
import type { CommandContext } from './command-context.js';
import type { ICommandContributor } from './command-contributor.js';
import type { ICommandChildRealizer } from './command-child-realizer.js';
import { CommandDefinition } from './command-definition.js';
import { CommandToggleViewModel, CommandViewModel } from './command-view-model.js';

// Builds a CommandViewModel tree from CommandDefinition roots for a menu surface:
// resolves each command through the active ICommandDispatcher (so the rendered
// item dispatches + gates exactly like the toolbar), and realizes a node's
// children lazily on submenu-open — declared CommandDefinition.Children first,
// then any ChildrenContributor's output (resolved via the provider). One builder
// instance per menu-open; disposing the root VM tears the whole tree down.
//
// RULING (R-isToggle): a plain menu node is never a toggle — Build always
// constructs a plain CommandViewModel (isToggle = false). Toggle STATE still
// rides CommandViewModel.IsChecked; IsToggle=true is reserved for the toolbar's
// Toggles presentation. Reading a menu node's group presentation to flip this is
// deferred to the checkable-menu-item task, which will force the right answer.
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
        // A plain menu node is never a toggle (R-isToggle) — the branch stays
        // available for the checkable-menu-item task, which will decide how to
        // read a menu node's group presentation; until then this is always false.
        const isToggle = false;
        const vm = isToggle
            ? new CommandToggleViewModel(definition, command, true)
            : new CommandViewModel(definition, command, false);
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
