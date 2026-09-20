import { MetaData, MuralBase, Element, Visual, type PointerEventArgs, type PropertyDescriptor } from '../../runtime/index.js';
import { HeaderedContentControl } from '../base/headered-content-control.js';
import { Selector } from '../list/selector.js';

// M3 Tabs — horizontal header strip with mutually-exclusive selection.
//
// TabControl is the container; TabItem is each header+content pair. The
// chrome lives in framework.resources.mu — TabControl's template hosts
// a header strip (an ItemsPresenter populated with each TabItem's
// header surface) above a content area (a ContentPresenter bound to
// the selected item's Content). TabItem provides the headline string
// (Header) and the slotted Content. Selection rides Selector's
// existing SelectedIndex / SelectedItem surface (BindsTwoWayByDefault
// from Phase 6 — `SelectedItem=$VmField` flows user clicks back to
// the VM without an explicit Mode=TwoWay).
//
// Primary vs Secondary tabs (M3 spec) are not split out as variants
// here — both are 48dp-tall horizontal strips; the M3 spec difference
// (Primary tabs sit at the top of a top-app-bar surface; Secondary sit
// inside content) is positional, not visual. A consumer can re-template
// for either context without subclassing.
export class TabControl extends Selector
{
    static
    {
        MuralBase.OverrideMetadata(
            TabControl, Element.DefaultStyleKeyKey,
            { default_value: TabControl });
    }

    // The body of the currently-selected tab — what the content area
    // (PART_ContentSlot) presents. Normalises the two authoring paths so the
    // content presenter binds ONE thing:
    //   * data path (ItemsSource) — SelectedItem is the data row (its Tag),
    //     so the body IS that row, dispatched through its DataTemplate.
    //   * composed markup — SelectedItem is the selected TabItem, so the body
    //     is that TabItem's Content.
    // Read-only to consumers; the control maintains it on every selection
    // change (see updateSelectedContent).
    public static readonly SelectedContentKey = MuralBase.RegisterProperty<unknown>(
        TabControl, 'SelectedContent', undefined, MetaData.None);

    constructor()
    {
        super();
        // Land @DefaultTabControl (Template + ItemsPanel) so the header strip
        // and content slot materialise the moment the ctor returns.
        this.applyDefaultStyle();
        // Keep the content area in sync with the selection. Fires for user
        // clicks AND programmatic SelectedItem writes (e.g. a TwoWay
        // `SelectedItem=$ActiveDocument` binding re-activating a tab).
        this.AddSelectionChangedListener(() => this.updateSelectedContent());
    }

    public get SelectedContent(): unknown { return this.get_property_value(TabControl.SelectedContentKey); }

    public override IsItemItsOwnContainerOverride(item: unknown): boolean
    {
        return item instanceof TabItem;
    }

    public override GetContainerForItemOverride(item: unknown): Visual
    {
        const ti = new TabItem();
        this.bindTab(ti, item);
        return ti;
    }

    public override RebindContainerForItemOverride(container: Visual, item: unknown): void
    {
        if (container instanceof TabItem) this.bindTab(container, item);
        super.RebindContainerForItemOverride(container, item);
    }

    // Wire a data row onto its TabItem container.
    //   * Tag = item — so Selector.exposedValueOf yields the DATA row, making
    //     SelectedItem the row (not the container) and a TwoWay
    //     `SelectedItem=$Active` binding round-trip against real data.
    //   * A Visual row is slotted directly as the body (header stays empty).
    //   * A data row renders its tab HEADER through ItemTemplate (WPF
    //     semantics: TabControl.ItemTemplate templates the tab header) and
    //     also carries the row as Content so SelectedContent can present the
    //     matching body via DataType dispatch.
    private bindTab(ti: TabItem, item: unknown): void
    {
        ti.Tag = item;
        if (item instanceof Visual)
        {
            ti.Header         = undefined;
            ti.HeaderTemplate = undefined;
            ti.Content        = item;
            return;
        }
        // Set HeaderTemplate BEFORE Header so the header slot (PART_Header)
        // resolves through the header template, never a transient implicit
        // fallback, the instant its Content ($$Header) is assigned.
        ti.HeaderTemplate = this.ItemTemplate;
        ti.Header         = item;
        // Do NOT set ti.Content in the data path. TabItem is a
        // HeaderedContentControl and its default template's ONLY ContentPresenter
        // is PART_Header — so ContentControl would present ti.Content THERE, and a
        // data row (a document MuralBase) would render through its implicit
        // DataTemplate (e.g. DataTemplate[DiagramDocument] → a Diagram) INSIDE the
        // tab header. For a document whose view hosts shared Visuals (the Diagram's
        // node Visuals), that duplicate render collides with the content slot's
        // view → "Visual already has a visual parent". The content area doesn't
        // need it either: for a data row SelectedItem exposes the row itself (its
        // Tag), so updateSelectedContent reads the row directly — ti.Content stays
        // undefined and only the composed-markup path (author-set) uses it.
    }

    private updateSelectedContent(): void
    {
        const sel = this.SelectedItem;
        const content = sel instanceof TabItem ? sel.Content : sel;
        this.set_property_value(TabControl.SelectedContentKey, content);
    }

    // ── Selector override seams (Tag-based, ListBox parity) ────────────
    //
    // The data path sets Tag = the row on each TabItem (see bindTab), so a
    // tab's identity is its Tag — exactly like ListBox. Resolve selection
    // through the REALIZED containers (logicalChildren) matched by Tag,
    // NOT through the generator's item→container map.
    //
    // Why: a programmatic `SelectedItem = <row>` write (e.g. a TwoWay
    // `SelectedItem=$ActiveDocument` tab strip re-selecting when the host
    // activates a document) runs applySelectedItem → containerForItem. The
    // base uses Generator.ContainerFromItem, whose reverse map can miss a
    // realized container under a retemplated presenter (the reason clicks —
    // which act on the container directly — highlighted while programmatic
    // activation did not). A Tag scan of the live containers is the same
    // basis HandleContainerClick uses, so both selection paths agree.
    protected override resolveItemAt(index: number): unknown
    {
        const containers = this.logicalChildren;
        if (index < 0 || index >= containers.length) return undefined;
        return this.exposedValueOf(containers[index]!);
    }

    protected override resolveIndexOf(item: unknown): number
    {
        if (item === undefined) return -1;
        const containers = this.logicalChildren;
        for (let i = 0; i < containers.length; i++)
        {
            const c = containers[i]!;
            if (c.Tag === item || c === item) return i;
        }
        return -1;
    }

    protected override containerForItem(item: unknown): Visual | undefined
    {
        if (item === undefined) return undefined;
        for (const c of this.logicalChildren)
        {
            if (c.Tag === item || c === item) return c;
        }
        return undefined;
    }

    protected override validateDeclarativeChild(child: Visual): void
    {
        if (!(child instanceof TabItem))
        {
            throw new Error('TabControl only accepts TabItem children');
        }
    }
}

// One tab — Header is the label rendered in the strip; Content is the
// pane shown when this tab is selected. Mirrors ListBoxItem's mirror
// pattern for IsSelected so template triggers (`when (IsSelected)`)
// fire on the instance DP under Selector-driven selection updates.
// Header lives on HeaderedContentControl as `unknown`; TabItem's
// default template binds the strip label TextBlock to it and expects
// a string at runtime (consumers may also bind a VM + HeaderTemplate
// for richer chrome — same pattern WPF uses).
export class TabItem extends HeaderedContentControl
{
    public static readonly IsSelectedKey = MuralBase.RegisterProperty<boolean>(
        TabItem, 'IsSelected', false, MetaData.Render);

    static
    {
        MuralBase.OverrideMetadata(
            TabItem, Element.DefaultStyleKeyKey,
            { default_value: TabItem });
    }

    // Press-here-release-here gate for click-to-select (see OnPointerUp).
    private _pressOriginatedHere = false;
    // Re-entrancy guard for the IsSelected attached⇄instance mirror.
    private _syncingIsSelected = false;

    constructor()
    {
        super();
        // Land @DefaultTabItem (header ContentPresenter + selection chrome).
        this.applyDefaultStyle();
        // Focusable so a clicked tab can take keyboard focus (the IsFocused
        // chrome + arrow navigation), matching ListBoxItem.
        this.Focusable = true;
    }

    // IsSelected attached⇄instance mirror. Selection is driven through the
    // attached `Selector.IsSelected` DP (setSelectedContainers →
    // Selector.SetIsSelected), but the tab's `when (IsSelected)` chrome
    // (@DefaultTabItem) watches the INSTANCE DP registered on TabItem. Without
    // this mirror the two never meet: a programmatic activation
    // (SelectedItem=$ActiveDocument) flips the attached DP but the instance DP
    // stays false, so the selected-tab underline/ink never paints — only a
    // click appeared to highlight, because a click also takes focus and lights
    // the separate `when (IsFocused)` overlay. Mirrors ListBoxItem exactly,
    // re-entrancy-guarded; the Owner check disambiguates the two same-named DPs.
    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue: unknown,
        newValue: unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (this._syncingIsSelected || descriptor.Name !== 'IsSelected') return;
        const fromAttached = descriptor.Owner === Selector;
        const fromInstance = descriptor.Owner === TabItem;
        if (!fromAttached && !fromInstance) return;
        this._syncingIsSelected = true;
        try
        {
            if (fromAttached) this.set_property_value(TabItem.IsSelectedKey, newValue as boolean);
            else Selector.SetIsSelected(this, newValue as boolean);
        }
        finally
        {
            this._syncingIsSelected = false;
        }
    }

    public get IsSelected(): boolean { return Selector.GetIsSelected(this); }
    public set IsSelected(v: boolean) { Selector.SetIsSelected(this, v); }

    // Click-to-select. A TabItem mirrors ListBoxItem's IsSelected DP but
    // previously did NOT wire clicks to selection — so a tab showed selected
    // chrome yet clicking it never changed the TabControl's SelectedItem. That
    // left `SelectedItem=$ActiveDocument`-style tab strips switchable only
    // programmatically (the document tab strip couldn't switch documents on
    // click). These handlers replicate ListBoxItem: a press-here-release-here
    // gate whose pointer-up walks to the owning Selector (the TabControl) and
    // routes HandleContainerClick, which updates SelectedItem and — through a
    // TwoWay binding — the bound field. IsPressed is maintained for the
    // template's press/hover state-layer triggers, cleared before the click so
    // a handler reading it sees the post-release state (Button convention).
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
        args.SetFocus(this);
        const owner = Selector.FromContainer<Selector>(
            this, (v: Visual): v is Selector => v instanceof Selector);
        if (owner !== undefined) owner.HandleContainerClick(this, args.Modifiers);
    }

    protected override OnPointerLeave(_args: PointerEventArgs): void
    {
        this._setIsPressed(false);
    }

    protected override OnPointerEnter(_args: PointerEventArgs): void
    {
        if (this._pressOriginatedHere) this._setIsPressed(true);
    }
}

// MetaData re-export silencer for future-additions stability.
void MetaData;
