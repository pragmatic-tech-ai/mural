// Notification payload describing a mutation to an ObservableCollection.
// Subscribers receive one of these for every Add / Insert / Remove /
// SetAt / Move / Clear. Mirrors WPF's NotifyCollectionChangedAction set.
//
// `moved` carries both old and new indices so listeners can shift
// container bookkeeping (item identity is preserved across the move,
// so containers can be re-positioned without re-realization).
// `reset` means the contents changed wholesale — a listener should re-read the
// collection and rebuild from scratch (WPF's NotifyCollectionChangedAction.Reset).
// Emitted by `Batch`, which coalesces a run of mutations into this one event.
export type CollectionChange<T> =
    | { kind: 'inserted'; index: number; items: readonly T[] }
    | { kind: 'removed';  index: number; items: readonly T[] }
    | { kind: 'replaced'; index: number; oldItem: T; newItem: T }
    | { kind: 'moved';    oldIndex: number; newIndex: number; item: T }
    | { kind: 'cleared' }
    | { kind: 'reset' };

export type CollectionChangeListener<T> = (change: CollectionChange<T>) => void;

// Subset of ObservableCollection's surface that doesn't allow mutation
// — consumers can iterate, count, lookup by index, look up an index by
// item, and subscribe to changes, but the typed surface hides Add /
// Insert / Remove / SetAt / Clear. Use as the public type when a
// container owns the collection and exposes it for reads but routes
// mutation through its own API (e.g., Panel.Children — mutation goes
// through Panel.AddChild / RemoveChild / InsertChild so Attach /
// Detach run alongside).
//
// Implemented structurally by ObservableCollection<T> — there's no
// runtime difference, just the typed restriction.
export interface IReadOnlyObservableCollection<T> extends Iterable<T>
{
    readonly Count: number;
    Get(index: number): T | undefined;
    IndexOf(item: T): number;
    Subscribe(listener: CollectionChangeListener<T>): () => void;
}

// Live-updating list. The headline feature is the per-mutation
// notification — subscribers (ItemsControl, future ListBox, debugging
// tools) react to add / remove / replace / clear events instead of
// rebuilding from scratch. Iteration is over the current contents in
// insertion order.
//
// WPF parity: same role as ObservableCollection<T>, simpler surface
// (no INotifyPropertyChanged on Count, no Move(), no event-args type
// — a discriminated union is enough for our needs).
//
// The internal array is never exposed by reference — Get / Count /
// iteration return read-only views. Mutations all funnel through the
// public methods so notifications fire consistently.
export class ObservableCollection<T> implements IReadOnlyObservableCollection<T>
{
    private readonly items: T[];
    private readonly listeners: CollectionChangeListener<T>[] = [];
    private _suspendDepth = 0;
    private _dirtyDuringSuspend = false;

    constructor(initial: readonly T[] = [])
    {
        this.items = [...initial];
    }

    public get Count(): number { return this.items.length; }

    public Get(index: number): T | undefined { return this.items[index]; }

    public IndexOf(item: T): number { return this.items.indexOf(item); }

    public [Symbol.iterator](): Iterator<T> { return this.items[Symbol.iterator](); }

    // Snapshot copy for callers that need a stable array; mutating the
    // returned array doesn't affect the collection.
    public ToArray(): T[] { return [...this.items]; }

    public Add(item: T): void
    {
        this.Insert(this.items.length, item);
    }

    public Insert(index: number, item: T): void
    {
        if (index < 0 || index > this.items.length)
        {
            throw new RangeError(`ObservableCollection.Insert: index ${index} out of range [0, ${this.items.length}]`);
        }
        this.items.splice(index, 0, item);
        this.notify({ kind: 'inserted', index, items: [item] });
    }

    public RemoveAt(index: number): T | undefined
    {
        if (index < 0 || index >= this.items.length) return undefined;
        const removed = this.items[index]!;
        this.items.splice(index, 1);
        this.notify({ kind: 'removed', index, items: [removed] });
        return removed;
    }

    public Remove(item: T): boolean
    {
        const i = this.items.indexOf(item);
        if (i < 0) return false;
        this.RemoveAt(i);
        return true;
    }

    public SetAt(index: number, item: T): T | undefined
    {
        if (index < 0 || index >= this.items.length) return undefined;
        const old = this.items[index]!;
        if (old === item) return old;
        this.items[index] = item;
        this.notify({ kind: 'replaced', index, oldItem: old, newItem: item });
        return old;
    }

    // Move the item at `oldIndex` to `newIndex`, shifting intervening
    // items to fill the gap. Item identity is preserved — the SAME
    // value moves position. WPF parity with ObservableCollection<T>.Move.
    //
    // Subscribers receive a `'moved'` event (not a remove + insert
    // pair) so consumers like ItemsControl can reorder their already-
    // realized container without re-running PrepareContainerForItemOverride.
    public Move(oldIndex: number, newIndex: number): void
    {
        if (oldIndex < 0 || oldIndex >= this.items.length)
        {
            throw new RangeError(`ObservableCollection.Move: oldIndex ${oldIndex} out of range [0, ${this.items.length})`);
        }
        if (newIndex < 0 || newIndex >= this.items.length)
        {
            throw new RangeError(`ObservableCollection.Move: newIndex ${newIndex} out of range [0, ${this.items.length})`);
        }
        if (oldIndex === newIndex) return;
        const item = this.items[oldIndex]!;
        this.items.splice(oldIndex, 1);
        this.items.splice(newIndex, 0, item);
        this.notify({ kind: 'moved', oldIndex, newIndex, item });
    }

    public Clear(): void
    {
        if (this.items.length === 0) return;
        this.items.length = 0;
        this.notify({ kind: 'cleared' });
    }

    // Coalesce arbitrary mutations into a single 'reset' notification.
    // Interior Add/Insert/Remove/Move/Clear events are suppressed; when the
    // outermost Batch completes AND at least one mutation was suppressed, one
    // { kind: 'reset' } is emitted. Nesting is supported (only the outermost
    // emits). The reset fires even if `mutate` throws, so a listener never
    // observes a permanently-suspended collection.
    public Batch(mutate: () => void): void
    {
        this._suspendDepth++;
        try
        {
            mutate();
        }
        finally
        {
            this._suspendDepth--;
            if (this._suspendDepth === 0 && this._dirtyDuringSuspend)
            {
                this._dirtyDuringSuspend = false;
                this.notify({ kind: 'reset' });
            }
        }
    }

    // Subscribe to change notifications. Returns an unsubscribe
    // function — call it to stop receiving notifications. Listeners
    // are invoked synchronously in registration order during the
    // mutating call.
    public Subscribe(listener: CollectionChangeListener<T>): () => void
    {
        this.listeners.push(listener);
        return () => {
            const i = this.listeners.indexOf(listener);
            if (i >= 0) this.listeners.splice(i, 1);
        };
    }

    private notify(change: CollectionChange<T>): void
    {
        // Inside a Batch, suppress the granular event and remember that
        // something changed — the outermost Batch emits one 'reset' at the end.
        if (this._suspendDepth > 0)
        {
            this._dirtyDuringSuspend = true;
            return;
        }
        // Snapshot listeners so an unsubscribe-during-notify doesn't
        // disrupt the iteration. Pre-existing test pattern in the
        // codebase (model.test.ts has similar concerns).
        for (const l of [...this.listeners])
        {
            l(change);
        }
    }
}
