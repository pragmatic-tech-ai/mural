import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { DiagramDocument } from '../../diagram-document.js';
import { DiagramCameraStore } from '../diagram-camera-store.js';

describe('DiagramCameraStore', () =>
{
    test('Write then Read round-trips a camera through document metadata', () =>
    {
        const doc = new DiagramDocument();
        assert.equal(DiagramCameraStore.Read(doc), undefined);
        DiagramCameraStore.Write(doc, { zoom: 2, offsetX: 30, offsetY: 40 });
        assert.deepEqual(DiagramCameraStore.Read(doc), { zoom: 2, offsetX: 30, offsetY: 40 });
    });

    test('Write preserves other metadata keys', () =>
    {
        const doc = new DiagramDocument();
        doc.Metadata = { 'arch.viewpoints': ['logical'] };
        DiagramCameraStore.Write(doc, { zoom: 1, offsetX: 0, offsetY: 0 });
        assert.deepEqual(doc.Metadata['arch.viewpoints'], ['logical']);
        assert.deepEqual(DiagramCameraStore.Read(doc), { zoom: 1, offsetX: 0, offsetY: 0 });
    });

    test('Read rejects a malformed stored value', () =>
    {
        const doc = new DiagramDocument();
        doc.Metadata = { camera: { zoom: 'big', offsetX: 0, offsetY: 0 } };
        assert.equal(DiagramCameraStore.Read(doc), undefined);
    });

    test('camera survives a real serialize -> deserialize cycle', () =>
    {
        const seed = new DiagramDocument();
        DiagramCameraStore.Write(seed, { zoom: 1.5, offsetX: 12, offsetY: 34 });
        const payload = (seed as unknown as { _serialize(): unknown })._serialize();
        const opened = new DiagramDocument();
        (opened as unknown as { _deserialize(p: unknown): void })._deserialize(payload);
        assert.deepEqual(DiagramCameraStore.Read(opened), { zoom: 1.5, offsetX: 12, offsetY: 34 });
    });

    test('persists under the exact metadata key "camera" (saved files must keep loading)', () =>
    {
        const key = (DiagramCameraStore as unknown as { MetadataKey: string }).MetadataKey;
        assert.equal(key, 'camera');
        const doc = new DiagramDocument();
        DiagramCameraStore.Write(doc, { zoom: 1, offsetX: 2, offsetY: 3 });
        assert.deepEqual(doc.Metadata['camera'], { zoom: 1, offsetX: 2, offsetY: 3 });
    });
});
