import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnimationsService } from '../animations-service.mjs';
import { animationsDescriptors } from '../animations.descriptors.mjs';
const nullProvider = { get: () => undefined, getRequired: () => { throw new Error('none'); } };
test('Animation group exposes exactly 4 demos with unique ids', () => {
    const ids = animationsDescriptors.map(d => d.id);
    assert.equal(ids.length, 4);
    assert.equal(new Set(ids).size, ids.length);
});
test('Animation service seeds its demo list from the barrel', () => {
    const svc = new AnimationsService(nullProvider);
    assert.equal(svc.Demos.Count, animationsDescriptors.length);
});
