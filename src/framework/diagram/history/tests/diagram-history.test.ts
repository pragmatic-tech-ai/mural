import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DiagramHistory } from '../diagram-history.js';
import { HistoryLayerId, type IHistoryLayer } from '../history-layer.js';

// A fake layer over a single mutable string cell.
function cellLayer(id: HistoryLayerId, get: () => string, set: (v: string) => void): IHistoryLayer
{
    return { Id: id, Capture: () => get(), Equals: (a, b) => a === b, Restore: (s) => set(s as string) };
}

describe('DiagramHistory', () => {
    test('a transaction that changes a layer produces one undoable entry', () => {
        let cell = 'a';
        const h = new DiagramHistory();
        h.RegisterLayer(cellLayer(HistoryLayerId.Diagram, () => cell, (v) => { cell = v; }));

        h.Begin('edit'); cell = 'b'; h.Commit();
        assert.equal(h.CanUndo, true);
        assert.equal(h.CanRedo, false);

        h.Undo();
        assert.equal(cell, 'a', 'undo restored the before-snapshot');
        assert.equal(h.CanRedo, true);

        h.Redo();
        assert.equal(cell, 'b', 'redo restored the after-snapshot');
    });

    test('nested Begin/Commit joins into one entry', () => {
        let cell = 'a';
        const h = new DiagramHistory();
        h.RegisterLayer(cellLayer(HistoryLayerId.Diagram, () => cell, (v) => { cell = v; }));
        h.Begin('outer'); cell = 'b'; h.Begin('inner'); cell = 'c'; h.Commit(); h.Commit();
        h.Undo();
        assert.equal(cell, 'a', 'the whole nested transaction undoes as one');
        assert.equal(h.CanUndo, false);
    });

    test('a no-op transaction pushes nothing', () => {
        let cell = 'a';
        const h = new DiagramHistory();
        h.RegisterLayer(cellLayer(HistoryLayerId.Diagram, () => cell, (v) => { cell = v; }));
        h.Begin('noop'); h.Commit();
        assert.equal(h.CanUndo, false);
    });

    test('a new edit after undo clears redo', () => {
        let cell = 'a';
        const h = new DiagramHistory();
        h.RegisterLayer(cellLayer(HistoryLayerId.Diagram, () => cell, (v) => { cell = v; }));
        h.Begin('1'); cell = 'b'; h.Commit();
        h.Undo();
        assert.equal(h.CanRedo, true);
        h.Begin('2'); cell = 'c'; h.Commit();
        assert.equal(h.CanRedo, false, 'redo cleared by the new edit');
    });

    test('cap evicts the oldest entry', () => {
        let cell = 'x0';
        const h = new DiagramHistory({ cap: 2 });
        h.RegisterLayer(cellLayer(HistoryLayerId.Diagram, () => cell, (v) => { cell = v; }));
        for (const v of ['x1', 'x2', 'x3']) { h.Begin('e'); cell = v; h.Commit(); }
        // Only the last 2 are retained → can undo twice, landing on x1 (not x0).
        h.Undo(); h.Undo();
        assert.equal(cell, 'x1', 'oldest (x0) transition was evicted');
        assert.equal(h.CanUndo, false);
    });

    test('Reconcile runs once per changed layer after restore', () => {
        let cell = 'a'; let reconciles = 0;
        const h = new DiagramHistory();
        h.RegisterLayer({ Id: HistoryLayerId.Model, Capture: () => cell, Equals: (a, b) => a === b,
            Restore: (s) => { cell = s as string; }, Reconcile: () => { reconciles++; } });
        h.Begin('m'); cell = 'b'; h.Commit();
        h.Undo();
        assert.equal(cell, 'a');
        assert.equal(reconciles, 1, 'Reconcile fired exactly once on undo');
    });

    test('a layer registered mid-transaction is not spuriously recorded', () => {
        let a = 'a0';
        let b = 'b0';
        const h = new DiagramHistory();
        h.RegisterLayer(cellLayer(HistoryLayerId.Diagram, () => a, (v) => { a = v; }));

        h.Begin('edit');
        a = 'a1';
        // A second layer registers WHILE the transaction is open (its "before" was
        // never captured at Begin) and its value differs from any baseline.
        h.RegisterLayer(cellLayer(HistoryLayerId.Model, () => b, (v) => { b = v; }));
        b = 'b1';
        h.Commit();

        h.Undo();
        assert.equal(a, 'a0', 'the layer captured at Begin undoes');
        assert.equal(b, 'b1', 'the mid-transaction layer is left untouched (not wiped)');
    });

    test('an explicit bracket ignores a layer changed outside any transaction (stale baseline)', () => {
        // Reproduces the arch-rename bug: a node is added to the diagram OUTSIDE any
        // tracked transaction (no NotifyEdited), so the diagram baseline stays stale
        // at the empty state. A later model-only edit brackets explicitly. The
        // diagram layer must NOT ride that entry — else undo "reverts" the untracked
        // change and deletes the node.
        let diagram = 'empty';
        let model = 'label:web';
        const h = new DiagramHistory();
        h.RegisterLayer(cellLayer(HistoryLayerId.Diagram, () => diagram, (v) => { diagram = v; }));
        h.RegisterLayer(cellLayer(HistoryLayerId.Model, () => model, (v) => { model = v; }));

        // Untracked diagram mutation — baseline still reads 'empty'.
        diagram = 'has-web';

        // Explicit bracket around a model-only edit (the rename).
        h.Begin('Rename'); model = 'label:webapp'; h.Commit();

        h.Undo();
        assert.equal(model, 'label:web', 'the model edit undoes');
        assert.equal(diagram, 'has-web', 'the untracked diagram change is NOT reverted');
    });

    test('AddAppliedListener fires after each undo and redo', () => {
        let cell = 'a'; let applied = 0;
        const h = new DiagramHistory();
        h.RegisterLayer(cellLayer(HistoryLayerId.Diagram, () => cell, (v) => { cell = v; }));
        const off = h.AddAppliedListener(() => { applied++; });

        h.Begin('e'); cell = 'b'; h.Commit();
        assert.equal(applied, 0, 'a commit is not an apply');
        h.Undo();
        assert.equal(applied, 1, 'undo fired applied');
        h.Redo();
        assert.equal(applied, 2, 'redo fired applied');

        // An empty undo/redo (nothing on the stack) does not fire.
        h.Undo(); h.Undo();     // one real, one empty
        assert.equal(applied, 3, 'empty undo did not fire');

        off();
        h.Redo();
        assert.equal(applied, 3, 'unsubscribed listener no longer fires');
    });

    test('Reset clears history and re-baselines to the current state', () => {
        // Simulates a load: content changes outside history, then Reset makes that
        // the new baseline so a later bracketed edit does not record the load as a
        // phantom change.
        let cell = 'a';
        const pending: Array<() => void> = [];
        const h = new DiagramHistory({ scheduleMicrotask: (fn) => pending.push(fn) });
        h.RegisterLayer(cellLayer(HistoryLayerId.Diagram, () => cell, (v) => { cell = v; }));

        h.Begin('e1'); cell = 'b'; h.Commit();
        assert.equal(h.CanUndo, true);

        cell = 'loaded';         // "load" mutates content outside any transaction
        h.NotifyEdited();        // deserialize's dirty-mark schedules a safety net
        h.Reset();               // load complete → discard history, re-baseline
        pending.forEach((fn) => fn());   // the pending safety-net commit is a no-op now
        assert.equal(h.CanUndo, false, 'Reset cleared the undo stack');
        assert.equal(h.CanRedo, false);

        // A later bracketed edit records against the loaded baseline, not 'a'/'b'.
        h.Begin('e2'); cell = 'edited'; h.Commit();
        h.Undo();
        assert.equal(cell, 'loaded', 'undo lands on the loaded baseline, no phantom');
        assert.equal(h.CanUndo, false);
    });

    test('RunSilently mutes the safety net for system-driven projection', () => {
        let cell = 'a';
        const pending: Array<() => void> = [];
        const h = new DiagramHistory({ scheduleMicrotask: (fn) => pending.push(fn) });
        h.RegisterLayer(cellLayer(HistoryLayerId.Diagram, () => cell, (v) => { cell = v; }));

        // A projection redraws derived content and notifies — must record nothing.
        h.RunSilently(() => { cell = 'projected'; h.NotifyEdited(); });
        pending.forEach((fn) => fn());
        assert.equal(h.CanUndo, false, 'silent projection left no undo entry');

        // The safety net still works for a normal edit afterwards.
        cell = 'user'; h.NotifyEdited();
        pending.forEach((fn) => fn());
        assert.equal(h.CanUndo, true, 'a real edit after RunSilently still records');
    });

    test('BeginSettle mutes the async projection tail until the diagram is idle', () => {
        // Models a projection whose churn continues AFTER the synchronous rescan: a
        // container re-fit + a connector re-route fire the safety net on a later
        // tick. The settle window (re-armed by each) must swallow the whole tail.
        let cell = 'a';
        const settle: Array<() => void> = [];
        const micro: Array<() => void> = [];
        const h = new DiagramHistory({
            scheduleMicrotask: (fn) => micro.push(fn),
            scheduleSettle: (fn) => settle.push(fn),
        });
        h.RegisterLayer(cellLayer(HistoryLayerId.Diagram, () => cell, (v) => { cell = v; }));

        // Projection opens a settle window and does its sync work.
        h.BeginSettle();
        cell = 'projected'; h.NotifyEdited();
        // ... then the ASYNC tail fires (re-fit, re-route) — still within the window.
        cell = 'refit'; h.NotifyEdited();
        cell = 'rerouted'; h.NotifyEdited();
        // Run the settle releases: each NotifyEdited re-armed, so only the LAST
        // token survives — earlier releases are no-ops, the final one closes it.
        settle.forEach((fn) => fn());
        micro.forEach((fn) => fn());
        assert.equal(h.CanUndo, false, 'the entire async settle recorded nothing');

        // After the window closes, a normal unbracketed edit records again.
        cell = 'user'; h.NotifyEdited();
        micro.forEach((fn) => fn());
        assert.equal(h.CanUndo, true, 'the safety net works again once settled');
    });

    test('NotifyEdited auto-coalesces unbracketed edits within a microtask', () => {
        let cell = 'a';
        const pending: Array<() => void> = [];
        const h = new DiagramHistory({ scheduleMicrotask: (fn) => pending.push(fn) });
        h.RegisterLayer(cellLayer(HistoryLayerId.Diagram, () => cell, (v) => { cell = v; }));
        // Two edits in the same turn, each notifying — one entry after the microtask.
        cell = 'b'; h.NotifyEdited();
        cell = 'c'; h.NotifyEdited();
        pending.forEach((fn) => fn());
        assert.equal(h.CanUndo, true);
        h.Undo();
        assert.equal(cell, 'a', 'both edits collapsed into one undo step');
    });
});
