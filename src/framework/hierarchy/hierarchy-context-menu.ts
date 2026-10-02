import { ContextMenu, ContextMenuService } from '../menu/context-menu.js';
import {
    Behavior,
    CompositeDisposable,
    Disposable,
    Key,
    MetaData,
    MuralBase,
    Visual,
    type KeyEventArgs,
    type PropertyDescriptor,
} from '../../runtime/index.js';
import type { DataTemplate } from '../../basic/index.js';
import type { PresentationTarget } from '../../visual-engine/index.js';
import { CommandViewModel } from '../shell/commands/command-view-model.js';
import { Hierarchy } from './hierarchy.js';
import { HierarchyActionContext } from './hierarchy-action-context.js';

// HierarchyContextMenu — a ContextMenu whose content is the right-clicked (or
// keyboard-anchored) HierarchyItem's action menu, built FRESH on every open
// and disposed on every close. Mirrors CommandContextMenu's lifecycle
// (command-context-menu.ts) exactly — same OnPropertyChanged(IsOpen) hook,
// same build-on-true/tear-down-on-false shape — but sources its
// CommandViewModel tree from HierarchyItem.BuildActions (which delegates to
// Hierarchy.BuildActions) instead of a fixed list of CommandDefinition roots
// run through a locally-constructed CommandMenuBuilder.
//
// Why source from BuildActions rather than build our own CommandMenuBuilder
// here (the one real difference from CommandContextMenu): a hierarchy node's
// actions are selection-SENSITIVE (DR1/DR7 — Hierarchy.BuildActions unions the
// Context tokens of the live Selection, falling back to the Anchor alone when
// nothing is selected) and are dispatched through a PER-OPEN
// HierarchyRoutingDispatcher that Hierarchy.BuildActions itself constructs
// from whichever contributors matched. Reusing that single code path (rather
// than re-deriving contexts/routing here) is what guarantees the right-click
// and keyboard paths — both of which just flip IsOpen=true after pointing
// this instance at the live Hierarchy — render identical content for
// identical selection.
//
// Why fresh-per-open / dispose-on-close: identical rationale to
// CommandContextMenu — a ChildrenContributor-backed (or declared-Children)
// submenu must re-evaluate on every open against whatever is live NOW, and
// the rendered rows' `$IsChecked` / `$Command` bindings subscribe to each
// VM's INPC channel for as long as they're attached, so the built tree must
// be torn down (CommandViewModel.dispose recurses into Children) on every
// close to avoid accumulating subscriptions across repeated opens.
export class HierarchyContextMenu extends ContextMenu
{
    // The SAME keyed HierarchicalDataTemplate CommandContextMenu renders
    // through (shipped in shell.template.mu) — HierarchyItem.BuildActions
    // already returns plain CommandViewModels built via CommandMenuBuilder,
    // so these rows render through the exact same template, just sourced
    // from a different builder call.
    private static readonly CommandMenuItemTemplateKey = 'CommandMenuItemTemplate';

    private readonly hierarchy: Hierarchy;

    // The VM tree built by the most recent open — recursion roots only
    // (CommandViewModel.dispose recurses into Children, so disposing these
    // tears down the whole realized tree, expanded or not). Empty while
    // closed.
    private built: CommandViewModel[] = [];

    constructor(hierarchy: Hierarchy)
    {
        super();
        this.hierarchy = hierarchy;
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

    // Reads the Hierarchy's CURRENT Anchor + Selection — live state, not a
    // snapshot taken at attach time — builds the HierarchyActionContext
    // BuildActions dispatches against, and assigns the returned collection as
    // ItemsSource against the real keyed template. No anchor (nothing
    // right-clicked / focused) ⇒ an empty menu rather than a stale one.
    private BuildTree(): void
    {
        const anchor = this.hierarchy.Anchor;
        if (anchor === undefined)
        {
            this.built = [];
            this.ItemsSource = undefined;
            return;
        }
        const selection = this.hierarchy.Selection.ToArray();
        const items = anchor.BuildActions(new HierarchyActionContext(anchor, selection));
        this.built = items.ToArray();
        this.ItemTemplate = this.FindResource(HierarchyContextMenu.CommandMenuItemTemplateKey) as DataTemplate;
        this.ItemsSource = items;
    }

    // Dispose every built VM (recursing into any realized submenu children)
    // and clear ItemsSource — releases the rendered rows' bindings and drops
    // the VM references so nothing from this open survives into the next.
    private TearDown(): void
    {
        for (const vm of this.built) vm.dispose();
        this.built = [];
        this.ItemsSource = undefined;
    }
}

// HierarchyContextMenuBehavior — attaches one HierarchyContextMenu to a tree
// Visual (ContextMenuService.SetContextMenu) and wires the KEYBOARD
// context-menu key. Right-click → open is already handled by the shipped
// pointer-only ContextMenu patch (context-menu.ts's OnPreviewPointerDown
// patch, secondary-button only) the moment a ContextMenu is attached — this
// behavior does not touch pointer gestures at all. What it adds is the one
// gap that patch leaves: there is no keyboard equivalent anywhere in the
// framework today, so a tree with a HierarchyContextMenu attached but no
// keyboard wiring would only ever open via the mouse.
//
// Key choice: Key.Apps — the dedicated OS "context menu" key (WPF/Windows
// calls its virtual key `VK_APPS`; the DOM reports it as
// KeyboardEvent.key === 'ContextMenu', which key.ts's DOM_KEY_TO_KEY maps
// to Key.Apps — see key.ts's `ContextMenu: Key.Apps` entries). Using the
// dedicated key rather than Shift+F10 matches WPF's own primary binding for
// ContextMenu-open gestures and needs no modifier-chord handling.
//
// The attached menu reads live Anchor/Selection off THIS Hierarchy on every
// open (HierarchyContextMenu.BuildTree) — not a snapshot taken here — so
// both the pointer and the keyboard path route through the IDENTICAL
// HierarchyItem.BuildActions call with whatever is selected at open time.
export class HierarchyContextMenuBehavior extends Behavior
{
    private static readonly KeyDownEvent = 'KeyDown';

    public static readonly HierarchyKey = MuralBase.RegisterProperty<Hierarchy | undefined>(
        HierarchyContextMenuBehavior, 'Hierarchy', undefined, MetaData.None);

    public get Hierarchy(): Hierarchy | undefined { return this.get_property_value(HierarchyContextMenuBehavior.HierarchyKey); }
    public set Hierarchy(v: Hierarchy | undefined) { this.set_property_value(HierarchyContextMenuBehavior.HierarchyKey, v); }

    // Lives for the whole attach — released in OnDetached.
    private readonly _subscriptions = new CompositeDisposable();
    private _menu: HierarchyContextMenu | undefined;

    public override OnAttached(visual: Visual): void
    {
        const hierarchy = this.Hierarchy;
        if (hierarchy === undefined)
        {
            throw new Error('HierarchyContextMenuBehavior requires Hierarchy to be set before attaching');
        }

        const menu = new HierarchyContextMenu(hierarchy);
        this._menu = menu;
        ContextMenuService.SetContextMenu(visual, menu);

        const onKeyDown = (args: unknown): void => this.HandleKeyDown(args as KeyEventArgs, visual);
        visual.AddRoutedEventListener(HierarchyContextMenuBehavior.KeyDownEvent, onKeyDown);
        this._subscriptions.add(new Disposable(() => visual.RemoveRoutedEventListener(HierarchyContextMenuBehavior.KeyDownEvent, onKeyDown)));
    }

    public override OnDetached(visual: Visual): void
    {
        this._subscriptions.dispose();
        ContextMenuService.SetContextMenu(visual, undefined);
        this._menu = undefined;
    }

    // Thin dispatcher the KeyDown listener calls — kept as its own method so
    // it stays directly callable/testable without round-tripping a real
    // keyboard gesture. Opens through the SAME ContextMenu.OpenAt → IsOpen=
    // true → HierarchyContextMenu.BuildTree → HierarchyItem.BuildActions path
    // the pointer patch uses, so the two entry points can never diverge.
    public HandleKeyDown(args: KeyEventArgs, visual: Visual): void
    {
        if (args.Handled || args.Key !== Key.Apps) return;
        const menu = this._menu;
        if (menu === undefined) return;
        // Resolve the PresentationTarget the same duck-typed way the pointer
        // patch does (context-menu.ts) — Visual's `target` getter is
        // protected, so callers outside the Visual hierarchy read the
        // underlying field through a cast.
        const target = (visual as unknown as { _target: PresentationTarget | undefined })._target;
        if (target === undefined) return;
        // Row-anchored placement (Task 12, now that the real tree is wired):
        // open flush against the bottom-left of the currently-anchored row,
        // same coordinate space (host-root-relative) the pointer path's
        // `args.HostX`/`args.HostY` already use — see rowOrigin's own
        // comment. No realized anchor row (nothing focused, or a Visual
        // that isn't an ItemsControl) falls back to the host's own origin.
        const anchor = this.Hierarchy?.Anchor;
        const origin = anchor !== undefined
            ? HierarchyContextMenuBehavior.rowOrigin(visual, anchor)
            : undefined;
        const { x, y } = origin ?? { x: 0, y: 0 };
        menu.OpenAt(target, visual, x, y);
        args.Handled = true;
    }

    // Host-root-relative (x, y) of the anchor row's bottom-left corner —
    // the SAME coordinate space OpenAt's pointer-driven callers already
    // pass (context-menu.ts's OnPreviewPointerDown patch forwards
    // `args.HostX`/`args.HostY` as-is), built the same way
    // HierarchyDropBehavior.topOffsetOf walks a realized row's offset: sum
    // each ancestor's ArrangedRect as we climb GetVisualParent() to the
    // root. Undefined when `visual` isn't an ItemsControl (no Generator) or
    // the anchor item has no realized container (collapsed/off-screen).
    private static rowOrigin(visual: Visual, item: unknown): { x: number; y: number } | undefined
    {
        const generator = (visual as unknown as { Generator?: { ContainerFromItem(i: unknown): Visual | undefined } }).Generator;
        const container = generator?.ContainerFromItem(item);
        if (container === undefined) return undefined;
        let x = 0;
        let y = 0;
        let cur: Visual | undefined = container;
        while (cur !== undefined)
        {
            x += cur.ArrangedRect.X;
            y += cur.ArrangedRect.Y;
            cur = cur.GetVisualParent();
        }
        return { x, y: y + container.ArrangedRect.Height };
    }
}
