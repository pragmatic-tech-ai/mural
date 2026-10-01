import {
    MetaData,
    MuralBase,
    Element, Visual,
    type PointerEventArgs,
    type PropertyDescriptor,
} from '../../runtime/index.js';
import { PresentationTarget } from '../../visual-engine/index.js';
import { ItemsControl } from '../base/items-control.js';
import { Border } from '../../basic/border.js';
import { MenuItem, MenuPopupHost } from './menu-strip.js';
import { MenuContainerFactory } from './menu-container-factory.js';
import { ClickAwayScrim } from '../tool-bar/tool-bar.js';

// ContextMenu — pops up at a host-coordinate point in response to a
// secondary-button click on the Visual it's attached to.
//
// ContextMenu IS an ItemsControl. Its DefaultStyle (registered in
// framework.resources.mu) wires:
//   * Template   = DefaultContextMenuPopup — the popup chrome
//                  (MenuPopupHost > [Scrim, Border > ItemsPresenter])
//   * ItemsPanel = DefaultMenuItemsPanel    — vertical StackPanel
//                  that slots into the template's ItemsPresenter
//
// Item materialisation rides ItemsControl's normal pipeline: data
// items go into Items, become Visual containers in the popup's
// StackPanel via IsItemItsOwnContainerOverride + the default
// ContentPresenter wrap.
//
// Usage shape:
//
//   const cm = new ContextMenu();
//   cm.Items = [
//       MenuItem.create(...),
//       new MenuSeparator(),
//       MenuItem.create(...),
//   ];
//   ContextMenuService.SetContextMenu(someVisual, cm);
//
// On secondary-button PointerDown the framework walks up from the hit
// visual looking for the first ancestor with a ContextMenu attached
// (WPF's ContextMenuService.ContextMenu behaviour). That ancestor's
// ContextMenu opens at the cursor position.
//
// The ContextMenu instance is never in any in-tree visual hierarchy —
// it's attached via the ContextMenuService.ContextMenu attached
// property (or the ergonomic Visual.ContextMenu accessor). When OpenAt
// runs we mount the ContextMenu instance directly onto the
// PresentationTarget's OverlayLayer; its template subtree renders
// there. On close, DetachOverlay unmounts.
export class ContextMenu extends ItemsControl
{
    public static readonly IsOpenKey = MuralBase.RegisterProperty<boolean>(
        ContextMenu, 'IsOpen', false, MetaData.None,
    );

    public get IsOpen():  boolean { return this.get_property_value(ContextMenu.IsOpenKey); }
    public set IsOpen(v: boolean) { this.set_property_value(ContextMenu.IsOpenKey, v); }

    private _popupHost:      MenuPopupHost  | undefined;
    private _scrim:          ClickAwayScrim | undefined;
    private _popupContainer: Border         | undefined;

    private _popupMounted   = false;
    // The Visual that requested this open — becomes the logical owner of
    // the menu so resource cascades flow through the right-clicked host
    // (not the OverlayLayer). Cleared on close.
    private _mountedHost:   Visual             | undefined;
    private _partsBound     = false;

    static
    {
        // Theme-style lookup key for the default Style — pulled in by
        // applyDefaultStyle() in the ctor.
        MuralBase.OverrideMetadata(ContextMenu, Element.DefaultStyleKeyKey, { default_value: ContextMenu });
    }

    constructor()
    {
        super();
        // Eager Style resolution applies Template (popup chrome) +
        // ItemsPanel. After this call the template subtree is attached
        // as our visualChildren[0] and PART_* parts are reachable via
        // FindName on that root.
        this.applyDefaultStyle();
        this.bindTemplateParts();
    }

    // Resolve template parts and wire scrim onClick / popupHost popup
    // reference once the popup template has materialised. Idempotent.
    private bindTemplateParts(): void
    {
        if (this._partsBound) return;
        const root = this.visualChildren[0];
        if (root === undefined) return;
        const host = root instanceof MenuPopupHost ? root : root.FindName('PART_PopupHost');
        if (!(host instanceof MenuPopupHost)) return;
        this._popupHost      = host;
        this._scrim          = host.FindName('PART_Scrim')          as ClickAwayScrim;
        this._popupContainer = host.FindName('PART_PopupContainer') as Border;
        this._popupHost.popup = this._popupContainer;
        this._popupHost.owner = this;
        this._scrim.onClick   = (): void => { this.IsOpen = false; };
        this._partsBound = true;
    }

    // Close hook invoked (duck-typed) by MenuItem.activate() when an activated leaf
    // couldn't close through its own `_onActivated` chain — e.g. a templated
    // (ItemsSource) menu item wrapped in a ContentPresenter container.
    public closeFromMenuActivation(): void { this.IsOpen = false; }

    /** Body items declared in `.mu` (`ContextMenu { MenuItem; … }`) come
     *  in as MenuItem / MenuSeparator Visuals. The base ItemsControl
     *  guard throws unless we accept them here — sibling controls
     *  (MenuStrip, MenuButton) follow the same accept-anything shape
     *  since their markup body is meant to be heterogeneous. */
    protected override validateDeclarativeChild(_child: Visual): void { }

    /** Items declared as a Visual in `.mu` (`ContextMenu { MenuItem; … }`)
     *  ARE their own container — slot the Visual directly without a
     *  ContentPresenter wrap. */
    public override IsItemItsOwnContainerOverride(item: unknown): boolean
    {
        return item instanceof Visual;
    }

    /** Wire onActivated on each materialised MenuItem so an activation
     *  closes the popup chain. Inlined here (replaces the standalone
     *  wireMenuActivationClose helper from the old _menu shape). */
    public override PrepareContainerForItemOverride(container: Visual, item: unknown, index: number): void
    {
        super.PrepareContainerForItemOverride(container, item, index);
        if (container instanceof MenuItem)
        {
            container._onActivated = (): void => { this.IsOpen = false; };
        }
    }

    // A CommandViewModel (or any non-Visual data item) resolved through a
    // HierarchicalDataTemplate becomes a MenuItem container so the menu recurses;
    // everything else falls to the base ContentPresenter path (unchanged).
    public override GetContainerForItemOverride(item: unknown): Visual
    {
        return MenuContainerFactory.GetContainer(this, item) ?? super.GetContainerForItemOverride(item);
    }

    public override RebindContainerForItemOverride(container: Visual, item: unknown): void
    {
        if (!MenuContainerFactory.RebindContainer(this, container, item))
        {
            super.RebindContainerForItemOverride(container, item);
        }
    }

    // Undo the generated-container state the factory set before the base nulls
    // `_itemsControlData` (the stamp the clear guard reads).
    public override ClearContainerForItemOverride(container: Visual, item: unknown): void
    {
        MenuContainerFactory.ClearContainer(this, container);
        super.ClearContainerForItemOverride(container, item);
    }

    /** Open the context menu on the given PresentationTarget at the
     *  supplied (host-coordinate) point. Mounts ContextMenu (and via
     *  its template subtree, the popup chrome) on the target's
     *  OverlayLayer; closing unmounts.
     *
     *  `host` is the Visual that requested the menu (the one whose
     *  ContextMenu attached DP resolved to this instance). It becomes
     *  the logical owner of the menu so resource cascades / DataContext
     *  inheritance flow from where the user right-clicked, not from
     *  the OverlayLayer — closes the § 18.10 gap for ContextMenu. */
    public OpenAt(target: PresentationTarget, host: Visual, x: number, y: number): void
    {
        this.bindTemplateParts();
        if (this._popupHost === undefined) return;
        this._popupHost.fixedPoint = { x, y };
        this._popupHost.anchor     = undefined;
        void target;  // PresentationTarget is resolved through `host._target` by AttachOverlayChild;
                      // kept in the signature for callers that already have it in hand.
        this._mountedHost   = host;
        if (!this._popupMounted)
        {
            host.AttachOverlayChild(this);
            this._popupMounted = true;
        }
        // The popup's position is computed in MenuPopupHost.ArrangeOverride from
        // `fixedPoint` — a plain field whose write doesn't invalidate layout. Its
        // arrange stays cached-valid from a previous open (the overlay root is
        // always arranged at the same surface rect, so the re-mount alone won't
        // re-run ArrangeOverride), which would leave the menu pinned to wherever
        // it first appeared. Invalidate here — after the re-mount wires the
        // target — so it re-arranges at the new cursor point on every open.
        this._popupHost.InvalidateArrange();
        this.IsOpen = true;
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue: unknown,
        newValue: unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (descriptor.Name === 'IsOpen' && newValue === false)
        {
            // Cascade the close down — a nested submenu opened from one of our
            // items mounts as its OWN overlay child, so unmounting the popup
            // below won't reach it. Collapse open child submenus first (each
            // recurses to its own children) so nothing is orphaned on the
            // overlay after the outer click-away scrim dismisses us.
            MenuItem.closeOpenSubmenusIn(this.Items);
            this.unmountPopup();
        }
    }

    private unmountPopup(): void
    {
        if (!this._popupMounted) return;
        const host = this._mountedHost;
        if (host !== undefined) host.DetachOverlayChild(this);
        this._popupMounted = false;
        this._mountedHost  = undefined;
    }
}

// ─────────────────────────────────────────────────────────────────────
// Attached ContextMenu DP. Authors call ContextMenuService.SetContextMenu
// (or write Visual.ContextMenu via the ergonomic getter/setter installed
// on Visual.prototype below). The DP lives on a marker class so it's a
// proper cross-class attached property.
//
// The runtime side: installation of SetContextMenu wires a static
// PointerDown listener on Visual.prototype that intercepts Secondary-
// button presses, walks the hit-test route bottom-up looking for the
// first ancestor with a ContextMenu attached, and opens that menu at
// the host-coords cursor position.
export class ContextMenuService
{
    public static readonly ContextMenuKey = MuralBase.RegisterAttachedProperty<ContextMenu | undefined>(
        ContextMenuService, 'ContextMenu', undefined, MetaData.None,
    );

    public static GetContextMenu(v: Visual): ContextMenu | undefined
    {
        return v.get_property_value(ContextMenuService.ContextMenuKey);
    }

    public static SetContextMenu(v: Visual, cm: ContextMenu | undefined): void
    {
        v.set_property_value(ContextMenuService.ContextMenuKey, cm);
    }
}

// Ergonomic per-instance getter/setter for Visual.ContextMenu. Stamped
// onto Visual.prototype below; the type-system view of Visual exposes
// the same shape via the declare-module augmentation.
declare module '../../visual-engine/visual.js'
{
    interface Visual
    {
        get ContextMenu(): ContextMenu | undefined;
        set ContextMenu(v: ContextMenu | undefined);
    }
}

Object.defineProperty(Visual.prototype, 'ContextMenu', {
    get(this: Visual): ContextMenu | undefined { return ContextMenuService.GetContextMenu(this); },
    set(this: Visual, v: ContextMenu | undefined): void { ContextMenuService.SetContextMenu(this, v); },
    configurable: true,
});

// ─────────────────────────────────────────────────────────────────────
// Right-click → open ContextMenu hook. Patches Visual.prototype's
// OnPreviewPointerDown ONCE at module init. The patch is a thin layer
// over the original: it runs the original first (so existing
// per-Visual virtuals still fire), then on Secondary-button presses
// walks up from args.Source looking for an attached ContextMenu.
//
// This is the minimum-footprint way to add an attached-property-driven
// gesture without changing Visual itself. The patch is idempotent
// (we check a sentinel field before installing).

interface PatchedProto
{
    _ContextMenuPatchInstalled?: boolean;
    OnPreviewPointerDown(args: PointerEventArgs): void;
}

// Patch Element.prototype, NOT Visual.prototype: the routed-event virtuals
// (OnPreviewPointerDown et al.) are defined on Element, and the dispatcher
// invokes them on the route's Element nodes. A patch on Visual.prototype is
// shadowed by Element's own no-op override and never runs — which silently
// broke right-click → ContextMenu for every control.
const proto = Element.prototype as unknown as PatchedProto;
if (proto._ContextMenuPatchInstalled !== true)
{
    proto._ContextMenuPatchInstalled = true;
    const original = proto.OnPreviewPointerDown;
    proto.OnPreviewPointerDown = function (args: PointerEventArgs): void
    {
        original.call(this, args);
        if (args.Handled) return;
        // Secondary button only. PointerButton.Secondary === 2 per
        // routed-event.ts. No need to import the enum just for the
        // numeric comparison.
        if (args.Button !== 2) return;
        // Walk source → root.
        let cur: Visual | undefined = args.Source;
        while (cur !== undefined)
        {
            const cm = ContextMenuService.GetContextMenu(cur);
            if (cm !== undefined)
            {
                // Resolve the PresentationTarget for the host. Visual's
                // `target` getter is protected; we read the underlying
                // field through a duck-typed cast — same shape used by
                // ComboBox / ToolBar.
                const t = (cur as unknown as { _target: PresentationTarget | undefined })._target;
                if (t !== undefined)
                {
                    cm.OpenAt(t, cur, args.HostX, args.HostY);
                    args.Handled = true;
                    suppressNextBrowserContextMenu();
                }
                return;
            }
            cur = cur.GetVisualParent();
        }
    };
}

// Browser fires a native `contextmenu` event around a secondary-button
// click — timing depends on the OS:
//   * macOS / many Linux WMs: fires on pointerdown (same task as the
//     press).
//   * Windows: fires on pointerup (a LATER task than the press).
//
// To cover both, we install a single capture-phase listener at module
// init and arm a "next contextmenu should be suppressed" flag whenever
// we open a µ-mural ContextMenu. The listener consumes the flag on the
// next contextmenu event — works whether that's the same task or a
// later one. A microtask-based cleanup would prematurely disarm the
// flag on Windows; this approach doesn't have that hazard.
//
// `_armed` survives only until the very next contextmenu fires, so it
// can't leak into unrelated future right-clicks on Visuals without an
// attached menu.

let _armed = false;

function suppressNextBrowserContextMenu(): void
{
    if (typeof document === 'undefined') return;
    if (!_contextMenuSwallowInstalled)
    {
        _contextMenuSwallowInstalled = true;
        document.addEventListener('contextmenu', (e: Event): void =>
        {
            if (!_armed) return;
            _armed = false;
            e.preventDefault();
        }, true);
    }
    _armed = true;
}

let _contextMenuSwallowInstalled = false;
