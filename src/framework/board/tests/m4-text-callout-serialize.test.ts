// Task C4 — text/callout serializer swap + round-trip tests.
//
// Verifies:
//   1. Typed round-trip: TextNode + Callout → Save → Load → VMs with
//      label + leader restored.
//   2. Legacy load: hand-written {kind:'text'/'callout'} payload (no `type`)
//      → loads as TextNode / Callout.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { Application } from '../../../runtime/index.js';
import { BoardDocument, type BoardStorage } from '../board-document.js';
import { TextNode } from '../text-node.js';
import { Callout } from '../callout.js';

class MemoryStorage implements BoardStorage
{
    private readonly _map = new Map<string, string>();
    public GetItem(key: string): string | null { return this._map.get(key) ?? null; }
    public SetItem(key: string, value: string): void { this._map.set(key, value); }
}

function newDoc(storage?: BoardStorage): BoardDocument
{
    Application.current = null;
    new Application();
    return new BoardDocument(storage);
}

// ── 1. Typed round-trip ──────────────────────────────────────────────────────

describe('C4 text/callout serializer — typed round-trip', () => {
    test('TextNode round-trips: reloads as TextNode with label restored', () => {
        const storage = new MemoryStorage();
        const doc = newDoc(storage);

        const txt = new TextNode();
        txt.Id = 'tx1';
        txt.LabelText = 'annotated';
        txt.Left = 5; txt.Top = 10;
        doc.Nodes.Add(txt);

        doc.Save();

        const doc2 = newDoc(storage);
        doc2.Storage = storage;
        doc2.Load();

        assert.equal(doc2.Nodes.Count, 1, 'one node loaded');
        const restored = doc2.Nodes.Get(0)!;
        assert.ok(restored instanceof TextNode, 'restored as TextNode');
        assert.equal((restored as TextNode).LabelText, 'annotated', 'label restored');
        assert.equal((restored as TextNode).Left, 5, 'Left restored');
        assert.equal((restored as TextNode).Top, 10, 'Top restored');
    });

    test('Callout + TextNode target: reloads as VMs with leader resolved', () => {
        const storage = new MemoryStorage();
        const doc = newDoc(storage);

        const target = new TextNode();
        target.Id = 'tgt1';
        target.LabelText = 'target node';
        target.Left = 300; target.Top = 200; target.Width = 80; target.Height = 60;
        doc.Nodes.Add(target);

        const callout = new Callout();
        callout.Id = 'cl1';
        callout.LabelText = 'callout label';
        callout.Left = 0; callout.Top = 0;
        callout.LeaderTargetNode = target;
        doc.Nodes.Add(callout);

        doc.Save();

        const doc2 = newDoc(storage);
        doc2.Storage = storage;
        doc2.Load();

        assert.equal(doc2.Nodes.Count, 2, 'both nodes loaded');
        const rt = doc2.Nodes.Get(0)!;
        const rc = doc2.Nodes.Get(1)!;

        assert.ok(rt instanceof TextNode, 'target reloaded as TextNode');
        assert.ok(rc instanceof Callout, 'callout reloaded as Callout');
        assert.equal((rc as Callout).LabelText, 'callout label', 'callout label restored');
        // Leader target must be re-wired to the reloaded node (by id).
        assert.equal(
            (rc as Callout).LeaderTargetNode,
            rt,
            'leader re-wired to the reloaded target node',
        );
    });

    test('Save emits type=text for TextNode and type=callout for Callout', () => {
        const storage = new MemoryStorage();
        const doc = newDoc(storage);

        const txt = new TextNode();
        txt.Id = 'tx1'; txt.LabelText = 'hi';
        doc.Nodes.Add(txt);

        const callout = new Callout();
        callout.Id = 'cl1'; callout.LabelText = 'co';
        // Wire a leader so leaderTargetId is serialized.
        callout.LeaderTargetNode = txt;
        doc.Nodes.Add(callout);

        doc.Save();

        const raw = JSON.parse(storage.GetItem('mural-board-state-v1')!) as {
            nodes: Array<{ type?: string; data?: { leaderTargetId?: unknown; text?: unknown } }>;
        };
        assert.equal(raw.nodes.length, 2, 'two node records');
        assert.equal(raw.nodes[0]!.type, 'text', 'TextNode → type=text');
        assert.equal(raw.nodes[1]!.type, 'callout', 'Callout → type=callout');
        // Payload shape must be identical to M3: {text} / {text, leaderTargetId}
        assert.ok('text' in (raw.nodes[0]!.data ?? {}), 'text serializer data has text key');
        assert.ok('text' in (raw.nodes[1]!.data ?? {}), 'callout serializer data has text key');
        assert.equal((raw.nodes[1]!.data ?? {}).leaderTargetId, 'tx1', 'callout data has leaderTargetId = tx1');
    });
});

