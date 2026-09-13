import {
    ApplicationService,
    MuralBase,
    ObservableCollection,
    RelayCommand,
    ServiceBase,
    ServiceKey,
    type IServiceProvider,
    type ServiceToken,
} from '../../../runtime/index.js';
import type { Geometry, Visual } from '../../../visual-engine/index.js';
import { CommandManager } from '../../commands/command-manager.js';
import { ContentHostService } from '../services/content-host-service.js';
import { DocumentsContentHostService } from '../services/documents-content-host-service.js';
import { CommandRegistry } from './command-registry.js';
import { CommandDefinition, CommandGroupPresentation } from './command-definition.js';
import { ShellControlAlignment, ShellRegion, type ShellControlDefinition } from './shell-control-definition.js';
import { StatusService } from '../services/status-service.js';
import { StatusBarItem } from '../../status-bar/status-bar.js';
import { DockPanel, Dock } from '../../../basic/panels/dock-panel.js';
import { CommandToggleViewModel, CommandViewModel } from './command-view-model.js';
import {
    ShellControlViewModel,
    ToolbarFlatGroup,
    ToolbarSeparatorItem,
    ToolbarSplitGridGroup,
    ToolbarSplitMenuGroup,
    ToolbarToggleGroup,
    type ToolbarEntryViewModel,
    type ToolbarGroupViewModel,
} from './toolbar-group-view-model.js';
import { ShellModule } from '../module.js';
import { type ICommandTarget, isCommandTarget } from './command-target.js';

// Turns declared CommandDefinitions into the toolbar the shell shows for the
// ACTIVE document. It:
//   • filters the CommandRegistry by the active document's live CommandContexts
//     (a command is visible iff its Context is one the document activates),
//   • orders the survivors by Group then Order,
//   • wraps each in a CommandViewModel whose RelayCommand dispatches to the
//     active document — `activeDocument.Execute(definition)` — with CanExecute
//     gated by `activeDocument.CanExecute(definition)`.
//
// There is no command routing: the handler is unambiguous (the active document),
// so the RelayCommand closes over THIS service and re-reads the active document
// on every invocation — the VMs stay valid across tab switches; only which are
// visible changes.
//
// Requery: a plain RelayCommand's CanExecuteChanged only fires when we raise it,
// so this service bridges the two "executability may have changed" signals to
// every VM command — CommandManager.RequerySuggested (the global pulse a
// document fires on, e.g., a selection change) and ActiveDocument changes.
//
// The content host is resolved as a DocumentsContentHostService (the document
// workspace). A base ContentHostService (no document set) yields an empty
// toolbar. Auto-registered by EditorShell.
export class ToolbarService extends ServiceBase
{
    public static readonly Key = new ServiceKey<ToolbarService>('ToolbarService');

    // The commands to show for the active document, already filtered by context
    // and ordered by Group/Order. A toolbar binds `ItemsSource = $VisibleCommands`
    // and renders each CommandViewModel through a DataTemplate.
    private readonly _visibleCommands = new ObservableCollection<CommandViewModel>();

    // The render list the shell command bar binds: command GROUPS (Flat /
    // SplitMenu / SplitGrid / Toggles) and editor CONTROLS interleaved by Order.
    // Each entry is a ToolbarEntryViewModel subclass the shell dispatches on by
    // type. VisibleCommands stays the flat projection for callers that want the
    // ungrouped command set.
    private readonly _visibleEntries = new ObservableCollection<ToolbarEntryViewModel>();

    // The FLAT render list the shell command bar's single ToolBar binds. Same
    // entries as VisibleEntries, but Flat / Toggles groups are EXPANDED into their
    // individual command VMs (CommandViewModel / CommandToggleViewModel) and a
    // ToolbarSeparatorItem is inserted between adjacent top-level entries. The one
    // ToolBar then draws each group's buttons as a connected pill (its Position
    // assignment) with the separators marking group boundaries — the WPF
    // ToolBar-with-groups look. Split groups and editor controls ride as single
    // items (their own DataTemplate). VisibleEntries stays the GROUPED projection
    // for callers that want one VM per group.
    private readonly _toolbarItems = new ObservableCollection<MuralBase>();

    // The Toolbar-region editor CONTROLS (font pickers, …), Order-sorted. Rendered
    // in a FIXED region beside the command ToolBar — NOT inside it. A ToolBar
    // overflows its trailing items into a popup and re-parents items across layout
    // passes; a wide interactive editor doesn't survive that (it would vanish into
    // the overflow chevron and its hit-testing breaks). So controls live here and
    // the command groups live in ToolbarItems.
    private readonly _toolbarControls = new ObservableCollection<ShellControlViewModel>();

    // Cache one VM per definition — rebuilt filtering swaps which are in
    // VisibleCommands, but the VM (and its RelayCommand the button binds) is
    // stable, so a tab switch doesn't churn command instances.
    private readonly _vmById = new Map<string, CommandViewModel>();
    private readonly _host: DocumentsContentHostService | undefined;
    private readonly _requery = (): void => this.RaiseAll();
    // The status-bar cells this service currently owns in StatusService.Items
    // (ShellControlViewModels for left cells, wrapper StatusBarItems for right-
    // docked cells, plus a fill spacer) — removed on the next rebuild.
    private _statusCells: unknown[] = [];
    // Signature of the command set behind the last-built command ToolBar. Lets
    // Rebuild skip the expensive ToolbarItems teardown when a document switch
    // lands on the SAME command set (the common case — same-type documents).
    private _lastCommandSig: string | undefined = undefined;
    // The clusters behind the last-built command ToolBar. Reused verbatim on a
    // same-command switch so the grouped projection (VisibleEntries) and the flat
    // ToolBar (ToolbarItems) keep pointing at the SAME group VM instances — the
    // shared-instance invariant callers/tests rely on.
    private _lastClusters: GroupCluster[] = [];

    constructor(provider: IServiceProvider)
    {
        super(provider);

        // Track the active document. The host is registered under
        // ContentHostService.Key; only a DocumentsContentHostService carries an
        // ActiveDocument, so a plain host leaves the toolbar empty.
        const host = this.Provider.get(ContentHostService.Key);
        if (host instanceof DocumentsContentHostService)
        {
            this._host = host;
            host.PropertyChanged('ActiveDocument').subscribe(
                () => this.OnActiveDocumentChanged());
        }

        // Bridge the global requery pulse to our VM commands.
        CommandManager.SubscribeRequerySuggested(this._requery);

        this.Rebuild();
    }

    public get VisibleCommands(): ObservableCollection<CommandViewModel> { return this._visibleCommands; }

    public get VisibleEntries(): ObservableCollection<ToolbarEntryViewModel> { return this._visibleEntries; }

    public get ToolbarItems(): ObservableCollection<MuralBase> { return this._toolbarItems; }

    public get ToolbarControls(): ObservableCollection<ShellControlViewModel> { return this._toolbarControls; }

    // Detach the global-pulse subscription when this scoped service is torn down.
    public override dispose(): void
    {
        CommandManager.UnsubscribeRequerySuggested(this._requery);
        super.dispose();
    }

    private OnActiveDocumentChanged(): void
    {
        // A tab switch writes ActiveDocument more than once: the Selector
        // transiently clears the selection (ActiveDocument = undefined) before
        // setting the newly-clicked document. Ignore that mid-switch undefined
        // while documents remain open — rebuilding the toolbar to "empty" and
        // straight back is the teardown we're trying to avoid. A genuine
        // no-active-document state only arises when the open set is empty (the
        // last document closed), which is NOT skipped here.
        if (this._host?.ActiveDocument === undefined
            && (this._host?.OpenDocuments.Count ?? 0) > 0)
        {
            return;
        }
        this.Rebuild();
        this.RaiseAll();
    }

    // The active document, if it handles commands. undefined when nothing is
    // active or the active document isn't a command target (e.g. a settings page).
    private ActiveTarget(): ICommandTarget | undefined
    {
        const doc = this._host?.ActiveDocument;
        return isCommandTarget(doc) ? doc : undefined;
    }

    // Recompute VisibleCommands: the registry filtered by the active target's
    // contexts, ordered by Group then Order, mapped to cached VMs.
    private Rebuild(): void
    {
        const visible  = this.VisibleCommands;
        const entries  = this.VisibleEntries;
        const items    = this.ToolbarItems;
        const controls = this.ToolbarControls;

        const target = this.ActiveTarget();
        this.SyncStatusItems(target);

        // App-global (service-bound) toolbar controls surface even when no
        // command target is active; document-bound controls need one. Build the
        // toolbar controls up front so the no-target branch can still show the
        // app-global ones.
        const contexts = target?.CommandContexts ?? [];
        const toolbarControls = this.BuildControls(target, contexts);

        if (target === undefined)
        {
            visible.Clear();
            entries.Clear();
            items.Clear();
            controls.Clear();
            this._lastCommandSig = '';
            this._lastClusters = [];
            toolbarControls.sort((a, b) => a.order - b.order);
            for (const c of toolbarControls) { entries.Add(c.vm); controls.Add(c.vm); }
            return;
        }

        const registry = this.Provider.get(CommandRegistry.Key);
        if (registry === undefined) return;
        const matched: CommandDefinition[] = [];
        for (const def of registry.Commands)
        {
            if (def.Context !== undefined && contexts.includes(def.Context)) matched.push(def);
        }
        // Sort by Order globally (a module assigns order values that keep its
        // groups contiguous); Group is a secondary tiebreak so a group's members
        // stay together and in order.
        matched.sort((a, b) => a.Order - b.Order || a.Group.localeCompare(b.Group));

        // Signature of the command set this activation would show. When it equals
        // the last-built one — switching between documents that expose the SAME
        // commands (the common case, e.g. two diagrams) — the command ToolBar's
        // realized buttons and split-menu dropdowns are already correct: each
        // cached command VM dispatches to the LIVE active document, so tearing
        // down and re-materializing ~500 controls reproduces exactly what's
        // there. `items.Count > 0` guards the first build (empty ToolbarItems).
        const sig = matched.map(d => d.Id).join('|');
        const commandsUnchanged = sig === this._lastCommandSig && items.Count > 0;

        // Cluster into presentation groups. Both the grouped VisibleEntries
        // projection and the flat ToolbarItems render list derive from these.
        // On an unchanged command set, REUSE the last clusters so both projections
        // (and the still-realized ToolBar) keep the same group VM instances.
        const clusters = commandsUnchanged ? this._lastClusters : this.ClusterGroups(matched);

        // VisibleCommands — the flat, ungrouped projection (cached VMs, Order
        // sorted). Unbound to any view, so cheap to refresh every time; callers
        // and tests read the current set here. Every matched def now has a VM
        // (ClusterGroups made them).
        visible.Clear();
        for (const def of matched) visible.Add(this.VmFor(def));

        // Interleave command GROUPS and editor CONTROLS in one Order-sorted list.
        // A group's Order is its first (lowest-Order) member's; a control's is its
        // own. A stable sort keeps groups/controls sharing an Order in declaration
        // order.
        const ordered: OrderedEntry[] = [];
        for (const c of clusters) ordered.push({ order: c.order, kind: 'group', cluster: c });
        for (const ctl of toolbarControls) ordered.push({ order: ctl.order, kind: 'control', control: ctl.vm });
        ordered.sort((a, b) => a.order - b.order);

        // Grouped projection: one VM per group + each control (interleaved by
        // Order — unchanged; the shell's old command host and callers rely on it).
        // Also unbound, so refreshed every time.
        entries.Clear();
        for (const e of ordered) entries.Add(e.kind === 'group' ? e.cluster.group : e.control);

        // Editor controls (fixed region beside the command ToolBar) — bound, but
        // document-dependent (their DataContext is the active document), so they
        // MUST refresh on every switch. Few in number, so cheap.
        controls.Clear();
        for (const e of ordered) if (e.kind === 'control') controls.Add(e.control);

        // Flat command projection (the command ToolBar) — the EXPENSIVE, bound
        // list. Command GROUPS only: Flat / Toggles groups expand into their
        // command VMs, split groups ride as one item, and a separator sits between
        // adjacent groups. Gated on `commandsUnchanged`: skipped when the command
        // set is identical to the last build, leaving the realized ToolBar intact.
        if (!commandsUnchanged)
        {
            items.Clear();
            let first = true;
            for (const e of ordered)
            {
                if (e.kind !== 'group') continue;
                if (!first) items.Add(new ToolbarSeparatorItem());
                first = false;

                if (e.cluster.presentation === CommandGroupPresentation.Flat
                 || e.cluster.presentation === CommandGroupPresentation.Toggles)
                {
                    for (const vm of e.cluster.commandVms) items.Add(vm);
                }
                else
                {
                    items.Add(e.cluster.group);
                }
            }
            this._lastCommandSig = sig;
            this._lastClusters = clusters;
        }

        this.RefreshActiveStates();
    }

    // Cluster the (already Order-sorted) definitions into presentation groups.
    // A group's presentation + dropdown face come from its LEADER — the first
    // member whose Presentation is non-Flat; a group with no such member stays
    // Flat. Encounter order follows the global Order sort. Returns the built group
    // VM AND its member command VMs + presentation, so callers can render either
    // the grouped face (VisibleEntries) or the expanded buttons (ToolbarItems)
    // without re-clustering. Toggles-group members are built as
    // CommandToggleViewModels so the flat stream resolves the toggle template.
    private ClusterGroups(matched: readonly CommandDefinition[]): GroupCluster[]
    {
        const order: string[] = [];
        const members = new Map<string, CommandDefinition[]>();
        for (const def of matched)
        {
            let bucket = members.get(def.Group);
            if (bucket === undefined) { bucket = []; members.set(def.Group, bucket); order.push(def.Group); }
            bucket.push(def);
        }

        const out: GroupCluster[] = [];
        for (const group of order)
        {
            const defs = members.get(group)!;
            const leader = defs.find(d => d.Presentation !== CommandGroupPresentation.Flat);
            const presentation = leader?.Presentation ?? CommandGroupPresentation.Flat;
            const isToggle = presentation === CommandGroupPresentation.Toggles;

            const commandVms = defs.map(def => this.VmFor(def, isToggle));
            const items = new ObservableCollection<CommandViewModel>();
            for (const vm of commandVms) items.Add(vm);

            const icon    = leader?.GroupIcon ?? leader?.Icon;
            const title   = (leader?.GroupTitle ?? '') !== '' ? leader!.GroupTitle : (leader?.Title ?? '');
            const columns = leader?.Columns ?? 0;

            out.push({
                order: defs[0]!.Order,
                presentation,
                group: this.MakeGroup(presentation, items, icon, title, columns),
                commandVms,
            });
        }
        return out;
    }

    // Decide whether a shell control shows, and WHAT its DataContext is. Three
    // kinds, distinguished by which of the definition's axes is set:
    //   • SERVICE-bound (DataContext token set): app-global, shown whenever its
    //     service resolves, bound to that service — no document / Context gate.
    //   • DOCUMENT-bound (Context set, no DataContext): shown only when the active
    //     target activates its Context, bound to the active document.
    //   • APP-GLOBAL, no DataContext (neither set): shown unconditionally with NO
    //     DataContext — the control drives global state itself (e.g. a
    //     ThemeSelector talking to ThemeManager directly).
    // Returns undefined to SKIP; otherwise a wrapper whose `dataContext` may itself
    // be undefined (the third kind) — a plain undefined can't distinguish "skip"
    // from "show with no context", hence the box.
    private ResolveControlContext(
        def:      ShellControlDefinition,
        target:   ICommandTarget | undefined,
        contexts: readonly ServiceToken<unknown>[],
    ): { dataContext: unknown } | undefined
    {
        if (def.DataContext !== undefined)
        {
            const service = this.Provider.get(def.DataContext);
            return service === undefined ? undefined : { dataContext: service };
        }
        if (def.Context !== undefined)
        {
            if (target !== undefined && contexts.includes(def.Context))
            {
                return { dataContext: this._host?.ActiveDocument };
            }
            return undefined;
        }
        // Neither axis set — app-global control with no DataContext.
        return { dataContext: undefined };
    }

    // Gather the modules' TOOLBAR-region controls that should show — app-global
    // service-bound ones plus document-bound ones matching the active contexts —
    // each bound to its resolved DataContext (a service or the active document).
    private BuildControls(
        target:   ICommandTarget | undefined,
        contexts: readonly ServiceToken<unknown>[],
    ): { order: number; vm: ShellControlViewModel }[]
    {
        const out: { order: number; vm: ShellControlViewModel }[] = [];
        const app = this.Provider.get(ApplicationService.Key);
        if (app === undefined) return out;
        for (const module of app.Modules)
        {
            for (const def of (module as ShellModule).ShellControls)
            {
                if (def.Region !== ShellRegion.Toolbar) continue;
                const resolved = this.ResolveControlContext(def, target, contexts);
                if (resolved === undefined) continue;
                out.push({ order: def.Order, vm: new ShellControlViewModel(def.Template, resolved.dataContext) });
            }
        }
        return out;
    }

    // StatusBar-region controls go into the StatusService's Items so the shell
    // status bar renders them. App-global service-bound controls (e.g. a theme
    // picker) show unconditionally; document-bound ones follow the active
    // document. Alignment = End docks a cell to the RIGHT: its view is wrapped in
    // a StatusBarItem with DockPanel.Dock=Right, and a trailing fill spacer is
    // added so the DockPanel's LastChildFill takes the middle rather than
    // stretching the right cell. We own only the cells WE add (tracked in
    // `_statusCells`), so app-posted status cells are left untouched.
    private SyncStatusItems(target: ICommandTarget | undefined): void
    {
        const status = this.Provider.get(StatusService.Key);
        if (status === undefined) return;

        for (const cell of this._statusCells)
        {
            const i = status.Items.IndexOf(cell);
            if (i >= 0) status.Items.RemoveAt(i);
        }
        this._statusCells = [];

        const app = this.Provider.get(ApplicationService.Key);
        if (app === undefined) return;
        const contexts = target?.CommandContexts ?? [];

        const left:  ShellControlViewModel[] = [];
        const right: ShellControlViewModel[] = [];
        for (const module of app.Modules)
        {
            for (const def of (module as ShellModule).ShellControls)
            {
                if (def.Region !== ShellRegion.StatusBar) continue;
                const resolved = this.ResolveControlContext(def, target, contexts);
                if (resolved === undefined) continue;
                const vm = new ShellControlViewModel(def.Template, resolved.dataContext);
                (def.Alignment === ShellControlAlignment.End ? right : left).push(vm);
            }
        }

        // Order in the DockPanel: left cells (default dock = Left), then right
        // cells (Dock = Right), then a fill spacer LAST so LastChildFill claims
        // the middle gap instead of stretching a real cell.
        for (const vm of left)
        {
            status.Items.Add(vm);
            this._statusCells.push(vm);
        }
        for (const vm of right)
        {
            const item = new StatusBarItem();
            (item as unknown as { Content: Visual | undefined }).Content = vm.View;
            DockPanel.SetDock(item, Dock.Right);
            status.Items.Add(item);
            this._statusCells.push(item);
        }
        if (right.length > 0)
        {
            const spacer = new StatusBarItem();
            status.Items.Add(spacer);
            this._statusCells.push(spacer);
        }
    }

    private MakeGroup(
        presentation: CommandGroupPresentation,
        items: ObservableCollection<CommandViewModel>,
        icon: Geometry | undefined,
        title: string,
        columns: number,
    ): ToolbarGroupViewModel
    {
        switch (presentation)
        {
            case CommandGroupPresentation.SplitMenu: return new ToolbarSplitMenuGroup(items, icon, title, columns);
            case CommandGroupPresentation.SplitGrid: return new ToolbarSplitGridGroup(items, icon, title, columns);
            case CommandGroupPresentation.Toggles:   return new ToolbarToggleGroup(items, icon, title, columns);
            default:                                 return new ToolbarFlatGroup(items, icon, title, columns);
        }
    }

    // Sync every built VM's IsActive from the active target's optional IsActive
    // query. Called whenever CanExecute is re-queried (requery pulse / active-doc
    // change) so a Toggles button's checked state tracks the live selection.
    private RefreshActiveStates(): void
    {
        const target = this.ActiveTarget();
        for (const vm of this._vmById.values())
        {
            vm.IsActive = target?.IsActive?.(vm.Definition) ?? false;
        }
    }

    // Get (or build + cache) the VM for a definition. `isToggle` picks the flavor
    // on FIRST build — a command lives in exactly one group whose presentation is
    // static, so the cached instance's type is stable across rebuilds; the flag is
    // ignored on a cache hit.
    private VmFor(def: CommandDefinition, isToggle = false): CommandViewModel
    {
        let vm = this._vmById.get(def.Id);
        if (vm === undefined)
        {
            const command = new RelayCommand(
                () => this.Invoke(def),
                () => this.CanInvoke(def),
                { Text: def.Title });
            vm = isToggle
                ? new CommandToggleViewModel(def, command)
                : new CommandViewModel(def, command);
            this._vmById.set(def.Id, vm);
        }
        return vm;
    }

    private Invoke(def: CommandDefinition): void
    {
        this.ActiveTarget()?.Execute(def);
    }

    private CanInvoke(def: CommandDefinition): boolean
    {
        return this.ActiveTarget()?.CanExecute(def) ?? false;
    }

    // Re-query every built VM command — the button command-sources re-read
    // CanExecute in response. Called on the RequerySuggested pulse and on
    // active-document change.
    private RaiseAll(): void
    {
        for (const vm of this._vmById.values())
        {
            (vm.Command as RelayCommand).RaiseCanExecuteChanged();
        }
        // A selection change (the usual requery trigger) also flips toggle state.
        this.RefreshActiveStates();
    }
}

// One clustered command group — the built group VM (for VisibleEntries), the
// member command VMs (for the flat ToolbarItems expansion), and the presentation
// (decides whether the flat stream expands the members or keeps the group face).
interface GroupCluster
{
    readonly order: number;
    readonly presentation: CommandGroupPresentation;
    readonly group: ToolbarGroupViewModel;
    readonly commandVms: CommandViewModel[];
}

// A top-level command-bar entry in Order space: either a clustered command group
// or a single editor control. Both projections (grouped VisibleEntries / flat
// ToolbarItems) walk the same Order-sorted list of these.
type OrderedEntry =
    | { readonly order: number; readonly kind: 'group';   readonly cluster: GroupCluster }
    | { readonly order: number; readonly kind: 'control'; readonly control: ShellControlViewModel };
