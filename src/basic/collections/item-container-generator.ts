import { Visual } from '../../runtime/index.js';
import type { ItemsControl } from '../../framework/base/items-control.js';

// ── WPF-parity supporting types ─────────────────────────────────────

// Immutable (Index, Offset) cursor used by the session API. Mirrors
// System.Windows.Controls.Primitives.GeneratorPosition.
//
//   * Index = -1, Offset = 1   → "start of list" (before the first item).
//   * Index = i,  Offset = 0   → at the realized container whose
//                                 absolute item index is i.
//   * Index = i,  Offset = k   → k unrealized slots past container#i
//                                 (forward) or before it (backward).
//
// Today every realized container has a known absolute index (mural's
// non-virtualizing path realizes every item; the virtualizing path
// realizes a contiguous window) so the Index field doubles as the
// absolute item index. The Offset field is preserved for API parity
// with WPF and to keep the room open for future sparse-realization
// scenarios where the position arithmetic matters.
export class GeneratorPosition
{
    public static readonly StartOfList: GeneratorPosition =
        new GeneratorPosition(-1, 1);

    constructor(
        public readonly Index:  number,
        public readonly Offset: number,
    ) {}

    public Equals(other: GeneratorPosition): boolean
    {
        return this.Index === other.Index && this.Offset === other.Offset;
    }
}

export enum GeneratorDirection
{
    Forward  = 0,
    Backward = 1,
}

// Lifecycle of the generator's current state. Mirrors WPF's
// System.Windows.Controls.Primitives.GeneratorStatus.
//
//   * NotStarted          — initial / post-Clear state; no realization
//                            pass has been requested yet.
//   * GeneratingContainers — a StartAt session is active; consumers
//                            walking through GenerateNext.
//   * ContainersGenerated — all open sessions have been Disposed.
//   * Error                — reserved; not raised today (the generator
//                            doesn't have a failure mode that would
//                            need this state surfaced separately from
//                            an exception).
export enum GeneratorStatus
{
    NotStarted           = 'not-started',
    GeneratingContainers = 'generating',
    ContainersGenerated  = 'generated',
    Error                = 'error',
}

// What kind of mutation the generator is reporting. Mirrors WPF's
// NotifyCollectionChangedAction subset that ItemsChanged forwards.
export enum ItemsChangedAction
{
    Add     = 'add',
    Remove  = 'remove',
    Replace = 'replace',
    Move    = 'move',
    Reset   = 'reset',
}

// Payload of the ItemsChanged event. Mirrors WPF's ItemsChangedEventArgs.
export interface ItemsChangedArgs
{
    Action:      ItemsChangedAction;
    // Where in the item collection the change occurred. For Add: the
    // position the new items were INSERTED before. For Remove /
    // Replace: the position of the affected items. For Move: the
    // DESTINATION position (where the item ended up). For Reset:
    // ignored.
    Position:    GeneratorPosition;
    // For Move: the SOURCE position the item came from. Undefined for
    // every other action.
    OldPosition: GeneratorPosition | undefined;
    // How many DATA items were affected.
    ItemCount:   number;
    // How many of the affected items had realized containers (i.e. the
    // panel needs to know how many Visuals to actually tear down).
    ItemUICount: number;
}

// Session returned by StartAt — drives a sequence of GenerateNext
// calls. Walking is one-at-a-time; the session keeps a cursor that
// advances forward (or backward) by one absolute item index per call.
//
// The session intentionally doesn't expose Dispose-via-`Symbol.dispose`
// (no `using` syntax yet across mural's TS target). Callers wrap in
// `try { … } finally { session.dispose(); }`; Dispose is idempotent
// and a no-op today. Reserved for future StatusChanged events.
export class GenerationSession
{
    private cursor:    number;
    private disposed = false;

    constructor(
        private readonly generator: ItemContainerGenerator,
        startIndex: number,
        private readonly direction: GeneratorDirection,
    )
    {
        this.cursor = startIndex;
        this.generator['enterGeneration']();
    }

    // Realize the next container in the walk. Returns `undefined`
    // container when the cursor falls off either end of the items
    // collection — callers should stop iterating at that point.
    //
    // `isNewlyRealized` lets the caller distinguish "I built this
    // container right now and need to wire it into the panel" from
    // "this container was already realized (because I called
    // GenerateNext on the same item twice, or because the generator
    // had it stored from a prior session)". Only the newly-realized
    // path needs the panel.AddVisualChild + ItemsControl.AttachContainer
    // round-trip; existing containers are already in the tree.
    public GenerateNext(): { container: Visual | undefined; isNewlyRealized: boolean }
    {
        if (this.disposed)
        {
            return { container: undefined, isNewlyRealized: false };
        }
        const idx  = this.cursor;
        this.cursor += (this.direction === GeneratorDirection.Forward ? 1 : -1);
        const item = this.generator.itemsControl.ItemAt(idx);
        if (item === undefined)
        {
            return { container: undefined, isNewlyRealized: false };
        }
        const existing = this.generator.ContainerFromIndex(idx);
        if (existing !== undefined)
        {
            return { container: existing, isNewlyRealized: false };
        }
        // Pass-through: when the data item is ALREADY a Visual in the
        // container shape the ItemsControl expects, reuse it directly.
        // Mirrors WPF's IsItemItsOwnContainer + GetContainer split.
        const ic = this.generator.itemsControl;
        let container: Visual;
        if (item instanceof Visual && ic.IsItemItsOwnContainerOverride(item))
        {
            container = item;
        }
        else
        {
            // Prefer reuse of a pooled container so virtualizing
            // scrollers amortise allocation. When a recycled
            // container comes back from the pool, route through the
            // ItemsControl's rebind hook so per-item state (Content,
            // Header, DataContext) flips to the new item before
            // PrepareItemContainer re-applies styling.
            const recycled = this.generator.ClaimRecycled();
            if (recycled !== undefined)
            {
                container = recycled;
                ic.RebindContainerForItemOverride(container, item);
            }
            else
            {
                container = ic.GetContainerForItemOverride(item);
            }
        }
        this.generator.RegisterRealization(item, container, idx);
        return { container, isNewlyRealized: true };
    }

    public dispose(): void
    {
        if (this.disposed) return;
        this.disposed = true;
        this.generator['leaveGeneration']();
    }
}

// ── Generator ───────────────────────────────────────────────────────

// Bridge between an ItemsControl's data items and the Visual
// containers that present them. Mirrors WPF's IItemContainerGenerator —
// owned by ItemsControl, queried by ItemsPanel-side code (regular
// and virtualizing) to realize / recycle containers on demand.
//
// Role summary:
//
//   * Container factory   — Realize / StartAt+GenerateNext delegate
//                            construction to the ItemsControl's
//                            GetContainerForItemOverride hook, so
//                            subclasses (ListBox → ListBoxItem,
//                            TreeView → TreeViewItem) wrap items in
//                            their own container shape without
//                            subclassing the generator.
//   * Bidirectional map   — item ↔ container ↔ index. The index
//                            mapping powers ContainerFromIndex /
//                            IndexFromContainer, used by keyboard nav
//                            and the VSP's incremental updates.
//   * Recycle pool        — ClaimRecycled lets virtualizing panels
//                            reuse a previously-detached container
//                            instead of allocating a fresh one.
//   * Items change relay  — translates the ItemsControl's internal
//                            CollectionChange into WPF-style
//                            ItemsChanged events for panels and
//                            external observers to subscribe to.
//   * Prepare hook        — PrepareItemContainer wires
//                            ItemContainerStyle, AlternationIndex,
//                            and subclass-specific behavior onto a
//                            freshly-realized container. The hook
//                            sits on the generator (not the items
//                            control directly) so virtualizing panels
//                            can call it on the rows they realize
//                            without reaching past the abstraction.
export class ItemContainerGenerator
{
    private readonly itemToContainer:  Map<unknown, Visual> = new Map();
    private readonly containerToItem:  Map<Visual, unknown> = new Map();
    private readonly indexToContainer: Map<number, Visual>  = new Map();
    private readonly containerToIndex: Map<Visual, number>  = new Map();
    // Containers Recycle()'d but not yet collected. Drained by
    // ClaimRecycled (when a new container is needed) or wiped by Clear
    // (template swap invalidates pooled containers).
    private readonly recyclePool: Visual[] = [];
    // ItemsChanged subscribers. Append-only Set so Subscribe returns a
    // single-use disposer that removes its listener.
    private readonly itemsChangedListeners: Set<(args: ItemsChangedArgs) => void> = new Set();
    // StatusChanged subscribers — fire on every status transition
    // (NotStarted → GeneratingContainers → ContainersGenerated).
    private readonly statusChangedListeners: Set<() => void> = new Set();

    // Generator lifecycle state. Starts at NotStarted, flips to
    // GeneratingContainers when the first session opens, settles back
    // to ContainersGenerated when the last open session disposes.
    // Multi-session-safe via reference counting: a panel and an
    // observer can both StartAt without interfering.
    private status: GeneratorStatus = GeneratorStatus.NotStarted;
    private openSessionCount = 0;

    public get Status(): GeneratorStatus { return this.status; }

    constructor(public readonly itemsControl: ItemsControl) {}

    // ── Session API (WPF: IItemContainerGenerator.StartAt) ──────────

    // Begin a generation pass. The session walks from the position
    // forward (or backward), realizing containers via GenerateNext.
    // Each `using { … }` style block (manual try/finally in this TS
    // target) corresponds to one logical batch — today the only
    // observable effect of Dispose is that the session refuses further
    // GenerateNext calls; future StatusChanged events will fire here.
    public StartAt(
        position: GeneratorPosition = GeneratorPosition.StartOfList,
        direction: GeneratorDirection = GeneratorDirection.Forward,
    ): GenerationSession
    {
        return new GenerationSession(this, this.resolvePosition(position, direction), direction);
    }

    // Position → absolute item index, accounting for direction.
    // GeneratorPosition.StartOfList is (-1, 1) → index 0 (forward) or
    // last index (backward, when collection is non-empty). For an
    // arbitrary (i, offset): forward starts at i + offset, backward
    // starts at i - offset. Callers can stay agnostic of the
    // arithmetic — they just pass GeneratorPosition.StartOfList or
    // a position they got from elsewhere.
    private resolvePosition(p: GeneratorPosition, dir: GeneratorDirection): number
    {
        if (p.Index === -1 && p.Offset === 1)
        {
            // StartOfList — at the "front" for the chosen direction.
            return dir === GeneratorDirection.Forward
                ? 0
                : this.itemsControl.ItemCount() - 1;
        }
        const sign = dir === GeneratorDirection.Forward ? 1 : -1;
        return p.Index + sign * p.Offset;
    }

    // Convert an absolute item index to a GeneratorPosition that points
    // AT the realized container for that index (Offset = 0). Used by
    // panels that have an item index in hand and want a position to
    // pass into a future StartAt — e.g. "start realizing from index 12
    // forward."
    public GeneratorPositionFromIndex(index: number): GeneratorPosition
    {
        return new GeneratorPosition(index, 0);
    }

    public IndexFromGeneratorPosition(p: GeneratorPosition): number
    {
        return p.Index + p.Offset;
    }

    // ── Realization core (called by session AND by direct Realize) ──

    // Materialize a container for `item`, optionally at a known
    // absolute `index`. Idempotent — returns the existing container
    // when one's already realized. The direct entry point used by
    // ItemsControl's incremental handleItemsChange path and by old
    // JS callers; new code can prefer the session API.
    //
    // Pool semantics: Realize does NOT drain the recycle pool — that
    // would silently break "Recycle then Realize on the same item"
    // by handing back the just-recycled Visual under a fresh-looking
    // mapping. Pool drain is the session's job (GenerateNext) and
    // the explicit ClaimRecycled escape hatch.
    //
    // Index is optional. When provided, the (index ↔ container) map
    // updates so ContainerFromIndex / IndexFromContainer work. When
    // omitted, only the (item ↔ container) mapping is tracked —
    // suitable for index-agnostic callers like keyed lookups in
    // ListBoxItem composition tests.
    public Realize(item: unknown, index?: number): Visual
    {
        const existing = this.itemToContainer.get(item);
        if (existing !== undefined)
        {
            // Already realized — refresh the index slot when the
            // caller supplied one (e.g., after an insert/remove that
            // shifted positions).
            if (index !== undefined)
            {
                this.indexToContainer.set(index, existing);
                this.containerToIndex.set(existing, index);
            }
            return existing;
        }
        // Pass-through: the item already IS a container of the
        // expected shape (e.g., a ListBoxItem nested directly in
        // markup). Same fast path as GenerationSession.GenerateNext.
        const container = (item instanceof Visual
                       && this.itemsControl.IsItemItsOwnContainerOverride(item))
            ? item
            : this.itemsControl.GetContainerForItemOverride(item);
        this.itemToContainer.set(item, container);
        this.containerToItem.set(container, item);
        if (index !== undefined)
        {
            this.indexToContainer.set(index, container);
            this.containerToIndex.set(container, index);
        }
        return container;
    }

    // Internal hook used by GenerationSession after it acquires a
    // container (fresh or recycled). Establishes all three maps so any
    // subsequent ContainerFromItem / ContainerFromIndex /
    // IndexFromContainer lookup succeeds.
    public RegisterRealization(item: unknown, container: Visual, index: number): void
    {
        this.itemToContainer.set(item, container);
        this.containerToItem.set(container, item);
        this.indexToContainer.set(index, container);
        this.containerToIndex.set(container, index);
    }

    // Drop the (item, container) mapping AND push the container into
    // the recycle pool. Doesn't detach the Visual from its parent —
    // the caller (ItemsControl or virtualizing panel) owns tree
    // wiring. After Recycle the container is no longer reachable
    // through ContainerFromItem / ContainerFromIndex; the pool keeps
    // it warm for ClaimRecycled.
    public Recycle(container: Visual): void
    {
        const item  = this.containerToItem.get(container);
        const index = this.containerToIndex.get(container);
        if (item === undefined) return;
        this.itemToContainer.delete(item);
        this.containerToItem.delete(container);
        if (index !== undefined)
        {
            this.indexToContainer.delete(index);
            this.containerToIndex.delete(container);
        }
        // Bounded pool — 32 is enough to cover one screen of rows on
        // a virtualized list without holding the GC hostage on
        // large-list scenarios where churn dwarfs reuse. Tune later
        // if a profile demands it.
        if (this.recyclePool.length < 32)
        {
            this.recyclePool.push(container);
        }
    }

    // Pop a previously-recycled container, or undefined when the pool
    // is empty. The caller is responsible for re-binding it to a new
    // item (typically by setting DataContext, calling
    // PrepareItemContainer, etc.) and for re-attaching it to the panel.
    public ClaimRecycled(): Visual | undefined
    {
        return this.recyclePool.pop();
    }

    public get RecycledCount(): number
    {
        return this.recyclePool.length;
    }

    // ── PrepareItemContainer ────────────────────────────────────────

    // Apply ItemContainerStyle / AlternationIndex / subclass-specific
    // wiring to a freshly-realized container. Looks up the (item,
    // index) for `container` from the maps and routes through
    // ItemsControl.PrepareContainerForItemOverride.
    //
    // Called by:
    //   * ItemsControl.rebuildContainers — after each session-realized
    //     container is attached.
    //   * VirtualizingPanel subclasses — after realizing each row.
    //
    // Idempotent in the no-op sense — the underlying Prepare hook is
    // not, but consumers don't re-call it on already-prepared
    // containers in current code paths.
    public PrepareItemContainer(container: Visual): void
    {
        const item  = this.containerToItem.get(container);
        if (item === undefined) return;
        const idx   = this.containerToIndex.get(container) ?? -1;
        this.itemsControl.PrepareContainerForItemOverride(container, item, idx);
    }

    // ── Lookups (WPF: ContainerFromItem / IndexFromContainer / etc.) ──

    public ContainerFromItem(item: unknown): Visual | undefined
    {
        return this.itemToContainer.get(item);
    }

    public ItemFromContainer(container: Visual): unknown
    {
        return this.containerToItem.get(container);
    }

    public ContainerFromIndex(index: number): Visual | undefined
    {
        return this.indexToContainer.get(index);
    }

    // Returns -1 when the container isn't currently realized. Matches
    // WPF's IndexFromContainer return semantics (it returns -1 for
    // unmanaged containers).
    public IndexFromContainer(container: Visual): number
    {
        return this.containerToIndex.get(container) ?? -1;
    }

    public IsRealized(item: unknown): boolean
    {
        return this.itemToContainer.has(item);
    }

    public Clear(): void
    {
        this.itemToContainer.clear();
        this.containerToItem.clear();
        this.indexToContainer.clear();
        this.containerToIndex.clear();
        // Pool is per-mapping; clearing the mapping drops the pool
        // too (containers in the pool were tied to the old templates
        // / selectors and shouldn't be reused after a template swap).
        this.recyclePool.length = 0;
    }

    public get Count(): number
    {
        return this.itemToContainer.size;
    }

    // ── ItemsChanged event ──────────────────────────────────────────

    // Subscribe to ItemsChanged. Returns a disposer that removes the
    // listener. Multi-subscriber: virtualizing panels listen here to
    // shift their realized window without rebuilding, tooling / tests
    // can listen too without contending.
    public SubscribeItemsChanged(listener: (args: ItemsChangedArgs) => void): () => void
    {
        this.itemsChangedListeners.add(listener);
        return () => this.itemsChangedListeners.delete(listener);
    }

    // Fired by ItemsControl after it processes a CollectionChange —
    // the args' positions are already translated from
    // CollectionChange index space to GeneratorPosition.
    public RaiseItemsChanged(args: ItemsChangedArgs): void
    {
        for (const listener of [...this.itemsChangedListeners])
        {
            listener(args);
        }
    }

    // ── Status / StatusChanged ──────────────────────────────────────

    public SubscribeStatusChanged(listener: () => void): () => void
    {
        this.statusChangedListeners.add(listener);
        return () => this.statusChangedListeners.delete(listener);
    }

    // Called by GenerationSession's constructor when it starts. The
    // first concurrent session flips Status to GeneratingContainers;
    // nested / overlapping sessions just bump the open-count and
    // leave Status alone.
    private enterGeneration(): void
    {
        this.openSessionCount++;
        if (this.openSessionCount === 1)
        {
            this.setStatus(GeneratorStatus.GeneratingContainers);
        }
    }

    // Called by GenerationSession.Dispose when an open session ends.
    // When the last session disposes Status moves to
    // ContainersGenerated. Idempotent (Dispose on the session is too).
    private leaveGeneration(): void
    {
        if (this.openSessionCount === 0) return;
        this.openSessionCount--;
        if (this.openSessionCount === 0)
        {
            this.setStatus(GeneratorStatus.ContainersGenerated);
        }
    }

    private setStatus(next: GeneratorStatus): void
    {
        if (this.status === next) return;
        this.status = next;
        for (const l of [...this.statusChangedListeners]) l();
    }

    // Shift the index map by `delta` for every realized container at
    // or after `fromIndex`. Called from ItemsControl after an
    // insert / remove mutation — the items collection has shifted
    // but the (item, container) mapping is unchanged, only the
    // (index, container) projection needs updating.
    public ShiftIndicesFrom(fromIndex: number, delta: number): void
    {
        if (delta === 0) return;
        // Snapshot the affected (index, container) pairs, then
        // rewrite — mutating the maps mid-iteration is unsafe and the
        // realized set is small enough that a copy is fine.
        const affected: [number, Visual][] = [];
        for (const [idx, container] of this.indexToContainer)
        {
            if (idx >= fromIndex) affected.push([idx, container]);
        }
        for (const [idx, container] of affected)
        {
            this.indexToContainer.delete(idx);
            this.containerToIndex.delete(container);
        }
        for (const [idx, container] of affected)
        {
            const newIdx = idx + delta;
            this.indexToContainer.set(newIdx, container);
            this.containerToIndex.set(container, newIdx);
        }
    }
}
