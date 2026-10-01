import {
    ObservableCollection,
    ServiceBase,
    ServiceKey,
    type IServiceProvider,
} from '../../../runtime/index.js';
import { ContentHostService } from '../services/content-host-service.js';
import { DocumentsContentHostService } from '../services/documents-content-host-service.js';
import { CommandRegistry } from './command-registry.js';
import { CommandMenuBuilder } from './command-menu-builder.js';
import { CommandContext } from './command-context.js';
import { CommandViewModel } from './command-view-model.js';
import { ShellRegion } from './shell-control-definition.js';
import { type ICommandDispatcher, isCommandDispatcher } from './command-dispatcher.js';

// A dispatcher that resolves nothing. Handed to CommandMenuBuilder in place of
// the active document's ICommandDispatcher when no document is active, so
// building the main-menu roots never special-cases "no dispatcher" — every
// root still gets a real (if inert) ICommand whose CanExecute is simply never
// true until a document activates. Building against this never throws; it is
// the deliberate no-op alternative to teaching CommandMenuBuilder about an
// absent dispatcher.
class NoOpCommandDispatcher implements ICommandDispatcher
{
    public Resolve(): undefined { return undefined; }
}

// Builds the persistent menu-bar root CommandViewModels — the MainMenu-region
// CommandDefinition roots declared across the composed modules' CommandRegistry
// — for a MenuStrip to render as the shell's main menu (the live wiring into
// PART_CommandHost is Milestone C; this service is the machinery a MenuStrip
// binds `ItemsSource = $service(MainMenuService).RootItems` against, with
// `ItemTemplate = @CommandMenuItemTemplate`, Task 3's keyed hierarchical
// template).
//
// LAZY-ONCE roots, NOT build-fresh-per-open (contrast CommandContextMenu, Task
// 4): a menu bar's top-level items ("File", "Edit", …) are persistent chrome —
// they don't disappear between opens — so they're built once (in the ctor) and
// reused. Each root's OWN submenu still realizes its Children lazily on first
// open (CommandViewModel.EnsureExpanded → CommandMenuBuilder.RealizeChildren,
// Task 1), so a ChildrenContributor's live output is unaffected; only the
// roots themselves don't get rebuilt on every open.
//
// Resolves the active dispatcher exactly like ToolbarService (same
// ContentHostService → DocumentsContentHostService → ActiveDocument chain). A
// root built while no document is active dispatches through
// NoOpCommandDispatcher — inert until Rebuild() is called again with a live
// active document. Milestone C wires that re-point (subscribing
// PropertyChanged('ActiveDocument') and calling Rebuild(), as ToolbarService
// does); this task only has to make Rebuild() safe to call repeatedly.
export class MainMenuService extends ServiceBase
{
    public static readonly Key = new ServiceKey<MainMenuService>('MainMenuService');

    private static readonly NoOpDispatcher: ICommandDispatcher = new NoOpCommandDispatcher();

    private readonly _rootItems = new ObservableCollection<CommandViewModel>();
    private readonly _host: DocumentsContentHostService | undefined;

    constructor(provider: IServiceProvider)
    {
        super(provider);

        const host = this.Provider.get(ContentHostService.Key);
        if (host instanceof DocumentsContentHostService)
        {
            this._host = host;
        }

        this.Rebuild();
    }

    // The persistent menu-bar roots, in CommandRegistry declaration order. A
    // MenuStrip binds its ItemsSource against this collection.
    public get RootItems(): ObservableCollection<CommandViewModel> { return this._rootItems; }

    // Dispose the current root VMs (CommandViewModel.dispose recurses into any
    // realized Children, so a previously-opened root's whole tree tears down
    // too) and rebuild from the registry's current MainMenu-region roots
    // against the active dispatcher. Safe to call repeatedly — a future
    // active-document-changed hook (Milestone C) calls this to re-point the
    // roots' dispatch at the newly active document.
    public Rebuild(): void
    {
        for (const vm of this._rootItems) vm.dispose();
        this._rootItems.Clear();

        const registry = this.Provider.get(CommandRegistry.Key);
        if (registry === undefined) return;

        const dispatcher = this.ActiveDispatcher() ?? MainMenuService.NoOpDispatcher;
        const builder = new CommandMenuBuilder(dispatcher, this.Provider, new CommandContext());

        for (const def of registry.Commands)
        {
            if (def.Region === ShellRegion.MainMenu) this._rootItems.Add(builder.Build(def));
        }
    }

    // The active document, if it resolves commands — mirrors
    // ToolbarService.ActiveDispatcher (same host/document chain).
    private ActiveDispatcher(): ICommandDispatcher | undefined
    {
        const doc = this._host?.ActiveDocument;
        return isCommandDispatcher(doc) ? doc : undefined;
    }
}
