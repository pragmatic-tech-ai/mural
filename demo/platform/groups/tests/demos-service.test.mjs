import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DemosService } from '../demos-service.mjs';
import { demosDescriptors } from '../demos.descriptors.mjs';
const nullProvider = { get: () => undefined, getRequired: () => { throw new Error('none'); } };
test('Demos group exposes exactly 15 demos with unique ids', () => {
    const ids = demosDescriptors.map(d => d.id);
    assert.equal(ids.length, 15);
    assert.equal(new Set(ids).size, ids.length);
});
test('Demos service seeds its demo list from the barrel', () => {
    const svc = new DemosService(nullProvider);
    assert.equal(svc.Demos.Count, demosDescriptors.length);
});
