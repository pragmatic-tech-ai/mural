import {
    Element,
    MetaData,
    MuralBase,
    Panel,
    Rect,
    Size,
    Visual,
    type DrawingContext,
    type KeyEventArgs,
    Key,
    type PointerEventArgs,
    type PropertyDescriptor,
    hasModifier,
    ModifierKeys,
} from '../../runtime/index.js';
import { PresentationTarget } from '../../visual-engine/index.js';
import { Border } from '../../basic/border.js';
import { ContentPresenter } from '../../basic/templates/content-presenter.js';
import { ControlTemplate } from '../../basic/templates/control-template.js';
import { HeaderedItemsControl } from '../base/headered-items-control.js';
import { ItemsControl } from '../base/items-control.js';
import { StackPanel } from '../../basic/panels/stack-panel.js';
import { Orientation } from '../../basic/panels/orientation.js';
import { TextBlock } from '../../basic/text-block.js';
import { Shape } from '../../basic/shapes/shape.js';
import { Brush, Visibility } from '../../visual-engine/index.js';
import { ClickAwayScrim } from '../tool-bar/tool-bar.js';
import { Button } from '../buttons/button.js';
import type { ICommand } from '../../runtime/command.js';
import { MenuContainerFactory } from './menu-container-factory.js';
import type { ExpandableMenuData } from './expandable-menu-data.js';

// ─────────────────────────────────────────────────────────────────────
// MenuStrip — horizontal main-menu bar. Holds top-level MenuItems whose
// click opens a submenu popup below the row.
//
// Authoring shape:
//
//   MenuStrip {
//       MenuItem [Header="File"] {
//           MenuItem [Header="New",  InputGestureText="Ctrl+N"]
//           MenuItem [Header="Open", InputGestureText="Ctrl+O"]
//           MenuSeparator
//           MenuItem [Header="Save", InputGestureText="Ctrl+S"]
//       }
//       MenuItem [Header="Edit"] { … }
//   }
//
// MenuStrip is just an ItemsControl whose default Style supplies:
//   * Fill      — surface-container token
//   * ItemsPanel      — horizontal StackPanel (Orientation DP drives it
//                       on swap; default Horizontal)
//   * ItemContainerStyle — MenuStripItemStyle, which sets each
//                          container MenuItem's RowTemplate to the
//                          stripped chrome (no icon/gesture/chevron
//                          columns).
//
// The submenu mechanic comes for free from MenuItem — clicking a
// top-level MenuItem flips IsSubmenuOpen which mounts its submenu
// popup on the OverlayLayer below the row.
export class MenuStrip extends ItemsControl
{
    public static readonly OrientationKey = MuralBase.RegisterProperty<Orientation>(
        MenuStrip, 'Orientation', Orientation.Horizontal, MetaData.Measure,
    );

    public get Orientation():  Orientation { return this.get_property_value(MenuStrip.OrientationKey); }
    public set Orientation(v: Orientation) { this.set_property_value(MenuStrip.OrientationKey, v); }

    static
    {
        MuralBase.OverrideMetadata(MenuStrip, Element.DefaultStyleKeyKey, { default_value: MenuStrip });
    }

    constructor()
    {
        super();
        this.applyDefaultStyle();
    }

    protected override validateDeclarativeChild(_child: Visual): void { }

    public override IsItemItsOwnContainerOverride(item: unknown): boolean
    {
        return item instanceof Visual;
    }

    // Wire onActivated on each materialised top-level MenuItem so a
    // descendant activation collapses the popup chain back to the
    // strip.
    public override PrepareContainerForItemOverride(container: Visual, item: unknown, index: number): void
    {
        super.PrepareContainerForItemOverride(container, item, index);
        if (container instanceof MenuItem)
        {
            container._onActivated = (): void => { container.IsSubmenuOpen = false; };
        }
    }

    // A CommandViewModel (or any non-Visual data item) resolved through a
    // HierarchicalDataTemplate becomes a MenuItem container so top-level strip
    // items recurse into submenus; everything else falls to the base path.
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

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue: unknown,
        newValue: unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (descriptor.Name === 'Orientation')
        {
            // Items panel orientation tracks the DP. The Style hands us
            // a horizontal StackPanel by default; on swap we update the
            // live panel's Orientation so re-measure picks it up.
            const panel = (this as unknown as { _itemsPanel: StackPanel | undefined })._itemsPanel;
            if (panel instanceof StackPanel)
            {
                panel.Orientation = newValue as Orientation;
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────
// MenuItem — single row inside a Menu. Subclasses both ICommandSource
// (Header / Icon / InputGestureText + Command-driven activation) AND
// ItemsControl (nested Items = submenu; opens a Menu popup to the
// right when present).
//
// Visual columns (auto-hidden when their data is absent):
//
//   ┌─icon─┬──header───┬─gesture─┬─chevron─┐
//   │  📄  │  Open     │  Ctrl+O │         │
//   │      │  Save     │         │         │
//   │  ✓   │  Bold     │         │         │  (IsCheckable + IsChecked)
//   │      │  Recent   │         │    ▶    │  (has submenu)
//   └──────┴───────────┴─────────┴─────────┘
//
// Activation:
//   * Item with no Items: click fires Command (and closes the whole
//     popup chain via the parent MenuButton / ContextMenu).
//   * Item with Items: click opens / closes the submenu inline. Command
//     is ignored.
//
// Activation event protocol — a separate `onActivated` callback lets
// the parent popup machinery close the whole chain after click. It's
// fired from PreClick (before Command runs) so the parent has a chance
// to teardown before any Command-launched dialog steals focus.
export class MenuItem extends HeaderedItemsControl
{
    public static readonly IconKey              = MuralBase.RegisterProperty<Visual | undefined>(MenuItem, 'Icon',              undefined, MetaData.Measure);
    public static readonly InputGestureTextKey  = MuralBase.RegisterProperty<string | undefined>(MenuItem, 'InputGestureText',  undefined, MetaData.Measure | MetaData.Render);
    public static readonly IsCheckableKey       = MuralBase.RegisterProperty<boolean>(           MenuItem, 'IsCheckable',       false,     MetaData.Render);
    public static readonly IsCheckedKey         = MuralBase.RegisterProperty<boolean>(           MenuItem, 'IsChecked',         false,     MetaData.Render);
    public static readonly CommandKey           = MuralBase.RegisterProperty<ICommand | undefined>(MenuItem, 'Command',           undefined, MetaData.None);
    public static readonly CommandParameterKey  = MuralBase.RegisterProperty<unknown>(            MenuItem, 'CommandParameter',  undefined, MetaData.None);
    public static readonly IsSubmenuOpenKey     = MuralBase.RegisterProperty<boolean>(           MenuItem, 'IsSubmenuOpen',     false,     MetaData.None);
    // A leading divider rendered ABOVE this row — the intrinsic-to-MenuItem
    // equivalent of a declarative `MenuSeparator` sibling, for surfaces that
    // can only ever render ONE container type per data item (a
    // HierarchicalDataTemplate's root MUST stay a MenuItem — see
    // MenuContainerFactory.GetContainer — so a data-bound submenu row has no
    // way to place a sibling MenuSeparator the way declaratively-nested
    // markup can). Default false so every EXISTING row — declarative or
    // data-bound — is visually unchanged; only a row whose data explicitly
    // sets this shows the divider. Mirrors CommandDefinition.SeparatorBefore
    // / CommandViewModel.SeparatorBefore, which @CommandMenuItemTemplate
    // binds this to.
    public static readonly SeparatorBeforeKey   = MuralBase.RegisterProperty<boolean>(           MenuItem, 'SeparatorBefore',   false,     MetaData.Render);
    // RowTemplate — the ControlTemplate for the inline visible row
    // chrome. MenuItem's primary Template (ItemsControl-inherited) is
    // the SUBMENU popup chrome with an ItemsPresenter; the row
    // ("trigger" in MenuButton parlance) is a separate keyed template
    // applied imperatively. RowTemplate is settable so a parent
    // MenuStrip can swap to a stripped chrome via ItemContainerStyle.
    public static readonly RowTemplateKey       = MuralBase.RegisterProperty<ControlTemplate | undefined>(
        MenuItem, 'RowTemplate', undefined, MetaData.Measure,
    );

    public get Icon():             Visual | undefined { return this.get_property_value(MenuItem.IconKey); }
    public set Icon(v:             Visual | undefined) { this.set_property_value(MenuItem.IconKey, v); }

    public get InputGestureText(): string | undefined { return this.get_property_value(MenuItem.InputGestureTextKey); }
    public set InputGestureText(v: string | undefined) { this.set_property_value(MenuItem.InputGestureTextKey, v); }

    public get IsCheckable():      boolean { return this.get_property_value(MenuItem.IsCheckableKey); }
    public set IsCheckable(v:      boolean) { this.set_property_value(MenuItem.IsCheckableKey, v); }

    public get IsChecked():        boolean { return this.get_property_value(MenuItem.IsCheckedKey); }
    public set IsChecked(v:        boolean) { this.set_property_value(MenuItem.IsCheckedKey, v); }

    public get Command():          ICommand | undefined { return this.get_property_value(MenuItem.CommandKey); }
    public set Command(v:          ICommand | undefined) { this.set_property_value(MenuItem.CommandKey, v); }

    public get CommandParameter(): unknown { return this.get_property_value(MenuItem.CommandParameterKey); }
    public set CommandParameter(v: unknown) { this.set_property_value(MenuItem.CommandParameterKey, v); }

    public get IsSubmenuOpen():    boolean { return this.get_property_value(MenuItem.IsSubmenuOpenKey); }
    public set IsSubmenuOpen(v:    boolean) { this.set_property_value(MenuItem.IsSubmenuOpenKey, v); }

    public get SeparatorBefore():  boolean { return this.get_property_value(MenuItem.SeparatorBeforeKey); }
    public set SeparatorBefore(v:  boolean) { this.set_property_value(MenuItem.SeparatorBeforeKey, v); }

    public get RowTemplate():      ControlTemplate | undefined { return this.get_property_value(MenuItem.RowTemplateKey); }
    public set RowTemplate(v:      ControlTemplate | undefined) { this.set_property_value(MenuItem.RowTemplateKey, v); }

    /** Set by the hosting popup (MenuButton or ContextMenu) so an
     *  activated item can request the popup chain to close. Click
     *  fires this BEFORE Command — gives the popup teardown a chance
     *  to release focus before any dialog the command opens steals it. */
    public _onActivated: (() => void) | undefined;

    // Row template parts — cached after the row template Apply.
    private _rowRoot:          Visual         | undefined;
    private _iconHost:         Border         | undefined;
    private _rowLabel:         TextBlock      | undefined;
    private _gestureLabel:     TextBlock      | undefined;
    private _chevron:          Shape          | undefined;
    private _separatorBefore:  MenuSeparator  | undefined;

    // Submenu popup parts — cached after applyDefaultStyle materialises
    // the primary Template. The popup root is DETACHED from MenuItem so
    // the OverlayLayer can adopt it without dual-parent errors.
    private _popupHost:      MenuPopupHost  | undefined;
    private _scrim:          ClickAwayScrim | undefined;
    private _popupContainer: Border         | undefined;

    private _popupMounted = false;
    private _lastKnownTarget: PresentationTarget | undefined;

    private _pressOriginatedHere = false;

    // Hover-to-open: a parent item opens its submenu after the pointer dwells
    // over it for this long (click opens it immediately). Cancelled if the
    // pointer leaves first.
    private static readonly HoverOpenDelayMs = 500;
    private _hoverOpenTimer: ReturnType<typeof setTimeout> | undefined;

    static
    {
        // Type-keyed lookup for the default Style — registered as
        // `Style [TargetType=MenuItem]` in framework.resources.mu. The
        // Style supplies:
        //   * Template     = DefaultMenuItemSubmenu  (popup chrome with
        //                    ItemsPresenter for submenu rows)
        //   * ItemsPanel   = DefaultMenuItemsPanel   (vertical stack
        //                    materialised into the ItemsPresenter)
        //   * RowTemplate  = DefaultMenuItemRow      (inline row chrome
        //                    with state triggers; applied imperatively)
        MuralBase.OverrideMetadata(MenuItem, Element.DefaultStyleKeyKey, { default_value: MenuItem });
    }

    constructor()
    {
        super();
        // Focusable so OnKeyDown receives arrow / Enter / Escape /
        // letter-accelerator events. Set BEFORE applyDefaultStyle in
        // case the Style ever wants to read Focusable.
        this.Focusable = true;
        // applyDefaultStyle resolves Style[TargetType=MenuItem] which
        // sets Template (popup chrome), ItemsPanel (vertical stack),
        // and RowTemplate. ItemsControl.rebuildTemplate Apply()s the
        // popup chrome and slots in the ItemsPanel — both end up in the
        // detached popup subtree we adopt below.
        this.applyDefaultStyle();
        this.adoptPopupTemplate();
        this.rebuildRow();
        // Initial content sync — empty Header / Icon / no submenu so
        // the columns auto-hide.
        this.refreshRow();
    }

    // Find the popup template parts (PART_PopupHost, PART_Scrim,
    // PART_PopupContainer), wire scrim onClick + host.popup, then
    // detach the templateRoot so the OverlayLayer can adopt it later.
    private adoptPopupTemplate(): void
    {
        const root = super.visualChildren[0];
        if (!(root instanceof MenuPopupHost)) return;
        this._popupHost      = root;
        this._scrim          = root.FindName('PART_Scrim')          as ClickAwayScrim;
        this._popupContainer = root.FindName('PART_PopupContainer') as Border;
        this._popupHost.popup = this._popupContainer;
        this._popupHost.owner = this;
        // Click-away closes the ENTIRE menu, not just this submenu level — a
        // stray click anywhere outside dismisses the whole popup chain.
        this._scrim.onClick   = (): void => { this.closeEntireMenu(); };
        this.DetachVisual(this._popupHost);
    }

    // Materialise (or re-materialise) the row chrome from RowTemplate.
    // Called from the ctor and from OnPropertyChanged('RowTemplate')
    // when a parent MenuStrip swaps in a stripped chrome via
    // ItemContainerStyle.
    private rebuildRow(): void
    {
        if (this._rowRoot !== undefined)
        {
            this.DetachVisual(this._rowRoot);
            this._rowRoot         = undefined;
            this._iconHost        = undefined;
            this._rowLabel        = undefined;
            this._gestureLabel    = undefined;
            this._chevron         = undefined;
            this._separatorBefore = undefined;
        }
        const tpl = this.RowTemplate;
        if (tpl === undefined)
        {
            // Transient: a Style swap (e.g. when MenuStrip's
            // ItemContainerStyle takes effect on container attach) can
            // briefly clear RowTemplate between unapplying the old
            // Style's setter and applying the new one. The follow-up
            // setter re-fires OnPropertyChanged with the new template
            // and rebuildRow runs again. Leave _rowRoot empty for now;
            // it'll be re-populated on the next pass.
            return;
        }
        const inst = tpl.Apply(this);
        this._rowRoot = inst.root;
        this.AttachVisual(this._rowRoot);
        const icon      = this._rowRoot.FindName('PART_Icon');
        const label     = this._rowRoot.FindName('PART_Label');
        const gesture   = this._rowRoot.FindName('PART_Gesture');
        const chevron   = this._rowRoot.FindName('PART_Chevron');
        const separator = this._rowRoot.FindName('PART_SeparatorBefore');
        if (icon instanceof Border)             this._iconHost        = icon;
        if (label instanceof TextBlock)         this._rowLabel        = label;
        if (gesture instanceof TextBlock)       this._gestureLabel    = gesture;
        if (chevron instanceof Shape)           this._chevron         = chevron;
        if (separator instanceof MenuSeparator) this._separatorBefore = separator;
    }

    public override get visualChildren(): readonly Visual[]
    {
        return this._rowRoot !== undefined ? [this._rowRoot] : [];
    }

    // MenuItem's inline footprint is the row chrome — the popup template
    // owned by ItemsControl._templateInstance is the SUBMENU and was
    // detached from us in the ctor so the OverlayLayer can adopt it on
    // open. Inheriting ItemsControl.MeasureOverride would route Measure
    // to that detached popup root, leaving the row never measured and
    // collapsing the item to zero height (the bug that turned the
    // ContextMenu popup into a thin ribbon). Delegate straight to
    // _rowRoot instead.
    protected override MeasureOverride(availableSize: Size): Size
    {
        if (this._rowRoot === undefined) return Size.Zero;
        this._rowRoot.Measure(availableSize);
        return this._rowRoot.DesiredSize;
    }

    protected override ArrangeOverride(finalSize: Size): Size
    {
        this._rowRoot?.Arrange(new Rect(0, 0, finalSize.Width, finalSize.Height));
        return finalSize;
    }

    // Submenu items declared in `.mu` (`MenuItem { MenuItem ▶ … }`)
    // route through ItemsControl.AddChild. Lenient gate — any Visual
    // is accepted; conventional content is MenuItem / MenuSeparator.
    protected override validateDeclarativeChild(_child: Visual): void { }

    // Submenu items declared in markup ARE their own container.
    public override IsItemItsOwnContainerOverride(item: unknown): boolean
    {
        return item instanceof Visual;
    }

    // Wire onActivated on each materialised submenu MenuItem so an
    // activation closes the popup chain. Walks up to the root popup
    // host via _onActivated chaining.
    public override PrepareContainerForItemOverride(container: Visual, item: unknown, index: number): void
    {
        super.PrepareContainerForItemOverride(container, item, index);
        if (container instanceof MenuItem)
        {
            container._onActivated = (): void =>
            {
                this.IsSubmenuOpen = false;
                this._onActivated?.();
            };
        }
    }

    // A non-Visual submenu data item resolved through a HierarchicalDataTemplate
    // becomes a MenuItem container so the submenu recurses; a flat/plain template
    // or an own-container Visual falls to the base ContentPresenter path.
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

    /** Public refresh for tests + DP-change forwarding. */
    public refreshRow(): void
    {
        // Header text — empty string when undefined to keep TextBlock happy.
        // Header lives on HeaderedItemsControl typed `unknown` (WPF
        // parity); the menu row's TextBlock needs a string, so coerce
        // via String() and treat undefined / null as empty.
        if (this._rowLabel !== undefined)
        {
            const h = this.Header;
            this._rowLabel.Text = h === undefined || h === null ? '' : String(h);
        }
        // Gesture column — auto-hide when empty by zeroing Width.
        if (this._gestureLabel !== undefined)
        {
            const g = this.InputGestureText ?? '';
            this._gestureLabel.Text = g;
            this._gestureLabel.Width = g.length === 0 ? 0 : Number.NaN;
        }
        // Chevron column — a @ChevronRight Shape shown only when this item
        // has a submenu. The MenuStrip row template pins the chevron to
        // Width=0, so this toggle is a no-op there (a zero-width shape stays
        // invisible even when Visible) — top-level strip items never show a
        // submenu chevron.
        if (this._chevron !== undefined)
        {
            this._chevron.Visibility = this.hasSubmenu() ? Visibility.Visible : Visibility.Collapsed;
        }
        // Icon column — host the consumer's Icon, OR an inline check
        // glyph when IsCheckable + IsChecked, OR clear it.
        if (this._iconHost !== undefined)
        {
            if (this.Icon !== undefined)
            {
                this._iconHost.SetChild(this.Icon);
            }
            else if (this.IsCheckable && this.IsChecked)
            {
                this._iconHost.SetChild(makeGlyph('✓'));
            }
            else
            {
                this._iconHost.SetChild(undefined);
            }
        }
        // Leading divider — Collapsed unless the data explicitly asks for
        // one (SeparatorBefore=true). Collapsed is the DP default too, so
        // an existing row that never touches this property renders exactly
        // as it did before this property existed.
        if (this._separatorBefore !== undefined)
        {
            this._separatorBefore.Visibility = this.SeparatorBefore ? Visibility.Visible : Visibility.Collapsed;
        }
    }

    private itemCount(): number
    {
        const items = this.Items;
        if (items === undefined) return 0;
        return Array.isArray(items) ? items.length : (items as { Count: number }).Count;
    }

    // Branch-vs-leaf for every real interaction path (click, hover dwell,
    // keyboard). itemCount() alone undercounts a LAZY node: a HierarchicalData-
    // Template-bound CommandViewModel sets ItemsSource = Definition.Children
    // (MenuContainerFactory.GetContainer → HierarchicalItemsBinder.BindChildItems)
    // at container-prepare time, but the VM's OWN Children collection stays
    // empty until EnsureExpanded runs — which activate()/hover/keydown only ever
    // trigger BY flipping IsSubmenuOpen, so gating on itemCount() alone is a
    // chicken-and-egg: a never-yet-opened branch always reads as a leaf. Falling
    // back to the bound data's own HasChildren (stamped as _itemsControlData by
    // ItemsControl.PrepareContainerForItemOverride, read the same way
    // OnPropertyChanged already reads it for the OnSubmenuOpen hook below) lets a
    // still-unrealized CommandViewModel branch report itself correctly — mirrors
    // TreeView's identical hasChildItems() falling back to the bound data where
    // realized containers alone would undercount.
    private hasSubmenu(): boolean
    {
        if (this.itemCount() > 0) return true;
        const data = (this as unknown as { _itemsControlData?: unknown })._itemsControlData;
        return (data as { HasChildren?: boolean } | undefined)?.HasChildren === true;
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue: unknown,
        newValue: unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        const name = descriptor.Name;
        if (name === 'RowTemplate')
        {
            this.rebuildRow();
            this.refreshRow();
            return;
        }
        if (name === 'IsSubmenuOpen')
        {
            // A pending hover-open is now moot either way (opened, or closed).
            this.clearHoverOpenTimer();
            // Opening: collapse any sibling's open flyout (one per group).
            // Closing: collapse any of OUR OWN open child submenus — each is a
            // separate overlay child, so unmounting our popup below won't reach
            // it; without this it would linger on the overlay after we close.
            if (newValue === true) this.closeSiblingSubmenus();
            else                   MenuItem.closeOpenSubmenusIn(this.Items);
        }
        if (name === 'IsSubmenuOpen' && this._popupHost !== undefined)
        {
            if (newValue === true)
            {
                // Lazy submenu population — the bound data (a CommandViewModel)
                // gets a first-open callback so a ChildrenContributor realizes its
                // children BEFORE the popup mounts, mirroring TreeView's dataOf()
                // ExpandableTreeData hook (tree-view.ts:1136). The data is the item
                // stamped on us in PrepareContainerForItemOverride.
                const data = (this as unknown as { _itemsControlData?: unknown })._itemsControlData;
                (data as ExpandableMenuData | undefined)?.OnSubmenuOpen?.();
                this.mountSubmenu();
            }
            else
            {
                this.unmountSubmenu();
            }
        }
        if (
            name === 'Header' || name === 'Icon' || name === 'InputGestureText' ||
            name === 'IsCheckable' || name === 'IsChecked' || name === 'Items' ||
            name === 'SeparatorBefore' ||
            // 'HasItems' flips when declaratively-nested children are added/removed
            // (a collection mutation, which — unlike reassigning Items — never fires
            // OnPropertyChanged('Items')). Refreshing here is what makes the submenu
            // chevron (▶) appear for `MenuItem { MenuItem … }` authoring.
            name === 'HasItems'
        )
        {
            this.refreshRow();
        }
    }

    protected override propagate_target_to_visual_children(): void
    {
        const newTarget = (this as unknown as { target: PresentationTarget | undefined }).target;
        const oldTarget = this._lastKnownTarget;
        // Detaching from the tree — drop any pending hover-open so it can't fire
        // on a torn-down item.
        if (newTarget === undefined) this.clearHoverOpenTimer();
        if (oldTarget !== undefined && oldTarget !== newTarget && this._popupMounted)
        {
            if (this._popupHost !== undefined) oldTarget.DetachOverlay(this._popupHost);
            this._popupMounted = false;
        }
        this._lastKnownTarget = newTarget;
        super.propagate_target_to_visual_children();
        // ItemsControl's cascade only reaches _templateInstance.root (the
        // detached submenu popup). _rowRoot is the inline row chrome and
        // lives outside that chain — without this hop, Fill writes
        // from IsMouseOver / IsPressed triggers can't reach the renderer
        // (InvalidateVisual finds no target and parks the dirty flag).
        (this._rowRoot as unknown as { SetTarget?: (t: PresentationTarget | undefined) => void } | undefined)
            ?.SetTarget?.(newTarget);
        if (newTarget !== undefined && this.IsSubmenuOpen) this.mountSubmenu();
    }

    private mountSubmenu(): void
    {
        if (this._popupMounted) return;
        if (this._popupHost === undefined) return;
        const t = this._lastKnownTarget;
        if (t === undefined) return;
        // Anchor at our own row. Side selection mirrors WPF menu
        // convention:
        //   * Top-level item in a horizontal MenuStrip → submenu below.
        //   * Nested (inside a ContextMenu / MenuButton popup / parent
        //     MenuItem's submenu) → submenu to the right.
        // Detection: the immediate logical parent's class identifies
        // the host. MenuStrip → horizontal context; anything else
        // (ContextMenu, MenuButton, MenuItem, anonymous wrappers) →
        // vertical context.
        const topLevel = this.isTopLevelInMenuStrip();
        if (this._rowRoot !== undefined) this._popupHost.anchor = this._rowRoot;
        this._popupHost.anchorSide = topLevel ? MenuAnchorSide.Below : MenuAnchorSide.Right;
        // A NESTED submenu must not lay a hit-testable scrim over the rest of
        // the menu chain. The scrim fills the whole surface, so if it caught
        // pointer events it would swallow hover on the ancestor row that opened
        // us (and its siblings) — defeating standard hover navigation (moving
        // off a parent onto a sibling can't fire OnPointerEnter through a
        // covering scrim). Only a top-level MenuStrip item's submenu is the
        // OUTERMOST dismissible surface and needs its own click-away scrim;
        // everything nested inside a ContextMenu / MenuButton / parent MenuItem
        // relies on that outer popup's scrim for click-away instead. Closing
        // cascades DOWN (closeDescendantSubmenus) so a nested submenu is torn
        // down when its ancestor closes rather than orphaned on the overlay.
        if (this._scrim !== undefined) this._scrim.IsHitTestVisible = topLevel;
        // AttachOverlayChild: visual hop → target's OverlayLayer; logical
        // hop → THIS MenuItem so the submenu inherits resources /
        // DataContext / inheritable DPs from the row that opened it.
        this.AttachOverlayChild(this._popupHost);
        this._popupMounted = true;
    }

    private isTopLevelInMenuStrip(): boolean
    {
        const parent = this.GetLogicalParent();
        return parent instanceof MenuStrip;
    }

    private unmountSubmenu(): void
    {
        if (!this._popupMounted) return;
        if (this._popupHost === undefined) return;
        this.DetachOverlayChild(this._popupHost);
        this._popupMounted = false;
    }

    // Pointer handlers — IsMouseOver / IsPressed visuals come from the
    // template's `when()` triggers, so these only need to track the
    // press-originated-here flag for click routing.
    protected override OnPointerDown(_args: PointerEventArgs): void
    {
        this._pressOriginatedHere = true;
    }

    protected override OnPointerUp(_args: PointerEventArgs): void
    {
        const fire = this._pressOriginatedHere && this.IsMouseOver;
        this._pressOriginatedHere = false;
        if (!fire) return;
        this.activate();
    }

    // Shared activation path called by pointer click AND keyboard
    // Enter / Space. Mirrors WPF: clicking or pressing Enter on a
    // checkable item flips IsChecked then fires Command + onActivated;
    // clicking or pressing Enter on a parent item toggles IsSubmenuOpen.
    private activate(): void
    {
        if (this.hasSubmenu())
        {
            this.IsSubmenuOpen = !this.IsSubmenuOpen;
            return;
        }
        if (this.IsCheckable) this.IsChecked = !this.IsChecked;
        // Capture Command + parameter BEFORE closing. `_onActivated` closes the
        // popup chain, which detaches this item from the overlay — and that detach
        // strips its inherited ServiceScope / DataContext, re-resolving any
        // `$service(...)` Command or `$path` CommandParameter binding to undefined.
        // Reading them after the close (as this once did) silently dropped the
        // invocation for every context-menu item whose Command/param is data-bound
        // (e.g. the diagram's "Format Shape" → InspectorService.AddInspectorCommand).
        const cmd   = this.Command;
        const param = this.CommandParameter;
        // Activated callback still runs before Execute — the popup closes before a
        // Command might steal focus to a dialog; we just snapshot the values first.
        this._onActivated?.();
        // Fallback: a MenuItem produced by an ItemsSource ItemTemplate lives inside a
        // ContentPresenter container, so PrepareContainerForItemOverride (which keys
        // on `container instanceof MenuItem`) never wired its `_onActivated`. Without
        // this, such an item runs its Command but leaves the menu open. Close through
        // the popup host that owns us.
        if (this._onActivated === undefined) this.closeThroughOwner();
        if (cmd !== undefined && cmd.CanExecute(param)) cmd.Execute(param);
    }

    // Tear down the WHOLE menu from this level down/up: close our own submenu,
    // then propagate up the _onActivated chain (which collapses every ancestor
    // submenu and the root host — MenuButton / ContextMenu). Falls back to
    // walking the popup-host chain for templated items that were never wired.
    // Used by the click-away scrim so an outside click dismisses everything,
    // not just the deepest submenu.
    private closeEntireMenu(): void
    {
        this.IsSubmenuOpen = false;
        if (this._onActivated !== undefined) this._onActivated();
        else                                 this.closeThroughOwner();
    }

    // Walk up to the MenuPopupHost hosting this item and close the enclosing menu
    // through its owner. Used only as the activate() fallback above.
    private closeThroughOwner(): void
    {
        let cur: Visual | undefined = this.GetVisualParent();
        for (let guard = 0; cur !== undefined && guard < 64; guard++)
        {
            if (cur instanceof MenuPopupHost)
            {
                const owner = cur.owner;
                if (owner instanceof MenuItem)
                {
                    // The owning submenu item's own _onActivated collapses it and
                    // propagates to the root; if it too is unwired (nested templated
                    // menus), collapse it and keep walking up from the owner.
                    if (owner._onActivated !== undefined) { owner._onActivated(); return; }
                    owner.IsSubmenuOpen = false;
                    cur = owner.GetVisualParent();
                    continue;
                }
                if (owner instanceof MenuButton) { owner.IsOpen = false; return; }
                const sink = owner as unknown as { closeFromMenuActivation?: () => void } | undefined;
                if (sink !== undefined && sink.closeFromMenuActivation !== undefined) { sink.closeFromMenuActivation(); return; }
                return;
            }
            cur = cur.GetVisualParent();
        }
    }

    protected override OnPointerEnter(_args: PointerEventArgs): void
    {
        // Standard menu hover navigation. Entering an item first collapses any
        // sibling's open submenu — so moving off a parent onto a different item
        // in the same group closes that parent's flyout. Entering a CHILD of an
        // open submenu closes only the child's siblings (its ancestor is a
        // parent, not a sibling), so travelling parent → submenu keeps the chain
        // open. Then, if THIS item is itself a parent, arm a dwell timer to open
        // its own submenu (click still opens it immediately via activate()).
        this.closeSiblingSubmenus();
        if (this.hasSubmenu() && !this.IsSubmenuOpen)
        {
            this.clearHoverOpenTimer();
            this._hoverOpenTimer = setTimeout((): void =>
            {
                this._hoverOpenTimer = undefined;
                if (this.hasSubmenu()) this.IsSubmenuOpen = true;
            }, MenuItem.HoverOpenDelayMs);
        }
    }

    protected override OnPointerLeave(_args: PointerEventArgs): void
    {
        // Cancel a pending hover-open if the pointer leaves before the dwell
        // completes. Template trigger handles the IsMouseOver visual swap — the
        // template tier knows about the press-originated-here / drag-
        // off behaviour through the IsPressed trigger fading first.
        this.clearHoverOpenTimer();
    }

    private clearHoverOpenTimer(): void
    {
        if (this._hoverOpenTimer !== undefined)
        {
            clearTimeout(this._hoverOpenTimer);
            this._hoverOpenTimer = undefined;
        }
    }

    // Close every SIBLING MenuItem's open submenu so only one flyout per group
    // is open at a time (WPF / M3 behaviour), and — driven from OnPointerEnter —
    // so hovering a different item collapses the previous submenu. Resolve the
    // collection this item belongs to by walking the logical chain to the first
    // enclosing MenuItem (nested submenu owner) or ItemsControl exposing an Items
    // collection (ContextMenu / MenuStrip / MenuButton popup). A one-hop lookup
    // is not enough: a submenu child's immediate logical parent is a panel, not
    // its owning MenuItem.
    private closeSiblingSubmenus(): void
    {
        let owner: Visual | undefined = this.GetLogicalParent();
        for (let guard = 0; owner !== undefined && guard < 64; guard++)
        {
            if (owner instanceof MenuItem) break;
            if ((owner as unknown as { Items?: unknown }).Items !== undefined) break;
            owner = owner.GetLogicalParent();
        }
        const items = (owner as unknown as { Items?: unknown } | undefined)?.Items;
        if (items === undefined || items === null) return;
        const iter = items as { [Symbol.iterator]?: unknown };
        if (typeof iter[Symbol.iterator] !== 'function') return;
        for (const it of items as Iterable<unknown>)
            if (it !== this && it instanceof MenuItem && it.IsSubmenuOpen) it.IsSubmenuOpen = false;
    }

    // Collapse every open MenuItem submenu directly inside `items`. Shared by
    // the three menu roots — MenuItem (its own submenu closing), ContextMenu,
    // and MenuButton — to cascade a close DOWNWARD: nested submenus mount as
    // their own overlay children, so tearing down the container that owns them
    // doesn't reach them. Closing each open child recurses (its own
    // OnPropertyChanged fires this again for its children), so one call at each
    // level unwinds the whole open branch.
    public static closeOpenSubmenusIn(items: unknown): void
    {
        if (items === undefined || items === null) return;
        const iter = items as { [Symbol.iterator]?: unknown };
        if (typeof iter[Symbol.iterator] !== 'function') return;
        for (const it of items as Iterable<unknown>)
            if (it instanceof MenuItem && it.IsSubmenuOpen) it.IsSubmenuOpen = false;
    }

    // Keyboard navigation. Handles arrow keys, Enter / Space, Escape,
    // and letter accelerators. WPF parity:
    //
    //   * Inside a vertical menu (ContextMenu / MenuButton popup /
    //     parent submenu): Down/Up move focus between siblings; Right
    //     opens own submenu; Left closes parent submenu (focus jumps
    //     back to the parent MenuItem).
    //   * Top-level item in a horizontal MenuStrip: Right/Left move
    //     between top-level items; Down opens own submenu and focuses
    //     the first child.
    //   * Enter / Space → activate (same path as pointer-click).
    //   * Escape → close one level (own submenu, or parent's submenu).
    //   * Single letter → focus the next sibling whose Header starts
    //     with that letter (case-insensitive, wraps around).
    protected override OnKeyDown(args: KeyEventArgs): void
    {
        if (args.Handled) return;
        const k = args.Key;
        const inStrip = this.isTopLevelInMenuStrip();

        if (k === Key.Down)
        {
            if (inStrip)
            {
                if (this.hasSubmenu())
                {
                    this.IsSubmenuOpen = true;
                    this.focusFirstSubmenuChild(args);
                }
            }
            else
            {
                this.focusSibling(args, +1);
            }
            args.Handled = true;
            return;
        }
        if (k === Key.Up)
        {
            if (!inStrip) this.focusSibling(args, -1);
            args.Handled = true;
            return;
        }
        if (k === Key.Right)
        {
            if (inStrip)
            {
                this.focusSibling(args, +1);
            }
            else if (this.hasSubmenu())
            {
                this.IsSubmenuOpen = true;
                this.focusFirstSubmenuChild(args);
            }
            args.Handled = true;
            return;
        }
        if (k === Key.Left)
        {
            if (inStrip)
            {
                this.focusSibling(args, -1);
            }
            else
            {
                // Step out one nesting level: close the parent
                // MenuItem's submenu and focus the parent. If we're
                // already at the outermost popup (no parent MenuItem),
                // do nothing — the user can press Escape to close the
                // whole chain instead.
                const parentMI = this.findParentMenuItem();
                if (parentMI !== undefined)
                {
                    parentMI.IsSubmenuOpen = false;
                    args.SetFocus(parentMI);
                }
            }
            args.Handled = true;
            return;
        }
        if (k === Key.Return || k === Key.Space)
        {
            this.activate();
            args.Handled = true;
            return;
        }
        if (k === Key.Escape)
        {
            if (this.IsSubmenuOpen) this.IsSubmenuOpen = false;
            const parentMI = this.findParentMenuItem();
            if (parentMI !== undefined)
            {
                parentMI.IsSubmenuOpen = false;
                args.SetFocus(parentMI);
            }
            else
            {
                // Top of the menu chain — fire onActivated so the
                // hosting popup (ContextMenu / MenuButton / MenuStrip)
                // tears down.
                this._onActivated?.();
            }
            args.Handled = true;
            return;
        }
        // Letter accelerator — keyed off the TYPED character (KeyText),
        // not the virtual key, so it tracks the user's actual layout and
        // matches the Header text it's compared against. Single printable
        // alphanumeric, no command modifiers.
        const typed = args.KeyText;
        if (typed.length === 1 && /[A-Za-z0-9]/.test(typed))
        {
            const noMods = !hasModifier(args.Modifiers, ModifierKeys.Control)
                && !hasModifier(args.Modifiers, ModifierKeys.Alt)
                && !hasModifier(args.Modifiers, ModifierKeys.Windows);
            if (noMods)
            {
                this.focusSiblingByLetter(args, typed.toUpperCase());
                args.Handled = true;
            }
        }
    }

    // Find every MenuItem container in the same items panel as `this`
    // and return them in panel order. Used by all the sibling-walk
    // helpers below. For top-level MenuStrip items the parent panel is
    // the MenuStrip's items panel; for nested rows it's the parent
    // MenuItem / ContextMenu / MenuButton's items panel.
    private collectSiblings(): MenuItem[]
    {
        const panel = this.GetVisualParent();
        if (panel === undefined) return [this];
        const out: MenuItem[] = [];
        for (const c of panel.visualChildren)
        {
            if (c instanceof MenuItem) out.push(c);
        }
        return out;
    }

    private focusSibling(args: KeyEventArgs, direction: 1 | -1): void
    {
        const siblings = this.collectSiblings();
        if (siblings.length === 0) return;
        const idx = siblings.indexOf(this);
        if (idx < 0) return;
        const len = siblings.length;
        const next = siblings[((idx + direction) % len + len) % len]!;
        args.SetFocus(next);
    }

    private focusSiblingByLetter(args: KeyEventArgs, upperLetter: string): void
    {
        const siblings = this.collectSiblings();
        if (siblings.length === 0) return;
        const start = siblings.indexOf(this);
        // Walk siblings starting AFTER self so successive presses of
        // the same letter cycle through matching items.
        for (let off = 1; off <= siblings.length; off++)
        {
            const cand = siblings[(start + off) % siblings.length]!;
            const rawHead = cand.Header;
            const head = (rawHead === undefined || rawHead === null ? '' : String(rawHead)).trim();
            if (head.length > 0 && head[0]!.toUpperCase() === upperLetter)
            {
                args.SetFocus(cand);
                return;
            }
        }
    }

    private focusFirstSubmenuChild(args: KeyEventArgs): void
    {
        // First MenuItem inside this MenuItem's own items panel. The
        // panel sits inside the detached popup subtree (`_popupContainer`).
        const presenter = this._popupContainer?.visualChildren[0];
        const panel = presenter?.visualChildren[0];
        if (panel === undefined) return;
        for (const c of panel.visualChildren)
        {
            if (c instanceof MenuItem) { args.SetFocus(c); return; }
        }
    }

    // Walk the logical parent chain looking for the enclosing MenuItem
    // (one level up). Returns undefined when this MenuItem is the
    // outermost popup row (its logical parent is a MenuStrip /
    // ContextMenu / MenuButton).
    private findParentMenuItem(): MenuItem | undefined
    {
        let cur: Visual | undefined = this.GetLogicalParent();
        while (cur !== undefined)
        {
            if (cur instanceof MenuItem) return cur;
            cur = cur.GetLogicalParent();
        }
        return undefined;
    }
}

function makeGlyph(text: string): TextBlock
{
    // Foreground rides the TextBlock default Style — @OnSurface via
    // DynamicResource so theme switches re-tint live.
    return new TextBlock(text);
}

// ─────────────────────────────────────────────────────────────────────
// MenuSeparator — thin horizontal line between MenuItem groups.
// Same idea as ToolBarSeparator but cross-axis-flipped.
export class MenuSeparator extends Element
{
    public static readonly LineBrushKey = MuralBase.RegisterProperty<Brush | undefined>(
        MenuSeparator, 'LineBrush', undefined, MetaData.Render,
    );

    static
    {
        // Type-keyed lookup for the default Style — registered as
        // `Style [TargetType=MenuSeparator]` in framework.resources.mu.
        // The Style supplies Height / MinWidth / LineBrush via
        // DynamicResource so the line tints flip with the theme
        // palette without consumers having to set LineBrush.
        MuralBase.OverrideMetadata(MenuSeparator, Element.DefaultStyleKeyKey, { default_value: MenuSeparator });
    }

    constructor()
    {
        super();
        // Eager Style resolution — Height / MinWidth / LineBrush come
        // from the bundled `Style [TargetType=MenuSeparator]`.
        this.applyDefaultStyle();
    }

    public get LineBrush():  Brush | undefined { return this.get_property_value(MenuSeparator.LineBrushKey); }
    public set LineBrush(v: Brush | undefined) { this.set_property_value(MenuSeparator.LineBrushKey, v); }

    protected override MeasureOverride(_availableSize: Size): Size
    {
        // Report MinWidth only — the Arrange phase of the hosting
        // vertical StackPanel allocates the cross-axis to finalSize.Width,
        // which is what RenderOverride actually paints. Reporting the
        // full availableSize.Width here would dominate StackPanel's
        // cross-axis max and stretch the entire popup to fill its
        // available area (no MaxWidth on ContextMenu's popup chrome).
        return new Size(this.MinWidth, this.Height);
    }

    protected override ArrangeOverride(finalSize: Size): Size { return finalSize; }

    protected override RenderOverride(dc: DrawingContext): void
    {
        // LineBrush rides the `Style[TargetType=MenuSeparator]` setter
        // via DynamicResource (@OutlineVariant) so theme switches re-tint
        // live. No `?? Theme.fieldBorder` fallback now that the DP
        // default flows through the resource chain.
        const brush = this.LineBrush;
        if (brush === undefined) return;
        const rect = this.ArrangedRect;
        const y = Math.floor(rect.Height / 2);
        dc.DrawRectangle(brush, undefined, new Rect(2, y, Math.max(2, rect.Width - 4), 1));
    }
}

// ─────────────────────────────────────────────────────────────────────
// MenuButton — hamburger button that opens a popup of menu items.
//
// Authoring shape:
//
//   MenuButton {
//       Icon = "☰"
//       Items {
//           MenuItem[Header=New,    Command=$NewCommand]
//           MenuItem[Header=Open,   Command=$OpenCommand, InputGestureText="Ctrl+O"]
//           MenuSeparator {}
//           MenuItem[Header=Save,   Command=$SaveCommand, InputGestureText="Ctrl+S"]
//       }
//   }
//
// MenuButton IS an ItemsControl. Two templates feed its visual layout
// (both registered in framework.resources.mu):
//
//   * DefaultMenuButtonTrigger  — the inline trigger Button. Resolved
//                                 in the ctor and attached as
//                                 visualChildren[0].
//   * DefaultMenuButtonPopup    — the popup chrome (MenuPopupHost >
//                                 [Scrim, Border > ItemsPresenter]).
//                                 Plugged into MenuButton's
//                                 ItemsControl.Template via the Style;
//                                 rebuildTemplate() materialises it
//                                 and slots the ItemsPanel into the
//                                 ItemsPresenter. The ctor then
//                                 DETACHES the popup templateRoot
//                                 from MenuButton so it can be mounted
//                                 on the OverlayLayer instead — same
//                                 dual-parent avoidance the ContextMenu
//                                 path uses.
//
// visualChildren returns [trigger] always; the popup root is kept as
// a private field, mounted/unmounted by mountPopup / unmountPopup.
export class MenuButton extends HeaderedItemsControl
{
    public static readonly IsOpenKey          = MuralBase.RegisterProperty<boolean>(           MenuButton, 'IsOpen', false,     MetaData.None);
    public static readonly IconKey            = MuralBase.RegisterProperty<Visual | undefined>(MenuButton, 'Icon',   undefined, MetaData.Measure);
    // TriggerTemplate — the inline visible Button chrome. MenuButton's
    // primary Template (ItemsControl-inherited) is the popup chrome,
    // so the trigger has to live in a second template DP that the
    // default Style sets to `@DefaultMenuButtonTrigger`.
    public static readonly TriggerTemplateKey = MuralBase.RegisterProperty<ControlTemplate | undefined>(
        MenuButton, 'TriggerTemplate', undefined, MetaData.Measure,
    );

    public get IsOpen():  boolean { return this.get_property_value(MenuButton.IsOpenKey); }
    public set IsOpen(v: boolean) { this.set_property_value(MenuButton.IsOpenKey, v); }

    public get Icon():    Visual | undefined { return this.get_property_value(MenuButton.IconKey); }
    public set Icon(v:    Visual | undefined) { this.set_property_value(MenuButton.IconKey, v); }

    public get TriggerTemplate():  ControlTemplate | undefined { return this.get_property_value(MenuButton.TriggerTemplateKey); }
    public set TriggerTemplate(v: ControlTemplate | undefined) { this.set_property_value(MenuButton.TriggerTemplateKey, v); }

    private _button:         Button         | undefined;
    private _buttonStack:    StackPanel     | undefined;
    private _buttonText:     TextBlock      | undefined;

    // The popup templateRoot is owned by ItemsControl's Template
    // machinery; cached here for mount/unmount. Initially attached as
    // our visualChild by rebuildTemplate; we detach immediately so the
    // OverlayLayer can adopt it later without dual-parent errors.
    private _popupHost:      MenuPopupHost  | undefined;
    private _scrim:          ClickAwayScrim | undefined;
    private _popupContainer: Border         | undefined;

    private _popupMounted = false;
    private _lastKnownTarget: PresentationTarget | undefined;

    static
    {
        // Theme-style lookup key — MenuButton instances resolve their
        // default Style (Template = popup chrome, ItemsPanel = vertical
        // StackPanel, HorizontalAlignment/Vertical sizing pins) via
        // TryFindResource(MenuButton) on attach. The setter values live
        // in framework.resources.mu under the `Style [TargetType=MenuButton]`
        // block. Surface theme is kept apart from the main controls
        // theme to avoid the `extends Button` TDZ cycle (see
        // default-resources.ts).
        MuralBase.OverrideMetadata(MenuButton, Element.DefaultStyleKeyKey, { default_value: MenuButton });
    }

    constructor()
    {
        super();

        // ── Popup subtree via ItemsControl.Template ──────────────────
        // applyDefaultStyle resolves Style[TargetType=MenuButton] which
        // sets Template = @DefaultMenuButtonPopup. ItemsControl's
        // rebuildTemplate then Apply()s it, finds the ItemsPresenter
        // inside, slots in the vertical-stack ItemsPanel (also set by
        // the Style), and attaches the root as our visualChild.
        this.applyDefaultStyle();
        this.adoptPopupTemplate();

        // ── Trigger subtree (separate template DP) ──────────────────
        // The default Style sets TriggerTemplate = @DefaultMenuButtonTrigger
        // (Button(PART_Trigger) > StackPanel(PART_TriggerStack) >
        // TextBlock(PART_HeaderText)). It can't share ItemsControl's
        // Template slot because Template is the popup chrome with the
        // ItemsPresenter that hosts Items. Click flips IsOpen. Built by
        // rebuildTrigger so a runtime TriggerTemplate swap (§18.12) reuses
        // the same path.
        this.rebuildTrigger();
        if (this._button === undefined)
        {
            throw new Error(
                'MenuButton.TriggerTemplate is undefined. The default ' +
                'Style in framework.resources.mu sets TriggerTemplate = ' +
                '@DefaultMenuButtonTrigger. Activate a theme that adopts ' +
                "MuralFramework via its `dictionaries:` header before " +
                'constructing the MenuButton.');
        }
        this._triggerInitialized = true;
        // Ctor's explicit adoptPopupTemplate has run; from here on a
        // Template (popup-chrome) swap goes through rebuildTemplate's
        // re-adopt + remount-if-open path (§18.12).
        this._popupInitialized = true;
    }

    // Guards the rebuildTemplate popup re-adoption against the ctor-time
    // Template set: applyDefaultStyle sets Template = @DefaultMenuButtonPopup
    // BEFORE the ctor's own adoptPopupTemplate runs, and we don't want that
    // first stamp to re-adopt twice. Flipped true once the ctor has adopted.
    private _popupInitialized = false;

    // §18.12 — a runtime Template (popup-chrome) swap. The base
    // ItemsControl.rebuildTemplate re-applies the template and carries the
    // items panel across into the new ItemsPresenter (so the menu Items
    // survive the swap, mirroring SplitButton's MenuContent-survives-
    // PopupTemplate contract). We then re-adopt the fresh popup parts
    // (host / scrim / container) and, if the popup was open, unmount the
    // stale host and remount the new one on the OverlayLayer. Before the
    // ctor's first adopt has run, defer entirely to the base — the ctor
    // calls adoptPopupTemplate itself.
    protected override rebuildTemplate(): void
    {
        if (!this._popupInitialized)
        {
            super.rebuildTemplate();
            return;
        }
        const wasMounted = this._popupMounted;
        if (wasMounted) this.unmountPopup();
        super.rebuildTemplate();
        this.adoptPopupTemplate();
        if (wasMounted) this.mountPopup();
    }

    // Guards the OnPropertyChanged('TriggerTemplate') rebuild against the
    // ctor-time set: applyDefaultStyle sets TriggerTemplate before the
    // ctor's own rebuildTrigger runs, and we don't want that first write
    // to double-build. Flipped true once the ctor has built the trigger.
    private _triggerInitialized = false;

    // Materialise (or re-materialise) the inline trigger chrome from
    // TriggerTemplate. Called from the ctor and from OnPropertyChanged
    // ('TriggerTemplate') so a runtime swap takes effect at once (§18.12).
    // Header text + Icon are re-hydrated from the DPs so the consumer's
    // content survives the chrome rebuild. Returns silently on a
    // transient undefined (a Style swap can clear the DP between setters).
    private rebuildTrigger(): void
    {
        if (this._button !== undefined)
        {
            this.DetachVisual(this._button);
            this._button      = undefined;
            this._buttonStack = undefined;
            this._buttonText  = undefined;
        }
        const triggerTpl = this.TriggerTemplate;
        if (triggerTpl === undefined) return;
        const triggerInst = triggerTpl.Apply(this);
        this._button      = triggerInst.root as Button;
        this._buttonStack = triggerInst.root.FindName('PART_TriggerStack') as StackPanel;
        this._buttonText  = triggerInst.root.FindName('PART_HeaderText')   as TextBlock;
        this._button.AddClickHandler(() => { this.IsOpen = !this.IsOpen; });
        this.AttachVisual(this._button);
        this.refreshTriggerContent();
        // The fresh Button needs the current target for its state triggers;
        // propagate_target_to_visual_children only re-runs on a target
        // change, not on a trigger rebuild.
        (this._button as unknown as { SetTarget?: (t: PresentationTarget | undefined) => void })
            .SetTarget?.(this._lastKnownTarget);
        this.InvalidateMeasure();
    }

    // Re-apply Header text + Icon into the (possibly freshly rebuilt)
    // trigger stack. Mirrors the Header / Icon branches of
    // OnPropertyChanged so a TriggerTemplate swap doesn't drop them.
    private refreshTriggerContent(): void
    {
        if (this._buttonStack === undefined || this._buttonText === undefined) return;
        const icon = this.Icon;
        if (icon !== undefined)
        {
            for (const c of [...this._buttonStack.visualChildren]) this._buttonStack.RemoveChild(c);
            this._buttonStack.AddChild(icon);
            this._buttonStack.AddChild(this._buttonText);
        }
        this._buttonText.Text = (this.Header as unknown as string | undefined) ?? '';
    }

    // Find the popup template parts after rebuildTemplate has run, wire
    // their cross-references (host.anchor → trigger, host.popup →
    // container, scrim.onClick → close), then detach the templateRoot
    // from our visual subtree so the OverlayLayer can adopt it.
    private adoptPopupTemplate(): void
    {
        const root = super.visualChildren[0];
        if (!(root instanceof MenuPopupHost)) return;
        this._popupHost      = root;
        this._scrim          = root.FindName('PART_Scrim')          as ClickAwayScrim;
        this._popupContainer = root.FindName('PART_PopupContainer') as Border;
        this._popupHost.popup  = this._popupContainer;
        this._popupHost.owner  = this;
        this._scrim.onClick    = (): void => { this.IsOpen = false; };
        // Detach so AttachOverlay won't trip the single-parent check.
        // We claim it back in unmountPopup via reattachPopupTemplate if
        // the IsOpen DP ever flips false while we still own the root.
        this.DetachVisual(this._popupHost);
    }

    public override get visualChildren(): readonly Visual[]
    {
        return this._button !== undefined ? [this._button] : [];
    }

    public override get logicalChildren(): readonly Visual[]
    {
        return [];
    }

    /** Body items declared in `.mu` (`MenuButton { MenuItem; … }`) come
     *  in as MenuItem / MenuSeparator Visuals. The base ItemsControl
     *  guard throws unless we accept them here — sibling controls
     *  (MenuStrip, MenuItem, ContextMenu) follow the same accept-anything
     *  shape since their markup body is meant to be heterogeneous. */
    protected override validateDeclarativeChild(_child: Visual): void { }

    /** Items declared as a Visual in `.mu` (`MenuButton { MenuItem; … }`)
     *  ARE their own container — slot the Visual directly. */
    public override IsItemItsOwnContainerOverride(item: unknown): boolean
    {
        return item instanceof Visual;
    }

    /** Wire onActivated on each materialised MenuItem so an activation
     *  closes the popup. */
    public override PrepareContainerForItemOverride(container: Visual, item: unknown, index: number): void
    {
        super.PrepareContainerForItemOverride(container, item, index);
        if (container instanceof MenuItem)
        {
            container._onActivated = (): void => { this.IsOpen = false; };
        }
    }

    protected override MeasureOverride(availableSize: Size): Size
    {
        if (this._button === undefined) return Size.Zero;
        this._button.Measure(availableSize);
        return this._button.DesiredSize;
    }

    protected override ArrangeOverride(finalSize: Size): Size
    {
        if (this._button === undefined) return finalSize;
        this._button.Arrange(new Rect(0, 0, finalSize.Width, finalSize.Height));
        return finalSize;
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue: unknown,
        newValue: unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        const name = descriptor.Name;
        if (name === 'TriggerTemplate' && this._triggerInitialized)
        {
            // §18.12 — a runtime TriggerTemplate swap rebuilds the inline
            // trigger chrome at once (Header text + Icon re-hydrated),
            // instead of the old ctor-captured trigger sticking around.
            this.rebuildTrigger();
            return;
        }
        if (name === 'IsOpen' && this._popupHost !== undefined)
        {
            if (newValue === true) this.mountPopup();
            else
            {
                // Cascade the close down — collapse any open child submenu
                // (a separate overlay child) before we unmount our own popup,
                // so it isn't left floating when the button closes.
                MenuItem.closeOpenSubmenusIn(this.Items);
                this.unmountPopup();
            }
        }
        if (name === 'Icon' && this._buttonStack !== undefined && this._buttonText !== undefined)
        {
            // Rebuild the button stack with the new icon at the front.
            // Children of a StackPanel can't be easily re-ordered, so we
            // clear + re-add.
            for (const c of [...this._buttonStack.visualChildren])
            {
                this._buttonStack.RemoveChild(c);
            }
            const ic = newValue as Visual | undefined;
            if (ic !== undefined) this._buttonStack.AddChild(ic);
            this._buttonStack.AddChild(this._buttonText);
        }
        if (name === 'Header' && this._buttonText !== undefined)
        {
            this._buttonText.Text = (newValue as string | undefined) ?? '';
        }
    }

    protected override propagate_target_to_visual_children(): void
    {
        const newTarget = (this as unknown as { target: PresentationTarget | undefined }).target;
        const oldTarget = this._lastKnownTarget;
        if (oldTarget !== undefined && oldTarget !== newTarget && this._popupMounted)
        {
            if (this._popupHost !== undefined) oldTarget.DetachOverlay(this._popupHost);
            this._popupMounted = false;
        }
        this._lastKnownTarget = newTarget;
        super.propagate_target_to_visual_children();
        // ItemsControl's cascade only reaches _templateInstance.root (the
        // detached popup template). The inline trigger Button is OUR
        // visualChild and needs the target too — without it, the Button's
        // IsMouseOver / IsPressed triggers can't reach the renderer.
        (this._button as unknown as { SetTarget?: (t: PresentationTarget | undefined) => void } | undefined)
            ?.SetTarget?.(newTarget);
        if (newTarget !== undefined && this.IsOpen) this.mountPopup();
    }

    private mountPopup(): void
    {
        if (this._popupMounted) return;
        if (this._popupHost === undefined) return;
        const t = this._lastKnownTarget;
        if (t === undefined) return;
        // The anchor reference is set every mount so a target change
        // (or a late-bound trigger) doesn't leave stale coords.
        if (this._button !== undefined) this._popupHost.anchor = this._button;
        // AttachOverlayChild: visual hop → target's OverlayLayer; logical
        // hop → THIS MenuButton so the popup chrome + items inherit
        // resources / DataContext / inheritable DPs from us.
        this.AttachOverlayChild(this._popupHost);
        this._popupMounted = true;
    }

    private unmountPopup(): void
    {
        if (!this._popupMounted) return;
        if (this._popupHost === undefined) return;
        this.DetachOverlayChild(this._popupHost);
        this._popupMounted = false;
    }
}

// ─────────────────────────────────────────────────────────────────────
// Popup overlay host shared by MenuButton + ContextMenu. Anchors a
// popup body at either the trigger button (MenuButton) or a fixed
// host-coords point (ContextMenu).
export enum MenuAnchorSide
{
    Below = 'below',
    Right = 'right',
}

export class MenuPopupHost extends Panel
{
    constructor()
    {
        super();
        // A positioning container only — never a hit target itself. The host
        // is arranged to the FULL overlay slot (see ArrangeOverride), so its
        // renderer hit pad would otherwise blanket the surface with
        // `pointer-events: all` and swallow every empty-space click that
        // should fall through to the ONE live click-away scrim beneath the
        // whole menu chain. That swallowing is exactly what left click-away
        // dead once nested submenu scrims were made transparent. Marking the
        // host non-hit-testable drops its pad from the elementsFromPoint walk;
        // its hittable children — the live outermost scrim, the popup
        // container, the menu rows — each carry their own explicit
        // `pointer-events="all"` and keep receiving events (same container-
        // transparent pattern OverlayLayer / AdornerLayer use).
        this.IsHitTestVisible = false;
    }

    /** Anchor for popup positioning. When set, the popup is laid out
     *  relative to the anchor according to `anchorSide`. */
    public anchor: Visual | undefined;
    /** Which side of the anchor the popup sits against:
     *   * 'below' (default) — popup's top-left aligns with anchor's
     *     bottom-left. Matches MenuButton triggers and horizontal
     *     MenuStrip top-level items.
     *   * 'right'           — popup's top-left aligns with anchor's
     *     top-right. The conventional submenu-fly-out position for
     *     MenuItems nested inside a vertical popup (ContextMenu /
     *     MenuButton popup body / another MenuItem's submenu). */
    public anchorSide: MenuAnchorSide = MenuAnchorSide.Below;
    /** Fixed-point anchor for ContextMenu (host-coordinates). When set
     *  AND `anchor` is unset, the popup top-left lands at this point. */
    public fixedPoint: { x: number; y: number } | undefined;
    /** Centre the popup in the surface (a modal dialog rather than a
     *  positioned fly-out). Takes precedence over anchor / fixedPoint. */
    public centered = false;
    public popup: Visual | undefined;
    /** The control that owns this popup (the MenuItem / ContextMenu / MenuButton
     *  that opened it). The popup is mounted on a separate OverlayLayer, so a
     *  descendant's visual-parent walk stops here — this back-link lets an activated
     *  item close the enclosing menu even when its own `_onActivated` was never
     *  wired (a templated MenuItem inside a ContentPresenter container). */
    public owner: Visual | undefined;

    protected override MeasureOverride(availableSize: Size): Size
    {
        for (const c of this.visualChildren) c.Measure(availableSize);
        const w = Number.isFinite(availableSize.Width)  ? availableSize.Width  : 0;
        const h = Number.isFinite(availableSize.Height) ? availableSize.Height : 0;
        return new Size(w, h);
    }

    protected override ArrangeOverride(finalSize: Size): Size
    {
        const children = this.visualChildren;
        children[0]?.Arrange(new Rect(0, 0, finalSize.Width, finalSize.Height));
        if (children.length < 2) return finalSize;
        const popupV = this.popup ?? children[1];
        if (popupV === undefined) return finalSize;
        const pw = popupV.DesiredSize.Width;
        const ph = popupV.DesiredSize.Height;

        let px: number;
        let py: number;
        if (this.centered)
        {
            // Modal: centre the body in the surface.
            px = Math.max(0, (finalSize.Width  - pw) / 2);
            py = Math.max(0, (finalSize.Height - ph) / 2);
        }
        else if (this.anchor !== undefined)
        {
            const origin = absoluteOriginOf(this.anchor);
            const ar     = this.anchor.ArrangedRect;
            if (this.anchorSide === MenuAnchorSide.Right)
            {
                // Submenu fly-out: top-left of popup at top-right of
                // the anchor row.
                px = origin.x + ar.Width;
                py = origin.y;
            }
            else
            {
                // Default: popup directly below the anchor.
                px = origin.x;
                py = origin.y + ar.Height;
            }
        }
        else if (this.fixedPoint !== undefined)
        {
            px = this.fixedPoint.x;
            py = this.fixedPoint.y;
        }
        else
        {
            px = 0; py = 0;
        }

        // Clamp into surface bounds.
        if (py + ph > finalSize.Height) py = Math.max(0, finalSize.Height - ph);
        if (px + pw > finalSize.Width)  px = Math.max(0, finalSize.Width  - pw);
        if (px < 0) px = 0;
        if (py < 0) py = 0;
        popupV.Arrange(new Rect(px, py, pw, ph));
        return finalSize;
    }
}

function absoluteOriginOf(v: Visual): { x: number; y: number }
{
    let x = 0;
    let y = 0;
    let cur: Visual | undefined = v;
    while (cur !== undefined)
    {
        x += cur.ArrangedRect.X;
        y += cur.ArrangedRect.Y;
        cur = cur.GetVisualParent();
    }
    return { x, y };
}

// Re-export ContentPresenter for users — some tests want to inspect
// the rendered structure of a MenuButton's button shell.
export { ContentPresenter };
