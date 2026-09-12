import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime';
import { ControlsService } from '../controls-service.mjs';
import { controlsDescriptors } from '../controls.descriptors.mjs';

const nullProvider = { get: () => undefined, getRequired: () => { throw new Error('none'); } } as unknown as IServiceProvider;

test('Controls group exposes exactly 32 demos with unique ids', () => {
    const ids = controlsDescriptors.map(d => d.id);
    assert.equal(ids.length, 32);
    assert.equal(new Set(ids).size, ids.length);
});

test('Controls service seeds its demo list from the barrel', () => {
    const svc = new ControlsService(nullProvider);
    assert.equal(svc.Demos.Count, controlsDescriptors.length);
});
