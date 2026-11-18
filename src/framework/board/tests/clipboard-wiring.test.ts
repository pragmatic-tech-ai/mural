import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Application } from '../../../runtime/index.js';
import { Board } from '../board.js';
import { BoardDocument } from '../board-document.js';
import { Figure } from '../figure.js';
import { attachStandardBoardMutations, type BoardMutator } from '../behaviors/attach-standard-mutations.js';
import { CLIPBOARD_KIND } from '../serialization/clipboard-payload.js';

// A BoardMutator whose clipboard methods are spies; everything else no-ops.
interface SpyRec { copies: { items: readonly unknown[] }[]; pastes: number }
function spyMutator(): { mutator: BoardMutator; rec: SpyRec }
{
    const rec: SpyRec = { copies: [], pastes: 0 };
    const mutator: BoardMutator = {
        Group() {}, Ungroup() {}, WrapInContainer() {}, UnwrapContainer() {},
        CombineSelection() {}, DeleteNodes() {}, CreateNode() { return null; }, AddNode() {},
        CopySelection(items) { rec.copies.push({ items }); },
        PasteClipboard() { rec.pastes += 1; },
    };
    return { mutator, rec };
}

function newBoard(): Board
{
    Application.current = null;
    new Application();
    return new Board();
}

describe('clipboard wiring — events → mutator', () => {
    test('CopyRequested forwards the selection to mutator.CopySelection', () => {
        const board = newBoard();
        const { mutator, rec } = spyMutator();
        const detach = attachStandardBoardMutations(board, mutator);

        board._fireCopyRequested({ Items: ['a', 'b'], Connectors: [] });

        assert.equal(rec.copies.length, 1);
        assert.deepEqual(rec.copies[0].items, ['a', 'b']);
        detach();
    });

    test('PasteRequested calls mutator.PasteClipboard', () => {
        const board = newBoard();
        const { mutator, rec } = spyMutator();
        const detach = attachStandardBoardMutations(board, mutator);

        board._firePasteRequested({});

        assert.equal(rec.pastes, 1);
        detach();
    });

    test('_requestCopy is a no-op when nothing is selected', () => {
        const board = newBoard();
        let fired = 0;
        board.AddCopyRequestedListener(() => { fired += 1; });
        board._requestCopy();
        assert.equal(fired, 0);
    });

    test('_requestPaste fires unconditionally (empty selection is fine)', () => {
        const board = newBoard();
        let fired = 0;
        board.AddPasteRequestedListener(() => { fired += 1; });
        board._requestPaste();
        assert.equal(fired, 1);
    });

    test('Copy / Cut / Paste commands are installed; Paste is always enabled, Copy needs a selection', () => {
        const board = newBoard();
        assert.ok(board.CopyCommand !== undefined && board.CutCommand !== undefined && board.PasteCommand !== undefined);
        assert.equal(board.PasteCommand!.CanExecute(undefined), true);
        assert.equal(board.CopyCommand!.CanExecute(undefined), false, 'no selection → Copy disabled');
    });
});

describe('clipboard wiring — end to end through a BoardDocument mutator', () => {
    const realClipboard = BoardDocument.Clipboard;
    let buf: string;
    beforeEach(() => { buf = ''; BoardDocument.Clipboard = { Read: async () => buf, Write: async (t) => { buf = t; } }; });
    afterEach(() => { BoardDocument.Clipboard = realClipboard; });

    test('firing CopyRequested writes the payload, and the document pastes it back', async () => {
        Application.current = null;
        new Application();
        const doc = new BoardDocument();
        const board = new Board();
        const detach = attachStandardBoardMutations(board, doc);
        const a = doc.CreateNode('rectangle', 10, 10)!;
        const b = doc.CreateNode('ellipse', 90, 10)!;

        board._fireCopyRequested({ Items: [a, b] as Figure[], Connectors: [] });
        assert.ok(buf.includes(CLIPBOARD_KIND), 'copy wrote the tagged payload to the clipboard');

        await doc.PasteClipboard();
        assert.equal(doc.Nodes.Count, 4, 'paste materialized the two copied figures');
        detach();
    });
});
