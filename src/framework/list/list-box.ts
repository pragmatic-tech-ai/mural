import {
    MetaData,
    MuralBase,
    Element, Visual,
    type PointerEventArgs,
    type PropertyDescriptor,
} from '../../runtime/index.js';
import { ContentControl } from '../base/content-control.js';
import { Border } from '../../basic/border.js';
import { findDataTemplateForType } from '../../basic/templates/data-template.js';
import { DataTemplateSelector } from '../../basic/templates/data-template-selector.js';
import { Selector } from './selector.js';
import { StackPanel } from '../../basic/panels/stack-panel.js';
import { Orientation } from '../../basic/panels/orientation.js';
import { ScrollViewer } from '../surfaces/scroll-viewer.js';
import { TextBlock } from '../../basic/text-block.js';

// SelectionMode is now owned by Selector and re-exported here so
// existing `import { SelectionMode } from './list-box.js'` consumers
// (and matching markup imports) keep working.
export { SelectionMode } from './selector.js';

// Display-string convention shared with ComboBox: strings pass through,
// objects with a conventional Label / Name / Text field prefer the named
// property, everything else falls through to String(). Lets a consumer
// pass a plain `Items=["Apples","Pears"]` array without authoring a
// matching ItemTemplate.
function displayString(item: unknown): string
{
    if (item === undefined || item === null) return '';
    if (typeof item === 'string') return item;
    if (typeof item === 'object')
    {
        const obj = item as Record<string, unknown>;
        if (typeof obj.Label === 'string') return obj.Label;
        if (typeof obj.Name  === 'string') return obj.Name;
        if (typeof obj.Text  === 'string') return obj.Text;
    }
    return String(item);
}

// WPF-style flat-list selector built on ItemsControl. Two authoring
// paths converge on the same Items collection:
//
//   1. Composed markup — consumers nest ListBoxItems by hand. Each
//      item's Content can be any Visual. Compiler emits AddChild for
//      each body element; ListBox routes those into Items so the row
//      becomes a tracked container indistinguishable from a data-
//      generated one:
//
//        ListBox {
//            ListBoxItem { TextBlock[Text="Apples"]  }
//            ListBoxItem { TextBlock[Text="Bananas"] }
//        }
//
//   2. Data-driven — assign `Items = unknown[]` (or set ItemsSource
//      to bind to a CollectionView). ListBox auto-wraps each value in
//      a ListBoxItem via GetContainerForItemOverride; the wrapper's
//      Tag carries the source value so SelectedItem returns the data,
//      not the container:
//
//        ListBox [ Items = $fruits ]
//
// Behaviour change vs the pre-ItemsControl era: setting Items now
// REPLACES the entire collection — including any declarative children.
// WPF parity. Authors that want a mix should add the data items via
// `lb.Items.Add(value)` instead of clearing-and-replacing.
//
// Selection semantics depend on SelectionMode (Single / Multiple /
// Extended) — promoted to Selector, so the modifier interpretation,
// _selectedContainers / _selectedData bookkeeping, _anchor, and
// HandleContainerClick all live on the base. ListBox is left with the
// container-prep / Tag-based identity / declarative-child routing glue.
export class ListBox extends Selector
{
    static
    {
        MuralBase.OverrideMetadata(ListBox, Element.DefaultStyleKeyKey, { default_value: ListBox });
    }

    // Cached after first template apply — the lookup walks the
    // template instance once; subsequent reads return the cached ref.
    private _scrollViewer: ScrollViewer | undefined;

    constructor()
    {
        super();
        // Template + items panel are the two halves of an ItemsControl.
        // Template (the surrounding ScrollViewer + ItemsPresenter chrome)
        // flows from the default Style: DefaultStyleKey on this class
        // names ListBox itself, so the bundled controls theme entry under
        // that key applies via the applyDefaultStyle() call below. The
        // items panel stays local because it's part of the demo-author's
        // surface (overridable via the ItemsPanel DP); the default
        // factory here is the vertical StackPanel WPF parity expects.
        this.ItemsPanel = () => new StackPanel();
        this.applyDefaultStyle();
    }

    // Compiler routes `ListBox { ListBoxItem … }` body elements through
    // ItemsControl.AddChild → Items. We only need to gate on the
    // container type — base does the rest of the routing,
    // promote-to-observable, and the IsItemItsOwnContainerOverride
    // pass-through (so a pre-built ListBoxItem isn't re-wrapped).
    protected override validateDeclarativeChild(child: Visual): void
    {
        if (!(child instanceof ListBoxItem))
        {
            throw new Error('ListBox only accepts ListBoxItem children');
        }
    }

    // ── ItemsControl override seams ────────────────────────────────

    public override IsItemItsOwnContainerOverride(item: unknown): boolean
    {
        return item instanceof ListBoxItem;
    }

    public override GetContainerForItemOverride(item: unknown): Visual
    {
        // Pass-through for composed markup is handled by the generator
        // via IsItemItsOwnContainerOverride; here we're always on the
        // data-driven path. WPF parity:
        //   * Tag = item — SelectedItem reads return the data, not
        //     the ListBoxItem.
        //   * DataContext = item — bindings on the container (from
        //     ItemContainerStyle setters) resolve against the item, so
        //     `IsDraggable=true; OnDragStart=$BeginDragData` finds the
        //     per-row VM's DPs rather than the parent VM's. Matches
        //     ContentPresenter behavior in ItemsControl.
        //   * Content routing:
        //       MuralBase with a registered DataTemplate → li.Content = item
        //         (ContentControl.resolveContentVisual finds the template
        //         and applies it). This is the ItemTemplate-driven path.
        //       everything else → wrap in TextBlock(displayString(item))
        //         so plain `Items=["Apple","Pear"]` and untemplated Models
        //         still render something.
        const li = new ListBoxItem();
        this.bindContainerData(li, item);
        return li;
    }

    public override RebindContainerForItemOverride(container: Visual, item: unknown): void
    {
        // Reused ListBoxItem (from the generator's recycle pool) — flip
        // Tag / DataContext / Content so the row reflects the new data.
        // The Selector base's RebindContainerForItemOverride re-syncs
        // IsSelected against _selectedData AFTER this binds the new Tag.
        if (container instanceof ListBoxItem)
        {
            this.bindContainerData(container, item);
        }
        super.RebindContainerForItemOverride(container, item);
    }

    // Wire a freshly-created OR recycled ListBoxItem to its data row.
    // Selection sync is handled by the Selector base's recycle hooks via
    // syncContainerSelectionFromData — this method just updates the
    // data-binding fields.
    private bindContainerData(li: ListBoxItem, item: unknown): void
    {
        li.Tag         = item;
        li.DataContext = item;
        li.Content     = this.contentForItem(item);
    }

    private contentForItem(item: unknown): Visual | MuralBase
    {
        // A Visual item is shown directly — WPF parity: a UIElement item
        // bypasses templating (ItemTemplate applies to DATA only).
        if (item instanceof Visual) return item;

        // ItemTemplate (or the per-item Selector) wins — mirror the base
        // ItemsControl.GetContainerForItemOverride precedence
        // (Selector → ItemTemplate → …). ListBoxItem is a ContentControl
        // with no ContentTemplate seam, so apply the template here and
        // hand the produced Visual over as Content (which slots directly).
        // Skipping this made a MuralBase row with a registered
        // `DataTemplate[T]` in scope IGNORE an explicit ItemTemplate and
        // materialize T's template instead — e.g. a document tab strip
        // (ItemTemplate = a title+close row) rendered each open
        // DiagramDocument as a whole Diagram, double-attaching the doc's
        // node Figures the content region already hosts (throw on attach).
        const tmpl = DataTemplateSelector.resolve(this.ItemTemplateSelector, item, this) ?? this.ItemTemplate;
        if (tmpl !== undefined)
        {
            const v = tmpl.Apply(item);
            v.DataContext = item;
            return v;
        }

        // No ItemTemplate — implicit DataType dispatch for a MuralBase with a
        // registered DataTemplate, else the display-string text fallback.
        if (item instanceof MuralBase
            && findDataTemplateForType(item.constructor, this) !== undefined)
        {
            return item;
        }
        return new TextBlock(displayString(item));
    }

    // Snapshot of all materialized ListBoxItem containers, in items
    // order. Index space for SelectedIndex and Shift+click range
    // selection.
    public get ItemContainers(): readonly ListBoxItem[]
    {
        // logicalChildren on ItemsControl is the realized containers
        // list. All entries are ListBoxItems by our override; the
        // cast is safe.
        return this.logicalChildren as readonly ListBoxItem[];
    }

    // Read-only handle to the default-template ScrollViewer. Resolved
    // lazily on first access — the template subtree is available
    // after the constructor's Template assignment.
    public get ScrollViewer(): ScrollViewer
    {
        if (this._scrollViewer !== undefined) return this._scrollViewer;
        const root = this.visualChildren[0];
        if (root === undefined)
        {
            throw new Error('ListBox: template root not attached yet.');
        }
        const sv = root.FindName('PART_Scroll');
        if (!(sv instanceof ScrollViewer))
        {
            throw new Error('ListBox: PART_Scroll missing from DefaultListBox template.');
        }
        this._scrollViewer = sv;
        return sv;
    }

    // ── Selector override seams ────────────────────────────────────

    // ListBox's selection model is per-container — each ListBoxItem
    // carries a Tag with the source data, or stands in for itself in
    // the declarative path. Override the base seams so the cross-sync
    // and apply* paths resolve through containers instead of the raw
    // Items collection (which would miss declarative-child rows).

    protected override resolveItemAt(index: number): unknown
    {
        const containers = this.ItemContainers;
        if (index < 0 || index >= containers.length) return undefined;
        return this.exposedValueOf(containers[index]!);
    }

    protected override resolveIndexOf(item: unknown): number
    {
        if (item === undefined) return -1;
        const containers = this.ItemContainers;
        for (let i = 0; i < containers.length; i++)
        {
            const li = containers[i]!;
            if (li.Tag === item || li === item) return i;
        }
        return -1;
    }

    protected override containerForItem(item: unknown): Visual | undefined
    {
        if (item === undefined) return undefined;
        // Walk realized containers and match Tag identity. Falls back
        // to the container itself for composed-markup rows where the
        // consumer treats the ListBoxItem as the "data".
        for (const c of this.ItemContainers)
        {
            if (c.Tag === item || c === item) return c;
        }
        return undefined;
    }

    protected override getPrimaryIndex(container: Visual): number
    {
        // ListBox's index space is the realized containers in items
        // order — covers both declarative and data-driven paths
        // uniformly (Generator.IndexFromContainer would miss
        // composed-markup rows).
        return this.ItemContainers.indexOf(container as ListBoxItem);
    }
}

// One row in the list. Authored in markup, instantiated either by the
// consumer (declarative `ListBox { ListBoxItem { … } }`) or by the
// owning ListBox (data-driven path — see ListBox.GetContainerForItemOverride).
//
// Public DPs:
//   Content    — inherited from ContentControl. The slottable body
//                rendered inside the row's template.
//   IsSelected — true when this row participates in the ListBox's
//                current selection. Read-mostly. The canonical
//                seam is `Selector.IsSelected` (attached) — this
//                instance DP forwards reads/writes to it AND mirrors
//                attached-DP changes so the template's
//                `when (IsSelected)` trigger fires on either path.
//                Settable from consumer code to initialise a default
//                selection.
//   Tag        — opaque payload. The data-driven path stores the
//                source value here; ListBox.SelectedItem reads it
//                back so external bindings see the source data
//                instead of the container.
//
// Click handling: press-here-release-here gate; on release the event
// walks logical parents to find the owning Selector and routes
// HandleContainerClick with the originating PointerEventArgs.Modifiers.
export class ListBoxItem extends ContentControl
{
    // Instance-level IsSelected mirror — provides the trigger-observable
    // DP that templates watch via `when (IsSelected)`. Source of truth
    // is `Selector.IsSelected` (attached); this DP is kept in lock-step
    // by an attached-DP change listener wired in the constructor.
    public static readonly IsSelectedKey = MuralBase.RegisterProperty<boolean>(
        ListBoxItem, 'IsSelected', false, MetaData.Render);

    // M3 list-row anatomy slots. `Content` (from ContentControl) hosts
    // the headline — its current data-driven usage is preserved
    // unchanged. Leading and Trailing carry a Visual into the optional
    // 24dp icon / avatar / checkbox slots flanking the headline.
    // SupportingText surfaces the optional caption line below the
    // headline: empty (the default) keeps the row at the 1-line
    // height; a non-empty string flips to 2-line; a value containing
    // an explicit newline ('\n') flips to 3-line. Auto-computed from
    // content rather than gated on a separate Lines enum — keeps the
    // API surface narrow.
    public static readonly LeadingKey = MuralBase.RegisterProperty<Visual | undefined>(
        ListBoxItem, 'Leading', undefined, MetaData.Render);
    public static readonly SupportingTextKey = MuralBase.RegisterProperty<string>(
        ListBoxItem, 'SupportingText', '', MetaData.Render);
    public static readonly TrailingKey = MuralBase.RegisterProperty<Visual | undefined>(
        ListBoxItem, 'Trailing', undefined, MetaData.Render);

    // Derived state DPs the template observes via `when()` triggers to
    // pick the right row-height variant. Computed in OnPropertyChanged
    // off SupportingText so the template's height triggers don't have
    // to express "is supporting text non-empty" through the trigger
    // DSL (which doesn't carry an "!=" form today). Read-only — only
    // the class writes them.
    private static readonly _HasSupportingTextPriv = MuralBase.RegisterReadOnlyProperty<boolean>(
        ListBoxItem, 'HasSupportingText', false, MetaData.None);
    public static readonly HasSupportingTextKey = ListBoxItem._HasSupportingTextPriv;
    private static readonly _IsThreeLinePriv = MuralBase.RegisterReadOnlyProperty<boolean>(
        ListBoxItem, 'IsThreeLine', false, MetaData.None);
    public static readonly IsThreeLineKey = ListBoxItem._IsThreeLinePriv;

    static
    {
        MuralBase.OverrideMetadata(ListBoxItem, Element.DefaultStyleKeyKey, { default_value: ListBoxItem });
    }

    private _pressOriginatedHere = false;
    private _syncingIsSelected = false;
    private _leadingSlot:  Border    | undefined;
    private _trailingSlot: Border    | undefined;
    private _supportText:  TextBlock | undefined;

    constructor(content?: Visual)
    {
        super();
        // Template flows from the default Style (DefaultStyleKey on
        // this class names ListBoxItem itself). IsSelected /
        // IsMouseOver → PART_Border.Fill ride along declaratively
        // on `when()` triggers in the bundled template (see
        // controls.template.mu, ListBoxItem block).
        if (content !== undefined) this.Content = content;
        // Focusable so keyboard navigation (§ 10.8) can land focus on
        // a clicked or arrow-navigated row. The Selector's OnKeyDown
        // handler reads ListBoxItem focus state to compute where the
        // next arrow press should land.
        this.Focusable = true;
        this.applyDefaultStyle();
        this.adoptTemplateParts();
        this.syncAnatomySlots();
    }

    private adoptTemplateParts(): void
    {
        // Leading / Trailing slots are plain Borders (not
        // ContentPresenters) so findFirstContentPresenter walks past
        // them and resolves ContentControl's contentPresenter to the
        // headline slot. The class hosts the Leading / Trailing
        // Visuals via SetChild instead.
        this._leadingSlot  = this.GetTemplateChild('PART_LeadingSlot')  as Border    | undefined;
        this._trailingSlot = this.GetTemplateChild('PART_TrailingSlot') as Border    | undefined;
        this._supportText  = this.GetTemplateChild('PART_SupportingText') as TextBlock | undefined;
    }

    // Push the current DP values through to the template parts. Runs
    // at construction, on each Template swap, and on each anatomy-DP
    // change. Idempotent — calling repeatedly with unchanged DPs is a
    // no-op on the underlying SetChild / Text writes.
    private syncAnatomySlots(): void
    {
        this._leadingSlot?.SetChild(this.Leading);
        this._trailingSlot?.SetChild(this.Trailing);
        if (this._supportText !== undefined)
        {
            this._supportText.Text = this.SupportingText;
        }
    }

    public get Leading(): Visual | undefined { return this.get_property_value(ListBoxItem.LeadingKey); }
    public set Leading(v: Visual | undefined) { this.set_property_value(ListBoxItem.LeadingKey, v); }

    public get SupportingText(): string { return this.get_property_value(ListBoxItem.SupportingTextKey); }
    public set SupportingText(v: string) { this.set_property_value(ListBoxItem.SupportingTextKey, v); }

    public get Trailing(): Visual | undefined { return this.get_property_value(ListBoxItem.TrailingKey); }
    public set Trailing(v: Visual | undefined) { this.set_property_value(ListBoxItem.TrailingKey, v); }

    public get HasSupportingText(): boolean { return this.get_property_value(ListBoxItem.HasSupportingTextKey); }
    public get IsThreeLine():       boolean { return this.get_property_value(ListBoxItem.IsThreeLineKey); }

    public get IsSelected(): boolean { return Selector.GetIsSelected(this); }
    public set IsSelected(v: boolean) { Selector.SetIsSelected(this, v); }

    // Setter exposed for backwards compatibility — earlier code paths
    // wrote IsSelected via this method to bypass HandleItemClick.
    // The attached DP is the canonical seam; this just forwards.
    public SetIsSelectedInternal(v: boolean): void
    {
        Selector.SetIsSelected(this, v);
    }

    // IsPressed lifecycle mirrors Button's WPF-parity rules so the M3
    // state-layer ladder fires for list rows. Down → IsPressed=true;
    // dragging off the row (Leave while pressed) clears it; dragging
    // back on with the pointer still pressed re-asserts it (handled in
    // OnPointerEnter below); Up always clears. IsPressed is cleared
    // BEFORE the Selector click so a click handler that reads IsPressed
    // sees the post-release state — same convention Button uses.
    protected override OnPointerDown(_args: PointerEventArgs): void
    {
        this._pressOriginatedHere = true;
        this._setIsPressed(true);
    }

    protected override OnPointerUp(args: PointerEventArgs): void
    {
        const fire = this._pressOriginatedHere && this.IsMouseOver;
        this._pressOriginatedHere = false;
        this._setIsPressed(false);
        if (!fire) return;
        // Move keyboard focus to the clicked row so subsequent arrow
        // keys navigate from here (§ 10.8).
        args.SetFocus(this);
        const lb = Selector.FromContainer<Selector>(
            this, (v: Visual): v is Selector => v instanceof Selector);
        if (lb !== undefined) lb.HandleContainerClick(this, args.Modifiers);
    }

    protected override OnPointerLeave(_args: PointerEventArgs): void
    {
        // Leave while still pressed: clear the visual cue but keep
        // _pressOriginatedHere — a re-entry restores IsPressed and the
        // press-here-release-here gate stays armed.
        this._setIsPressed(false);
    }

    protected override OnPointerEnter(_args: PointerEventArgs): void
    {
        // Re-entering with the press still in flight restores the
        // pressed visual cue. _pressOriginatedHere is the single source
        // of truth for "press started on this row and is still active"
        // — Down sets it, Up clears it; Leave doesn't touch it, so a
        // re-Enter while it's still true means the press never ended.
        if (this._pressOriginatedHere)
        {
            this._setIsPressed(true);
        }
    }

    // OnPropertyChanged handles three classes of routes:
    //   * IsSelected ⇄ Selector.IsSelected two-way mirror (the
    //     attached DP is the canonical seam; the instance DP is what
    //     trigger DSL `when (IsSelected)` observes).
    //   * Anatomy slot syncs — Leading / Trailing flow into the
    //     PART_LeadingSlot / PART_TrailingSlot Borders' Child; the
    //     SupportingText flows into PART_SupportingText.Text; and the
    //     derived HasSupportingText / IsThreeLine flip the template's
    //     row-height triggers.
    //   * Template re-application — re-find the parts and push the
    //     current anatomy DPs through the fresh template.
    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue: unknown,
        newValue: unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        const name = descriptor.Name;
        if (name === 'Template' && newValue !== oldValue)
        {
            this.adoptTemplateParts();
            this.syncAnatomySlots();
            return;
        }
        if (name === 'Leading' && descriptor.Owner === ListBoxItem)
        {
            this._leadingSlot?.SetChild(newValue as Visual | undefined);
            return;
        }
        if (name === 'Trailing' && descriptor.Owner === ListBoxItem)
        {
            this._trailingSlot?.SetChild(newValue as Visual | undefined);
            return;
        }
        if (name === 'SupportingText' && descriptor.Owner === ListBoxItem)
        {
            const text = (newValue as string) ?? '';
            if (this._supportText !== undefined) this._supportText.Text = text;
            // Recompute derived row-line state — the template watches
            // these via `when()` to pick the right Height variant.
            const hasText      = text.length > 0;
            const isThreeLine  = text.includes('\n');
            this.set_property_value_with_key(ListBoxItem._HasSupportingTextPriv, hasText);
            this.set_property_value_with_key(ListBoxItem._IsThreeLinePriv,       isThreeLine);
            return;
        }
        if (this._syncingIsSelected) return;
        // Compare descriptor identity via Owner + Name pair — IsSelected
        // is registered on both Selector (attached) and ListBoxItem
        // (instance), so a string match alone would conflate them.
        if (name !== 'IsSelected') return;
        const fromAttached = descriptor.Owner === Selector;
        const fromInstance = descriptor.Owner === ListBoxItem;
        if (!fromAttached && !fromInstance) return;
        this._syncingIsSelected = true;
        try
        {
            if (fromAttached)
            {
                this.set_property_value(ListBoxItem.IsSelectedKey, newValue as boolean);
            }
            else
            {
                Selector.SetIsSelected(this, newValue as boolean);
            }
        }
        finally
        {
            this._syncingIsSelected = false;
        }
    }
}

// Silence "unused import" — Orientation is used implicitly: the
// StackPanel ItemsPanel factory defaults to Vertical (registered
// default), so we don't pass it explicitly. Keeping the import
// makes the dependency relationship explicit in the import list
// for grep / IDE jump-to-source.
void Orientation;
