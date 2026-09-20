import {
    MetaData,
    MuralBase,
    Element, Visual,
    type PointerEventArgs,
    type PropertyDescriptor,
} from '../../runtime/index.js';
import { Border } from '../../basic/border.js';
import { TextBlock } from '../../basic/text-block.js';
import { ContentControl } from '../base/content-control.js';
import { Selector, SelectionMode } from '../list/selector.js';

// M3 Segmented button — row of 2-5 connected segments that share a
// container. The whole row reads as a single control: corners round
// only on the leftmost / rightmost segments; middle segments stay
// square. Selection mode is set on the SegmentedButton (Single by
// default — matches M3 "single-select segmented button"; flip to
// Multiple for the "multi-select" variant).
//
// Each segment lives as a `SegmentedItem` container (extends
// ContentControl, parallel to ListBoxItem). Position — Start / Middle
// / End / Single — is auto-computed from the container's index and the
// item count and stamped onto the container via a read-only DP that
// templates trigger on for the per-position CornerRadius selection.
//
// Items collection: raw values get auto-wrapped in SegmentedItems with
// a TextBlock content, same convention as ListBox. A consumer who
// wants a richer chrome ships SegmentedItem instances directly.
export class SegmentedButton extends Selector
{
    static
    {
        MuralBase.OverrideMetadata(SegmentedButton, Element.DefaultStyleKeyKey,
            { default_value: SegmentedButton });
        // SelectionMode = Single matches M3's "single-select segmented
        // button" variant. The "multi-select" variant just flips this
        // DP — no separate class, no separate chrome.
        MuralBase.OverrideMetadata(SegmentedButton, Selector.SelectionModeKey,
            { default_value: SelectionMode.Single });
    }

    constructor()
    {
        super();
        this.applyDefaultStyle();
    }

    public override IsItemItsOwnContainerOverride(item: unknown): boolean
    {
        return item instanceof SegmentedItem;
    }

    public override GetContainerForItemOverride(item: unknown): Visual
    {
        const segment = new SegmentedItem();
        this.bindContainerData(segment, item);
        return segment;
    }

    public override RebindContainerForItemOverride(container: Visual, item: unknown): void
    {
        if (container instanceof SegmentedItem)
        {
            this.bindContainerData(container, item);
        }
        super.RebindContainerForItemOverride(container, item);
    }

    public override PrepareContainerForItemOverride(
        container: Visual, item: unknown, index: number,
    ): void
    {
        super.PrepareContainerForItemOverride(container, item, index);
        // Position can only be stamped after the container is realised
        // and pinned into logicalChildren — that's the state Prepare
        // runs in. Refresh ALL positions here (not just `index`) because
        // an insertion in the middle slides every subsequent neighbour's
        // Start/Middle/End classification by one slot.
        this.refreshPositions();
    }

    public override ClearContainerForItemOverride(container: Visual, item: unknown): void
    {
        super.ClearContainerForItemOverride(container, item);
        // A removal can promote a former Middle into End / Start; the
        // survivors need their Position re-stamped after the container
        // list shrinks.
        this.refreshPositions();
    }

    private bindContainerData(segment: SegmentedItem, item: unknown): void
    {
        segment.Tag = item;
        segment.DataContext = item;
        segment.Content = this.contentForItem(item);
    }

    private contentForItem(item: unknown): Visual
    {
        if (item instanceof Visual) return item;
        // Strings / numbers / bare Models fall through to a TextBlock
        // — matches ListBox's wrap-in-TextBlock convention so plain
        // arrays like `Items=["Day","Week","Month"]` render without
        // the caller supplying a DataTemplate.
        return new TextBlock(String(item));
    }

    // After each items-collection mutation, walk the realised container
    // list and stamp Position on every segment. Index → Position is a
    // pure function of (i, count); the refresh fires whenever a
    // container is added / removed / reused.
    private refreshPositions(): void
    {
        const containers = this.logicalChildren;
        const n          = containers.length;
        for (let i = 0; i < n; i++)
        {
            const c = containers[i];
            if (!(c instanceof SegmentedItem)) continue;
            c.SetPosition(positionFor(i, n));
        }
    }

}

// Position of a segment within its SegmentedButton row. Used by the
// default template to pick the per-corner CornerRadius via `when`
// triggers. `Single` covers the degenerate one-segment case (full
// rounding on both sides).
export enum SegmentedPosition
{
    Single = 'Single',
    Start  = 'Start',
    Middle = 'Middle',
    End    = 'End',
}

function positionFor(index: number, count: number): SegmentedPosition
{
    if (count <= 1)         return SegmentedPosition.Single;
    if (index === 0)        return SegmentedPosition.Start;
    if (index === count - 1) return SegmentedPosition.End;
    return SegmentedPosition.Middle;
}

// M3 Segmented item — one segment in a SegmentedButton. Selection
// mirrors with the owning Selector via attached IsSelected, same
// bidirectional pattern ListBoxItem uses. Position is set by the
// owning SegmentedButton when items change; the template observes
// Position via `when (Position = …)` triggers to pick CornerRadius.
export class SegmentedItem extends ContentControl
{
    public static readonly IsSelectedKey = MuralBase.RegisterProperty<boolean>(
        SegmentedItem, 'IsSelected', false, MetaData.Render);

    // Read-only — only SegmentedButton.refreshPositions writes it.
    private static readonly _PositionPriv = MuralBase.RegisterReadOnlyProperty<SegmentedPosition>(
        SegmentedItem, 'Position', SegmentedPosition.Single, MetaData.Render);
    public static readonly PositionKey = SegmentedItem._PositionPriv;

    static
    {
        MuralBase.OverrideMetadata(SegmentedItem, Element.DefaultStyleKeyKey,
            { default_value: SegmentedItem });
    }

    public get IsSelected(): boolean { return this.get_property_value(SegmentedItem.IsSelectedKey); }
    public set IsSelected(v: boolean) { this.set_property_value(SegmentedItem.IsSelectedKey, v); }

    public get Position(): SegmentedPosition { return this.get_property_value(SegmentedItem.PositionKey); }
    public SetPosition(v: SegmentedPosition): void
    {
        this.set_property_value_with_key(SegmentedItem._PositionPriv, v);
    }

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

    // Press / release gating — matches ListBoxItem's contract: press
    // here + release here counts as a click; release elsewhere
    // cancels. IsPressed clears BEFORE the Selector click so a click
    // handler reads the post-release state.
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
        const fromInstance = descriptor.Owner === SegmentedItem;
        if (!fromAttached && !fromInstance) return;
        this._syncingIsSelected = true;
        try
        {
            if (fromAttached)
            {
                this.set_property_value(SegmentedItem.IsSelectedKey, newValue as boolean);
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

// Silence "unused" — Border is referenced indirectly via the bundled
// default template (PART_OuterBorder, PART_StateLayer). Keeping the
// import documents the dependency for `grep` consumers.
void Border;
