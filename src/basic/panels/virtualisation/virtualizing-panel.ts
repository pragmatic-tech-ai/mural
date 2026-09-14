import {
    MetaData,
    MuralBase,
    Panel,
    Rect,
    type CollectionChange,
} from '../../../runtime/index.js';
import type { ItemsControl } from '../../../framework/base/items-control.js';

// Marker base class for panels that manage their own container
// realization rather than receiving them upfront from ItemsControl.
// When ItemsControl.ItemsPanel produces an instance of this, the
// ItemsControl skips its bulk Realize / AddVisualChild step and
// hands the panel a back-pointer (SetItemsOwner). The panel decides
// when to realize / recycle — typically based on a viewport — by
// asking the ItemsControl's Generator for containers on demand.
//
// Layout / render contract:
//   * MeasureOverride / ArrangeOverride compute which items are in
//     view, realize / recycle as needed, then measure / arrange just
//     the realized containers.
//   * OnItemsChanged is called by the ItemsControl whenever its
//     Items collection mutates; the panel re-evaluates realization.
//
// Containers realized through this path get their visual parent =
// the panel (via AddVisualChild) and their logical parent =
// the ItemsControl (via ItemsControl.AttachContainer). Same two-tree
// divergence as non-virtualized ItemsControl.
//
// `Viewport` lives on the base so the ScrollContentPresenter delegate
// path can push the host's viewport rect through a single
// `instanceof VirtualizingPanel` write without case-by-case knowledge
// of every concrete subclass (VirtualizingStackPanel,
// VirtualizingWrapPanel, …). Subclasses' MeasureOverride reads this
// DP to know which slice of items to realize. Default Rect.Zero so a
// standalone panel (without a hosting ScrollViewer) materializes
// nothing — the IScrollInfo getters still report ExtentWidth/Height
// from itemCount × cell size so the host can pick a sensible scroll
// extent on first pass.
// A realized container that hosts its OWN virtualizing child panel (an
// expanded TreeViewItem is the case). During arrange the parent panel calls
// SetOuterViewport on each realized container implementing this, handing it the
// shared scroll viewport (absolute, in the scroll-extent's coordinate space)
// and this container's absolute offset within that space. The host forwards a
// correctly-shifted viewport + origin to its nested panel so per-level
// virtualization composes down the tree. Kept as a duck-typed interface so the
// panel stays decoupled from TreeViewItem.
export interface INestedViewportHost
{
    SetOuterViewport(viewport: Rect, containerOffset: number): void;
}

export function isNestedViewportHost(v: unknown): v is INestedViewportHost
{
    return typeof (v as Partial<INestedViewportHost>)?.SetOuterViewport === 'function';
}

export abstract class VirtualizingPanel extends Panel
{
    public static readonly ViewportKey = MuralBase.RegisterProperty<Rect>(
        VirtualizingPanel, 'Viewport', Rect.Zero, MetaData.Measure);

    public get Viewport(): Rect { return this.get_property_value(VirtualizingPanel.ViewportKey); }
    public set Viewport(v: Rect) { this.set_property_value(VirtualizingPanel.ViewportKey, v); }

    private _itemsOwner: ItemsControl | undefined;

    // Owner-pointer accessor. Subclasses use this to read items, ask
    // the Generator for containers, and ask the ItemsControl to
    // attach / detach containers logically.
    protected get itemsOwner(): ItemsControl | undefined { return this._itemsOwner; }

    // Called by ItemsControl when this panel is installed as / removed
    // as the ItemsPanel. Subclasses invalidate measure so the next
    // layout pass realizes containers under the new owner.
    public SetItemsOwner(owner: ItemsControl | undefined): void
    {
        if (this._itemsOwner === owner) return;
        // Owner change invalidates every realized container — they
        // belonged to the previous owner's generator.
        this.RecycleAll();
        this._itemsOwner = owner;
        this.InvalidateMeasure();
    }

    // Drop every realized container (detach + recycle) while KEEPING the
    // current owner. Called by ItemsControl.rebuildContainers on a full
    // Items reset: that path clears the owner's Generator, so the panel's
    // realized map must be dropped in lockstep. If it isn't, the stale
    // entries outlive the cleared generator mappings and desync — the
    // panel keeps arranging the old containers (a recycled TreeViewItem
    // reused for a different node shows both rows overlapping), and a
    // later measure pass serves a generator-registered-but-never-attached
    // container into `realized`, which the next recycle sweep hands to
    // ItemsControl.DetachContainer → DetachLogical with a logical parent
    // of undefined → "Cannot detach an Element that is not a logical
    // child of this." Distinct from SetItemsOwner(undefined), which also
    // drops the owner (used only on a panel swap / teardown).
    public ResetRealization(): void
    {
        this.RecycleAll();
        this.InvalidateMeasure();
    }

    // Called by ItemsControl on every CollectionChange to Items
    // (insert / remove / replace / move / clear). Dispatches the
    // change kind through the per-kind protected hooks so realized
    // containers survive across mutations whenever possible — the
    // "recycle everything" path used to be the default and was both
    // wasteful (every survivor re-realized after every insert) and
    // visually janky (visible rows blink during the rebuild).
    //
    // Incremental dispatch (§ 10.4):
    //   * 'inserted'  → shift realized indices ≥ change.index by
    //                    +items.length; new in-range items realize on
    //                    the next measure pass.
    //   * 'removed'   → recycle realized containers in the removed
    //                    range; shift surviving indices > range down
    //                    by items.length.
    //   * 'replaced'  → rebind the realized container at change.index
    //                    against the new data item; no re-realization.
    //   * 'moved'     → full recycle (defer until a demo motivates the
    //                    item-identity-preserving move; the
    //                    refactoring cost outweighs the gain today).
    //   * 'cleared'   → RecycleAll().
    //
    // Subclasses with simpler invariants can still override
    // OnItemsChanged to opt out of the incremental dispatch entirely.
    public OnItemsChanged(change: CollectionChange<unknown>): void
    {
        const generator = this._itemsOwner?.Generator;
        switch (change.kind)
        {
            case 'inserted':
                // Shift the Generator's index map AND the panel's
                // realized map by the same delta — the (item, container)
                // mapping is unchanged, only the (index, container)
                // projection shifts. The next measure pass realizes
                // the freshly-inserted items in the viewport range.
                generator?.ShiftIndicesFrom(change.index, change.items.length);
                this.shiftRealizedIndices(change.index, change.items.length);
                this.InvalidateMeasure();
                break;
            case 'removed':
            {
                const lo = change.index;
                const hi = change.index + change.items.length;
                const victims: number[] = [];
                for (const idx of this.realizedIndices())
                {
                    if (idx >= lo && idx < hi) victims.push(idx);
                }
                // Recycle drops the (container, item, index) triple
                // from the Generator AND removes the container from
                // the panel side — both maps stay coherent.
                if (victims.length > 0) this.recycleAtIndices(victims);
                generator?.ShiftIndicesFrom(hi, -change.items.length);
                this.shiftRealizedIndices(hi, -change.items.length);
                this.InvalidateMeasure();
                break;
            }
            case 'replaced':
            {
                // If the slot was realized, drop the old container so
                // the next measure pass realizes the new item from
                // scratch. We don't try to re-prepare in place — the
                // data item has changed and the container's binding
                // state was for the old item.
                const victim = this.realizedIndexAt(change.index);
                if (victim !== undefined) this.recycleAtIndices([victim]);
                this.InvalidateMeasure();
                break;
            }
            case 'moved':
            case 'cleared':
            case 'reset':   // wholesale change (ObservableCollection.Batch)
            default:
                this.RecycleAll();
                this.InvalidateMeasure();
                break;
        }
    }

    /** Returns `index` when a container is currently realized at that
     *  index, otherwise undefined. Subclasses with a Map<number, Visual>
     *  realized store can return `index` when present in the map. */
    protected realizedIndexAt(_index: number): number | undefined { return undefined; }

    // Tear down every currently-realized container (visual detach,
    // logical detach, recycle in generator). Subclasses must call
    // this when their owner changes, when ItemsControl signals a
    // disruptive change (cleared), or when shutting down.
    protected abstract RecycleAll(): void;

    /** Snapshot of currently-realized item indices. Subclasses with a
     *  Map<number, Visual> typically return its keys. The default
     *  yields nothing — the abstract hooks below short-circuit on
     *  empty input, so a subclass that doesn't track realized indices
     *  gets a full recycle on every change. */
    protected realizedIndices(): Iterable<number> { return []; }

    /** Recycle the realized containers at the listed indices (visual
     *  detach + logical detach + generator recycle), then drop them
     *  from the subclass's realized map. Default no-op so subclasses
     *  with no realized state opt out cleanly. */
    protected recycleAtIndices(_indices: readonly number[]): void { /* default no-op */ }

    /** Re-key every realized index ≥ fromIndex by +delta (delta can
     *  be negative for the 'removed' path). Preserves the container
     *  instance — it's still the same Visual painting the same data
     *  item, just bound to a new logical position. */
    protected shiftRealizedIndices(_fromIndex: number, _delta: number): void { /* default no-op */ }

}
