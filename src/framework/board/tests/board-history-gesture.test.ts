import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { BoardDocument } from '../board-document.js';
import { BoardHistory } from '../history/board-history.js';
import { HistoryLayerId } from '../history/history-layer.js';

// The engine-level guarantee gestures rely on: while a transaction is open,
// the per-move safety net does NOT fire, so many geometry writes coalesce into
// one entry. (The behavior wiring that opens/closes the bracket around a real
// pointer drag is exercised by the e2e; here we lock the coalescing contract.)
describe('gesture coalescing contract', () => {
    beforeEach(() => { initTestApp(); });

    test('edits inside an open bracket do not each auto-commit', () => {
        let cell = 'a';
        const pending: Array<() => void> = [];
        const h = new BoardHistory({ scheduleMicrotask: (fn) => pending.push(fn) });
        h.RegisterLayer({ Id: HistoryLayerId.Board, Capture: () => cell, Equals: (a, b) => a === b, Restore: (s) => { cell = s as string; } });

        h.Begin('Move');
        cell = 'b'; h.NotifyEdited();     // depth > 0 → safety net suppressed
        cell = 'c'; h.NotifyEdited();
        h.Commit();
        pending.forEach((fn) => fn());    // no auto-commit was scheduled

        assert.equal(h.CanUndo, true);
        h.Undo();
        assert.equal(cell, 'a', 'the whole bracketed gesture is one undo step');
        assert.equal(h.CanUndo, false, 'exactly one entry was recorded');
    });

    test('a bracketed multi-write move on a real document is one undo step', () => {
        const doc = new BoardDocument();
        doc.History.Begin('Create');
        const node = doc.CreateNode('rectangle', 0, 0)!;
        const id = node.Id;
        doc.History.Commit();

        // Simulate the behavior bracket around a drag: begin, several writes, end.
        doc.History.Begin('Move');
        node.Left = 10; node.Left = 20; node.Left = 30;
        doc.History.Commit();

        doc.Undo();
        const back = doc.Nodes.ToArray().find((n) => (n as { Id?: string }).Id === id) as { Left: number };
        assert.equal(back.Left, 0, 'the whole drag undoes in one step');
    });
});
