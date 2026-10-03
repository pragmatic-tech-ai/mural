import {
    Behavior,
    DataObject,
    DragDropEffects,
    MetaData,
    MuralBase,
    Visual,
    type DragStartSpec,
} from '../../runtime/index.js';
import { ItemsControl } from '../base/items-control.js';
import { Hierarchy } from './hierarchy.js';
import { HierarchyItem } from './hierarchy-item.js';
import { HierarchyItemsDrop } from './hierarchy-drop.js';
import type { ItemId } from './item-id.js';

// HierarchyDragBehavior — attaches to a TreeView (or any ItemsControl hosting
// HierarchyItem rows) and wires the SOURCE side of a hierarchy-items drag
// gesture — the missing half of `HierarchyDropBehavior` (hierarchy-drop-
// behavior.ts), which already decodes a payload stamped under
// `HierarchyItemsDrop.Kind` but has nothing stamping it today.
//
// Attachment shape mirrors `HierarchyDropBehavior`: a single `Hierarchy` DP
// (no `Host` — a drag source only needs the live `Selection`, not
// `CanDrop`/`Drop`).
//
// Per-row wiring: `ListReorderBehavior`'s own doc comment (list-reorder-
// behavior.ts:22-31) treats `IsDraggable=true` + an `OnDragStart` factory on
// each row's container as the CONSUMER's responsibility (typically a markup
// `ItemContainerStyle` setter against a per-row VM). A `HierarchyItem` row
// container has no such per-row VM to hang a callback off, so this behavior
// wires every realized row container directly — the Element-level latch
// (`IsDraggable`/`OnDragStart`, element.ts:1552-1561, 1821-1878) is the same
// one `ListReorderBehavior`'s comment describes, just driven from TS instead
// of markup.
//
// Container coverage: `PrepareContainerForItemOverride` stamps
// `_itemsControlData` on every realized row (items-control.ts:665) and fires
// `AddContainerPreparedListener` for every future realization — but late
// registration does NOT replay already-realized rows (items-control.ts:
// 703-709), so `OnAttached` ALSO walks the host's current `logicalChildren`
// once, same as hierarchy.template.mu's ordering ruling already requires for
// `HierarchyTreeBehavior`/`HierarchyDropBehavior`.
//
// Selection-gated drag: a drag only starts when the PRESSED row is itself
// part of the current `Selection` — and then drags the WHOLE selection, not
// just the pressed row. Mirrors `HierarchyDropBehavior.resolveDragged`'s own
// choice to cross-reference dragged ids against `Selection` rather than a
// dedicated id->item lookup (hierarchy-drop-behavior.ts's doc comment).
// Pressing an UNSELECTED row returns `null` (no drag starts) — extending that
// to "drag just this row" is left to a future task.
export class HierarchyDragBehavior extends Behavior
{
    private static readonly AttachErrorMessage =
        'HierarchyDragBehavior must attach to an ItemsControl (or subclass)';

    public static readonly HierarchyKey = MuralBase.RegisterProperty<Hierarchy | undefined>(
        HierarchyDragBehavior, 'Hierarchy', undefined, MetaData.None);

    public get Hierarchy(): Hierarchy | undefined { return this.get_property_value(HierarchyDragBehavior.HierarchyKey); }
    public set Hierarchy(v: Hierarchy | undefined) { this.set_property_value(HierarchyDragBehavior.HierarchyKey, v); }

    private readonly _onContainerPrepared = (container: Visual): void => this.wireContainer(container);

    public override OnAttached(visual: Visual): void
    {
        if (!(visual instanceof ItemsControl))
        {
            throw new Error(HierarchyDragBehavior.AttachErrorMessage);
        }
        for (const container of visual.logicalChildren)
        {
            this.wireContainer(container);
        }
        visual.AddContainerPreparedListener(this._onContainerPrepared);
    }

    public override OnDetached(visual: Visual): void
    {
        if (visual instanceof ItemsControl)
        {
            visual.RemoveContainerPreparedListener(this._onContainerPrepared);
            for (const container of visual.logicalChildren)
            {
                this.unwireContainer(container);
            }
        }
    }

    private wireContainer(container: Visual): void
    {
        container.IsDraggable = true;
        container.OnDragStart = (source) => this.computeDragStart(source);
    }

    private unwireContainer(container: Visual): void
    {
        container.IsDraggable = false;
        container.OnDragStart = undefined;
    }

    // The shared `OnDragStart` body every wired container's callback
    // delegates to. Resolves the pressed row's bound HierarchyItem off the
    // `_itemsControlData` stamp (the same accessor `HierarchyDropBehavior.
    // itemOf` and `HierarchyTreeBehavior` read), then — only when that item
    // is part of the live Selection — stamps the WHOLE selection's ids onto
    // a fresh DataObject under `HierarchyItemsDrop.Kind`. Returns `null`
    // (per `DragStartCallback`'s contract) to suppress the drag whenever
    // there's no bound item, no Hierarchy, or the pressed row isn't selected.
    private computeDragStart(source: Visual): DragStartSpec | null
    {
        const item = HierarchyDragBehavior.itemOf(source);
        if (item === undefined) return null;
        const hierarchy = this.Hierarchy;
        if (hierarchy === undefined) return null;
        const selection = hierarchy.Selection.ToArray();
        if (!selection.includes(item)) return null;
        const ids: readonly ItemId[] = selection.map(i => i.Id);
        const data = new DataObject().Set(HierarchyItemsDrop.Kind, HierarchyItemsDrop.For(ids));
        return { data, effects: DragDropEffects.Move };
    }

    // Reads the data item ItemsControl.PrepareContainerForItemOverride stamps
    // on every realized container (`_itemsControlData`) — the same accessor
    // `HierarchyDropBehavior.itemOf` reads.
    private static itemOf(container: Visual): HierarchyItem | undefined
    {
        const data = (container as unknown as { _itemsControlData?: unknown })._itemsControlData;
        return data instanceof HierarchyItem ? data : undefined;
    }
}
