import { Disposable, isCheckableCommand, type IServiceProvider, type ICommand } from '../../../runtime/index.js';
import type { ICommandDispatcher } from './command-dispatcher.js';
import type { CommandContext } from './command-context.js';
import type { ICommandContributor } from './command-contributor.js';
import type { ICommandChildRealizer } from './command-child-realizer.js';
import { CommandDefinition, CommandGroupPresentation } from './command-definition.js';
import { CommandViewModel } from './command-view-model.js';

// Builds a CommandViewModel tree from CommandDefinition roots for a menu surface:
// resolves each command through the active ICommandDispatcher (so the rendered
// item dispatches + gates exactly like the toolbar), and realizes a node's
// children lazily on submenu-open — declared CommandDefinition.Children first,
// then any ChildrenContributor's output (resolved via the provider). One builder
// instance per menu-open; disposing the root VM tears the whole tree down.
//
// RULING (R-isToggle, settled): a menu node is a toggle when its DEFINITION
// declares `Presentation = Toggles` — the same group-presentation vocabulary
// the toolbar already reads (CommandGroupPresentation), reused here as a
// per-command marker rather than a cluster-wide one. When the resolved command
// is ALSO an ICheckableCommand (the normal case — a checkable menu row without
// a backing ICheckableCommand would never update), Build seeds IsChecked from
// it immediately and attaches a live-sync listener on the command's
// CanExecuteChanged channel (ICheckableCommand's documented change signal) so
// a click — which flips the command's state and re-pulses that channel —
// updates CommandViewModel.IsChecked, which the shipped @CommandMenuItemTemplate
// binds `IsChecked = $IsChecked` against. The listener rides vm.subscriptions,
// so vm.dispose() (per-open teardown, CommandContextMenu; per-Rebuild teardown,
// MainMenuService) detaches it — no accumulation across repeated opens.
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
        const isToggle = definition.Presentation === CommandGroupPresentation.Toggles;
        const vm = new CommandViewModel(definition, command, isToggle);
        if (isToggle && command !== undefined && isCheckableCommand(command))
        {
            vm.IsChecked = command.IsChecked;
            const onCanExecuteChanged = (): void => { vm.IsChecked = command.IsChecked; };
            command.AddCanExecuteChangedListener(onCanExecuteChanged);
            vm.AddSubscription(new Disposable(() => command.RemoveCanExecuteChangedListener(onCanExecuteChanged)));
        }
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
