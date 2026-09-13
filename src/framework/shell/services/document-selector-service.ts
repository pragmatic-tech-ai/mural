import {
    ObservableCollection,
    ServiceBase,
    type IServiceProvider,
} from '../../../runtime/index.js';
import { ContentHostService } from './content-host-service.js';
import type { IActivatable } from './activatable.js';

// A service that presents a selectable list of items — the selector half of a
// document workspace (a list/tree/tab strip a view binds its ItemsSource +
// SelectedItem to). Owns the two bindable properties AND a default selection
// behaviour: on selection it presents the picked item in the content host.
// Usable as-is or subclassed to override OnSelectedItemChanged for richer
// behaviour.
//
// A ServiceBase (bindable, DP-backed, container-owned). No static `Key`: this
// is a base meant to be subclassed — often into MANY distinct per-context
// instances (see DemoGroupService's five group services) — so it uses
// class-as-token (`ServiceProvider.tokenFor` returns the constructor). A shared
// Key here would leak through JS static inheritance and collapse every subclass
// to one token. Register/resolve/bind by the concrete constructor:
// `$service(DocumentSelectorService)` or `$service(MySelector)`.
export class DocumentSelectorService extends ServiceBase implements IActivatable
{
    // The selectable items. A stable per-instance collection a list binds
    // (`ItemsSource = $Items`); the reference never changes, so this getter only
    // hands it back — mirrors NavigationService.Items.
    private readonly _items = new ObservableCollection<object>();

    // The current selection (`SelectedItem = $SelectedItem`, usually TwoWay
    // from the list). Every change — programmatic, binding-driven, or a list
    // click — routes onSelectedItemChanged below.
    private _selectedItem: object | undefined = undefined;

    constructor(provider: IServiceProvider)
    {
        super(provider);
    }

    public get Items(): ObservableCollection<object> { return this._items; }

    public get SelectedItem(): object | undefined { return this._selectedItem; }
    public set SelectedItem(v: object | undefined)
    {
        const old = this._selectedItem;
        if (old === v) return;
        this._selectedItem = v;
        this.RaisePropertyChanged('SelectedItem', old, v);
        this.OnSelectedItemChanged(v);
    }

    // Selection callback — invoked on every SelectedItem change with the new
    // value (undefined when the selection is cleared). The default presents
    // the selected item in the content host: resolves ContentHostService from
    // the container (a shell registers one) and calls View(item), so picking a
    // list item swaps what the shell's content region shows — `View(undefined)`
    // clears it. Optional resolution, so a selector used without a content host
    // simply no-ops. Override to add app behaviour (open into a
    // DocumentsContentHostService, history, unsaved-changes guards, …).
    protected OnSelectedItemChanged(item: object | undefined): void
    {
        this.Provider.get(ContentHostService.Key)?.View(item);
    }

    // Re-present the current selection when this selector becomes the shell's
    // active content (a rail switch — see IActivatable). The content host holds
    // the LAST presented item; on activation this selector's own selection
    // hasn't changed, so it must push its selection again or the host keeps the
    // previously-active selector's content. Idempotent: re-presenting the same
    // selection is a no-op swap. `View(undefined)` when nothing is selected,
    // which clears the host to this selector's empty state.
    public OnActivated(): void
    {
        this.OnSelectedItemChanged(this.SelectedItem);
    }
}
