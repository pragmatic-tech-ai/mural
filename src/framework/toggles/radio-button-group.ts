import {
    MetaData,
    MuralBase,
    Element, Visual,
    type PointerEventArgs,
    type PropertyDescriptor,
} from '../../runtime/index.js';
import { TextBlock } from '../../basic/text-block.js';
import { ContentControl } from '../base/content-control.js';
import { Selector, SelectionMode } from '../list/selector.js';

// M3 RadioButtonGroup — a single-select list of labelled radio rows.
//
// A Selector (like SegmentedButton), so it inherits the full WPF
// selection surface: bind `Items` to a plain array and read / write
// `SelectedIndex` / `SelectedItem` / `SelectedValue`. Each item auto-
// wraps into a `RadioButtonItem` container — a clickable "circle + label"
// row. The GROUP owns exclusion (Selector single-select), so unlike the
// bare RadioButton control there's no GroupName to wire: picking one row
// clears the rest through the Selector machinery.
//
// SelectionMode is pinned to Single — a radio group is single-select by
// definition. (The multi-select analogue is a CheckBox list, not a radio
// group.)
//
// Items collection: raw values (strings / numbers) auto-wrap in a
// RadioButtonItem with a TextBlock label, same convention as ListBox /
// SegmentedButton. A caller who wants richer row content ships
// RadioButtonItem instances directly.
export class RadioButtonGroup extends Selector
{
    static
    {
        MuralBase.OverrideMetadata(RadioButtonGroup, Element.DefaultStyleKeyKey,
            { default_value: RadioButtonGroup });
        // A radio group is single-select by definition — pin it so a
        // stray `SelectionMode = Multiple` can't turn it into a checkbox
        // list. (Selector already defaults Single; this documents intent.)
        MuralBase.OverrideMetadata(RadioButtonGroup, Selector.SelectionModeKey,
            { default_value: SelectionMode.Single });
    }

    constructor()
    {
        super();
        this.applyDefaultStyle();
    }

    public override IsItemItsOwnContainerOverride(item: unknown): boolean
    {
        return item instanceof RadioButtonItem;
    }

    public override GetContainerForItemOverride(item: unknown): Visual
    {
        const row = new RadioButtonItem();
        this.bindContainerData(row, item);
        return row;
    }

    public override RebindContainerForItemOverride(container: Visual, item: unknown): void
    {
        if (container instanceof RadioButtonItem)
        {
            this.bindContainerData(container, item);
        }
        super.RebindContainerForItemOverride(container, item);
    }

    private bindContainerData(row: RadioButtonItem, item: unknown): void
    {
        row.Tag = item;
        row.DataContext = item;
        row.Content = this.contentForItem(item);
    }

    // Hand the item to the row's Content. RadioButtonItem is a
    // ContentControl, so it resolves a data MuralBase through its
    // `DataTemplate [DataType=…]` (label / description / whatever the
    // author registered) and slots the result inside the ring row — a
    // bound `Items = $Options` list of view-models renders richly, not as
    // `[object Object]`. Primitives (a plain `["Small","Medium"]`) are
    // wrapped in a TextBlock label; ContentControl would stringify them
    // anyway, but the Content DP is typed `Visual | MuralBase`, so wrapping
    // here keeps the call type-clean.
    private contentForItem(item: unknown): Visual | MuralBase
    {
        if (item instanceof Visual) return item;
        if (item instanceof MuralBase) return item;
        return new TextBlock(String(item));
    }
}

// M3 RadioButtonItem — one "circle + label" row in a RadioButtonGroup.
// Extends ContentControl (parallel to SegmentedItem / ListBoxItem); the
// label is its Content. Selection mirrors bidirectionally with the owning
// Selector through the attached IsSelected DP, same pattern ListBoxItem
// and SegmentedItem use. The radio ring + dot chrome lives in the default
// template (DefaultRadioButtonItem), driven by `when (IsSelected)` — the
// row draws its own indicator rather than embedding a RadioButton control,
// matching how SegmentedItem draws its own segment chrome.
export class RadioButtonItem extends ContentControl
{
    public static readonly IsSelectedKey = MuralBase.RegisterProperty<boolean>(
        RadioButtonItem, 'IsSelected', false, MetaData.Render);

    static
    {
        MuralBase.OverrideMetadata(RadioButtonItem, Element.DefaultStyleKeyKey,
            { default_value: RadioButtonItem });
    }

    public get IsSelected(): boolean { return this.get_property_value(RadioButtonItem.IsSelectedKey); }
    public set IsSelected(v: boolean) { this.set_property_value(RadioButtonItem.IsSelectedKey, v); }

    private _pressOriginatedHere = false;
    private _syncingIsSelected   = false;

    constructor(content?: Visual | string)
    {
        super();
        if (content !== undefined)
        {
            this.Content = content instanceof Visual ? content : new TextBlock(content);
        }
        this.applyDefaultStyle();
    }

    // Press / release gating — matches ListBoxItem / SegmentedItem: press
    // here + release here counts as a click; release elsewhere cancels.
    // IsPressed clears BEFORE the Selector click so a click handler reads
    // the post-release state.
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
        const sel = Selector.FromContainer<Selector>(
            this, (v: Visual): v is Selector => v instanceof Selector);
        sel?.HandleContainerClick(this, args.Modifiers);
    }

    protected override OnPointerLeave(_args: PointerEventArgs): void
    {
        this._setIsPressed(false);
    }

    // Keep the attached Selector.IsSelected and the instance IsSelected DP
    // in lockstep so `when (IsSelected)` triggers fire whichever side the
    // Selector writes. The _syncingIsSelected guard breaks the echo.
    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue:   unknown,
        newValue:   unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (this._syncingIsSelected) return;
        if (descriptor.Name !== 'IsSelected') return;
        const fromAttached = descriptor.Owner === Selector;
        const fromInstance = descriptor.Owner === RadioButtonItem;
        if (!fromAttached && !fromInstance) return;
        this._syncingIsSelected = true;
        try
        {
            if (fromAttached)
            {
                this.set_property_value(RadioButtonItem.IsSelectedKey, newValue as boolean);
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
