import {
    ObservableCollection,
    type CollectionChange,
    type CollectionChangeListener,
    type IReadOnlyObservableCollection,
} from '../../runtime/index.js';
import { _registerCollectionViewCtor } from '../../framework/base/items-control.js';

// Direction of a single SortDescription's ordering. WPF spells these
// 'Ascending' / 'Descending'; using literal strings keeps the runtime
// surface friendly to .mu authoring (no enum import required).
export enum SortDirection
{
    Asc  = 'asc',
    Desc = 'desc',
}

// Key selector + direction. The key function returns whatever value
// should drive the comparison — typically a primitive (string / number /
// Date.valueOf()) or anything supporting `<`. Multiple SortDescriptions
// compose lexicographically: the first description's keys decide, ties
// go to the second, etc.
export class SortDescription
{
    constructor(
        public readonly key: (item: unknown) => unknown,
        public readonly direction: SortDirection = SortDirection.Asc,
    ) {}
}

// Grouping descriptor — captures a key function that maps each item to
// its group identity. Grouping is currently emitted as a flat surface
// (sorted within group, groups themselves in first-seen order) so
// downstream rendering can detect group transitions by reading the
// key on adjacent items. Real WPF GroupStyle / CollectionViewGroup
// containers are a future addition.
export class GroupDescription
{
    constructor(
        public readonly key: (item: unknown) => unknown,
        // Optional human-readable name surfaced on the
        // CollectionViewGroup record when grouping is active.
        public readonly name: string | undefined = undefined,
    ) {}
}

// CollectionViewGroup lives in its own file so ItemsControl can import
// it without triggering CollectionView's module-init bridge to
// ItemsControl. Re-exported here so external `from 'collection-view'`
// imports keep working.
export { CollectionViewGroup } from './collection-view-group.js';
import { CollectionViewGroup } from './collection-view-group.js';

// Listener signature for CurrentItem changes. Fires AFTER the
// CurrentItem / CurrentPosition update, so handlers reading the
// view see the post-change state.
export type CurrentChangedListener = () => void;

// Predicate handed to CollectionView.Filter — returns true to KEEP
// the item, false to drop it. Mirrors WPF's CollectionViewSource.Filter
// (which uses a FilterEventArgs callback; we keep the simpler functional
// form).
export type FilterPredicate = (item: unknown) => boolean;

// Live, observable projection of a source iterable. Layers Filter →
// Sort → Group transformations on top, exposes a CurrentItem cursor,
// and emits CollectionChange events when the projection changes
// (either because the source changed or because the view-state was
// mutated and Refresh was called).
//
// Constructed implicitly by ItemsControl.ItemsSource — consumers
// rarely instantiate directly. The recommended use is:
//
//   itemsControl.ItemsSource = someArray;
//   itemsControl.View!.SortDescriptions.Add(new SortDescription(d => d.Name));
//   itemsControl.View!.Filter = item => item.Tag === 'visible';
//
// The CollectionView auto-refreshes when SortDescriptions /
// GroupDescriptions mutate; setting Filter manually requires no
// Refresh call (the setter triggers re-projection). Other mutations
// (changing the predicate's captured state, for instance) DO require
// Refresh.
//
// Backed internally by an ObservableCollection<unknown> that hosts
// the projected items in their final order. Subscribe / iteration /
// Count all flow through that backing list.
export class CollectionView implements IReadOnlyObservableCollection<unknown>
{
    private readonly _projected: ObservableCollection<unknown> = new ObservableCollection<unknown>();
    private _sourceUnsub: (() => void) | undefined;
    private _filter: FilterPredicate | undefined;
    private _currentItem: unknown | undefined;
    private _currentPosition: number = -1;
    private readonly _currentListeners: CurrentChangedListener[] = [];

    public readonly SortDescriptions: ObservableCollection<SortDescription>
        = new ObservableCollection<SortDescription>();
    public readonly GroupDescriptions: ObservableCollection<GroupDescription>
        = new ObservableCollection<GroupDescription>();

    // Populated when GroupDescriptions is non-empty; undefined when
    // grouping is off. Re-created on every Refresh — consumers
    // observing this should subscribe through ItemsControl.GroupStyle
    // and/or refresh their view on CollectionChange.
    private _groups: CollectionViewGroup[] | undefined;

    public get Groups(): readonly CollectionViewGroup[] | undefined
    {
        return this._groups;
    }

    public get IsGrouping(): boolean
    {
        return this.GroupDescriptions.Count > 0;
    }

    constructor(public readonly SourceCollection: unknown)
    {
        // Auto-refresh whenever a sort / group descriptor list mutates.
        // Subscribers stay alive for the lifetime of the view (no
        // unsubscribe — the view IS the owner).
        this.SortDescriptions.Subscribe(() => this.Refresh());
        this.GroupDescriptions.Subscribe(() => this.Refresh());

        // Subscribe to source mutations when it's observable. Plain
        // arrays / iterables don't fire change events, so Refresh()
        // is the only way to pick up source mutations in that case.
        //
        // Forward each change incrementally — translate the source
        // event into the matching mutation on `_projected` rather than
        // tearing the projection down and rebuilding it. The blanket
        // Refresh() approach used to fire 'cleared' + N × 'inserted'
        // on every Add, which forced every realized container in the
        // bound ItemsControl to be recycled-then-rematerialized on
        // every mutation — wasteful, and a known source of bugs where
        // teardown side-effects (TwoWay binding writebacks, focus
        // restoration, ongoing drag captures) ran against the recycled
        // containers instead of being preserved.
        if (SourceCollection instanceof ObservableCollection)
        {
            this._sourceUnsub = SourceCollection.Subscribe(
                change => this.handleSourceChange(change as CollectionChange<unknown>),
            );
        }

        this.Refresh();
    }

    // Translate a single source-collection change into the equivalent
    // mutation(s) on `_projected`. Path varies with the active
    // projection settings:
    //
    //   * No Filter / Sort / Group   → forward verbatim (identity
    //                                   projection — source index ≡
    //                                   projected index).
    //   * Filter only                → translate source index to
    //                                   projected index, gate each
    //                                   item on the filter.
    //   * Sort  (with/without Filter)→ insert at the sorted position,
    //                                   remove by item identity, treat
    //                                   'moved' as a no-op (sort order
    //                                   doesn't depend on source
    //                                   position).
    //   * Group active               → fall back to a full Refresh.
    //                                   Incremental group projection is
    //                                   structural (parent group might
    //                                   need to be created / merged /
    //                                   removed); not worth optimizing
    //                                   until a grouping-heavy demo
    //                                   shows a profile.
    private handleSourceChange(change: CollectionChange<unknown>): void
    {
        if (this.IsGrouping)
        {
            this.Refresh();
            return;
        }
        const hasFilter = this._filter !== undefined;
        const hasSort   = this.SortDescriptions.Count > 0;

        switch (change.kind)
        {
            case 'inserted':
            {
                for (let i = 0; i < change.items.length; i++)
                {
                    const item = change.items[i]!;
                    if (hasFilter && !this._filter!(item)) continue;
                    const at = hasSort
                        ? this.findSortedInsertionIndex(item)
                        : this.translateSourceIndex(change.index + i);
                    this._projected.Insert(at, item);
                }
                this.reconcileCurrentAfterChange();
                return;
            }
            case 'removed':
            {
                for (const item of change.items)
                {
                    const idx = this._projected.IndexOf(item);
                    if (idx >= 0) this._projected.RemoveAt(idx);
                }
                this.reconcileCurrentAfterChange();
                return;
            }
            case 'replaced':
            {
                const oldIdx = this._projected.IndexOf(change.oldItem);
                if (oldIdx >= 0) this._projected.RemoveAt(oldIdx);
                if (!hasFilter || this._filter!(change.newItem))
                {
                    const at = hasSort
                        ? this.findSortedInsertionIndex(change.newItem)
                        : this.translateSourceIndex(change.index);
                    this._projected.Insert(at, change.newItem);
                }
                this.reconcileCurrentAfterChange();
                return;
            }
            case 'moved':
            {
                // Sort-active: projection order is independent of
                // source position, so the move is invisible. Same
                // result if the moved item was filtered out.
                if (hasSort) return;
                const fromIdx = this._projected.IndexOf(change.item);
                if (fromIdx < 0) return;
                const toIdx = this.translateSourceIndex(change.newIndex);
                this._projected.Move(fromIdx, toIdx);
                return;
            }
            case 'cleared':
            {
                this._projected.Clear();
                this.setCurrent(-1);
                return;
            }
            case 'reset':
            {
                // Source was mutated wholesale (ObservableCollection.Batch) —
                // re-project from scratch (Refresh itself emits one downstream
                // reset via its batched _projected rebuild).
                this.Refresh();
                return;
            }
        }
    }

    // Linear-scan insertion point for a sorted projection: returns
    // the first index where `item` compares < projected[i]. Falls back
    // to the end of the list when `item` is ≥ everything currently
    // projected. O(N) per insert — fine for the list sizes mural's
    // controls actually handle (hundreds to low thousands); a future
    // VirtualizingPanel-scale optimization would binary-search here.
    private findSortedInsertionIndex(item: unknown): number
    {
        const n = this._projected.Count;
        for (let i = 0; i < n; i++)
        {
            if (this.compareItemsForSort(item, this._projected.Get(i)) < 0)
            {
                return i;
            }
        }
        return n;
    }

    // Comparator using the current SortDescriptions chain — same
    // lexicographic precedence as applySort uses internally during a
    // full Refresh, but no per-Refresh key cache (called on the
    // incremental insertion path, where cache amortization wouldn't
    // pay off). Stable on equal keys (returns 0).
    private compareItemsForSort(a: unknown, b: unknown): number
    {
        for (let i = 0; i < this.SortDescriptions.Count; i++)
        {
            const desc = this.SortDescriptions.Get(i)!;
            const ka = desc.key(a);
            const kb = desc.key(b);
            let cmp = compareValues(ka, kb);
            if (desc.direction === SortDirection.Desc) cmp = -cmp;
            if (cmp !== 0) return cmp;
        }
        return 0;
    }

    // Map a source-collection index to the matching projected-collection
    // index, accounting for any items filtered out before that position.
    // Only meaningful when no Sort is active (sort breaks the source-
    // index ↔ projected-index correspondence). With no Filter either,
    // the mapping is identity.
    private translateSourceIndex(srcIdx: number): number
    {
        if (this._filter === undefined) return srcIdx;
        const src = this.SourceCollection;
        if (!(src instanceof ObservableCollection)) return srcIdx;
        let projectedIdx = 0;
        const upTo = Math.min(srcIdx, src.Count);
        for (let i = 0; i < upTo; i++)
        {
            if (this._filter(src.Get(i))) projectedIdx++;
        }
        return projectedIdx;
    }

    // Re-pin CurrentItem after an incremental mutation: keep the same
    // item if it survives, otherwise clamp to first / -1. Mirrors the
    // tail of Refresh — extracted here so the incremental path settles
    // the cursor the same way a full re-projection does.
    private reconcileCurrentAfterChange(): void
    {
        const cur = this._currentItem;
        if (cur !== undefined)
        {
            const idx = this._projected.IndexOf(cur);
            if (idx !== -1)
            {
                this.setCurrent(idx);
                return;
            }
        }
        this.setCurrent(this._projected.Count > 0 ? 0 : -1);
    }

    // ── IReadOnlyObservableCollection surface ───────────────────────

    public get Count(): number { return this._projected.Count; }

    public Get(index: number): unknown | undefined { return this._projected.Get(index); }

    public IndexOf(item: unknown): number { return this._projected.IndexOf(item); }

    public [Symbol.iterator](): Iterator<unknown>
    {
        return this._projected[Symbol.iterator]();
    }

    public Subscribe(listener: CollectionChangeListener<unknown>): () => void
    {
        return this._projected.Subscribe(listener);
    }

    // ── View-state ──────────────────────────────────────────────────

    public get Filter(): FilterPredicate | undefined { return this._filter; }

    public set Filter(value: FilterPredicate | undefined)
    {
        if (this._filter === value) return;
        this._filter = value;
        this.Refresh();
    }

    public get IsEmpty(): boolean { return this._projected.Count === 0; }

    // Re-evaluate Filter → Sort → Group from scratch against the
    // current source. Cheap to call: O(N log N) for sort, O(N) for
    // filter + project, O(N) for group transitions. Subscribers see
    // a single 'reset' event (the _projected rebuild is batched).
    public Refresh(): void
    {
        const sourceArray = this.materializeSource();
        const filtered = this._filter === undefined
            ? sourceArray
            : sourceArray.filter(this._filter);
        const sorted = this.SortDescriptions.Count === 0
            ? filtered
            : this.applySort(filtered);
        // Group-aware projection: build CollectionViewGroup records
        // off the sorted sequence when grouping is active. The flat
        // `_projected` collection still holds items in group-major
        // order (so non-GroupStyle ItemsControls still render the
        // sorted+grouped sequence as one flat list); `_groups` is the
        // structural view for GroupStyle-aware consumers.
        const projected = this.GroupDescriptions.Count === 0
            ? sorted
            : this.applyGroupingSort(sorted);
        this._groups = this.GroupDescriptions.Count === 0
            ? undefined
            : this.buildGroups(sorted);

        // Replace the projected list in one batch so subscribers see a single
        // 'reset' rather than 'cleared' + N x 'inserted' (the old churn — a
        // re-projection would otherwise recycle-then-rematerialize every
        // realized container in a bound ItemsControl).
        this._projected.Batch(() => {
            this._projected.Clear();
            for (const item of projected) this._projected.Add(item);
        });

        // Reconcile CurrentItem with the new projection. If the
        // previous CurrentItem is still present, keep it (its
        // position may have shifted); otherwise reset to the first
        // item (or undefined when empty).
        const cur = this._currentItem;
        if (cur !== undefined)
        {
            const idx = this._projected.IndexOf(cur);
            if (idx !== -1)
            {
                this.setCurrent(idx);
                return;
            }
        }
        this.setCurrent(this._projected.Count > 0 ? 0 : -1);
    }

    private materializeSource(): unknown[]
    {
        const src = this.SourceCollection;
        if (src === undefined) return [];
        if (Array.isArray(src)) return [...src];
        if (src instanceof ObservableCollection) return src.ToArray();
        // Generic iterable — readonly array spread.
        return [...(src as Iterable<unknown>)];
    }

    private applySort(items: readonly unknown[]): unknown[]
    {
        // Cache the keys per item per description: sorting calls the
        // comparator O(N log N) times — repeated key extraction on
        // hot fields hurts. The cache is per-Refresh.
        const cache = new Map<unknown, unknown[]>();
        const keyFor = (item: unknown, descIdx: number): unknown => {
            let row = cache.get(item);
            if (row === undefined)
            {
                row = new Array(this.SortDescriptions.Count);
                cache.set(item, row);
            }
            if (row[descIdx] === undefined)
            {
                const desc = this.SortDescriptions.Get(descIdx)!;
                row[descIdx] = desc.key(item);
            }
            return row[descIdx];
        };

        const arr = [...items];
        arr.sort((a, b) => {
            for (let i = 0; i < this.SortDescriptions.Count; i++)
            {
                const desc = this.SortDescriptions.Get(i)!;
                const ka = keyFor(a, i);
                const kb = keyFor(b, i);
                let cmp = compareValues(ka, kb);
                if (desc.direction === SortDirection.Desc) cmp = -cmp;
                if (cmp !== 0) return cmp;
            }
            return 0;
        });
        return arr;
    }

    // Recursively build the CollectionViewGroup tree for the current
    // sorted sequence. Walks the GroupDescriptions in order: at each
    // level the items are bucketed by the corresponding key. Bottom-
    // level groups (last GroupDescription) hold raw data records;
    // intermediate-level groups hold nested CollectionViewGroups.
    // Stable first-seen ordering at every level.
    private buildGroups(
        items: readonly unknown[],
        level: number = 0,
    ): CollectionViewGroup[]
    {
        const descs    = this.GroupDescriptions;
        const desc     = descs.Get(level)!;
        const isBottom = level === descs.Count - 1;

        const byKey: Map<unknown, unknown[]> = new Map();
        const order: unknown[] = [];
        for (const item of items)
        {
            const k = desc.key(item);
            let bucket = byKey.get(k);
            if (bucket === undefined)
            {
                bucket = [];
                byKey.set(k, bucket);
                order.push(k);
            }
            bucket.push(item);
        }
        return order.map(k => {
            const group = new CollectionViewGroup(k, level, isBottom);
            if (isBottom)
            {
                for (const it of byKey.get(k)!) group.Items.Add(it);
            }
            else
            {
                // Recurse into the next GroupDescription — produced
                // sub-groups land as the children of this group's
                // Items collection, matching WPF's
                // CollectionViewGroupInternal hierarchy shape.
                for (const sub of this.buildGroups(byKey.get(k)!, level + 1))
                {
                    group.Items.Add(sub);
                }
            }
            return group;
        });
    }

    private applyGroupingSort(items: readonly unknown[]): unknown[]
    {
        // Stable group-by: walk in current order; first occurrence
        // of each group key seeds the group, subsequent items join
        // their group's bucket. Buckets are emitted in first-seen
        // order, items within each bucket in their incoming order.
        const buckets: Map<unknown, unknown[]> = new Map();
        const order: unknown[] = [];
        const firstDesc = this.GroupDescriptions.Get(0)!;
        for (const item of items)
        {
            const k = firstDesc.key(item);
            let bucket = buckets.get(k);
            if (bucket === undefined)
            {
                bucket = [];
                buckets.set(k, bucket);
                order.push(k);
            }
            bucket.push(item);
        }
        const out: unknown[] = [];
        for (const k of order)
        {
            for (const it of buckets.get(k)!) out.push(it);
        }
        return out;
    }

    // ── Current-item cursor ────────────────────────────────────────

    public get CurrentItem(): unknown | undefined { return this._currentItem; }

    public get CurrentPosition(): number { return this._currentPosition; }

    public MoveCurrentTo(item: unknown): boolean
    {
        const idx = this._projected.IndexOf(item);
        if (idx === -1) return false;
        this.setCurrent(idx);
        return true;
    }

    public MoveCurrentToPosition(position: number): boolean
    {
        if (position < -1 || position >= this._projected.Count) return false;
        this.setCurrent(position);
        return true;
    }

    public MoveCurrentToFirst(): boolean
    {
        if (this._projected.Count === 0) { this.setCurrent(-1); return false; }
        this.setCurrent(0);
        return true;
    }

    public MoveCurrentToLast(): boolean
    {
        if (this._projected.Count === 0) { this.setCurrent(-1); return false; }
        this.setCurrent(this._projected.Count - 1);
        return true;
    }

    public MoveCurrentToNext(): boolean
    {
        const next = this._currentPosition + 1;
        if (next >= this._projected.Count) { this.setCurrent(this._projected.Count); return false; }
        this.setCurrent(next);
        return true;
    }

    public MoveCurrentToPrevious(): boolean
    {
        const prev = this._currentPosition - 1;
        if (prev < 0) { this.setCurrent(-1); return false; }
        this.setCurrent(prev);
        return true;
    }

    public SubscribeCurrentChanged(listener: CurrentChangedListener): () => void
    {
        this._currentListeners.push(listener);
        return () => {
            const idx = this._currentListeners.indexOf(listener);
            if (idx !== -1) this._currentListeners.splice(idx, 1);
        };
    }

    private setCurrent(position: number): void
    {
        // Clamp -1 (before first) / Count (after last) bracket positions —
        // useful for WPF parity where MoveCurrentToNext past the end
        // settles CurrentPosition at Count (and CurrentItem at undefined).
        const clamped = position < -1 ? -1
                      : position > this._projected.Count ? this._projected.Count
                      : position;
        const newItem = clamped >= 0 && clamped < this._projected.Count
            ? this._projected.Get(clamped)
            : undefined;
        const changed = this._currentPosition !== clamped || this._currentItem !== newItem;
        this._currentPosition = clamped;
        this._currentItem = newItem;
        if (changed)
        {
            // Snapshot iteration so a listener that mutates the list
            // mid-fire doesn't drop unfired neighbours.
            const snapshot = [...this._currentListeners];
            for (const l of snapshot) l();
        }
    }

    // Tear down the source subscription. Future Refresh calls still
    // re-project from the source (the subscription is for incremental
    // push, not for materialization), but the view will no longer
    // automatically refresh on source mutations.
    public dispose(): void
    {
        this._sourceUnsub?.();
        this._sourceUnsub = undefined;
    }

    // Reference back to the projected list — useful for diagnostics
    // and for tests that want to assert on the flattened projection
    // without iterating.
    public ToArray(): unknown[] { return this._projected.ToArray(); }
}

// Default comparator that handles strings (locale-aware), numbers,
// Dates (via Date.valueOf), bigints, and falls back to JS's `<` for
// anything else. undefined / null sort first (ascending order) so
// list rendering doesn't surprise consumers who didn't provide an
// explicit sort for missing keys.
function compareValues(a: unknown, b: unknown): number
{
    if (a === b) return 0;
    if (a === undefined || a === null) return -1;
    if (b === undefined || b === null) return  1;
    if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0;
    if (a instanceof Date && b instanceof Date) return a.valueOf() - b.valueOf();
    // Final fallback: string-coerce + compare. Stable enough for
    // arbitrary objects, won't throw.
    const sa = String(a);
    const sb = String(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
}

// Self-registration at module-load time — closes the items-control →
// collection-view circular dependency. ItemsControl.ItemsSource setter
// calls createCollectionView, which now finds this ctor and wraps the
// source. Any module that imports the Controls barrel loads collection-
// view (it's re-exported), so the registration runs before any
// ItemsSource assignment in user code.
_registerCollectionViewCtor(CollectionView as unknown as new (source: unknown) => CollectionView);
