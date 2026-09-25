import {
    Element,
    MetaData,
    MuralBase,
    ObservableCollection,
    Panel,
    Rect,
    Size,
    Style,
    Visual,
    type CollectionChange,
    type DrawingContext,
    type PropertyDescriptor,
} from '../../runtime/index.js';
import { Control } from './control.js';
import { CollectionViewGroup } from '../../basic/collections/collection-view-group.js';
import { ContentPresenter } from '../../basic/templates/content-presenter.js';
import { DataTemplate } from '../../basic/templates/data-template.js';
import { DataTemplateSelector, type TemplateSelection } from '../../basic/templates/data-template-selector.js';
import { StyleSelector, type StyleSelection } from '../../basic/templates/style-selector.js';
import { TextBlock } from '../../basic/text-block.js';
import { GroupStyle } from '../../basic/collections/group-style.js';

// Per-level GroupStyle picker for nested grouping. Receives the group
// being wrapped + its nesting level (0 = outermost), returns the
// GroupStyle to apply to its GroupItem container — or undefined to
// fall back to ItemsControl.GroupStyle.
export type GroupStyleSelector =
    (group: CollectionViewGroup, level: number) => GroupStyle | undefined;
import {
    GeneratorPosition,
    ItemContainerGenerator,
    ItemsChangedAction,
    type ItemsChangedArgs,
} from '../../basic/collections/item-container-generator.js';
import { ItemsPresenter } from '../../basic/templates/items-presenter.js';
import { VirtualizingPanel } from '../../basic/panels/virtualisation/virtualizing-panel.js';

// Function form of WPF's DataTemplateSelector. Given a data item,
// return the DataTemplate that should materialize its container, or
// undefined to fall back to ItemTemplate. Called by the default
// GetContainerForItemOverride.
export type ItemTemplateSelector = (item: unknown) => DataTemplate | undefined;

// Function form of WPF's StyleSelector applied to item containers.
// Given a data item and its container, returns the Style to apply to
// the container. Returning undefined falls back to ItemContainerStyle.
// Consulted in PrepareContainerForItemOverride before the single-style
// ItemContainerStyle.
// Listener shapes for ItemsControl's container-realization API. Fires
// once per (container, item) realize / clear, regardless of which path
// triggered it. See AddContainerPreparedListener for the broader
// rationale.
export type ContainerPreparedListener = (container: Visual, item: unknown, index: number) => void;
export type ContainerClearedListener  = (container: Visual, item: unknown) => void;

export type ItemContainerStyleSelector =
    (item: unknown, container: Visual) => Style | undefined;

// Minimal duck-type that the grouped-rendering path needs from a
// container — produced by the GroupItem factory registered through
// _registerGroupItemCtor. Defined here (not imported from
// group-item.ts) to break the cycle: group-item.ts extends ItemsControl,
// so importing GroupItem here would create a value-level circular
// dependency that TDZ-fails at module init.
export interface GroupedContainer extends Visual
{
    BindGroup(group: CollectionViewGroup): void;
    // `unknown` to match HeaderedItemsControl's broadened Header type;
    // GroupedContainer implementers (typically GroupItem) skip non-
    // Visual values at the render seam (the bbox can't host a plain
    // string the way a TextBlock can).
    Header: unknown;
    ItemTemplate: DataTemplate | undefined;
    ItemsPanel: unknown;
}

// Registered by group-item.ts on its module-init pass. ItemsControl's
// grouped rendering path invokes this factory when it spots a
// CollectionViewGroup item and a GroupStyle is set. Lives here as the
// neutral integration point.
let _groupItemFactory: (() => GroupedContainer) | undefined;
export function _registerGroupItemCtor(factory: () => GroupedContainer): void
{
    _groupItemFactory = factory;
}

// CollectionView surface — Tier-3 ItemsSource wraps source data in a
// CollectionView before exposing it as the projected items list. Kept
// as a type alias here (the concrete class lives in collection-view.ts)
// so the ItemsControl's ItemsSource setter has a typed hook without
// importing the heavy implementation file at module-load time.
import type { CollectionView } from '../../basic/collections/collection-view.js';

// Re-exported from items-panel-template — same shape as ControlTemplate's
// factory, invoked once per ItemsControl when ItemsPanel changes. The
// `ItemsPanelTemplate` class wraps this same factory; ItemsControl
// accepts either form on assignment (the template is the markup-friendly
// path, the bare function is the hand-rolled JS path).
export { ItemsPanelTemplate } from '../../basic/panels/items-panel-template.js';
export type { ItemsPanelFactory } from '../../basic/panels/items-panel-template.js';
import { ItemsPanelTemplate, type ItemsPanelFactory } from '../../basic/panels/items-panel-template.js';

// Data-driven container that materializes a Visual per item in its
// Items collection, using ItemTemplate to render each one, hosted
// inside an ItemsPanel.
//
// Items may be a plain readonly array OR an ObservableCollection. With
// an array, the materialized tree rebuilds when Items is reassigned;
// with an ObservableCollection, each mutation triggers a rebuild
// (current cut: simple full rebuild; incremental insert / remove is
// a future optimization).
//
// Two-tree wiring is the headline:
//   * Visual tree: ItemsControl → ItemsPanel → generated containers
//   * Logical tree: ItemsControl → generated containers (directly,
//                   bypassing the panel)
//
// That divergence means DataContext / inheritable properties set on
// the ItemsControl flow down to each container without passing through
// the items panel — matching WPF semantics. The items panel itself is
// template-internal (visual only), not a logical child of the
// ItemsControl.
//
// What's in vs. WPF:
//   * ControlTemplate + ItemsPresenter      ✓ Template DP slots panel into a templated chrome
//   * Virtualization                        ✓ VirtualizingPanel / VirtualizingStackPanel
//   * ItemContainerStyle                    ✓ applied during PrepareContainerForItemOverride
//   * Two-tree (logical / visual) split     ✓ containers logical-parented to this control,
//                                              visual-parented to the items panel
//   * Generator + Session API               ✓ ItemContainerGenerator with StartAt /
//                                              GenerateNext / Status / ItemsChanged
//   * Grouping                              ✓ GroupStyle + GroupItem + CollectionViewGroup
//                                              (single-level — nested grouping pending)
//   * Per-item ContentPresenter wrap        ✗ default GetContainerForItemOverride applies
//                                              the DataTemplate directly; the produced
//                                              Visual IS the container. Subclasses
//                                              (ListBoxItem, TreeViewItem, ComboBoxItem)
//                                              still wrap their content via the standard
//                                              ContentControl pattern.
//   * IsItemItsOwnContainerOverride         ✗ subclasses inline an `instanceof` check
//                                              today (e.g. ListBox does `item instanceof
//                                              ListBoxItem`).
//   * DisplayMemberPath                     ✗ controls hardcode the Label/Name/Text
//                                              displayString convention.
//   * Nested grouping / GroupStyleSelector  ✗ buildGroups is single-level.
//   * Hierarchical / horizontal / variable- ✗ VirtualizingStackPanel assumes vertical,
//     height virtualization                    uniform ItemHeight; the generator's
//                                              recycle pool isn't drained on realize.
//   * ItemBindingGroup                      ✗ no validation grouping.
export class ItemsControl extends Control
{
    public static readonly ItemsKey                      = MuralBase.RegisterProperty<readonly unknown[] | ObservableCollection<unknown> | CollectionView | undefined>(ItemsControl, 'Items',                      undefined, MetaData.Measure | MetaData.IsAnimationProhibited);
    public static readonly ItemsSourceKey                = MuralBase.RegisterProperty<unknown>(                                                                       ItemsControl, 'ItemsSource',                undefined, MetaData.Measure | MetaData.IsAnimationProhibited);
    public static readonly ItemTemplateKey               = MuralBase.RegisterProperty<DataTemplate | undefined>(                                                      ItemsControl, 'ItemTemplate',               undefined, MetaData.Measure);
    public static readonly ItemTemplateSelectorKey       = MuralBase.RegisterProperty<TemplateSelection | undefined>(                                                 ItemsControl, 'ItemTemplateSelector',       undefined, MetaData.Measure);
    public static readonly ItemContainerStyleKey         = MuralBase.RegisterProperty<Style | undefined>(                                                             ItemsControl, 'ItemContainerStyle',         undefined, MetaData.Measure);
    public static readonly ItemContainerStyleSelectorKey = MuralBase.RegisterProperty<StyleSelection | undefined>(                                                    ItemsControl, 'ItemContainerStyleSelector', undefined, MetaData.Measure);
    public static readonly ItemsPanelKey                 = MuralBase.RegisterProperty<ItemsPanelTemplate | ItemsPanelFactory | undefined>(                            ItemsControl, 'ItemsPanel',                 undefined, MetaData.Measure);
    // Template DP is inherited from Control (the optional chrome wrapper
    // that hosts the items panel inside an ItemsPresenter).
    // AlternationCount = 0 → AlternationIndex unused (every container
    // gets 0). >0 → AlternationIndex cycles 0..N-1 across containers in
    // items order. WPF parity.
    public static readonly AlternationCountKey           = MuralBase.RegisterProperty<number>(                                                                        ItemsControl, 'AlternationCount',           0,         MetaData.None);
    // HasItems is logically read-only but stored as a plain DP so it
    // goes through the standard change-notification pipeline
    // (PropertyTrigger / Binding can observe it). Only the ItemsControl
    // writes — consumers read.
    public static readonly HasItemsKey                   = MuralBase.RegisterProperty<boolean>(                                                                       ItemsControl, 'HasItems',                   false,     MetaData.None);
    // GroupStyle: when set AND ItemsSource is a grouping CollectionView,
    // each CollectionViewGroup in the projection gets wrapped in a
    // GroupItem rather than rendered through ItemTemplate. Drives the
    // WPF-parity grouped-rendering path.
    public static readonly GroupStyleKey                 = MuralBase.RegisterProperty<GroupStyle | undefined>(                                                        ItemsControl, 'GroupStyle',                 undefined, MetaData.Measure);
    // GroupStyleSelector: per-level GroupStyle picker for nested
    // grouping. Called once per CollectionViewGroup with the group and
    // its nesting level (0 = outermost); the returned GroupStyle drives
    // the GroupItem at that level. Falls back to
    // ItemsControl.GroupStyle when undefined or when the selector
    // returns undefined for a level. WPF parity.
    public static readonly GroupStyleSelectorKey         = MuralBase.RegisterProperty<GroupStyleSelector | undefined>(                                                ItemsControl, 'GroupStyleSelector',         undefined, MetaData.Measure);
    // DisplayMemberPath: when set AND ItemTemplate is undefined, the
    // default GetContainerForItemOverride builds a minimal DataTemplate
    // that renders the named property of the data as a TextBlock. Sugar
    // for the "I just want item.Name visible" case without authoring an
    // ItemTemplate. WPF parity.
    public static readonly DisplayMemberPathKey          = MuralBase.RegisterProperty<string | undefined>(                                                            ItemsControl, 'DisplayMemberPath',          undefined, MetaData.Measure);

    // AlternationIndex attached on each generated container during
    // PrepareContainerForItemOverride. Containers read via
    // ItemsControl.GetAlternationIndex(container) — counterpart to
    // Canvas.GetLeft / DockPanel.GetDock.
    public static readonly AlternationIndexKey           = MuralBase.RegisterAttachedProperty<number>(                                                                ItemsControl, 'AlternationIndex',           0,         MetaData.None);

    public static SetAlternationIndex(v: Visual, value: number): void
    {
        v.set_property_value(ItemsControl.AlternationIndexKey, value);
    }

    public static GetAlternationIndex(v: Visual): number
    {
        return v.get_property_value(ItemsControl.AlternationIndexKey);
    }

    // Walk the logical-parent chain from `visual` looking for the
    // nearest enclosing ItemsControl. WPF's
    // ItemsControl.ItemsControlFromItemContainer analogue, with an
    // optional `typeGuard` predicate so callers can skip past
    // intermediate ItemsControl-shaped ancestors (e.g. a TreeViewItem
    // hosting more rows underneath — its findTree() walks PAST
    // ancestor TreeViewItems until it hits the root TreeView).
    //
    //   // Find the owning ListBox from a row.
    //   const lb = ItemsControl.FromContainer<ListBox>(this, (v): v is ListBox => v instanceof ListBox);
    //
    //   // Find any enclosing ItemsControl.
    //   const ic = ItemsControl.FromContainer(this);
    //
    // Returns undefined if no qualifying ancestor exists.
    public static FromContainer<T extends ItemsControl = ItemsControl>(
        visual: Visual,
        typeGuard?: (v: Visual) => v is T,
    ): T | undefined
    {
        let cur: Visual | undefined = visual.GetLogicalParent();
        while (cur !== undefined)
        {
            if (typeGuard !== undefined)
            {
                if (typeGuard(cur)) return cur;
            }
            else if (cur instanceof ItemsControl)
            {
                return cur as T;
            }
            cur = cur.GetLogicalParent();
        }
        return undefined;
    }

    private _itemsPanel: Panel | undefined;
    private _itemsSubscription: (() => void) | undefined;
    // Subscription to the projected view's GroupDescriptions. When
    // the consumer adds / removes a GroupDescription the view's
    // IsGrouping flag flips, which means we need to re-pick the
    // projection (flat vs. grouped). Held separately from the items
    // subscription so we can tear them down independently.
    private _groupDescSubscription: (() => void) | undefined;

    // _templateInstance (the applied ControlTemplate's root + presenter
    // for surrounding chrome) is inherited from Control as a protected
    // field. The items panel ends up as a visual child of the
    // ItemsPresenter inside it (when one is present); without a template
    // the panel is a direct visual child of the ItemsControl.
    private _itemsPresenter: ItemsPresenter | undefined;
    // Generated containers, in the same order as their corresponding
    // items (for non-virtualizing scenarios). Source of truth for
    // logicalChildren; mirrored into the items panel's visual-children
    // list. May be a subset of the items collection if a virtualizing
    // panel is used (only realized items appear here).
    private _containers: Visual[] = [];
    // Bridge between data items and container Visuals. Owns the
    // item ↔ container mapping and the Realize / Recycle entry points.
    // Public so virtualizing panels can realize containers on demand.
    private readonly _generator: ItemContainerGenerator = new ItemContainerGenerator(this);

    public get Generator(): ItemContainerGenerator { return this._generator; }

    // The materialized ItemsPanel instance — the Panel created from
    // ItemsPanelTemplate / ItemsPanelFactory and currently parenting
    // the realized containers. Undefined until template / panel
    // resolution completes (constructors typically don't have a panel
    // until the first measure pass). Exposed so ScrollContentPresenter
    // can traverse into the items panel for IScrollInfo / Viewport
    // delegation when this ItemsControl is the SCP's direct content —
    // the WPF parity for "ScrollViewer wrapping a ListBox whose
    // ItemsPanel is a VirtualizingStackPanel auto-delegates."
    public get ItemsPanelInstance(): Panel | undefined { return this._itemsPanel; }

    // ── Declarative-children backing ───────────────────────────────
    //
    // Compiler routes `Control { ChildA; ChildB }` body elements through
    // AddChild. WPF parity: those declarative children should land in
    // the same Items collection that data-driven population uses, so a
    // single materialization pipeline owns both modes.
    //
    // Each ItemsControl owns an internal ObservableCollection. The
    // constructor seeds `Items = _declarativeItems` so consumers can
    // `lb.Items.Add(value)` without first assigning a collection. When
    // a consumer later reassigns `Items = someArray`, declarative
    // children added afterward are promoted back into the observable
    // (preserving existing array entries) — that's promoteToObservable.
    //
    // Subclasses opt into declarative children by overriding
    // validateDeclarativeChild to type-check the incoming Visual; the
    // base rejects all declarative children since plain ItemsControl
    // doesn't have a specific container shape to wrap with.
    protected readonly _declarativeItems: ObservableCollection<unknown>
        = new ObservableCollection<unknown>();

    constructor()
    {
        super();
        // Seed Items with our internal observable. Setting this triggers
        // OnPropertyChanged('Items') which calls rebuildContainers — but
        // rebuildContainers bails out when _itemsPanel is undefined (the
        // common case during construction), so this is a cheap no-op
        // beyond the DP write itself. The subclass constructor still
        // runs afterward and sets Template / ItemsPanel which kick off
        // real container materialization.
        this.Items = this._declarativeItems;
    }

    // Subclass hook for declarative child validation. The base throws
    // unconditionally — a plain ItemsControl has no item container type,
    // so accepting an arbitrary Visual would be ambiguous. Subclasses
    // override to accept their specific container type:
    //
    //   protected override validateDeclarativeChild(child: Visual): void
    //   {
    //       if (!(child instanceof ListBoxItem))
    //           throw new Error('ListBox only accepts ListBoxItem children');
    //   }
    //
    // Called by AddChild before the item lands in Items.
    protected validateDeclarativeChild(_child: Visual): void
    {
        throw new Error(
            'ItemsControl: declarative children require a concrete subclass '
            + '(ListBox / TreeView / ComboBox / …). Override '
            + 'validateDeclarativeChild to accept your container type.',
        );
    }

    // Compiler-emitted body-elements path. Each subclass's DEFAULT_SLOT_INFO
    // routes `Control { … }` body items through AddChild; we accept any
    // Visual the subclass validates, then route into Items so the
    // ItemsControl pipeline does the rest (logical tree wiring, container
    // generation, selection bookkeeping, etc.).
    public AddChild(child: Visual): void
    {
        this.validateDeclarativeChild(child);
        const items = this.Items;
        if (items instanceof ObservableCollection)
        {
            items.Add(child);
        }
        else
        {
            // Items was reassigned to a plain array (or undefined).
            // Promote back to our observable, preserving content.
            this.promoteToObservable();
            this._declarativeItems.Add(child);
        }
    }

    public RemoveChild(child: Visual): void
    {
        const items = this.Items;
        if (items instanceof ObservableCollection)
        {
            items.Remove(child);
        }
    }

    // Re-promote Items to the internal observable, preserving any
    // existing entries from the prior array (or undefined). Called by
    // AddChild when the consumer mid-flight reassigned Items to a fixed
    // array and now wants to append declaratively.
    protected promoteToObservable(): void
    {
        const current = this.Items;
        this._declarativeItems.Clear();
        if (Array.isArray(current))
        {
            for (const v of current) this._declarativeItems.Add(v);
        }
        // ItemsSource guard in the setter accepts undefined; ItemsSource
        // can't have been set when we arrived here because the declarative
        // AddChild path is mutually exclusive with bound mode.
        this.Items = this._declarativeItems;
    }

    // Public container-lifecycle hooks. Both the internal non-
    // virtualizing path (rebuildContainers / handleItemsChange) and
    // VirtualizingPanel realization route through here, so _containers
    // (the source of truth for logicalChildren) stays consistent
    // regardless of who's driving.
    public AttachContainer(container: Visual): void
    {
        this.AttachLogical(container);
        this._containers.push(container);
    }

    public InsertContainer(index: number, container: Visual): void
    {
        this.AttachLogical(container);
        this._containers.splice(index, 0, container);
    }

    public DetachContainer(container: Visual): void
    {
        const i = this._containers.indexOf(container);
        if (i >= 0) this._containers.splice(i, 1);
        this.DetachLogical(container);
    }

    public get Items(): ObservableCollection<any> | readonly unknown[] | undefined
    {
        return this.get_property_value(ItemsControl.ItemsKey) as
            ObservableCollection<any> | readonly unknown[] | undefined;
    }

    public set Items(value: ObservableCollection<any> | readonly unknown[] | undefined)
    {
        // WPF parity: assigning Items directly while ItemsSource is set
        // is a programming error — Items is a read-only projection of
        // ItemsSource in that mode. Throwing surfaces the mistake
        // immediately rather than silently letting the next refresh
        // overwrite the assignment.
        if (this.ItemsSource !== undefined)
        {
            throw new Error(
                "ItemsControl.Items cannot be set while ItemsSource is non-undefined. " +
                "Clear ItemsSource first (or mutate the source) to drive items.",
            );
        }
        const old = this.Items;
        if (old === value) return;

        this._itemsSubscription?.();
        this._itemsSubscription = undefined;

        this.set_property_value(ItemsControl.ItemsKey, value);

        if (value instanceof ObservableCollection)
        {
            // Incremental — dispatch on change.kind so single-item
            // inserts / removes / replaces touch only the affected
            // container instead of tearing down the whole panel.
            // Cleared still tears down (it's the destructive case).
            this._itemsSubscription = value.Subscribe(change => this.handleItemsChange(change));
        }

        this.rebuildContainers();
    }

    // ── Subclass override points ───────────────────────────────────
    //
    // The three methods below mirror WPF's ItemsControl protected
    // virtuals — exposed as `public` here so VirtualizingPanel-side
    // realization can route through them without back-channel access.
    //
    // Default behavior implements the data-driven path through
    // ItemTemplateSelector → ItemTemplate. Subclasses override to
    // wrap items in their own container shape (ListBox wraps in
    // ListBoxItem; TreeView wraps in TreeViewItem; ComboBox wraps in
    // ComboBoxItem). Custom subclasses also override
    // PrepareContainerForItemOverride to attach behavior (selection,
    // press, etc.) that the data template doesn't know about.

    /**
     * Return true when `item` is already in the right container shape
     * and should be passed through GetContainerForItemOverride
     * untouched. Default returns `false` — every item gets wrapped.
     * Subclasses override to recognise pre-built containers in
     * composed-markup form:
     *   * ListBox  → `item instanceof ListBoxItem`
     *   * TreeView → `item instanceof TreeViewItem`
     *   * ComboBox → `item instanceof ComboBoxItem`
     *
     * Mirrors WPF's `ItemsControl.IsItemItsOwnContainerOverride`. The
     * default GetContainerForItemOverride consults this before
     * applying a DataTemplate — when it returns true, the item itself
     * is the container.
     */
    public IsItemItsOwnContainerOverride(_item: unknown): boolean
    {
        return false;
    }

    /**
     * Build the container Visual for `item`. Default consults
     * IsItemItsOwnContainerOverride first (so a Visual that's already
     * the right container shape passes through), then picks the
     * DataTemplate via ItemTemplateSelector → ItemTemplate and
     * applies it. Subclasses override to wrap in a control-specific
     * container (e.g., ListBoxItem). Throws when no template resolves
     * — surface the configuration gap early rather than letting the
     * panel render nothing.
     */
    public GetContainerForItemOverride(item: unknown): Visual
    {
        // Grouped rendering: when the projected item is a
        // CollectionViewGroup AND a GroupStyle is set, wrap it in a
        // GroupItem instead of running ItemTemplate. Leaf-item
        // realization happens inside the GroupItem (it's an
        // ItemsControl with its own generator + items panel).
        // Grouped path: resolve the per-level GroupStyle. If the
        // selector / DP yields one AND a GroupItem factory is
        // registered, wrap in a GroupItem; otherwise fall through to
        // the default container path so the group renders as just
        // another item (matches WPF — no GroupStyle means "render
        // groups as flat rows").
        const gs = item instanceof CollectionViewGroup
            ? (this.GroupStyleSelector?.(item, item.Level) ?? this.GroupStyle)
            : undefined;
        if (item instanceof CollectionViewGroup && gs !== undefined
            && _groupItemFactory !== undefined)
        {
            const gi = _groupItemFactory();
            // Carry ItemTemplate down so leaves render the same way
            // they would in an ungrouped ItemsControl.
            gi.ItemTemplate = this.ItemTemplate;
            // Non-bottom group: propagate the grouping setup so the
            // GroupItem's own ItemsControl machinery wraps its
            // sub-groups recursively. The cascade terminates when a
            // bottom-level group's Items are realized through
            // ItemTemplate.
            if (!item.IsBottomLevel)
            {
                (gi as unknown as { GroupStyle: GroupStyle | undefined }).GroupStyle = gs;
                (gi as unknown as { GroupStyleSelector: GroupStyleSelector | undefined }).GroupStyleSelector
                    = this.GroupStyleSelector;
            }
            // GroupStyle.Panel overrides the leaf items panel; falls
            // back to the parent's ItemsPanel (or GroupItem's default
            // when neither is set).
            const groupPanel = gs.Panel ?? this.ItemsPanel;
            if (groupPanel !== undefined) gi.ItemsPanel = groupPanel;
            return gi;
        }
        // Default container: a per-item ContentPresenter. The
        // presenter resolves the DataTemplate against the data item
        // and slots the produced Visual; if no template resolves, the
        // presenter falls back to stringifying the data into a
        // TextBlock. WPF parity — every data row has a stable outer
        // container even when ItemTemplate changes.
        const cp = new ContentPresenter();
        const tmpl = DataTemplateSelector.resolve(this.ItemTemplateSelector, item, this) ?? this.ItemTemplate
                   ?? this.buildDisplayMemberTemplate();
        cp.ContentTemplate = tmpl;
        cp.Content         = item;
        return cp;
    }

    // Build a one-shot DataTemplate for the current DisplayMemberPath,
    // or undefined when the path isn't set. Each call rebuilds because
    // the path may have changed. Inexpensive — the template just
    // closes over the path string and pulls the named field at apply
    // time. WPF caches one auto-template per ItemsControl; we
    // intentionally don't bother (rebuilds are cheap and templates
    // aren't shared across instances).
    protected buildDisplayMemberTemplate(): DataTemplate | undefined
    {
        const path = this.DisplayMemberPath;
        if (path === undefined || path === '') return undefined;
        return new DataTemplate((data: unknown): Visual => {
            const value = (data === null || data === undefined)
                ? ''
                : String((data as Record<string, unknown>)[path] ?? '');
            return new TextBlock(value);
        });
    }

    /**
     * Called right after a container is realized and attached to both
     * trees. The default attaches ItemContainerStyle and stamps
     * AlternationIndex. Subclasses chain via super.* and add their
     * own wiring (data context, selection bindings, pointer
     * handlers).
     *
     * `index` is the container's slot in the items collection — used
     * to compute AlternationIndex and to bind position-aware sub-
     * styling. The hook fires AFTER tree attach so any setter that
     * needs the tree (Bindings, DynamicResources) sees a connected
     * Visual.
     */
    /**
     * Re-bind a previously-realized container to a new item — called
     * by the generator's session when it pulls a container out of the
     * recycle pool. Default rewires Content on a per-item
     * ContentPresenter (the wrap the base GetContainerForItemOverride
     * produces); subclasses override for their own container shape:
     *   * ListBox  → li.Tag = item; li.Content = new TextBlock(displayString(item))
     *   * TreeView → tvi.Header = displayTreeHeader(item)
     *
     * The session calls PrepareContainerForItemOverride AFTER this
     * hook, so style / AlternationIndex re-application happens against
     * a container already pointing at the new data.
     *
     * Mirrors WPF's container-recycling rebind step (which in WPF
     * happens implicitly because the container's bindings re-resolve
     * once DataContext is reassigned). The explicit hook keeps the
     * contract visible.
     */
    public RebindContainerForItemOverride(container: Visual, item: unknown): void
    {
        if (container instanceof ContentPresenter)
        {
            container.Content = item;
        }
    }

    public PrepareContainerForItemOverride(container: Visual, item: unknown, index: number): void
    {
        // Notify external observers — behavior wiring from the
        // bootstrap, instrumentation, etc. — that a container has just
        // been realized for `item`. Fires for every realization regardless
        // of trigger (initial rebuild, ObservableCollection.Add, late
        // ItemContainerStyle settling, etc.) so consumers don't have to
        // separately observe `Items.Subscribe` AND every other path that
        // can rebuild containers.
        //
        // Symmetric with OnContainerCleared on the clear side. Order:
        // this notification fires BEFORE the per-item style /
        // GroupItem / AlternationIndex setup below so consumers can
        // observe a fresh container before any framework wiring; flip
        // the order if a consumer needs the post-setup view.
        this._containerPreparedListeners?.forEach(l => l(container, item, index));

        // Per-item style picker takes precedence over the single
        // ItemContainerStyle DP. WPF parity — same precedence as
        // ItemTemplateSelector over ItemTemplate.
        const style = StyleSelector.resolve(this.ItemContainerStyleSelector, item, container)
                   ?? this.ItemContainerStyle;
        if (style !== undefined)
        {
            this.applyContainerStyle(container, style);
        }
        // GroupItem wiring: bind the group to the container and, if
        // a GroupStyle.HeaderTemplate is set, build the header Visual.
        // Applied here (not in GetContainer) so the container's
        // logical/visual tree is in place before bindings resolve.
        if (item instanceof CollectionViewGroup
            && (container as unknown as { BindGroup?: unknown }).BindGroup !== undefined)
        {
            const gc = container as unknown as GroupedContainer;
            gc.BindGroup(item);
            // Resolve the GroupStyle for this level — same lookup as
            // GetContainerForItemOverride uses, so the header /
            // container style come from the active per-level style.
            const gs = this.GroupStyleSelector?.(item, item.Level) ?? this.GroupStyle;
            if (gs?.HeaderTemplate !== undefined)
            {
                const header = gs.HeaderTemplate.Apply(item);
                header.DataContext = item;
                gc.Header = header;
            }
            if (gs?.ContainerStyle !== undefined)
            {
                this.applyContainerStyle(container, gs.ContainerStyle);
            }
        }
        if (this.AlternationCount > 0)
        {
            ItemsControl.SetAlternationIndex(container, this.computeAlternationIndex(index));
        }
        // Surface the item on the container for subclasses that want
        // to read it back without going through the generator's
        // reverse map. Stored as a plain property bag entry, not a
        // registered DP — subclasses that want trigger / binding
        // visibility can register their own DP and copy it across.
        (container as ContainerWithData)._itemsControlData = item;
        void item; void index;
    }

    /**
     * Symmetric counterpart to PrepareContainerForItemOverride —
     * called BEFORE the container is detached. Default clears
     * ItemContainerStyle. Subclasses chain via super.* and undo any
     * setup they did in Prepare.
     */
    public ClearContainerForItemOverride(container: Visual, item: unknown): void
    {
        // Notify external observers BEFORE we tear container state down,
        // so a listener that needs to read item↔container state on the
        // way out (detach behavior, capture metrics, …) still sees the
        // wired-up state. Symmetric with the OnContainerPrepared
        // notification at the top of PrepareContainerForItemOverride.
        this._containerClearedListeners?.forEach(l => l(container, item));

        if (this.ItemContainerStyle !== undefined)
        {
            this.clearContainerStyle(container);
        }
        (container as ContainerWithData)._itemsControlData = undefined;
        void item;
    }

    // ── Container-realization listener API ────────────────────────────
    //
    // External observers (typically a demo's bootstrap wiring up
    // behaviors) register here to learn about every container
    // realization / clearing — independent of the path that triggered
    // it. The naive alternative — subscribing to the bound items
    // collection — misses rebuilds (e.g. a late-arriving
    // ItemContainerStyle) and leaves listeners attached to stale
    // containers; that bug spawned this API.
    //
    // The pair below mirrors AddRoutedEventListener's shape: register
    // many listeners; unregister symmetrically. Late registrations do
    // NOT replay existing containers — register BEFORE any items are
    // added or any rebuild fires. (If we grow a use case for "attach to
    // current containers too," add a `replayCurrent` flag rather than
    // making replay the default — most consumers don't want it and
    // would have to filter.)

    private _containerPreparedListeners: Set<ContainerPreparedListener> | undefined;
    private _containerClearedListeners:  Set<ContainerClearedListener>  | undefined;

    public AddContainerPreparedListener(listener: ContainerPreparedListener): void
    {
        (this._containerPreparedListeners ??= new Set()).add(listener);
    }

    public RemoveContainerPreparedListener(listener: ContainerPreparedListener): void
    {
        this._containerPreparedListeners?.delete(listener);
    }

    public AddContainerClearedListener(listener: ContainerClearedListener): void
    {
        (this._containerClearedListeners ??= new Set()).add(listener);
    }

    public RemoveContainerClearedListener(listener: ContainerClearedListener): void
    {
        this._containerClearedListeners?.delete(listener);
    }

    // Centralised side-effect dispatcher for ItemsControl-owned DPs.
    // JS setters and Binding writes both flow through set_property_value,
    // which fires this hook — so a TwoWay binding push has the same
    // effect as a direct assignment without needing each setter to
    // re-implement the work.
    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue: unknown,
        newValue: unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        switch (descriptor.Name)
        {
            case 'ItemTemplate':
            case 'ItemTemplateSelector':
                // Cached containers were built against the prior
                // template/selector — drop and rebuild.
                this.rebuildContainers();
                return;
            case 'ItemContainerStyle':
            case 'ItemContainerStyleSelector':
            {
                // Re-apply style across realized containers. New
                // containers will pick it up via the next
                // PrepareContainerForItemOverride run; existing ones
                // are updated here. The selector takes precedence; the
                // fallback is the single ItemContainerStyle DP.
                const selector = this.ItemContainerStyleSelector;
                const fallback = this.ItemContainerStyle;
                for (let i = 0; i < this._containers.length; i++)
                {
                    const c    = this._containers[i]!;
                    const item = this._generator.ItemFromContainer(c);
                    const style = StyleSelector.resolve(selector, item, c) ?? fallback;
                    if (style !== undefined) this.applyContainerStyle(c, style);
                    else                     this.clearContainerStyle(c);
                }
                return;
            }
            case 'AlternationCount':
                // Re-stamp AlternationIndex on every realized container
                // so the new modulus takes effect immediately.
                for (let i = 0; i < this._containers.length; i++)
                {
                    ItemsControl.SetAlternationIndex(this._containers[i]!, this.computeAlternationIndex(i));
                }
                return;
            case 'ItemsSource':
                // A collection binding (`ItemsSource=$Coll`) re-pushes the SAME
                // collection instance on every content mutation — the binding
                // observes the collection and pulses the target on each notify.
                // Without this identity guard, every Add/Remove re-ran a full
                // refreshItemsFromSource → new CollectionView → rebuildContainers,
                // tearing down and rebuilding EVERY container (and, for a Selector
                // like a TabControl, transiently clearing SelectedItem → an
                // ActiveDocument=undefined blip through a TwoWay binding). The live
                // CollectionView subscription set up on the first assignment already
                // delivers the mutation incrementally via handleItemsChange, so a
                // same-instance re-push must be a no-op here. Mirrors the ItemsPanel
                // guard below.
                if (oldValue === newValue) return;
                this.refreshItemsFromSource();
                return;
            case 'DisplayMemberPath':
                // The auto-template is consumed inside
                // GetContainerForItemOverride — a rebuild is all that's
                // needed to pick up the new path.
                this.rebuildContainers();
                return;
            case 'GroupStyle':
            case 'GroupStyleSelector':
                // Re-evaluate the projection (flat vs. grouped) and
                // rebuild containers under the new mode. If there's
                // no live CollectionView (because Items was set
                // directly), there's nothing to re-project; just
                // rebuild so existing containers route through the
                // updated GetContainerForItemOverride.
                if (this._projectedView !== undefined)
                {
                    this.applyProjectedItems(this._projectedView);
                }
                else
                {
                    this.rebuildContainers();
                }
                return;
            case 'ItemsPanel':
                // Tear down the current panel + attach the new one.
                // Routed through OnPropertyChanged so a markup write
                // (`set_property_value(ItemsControl.ItemsPanelKey, …)`
                // emitted from `.mu`) or a binding push produces the
                // same effect as the JS setter. Identity guard mirrors
                // the prior setter's early-out.
                if (oldValue === newValue) return;
                this.teardownItemsPanel();
                if (newValue !== undefined)
                {
                    this.materializeItemsPanel(newValue as ItemsPanelTemplate | ItemsPanelFactory);
                }
                return;
            // 'Template' is handled by Control.OnPropertyChanged (super),
            // which calls this.rebuildTemplate() — ItemsControl's override
            // re-hosts the items panel inside the new ItemsPresenter.
        }
    }

    private computeAlternationIndex(slot: number): number
    {
        const n = this.AlternationCount;
        return n > 0 ? slot % n : 0;
    }

    private applyContainerStyle(container: Visual, style: Style): void
    {
        // Style is FE-tier (`Element` — see [./element.ts](../visual-engine/element.ts)
        // § Phase B). Containers that aren't Elements can't carry a
        // Style; silently skip rather than throwing — matches the WPF
        // "Setter on unstyleable target" semantics and tolerates
        // non-Element container types (currently none in production).
        // Apply checks TargetType compatibility and throws on mismatch
        // — caller's responsibility to match.
        if (container instanceof Element) container.Style = style;
    }

    private clearContainerStyle(container: Visual): void
    {
        if (container instanceof Element && container.Style !== undefined)
        {
            container.Style = undefined;
        }
    }

    // ── Indexed access to the projected Items collection ────────────
    //
    // Items can be a plain readonly array, an ObservableCollection, or
    // a CollectionView — each has a different "give me element at
    // index i" API. Centralised here so both the non-virtualizing
    // rebuildContainers path and the VSP (which used to inline the
    // same dispatch) share one source of truth, and so the
    // ItemContainerGenerator's GenerationSession can probe items by
    // absolute index without re-implementing the dispatch.
    public ItemAt(index: number): unknown
    {
        const items = this.Items;
        if (items === undefined || index < 0) return undefined;
        if (Array.isArray(items))
        {
            return index < items.length ? items[index] : undefined;
        }
        // ObservableCollection / CollectionView both expose Get(i).
        const getter = (items as { Get?: (i: number) => unknown }).Get;
        if (typeof getter === 'function')
        {
            const count = (items as { Count?: number }).Count;
            if (typeof count === 'number' && index >= count) return undefined;
            return getter.call(items, index);
        }
        // Iterable fallback. O(N) but only hit by exotic ItemsSources.
        let i = 0;
        for (const v of items as Iterable<unknown>)
        {
            if (i === index) return v;
            i++;
        }
        return undefined;
    }

    public ItemCount(): number
    {
        const items = this.Items;
        if (items === undefined) return 0;
        if (Array.isArray(items)) return items.length;
        const c = (items as { Count?: number }).Count;
        if (typeof c === 'number') return c;
        let n = 0;
        for (const _ of items as Iterable<unknown>) n++;
        return n;
    }

    private updateHasItems(): void
    {
        const items = this.Items;
        let nonEmpty = false;
        if (items !== undefined)
        {
            // Cheap fast path for ObservableCollection / arrays /
            // CollectionView — anything with Count or .length avoids
            // a full iteration just to check non-empty.
            const c = (items as { Count?: number }).Count;
            if (typeof c === 'number')           nonEmpty = c > 0;
            else if (Array.isArray(items))       nonEmpty = items.length > 0;
            else
            {
                for (const _ of items as Iterable<unknown>) { nonEmpty = true; break; }
            }
        }
        if (this.HasItems !== nonEmpty)
        {
            this.set_property_value(ItemsControl.HasItemsKey, nonEmpty);
        }
    }

    public get ItemTemplate(): DataTemplate | undefined
    {
        return this.get_property_value(ItemsControl.ItemTemplateKey);
    }

    public set ItemTemplate(value: DataTemplate | undefined)
    {
        // The actual rebuild lives in OnPropertyChanged so the binding
        // system's set_property_value writes (which bypass JS setters)
        // produce the same effect as direct assignment.
        this.set_property_value(ItemsControl.ItemTemplateKey, value);
    }

    // Per-item template selector — queried before ItemTemplate by
    // GetContainerForItemOverride. Lets a heterogeneous Items
    // collection render different visuals per data type.
    public get ItemTemplateSelector(): TemplateSelection | undefined
    {
        return this.get_property_value(ItemsControl.ItemTemplateSelectorKey);
    }

    public set ItemTemplateSelector(value: TemplateSelection | undefined)
    {
        // Side effect (rebuild) handled in OnPropertyChanged — see
        // ItemTemplate above for the rationale.
        this.set_property_value(ItemsControl.ItemTemplateSelectorKey, value);
    }

    // Style applied to every generated container during
    // PrepareContainerForItemOverride. TargetType must match the
    // container Visual produced by ItemTemplate / GetContainer.
    public get ItemContainerStyle(): Style | undefined
    {
        return this.get_property_value(ItemsControl.ItemContainerStyleKey);
    }

    public set ItemContainerStyle(value: Style | undefined)
    {
        // Side effect (re-apply style across realized containers)
        // handled in OnPropertyChanged — see ItemTemplate above.
        this.set_property_value(ItemsControl.ItemContainerStyleKey, value);
    }

    // Per-item style picker — consulted before ItemContainerStyle.
    // Lets a heterogeneous Items collection style each row differently
    // based on its data without authoring separate ItemContainerStyles.
    public get ItemContainerStyleSelector(): StyleSelection | undefined
    {
        return this.get_property_value(ItemsControl.ItemContainerStyleSelectorKey);
    }

    public set ItemContainerStyleSelector(value: StyleSelection | undefined)
    {
        // Side effect (re-apply styles across realized containers
        // under the new picker) handled in OnPropertyChanged.
        this.set_property_value(ItemsControl.ItemContainerStyleSelectorKey, value);
    }

    public get AlternationCount(): number
    {
        return this.get_property_value(ItemsControl.AlternationCountKey);
    }

    public set AlternationCount(value: number)
    {
        // Side effect (re-stamp AlternationIndex) handled in
        // OnPropertyChanged — see ItemTemplate above.
        this.set_property_value(ItemsControl.AlternationCountKey, value);
    }

    public get HasItems(): boolean
    {
        return this.get_property_value(ItemsControl.HasItemsKey);
    }

    // Per-level GroupStyle picker — see GroupStyleSelector type docs.
    // When set, overrides the single GroupStyle DP on a per-group
    // basis. Lets nested grouping use different chrome at each level.
    public get GroupStyleSelector(): GroupStyleSelector | undefined
    {
        return this.get_property_value(ItemsControl.GroupStyleSelectorKey);
    }

    public set GroupStyleSelector(value: GroupStyleSelector | undefined)
    {
        // Side effect (rebuild containers under the new picker)
        // handled in OnPropertyChanged — see ItemTemplate above.
        this.set_property_value(ItemsControl.GroupStyleSelectorKey, value);
    }

    // DisplayMemberPath — when set, the default GetContainerForItemOverride
    // builds an auto-template rendering `String(item[path])` in a
    // TextBlock. Ignored when an explicit ItemTemplate is set.
    public get DisplayMemberPath(): string | undefined
    {
        return this.get_property_value(ItemsControl.DisplayMemberPathKey);
    }

    public set DisplayMemberPath(value: string | undefined)
    {
        // Side effect (rebuild containers so they pick up the new auto
        // template) handled in OnPropertyChanged — see ItemTemplate above.
        this.set_property_value(ItemsControl.DisplayMemberPathKey, value);
    }

    // GroupStyle controls grouped-rendering: when set AND ItemsSource
    // is a CollectionView with grouping active, projected items are
    // CollectionViewGroups and GetContainerForItemOverride wraps each
    // in a GroupItem with the GroupStyle's HeaderTemplate / Panel
    // applied. Undefined → ItemsControl renders flat (groups, if any,
    // appear as ordinary items via ItemTemplate).
    public get GroupStyle(): GroupStyle | undefined
    {
        return this.get_property_value(ItemsControl.GroupStyleKey);
    }

    public set GroupStyle(value: GroupStyle | undefined)
    {
        // Side effect (rebuild containers so groups vs. flat
        // realization picks up the change) handled in
        // OnPropertyChanged — see ItemTemplate above.
        this.set_property_value(ItemsControl.GroupStyleKey, value);
    }

    // ItemsSource is the data-binding hook. Set to ANY iterable (array,
    // ObservableCollection, CollectionView) and the ItemsControl
    // projects it through a CollectionView under the hood. When
    // ItemsSource is set, direct mutation of Items is rejected (WPF
    // parity: Items becomes a read-only view of ItemsSource).
    public get ItemsSource(): unknown
    {
        return this.get_property_value(ItemsControl.ItemsSourceKey);
    }

    public set ItemsSource(value: unknown)
    {
        // Side effect (re-projection through CollectionView) handled
        // in OnPropertyChanged — see ItemTemplate above. Same reason:
        // bindings push values via set_property_value, bypassing the
        // JS setter; lifting the work into OnPropertyChanged keeps
        // both code paths equivalent.
        this.set_property_value(ItemsControl.ItemsSourceKey, value);
    }

    // Lazily-acquired CollectionView for the current ItemsSource. Held
    // here so SortDescriptions / Filter survive ItemsSource swaps to
    // the same identity (or revival), and so view-mutation subscribers
    // see the same instance.
    private _projectedView: CollectionView | undefined;

    public get View(): CollectionView | undefined
    {
        return this._projectedView;
    }

    private refreshItemsFromSource(): void
    {
        // Tear down the old view subscription (if Items was wired up
        // through one) — the Items setter detaches its own.
        const src = this.ItemsSource;
        if (src === undefined)
        {
            this._projectedView = undefined;
            this.applyProjectedItems(undefined);
            return;
        }
        // Lazy require to dodge the items-control / collection-view
        // import cycle (CollectionView's CollectionChangeListener type
        // doesn't reach the ItemsControl module at compile time).
        const view = createCollectionView(src);
        this._projectedView = view;
        this.applyProjectedItems(view);
    }

    private applyProjectedItems(view: CollectionView | undefined): void
    {
        // Internal call that bypasses the "ItemsSource set → Items
        // read-only" guard — refreshItemsFromSource is the only writer
        // here and it owns the projection.
        this._itemsSubscription?.();
        this._itemsSubscription = undefined;
        this._groupDescSubscription?.();
        this._groupDescSubscription = undefined;
        if (view === undefined)
        {
            this.set_property_value(ItemsControl.ItemsKey, undefined);
            this.rebuildContainers();
            return;
        }
        // Watch the view's GroupDescriptions so a runtime add / remove
        // of a description (which toggles IsGrouping) re-picks the
        // projection mode (flat ↔ grouped). The recursive
        // re-application is bounded — applyProjectedItems unsubscribes
        // before re-subscribing.
        this._groupDescSubscription = view.GroupDescriptions.Subscribe(
            () => this.applyProjectedItems(view));
        // Grouped surface: when the consumer has installed a
        // GroupStyle OR a GroupStyleSelector, AND the view is
        // grouping, expose the Groups list as Items so
        // GetContainerForItemOverride sees CollectionViewGroups and
        // wraps each in a GroupItem. Source mutations trigger a full
        // re-snapshot of Groups + rebuild — incremental
        // CollectionChange events on the flat projection don't
        // translate cleanly to group-structural updates.
        const hasGroupSurface = this.GroupStyle !== undefined
                             || this.GroupStyleSelector !== undefined;
        if (hasGroupSurface && view.IsGrouping)
        {
            this.set_property_value(ItemsControl.ItemsKey, view.Groups as readonly unknown[] | undefined);
            this._itemsSubscription = view.Subscribe(() => {
                this.set_property_value(ItemsControl.ItemsKey, view.Groups as readonly unknown[] | undefined);
                this.rebuildContainers();
            });
            this.rebuildContainers();
            return;
        }
        // Flat surface (default).
        this.set_property_value(ItemsControl.ItemsKey, view);
        this._itemsSubscription = view.Subscribe(change => this.handleItemsChange(change));
        this.rebuildContainers();
    }

    // Template get/set are inherited from Control. ItemsControl's own
    // rebuildTemplate override re-hosts the items panel inside the new
    // template's ItemsPresenter (preserving the panel instance and its
    // realized containers across the swap); without a Template the panel
    // is hosted directly under this ItemsControl.

    public get ItemsPanel(): ItemsPanelTemplate | ItemsPanelFactory | undefined
    {
        return this.get_property_value(ItemsControl.ItemsPanelKey);
    }

    // Re-apply the current Template. Carries the existing items panel
    // (and its realized containers) across the swap so re-templating
    // is non-destructive for the items themselves — the items panel
    // is unparented from its old host (presenter or this ItemsControl
    // directly) and re-parented under the new presenter (or restored
    // as a direct child if the new template has no ItemsPresenter or
    // there's no new Template at all).
    protected override rebuildTemplate(): void
    {
        const panel = this._itemsPanel;

        // Detach panel from its current visual parent (old presenter
        // or this control).
        if (panel !== undefined)
        {
            if (this._itemsPresenter !== undefined)
            {
                this._itemsPresenter.SetItemsPanel(undefined);
            }
            else
            {
                this.DetachVisual(panel);
            }
        }

        // Tear down the old template tree. A templated control may
        // re-parent its template root away from itself between Apply
        // and the next rebuild (MenuItem / MenuButton / ContextMenu all
        // detach their popup root in the ctor so the OverlayLayer can
        // adopt it). Only detach when the root is still our child.
        if (this._templateInstance !== undefined)
        {
            const root = this._templateInstance.root;
            if (root['_visualParent'] === this) this.DetachVisual(root);
            this._templateInstance = undefined;
            this._itemsPresenter = undefined;
        }

        // Apply the new template, or revert to direct hosting.
        const tmpl = this.Template;
        if (tmpl !== undefined)
        {
            const instance = tmpl.Apply(this);
            this.AttachVisual(instance.root);
            this._templateInstance = instance;
            this._itemsPresenter = findFirstItemsPresenter(instance.root);

            if (panel !== undefined && this._itemsPresenter !== undefined)
            {
                this._itemsPresenter.SetItemsPanel(panel);
            }
            else if (panel !== undefined)
            {
                // Template doesn't include an ItemsPresenter — the
                // panel is orphaned. Re-host it directly under this
                // control as a fallback so it still renders.
                this.AttachVisual(panel);
            }
        }
        else if (panel !== undefined)
        {
            // No template — direct host.
            this.AttachVisual(panel);
        }

        this.InvalidateMeasure();
    }

    public set ItemsPanel(value: ItemsPanelTemplate | ItemsPanelFactory | undefined)
    {
        // Side effect (panel teardown + materialize + attach) is in
        // OnPropertyChanged so markup writes (compiler-emitted typed-key
        // sets) and binding pushes produce the same effect as this JS
        // setter.
        this.set_property_value(ItemsControl.ItemsPanelKey, value);
    }

    // Teardown half of the ItemsPanel swap: detach all realized
    // containers from the current panel, then unparent the panel
    // itself from wherever it lives visually (inside an
    // ItemsPresenter when a Template is applied; directly under this
    // control otherwise).
    private teardownItemsPanel(): void
    {
        if (this._itemsPanel === undefined) return;
        if (this._itemsPanel instanceof VirtualizingPanel)
        {
            // SetItemsOwner(undefined) calls RecycleAll on the panel,
            // which iterates its realized containers and calls our
            // DetachContainer + generator.Recycle on each. _containers /
            // generator land in clean state.
            this._itemsPanel.SetItemsOwner(undefined);
        }
        else
        {
            // Snapshot before iteration — DetachContainer mutates
            // _containers.
            for (const c of [...this._containers])
            {
                this._itemsPanel.RemoveVisualChild(c);
                this.DetachContainer(c);
            }
            this._generator.Clear();
        }
        if (this._itemsPresenter !== undefined)
        {
            this._itemsPresenter.SetItemsPanel(undefined);
        }
        else
        {
            this.DetachVisual(this._itemsPanel);
        }
        this._itemsPanel = undefined;
    }

    // Materialize-and-attach half of the ItemsPanel swap: invoke the
    // factory (or ItemsPanelTemplate.Apply) to produce the panel
    // instance, attach it to either the ItemsPresenter slot or
    // directly under this control, and either kick off rebuildContainers
    // (plain panel) or hand the panel a back-pointer (virtualizing).
    private materializeItemsPanel(value: ItemsPanelTemplate | ItemsPanelFactory): void
    {
        this._itemsPanel = value instanceof ItemsPanelTemplate
            ? value.Apply()
            : value();
        if (this._itemsPresenter !== undefined)
        {
            this._itemsPresenter.SetItemsPanel(this._itemsPanel);
        }
        else
        {
            this.AttachVisual(this._itemsPanel);
        }
        if (this._itemsPanel instanceof VirtualizingPanel)
        {
            this._itemsPanel.SetItemsOwner(this);
        }
        else
        {
            this.rebuildContainers();
        }
    }

    public override get visualChildren(): readonly Visual[]
    {
        // With a Template applied the visual subtree is rooted at the
        // template's root (which contains the ItemsPresenter, which
        // contains the items panel). Without a template the items
        // panel is our direct visual child.
        if (this._templateInstance !== undefined) return [this._templateInstance.root];
        return this._itemsPanel !== undefined ? [this._itemsPanel] : [];
    }

    // Containers are logical children of the ItemsControl — so
    // DataContext / inheritable properties set here flow to them,
    // not through the items panel.
    public override get logicalChildren(): readonly Visual[]
    {
        return this._containers;
    }

    // Inheritance into the containers (logical children) and the items
    // panel / template root (visual children) is handled generically by
    // Element.forEachInheritanceChild — no per-control bridge.

    // Target propagation rides the visual tree, so it hops to either
    // the template root (which contains the items panel as a
    // descendant) or to the items panel directly when no template
    // is applied.
    protected override propagate_target_to_visual_children(): void
    {
        const root = this._templateInstance?.root ?? this._itemsPanel;
        root?.['SetTarget'](this['target']);
    }

    protected override MeasureOverride(availableSize: Size): Size
    {
        const root = this._templateInstance?.root ?? this._itemsPanel;
        if (root === undefined) return Size.Zero;
        root.Measure(availableSize);
        return root.DesiredSize;
    }

    protected override ArrangeOverride(finalSize: Size): Size
    {
        const root = this._templateInstance?.root ?? this._itemsPanel;
        if (root === undefined) return Size.Zero;
        root.Arrange(new Rect(0, 0, finalSize.Width, finalSize.Height));
        return finalSize;
    }

    // Nothing to paint at the ItemsControl level — the items panel and
    // its children produce the output.
    protected override RenderOverride(_dc: DrawingContext): void { }

    // Tears down current containers and re-materializes from the
    // current Items + ItemTemplate. Called from Items / ItemTemplate /
    // ItemsPanel / ItemsSource setters as the bulk initial-load path.
    // Per-mutation updates from an ObservableCollection go through
    // handleItemsChange instead, which only touches affected slots.
    // ── Realization gate (popup-hosted subclasses) ──────────────────────
    // Whether item containers should be built now. Default: always (ordinary
    // ItemsControls are unaffected). A subclass whose items live in a CLOSED
    // popup (e.g. ToolBarSplitButton) overrides this to return false while
    // closed, then calls flushDeferredRealization() when it opens — so a
    // toolbar of split buttons doesn't eagerly build hundreds of dropdown
    // MenuItems that are never seen. When it returns false, rebuildContainers /
    // handleItemsChange skip work and remember it as pending.
    private _realizationDeferred = false;

    protected shouldRealizeContainers(): boolean { return true; }

    // Replay a deferred realization: build the containers now against the
    // CURRENT items. Called by a subclass once its items become visible.
    protected flushDeferredRealization(): void
    {
        if (!this._realizationDeferred) return;
        this._realizationDeferred = false;
        this.rebuildContainers();
    }

    private rebuildContainers(): void
    {
        // Popup subclass hasn't opened yet — remember the pending build and bail.
        if (!this.shouldRealizeContainers())
        {
            this._realizationDeferred = true;
            return;
        }
        if (this._itemsPanel instanceof VirtualizingPanel)
        {
            // A virtualizing panel owns its own realized-container set
            // (not mirrored in _containers the way the non-virtual path
            // below assumes). Drop that set in lockstep with the
            // generator Clear() right below — otherwise the stale
            // realized entries outlive the cleared mappings and desync
            // (rows shown twice, then a later "not a logical child"
            // throw when the sweep double-detaches). See
            // VirtualizingPanel.ResetRealization.
            this._itemsPanel.ResetRealization();
        }
        else if (this._itemsPanel !== undefined)
        {
            // Snapshot first — DetachContainer mutates _containers.
            for (const c of [...this._containers])
            {
                const item = this._generator.ItemFromContainer(c);
                this.ClearContainerForItemOverride(c, item);
                this._itemsPanel.RemoveVisualChild(c);
                this.DetachContainer(c);
            }
        }
        // Wipe the generator's item ↔ container mappings so the next
        // Realize calls produce fresh containers (with whatever the
        // current ItemTemplate / Selector / GetContainer is).
        this._generator.Clear();

        const items = this.Items;
        // The rebuild bails only when the panel is missing or items
        // collection is empty/undefined. Per-item resolution lives in
        // GetContainerForItemOverride + ContentPresenter — even without
        // an ItemTemplate / Selector / DisplayMemberPath, the default
        // ContentPresenter wrap walks the resource chain via
        // findDataTemplateForType(item.constructor) and falls through to
        // text-stringify when no match exists. So an item always has
        // *some* container shape; gating on the resolver here would
        // wrongly suppress the implicit-DataTemplate path.
        if (items === undefined || this._itemsPanel === undefined)
        {
            this.updateHasItems();
            return;
        }
        // VirtualizingPanel owns its own realization; rebuildContainers
        // just clears state and bails. The panel will pick up the
        // new items on its next measure pass.
        if (this._itemsPanel instanceof VirtualizingPanel)
        {
            this._itemsPanel.InvalidateMeasure();
            this.updateHasItems();
            return;
        }

        // Walk Items through the WPF-style session API. Each
        // GenerateNext realizes the next container (fresh or pooled);
        // we wire newly-realized ones into the panel and pass every
        // one through generator.PrepareItemContainer, which routes to
        // PrepareContainerForItemOverride with the right (item, index).
        const count   = this.ItemCount();
        const session = this._generator.StartAt(GeneratorPosition.StartOfList);
        try
        {
            for (let i = 0; i < count; i++)
            {
                const { container, isNewlyRealized } = session.GenerateNext();
                if (container === undefined) break;
                if (isNewlyRealized)
                {
                    // The container may be a SHARED / own-container Visual (a
                    // Diagram's items ARE their Figures) still parented to a
                    // now-discarded prior view — e.g. the same document's canvas
                    // presented in an earlier tab whose Diagram the content host
                    // detached wholesale without a container teardown. Claim it
                    // from that stale parent in BOTH trees before re-homing, or the
                    // single-parent guards throw ("Visual already has a visual
                    // parent" on AddVisualChild, then "Element already has a logical
                    // parent" on AttachContainer→AttachLogical). Mirrors
                    // ContentPresenter.SetContent's shared-Visual reclaim.
                    container._release_from_visual_parent();
                    container._release_from_logical_parent();
                    this._itemsPanel.AddVisualChild(container);
                    this.AttachContainer(container);
                }
                this._generator.PrepareItemContainer(container);
            }
        }
        finally
        {
            session.dispose();
        }
        this.updateHasItems();
        this.InvalidateMeasure();
    }

    // Incremental update path for ObservableCollection mutations on
    // Items. Dispatches by change.kind; each branch touches only the
    // affected slot(s) rather than rebuilding the whole panel.
    //
    // Index semantics: `inserted` / `removed` / `replaced` indices
    // are in the items collection's space, which the _containers
    // array mirrors 1:1, so the same index is used for both arrays
    // and for InsertVisualChild on the items panel.
    private handleItemsChange(change: CollectionChange<unknown>): void
    {
        // Popup subclass still closed — remember the mutation; the eventual
        // flushDeferredRealization() rebuilds against the current collection.
        if (!this.shouldRealizeContainers())
        {
            this._realizationDeferred = true;
            return;
        }
        if (this._itemsPanel === undefined)
        {
            // No panel — nothing to mirror. _containers stays empty;
            // when ItemsPanel lands, the setter triggers
            // rebuildContainers which catches up.
            this.updateHasItems();
            return;
        }
        // No resolver guard here — `GetContainerForItemOverride` +
        // `ContentPresenter.resolveAndSlot` always produce some container
        // shape (matching DataTemplate via findDataTemplateForType, or
        // stringified text as a final fallback). The base ItemsControl
        // can therefore dispatch inserts purely by item.constructor
        // identity through the resource chain — no explicit ItemTemplate
        // / Selector / DisplayMemberPath required.
        if (this._itemsPanel instanceof VirtualizingPanel)
        {
            // Virtualizing panel owns its own realization; just
            // forward the change so it can re-resolve viewport.
            this._itemsPanel.OnItemsChanged(change);
            return;
        }
        const panel = this._itemsPanel;

        // Whether this batch shifts indices for the AlternationIndex
        // re-stamp. Inserts/removes/clears shift; replaced does not.
        let restampFrom: number | undefined = undefined;

        // Translate CollectionChange → ItemsChangedArgs (the WPF
        // event shape) so observers see one signal regardless of who
        // mutated. Fired AFTER local container bookkeeping is up to
        // date so listeners see a coherent generator state.
        let changeArgs: ItemsChangedArgs | undefined;

        switch (change.kind)
        {
            case 'inserted':
            {
                // change.items is the slice that was inserted; for
                // each, generate a container and splice it in. Shift
                // the generator's index map UP FIRST so the new slots
                // (change.index..change.index+N-1) are free, then
                // realize the new items into those slots.
                this._generator.ShiftIndicesFrom(change.index, change.items.length);
                for (let i = 0; i < change.items.length; i++)
                {
                    const item      = change.items[i]!;
                    const at        = change.index + i;
                    const container = this._generator.Realize(item, at);
                    panel.InsertVisualChild(at, container);
                    this.InsertContainer(at, container);
                    this._generator.PrepareItemContainer(container);
                }
                restampFrom = change.index + change.items.length;
                changeArgs = {
                    Action:      ItemsChangedAction.Add,
                    Position:    new GeneratorPosition(change.index, 0),
                    OldPosition: undefined,
                    ItemCount:   change.items.length,
                    ItemUICount: change.items.length,
                };
                break;
            }
            case 'removed':
            {
                // Each removal compacts the array; the index stays
                // the same for subsequent items in the same batch
                // (so removing N consecutive items means removing
                // index k N times). After all removals shift the
                // generator's index map DOWN by N for everything past
                // the removed slot.
                const removedCount = change.items.length;
                for (let i = 0; i < removedCount; i++)
                {
                    const container = this._containers[change.index];
                    if (container === undefined) continue;
                    const item = this._generator.ItemFromContainer(container);
                    this.ClearContainerForItemOverride(container, item);
                    panel.RemoveVisualChild(container);
                    this.DetachContainer(container);
                    this._generator.Recycle(container);
                }
                this._generator.ShiftIndicesFrom(change.index + removedCount, -removedCount);
                restampFrom = change.index;
                changeArgs = {
                    Action:      ItemsChangedAction.Remove,
                    Position:    new GeneratorPosition(change.index, 0),
                    OldPosition: undefined,
                    ItemCount:   removedCount,
                    ItemUICount: removedCount,
                };
                break;
            }
            case 'replaced':
            {
                const old = this._containers[change.index];
                if (old !== undefined)
                {
                    const oldItem = this._generator.ItemFromContainer(old);
                    this.ClearContainerForItemOverride(old, oldItem);
                    panel.RemoveVisualChild(old);
                    this.DetachContainer(old);
                    this._generator.Recycle(old);
                }
                const fresh = this._generator.Realize(change.newItem, change.index);
                panel.InsertVisualChild(change.index, fresh);
                this.InsertContainer(change.index, fresh);
                this._generator.PrepareItemContainer(fresh);
                changeArgs = {
                    Action:      ItemsChangedAction.Replace,
                    Position:    new GeneratorPosition(change.index, 0),
                    OldPosition: undefined,
                    ItemCount:   1,
                    ItemUICount: 1,
                };
                break;
            }
            case 'moved':
            {
                // Item identity is preserved across a move — find the
                // already-realized container, re-slot it in the items
                // panel + _containers, and shift the generator's index
                // map. No Realize / PrepareItemContainer needed; the
                // container's already prepared.
                const container = this._containers[change.oldIndex];
                if (container !== undefined)
                {
                    panel.RemoveVisualChild(container);
                    // _containers is the source of truth for
                    // logicalChildren; mutate the array directly to
                    // skip the Attach/DetachLogical round-trip (logical
                    // parent is unchanged).
                    this._containers.splice(change.oldIndex, 1);
                    this._containers.splice(change.newIndex, 0, container);
                    panel.InsertVisualChild(change.newIndex, container);
                    // Update the generator's index map: clear the old
                    // (oldIndex, container) entry, shift everything
                    // between old and new, then re-register the
                    // container at newIndex.
                    this._generator['indexToContainer'].delete(change.oldIndex);
                    this._generator['containerToIndex'].delete(container);
                    if (change.oldIndex < change.newIndex)
                    {
                        // Move-down: items (oldIndex+1..newIndex)
                        // shift to (oldIndex..newIndex-1).
                        this._generator.ShiftIndicesFrom(change.oldIndex + 1, -1);
                        // But only up to newIndex — items past that
                        // weren't affected. ShiftIndicesFrom shifts
                        // EVERYTHING from the index; correct by
                        // re-shifting items past newIndex back up.
                        this._generator.ShiftIndicesFrom(change.newIndex, 1);
                    }
                    else
                    {
                        // Move-up: items (newIndex..oldIndex-1)
                        // shift to (newIndex+1..oldIndex).
                        this._generator.ShiftIndicesFrom(change.newIndex, 1);
                        // Don't double-shift items past oldIndex.
                        this._generator.ShiftIndicesFrom(change.oldIndex + 1, -1);
                    }
                    this._generator['indexToContainer'].set(change.newIndex, container);
                    this._generator['containerToIndex'].set(container, change.newIndex);
                }
                // Alternation indices shift for everything between the
                // two endpoints.
                restampFrom = Math.min(change.oldIndex, change.newIndex);
                changeArgs = {
                    Action:      ItemsChangedAction.Move,
                    Position:    new GeneratorPosition(change.newIndex, 0),
                    OldPosition: new GeneratorPosition(change.oldIndex, 0),
                    ItemCount:   1,
                    ItemUICount: container !== undefined ? 1 : 0,
                };
                break;
            }
            case 'cleared':
            {
                // Snapshot first — DetachContainer mutates _containers.
                for (const c of [...this._containers])
                {
                    const item = this._generator.ItemFromContainer(c);
                    this.ClearContainerForItemOverride(c, item);
                    panel.RemoveVisualChild(c);
                    this.DetachContainer(c);
                }
                this._generator.Clear();
                changeArgs = {
                    Action:      ItemsChangedAction.Reset,
                    Position:    GeneratorPosition.StartOfList,
                    OldPosition: undefined,
                    ItemCount:   0,
                    ItemUICount: 0,
                };
                break;
            }
            case 'reset':
            {
                // Wholesale change (an ObservableCollection.Batch, or a
                // CollectionView re-projection). Rebuild from current contents
                // in one pass — rebuildContainers does its own teardown,
                // updateHasItems, and single InvalidateMeasure, so return here
                // rather than falling through to the incremental tail (which
                // assumes an incremental changeArgs / restamp).
                this.rebuildContainers();
                return;
            }
        }
        if (changeArgs !== undefined)
        {
            this._generator.RaiseItemsChanged(changeArgs);
        }
        // Re-stamp alternation indices on every container at-or-after
        // the disturbed slot. Skipped when AlternationCount = 0
        // (nothing to rotate). Replaced doesn't shift indices, so
        // restampFrom stays undefined for it.
        if (restampFrom !== undefined && this.AlternationCount > 0)
        {
            for (let i = restampFrom; i < this._containers.length; i++)
            {
                ItemsControl.SetAlternationIndex(this._containers[i]!, this.computeAlternationIndex(i));
            }
        }
        this.updateHasItems();
        this.InvalidateMeasure();
    }
}

// Depth-first search for the first ItemsPresenter in a template's
// visual subtree. Mirrors findFirstContentPresenter in
// control-template.ts. "First one wins" matches WPF — a template with
// multiple presenters is unusual; the documented surface is one slot.
function findFirstItemsPresenter(visual: Visual): ItemsPresenter | undefined
{
    if (visual instanceof ItemsPresenter) return visual;
    for (const child of visual.visualChildren)
    {
        const found = findFirstItemsPresenter(child);
        if (found !== undefined) return found;
    }
    return undefined;
}

// Structural type used by PrepareContainerForItemOverride to stash
// the item on the container without registering a DP. Subclasses
// that want trigger / binding visibility on the item can read the
// item via Generator.ItemFromContainer instead.
interface ContainerWithData
{
    _itemsControlData?: unknown;
}

// Lazy CollectionView factory — defers the import so module-load order
// (items-control before collection-view) doesn't cycle. Wraps source
// data in a fresh CollectionView; an already-wrapped CollectionView
// passes through unchanged so view-state (sort / filter / current)
// survives ItemsSource reassignment to the same view instance.
//
// The require() pattern avoids the cycle without forcing the typed
// surface to lose precision — TypeScript sees CollectionView via the
// top-of-file `import type`; at runtime we resolve through a tiny
// indirection that's set on first use.
let _collectionViewCtor: (new (source: unknown) => CollectionView) | undefined;

function createCollectionView(src: unknown): CollectionView
{
    // CollectionView pass-through: instanceof check uses the cached
    // ctor when one is available — pre-CV-load we can't instanceof
    // it, so the first call always falls into the load path which
    // populates _collectionViewCtor and lets later calls skip the
    // round-trip.
    if (_collectionViewCtor !== undefined && src instanceof _collectionViewCtor) return src as unknown as CollectionView;
    if (_collectionViewCtor === undefined)
    {
        // Synchronous require would be ideal but ESM doesn't have one;
        // resolve through a global the consumer wires (see
        // ItemsControl.RegisterCollectionViewCtor below) so we don't
        // bake the path here. If unset, fall back to a passthrough
        // facade — the caller still gets iteration / Subscribe
        // semantics enough for the non-Tier-3 cases.
        throw new Error(
            'ItemsControl.ItemsSource: CollectionView not registered. ' +
            'Import mural/basic (the barrel) before assigning ItemsSource — ' +
            'collection-view.ts registers itself with ItemsControl on load.',
        );
    }
    return new _collectionViewCtor(src);
}

// Internal hook used by collection-view.ts to register its ctor
// without creating a static circular import. Not part of the public
// API; consumers don't call this.
export function _registerCollectionViewCtor(ctor: new (source: unknown) => CollectionView): void
{
    _collectionViewCtor = ctor;
}
