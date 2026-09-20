import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Application } from '../../../runtime/index.js';
import { Diagram } from '../diagram.js';
import { DiagramDocument } from '../diagram-document.js';
import { Figure } from '../figure.js';
import { attachStandardDiagramMutations, type DiagramMutator } from '../behaviors/attach-standard-mutations.js';
import { CLIPBOARD_KIND } from '../serialization/clipboard-payload.js';

// A DiagramMutator whose clipboard methods are spies; everything else no-ops.
interface SpyRec { copies: { items: readonly unknown[] }[]; pastes: number }
function spyMutator(): { mutator: DiagramMutator; rec: SpyRec }
{
    const rec: SpyRec = { copies: [], pastes: 0 };
    const mutator: DiagramMutator = {
        Group() {}, Ungroup() {}, WrapInContainer() {}, UnwrapContainer() {},
        CombineSelection() {}, DeleteNodes() {}, CreateNode() { return null; }, AddNode() {},
        CopySelection(items) { rec.copies.push({ items }); },
        PasteClipboard() { rec.pastes += 1; },
    };
    return { mutator, rec };
}

function newDiagram(): Diagram
{
    Application.current = null;
    new Application();
    return new Diagram();
}

describe('clipboard wiring — events → mutator', () => {
    test('CopyRequested forwards the selection to mutator.CopySelection', () => {
        const diagram = newDiagram();
        const { mutator, rec } = spyMutator();
        const detach = attachStandardDiagramMutations(diagram, mutator);

        diagram._fireCopyRequested({ Items: ['a', 'b'], Connectors: [] });

        assert.equal(rec.copies.length, 1);
        assert.deepEqual(rec.copies[0].items, ['a', 'b']);
        detach();
    });

    test('PasteRequested calls mutator.PasteClipboard', () => {
        const diagram = newDiagram();
        const { mutator, rec } = spyMutator();
        const detach = attachStandardDiagramMutations(diagram, mutator);

        diagram._firePasteRequested({});

        assert.equal(rec.pastes, 1);
        detach();
    });

    test('_requestCopy is a no-op when nothing is selected', () => {
        const diagram = newDiagram();
        let fired = 0;
        diagram.AddCopyRequestedListener(() => { fired += 1; });
        diagram._requestCopy();
        assert.equal(fired, 0);
    });

    test('_requestPaste fires unconditionally (empty selection is fine)', () => {
        const diagram = newDiagram();
        let fired = 0;
        diagram.AddPasteRequestedListener(() => { fired += 1; });
        diagram._requestPaste();
        assert.equal(fired, 1);
    });

    test('Copy / Cut / Paste commands are installed; Paste is always enabled, Copy needs a selection', () => {
        const diagram = newDiagram();
        assert.ok(diagram.CopyCommand !== undefined && diagram.CutCommand !== undefined && diagram.PasteCommand !== undefined);
        assert.equal(diagram.PasteCommand!.CanExecute(undefined), true);
        assert.equal(diagram.CopyCommand!.CanExecute(undefined), false, 'no selection → Copy disabled');
    });
});

describe('clipboard wiring — end to end through a DiagramDocument mutator', () => {
    const realClipboard = DiagramDocument.Clipboard;
    let buf: string;
    beforeEach(() => { buf = ''; DiagramDocument.Clipboard = { Read: async () => buf, Write: async (t) => { buf = t; } }; });
    afterEach(() => { DiagramDocument.Clipboard = realClipboard; });

    test('firing CopyRequested writes the payload, and the document pastes it back', async () => {
        Application.current = null;
        new Application();
        const doc = new DiagramDocument();
        const diagram = new Diagram();
        const detach = attachStandardDiagramMutations(diagram, doc);
        const a = doc.CreateNode('rectangle', 10, 10)!;
        const b = doc.CreateNode('ellipse', 90, 10)!;

        diagram._fireCopyRequested({ Items: [a, b] as Figure[], Connectors: [] });
        assert.ok(buf.includes(CLIPBOARD_KIND), 'copy wrote the tagged payload to the clipboard');

        await doc.PasteClipboard();
        assert.equal(doc.Nodes.Count, 4, 'paste materialized the two copied figures');
        detach();
    });
});
