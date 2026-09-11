import {
    Application,
    Key,
    KeyEventArgs,
    MetaData,
    MuralBase,
    Panel,
    Rect,
    Size,
    Element, Visual,
    type DrawingContext,
    type PropertyDescriptor,
} from '../../runtime/index.js';
import { PresentationTarget } from '../../visual-engine/index.js';
import { Border } from '../../basic/border.js';
import { ClickableBorder } from '../../basic/clickable-border.js';
import { ClickAwayScrim } from '../../basic/click-away-scrim.js';
import { ItemsControl } from '../base/items-control.js';
import { Selector } from './selector.js';
import { StackPanel } from '../../basic/panels/stack-panel.js';
import { TextBlock } from '../../basic/text-block.js';
import { TextBox } from '../../basic/text-box.js';
import type { ControlTemplate } from '../../basic/templates/control-template.js';

// Resource-dictionary keys for the two ControlTemplates the ComboBox
// loads from the consolidated controls theme — match the `x:key="…"`
// literals in controls.template.mu.
const KEY_SELECTION = 'DefaultComboBoxSelection';
const KEY_POPUP     = 'DefaultComboBoxPopup';

function resolveTemplate(key: string): ControlTemplate
{
    const tpl = Application.ResolveDefaultResource<ControlTemplate>(key);
    if (tpl === undefined)
    {
        throw new Error(
            `ComboBox: default template '${key}' is not registered.`);
    }
    return tpl;
}

// 2-cell horizontal layout: the first child is left-aligned and the
// second child is right-aligned; both are vertically centred within
// the panel's arranged rect. Used by the ComboBox's selection box to
// place the label on the left edge and the chevron on the right edge
// of a single Border slot.
//
// Mural's StackPanel can't do this — its second child would simply
// follow the first along the stack axis. A WPF DockPanel /
// Grid-with-`*` columns would, but mural's v1 control library has
// neither. SplitRow is exported so the ComboBox's compiled-`.mu`
// template can name it; consumers outside ComboBox shouldn't depend
// on it (rename / removal without notice).
export class SplitRow extends Panel
{
    protected override MeasureOverride(availableSize: Size): Size
    {
        const children = this.visualChildren;
        if (children.length === 0) return Size.Zero;
        // Pessimistic upper bound for each child — both get the full
        // available width during measure; arrange compacts the left
        // one to fit alongside the right.
        let width = 0;
        let height = 0;
        for (const c of children)
        {
            c.Measure(availableSize);
            width += c.DesiredSize.Width;
            height = Math.max(height, c.DesiredSize.Height);
        }
        return new Size(width, height);
    }

    protected override ArrangeOverride(finalSize: Size): Size
    {
        const children = this.visualChildren;
        if (children.length === 0) return finalSize;
        const left = children[0]!;
        // Right child = second one when present; otherwise the only
        // child collapses to the left (which is the natural fallback).
        const right = children.length > 1 ? children[1]! : undefined;

        const rightW = right?.DesiredSize.Width ?? 0;
        const leftW  = Math.max(0, finalSize.Width - rightW);

        const centerY = (h: number): number => Math.max(0, (finalSize.Height - h) / 2);

        left.Arrange(new Rect(0, centerY(left.DesiredSize.Height),
                              leftW, left.DesiredSize.Height));
        if (right !== undefined)
        {
            right.Arrange(new Rect(finalSize.Width - rightW,
                                    centerY(right.DesiredSize.Height),
                                    rightW, right.DesiredSize.Height));
        }
        return finalSize;
    }
}

// Item label resolution: strings pass through as-is; objects with a
// conventional Label / Name / Text property prefer the named property;
// everything else stringifies. Keeps simple `Items=["Apple","Pear"]`
// scenarios working without forcing every consumer to wrap their items
// in a display shape.
// Normalize a ComboBox.Items value (a plain array OR an
// ObservableCollection) into a flat readonly array for iteration. The
// Selector.Items getter is a union type; casting through `unknown` and
// duck-typing the collection avoids the readonly-array narrowing gap.
function normalizeItems(items: unknown): readonly unknown[]
{
    if (items === undefined || items === null) return [];
    if (Array.isArray(items)) return items;
    const coll = items as { Count?: number; Get?(i: number): unknown };
    if (typeof coll.Count === 'number' && typeof coll.Get === 'function')
    {
        const out: unknown[] = [];
        for (let i = 0; i < coll.Count; i++) out.push(coll.Get(i));
        return out;
    }
    return [];
}

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

// ComboBoxItem — popup row container. Carries an `IsSelected` DP so a
// default Style can drive the hover / selected chrome via standard
// triggers, instead of the historical refreshItemHighlights writing
// Fill imperatively. ComboBox writes IsSelected on every realised
// row when SelectedIndex changes; the row's Style reacts.
//
// Default Style ships in basic.resources.mu under
// `Style [TargetType=ComboBoxItem]` — Fill = @SurfaceContainerHigh
// at rest, @StateHoverOverlay on hover, @SecondaryContainer when
// IsSelected. The class overrides DefaultStyleKey to itself so the
// theme lookup picks the ComboBoxItem entry rather than walking up to
// ClickableBorder (which has no default Style today).
export class ComboBoxItem extends ClickableBorder
{
    public static readonly IsSelectedKey = MuralBase.RegisterProperty<boolean>(
        ComboBoxItem, 'IsSelected', false, MetaData.None);

    static {
        MuralBase.OverrideMetadata(ComboBoxItem, Element.DefaultStyleKeyKey, { default_value: ComboBoxItem });
    }

    constructor()
    {
        super();
        // The default Style sets Fill / Padding via setters and
        // hover / selected via triggers. applyDefaultStyle runs the
        // resolver synchronously so the chrome is in place by the time
        // the host adds this container to the popup tree.
        this.applyDefaultStyle();
    }

    public get IsSelected():  boolean { return this.get_property_value(ComboBoxItem.IsSelectedKey); }
    public set IsSelected(v: boolean) { this.set_property_value(ComboBoxItem.IsSelectedKey, v); }
}

// Sum a Visual's ArrangedRect chain up to the surface root. Returns the
// visual's absolute position in target-surface coordinates. Walks
// GetVisualParent until a parent without one (the root) is reached.
function absoluteOrigin(v: Visual): { x: number; y: number }
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

// Overlay host for the ComboBox dropdown. Lives in the target's
// OverlayLayer when the dropdown is open; arranged at the full surface
// size by the layer. Internal layout positions the click-away scrim
// edge-to-edge and the popup just below the originating selection box.
//
// Anchored at the selection-box absolute origin re-read on every arrange
// so a layout shift (window resize, scroll) in the underlying tree
// repositions the open dropdown automatically.
//
// Three external references — `selectionBox`, `popup`, `combo` — are
// writable public fields rather than constructor args so the host can
// be instantiated from `.mu` markup (which can't pass constructor args)
// and wired by ComboBox after the popup template has been applied.
// Arrange is defensive: if either visual reference is unset, it
// degrades to a no-op rather than throwing — keeps a half-configured
// instance from breaking the layout pass during construction.
//
// Exported for the compiled-`.mu` template (not public API).
export class ComboBoxPopupHost extends Panel
{
    public combo:        ComboBox | undefined;
    public selectionBox: Visual   | undefined;
    public popup:        Visual   | undefined;

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
        // Scrim covers the full overlay slot (assumed first child by
        // template authoring convention — `PART_Scrim` before
        // `PART_Popup` in the visual tree).
        children[0]?.Arrange(new Rect(0, 0, finalSize.Width, finalSize.Height));

        if (children.length < 2) return finalSize;
        const popupV = this.popup ?? children[1];
        const anchor = this.selectionBox;
        if (popupV === undefined || anchor === undefined) return finalSize;

        const origin = absoluteOrigin(anchor);
        const sbRect = anchor.ArrangedRect;
        const popupW = sbRect.Width;
        const popupH = popupV.DesiredSize.Height;
        // Below the selection box by default; clamp to the surface so
        // the bottom of the popup doesn't sit outside the visible area.
        let popupY = origin.y + sbRect.Height;
        if (popupY + popupH > finalSize.Height)
        {
            popupY = Math.max(0, finalSize.Height - popupH);
        }
        let popupX = origin.x;
        if (popupX + popupW > finalSize.Width)
        {
            popupX = Math.max(0, finalSize.Width - popupW);
        }
        popupV.Arrange(new Rect(popupX, popupY, popupW, popupH));
        // Keep a reference around in case the combo wants to know
        // where the popup lives now (e.g. for animation later).
        void this.combo;
        return finalSize;
    }
}

// Internal ItemsControl used as the ComboBox popup's row container.
// Promotes the popup-rows from imperative `rebuildItemContainers` to
// the full ItemsControl pipeline (Items / ItemTemplate / container
// recycling, etc.). The owning ComboBox is wired in as a back-pointer
// after popup-template apply so the per-row click handler can commit
// SelectedIndex without a back-channel lookup.
//
// Exported for the compiled-`.mu` popup template; not public API.
export class ComboBoxItemList extends ItemsControl
{
    static {
    }

    // Set by ComboBox after the popup template has been applied — the
    // PrepareContainerForItemOverride hook reads it to wire click
    // handlers against the right ComboBox instance.
    public combo: ComboBox | undefined;

    constructor()
    {
        super();
        this.ItemsPanel = (): StackPanel => new StackPanel();
    }

    public override GetContainerForItemOverride(item: unknown): Visual
    {
        // ComboBoxItem's default Style fills in Fill / Padding /
        // hover / selected chrome via triggers — see
        // `Style [TargetType=ComboBoxItem]` in basic.resources.mu. The
        // label TextBlock is the only content authoring; everything
        // visual rides through the Style.
        const row   = new ComboBoxItem();
        const label = new TextBlock(displayString(item));
        // Match the closed selection box's font so the dropdown row reads
        // at the same size as what it'll show once picked (see
        // ComboBox._applyValueFontTo / the value-font forwarding).
        this.combo?._applyValueFontTo(label);
        row.SetChild(label);
        return row;
    }

    public override PrepareContainerForItemOverride(container: Visual, item: unknown, index: number): void
    {
        super.PrepareContainerForItemOverride(container, item, index);
        const row = container as ComboBoxItem;
        // Closures capture index — combo items are rebuilt wholesale
        // on every Items reassignment, so the closure's index stays in
        // sync with the row's position in the realized list.
        row.onClick = (): void =>
        {
            const c = this.combo;
            if (c === undefined) return;
            c.SelectedIndex    = index;
            c.IsDropDownOpen   = false;
        };
        // Initial selected state — refreshItemHighlights handles
        // subsequent SelectedIndex changes via the public IsSelected DP.
        const c = this.combo;
        if (c !== undefined && c.SelectedIndex === index)
        {
            row.IsSelected = true;
        }
    }

    // Symmetric: wipe row.onClick on detach so a recycled / orphaned
    // row doesn't hold the old ComboBox reference alive through the
    // closure.
    public override ClearContainerForItemOverride(container: Visual, item: unknown): void
    {
        super.ClearContainerForItemOverride(container, item);
        if (container instanceof ComboBoxItem)
        {
            container.onClick    = undefined;
            container.IsSelected = false;
        }
    }
}

// Material UI Outlined Select. Drops a selection box that, when
// clicked, expands a popup containing the items. Clicking an item
// commits SelectedItem / SelectedIndex and closes the dropdown.
//
// DPs:
//   * Items          — `unknown[]`. Strings render as-is; objects use
//                       Label / Name / Text by convention.
//   * SelectedItem   — the currently-selected item (`undefined` when
//                       nothing is chosen). Bindable; setting it
//                       updates the selection box display and the
//                       SelectedIndex DP.
//   * SelectedIndex  — index into Items of the current selection
//                       (-1 when nothing is chosen).
//   * IsDropDownOpen — visible state of the popup.
//   * Placeholder    — text shown in the selection box when nothing
//                       is selected.
//
// Layout:
//
//   In-flow (always):
//   ┌─ ClickableBorder (selection box, fixed height) ──┐
//   │  TextBlock(selected)            TextBlock(▾)     │
//   └──────────────────────────────────────────────────┘
//
//   When IsDropDownOpen=true, additionally mounted on the host
//   PresentationTarget.OverlayRoot:
//
//   ┌─ ComboBoxPopupHost (full overlay slot) ──────────────────┐
//   │ ┌─ ClickAwayScrim (invisible, full slot) ────────────────┐
//   │ ↘── click here dismisses the dropdown                    │
//   │ ┌─ Border (popup, anchored below selection box) ───────┐ │
//   │ │ ┌─ StackPanel (vertical) ──────────────────────────┐ │ │
//   │ │ │  ClickableBorder(item 0)                         │ │ │
//   │ │ │  ClickableBorder(item 1)                         │ │ │
//   │ │ │  …                                                │ │ │
//   │ │ └──────────────────────────────────────────────────┘ │ │
//   │ └──────────────────────────────────────────────────────┘ │
//   └─────────────────────────────────────────────────────────┘
//
// The popup lives on the OverlayLayer so it paints above ALL other
// content, regardless of the originating selection box's depth in
// the visual tree.
export class ComboBox extends Selector
{
    public static readonly IsDropDownOpenKey = MuralBase.RegisterProperty<boolean>(ComboBox, 'IsDropDownOpen', false,     MetaData.Measure);
    public static readonly PlaceholderKey    = MuralBase.RegisterProperty<string>( ComboBox, 'Placeholder',    'Select…', MetaData.Measure | MetaData.Render);
    // Editable mode. When true, the selection box hosts a Plain TextBox
    // (PART_EditText) the user can type into, and the dropdown becomes a
    // suggestion list rather than the sole input. The default Style's
    // `when(IsEditable)` trigger swaps the label for the field.
    public static readonly IsEditableKey     = MuralBase.RegisterProperty<boolean>(ComboBox, 'IsEditable',     false,     MetaData.Measure);
    // The editable text. Two-way by default so a consumer can bind a
    // value and read back what the user typed. In editable mode it
    // mirrors PART_EditText live and is set to the picked item's display
    // string when the user chooses from the dropdown. Non-editable combos
    // leave it untouched (SelectedItem is the value there).
    public static readonly TextKey           = MuralBase.RegisterProperty<string>( ComboBox, 'Text',           '',        MetaData.Measure | MetaData.BindsTwoWayByDefault);
    // Read-only "the user has picked an item, not the Placeholder" DP.
    // Flipped by refreshSelectionText whenever SelectedItem swaps;
    // the DefaultComboBoxSelection template triggers on it to switch
    // PART_SelectionText.Foreground from @OnSurfaceVariant (placeholder
    // tint) to @OnSurface (selected-item tint) via DynamicResource.
    private static readonly _HasSelectionPriv = MuralBase.RegisterReadOnlyProperty<boolean>(
        ComboBox, 'HasSelection', false, MetaData.None,
    );
    public  static readonly HasSelectionKey   = ComboBox._HasSelectionPriv;

    static {
        MuralBase.OverrideMetadata(ComboBox, Element.DefaultStyleKeyKey, { default_value: ComboBox });
        // Registers the consolidated controls theme exactly once so
        // DefaultComboBoxSelection / DefaultComboBoxPopup resolve via
        // Application.ResolveDefaultResource during construction.
    }

    // ── Template parts ─────────────────────────────────────────────
    private readonly _selectionBox:    ClickableBorder;
    private readonly _selectionText:   TextBlock;
    private readonly _editText:        TextBox          | undefined;
    private readonly _chevronButton:   ClickableBorder  | undefined;
    private readonly _popup:           Border;
    private readonly _popupList:       ComboBoxItemList;
    private readonly _popupHost:       ComboBoxPopupHost;
    private readonly _scrim:           ClickAwayScrim;

    /** Reentrancy guard so the Text ↔ PART_EditText.Text mirror and the
     *  Text ↔ SelectedItem match don't loop. */
    private _syncingText = false;

    /** True iff `_popupHost` is currently a child of
     *  PresentationTarget.OverlayRoot. Tracked so redundant IsOpen
     *  writes don't double-attach. */
    private _popupMounted = false;

    /** The host this combo was last seen attached to, so we can detach
     *  the popup from the OLD target if the combo is moved or removed
     *  while open. */
    private _lastKnownTarget: PresentationTarget | undefined;

    constructor()
    {
        super();

        // ── In-flow selection-box subtree ──────────────────────────
        // The compiled `combo-box.template.mu` registers the selection
        // ControlTemplate (ClickableBorder PART_SelectionBox + label /
        // chevron) under DefaultComboBoxSelection in the controls theme.
        // All cosmetic defaults live in markup; this constructor only
        // wires behaviour to the named parts.
        const selectionTpl  = resolveTemplate(KEY_SELECTION);
        const selectionInst = selectionTpl.Apply(this);
        this._selectionBox    = selectionInst.root as ClickableBorder;
        this._selectionText   = selectionInst.root.FindName('PART_SelectionText') as TextBlock;
        this._editText        = selectionInst.root.FindName('PART_EditText')      as TextBox         | undefined;
        this._chevronButton   = selectionInst.root.FindName('PART_ChevronButton') as ClickableBorder | undefined;
        // Box click toggles the dropdown ONLY when not editable; in
        // editable mode the click lands on the inner TextBox (caret
        // placement) and the chevron button owns the toggle. Gating both
        // sides on IsEditable avoids a double-toggle when the chevron —
        // nested inside the box — is clicked (both ClickableBorders fire).
        this._selectionBox.onClick = (): void => {
            if (this.IsEditable)
            {
                // Clicking the box's padding / gaps (a direct hit on the inner
                // field is captured by the TextBox itself) focuses the editor
                // so the whole editable area behaves like one text field —
                // WPF's editable ComboBox does the same.
                this._editText?.Focus();
            }
            else
            {
                this.IsDropDownOpen = !this.IsDropDownOpen;
            }
        };
        if (this._chevronButton !== undefined)
        {
            this._chevronButton.onClick = (): void => {
                if (this.IsEditable) this.IsDropDownOpen = !this.IsDropDownOpen;
            };
        }
        // Mirror typed edits into the Text DP (guarded so the reverse
        // push from applyText doesn't loop).
        if (this._editText !== undefined)
        {
            this._editText.PropertyChanged(TextBox.TextKey).subscribe(() =>
            {
                if (this._syncingText) return;
                this._syncingText = true;
                // Set Text; the 'Text' handler below runs the item match
                // and (guarded) field echo. Matching happens there so the
                // programmatic `combo.Text = …` path matches too.
                try { this.Text = this._editText!.Text; }
                finally { this._syncingText = false; }
            });
        }

        // ── Overlay popup subtree ──────────────────────────────────
        // `combo-box-popup.template.mu` registers the overlay
        // ControlTemplate (ComboBoxPopupHost + Scrim + Popup +
        // PopupStack) under DefaultComboBoxPopup. The host's anchor
        // refs (combo, selectionBox, popup) can't appear in markup —
        // they form a cycle through the selection subtree — so we
        // patch them in here after both templates have been applied.
        const popupTpl  = resolveTemplate(KEY_POPUP);
        const popupInst = popupTpl.Apply(this);
        this._popupHost  = popupInst.root as ComboBoxPopupHost;
        this._scrim      = popupInst.root.FindName('PART_Scrim')     as ClickAwayScrim;
        this._popup      = popupInst.root.FindName('PART_Popup')     as Border;
        this._popupList  = popupInst.root.FindName('PART_PopupList') as ComboBoxItemList;
        this._popupHost.combo        = this;
        this._popupHost.selectionBox = this._selectionBox;
        this._popupHost.popup        = this._popup;
        // Wire the popup ItemsControl back to this combo so its
        // PrepareContainerForItemOverride hook can commit selection
        // through us (and so item rows can read SelectedIndex for the
        // selected-highlight via itemBackgroundFor).
        this._popupList.combo = this;
        this._scrim.onClick = (): void =>
        {
            this.IsDropDownOpen = false;
        };

        // Selection box is the combo's only in-flow visual child; the
        // popup host attaches to the target's OverlayLayer on open.
        this.AttachVisual(this._selectionBox);

        this.refreshSelectionText();

        // Value-font forwarding. The closed selection text (PART_SelectionText)
        // sets a Local FontSize in the template, and the dropdown rows live in
        // a re-parented overlay popup the ComboBox's inherited font never
        // reaches — so neither honours a plain inherited `TextBlock.FontSize`
        // override. Forward it explicitly: a `TextBlock.FontSize=…` set on the
        // ComboBox pushes onto the selection text (Local, beats the template's
        // own Local size), and the rows copy that same font — so the closed
        // box and the open list always match, controlled by one property.
        this.PropertyChanged(TextBlock.FontSizeKey).subscribe(() => this._forwardValueFont());
    }

    /** @internal — copy the closed selection's effective font onto a popup
     *  row label so the dropdown always matches the selection box. Called by
     *  ComboBoxItemList as it builds each row. */
    public _applyValueFontTo(label: TextBlock): void
    {
        label.FontFamily = this._selectionText.FontFamily;
        label.FontSize   = this._selectionText.FontSize;
        label.FontWeight = this._selectionText.FontWeight;
    }

    private _forwardValueFont(): void
    {
        this._selectionText.FontSize = this.get_property_value(TextBlock.FontSizeKey) as number;
        for (const row of this._popupList.logicalChildren)
        {
            const label = (row as ComboBoxItem).child;
            if (label instanceof TextBlock) this._applyValueFontTo(label);
        }
    }

    // Items / SelectedItem / SelectedIndex / SelectedValue / SelectedValuePath
    // are inherited from Selector (ItemsControl). Only ComboBox-specific DPs
    // get accessor overrides here.

    public get IsDropDownOpen(): boolean { return this.get_property_value(ComboBox.IsDropDownOpenKey); }
    public set IsDropDownOpen(v: boolean) { this.set_property_value(ComboBox.IsDropDownOpenKey, v); }

    public get Placeholder(): string { return this.get_property_value(ComboBox.PlaceholderKey); }
    public set Placeholder(v: string) { this.set_property_value(ComboBox.PlaceholderKey, v); }

    public get IsEditable(): boolean { return this.get_property_value(ComboBox.IsEditableKey); }
    public set IsEditable(v: boolean) { this.set_property_value(ComboBox.IsEditableKey, v); }

    public get Text(): string { return this.get_property_value(ComboBox.TextKey); }
    public set Text(v: string) { this.set_property_value(ComboBox.TextKey, v); }

    public override get visualChildren(): readonly Visual[]
    {
        return [this._selectionBox];
    }

    // Cascade host target through to the in-flow selection box AND
    // detach any orphan popup from the previous target before its
    // identity is overwritten. Combo is rarely re-parented in practice
    // but the cleanup keeps stale overlay nodes from lingering on the
    // old target when it does happen.
    protected override propagate_target_to_visual_children(): void
    {
        const newTarget = this['target'] as PresentationTarget | undefined;
        const oldTarget = this._lastKnownTarget;

        if (oldTarget !== undefined && oldTarget !== newTarget && this._popupMounted)
        {
            oldTarget.DetachOverlay(this._popupHost);
            this._popupMounted = false;
        }
        this._lastKnownTarget = newTarget;

        this._selectionBox['SetTarget'](newTarget);

        // Re-mount the popup on the new target if we want it open.
        if (newTarget !== undefined && this.IsDropDownOpen)
        {
            this.mountPopup();
        }
    }

    // No own paint; the template tree (selection box + popup) covers
    // every painted pixel.
    protected override RenderOverride(_dc: DrawingContext): void { }

    protected override MeasureOverride(availableSize: Size): Size
    {
        this._selectionBox.Measure(availableSize);
        return this._selectionBox.DesiredSize;
    }

    protected override ArrangeOverride(finalSize: Size): Size
    {
        this._selectionBox.Arrange(new Rect(0, 0, finalSize.Width, finalSize.Height));
        // Selection box moved — repose the open popup if any.
        if (this._popupMounted)
        {
            this._popupHost.InvalidateArrange();
        }
        return finalSize;
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue: unknown,
        newValue: unknown,
    ): void
    {
        // Selector.OnPropertyChanged runs the Selected* cross-sync and
        // dispatches to applySelected* on external writes — call it
        // first so by the time our switch sees a Selected* write below,
        // the rest of the selection state is already coherent.
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        // The first DP write (Items = _declarativeItems) fires from
        // ItemsControl's super-constructor BEFORE this ComboBox's own
        // template parts are wired. Bail until templates exist — the
        // user's first real Items / Selected* write will land after
        // construction completes and re-enter this switch correctly.
        if (this._popupList === undefined) return;
        switch (descriptor.Name)
        {
            case 'Items':
                // Forward into the popup's ItemsControl — it owns the
                // container materialization for the dropdown rows.
                this._popupList.Items = (newValue as readonly unknown[] | undefined) ?? [];
                // Items changed → re-resolve the selection against the new
                // collection. Prefer the retained SelectedItem (survives
                // list (re)population / async load, and a selection set
                // before the items arrived) so `SelectedItem=$Vm` bound
                // ahead of `ItemsSource=$Coll` restores once the items land;
                // fall back to SelectedIndex only when no item is held.
                // Re-resolving via applySelectedIndex(-1) here would instead
                // clear a detached SelectedItem (and push undefined through
                // a TwoWay binding). Selector.applySelected* does the
                // cross-sync + listener fire for us.
                const held = this.SelectedItem;
                if (held !== undefined && held !== null) this.applySelectedItem(held);
                else if (this.SelectedIndex >= 0) this.applySelectedIndex(this.SelectedIndex);
                // else: nothing is selected yet. Do NOT call
                // applySelectedIndex(-1) — it writes SelectedItem=undefined
                // through the DP, and when a TwoWay `SelectedItem=$Vm`
                // binding is still resolving (its DataContext arrived this
                // same tick, ItemsSource first), that write pushes undefined
                // back and DESTROYS the VM value before the binding reads it.
                this.refreshSelectionText();
                break;
            case 'IsDropDownOpen':
                this.applyDropDownVisibility(newValue as boolean);
                break;
            case 'Placeholder':
                this.refreshSelectionText();
                break;
            case 'Text':
                this.applyText(newValue as string);
                this.matchTypedText();
                break;
        }
    }

    // Push the Text value into the editable field (guarded so the
    // field's own change listener doesn't echo back). No-op when the
    // template has no PART_EditText.
    private applyText(text: string): void
    {
        if (this._editText === undefined) return;
        if (this._syncingText) return;
        // A binding can transiently push undefined before its source
        // resolves (e.g. `$Family` before the DataContext is set). The
        // embedded TextBox setter assumes a string — coerce to ''.
        const s = text ?? '';
        if (this._editText.Text === s) return;
        this._syncingText = true;
        try { this._editText.Text = s; }
        finally { this._syncingText = false; }
    }

    // In editable mode, keep SelectedIndex aligned with the typed Text:
    // an exact display-string match selects that item; anything else
    // clears the selection WITHOUT rewriting the field (applySelectedItem
    // only writes Text back for a concrete item — see the override).
    private matchTypedText(): void
    {
        if (!this.IsEditable) return;
        const items = normalizeItems(this.Items as unknown);
        const text  = this.Text;
        let found = -1;
        for (let i = 0; i < items.length; i++)
        {
            if (displayString(items[i]) === text) { found = i; break; }
        }
        if (this.SelectedIndex !== found) this.SelectedIndex = found;
    }

    // ── Selector apply* overrides — refresh visuals after cross-sync.
    //
    // applySelected* fires on external SelectedX writes (the cross-sync
    // path is suppressed). Super.* runs first so refreshSelectionText
    // and refreshItemHighlights see the final post-sync values.

    protected override applySelectedIndex(idx: number): void
    {
        super.applySelectedIndex(idx);
        this.refreshSelectionText();
        this.refreshItemHighlights();
        this.syncEditableTextFromSelection();
    }

    protected override applySelectedItem(item: unknown): void
    {
        super.applySelectedItem(item);
        this.refreshSelectionText();
        this.refreshItemHighlights();
        this.syncEditableTextFromSelection();
    }

    // Editable mode: a concrete selection (dropdown pick via SelectedIndex,
    // or an exact typed match) sets the field text to the item's display.
    // A cleared selection (no current item — e.g. a partial typed value
    // that matches nothing) leaves the field alone so in-progress typing
    // isn't wiped. The Text set is a no-op when it already equals what the
    // user typed (exact-match path), so this doesn't loop. Runs from both
    // apply* hooks because a SelectedIndex write routes through
    // applySelectedIndex while a SelectedItem write routes through
    // applySelectedItem.
    private syncEditableTextFromSelection(): void
    {
        if (!this.IsEditable) return;
        const item = this.SelectedItem;
        if (item !== undefined && item !== null) this.Text = displayString(item);
    }

    // Enter in the editable field commits the value and closes the
    // dropdown. The bubbled KeyDown reaches us from PART_EditText (a
    // single-line TextBox leaves Return unhandled). Non-editable combos
    // fall through to Selector's key handling unchanged.
    protected override OnKeyDown(args: KeyEventArgs): void
    {
        if (this.IsEditable && args.Key === Key.Return)
        {
            this.IsDropDownOpen = false;
            args.Handled = true;
            return;
        }
        super.OnKeyDown(args);
    }

    // ── Internal plumbing ───────────────────────────────────────────

    // Set IsSelected on the realised popup rows according to the
    // current SelectedIndex. The row's default Style (in
    // basic.resources.mu) reacts via triggers — IsSelected → selected
    // chrome, IsMouseOver → hover chrome, selected wins. No Fill
    // writes from this class.
    private refreshItemHighlights(): void
    {
        const containers = this._popupList.logicalChildren;
        const sel = this.SelectedIndex;
        for (let i = 0; i < containers.length; i++)
        {
            const c = containers[i];
            if (c instanceof ComboBoxItem) c.IsSelected = (i === sel);
        }
    }

    private refreshSelectionText(): void
    {
        // Guard for the super-construction window — see the matching
        // guard in OnPropertyChanged. apply* hooks fired before the
        // template parts are wired would otherwise crash here.
        if (this._selectionText === undefined) return;
        const item = this.SelectedItem;
        const hasSelection = item !== undefined && item !== null;
        this._selectionText.Text = hasSelection ? displayString(item) : this.Placeholder;
        // PART_SelectionText.Foreground is owned by the template's
        // `when(HasSelection)` trigger via DynamicResource — flipping
        // HasSelection here is enough to re-tint live (and tracks
        // theme switches without any imperative refresh).
        this.set_property_value_with_key(ComboBox._HasSelectionPriv, hasSelection);
    }

    private applyDropDownVisibility(open: boolean): void
    {
        // PART_SelectionBox.Stroke is owned by the template's
        // `when(IsDropDownOpen)` trigger via DynamicResource — flipping
        // IsDropDownOpen here is enough to re-tint live and theme
        // switches re-resolve the brush.
        if (open) this.mountPopup();
        else      this.unmountPopup();
    }

    private mountPopup(): void
    {
        const pt = this['target'] as PresentationTarget | undefined;
        if (pt === undefined) return;
        if (this._popupMounted) return;
        // AttachOverlayChild: visual hop → target's OverlayLayer; logical
        // hop → THIS ComboBox so dropdown items inherit resources /
        // DataContext / inheritable DPs from us.
        this.AttachOverlayChild(this._popupHost);
        this._popupMounted = true;
        // Defensive — anchor needs a fresh arrange now that the host
        // is mounted, and the popup may have stale measure cached.
        this._popupHost.InvalidateMeasure();
        this._popupHost.InvalidateArrange();
    }

    private unmountPopup(): void
    {
        if (!this._popupMounted) return;
        this.DetachOverlayChild(this._popupHost);
        this._popupMounted = false;
    }
}
