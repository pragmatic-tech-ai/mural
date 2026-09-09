import {
    MetaData,
    MuralBase,
    Visual,
    Element,
    type KeyEventArgs,
    Key,
    ModifierKeys,
    hasModifier,
    type PropertyDescriptor,
} from '../../runtime/index.js';
import { ItemsControl } from '../base/items-control.js';
import { attachMarqueeSelection } from '../../basic/behaviors/marquee-selection-behavior.js';

// WPF SelectionMode enum, promoted from ListBox so any multi-select-
// capable Selector descendant (ListBox today; future DataGrid /
// MultiSelectComboBox / ListView) shares the same semantics.
//   Single   — every click sets one container; Ctrl / Shift ignored.
//   Multiple — every plain click toggles a container's membership;
//              no modifiers required (touch-friendly).
//   Extended — plain click = single set; Ctrl+click = toggle;
//              Shift+click = range from anchor (visible order).
export enum SelectionMode
{
    Single   = 'Single',
    Multiple = 'Multiple',
    Extended = 'Extended',
}

// Marquee bounds policy — Windows Explorer / macOS Finder parity.
//   Intersect — the marquee rect must just TOUCH the item's bounds for
//                the item to be included. Windows Explorer default,
//                touch-friendly.
//   Contained — the item's bounds must be FULLY CONTAINED in the rect.
//                Stricter, macOS Finder default.
export enum MarqueeBoundsPolicy
{
    Intersect = 'Intersect',
    Contained = 'Contained',
}

// Selector — the WPF parity layer between ItemsControl and any list-
// rendering control that exposes a "currently selected item" surface
// (ListBox, ComboBox, TabControl, ListView, TreeView, Diagram, …).
// Mirrors System.Windows.Controls.Primitives.Selector plus the
// MultiSelector surface (one layer, not two — single-select descendants
// just leave SelectionMode at its default).
//
// Single-row surface:
//   * SelectedIndex     — −1 when nothing is selected; otherwise the
//                          first selected container's index in the
//                          subclass's container-order space.
//   * SelectedItem      — the primary-row's exposed value (Tag if the
//                          container carries one, otherwise the
//                          container itself).
//   * SelectedValue     — projection of SelectedItem through
//                          SelectedValuePath. Equals SelectedItem when
//                          the path is unset.
//   * SelectedValuePath — dotted property path on the selected item
//                          (e.g. 'Id', 'Customer.Code'); empty / unset
//                          means SelectedValue mirrors SelectedItem.
//
// Multi-select surface:
//   * SelectionMode   — Single (default) / Multiple / Extended.
//   * SelectedItems   — readonly snapshot in insertion order. Each
//                        entry is the exposed value of the row.
//   * IsSelected      — attached DP on any container (Visual). Source
//                        of truth for "is this row selected"; the
//                        chrome (template triggers / style triggers)
//                        watches it. Subclass container types
//                        (ListBoxItem, TreeViewItem) expose an
//                        instance-level mirror so existing
//                        `when (IsSelected)` triggers keep working.
//   * HandleContainerClick(container, modifiers) — entry point for
//                        row clicks; subclass container types call it
//                        from their pointer-up handler.
//   * ClearSelection() — drop every selected row.
//   * BeginUpdate() / EndUpdate() — bulk-edit transaction; nested
//                        mutations coalesce into ONE SelectionChanged
//                        fire on the outermost EndUpdate.
//
// Selection survives container recycling via the
// `_selectedData` mirror — the recycle hooks
// (PrepareContainerForItemOverride / RebindContainerForItemOverride /
// ClearContainerForItemOverride) re-sync IsSelected against
// _selectedData whenever a container is bound to a new data item.
//
// All single-row DPs (Index / Item / Value) stay in sync — a write to
// any one runs the matching `applySelected*` hook, which updates the
// multi-select state to "just this row", cross-syncs the siblings
// (through `withSuppressedSelectionSync` so the propagation doesn't
// re-enter) and fires SelectionChanged.
//
// `resolveItemAt`, `resolveIndexOf`, `containerOrderForRange`,
// `exposedValueOf`, and `getPrimaryIndex` are the override seams for
// subclasses whose selection model isn't pure-Items (ListBox container
// Tag, TreeView hierarchical order, etc.).
export class Selector extends ItemsControl
{
    // SelectedIndex / SelectedItem / SelectedValue all carry
    // BindsTwoWayByDefault — WPF parity. Consumers binding selection to
    // a VM almost always want the user's clicks to flow back, and
    // typing `Mode=TwoWay` on every NavigationRail / ListBox / ComboBox
    // selection binding is exactly the kind of papercut WPF eliminated
    // by promoting the metadata flag here. Explicit modes on the
    // binding still win (see Binding.ResolveDefaultMode).
    //
    // SelectedValuePath stays None — it's a path-spec string, not a
    // selection-tracking surface, and the few places that bind it
    // typically want OneWay.
    public static readonly SelectedIndexKey     = MuralBase.RegisterProperty<number>(            Selector, 'SelectedIndex',     -1,        MetaData.BindsTwoWayByDefault);
    public static readonly SelectedItemKey      = MuralBase.RegisterProperty<unknown>(           Selector, 'SelectedItem',      undefined, MetaData.BindsTwoWayByDefault);
    public static readonly SelectedValueKey     = MuralBase.RegisterProperty<unknown>(           Selector, 'SelectedValue',     undefined, MetaData.BindsTwoWayByDefault);
    public static readonly SelectedValuePathKey = MuralBase.RegisterProperty<string | undefined>(Selector, 'SelectedValuePath', undefined, MetaData.None);
    public static readonly SelectionModeKey     = MuralBase.RegisterProperty<SelectionMode>(    Selector, 'SelectionMode',     SelectionMode.Single, MetaData.None);

    // Marquee multi-select — Windows Explorer-style drag-rectangle that
    // selects every container it touches. Opt-in per instance; default
    // off so single-select Selector descendants (ComboBox, TabControl)
    // don't pay for the wiring.
    public static readonly AllowMarqueeSelectionKey = MuralBase.RegisterProperty<boolean>(
        Selector, 'AllowMarqueeSelection', false, MetaData.None);

    // Item-inclusion policy when the marquee crosses an item's bounds.
    // Defaults to Intersect (Explorer parity); flip to Contained for
    // stricter Finder-style semantics.
    public static readonly MarqueeBoundsPolicyKey = MuralBase.RegisterProperty<MarqueeBoundsPolicy>(
        Selector, 'MarqueeBoundsPolicy', MarqueeBoundsPolicy.Intersect, MetaData.None);

    // Attached DP — any Visual carrying it represents a selectable row.
    // Source of truth for "is this row selected"; templates and styles
    // observe it via instance-level mirrors on ListBoxItem / TreeViewItem
    // (see those classes for the forwarding shape).
    public static readonly IsSelectedKey = MuralBase.RegisterAttachedProperty<boolean>(
        Selector, 'IsSelected', false, MetaData.Render);

    public static GetIsSelected(v: Visual): boolean
    {
        return v.get_property_value(Selector.IsSelectedKey);
    }
    public static SetIsSelected(v: Visual, value: boolean): void
    {
        v.set_property_value(Selector.IsSelectedKey, value);
    }

    private _suppressSync: boolean = false;
    private readonly _selectionListeners: Set<() => void> = new Set();

    // Multi-select bookkeeping. Two mirrors of the same selection:
    //   _selectedContainers — live containers carrying selection chrome.
    //                          Used for SelectedItems enumeration and as
    //                          the targets of IsSelected flips.
    //   _selectedData       — the underlying data identities (Tag if
    //                          present, else the container itself). The
    //                          source of truth across container recycle:
    //                          when a virtualizing panel reuses a
    //                          container for a different row, the recycle
    //                          hook consults this set to re-sync
    //                          IsSelected to the new data.
    protected readonly _selectedContainers: Set<Visual> = new Set();
    protected readonly _selectedData:       Set<unknown> = new Set();
    protected _anchor: Visual | undefined;

    // Bulk-edit transaction state. Nested transactions accumulate; only
    // the outermost EndUpdate flushes.
    private _updateDepth: number  = 0;
    private _updateDirty: boolean = false;

    public get SelectedIndex(): number      { return this.get_property_value(Selector.SelectedIndexKey); }
    public set SelectedIndex(v: number)     { this.set_property_value(Selector.SelectedIndexKey, v); }

    public get SelectedItem(): unknown      { return this.get_property_value(Selector.SelectedItemKey); }
    public set SelectedItem(v: unknown)     { this.set_property_value(Selector.SelectedItemKey, v); }

    public get SelectedValue(): unknown     { return this.get_property_value(Selector.SelectedValueKey); }
    public set SelectedValue(v: unknown)    { this.set_property_value(Selector.SelectedValueKey, v); }

    public get SelectedValuePath(): string | undefined  { return this.get_property_value(Selector.SelectedValuePathKey); }
    public set SelectedValuePath(v: string | undefined) { this.set_property_value(Selector.SelectedValuePathKey, v); }

    public get SelectionMode(): SelectionMode { return this.get_property_value(Selector.SelectionModeKey); }
    public set SelectionMode(v: SelectionMode) { this.set_property_value(Selector.SelectionModeKey, v); }

    public get AllowMarqueeSelection(): boolean { return this.get_property_value(Selector.AllowMarqueeSelectionKey); }
    public set AllowMarqueeSelection(v: boolean) { this.set_property_value(Selector.AllowMarqueeSelectionKey, v); }

    public get MarqueeBoundsPolicy(): MarqueeBoundsPolicy { return this.get_property_value(Selector.MarqueeBoundsPolicyKey); }
    public set MarqueeBoundsPolicy(v: MarqueeBoundsPolicy) { this.set_property_value(Selector.MarqueeBoundsPolicyKey, v); }

    // Snapshot of the multi-selection in insertion order. Each entry is
    // the container's Tag when present (Items-driven path) or the
    // container itself when Tag is unset (declarative path).
    public get SelectedItems(): readonly unknown[]
    {
        const out: unknown[] = [];
        for (const c of this._selectedContainers) out.push(this.exposedValueOf(c));
        return out;
    }

    // Containers carrying selection chrome, in insertion order.
    // Companion to SelectedItems for callers that need the Visual
    // rather than the data item — group-drag in Figure reads this
    // to identify the partner containers that should move alongside
    // the pressed one. Returned as a fresh snapshot so iteration is
    // safe while selection mutates.
    public get SelectedContainers(): readonly Visual[]
    {
        return [...this._selectedContainers];
    }

    public AddSelectionChangedListener(listener: () => void): void
    {
        this._selectionListeners.add(listener);
    }

    public RemoveSelectionChangedListener(listener: () => void): void
    {
        this._selectionListeners.delete(listener);
    }

    // Bulk-edit transaction. Selection mutations inside Begin/End
    // accumulate; SelectionChanged fires exactly once on the outermost
    // EndUpdate (and refreshExposedSelection runs once). Nested
    // transactions are supported — only the outermost End flushes.
    // WPF parity: MultiSelector.BeginUpdateSelectedItems /
    // EndUpdateSelectedItems, simplified naming.
    public BeginUpdate(): void
    {
        this._updateDepth++;
    }

    public EndUpdate(): void
    {
        if (this._updateDepth === 0) return;
        this._updateDepth--;
        if (this._updateDepth > 0) return;
        if (this._updateDirty)
        {
            this._updateDirty = false;
            this.refreshExposedSelection();
            for (const l of this._selectionListeners) l();
        }
    }

    protected fireSelectionChanged(): void
    {
        if (this._updateDepth > 0)
        {
            this._updateDirty = true;
            return;
        }
        for (const l of this._selectionListeners) l();
    }

    // Subclass-callable: run `body` with cross-sync suppression so any
    // Selected* DP writes inside don't trigger applySelected*. Used by
    // both the base (to cross-sync siblings without re-entering) and
    // by subclasses (to mirror internal state to the public DPs without
    // tripping their own apply* logic).
    protected withSuppressedSelectionSync(body: () => void): void
    {
        const was = this._suppressSync;
        this._suppressSync = true;
        try { body(); }
        finally { this._suppressSync = was; }
    }

    // ── Multi-select API ──────────────────────────────────────────────

    // Drop every selected row. Fires SelectionChanged once. No-op if
    // nothing is selected. (Inside a Begin/EndUpdate transaction the
    // listener fire coalesces into the outer flush.)
    public ClearSelection(): void
    {
        if (this._selectedContainers.size === 0 && this._selectedData.size === 0) return;
        for (const c of this._selectedContainers) Selector.SetIsSelected(c, false);
        this._selectedContainers.clear();
        this._selectedData.clear();
        this._anchor = undefined;
        this.refreshExposedSelection();
        this.fireSelectionChanged();
    }

    // Entry point for row clicks — invoked by container types
    // (ListBoxItem, TreeViewItem, future DataGridRow) from their
    // press-here-release-here handler. Modifier interpretation depends
    // on SelectionMode. Fires SelectionChanged exactly once. Also
    // moves the keyboard focus cursor to the clicked container so a
    // subsequent ArrowDown / ArrowUp continues navigation from where
    // the pointer last landed.
    public HandleContainerClick(container: Visual, modifiers: ModifierKeys): void
    {
        this._focusedContainer = container;
        const mode = this.SelectionMode;
        if (mode === SelectionMode.Single)
        {
            this.setSelectedContainers([container]);
            this._anchor = container;
        }
        else if (mode === SelectionMode.Multiple)
        {
            this.toggleContainerSelected(container);
            this._anchor = container;
        }
        else // Extended
        {
            const shiftActive = hasModifier(modifiers, ModifierKeys.Shift) && this._anchor !== undefined;
            if (shiftActive)
            {
                this.selectContainerRange(this._anchor!, container);
            }
            else if (hasModifier(modifiers, ModifierKeys.Control))
            {
                this.toggleContainerSelected(container);
                this._anchor = container;
            }
            else
            {
                this.setSelectedContainers([container]);
                this._anchor = container;
            }
        }
        this.refreshExposedSelection();
        this.fireSelectionChanged();
    }

    // ── Multi-select internals ────────────────────────────────────────

    // Diff-update the selection to exactly `containers`. IsSelected only
    // flips on rows whose membership changes — saves a render-dirty on
    // rows that stay selected (the common case for an overlapping
    // Shift+click range).
    protected setSelectedContainers(containers: readonly Visual[]): void
    {
        const next = new Set(containers);
        for (const c of this._selectedContainers)
        {
            if (!next.has(c)) Selector.SetIsSelected(c, false);
        }
        for (const c of next)
        {
            if (!this._selectedContainers.has(c)) Selector.SetIsSelected(c, true);
        }
        this._selectedContainers.clear();
        this._selectedData.clear();
        for (const c of containers)
        {
            this._selectedContainers.add(c);
            this._selectedData.add(this.exposedValueOf(c));
        }
    }

    protected toggleContainerSelected(container: Visual): void
    {
        if (this._selectedContainers.has(container))
        {
            this._selectedContainers.delete(container);
            this._selectedData.delete(this.exposedValueOf(container));
            Selector.SetIsSelected(container, false);
        }
        else
        {
            this._selectedContainers.add(container);
            this._selectedData.add(this.exposedValueOf(container));
            Selector.SetIsSelected(container, true);
        }
    }

    protected selectContainerRange(from: Visual, to: Visual): void
    {
        const order   = this.containerOrderForRange();
        const fromIdx = order.indexOf(from);
        const toIdx   = order.indexOf(to);
        if (fromIdx < 0 || toIdx < 0) return;
        const lo = Math.min(fromIdx, toIdx);
        const hi = Math.max(fromIdx, toIdx);
        this.setSelectedContainers(order.slice(lo, hi + 1));
    }

    // ── Keyboard navigation (§ 10.8) ──────────────────────────────────
    //
    // OnKeyDown on the Selector fires AFTER any focused child's own
    // OnKeyDown (bubble order). When a list item is focused — set on
    // press-here-release-here OR by a prior arrow-key move — the
    // following keys reach this handler unchanged:
    //
    //   ArrowDown / ArrowUp     — move focus by one container
    //   Home / End              — first / last container
    //   PageDown / PageUp       — move by viewport-worth of containers
    //                              (count derived from the wrapping
    //                              ScrollViewer's ViewportHeight; falls
    //                              back to 10 when no ScrollViewer found)
    //   Shift + (any of the above) — extend selection from the anchor
    //                                  through the new focus target
    //                                  (Extended / Multiple modes only)
    //   Ctrl + (any of the above)  — move focus without changing
    //                                  selection (Extended mode only)
    //   Space                   — toggle selection of focused container
    //                              (Multiple / Extended modes)
    //   Ctrl+A                  — select every container (Multiple /
    //                              Extended modes only)
    //
    // The "focused container" is tracked in `_focusedContainer`. The
    // visual focus is mirrored onto the container via args.SetFocus so
    // Visual.IsFocused trigger-driven chrome lights up the right row.
    // Single-mode Selectors honour ArrowDown / Up navigation but Ctrl
    // / Shift modifiers degrade to plain single-select (range-extend
    // semantics don't apply to Single).
    private _focusedContainer: Visual | undefined;

    /** The container currently navigated to via keyboard. Read-only —
     *  external code should call SetFocus(container) on a Visual to
     *  alter focus, which mirrors back via the InputManager. */
    public get FocusedContainer(): Visual | undefined { return this._focusedContainer; }

    protected override OnKeyDown(args: KeyEventArgs): void
    {
        super.OnKeyDown(args);
        if (args.Handled) return;

        // Ctrl+A: select all (Multiple / Extended only).
        if ((hasModifier(args.Modifiers, ModifierKeys.Control) || hasModifier(args.Modifiers, ModifierKeys.Windows))
            && args.Key === Key.A)
        {
            if (this.SelectionMode !== SelectionMode.Single)
            {
                const order = this.containerOrderForRange();
                if (order.length > 0)
                {
                    this.setSelectedContainers(order);
                    this._anchor = order[0];
                    this.refreshExposedSelection();
                    this.fireSelectionChanged();
                    args.Handled = true;
                }
            }
            return;
        }

        // Movement keys. Compute the target container; the navigation
        // logic below the switch handles selection state once `target`
        // is known.
        const order = this.containerOrderForRange();
        if (order.length === 0) return;

        const focusedIdx = this._focusedContainer !== undefined
            ? order.indexOf(this._focusedContainer)
            : -1;
        const viewportCount = this.getViewportItemCount();

        let target: Visual | undefined;
        switch (args.Key)
        {
            case Key.Down:
                target = focusedIdx < 0
                    ? order[0]
                    : order[Math.min(focusedIdx + 1, order.length - 1)];
                break;
            case Key.Up:
                target = focusedIdx < 0
                    ? order[order.length - 1]
                    : order[Math.max(focusedIdx - 1, 0)];
                break;
            case Key.Home:
                target = order[0];
                break;
            case Key.End:
                target = order[order.length - 1];
                break;
            case Key.PageDown:
                target = focusedIdx < 0
                    ? order[Math.min(viewportCount - 1, order.length - 1)]
                    : order[Math.min(focusedIdx + viewportCount, order.length - 1)];
                break;
            case Key.PageUp:
                target = focusedIdx < 0
                    ? order[0]
                    : order[Math.max(focusedIdx - viewportCount, 0)];
                break;
            case Key.Space:
                if (this._focusedContainer !== undefined
                    && this.SelectionMode !== SelectionMode.Single)
                {
                    this.toggleContainerSelected(this._focusedContainer);
                    this._anchor = this._focusedContainer;
                    this.refreshExposedSelection();
                    this.fireSelectionChanged();
                    args.Handled = true;
                }
                return;
            default:
                return;
        }

        if (target === undefined) return;

        // Apply selection based on mode + modifiers, then move focus.
        const mode = this.SelectionMode;
        const shift = hasModifier(args.Modifiers, ModifierKeys.Shift);
        const ctrl  = hasModifier(args.Modifiers, ModifierKeys.Control) || hasModifier(args.Modifiers, ModifierKeys.Windows);

        if (mode === SelectionMode.Single || (!shift && !ctrl))
        {
            // Plain navigation in any mode → single-select the target.
            this.setSelectedContainers([target]);
            this._anchor = target;
            this.refreshExposedSelection();
            this.fireSelectionChanged();
        }
        else if (shift)
        {
            // Extend from anchor through target. If no anchor yet
            // (focused-only via a prior Ctrl+arrow), fall back to the
            // current target as the implicit anchor — matches WPF
            // ListBox behaviour for "Shift+Arrow with no prior anchor."
            // Mode is guaranteed Multiple / Extended at this point —
            // Single fell into the if-branch above.
            const anchor = this._anchor ?? target;
            this.selectContainerRange(anchor, target);
            if (this._anchor === undefined) this._anchor = anchor;
            this.refreshExposedSelection();
            this.fireSelectionChanged();
        }
        // else (ctrl-only, no shift, multi-mode): move focus without
        // touching selection. Anchor stays put.

        this._focusedContainer = target;
        // Containers are always Elements; Selector types its container
        // surface as Visual, so narrow at the focus-sink boundary.
        args.SetFocus(target as Element);
        this.bringContainerIntoView(target);
        args.Handled = true;
    }

    /** Number of containers that fit in the viewport when the Selector
     *  is hosted inside a ScrollViewer; 10 as a fallback. PageDown /
     *  PageUp consult this to advance by viewport-worth at a time. */
    protected getViewportItemCount(): number
    {
        // Walk up the visual tree looking for a ScrollViewer ancestor.
        // The structural typing avoids a hard import dependency on
        // scroll-viewer.ts (which would cycle through items-control).
        let cursor: Visual | undefined = this;
        while (cursor !== undefined)
        {
            const sv = cursor as unknown as { ViewportHeight?: number };
            if (typeof sv.ViewportHeight === 'number' && sv.ViewportHeight > 0)
            {
                // Estimate from the first realized container's height.
                // Same-height assumption matches the v1 virtualizer.
                const order = this.containerOrderForRange();
                const sample = order[0];
                const rowH = sample !== undefined && sample.ArrangedRect.Height > 0
                    ? sample.ArrangedRect.Height : 0;
                if (rowH > 0)
                {
                    return Math.max(1, Math.floor(sv.ViewportHeight / rowH));
                }
            }
            cursor = cursor.GetVisualParent();
        }
        return 10;
    }

    /** Best-effort scroll-into-view for a container. Looks up the
     *  nearest ScrollViewer ancestor and calls its ScrollIntoView with
     *  the container's ArrangedRect (relative to the panel) if one
     *  exists; silent no-op otherwise. Assumes the ItemsPanel is the
     *  ScrollViewer's direct content — nested cases with intervening
     *  Visuals would need coordinate adjustment, but the typical
     *  Selector layout (ScrollViewer wraps the items host) hits this
     *  fast path. */
    protected bringContainerIntoView(container: Visual): void
    {
        // Structural typing keeps this file from importing scroll-viewer.ts
        // (which would cycle through items-control). The Rect-taking
        // ScrollIntoView is ScrollViewer's public surface; anything else
        // with that name on an ancestor either matches the signature or
        // gets silently bypassed.
        type ScrollHost = { ScrollIntoView?: (rect: { X: number; Y: number; Width: number; Height: number }) => void };
        let cursor: Visual | undefined = this.GetVisualParent();
        while (cursor !== undefined)
        {
            const sv = cursor as unknown as ScrollHost;
            if (typeof sv.ScrollIntoView === 'function')
            {
                sv.ScrollIntoView(container.ArrangedRect);
                return;
            }
            cursor = cursor.GetVisualParent();
        }
    }

    // ── Container recycle hooks ──────────────────────────────────────
    //
    // Override the ItemsControl recycle hooks so selection survives
    // container reuse. Without these, a virtualizing panel that recycles
    // a ListBoxItem for a new row would carry over the prior row's
    // chrome (and would incorrectly contribute its new row to
    // SelectedItems via container-Tag exposure).

    public override PrepareContainerForItemOverride(container: Visual, item: unknown, index: number): void
    {
        super.PrepareContainerForItemOverride(container, item, index);
        this.syncContainerSelectionFromData(container, item);
    }

    public override RebindContainerForItemOverride(container: Visual, item: unknown): void
    {
        super.RebindContainerForItemOverride(container, item);
        this.syncContainerSelectionFromData(container, item);
    }

    public override ClearContainerForItemOverride(container: Visual, item: unknown): void
    {
        super.ClearContainerForItemOverride(container, item);
        const wasSelected = this._selectedContainers.delete(container);
        // For the data-driven path the Tag carries the item, so once the
        // container leaves the live tree its row's selection identity
        // goes with it. Composed-markup rows have container ===
        // exposedValueOf so the same delete covers them.
        this._selectedData.delete(this.exposedValueOf(container));
        if (wasSelected) Selector.SetIsSelected(container, false);
        if (this._anchor === container) this._anchor = undefined;
        // Clear the keyboard-focus pointer so we don't pin a detached /
        // recycled container in memory and so the next arrow key starts
        // from a clean slate (§ 10.8 follow-up — caught in code review).
        if (this._focusedContainer === container) this._focusedContainer = undefined;
        if (wasSelected)
        {
            this.refreshExposedSelection();
            this.fireSelectionChanged();
        }
        // Suppress the unused-parameter warning. The base call carries
        // `item` through; we don't need it here because the data-side
        // mirror is keyed off the container's exposed value.
        void item;
    }

    // Recycle-time sync. Called from Prepare / Rebind to align the
    // freshly-bound container's IsSelected with the persistent
    // _selectedData identity set.
    protected syncContainerSelectionFromData(container: Visual, item: unknown): void
    {
        const itemMatches = this._selectedData.has(item);
        const tagMatches  = container.Tag !== undefined && this._selectedData.has(container.Tag);
        const shouldBeSelected = itemMatches || tagMatches;
        if (shouldBeSelected)
        {
            this._selectedContainers.add(container);
            Selector.SetIsSelected(container, true);
        }
        else if (this._selectedContainers.has(container))
        {
            this._selectedContainers.delete(container);
            Selector.SetIsSelected(container, false);
        }
    }

    // Push the multi-selection's first member out to the public
    // single-row DPs (SelectedIndex / SelectedItem / SelectedValue).
    // Wrapped in withSuppressedSelectionSync so the writes don't
    // re-enter applySelected*.
    protected refreshExposedSelection(): void
    {
        const first: Visual | undefined = this._selectedContainers.values().next().value;
        this.withSuppressedSelectionSync(() => {
            if (first === undefined)
            {
                this.SelectedIndex = -1;
                this.SelectedItem  = undefined;
                this.SelectedValue = this.projectValue(undefined);
            }
            else
            {
                const item = this.exposedValueOf(first);
                this.SelectedIndex = this.getPrimaryIndex(first);
                this.SelectedItem  = item;
                this.SelectedValue = this.projectValue(item);
            }
        });
    }

    // ── Apply hooks — external-write entry points ──────────────────
    //
    // Each is invoked from OnPropertyChanged for the corresponding DP,
    // AND ONLY when the write didn't come through the cross-sync path
    // (`_suppressSync === false`). Default behavior:
    //   1. Reconcile the multi-select state to "just this row".
    //   2. Cross-sync sibling DPs under suppression.
    //   3. Fire SelectionChanged.

    protected applySelectedIndex(index: number): void
    {
        const item  = this.resolveItemAt(index);
        const value = this.projectValue(item);
        const normalised = item === undefined ? -1 : index;
        // Reconcile multi-select state. Out-of-range / unresolved index
        // clears all selection. Otherwise, find the realized container
        // (if any) backing the item and make it the only selected row.
        if (item === undefined)
        {
            this.setSelectedContainers([]);
            this._anchor = undefined;
        }
        else
        {
            const container = this.containerForItem(item);
            if (container !== undefined)
            {
                this.setSelectedContainers([container]);
                this._anchor = container;
            }
            else
            {
                // Item exists in the model but no realized container —
                // virtualized row. Seed _selectedData so the recycle
                // hook picks it up when the container materializes.
                for (const c of this._selectedContainers) Selector.SetIsSelected(c, false);
                this._selectedContainers.clear();
                this._selectedData.clear();
                this._selectedData.add(item);
                this._anchor = undefined;
            }
        }
        this.withSuppressedSelectionSync(() => {
            if (normalised !== index) this.SelectedIndex = normalised;
            this.SelectedItem  = item;
            this.SelectedValue = value;
        });
        this.fireSelectionChanged();
    }

    protected applySelectedItem(item: unknown): void
    {
        const idx   = this.resolveIndexOf(item);
        const value = this.projectValue(item);
        // An explicit clear (undefined/null) drops the selection; a
        // concrete item is RETAINED even when it isn't currently in Items.
        // The latter is the "detached selection" state — the item was set
        // before the collection was populated (a TwoWay `SelectedItem=$Vm`
        // resolving before `ItemsSource=$Coll`), or Items is being
        // repopulated. Coercing SelectedItem to undefined there would push
        // undefined back through a TwoWay binding and DESTROY the bound VM
        // value (the box then shows only the placeholder). Instead we keep
        // the item, seed _selectedData so the recycle / re-resolve hook
        // re-selects it once a matching container materializes, and leave
        // SelectedIndex at -1 until the item appears in the collection.
        const cleared = item === undefined || item === null;
        if (cleared)
        {
            this.setSelectedContainers([]);
            this._anchor = undefined;
        }
        else
        {
            const container = idx >= 0 ? this.containerForItem(item) : undefined;
            if (container !== undefined)
            {
                this.setSelectedContainers([container]);
                this._anchor = container;
            }
            else
            {
                // Item set but no realized container — virtualized row OR
                // an item not (yet) in Items. Retain it via _selectedData.
                for (const c of this._selectedContainers) Selector.SetIsSelected(c, false);
                this._selectedContainers.clear();
                this._selectedData.clear();
                this._selectedData.add(item);
                this._anchor = undefined;
            }
        }
        this.withSuppressedSelectionSync(() => {
            // SelectedItem keeps the value the caller set — only the index
            // normalises to -1 when the item isn't currently resolvable.
            this.SelectedIndex = idx;
            this.SelectedValue = value;
        });
        this.fireSelectionChanged();
    }

    protected applySelectedValue(value: unknown): void
    {
        const path = this.SelectedValuePath;
        if (path === undefined || path === '')
        {
            // No path — SelectedValue mirrors SelectedItem 1:1.
            // Delegate to applySelectedItem so multi-select state and
            // listener fire stay consistent.
            this.applySelectedItem(value);
            return;
        }
        if (value === undefined)
        {
            this.applySelectedItem(undefined);
            return;
        }
        const n = this.ItemCount();
        for (let i = 0; i < n; i++)
        {
            const candidate = this.resolveItemAt(i);
            if (this.projectValue(candidate) === value)
            {
                this.applySelectedItem(candidate);
                return;
            }
        }
        // Unmatched value: leave SelectedValue as-written; clear the
        // displayed selection so Item / Index reflect "no current row
        // matches."
        this.setSelectedContainers([]);
        this._anchor = undefined;
        this.withSuppressedSelectionSync(() => {
            this.SelectedItem  = undefined;
            this.SelectedIndex = -1;
        });
        this.fireSelectionChanged();
    }

    // ── Subclass override seams ─────────────────────────────────────

    /** Item at `index` in the selection's underlying collection. */
    protected resolveItemAt(index: number): unknown
    {
        if (index < 0 || index >= this.ItemCount()) return undefined;
        return this.ItemAt(index);
    }

    /** Index of `item` in the selection's underlying collection, or
     *  −1 when not present. Identity comparison by default. */
    protected resolveIndexOf(item: unknown): number
    {
        if (item === undefined) return -1;
        const n = this.ItemCount();
        for (let i = 0; i < n; i++)
        {
            if (this.ItemAt(i) === item) return i;
        }
        return -1;
    }

    /** Find the realized container backing this data item. Default
     *  reads through the ItemContainerGenerator's reverse map.
     *  Subclasses with a per-container Tag identity (ListBox) override
     *  to also match by container.Tag. */
    protected containerForItem(item: unknown): Visual | undefined
    {
        return this.Generator.ContainerFromItem(item);
    }

    /** Index space for SelectedIndex when refreshing the exposed primary
     *  selection. Default returns the generator's index for the
     *  container (matches WPF's Selector.SelectedIndex). Subclasses
     *  with composed-markup paths or hierarchical orders override. */
    protected getPrimaryIndex(container: Visual): number
    {
        const idx = this.Generator.IndexFromContainer(container);
        if (idx >= 0) return idx;
        // No generator slot — composed-markup container. Fall back to
        // its position in logicalChildren.
        return this.logicalChildren.indexOf(container);
    }

    /** Order for Shift+click range selection. Default uses the realized
     *  container list. TreeView overrides to use its visible-items
     *  walk (so collapsed subtrees don't get included in a range). */
    protected containerOrderForRange(): readonly Visual[]
    {
        return this.logicalChildren;
    }

    /** Public-DP value seen by external consumers for a given row:
     *  Tag is what the data-driven path carries (the source data);
     *  composed-markup rows without an explicit Tag fall back to the
     *  container itself. */
    protected exposedValueOf(container: Visual): unknown
    {
        return container.Tag !== undefined ? container.Tag : container;
    }

    /** Project `item` through SelectedValuePath. Returns the item
     *  unchanged when no path is set; returns undefined when any path
     *  segment hits an undefined / null cursor. */
    protected projectValue(item: unknown): unknown
    {
        const path = this.SelectedValuePath;
        if (path === undefined || path === '' || item === undefined || item === null) return item;
        let cursor: unknown = item;
        for (const segment of path.split('.'))
        {
            if (cursor === undefined || cursor === null) return undefined;
            cursor = (cursor as Record<string, unknown>)[segment];
        }
        return cursor;
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue: unknown,
        newValue: unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (descriptor.Name === 'AllowMarqueeSelection' && descriptor.Owner === Selector)
        {
            this.refreshMarqueeAttachment(newValue as boolean);
            return;
        }
        if (this._suppressSync) return;
        switch (descriptor.Name)
        {
            case 'SelectedIndex': this.applySelectedIndex(newValue as number);  break;
            case 'SelectedItem':  this.applySelectedItem(newValue);             break;
            case 'SelectedValue': this.applySelectedValue(newValue);            break;
        }
    }

    private _marqueeDetach: (() => void) | undefined;

    // Attach / detach the marquee behavior in response to AllowMarqueeSelection
    // flips. The behavior wires routed-event listeners and creates an
    // adorner on demand — it's safe to attach before the items panel
    // exists because the listeners filter by source on every event.
    private refreshMarqueeAttachment(enabled: boolean): void
    {
        if (enabled && this._marqueeDetach === undefined)
        {
            this._marqueeDetach = attachMarqueeSelection(this);
        }
        else if (!enabled && this._marqueeDetach !== undefined)
        {
            this._marqueeDetach();
            this._marqueeDetach = undefined;
        }
    }
}

export type SelectionChangedListener = () => void;
