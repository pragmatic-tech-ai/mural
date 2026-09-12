import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StylesService } from '../styles-service.mjs';
import { stylesDescriptors } from '../styles.descriptors.mjs';
const nullProvider = { get: () => undefined, getRequired: () => { throw new Error('none'); } };
test('Styles & Triggers group exposes exactly 1 demos with unique ids', () => {
    const ids = stylesDescriptors.map(d => d.id);
    assert.equal(ids.length, 1);
    assert.equal(new Set(ids).size, ids.length);
});
test('Styles & Triggers service seeds its demo list from the barrel', () => {
    const svc = new StylesService(nullProvider);
    assert.equal(svc.Demos.Count, stylesDescriptors.length);
});
