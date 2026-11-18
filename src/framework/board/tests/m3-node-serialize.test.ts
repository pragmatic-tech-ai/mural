// Generic per-node serialization registry (M3).
// Typed round-trip: Figure + TextNode + connector → save (v3 two-section:
// content in `nodes`, geometry in `visuals`) → load into a fresh doc → correct
// types, positions, text, connector endpoints.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { Application } from '../../../runtime/index.js';
import { Point } from '../../../visual-engine/index.js';
import { BoardDocument, type BoardStorage } from '../board-document.js';
import { Figure } from '../figure.js';
import { TextNode } from '../text-node.js';
import { Connector } from '../connector.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';

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

// ── 1. Typed round-trip ──────────────────────────────────────────────

describe('M3 node serialization registry — typed round-trip', () => {
    test('each node record carries a type field after Save', () => {
        const storage = new MemoryStorage();
        const doc = newDoc(storage);

        const shape = doc.CreateNode('rectangle', 12, 34)!;
        assert.ok(shape instanceof Figure);

        const txt = new TextNode();
        txt.Id = 'tx1'; txt.LabelText = 'hello'; txt.Left = 200; txt.Top = 100;
        doc.Nodes.Add(txt);

        doc.Save();

        const raw = JSON.parse(storage.GetItem('mural-board-state-v1')!) as {
            nodes: Array<{ type?: string; kind?: string }>;
        };
        assert.ok(Array.isArray(raw.nodes), 'nodes array present');
        assert.equal(raw.nodes.length, 2, 'two node records');

        const shapeRec = raw.nodes[0]!;
        const textRec  = raw.nodes[1]!;
        assert.equal(shapeRec.type, 'shape', 'shape record has type=shape');
        assert.equal(textRec.type,  'text',  'text record has type=text');
    });

    test('Save → Load restores Figure kind/position', () => {
        const storage = new MemoryStorage();
        const doc = newDoc(storage);

        const shape = doc.CreateNode('rectangle', 12, 34)!;
        assert.ok(shape instanceof Figure);

        doc.Save();

        const doc2 = newDoc(storage);
        doc2.Storage = storage;
        doc2.Load();

        assert.equal(doc2.Nodes.Count, 1);
        const restored = doc2.Nodes.Get(0)!;
        assert.ok(restored instanceof Figure, 'restored as Figure');
        const vm = restored as Figure;
        assert.equal(vm.Kind, 'rectangle');
        assert.equal(vm.Left, 12);
        assert.equal(vm.Top,  34);
    });

    test('Save → Load restores TextNode with its label', () => {
        const storage = new MemoryStorage();
        const doc = newDoc(storage);

        const txt = new TextNode();
        txt.Id = 'tx1'; txt.LabelText = 'annotated'; txt.Left = 5; txt.Top = 10;
        doc.Nodes.Add(txt);

        doc.Save();

        const doc2 = newDoc(storage);
        doc2.Storage = storage;
        doc2.Load();

        assert.equal(doc2.Nodes.Count, 1);
        const restored = doc2.Nodes.Get(0)!;
        assert.ok(restored instanceof TextNode, 'restored as TextNode');
        assert.equal((restored as TextNode).LabelText, 'annotated');
    });

    test('connector endpoints resolve by id after typed round-trip', () => {
        const storage = new MemoryStorage();
        const doc = newDoc(storage);

        const a = doc.CreateNode('rectangle', 0, 0)!;
        const b = doc.CreateNode('rectangle', 200, 0)!;

        const src = new ConnectorEndpoint({ Node: a });
        const tgt = new ConnectorEndpoint({ Node: b });
        const conn = doc.CreateConnector(src, tgt)!;
        assert.ok(conn instanceof Connector);

        doc.Save();

        const doc2 = newDoc(storage);
        doc2.Storage = storage;
        doc2.Load();

        assert.equal(doc2.Nodes.Count, 2);
        assert.equal(doc2.Connectors.Count, 1);

        const c = doc2.Connectors.Get(0)!;
        assert.ok(c.Source?.Node !== undefined, 'source node rehydrated');
        assert.ok(c.Target?.Node !== undefined, 'target node rehydrated');
        // The source/target ids in the restored doc must be distinct.
        assert.notEqual(c.Source!.Node!.Id, c.Target!.Node!.Id, 'endpoints point to different nodes');
    });
});

