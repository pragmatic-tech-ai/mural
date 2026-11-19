import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { AlignmentAxis, EdgeKind } from '../../../../runtime/index.js';
import { BoardDocument } from '../../board-document.js';
import { BoardGuidesStore } from '../board-guides-store.js';

describe('BoardGuidesStore', () =>
{
    test('Write then Read round-trips guides (incl. glue) through metadata', () =>
    {
        const doc = new BoardDocument();
        assert.equal(BoardGuidesStore.Read(doc), undefined);
        const guides = [{ axis: AlignmentAxis.X, position: 120, glued: [{ nodeId: 'n3', edge: EdgeKind.Min }] }];
        BoardGuidesStore.Write(doc, { guides });
        assert.deepEqual(BoardGuidesStore.Read(doc), { guides });
    });

    test('Write preserves other metadata keys', () =>
    {
        const doc = new BoardDocument();
        doc.Metadata = { camera: { zoom: 1, offsetX: 0, offsetY: 0 } };
        BoardGuidesStore.Write(doc, { guides: [] });
        assert.deepEqual(doc.Metadata['camera'], { zoom: 1, offsetX: 0, offsetY: 0 });
        assert.deepEqual(BoardGuidesStore.Read(doc), { guides: [] });
    });

    test('Read rejects a malformed stored value', () =>
    {
        const doc = new BoardDocument();
        doc.Metadata = { guides: 42 };
        assert.equal(BoardGuidesStore.Read(doc), undefined);
    });

    test('Read rejects a guide with an unknown axis', () =>
    {
        const doc = new BoardDocument();
        doc.Metadata = { guides: { guides: [{ axis: 'z', position: 1, glued: [] }] } };
        assert.equal(BoardGuidesStore.Read(doc), undefined);
    });

    test('persists under the exact metadata key "guides" (saved files must keep loading)', () =>
    {
        const key = (BoardGuidesStore as unknown as { MetadataKey: string }).MetadataKey;
        assert.equal(key, 'guides');
        const doc = new BoardDocument();
        BoardGuidesStore.Write(doc, { guides: [] });
        assert.deepEqual(doc.Metadata['guides'], { guides: [] });
    });
});
