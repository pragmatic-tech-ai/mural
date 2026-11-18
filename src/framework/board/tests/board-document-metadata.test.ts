import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { BoardDocument } from '../board-document.js';

// Opaque app-level document metadata (e.g. an architecture board's governing
// viewpoints) rides inside the serialized `.board` payload and round-trips
// through Save/Load, so a consumer can persist data WITH the board file.
describe('BoardDocument metadata', () => {

    test('Metadata round-trips through serialize -> deserialize', () => {
        initTestApp();
        const a = new BoardDocument();
        a.Metadata = { 'arch.viewpoints': ['deployment', 'logical'] };
        const json = (a as unknown as { _serialize(): unknown })._serialize();
        const b = new BoardDocument();
        (b as unknown as { _deserialize(p: unknown): void })._deserialize(json);
        assert.deepEqual(b.Metadata['arch.viewpoints'], ['deployment', 'logical']);
    });

    test('empty metadata is omitted from the serialized payload', () => {
        initTestApp();
        const d = new BoardDocument();
        const json = (d as unknown as { _serialize(): { metadata?: unknown } })._serialize();
        assert.equal(json.metadata, undefined);
    });

    test('the Metadata getter returns a copy — external mutation does not leak in', () => {
        initTestApp();
        const d = new BoardDocument();
        d.Metadata = { k: 1 };
        const snap = d.Metadata;
        snap.k = 999;
        assert.equal(d.Metadata.k, 1);
    });
});
