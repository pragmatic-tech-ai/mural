import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { BoardDocument } from '../../board-document.js';
import { BoardCameraStore } from '../board-camera-store.js';

describe('BoardCameraStore', () =>
{
    test('Write then Read round-trips a camera through document metadata', () =>
    {
        const doc = new BoardDocument();
        assert.equal(BoardCameraStore.Read(doc), undefined);
        BoardCameraStore.Write(doc, { zoom: 2, offsetX: 30, offsetY: 40 });
        assert.deepEqual(BoardCameraStore.Read(doc), { zoom: 2, offsetX: 30, offsetY: 40 });
    });

    test('Write preserves other metadata keys', () =>
    {
        const doc = new BoardDocument();
        doc.Metadata = { 'arch.viewpoints': ['logical'] };
        BoardCameraStore.Write(doc, { zoom: 1, offsetX: 0, offsetY: 0 });
        assert.deepEqual(doc.Metadata['arch.viewpoints'], ['logical']);
        assert.deepEqual(BoardCameraStore.Read(doc), { zoom: 1, offsetX: 0, offsetY: 0 });
    });

    test('Read rejects a malformed stored value', () =>
    {
        const doc = new BoardDocument();
        doc.Metadata = { camera: { zoom: 'big', offsetX: 0, offsetY: 0 } };
        assert.equal(BoardCameraStore.Read(doc), undefined);
    });

    test('camera survives a real serialize -> deserialize cycle', () =>
    {
        const seed = new BoardDocument();
        BoardCameraStore.Write(seed, { zoom: 1.5, offsetX: 12, offsetY: 34 });
        const payload = (seed as unknown as { _serialize(): unknown })._serialize();
        const opened = new BoardDocument();
        (opened as unknown as { _deserialize(p: unknown): void })._deserialize(payload);
        assert.deepEqual(BoardCameraStore.Read(opened), { zoom: 1.5, offsetX: 12, offsetY: 34 });
    });

    test('persists under the exact metadata key "camera" (saved files must keep loading)', () =>
    {
        const key = (BoardCameraStore as unknown as { MetadataKey: string }).MetadataKey;
        assert.equal(key, 'camera');
        const doc = new BoardDocument();
        BoardCameraStore.Write(doc, { zoom: 1, offsetX: 2, offsetY: 3 });
        assert.deepEqual(doc.Metadata['camera'], { zoom: 1, offsetX: 2, offsetY: 3 });
    });
});
