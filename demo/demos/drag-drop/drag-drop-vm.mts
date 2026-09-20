// drag-drop demo VM — two lists, items move between them via drag.
//
// Follows the MVVM rules in CLAUDE.md strictly:
//   * Data + commands only; no view reaches, no Visual mutation, no
//     host globals, no Visual construction.
//   * BeginDragData on ItemVM is a function-valued DP that the
//     framework's IsDraggable latch reads via OnDragStart=$BeginDragData.
//   * Domain operations (MoveToLeft / MoveToRight) are plain methods —
//     called by the drop behavior, not via routed events directly.

import {
    DataObject, DragDropEffects,
    MetaData, MuralBase, ObservableCollection,
    type DragStartSpec,
} from '@pragmatic-tech-ai/mural/runtime';

// Format key the drag-data payload uses. Receivers query
// `args.Data.Has(FMT_ITEM)` and `args.Data.Get(FMT_ITEM)` to read
// the item id back out. Exported so the drop behavior reads the
// same constant.
export const FMT_ITEM = '@pragmatic-tech-ai/mural/list-item';

let _nextId = 1;

export class ItemVM extends MuralBase
{
    static IdKey            = MuralBase.RegisterProperty(ItemVM, 'Id',            '',         MetaData.None);
    static LabelKey         = MuralBase.RegisterProperty(ItemVM, 'Label',         '',         MetaData.None);
    // Bound from .mu via OnDragStart=$BeginDragData on the
    // ListBoxItem container. Returns the drag payload at trip
    // time. Stored as a DP so the binding pipeline pushes the
    // value to the framework's OnDragStart slot.
    static BeginDragDataKey = MuralBase.RegisterProperty<(() => DragStartSpec) | undefined>(ItemVM, 'BeginDragData', undefined,  MetaData.None);

    constructor(label: string)
    {
        super();
        const id = 'i' + (_nextId++);
        this.set_property_value(ItemVM.IdKey,    id);
        this.set_property_value(ItemVM.LabelKey, label);
        // Arrow function — `this` stays bound when the framework
        // invokes it via the IsDraggable latch.
        this.set_property_value(ItemVM.BeginDragDataKey, () => ({
            data:    new DataObject().Set(FMT_ITEM, this.Id),
            effects: DragDropEffects.Move,
        }));
    }

    get Id():            string { return this.get_property_value(ItemVM.IdKey); }
    get Label():         string { return this.get_property_value(ItemVM.LabelKey); }
    get BeginDragData(): (() => DragStartSpec) | undefined { return this.get_property_value(ItemVM.BeginDragDataKey); }
}

export class DragDropVM extends MuralBase
{
    static LeftItemsKey  = MuralBase.RegisterProperty<ObservableCollection<ItemVM> | undefined>(DragDropVM, 'LeftItems',  undefined,                       MetaData.None);
    static RightItemsKey = MuralBase.RegisterProperty<ObservableCollection<ItemVM> | undefined>(DragDropVM, 'RightItems', undefined,                       MetaData.None);
    static StatusKey     = MuralBase.RegisterProperty(DragDropVM, 'Status',     'Drag items between the lists.', MetaData.None);

    constructor()
    {
        super();
        const left  = new ObservableCollection<ItemVM>();
        const right = new ObservableCollection<ItemVM>();
        for (const label of ['Apple', 'Banana', 'Cherry', 'Date'])      left.Add(new ItemVM(label));
        for (const label of ['Eggplant', 'Fig', 'Grape'])               right.Add(new ItemVM(label));
        this.set_property_value(DragDropVM.LeftItemsKey,  left);
        this.set_property_value(DragDropVM.RightItemsKey, right);
    }

    get LeftItems():  ObservableCollection<ItemVM> | undefined { return this.get_property_value(DragDropVM.LeftItemsKey); }
    get RightItems(): ObservableCollection<ItemVM> | undefined { return this.get_property_value(DragDropVM.RightItemsKey); }
    get Status():     string { return this.get_property_value(DragDropVM.StatusKey); }
    set Status(v:     string) { this.set_property_value(DragDropVM.StatusKey, v); }

    // Move an item to the left list. No-op when the item is already
    // there (the drop behavior screens this case in DragOver and
    // suppresses the Effect, but we re-check at Drop time for safety).
    MoveToLeft(itemId: string): boolean
    {
        return this._move(itemId, this.RightItems, this.LeftItems, 'left');
    }

    MoveToRight(itemId: string): boolean
    {
        return this._move(itemId, this.LeftItems, this.RightItems, 'right');
    }

    _move(itemId: string, from: ObservableCollection<ItemVM> | undefined, to: ObservableCollection<ItemVM> | undefined, sideName: string): boolean
    {
        if (from === undefined || to === undefined) return false;
        let item: ItemVM | null = null;
        for (let i = 0; i < from.Count; i++)
        {
            const candidate = from.Get(i);
            if (candidate !== undefined && candidate.Id === itemId) { item = candidate; break; }
        }
        if (item === null) return false;          // not in source — already at destination
        from.Remove(item);
        to.Add(item);
        this.Status = `Moved "${item.Label}" to ${sideName}.`;
        return true;
    }

    // Helpers the drop behavior queries during DragOver to decide
    // whether to accept (avoids same-list "drop" that would be a
    // no-op).
    IsInLeft(itemId: string): boolean
    {
        const left = this.LeftItems;
        if (left === undefined) return false;
        for (let i = 0; i < left.Count; i++)
        {
            if (left.Get(i)?.Id === itemId) return true;
        }
        return false;
    }

    IsInRight(itemId: string): boolean
    {
        const right = this.RightItems;
        if (right === undefined) return false;
        for (let i = 0; i < right.Count; i++)
        {
            if (right.Get(i)?.Id === itemId) return true;
        }
        return false;
    }
}
