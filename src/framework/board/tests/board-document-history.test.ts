import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { BoardDocument, type BoardStorage } from '../board-document.js';

class MemoryStorage implements BoardStorage
{
    private readonly _map = new Map<string, string>();
    public GetItem(key: string): string | null { return this._map.get(key) ?? null; }
    public SetItem(key: string, value: string): void { this._map.set(key, value); }
}

// _deserialize rebuilds nodes as fresh instances, so restored state is read back
// by id from the live collection, never through a pre-undo reference.
function nodeById(doc: BoardDocument, id: string): { Left: number; Top: number } | undefined
{
    return doc.Nodes.ToArray().find((n) => (n as { Id?: string }).Id === id) as
        { Left: number; Top: number } | undefined;
}

describe('BoardDocument history — board layer round-trip', () => {
    beforeEach(() => { initTestApp(); });

    test('a bracketed move is one undo step that restores geometry', () => {
        const doc = new BoardDocument();
        doc.History.Begin('Create');
        const created = doc.CreateNode('rectangle', 10, 10)!;
        const id = created.Id;
        doc.History.Commit();

        doc.History.Begin('Move');
        created.Left = 200; created.Top = 120;
        doc.History.Commit();
        assert.equal(doc.History.CanUndo, true);

        doc.Undo();
        assert.equal(nodeById(doc, id)?.Left, 10, 'undo restored Left');
        assert.equal(nodeById(doc, id)?.Top, 10, 'undo restored Top');

        doc.Redo();
        assert.equal(nodeById(doc, id)?.Left, 200, 'redo restored Left');
    });

    test('Load resets history — a loaded board is not a phantom undo entry', async () => {
        // Author + save a board.
        const storage = new MemoryStorage();
        const src = new BoardDocument(storage);
        src.History.Begin('Create');
        src.CreateNode('rectangle', 10, 10);
        src.CreateNode('ellipse', 40, 40);
        src.History.Commit();
        src.Save();

        // Reopen it: a fresh document loads the saved content. The deserialize's
        // node adds mark the doc dirty (→ safety net); Load must reset history so
        // opening the file leaves nothing to undo, not a "added 2 nodes" phantom.
        const doc = new BoardDocument(storage);
        doc.Load();
        await new Promise((r) => setTimeout(r, 0));   // drain any safety-net microtask
        assert.equal(doc.Nodes.Count, 2, 'content loaded');
        assert.equal(doc.History.CanUndo, false, 'opening a file leaves no undo entry');

        // A subsequent edit undoes to the LOADED state (2 nodes), never past it.
        doc.History.Begin('Move');
        const n = doc.Nodes.ToArray()[0] as { Left: number };
        n.Left = 300;
        doc.History.Commit();
        doc.Undo();
        assert.equal(doc.Nodes.Count, 2, 'undo lands on the loaded baseline');
        assert.equal(doc.History.CanUndo, false);
    });

    test('undo restores a deleted node', () => {
        const doc = new BoardDocument();
        doc.History.Begin('Create');
        const created = doc.CreateNode('rectangle', 5, 5)!;
        const id = created.Id;
        doc.History.Commit();
        const before = doc.Nodes.Count;

        doc.History.Begin('Delete');
        doc.DeleteNodes([created]);
        doc.History.Commit();
        assert.equal(doc.Nodes.Count, before - 1);

        doc.Undo();
        assert.equal(doc.Nodes.Count, before, 'node re-added');
        assert.ok(nodeById(doc, id) !== undefined, 'same id restored');
    });
});
