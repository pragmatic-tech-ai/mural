import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Application } from '../../../runtime/index.js';
import { BoardDocument } from '../board-document.js';
import { Figure } from '../figure.js';
import { Connector } from '../connector.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';

// A synchronous in-memory stand-in for the OS clipboard.
function fakeClipboard(): { buf: string }
{
    const box = { buf: '' };
    BoardDocument.Clipboard = {
        Read:  async () => box.buf,
        Write: async (t: string) => { box.buf = t; },
    };
    return box;
}

const realClipboard = BoardDocument.Clipboard;

function newDoc(): BoardDocument
{
    Application.current = null;
    new Application();
    return new BoardDocument();
}

function ids(doc: BoardDocument): string[]
{
    const out: string[] = [];
    for (let i = 0; i < doc.Nodes.Count; i++) out.push((doc.Nodes.Get(i) as Figure).Id!);
    return out;
}

function connect(doc: BoardDocument, a: Figure, b: Figure): Connector
{
    const c = new Connector();
    c.Source = new ConnectorEndpoint({ Node: a });
    c.Target = new ConnectorEndpoint({ Node: b });
    doc.Connectors.Add(c);
    return c;
}

describe('BoardDocument — figure clipboard', () => {
    let clip: { buf: string };
    beforeEach(() => { clip = fakeClipboard(); });
    afterEach(() => { BoardDocument.Clipboard = realClipboard; void clip; });

    test('copy + paste duplicates the selection with fresh ids and a +16 offset', async () => {
        const doc = newDoc();
        const a = doc.CreateNode('rectangle', 100, 100)!;
        const b = doc.CreateNode('ellipse', 200, 140)!;
        const before = new Set(ids(doc));

        doc.CopySelection([a, b], []);
        await doc.PasteClipboard();

        assert.equal(doc.Nodes.Count, 4, 'two originals + two pasted');
        const pasted = ids(doc).filter((id) => !before.has(id));
        assert.equal(pasted.length, 2, 'pasted nodes carry brand-new ids');
        // The rectangle-copy lands at the source (100,100) + one cascade step.
        const rectCopy = doc.Nodes.ToArray().find(
            (n): n is Figure => n instanceof Figure && !before.has(n.Id!) && n.Kind === 'rectangle')!;
        assert.equal(rectCopy.Left, 116);
        assert.equal(rectCopy.Top, 116);
    });

    test('a connector between two copied figures is duplicated between the pasted pair', async () => {
        const doc = newDoc();
        const a = doc.CreateNode('rectangle', 0, 0)!;
        const b = doc.CreateNode('rectangle', 200, 0)!;
        connect(doc, a, b);
        const beforeIds = new Set(ids(doc));

        doc.CopySelection([a, b], []);
        await doc.PasteClipboard();

        assert.equal(doc.Connectors.Count, 2, 'original + pasted connector');
        const pasted = doc.Connectors.Get(1)!;
        const sId = pasted.Source!.Node !== undefined ? (pasted.Source!.Node as Figure).Id : undefined;
        const tId = pasted.Target!.Node !== undefined ? (pasted.Target!.Node as Figure).Id : undefined;
        assert.ok(sId !== undefined && !beforeIds.has(sId), 'pasted connector wired to a pasted node');
        assert.ok(tId !== undefined && !beforeIds.has(tId), 'pasted connector wired to a pasted node');
    });

    test('a connector to an un-copied figure is dropped from the paste', async () => {
        const doc = newDoc();
        const a = doc.CreateNode('rectangle', 0, 0)!;
        const b = doc.CreateNode('rectangle', 200, 0)!;
        connect(doc, a, b);

        doc.CopySelection([a], []);      // only a — the a→b connector spans out of the set
        await doc.PasteClipboard();

        assert.equal(doc.Nodes.Count, 3, 'a + b + one pasted a');
        assert.equal(doc.Connectors.Count, 1, 'no connector pasted (b was not copied)');
    });

    test('repeated paste cascades the offset (+16 each)', async () => {
        const doc = newDoc();
        const a = doc.CreateNode('rectangle', 100, 100)!;
        const before = new Set(ids(doc));

        doc.CopySelection([a], []);
        await doc.PasteClipboard();
        await doc.PasteClipboard();

        const copies = doc.Nodes.ToArray().filter(
            (n): n is Figure => n instanceof Figure && !before.has(n.Id!));
        const lefts = copies.map((n) => n.Left).sort((x, y) => x - y);
        assert.deepEqual(lefts, [116, 132], 'first paste +16, second +32 from the source');
    });

    test('foreign clipboard text is a no-op paste', async () => {
        const doc = newDoc();
        doc.CreateNode('rectangle', 0, 0);
        clip.buf = 'just some copied text';

        await doc.PasteClipboard();

        assert.equal(doc.Nodes.Count, 1, 'nothing materialized from non-payload text');
    });

    test('copying an empty selection does not clobber the clipboard', async () => {
        const doc = newDoc();
        clip.buf = 'PRIOR';
        doc.CopySelection([], []);
        assert.equal(clip.buf, 'PRIOR', 'empty copy left the clipboard untouched');
    });
});
