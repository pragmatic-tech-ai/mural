import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { AlignmentAxis, EdgeKind } from '../../../../runtime/index.js';
import { DiagramDocument } from '../../diagram-document.js';
import { DiagramGuidesStore } from '../diagram-guides-store.js';

describe('DiagramGuidesStore', () =>
{
    test('Write then Read round-trips guides (incl. glue) through metadata', () =>
    {
        const doc = new DiagramDocument();
        assert.equal(DiagramGuidesStore.Read(doc), undefined);
        const guides = [{ axis: AlignmentAxis.X, position: 120, glued: [{ nodeId: 'n3', edge: EdgeKind.Min }] }];
        DiagramGuidesStore.Write(doc, { guides });
        assert.deepEqual(DiagramGuidesStore.Read(doc), { guides });
    });

    test('Write preserves other metadata keys', () =>
    {
        const doc = new DiagramDocument();
        doc.Metadata = { camera: { zoom: 1, offsetX: 0, offsetY: 0 } };
        DiagramGuidesStore.Write(doc, { guides: [] });
        assert.deepEqual(doc.Metadata['camera'], { zoom: 1, offsetX: 0, offsetY: 0 });
        assert.deepEqual(DiagramGuidesStore.Read(doc), { guides: [] });
    });

    test('Read rejects a malformed stored value', () =>
    {
        const doc = new DiagramDocument();
        doc.Metadata = { guides: 42 };
        assert.equal(DiagramGuidesStore.Read(doc), undefined);
    });

    test('Read rejects a guide with an unknown axis', () =>
    {
        const doc = new DiagramDocument();
        doc.Metadata = { guides: { guides: [{ axis: 'z', position: 1, glued: [] }] } };
        assert.equal(DiagramGuidesStore.Read(doc), undefined);
    });

    test('persists under the exact metadata key "guides" (saved files must keep loading)', () =>
    {
        const key = (DiagramGuidesStore as unknown as { MetadataKey: string }).MetadataKey;
        assert.equal(key, 'guides');
        const doc = new DiagramDocument();
        DiagramGuidesStore.Write(doc, { guides: [] });
        assert.deepEqual(doc.Metadata['guides'], { guides: [] });
    });
});
