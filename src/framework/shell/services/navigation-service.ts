import {
    ApplicationService,
    type ICommand,
    MetaData,
    MuralBase,
    ObservableCollection,
    RelayCommand,
    ServiceBase,
    ServiceKey,
    ServiceProvider,
    type IServiceProvider,
} from '../../../runtime/index.js';
import { Capability } from '../module.js';
import type { IActivatable } from './activatable.js';
import { RailAction } from '../rail-action.js';
import type { Geometry } from '../../../visual-engine/index.js';

// One entry in the shell's root navigation layer, built from a module's
// Capability. `Label` / `Icon` are DPs a rail-item template binds; `Capability`
// is a stable back-reference (set once, never changes) — the source capability
// this destination WRAPS. A MuralBase so the item is bindable.
//
// The content shown while a destination is active is NOT held here: the
// NavigationService resolves it from the selected item's `Capability.ServiceKey`
// and exposes it as `ActiveService` (a shell's content host binds that). So a
// destination is purely the rail item + a back-reference to its capability.
export class NavigationDestination extends MuralBase
{
    public static readonly LabelKey = MuralBase.RegisterProperty<string>(
        NavigationDestination, 'Label', '', MetaData.None);

    public static readonly IconKey = MuralBase.RegisterProperty<Geometry | undefined>(
        NavigationDestination, 'Icon', undefined, MetaData.None);

    // Command invoked when this destination's activity-bar item is CLICKED —
    // fired on every click, including re-clicking the already-selected item
    // (which the Selector treats as a no-op selection). The NavigationService
    // wires it to its click-toggle logic so re-clicking the active icon toggles
    // the side pane (the VSCode sidebar behaviour). Optional: unset ⇒ a click
    // just selects, no side effect.
    public static readonly ActivateCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        NavigationDestination, 'ActivateCommand', undefined, MetaData.None);

    // The source capability. A plain readonly field (not a DP): identity that
    // never changes, so it needs no change notification.
    public readonly Capability: Capability;

    constructor(capability: Capability)
    {
        super();
        this.Capability = capability;
        this.set_property_value(NavigationDestination.LabelKey, capability.Name);
        this.set_property_value(NavigationDestination.IconKey, capability.Icon);
    }

    public get Label(): string { return this.get_property_value(NavigationDestination.LabelKey); }
    public get Icon(): Geometry | undefined { return this.get_property_value(NavigationDestination.IconKey); }
    public get ActivateCommand(): ICommand | undefined { return this.get_property_value(NavigationDestination.ActivateCommandKey); }
    public set ActivateCommand(v: ICommand | undefined) { this.set_property_value(NavigationDestination.ActivateCommandKey, v); }
}

// Backs the shell's Navigation region. Holds the list of destinations
// and the current selection; the navigation strip binds its items and
// selected-item to these DPs, and whatever drives navigation (a command,
// a behavior, a child VM) writes SelectedItem here.
//
// Items are arbitrary app models (the app supplies its own destination
// shape) — this base stays type-agnostic. Apps that need richer
// navigation (history, guards) subclass and register the subclass
// against NavigationService.Key.
export class NavigationService extends ServiceBase
{
    public static readonly Key = new ServiceKey<NavigationService>('NavigationService');

    // Per-instance collection so the strip always has a target to bind, even
    // before the app populates destinations. Plain Observable properties —
    // bound by name (Items / SelectedItem from the rail, etc.).
    private readonly _items = new ObservableCollection<unknown>();

    private _selectedItem: unknown = undefined;

    // The active capability's content service — what a content host presents
    // while its destination is selected (`Content =
    // $service(NavigationService).ActiveService`), resolved from the selected
    // item's `Capability.ServiceKey` and rendered by a `DataTemplate
    // [DataType=Service]`. `unknown` because the concrete service type varies
    // per capability. Derived (recomputed from SelectedItem via
    // syncActiveService), so a view binds it read-only.
    private _activeService: unknown = undefined;

    // Command actions pinned to the rail's Header (top) and Footer (bottom)
    // slots — the non-destination part of the activity bar (a settings gear, a
    // help button, an account switcher…). Each a RailAction (icon + command);
    // the framework rail template renders each as an IconButton. Apps add to
    // these to populate the rail's chrome slots WITHOUT overriding the rail
    // template. Empty by default — a shell shows only what's contributed.
    private readonly _headerActions = new ObservableCollection<RailAction>();
    private readonly _footerActions = new ObservableCollection<RailAction>();

    // Whether the shell's left side pane (the active capability's panel) is
    // shown — the VSCode "toggle the sidebar" state. The EditorShell template
    // binds `PART_SidePane.Visibility` (and its resize Splitter's) to this, so
    // hiding it collapses the pane out of layout and the content area reclaims
    // the width. Default true (the pane opens with the shell). The visibility
    // binding re-evaluates on change.
    private _sidePaneVisible = true;

    // Flips SidePaneVisible. The side pane's header close (✕) invokes this to
    // hide; re-invoking (e.g. re-clicking the active activity-bar icon) shows
    // it again — the two-way "toggle the sidebar" affordance.
    private readonly _toggleSidePaneCommand: ICommand;

    constructor(provider: IServiceProvider)
    {
        super(provider);
        this._toggleSidePaneCommand = new RelayCommand(
            () => { this.SidePaneVisible = !this.SidePaneVisible; }, undefined,
            { Text: 'Toggle Panel', Description: 'Show or hide the side panel.' });
        // Keep ActiveService in lock-step with the selection.
        this.PropertyChanged('SelectedItem').subscribe(() => this.syncActiveService());
    }

    public get Items(): ObservableCollection<unknown> { return this._items; }

    public get SelectedItem(): unknown { return this._selectedItem; }
    public set SelectedItem(v: unknown)
    {
        const old = this._selectedItem;
        this._selectedItem = v;
        this.RaisePropertyChanged('SelectedItem', old, v);
    }

    public get ActiveService(): unknown { return this._activeService; }

    public get HeaderActions(): ObservableCollection<RailAction> { return this._headerActions; }

    public get FooterActions(): ObservableCollection<RailAction> { return this._footerActions; }

    public get SidePaneVisible(): boolean { return this._sidePaneVisible; }
    public set SidePaneVisible(v: boolean)
    {
        const old = this._sidePaneVisible;
        this._sidePaneVisible = v;
        this.RaisePropertyChanged('SidePaneVisible', old, v);
    }

    public get ToggleSidePaneCommand(): ICommand { return this._toggleSidePaneCommand; }

    // SelectedItem → ActiveService: find the Capability behind the selected item
    // and resolve the service it names (`Capability.ServiceKey`) from the
    // container. The content host presents that service (rendered by a
    // DataTemplate keyed to its type). Called on every SelectedItem change
    // (wired in the ctor). Resolution goes through `ServiceProvider.tokenFor`,
    // matching how the `.services:` block registers and how `$service(...)`
    // consumes — and `get()`'s scope cache means re-selecting a group returns
    // the same service instance, so its state persists across rail switches.
    protected syncActiveService(): void
    {
        const key     = this.capabilityOf(this.SelectedItem)?.ServiceKey;
        const service = key !== undefined
            ? this.Provider.get(ServiceProvider.tokenFor(key as unknown as Function))
            : undefined;
        const oldService = this._activeService;
        this._activeService = service;
        this.RaisePropertyChanged('ActiveService', oldService, service);
        // Selecting a capability reveals its side pane (the VSCode "click an
        // activity-bar icon → show the sidebar" reveal). Clicking a DIFFERENT
        // icon changes SelectedItem and lands here; re-clicking the active icon
        // is a no-op at the Selector, so that path toggles via
        // ToggleSidePaneCommand from the item's press trigger instead.
        this.SidePaneVisible = true;
        // Let the now-active service re-present itself. A content-backing
        // service (DocumentSelectorService) shows through a shared content host
        // that holds the LAST presented item; on a rail switch its own
        // selection hasn't changed, so without this nudge the host keeps the
        // previous capability's content. The service opts in via IActivatable —
        // anything else is left untouched.
        (service as Partial<IActivatable> | undefined)?.OnActivated?.();
    }

    // The Capability behind a navigation item: the item itself when it IS a
    // Capability, or the Capability a NavigationDestination wraps. Undefined for
    // any other item shape (ActiveService then clears).
    private capabilityOf(item: unknown): Capability | undefined
    {
        if (item instanceof Capability)            return item;
        if (item instanceof NavigationDestination) return item.Capability;
        return undefined;
    }

    // Factory for the destination created per capability in PopulateFromModules.
    // The destination wraps the capability (rail Label/Icon + back-reference);
    // the service it names is resolved centrally by syncActiveService, not by
    // the destination. Override to emit a richer destination subclass.
    protected createDestination(capability: Capability): NavigationDestination
    {
        const dest = new NavigationDestination(capability);
        // Wire the click-toggle: clicking an activity-bar item runs this, even
        // on a re-click of the already-selected item (see onDestinationActivated).
        dest.ActivateCommand = new RelayCommand(() => this.onDestinationActivated(dest));
        return dest;
    }

    // The destination last brought to the foreground by a CLICK — the anchor for
    // the re-click toggle. Distinct from SelectedItem: re-clicking the active
    // item leaves SelectedItem unchanged (the Selector no-ops), so this field,
    // not SelectedItem, is what tells a re-click apart from a switch.
    private _lastActivated: NavigationDestination | undefined;

    // Called when an activity-bar destination is clicked. Re-clicking the item
    // already in front toggles the side pane (VSCode "click the active icon to
    // hide/show the sidebar"); clicking a different item brings it forward and
    // ensures the pane is shown. Selection itself is handled by the Selector /
    // syncActiveService; this only owns the visibility toggle.
    protected onDestinationActivated(dest: NavigationDestination): void
    {
        if (dest === this._lastActivated)
        {
            this.SidePaneVisible = !this.SidePaneVisible;
            return;
        }
        this._lastActivated  = dest;
        this.SidePaneVisible = true;
    }

    // Opt-in: replace Items with a NavigationDestination per capability across every
    // module composed on the Application — the shell's root navigation layer.
    // The base stays type-agnostic (it never calls this itself); the opt-in
    // caller is whoever registers the service — a shell (EditorShell registers a
    // base NavigationService and calls this) or a subclass from its ctor — so
    // destinations come from the declared modules instead of hand-seeding.
    //
    // Resolves the ApplicationService (the module source of truth) from the
    // container, then up-casts each ICapability to the concrete Capability to
    // read the view-facing Icon / ServiceKey above the runtime contract's
    // Name-only surface — the documented IShellModule up-cast seam. One-shot:
    // modules are
    // fully populated by the time a shell resolves this service; call again to
    // rebuild. Clears first, so the caller owns Items once it opts in.
    public PopulateFromModules(): void
    {
        const app = this.Provider.getRequired(ApplicationService.Key);
        this.Items.Clear();
        for (const module of app.Modules)
        {
            for (const capability of module.Capabilities)
            {
                this.Items.Add(this.createDestination(capability as Capability));
            }
        }
        // Land on the first destination so the shell opens showing content
        // rather than an empty panel. Apps that want no initial selection
        // override this (subclass) or clear SelectedItem afterwards.
        if (this.SelectedItem === undefined && this.Items.Count > 0)
        {
            const first = this.Items.Get(0);
            this.SelectedItem = first;
            // Seed the click-toggle anchor to the auto-selected destination so
            // the FIRST re-click of the active icon hides the pane (rather than
            // wasting the first click just establishing the anchor).
            if (first instanceof NavigationDestination) this._lastActivated = first;
        }
    }
}
