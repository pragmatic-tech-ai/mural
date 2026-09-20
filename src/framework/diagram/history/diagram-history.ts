import { type IHistoryLayer } from './history-layer.js';

interface LayerChange { layer: IHistoryLayer; before: unknown; after: unknown; }
interface HistoryEntry { label: string; changes: LayerChange[]; }

interface HistoryOptions
{
    cap?: number;
    scheduleMicrotask?: (fn: () => void) => void;
    // Macrotask scheduler for the settle window (default setTimeout 0). A settle
    // must outlast the layout pass (container re-fit, connector re-route) it wraps,
    // so it closes on a macrotask, not a microtask. Injected for deterministic tests.
    scheduleSettle?: (fn: () => void) => void;
}

// Per-document undo/redo. Records ref-counted transactions; each committed
// transaction that changed a layer becomes one reversible entry. In-memory,
// session-only. See docs/superpowers/specs/2026-08-26-undo-redo-design.md.
export class DiagramHistory
{
    private readonly layers: IHistoryLayer[] = [];
    private readonly undoStack: HistoryEntry[] = [];
    private readonly redoStack: HistoryEntry[] = [];
    private readonly appliedListeners = new Set<() => void>();
    private readonly cap: number;
    private readonly schedule: (fn: () => void) => void;
    private readonly scheduleSettle: (fn: () => void) => void;

    private depth = 0;
    private label = '';
    private silentDepth = 0;             // > 0 while system-driven projection runs
    private settleSilent = false;        // true during a debounced projection settle
    private settleToken = 0;             // invalidates a superseded settle release
    private before = new Map<IHistoryLayer, unknown>();
    // Last-committed snapshot per layer — the authoritative pre-edit "before".
    // The safety net (NotifyEdited) fires AFTER a mutation, so it cannot capture a
    // true before by re-reading the layer; it uses this baseline instead. Refreshed
    // after every commit / undo / redo and seeded when a layer registers.
    private readonly baseline = new Map<IHistoryLayer, unknown>();
    private suppressed = false;          // true while restoring (undo/redo)
    private autoScheduled = false;       // a microtask commit is pending

    constructor(opts?: HistoryOptions)
    {
        this.cap = opts?.cap ?? 100;
        this.schedule = opts?.scheduleMicrotask ?? ((fn) => queueMicrotask(fn));
        this.scheduleSettle = opts?.scheduleSettle ?? ((fn) => { setTimeout(fn, 0); });
    }

    public RegisterLayer(layer: IHistoryLayer): () => void
    {
        this.layers.push(layer);
        this.baseline.set(layer, layer.Capture());
        return () => {
            const i = this.layers.indexOf(layer);
            if (i >= 0) this.layers.splice(i, 1);
            this.baseline.delete(layer);
        };
    }

    // Re-read every layer into the baseline (the new last-good pre-edit state).
    private refreshBaseline(): void
    {
        for (const l of this.layers) this.baseline.set(l, l.Capture());
    }

    public get CanUndo(): boolean { return this.undoStack.length > 0; }
    public get CanRedo(): boolean { return this.redoStack.length > 0; }
    public get Depth(): number { return this.depth; }

    // Discard all history and re-baseline to the layers' current state. Called
    // after a load: a freshly opened document has no undoable past, and its loaded
    // content is the new pre-edit baseline — NOT a phantom "added everything" edit
    // (the deserialize's node adds fire the safety net against the empty
    // constructor baseline, which this clears).
    public Reset(): void
    {
        this.undoStack.length = 0;
        this.redoStack.length = 0;
        this.depth = 0;
        this.before = new Map();
        this.autoScheduled = false;      // abandon any pending safety-net commit
        this.settleSilent = false;       // close any open settle window
        this.settleToken++;              // invalidate its pending release
        this.refreshBaseline();
    }

    // Run `fn` with the safety net muted: edits it makes do NOT open an auto
    // transaction (NotifyEdited is a no-op). For system-driven projection — a
    // model→diagram binding redrawing derived content (labels, projected
    // connectors, re-minted containers) — which must not appear as user-undoable
    // history. Explicit brackets are UNAFFECTED: an edit bracketed by the caller
    // (a drop, a gesture) still records; this gates only the un-bracketed safety
    // net. Re-entrant (counted), and exception-safe.
    public RunSilently<T>(fn: () => T): T
    {
        this.silentDepth++;
        try { return fn(); }
        finally { this.silentDepth--; }
    }

    // Open (or re-arm) a debounced SILENT SETTLE window. A model→diagram binding's
    // projection is not just the synchronous rescan — it schedules async layout
    // reactions (a container re-fits to its new label, attached connectors re-route)
    // that fire the safety net AFTER any RunSilently / bracket scope has closed. A
    // plain synchronous mute misses them and they land as phantom geometry/connector
    // entries. Instead: mute the safety net now and keep it muted until the diagram
    // goes idle — every suppressed edit re-arms the window, so the whole settle (the
    // sync rescan PLUS its async tail) coalesces to nothing. The window closes one
    // macrotask after the last edit, when the settled diagram becomes the baseline.
    // Real user edits are bracketed and record regardless of this window.
    public BeginSettle(): void
    {
        if (this.suppressed) return;
        this.settleSilent = true;
        this.rearmSettle();
    }

    private rearmSettle(): void
    {
        const token = ++this.settleToken;
        this.scheduleSettle(() => {
            if (token !== this.settleToken) return;    // a later edit re-armed — stay open
            this.settleSilent = false;
            this.refreshBaseline();                    // the settled diagram is the new pre-edit baseline
        });
    }

    public Begin(label: string): void
    {
        if (this.suppressed) return;
        if (this.depth === 0)
        {
            this.label = label;
            // Explicit Begin runs PRE-edit, so the layers still hold the true
            // pre-edit state — capture "before" fresh. Trusting the baseline here
            // would inherit a stale value whenever the document changed outside any
            // tracked transaction (a node added directly, or a just-loaded doc):
            // the baseline still shows the OLD state, so the diff records a phantom
            // change that undo then "reverts" (e.g. deleting the node). The safety
            // net runs POST-edit and cannot re-read the before, so it alone falls
            // back to the baseline (see NotifyEdited).
            this.before = new Map();
            for (const l of this.layers) this.before.set(l, l.Capture());
        }
        this.depth++;
    }

    public Commit(): void
    {
        if (this.suppressed) return;
        if (this.depth === 0) return;
        this.depth--;
        if (this.depth > 0) return;
        const changes: LayerChange[] = [];
        for (const l of this.layers)
        {
            // Only diff layers we captured a "before" for at Begin. A layer that
            // registered mid-transaction (e.g. the model layer attaching during an
            // open safety-net transaction) has no before — skip it here; it records
            // from the next transaction (its baseline was seeded at registration).
            if (!this.before.has(l)) continue;
            const before = this.before.get(l);
            const after = l.Capture();
            if (!l.Equals(before, after)) changes.push({ layer: l, before, after });
        }
        this.before = new Map();
        this.refreshBaseline();                     // committed state is the new baseline
        if (changes.length === 0) return;           // no-op transaction
        this.undoStack.push({ label: this.label, changes });
        if (this.undoStack.length > this.cap) this.undoStack.shift();
        this.redoStack.length = 0;
    }

    public Abort(): void
    {
        if (this.depth === 0) return;
        this.depth = 0;
        this.before = new Map();
    }

    // Safety net: an edit happened outside any explicit transaction. Open one and
    // commit it at microtask end so a burst of synchronous edits coalesces.
    public NotifyEdited(): void
    {
        // Inside a settle window, keep muting AND re-arm it: continued churn holds
        // the window open until the diagram is quiet for a full macrotask.
        if (this.settleSilent) { this.rearmSettle(); return; }
        if (this.suppressed || this.silentDepth > 0 || this.depth > 0) return;
        if (this.autoScheduled) return;
        this.autoScheduled = true;
        // POST-edit: the layers already hold the edited state, so seed "before"
        // from the baseline (the last committed pre-edit snapshot) rather than a
        // fresh capture. This is the one path that legitimately uses the baseline.
        this.label = 'Edit';
        this.before = new Map(this.baseline);
        this.depth++;
        this.schedule(() => { this.autoScheduled = false; this.Commit(); });
    }

    // Notified after every Undo/Redo has restored + reconciled its layers. A
    // model→diagram binding subscribes to RE-PROJECT after a diagram-only restore
    // (a move/delete undo runs the diagram layer's _deserialize, which rebuilds
    // node instances and drops derived visuals, but carries no model layer to
    // reconcile) — so projected connectors and nesting are rebuilt against the
    // restored nodes. Returns an unsubscribe thunk.
    public AddAppliedListener(cb: () => void): () => void
    {
        this.appliedListeners.add(cb);
        return () => { this.appliedListeners.delete(cb); };
    }

    public Undo(): void
    {
        const entry = this.undoStack.pop();
        if (entry === undefined) return;
        this.applyChanges(entry.changes, (c) => c.before);
        this.redoStack.push(entry);
        this.fireApplied();
    }

    public Redo(): void
    {
        const entry = this.redoStack.pop();
        if (entry === undefined) return;
        this.applyChanges(entry.changes, (c) => c.after);
        this.undoStack.push(entry);
        this.fireApplied();
    }

    private fireApplied(): void
    {
        for (const cb of [...this.appliedListeners]) cb();
    }

    private applyChanges(changes: LayerChange[], pick: (c: LayerChange) => unknown): void
    {
        this.suppressed = true;
        try
        {
            for (const c of changes) c.layer.Restore(pick(c));
            for (const c of changes) c.layer.Reconcile?.();
        }
        finally
        {
            this.suppressed = false;
        }
        this.refreshBaseline();                     // restored state is the new baseline
    }
}
