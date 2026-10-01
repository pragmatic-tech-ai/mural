import { ContextMenu } from './context-menu.js';
import {
    ObservableCollection,
    type IServiceProvider,
    type PropertyDescriptor,
} from '../../runtime/index.js';
import type { DataTemplate } from '../../basic/index.js';
import { CommandMenuBuilder } from '../shell/commands/command-menu-builder.js';
import { CommandContext } from '../shell/commands/command-context.js';
import type { ICommandDispatcher } from '../shell/commands/command-dispatcher.js';
import { CommandViewModel } from '../shell/commands/command-view-model.js';
import { CommandDefinition } from '../shell/commands/command-definition.js';

// CommandContextMenu — a ContextMenu whose content is a CommandViewModel tree
// built FRESH on every open and disposed on every close.
//
// Why fresh-per-open: a node's ChildrenContributor-backed submenu
// (CommandViewModel.EnsureExpanded → ICommandContributor.Contribute) must
// re-evaluate every time the menu opens — the contributor's output can depend
// on live state (selection, document contents) that changed since the last
// open. A tree built once and reused across opens would show stale children.
//
// Why dispose-on-close: CommandMenuBuilder resolves one ICommand per node
// through the active ICommandDispatcher and wires it onto the rendered
// MenuItem via the shipped @CommandMenuItemTemplate's `$Command` /
// `$IsChecked` bindings. Those bindings subscribe to the VM's INPC channel
// (CommandViewModel.PropertyChanged) — left attached across opens they'd
// accumulate one subscription per open. Disposing the whole built tree on
// close (CommandViewModel.dispose recurses into Children) is what makes
// repeated open/close leak-free.
//
// Roots + the ambient dispatcher/provider are supplied by the host (the
// shell passes the active ICommandDispatcher + its IServiceProvider).
export class CommandContextMenu extends ContextMenu
{
    // The keyed HierarchicalDataTemplate shipped in shell.template.mu
    // (`x:key="CommandMenuItemTemplate"`) — resolved from the resource chain
    // on every open so the menu renders through the REAL shipped template
    // (not a hand-rolled stand-in), exercising its `$Title` / `$Icon` /
    // `$Command` / `$IsToggle` / `$IsChecked` bindings at runtime.
    private static readonly CommandMenuItemTemplateKey = 'CommandMenuItemTemplate';

    private readonly roots:      readonly CommandDefinition[];
    private readonly dispatcher: ICommandDispatcher;
    private readonly provider:   IServiceProvider;

    // The VM tree built by the most recent open — recursion roots only
    // (CommandViewModel.dispose recurses into Children, so disposing these
    // tears down the whole realized tree, expanded or not). Empty while
    // closed.
    private built: CommandViewModel[] = [];

    constructor(roots: readonly CommandDefinition[], dispatcher: ICommandDispatcher, provider: IServiceProvider)
    {
        super();
        this.roots      = roots;
        this.dispatcher = dispatcher;
        this.provider   = provider;
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue:   unknown,
        newValue:   unknown,
    ): void
    {
        // Base first — ContextMenu's own IsOpen=false handling (submenu
        // cascade + unmountPopup) must run before we tear down the VM tree
        // it was rendering.
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (descriptor.Name === 'IsOpen')
        {
            if (newValue === true) this.BuildTree();
            else this.TearDown();
        }
    }

    // Build the root CommandViewModels through a FRESH CommandMenuBuilder —
    // a new CommandContext per open, so any per-open contextual state starts
    // clean — and set them as ItemsSource against the real keyed template.
    private BuildTree(): void
    {
        const builder = new CommandMenuBuilder(this.dispatcher, this.provider, new CommandContext());
        this.built = this.roots.map(def => builder.Build(def));
        this.ItemTemplate = this.FindResource(CommandContextMenu.CommandMenuItemTemplateKey) as DataTemplate;
        const items = new ObservableCollection<CommandViewModel>();
        for (const vm of this.built) items.Add(vm);
        this.ItemsSource = items;
    }

    // Dispose every built VM (recursing into any realized children) and
    // clear ItemsSource — releases the rendered rows' bindings (the
    // generator clears their DataContext/ItemsSource via
    // MenuContainerFactory.ClearContainer) and drops the VM references so
    // nothing from this open survives into the next.
    private TearDown(): void
    {
        for (const vm of this.built) vm.dispose();
        this.built = [];
        this.ItemsSource = undefined;
    }
}
