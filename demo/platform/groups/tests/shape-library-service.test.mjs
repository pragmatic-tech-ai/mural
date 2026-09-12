import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShapeLibraryService } from '../shape-library-service.mjs';
import { shapeLibraryDescriptors } from '../shape-library.descriptors.mjs';
const nullProvider = { get: () => undefined, getRequired: () => { throw new Error('none'); } };
test('Shape library group exposes exactly 1 demos with unique ids', () => {
    const ids = shapeLibraryDescriptors.map(d => d.id);
    assert.equal(ids.length, 1);
    assert.equal(new Set(ids).size, ids.length);
});
test('Shape library service seeds its demo list from the barrel', () => {
    const svc = new ShapeLibraryService(nullProvider);
    assert.equal(svc.Demos.Count, shapeLibraryDescriptors.length);
});
