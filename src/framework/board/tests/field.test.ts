import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';

import { Run } from '../../../basic/documents/inlines.js';
import { Figure } from '../figure.js';
import { TextNode } from '../text-node.js';
import { Connector } from '../connector.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';
import { Field, FieldKind, documentWithFields, resolveFields } from '../shape-text-field.js';
import {
    flowDocumentToPlainText, isEffectivelyPlainDocument, serializeFlowDocument,
} from '../serialization/shape-text-document.js';
import { BoardDocument, type BoardStorage } from '../board-document.js';

// § board-text Slice 6 — text fields. A Field is an inline whose text is a
// live value resolved from the owning shape / connector; the key persists,
// the value is recomputed and stays reactive to source changes.

class MemoryStorage implements BoardStorage
{
    private readonly _map = new Map<string, string>();
    public GetItem(key: string): string | null { return this._map.get(key) ?? null; }
    public SetItem(key: string, value: string): void { this._map.set(key, value); }
}

describe('Field — model + resolution (pure)', () => {
    test('a Field is a keyed Run', () => {
        const f = new Field(FieldKind.Height);
        assert.ok(f instanceof Run, 'flows through the Run pipeline');
        assert.equal(f.FieldKey, FieldKind.Height);
    });

    test('resolveFields pushes resolved values; unknown keys show their token', () => {
        const doc = documentWithFields('{Width}/{Kind}/{Length}');
        resolveFields(doc, (k) => k === FieldKind.Width ? '80' : k === FieldKind.Kind ? 'box' : undefined);
        // Width + Kind resolved; Length unsupported → visible token.
        assert.equal(flowDocumentToPlainText(doc), '80/box/{Length}');
    });

    test('documentWithFields parses tokens into Fields and literals into Runs', () => {
        assert.deepEqual(serializeFlowDocument(documentWithFields('a {Width} b')), [
            { runs: [{ t: 'a ' }, { t: '', f: FieldKind.Width }, { t: ' b' }] },
        ]);
        // A brace group that isn't a field kind stays literal text.
        assert.deepEqual(serializeFlowDocument(documentWithFields('{nope}')), [
            { runs: [{ t: '{nope}' }] },
        ]);
    });

    test('a document with a field is never "effectively plain"', () => {
        assert.equal(isEffectivelyPlainDocument(documentWithFields('{Width}')), false);
        assert.equal(isEffectivelyPlainDocument(documentWithFields('just text')), true);
    });
});

describe('Field — Figure reactivity', () => {
    beforeEach(() => { initTestApp(); });

    test('a figure label field shows the live value and updates on change', () => {
        const f = new Figure();
        f.Width = 100; f.Height = 50;
        f.Text.Document = documentWithFields('{Width}×{Height}');
        assert.equal(flowDocumentToPlainText(f.Text.Document), '100×50', 'resolved on assignment');
        f.Width = 120;
        assert.equal(flowDocumentToPlainText(f.Text.Document), '120×50', 'reactive to a resize');
    });

    test('identity fields resolve too', () => {
        const f = new Figure();
        f.Id   = 'n7';
        f.Text.Document = documentWithFields('id={Id}');
        assert.equal(flowDocumentToPlainText(f.Text.Document), 'id=n7');
    });
});

describe('Field — Connector reactivity', () => {
    beforeEach(() => { initTestApp(); });

    test('a connector {Length} field resolves to the route length', () => {
        const a = new Figure(); a.Left = 0;   a.Top = 0;
        const b = new Figure(); b.Left = 240; b.Top = 0;
        const c = new Connector();
        c.Source = new ConnectorEndpoint({ Node: a });
        c.Target = new ConnectorEndpoint({ Node: b });
        c.Text.Document = documentWithFields('len={Length}');
        const txt = flowDocumentToPlainText(c.Text.Document);
        assert.match(txt, /^len=\d+$/, 'shows a numeric route length');
        assert.ok(Number(txt.slice(4)) > 0, 'length is positive');
    });
});

describe('Field — persistence', () => {
    beforeEach(() => { initTestApp(); });

    test('a field persists its key and re-resolves live on load', () => {
        const doc = new BoardDocument(new MemoryStorage());
        // C4: use TextNode — serializes as type='text' and reloads as TextNode.
        // TextNode default width is 120; set to 80 so the {Width} field stays 80.
        const n = new TextNode(); n.Id = 'n1'; n.Width = 80; doc.Nodes.Add(n);
        n.Text.Document = documentWithFields('{Width}');
        n.Text.Content  = flowDocumentToPlainText(n.Text.Document);
        doc.Save();
        doc.Load();
        const vm = doc.Nodes.Get(0) as TextNode;
        assert.ok(vm.Text.Document !== undefined, 'rich document restored');
        assert.equal(flowDocumentToPlainText(vm.Text.Document!), '80', 're-resolved to live width');
        // Still live after the round-trip.
        vm.Width = 200;
        assert.equal(flowDocumentToPlainText(vm.Text.Document!), '200', 'field stayed reactive');
    });
});
