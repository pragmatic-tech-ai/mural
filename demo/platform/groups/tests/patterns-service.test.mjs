import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PatternsService } from '../patterns-service.mjs';
import { patternsDescriptors } from '../patterns.descriptors.mjs';
const nullProvider = { get: () => undefined, getRequired: () => { throw new Error('none'); } };
test('Patterns group exposes exactly 1 demos with unique ids', () => {
    const ids = patternsDescriptors.map(d => d.id);
    assert.equal(ids.length, 1);
    assert.equal(new Set(ids).size, ids.length);
});
test('Patterns service seeds its demo list from the barrel', () => {
    const svc = new PatternsService(nullProvider);
    assert.equal(svc.Demos.Count, patternsDescriptors.length);
});
