import {
    Behavior,
    CompositeDisposable,
    DataObject,
    Disposable,
    DragDropEffects,
    DragEventArgs,
    MetaData,
    MuralBase,
    Visual,
} from '../../runtime/index.js';
import { ItemsControl } from '../base/items-control.js';
import { Hierarchy } from './hierarchy.js';
import { HierarchyItem } from './hierarchy-item.js';
import type { HierarchyHost } from './hierarchy-host.js';
import { HierarchyItemsDrop } from './hierarchy-drop.js';
import type { DropData } from './hierarchy-provider.js';
import type { ItemId } from './item-id.js';

// HierarchyDropBehavior — attaches to a TreeView (or any ItemsControl hosting
// HierarchyItem rows) and wires the receiver side of a hierarchy-items drag
// gesture onto the domain seam (`HierarchyHost.CanDrop` / `Drop`). Mirrors
// `ListReorderBehavior.OnAttached`'s wiring shape (src/basic/behaviors/
// list-reorder-behavior.ts:101-124): AllowDrop=true, then DragOver / Drop
// routed listeners, torn down via a CompositeDisposable in OnDetached.
//
// Payload decoding: the drag source is expected to stamp the DataObject with
// `data.Set(HierarchyItemsDrop.Kind, HierarchyItemsDrop.For(ids))` — i.e. the
// DataObject entry under the fixed format key IS a `DropData` (the same shape
// `IHierarchyProvider.CanAccept` consumes), decoded back to `ItemId[]` via
// `HierarchyItemsDrop.ItemsOf`.
//
// ItemId → HierarchyItem resolution: `Hierarchy` doesn't expose an id→item
// lookup (items are only reachable by walking Roots/Children or via the
// realized tree), so the dragged ids are cross-referenced against the live
// `Hierarchy.Selection` instead — the drag source is expected to have carried
// the CURRENTLY SELECTED items' ids, so this recovers the exact same items
// without needing a new lookup API. Flagged as a deliberate simplification
// for whoever wires the drag SOURCE side (see task report).
//
// Target-row resolution: TreeView rows stack strictly vertically (no wrap
// mode, unlike ListReorderBehavior's ItemsControl), so the cursor's HostY is
// hit-tested against each realized row container's vertical span (walked via
// GetVisualParent, same offset-accumulation shape as ListReorderBehavior's
// hostTop helper). A root row's span covers its WHOLE expanded subtree, so
// `resolveWithin` recurses depth-first into an expanded row's own realized
// children before accepting that row itself — this is what makes a drop over
// a NESTED descendant resolve to that descendant rather than its root
// ancestor. Each row's bound HierarchyItem comes off the `_itemsControlData`
// stamp ItemsControl.PrepareContainerForItemOverride writes on every realized
// container (the same accessor HierarchyTreeBehavior and tree-view.ts's own
// `dataOf` read).
export class HierarchyDropBehavior extends Behavior
{
    private static readonly DragOverEvent  = 'DragOver';
    private static readonly DropEvent      = 'Drop';

    private static readonly AttachErrorMessage =
        'HierarchyDropBehavior must attach to an ItemsControl (or subclass)';

    public static readonly HostKey = MuralBase.RegisterProperty<HierarchyHost | undefined>(
        HierarchyDropBehavior, 'Host', undefined, MetaData.None);

    public static readonly HierarchyKey = MuralBase.RegisterProperty<Hierarchy | undefined>(
        HierarchyDropBehavior, 'Hierarchy', undefined, MetaData.None);

    public get Host(): HierarchyHost | undefined { return this.get_property_value(HierarchyDropBehavior.HostKey); }
    public set Host(v: HierarchyHost | undefined) { this.set_property_value(HierarchyDropBehavior.HostKey, v); }

    public get Hierarchy(): Hierarchy | undefined { return this.get_property_value(HierarchyDropBehavior.HierarchyKey); }
    public set Hierarchy(v: Hierarchy | undefined) { this.set_property_value(HierarchyDropBehavior.HierarchyKey, v); }

    private readonly _subscriptions = new CompositeDisposable();

    public override OnAttached(visual: Visual): void
    {
        if (!(visual instanceof ItemsControl))
        {
            throw new Error(HierarchyDropBehavior.AttachErrorMessage);
        }
        visual.AllowDrop = true;

        const onDragOver = (raw: unknown): void => this.handleDragOver(visual, raw as DragEventArgs);
        visual.AddRoutedEventListener(HierarchyDropBehavior.DragOverEvent, onDragOver);
        this._subscriptions.add(new Disposable(() =>
            visual.RemoveRoutedEventListener(HierarchyDropBehavior.DragOverEvent, onDragOver)));

        const onDrop = (raw: unknown): void => this.handleDrop(visual, raw as DragEventArgs);
        visual.AddRoutedEventListener(HierarchyDropBehavior.DropEvent, onDrop);
        this._subscriptions.add(new Disposable(() =>
            visual.RemoveRoutedEventListener(HierarchyDropBehavior.DropEvent, onDrop)));
    }

    public override OnDetached(_visual: Visual): void
    {
        this._subscriptions.dispose();
    }

    private handleDragOver(host: ItemsControl, args: DragEventArgs): void
    {
        const dragged = this.resolveDragged(args.Data);
        if (dragged === undefined) return;
        const target = HierarchyDropBehavior.resolveTarget(host, args.HostY);
        if (target === undefined) return;
        const hierarchyHost = this.Host;
        if (hierarchyHost === undefined) return;
        if (hierarchyHost.CanDrop(target, dragged))
        {
            args.Effect = DragDropEffects.Move;
        }
    }

    private handleDrop(host: ItemsControl, args: DragEventArgs): void
    {
        const dragged = this.resolveDragged(args.Data);
        if (dragged === undefined) return;
        const target = HierarchyDropBehavior.resolveTarget(host, args.HostY);
        if (target === undefined) return;
        const hierarchyHost = this.Host;
        if (hierarchyHost === undefined) return;
        if (!hierarchyHost.CanDrop(target, dragged)) return;
        hierarchyHost.Drop(target, dragged);
    }

    // Decodes the dragged ItemIds off the DataObject (if the payload is a
    // hierarchy-items drop at all) and resolves them against the live
    // Hierarchy's current Selection — see the class doc comment for why
    // Selection is the resolution source rather than an id→item lookup.
    private resolveDragged(data: DataObject): readonly HierarchyItem[] | undefined
    {
        const ids = HierarchyDropBehavior.decodeDraggedIds(data);
        if (ids === undefined || ids.length === 0) return undefined;
        const hierarchy = this.Hierarchy;
        if (hierarchy === undefined) return undefined;
        const idSet = new Set<ItemId>(ids);
        const dragged = hierarchy.Selection.ToArray().filter(item => idSet.has(item.Id));
        return dragged.length > 0 ? dragged : undefined;
    }

    private static decodeDraggedIds(data: DataObject): readonly ItemId[] | undefined
    {
        if (!data.Has(HierarchyItemsDrop.Kind)) return undefined;
        const drop = data.Get<DropData>(HierarchyItemsDrop.Kind);
        return drop === undefined ? undefined : HierarchyItemsDrop.ItemsOf(drop);
    }

    // Hit-tests `hostY` against each realized root row's subtree span
    // (host-coordinate, via GetVisualParent offset accumulation) and
    // resolves depth-first within it — see `resolveWithin`.
    private static resolveTarget(host: ItemsControl, hostY: number): HierarchyItem | undefined
    {
        for (const container of host.logicalChildren)
        {
            const target = HierarchyDropBehavior.resolveWithin(container, hostY);
            if (target !== undefined) return target;
        }
        return undefined;
    }

    // Depth-first hit test against a single row's subtree span. A row's
    // `ArrangedRect.Height` spans its WHOLE expanded subtree (header + every
    // nested descendant), not just its own header band, so a hit anywhere
    // under an expanded row would wrongly resolve to that row unless its
    // (deeper) children are tried first — an expanded row's children sit
    // contiguously right below its own header inside the same subtree span,
    // so whatever isn't claimed by a child's span IS that row's own header
    // band. This is why checking children first, and only when the row is
    // realized as an ItemsControl AND expanded, is sufficient — no separate
    // header-height measurement is needed.
    private static resolveWithin(container: Visual, hostY: number): HierarchyItem | undefined
    {
        const top = HierarchyDropBehavior.topOffsetOf(container);
        const bottom = top + container.ArrangedRect.Height;
        if (hostY < top || hostY >= bottom) return undefined;

        if (container instanceof ItemsControl && HierarchyDropBehavior.isExpanded(container))
        {
            for (const child of container.logicalChildren)
            {
                const nested = HierarchyDropBehavior.resolveWithin(child, hostY);
                if (nested !== undefined) return nested;
            }
        }
        return HierarchyDropBehavior.itemOf(container);
    }

    // Duck-typed read of TreeViewItem.IsExpanded (tree-view.ts:782) — this
    // file stays decoupled from the concrete TreeViewItem type (same
    // decoupling HierarchyTreeBehavior uses for row-template reads), since
    // `host` is any ItemsControl hosting HierarchyItem rows, not necessarily
    // a TreeView.
    private static isExpanded(container: ItemsControl): boolean
    {
        return (container as unknown as { IsExpanded?: boolean }).IsExpanded === true;
    }

    private static topOffsetOf(visual: Visual): number
    {
        let y = 0;
        let cur: Visual | undefined = visual;
        while (cur !== undefined)
        {
            y += cur.ArrangedRect.Y;
            cur = cur.GetVisualParent();
        }
        return y;
    }

    // Reads the data item ItemsControl.PrepareContainerForItemOverride stamps
    // on every realized container (`_itemsControlData`) — the same accessor
    // tree-view.ts's own `dataOf` and HierarchyTreeBehavior read.
    private static itemOf(container: Visual): HierarchyItem | undefined
    {
        const data = (container as unknown as { _itemsControlData?: unknown })._itemsControlData;
        return data instanceof HierarchyItem ? data : undefined;
    }
}
