import { test } from 'node:test';
import assert from 'node:assert/strict';
import { animationsDescriptors } from '../groups/animations.descriptors.mjs';
import { controlsDescriptors } from '../groups/controls.descriptors.mjs';
import { demosDescriptors } from '../groups/demos.descriptors.mjs';
import { patternsDescriptors } from '../groups/patterns.descriptors.mjs';
import { stylesDescriptors } from '../groups/styles.descriptors.mjs';
import { shapeLibraryDescriptors } from '../groups/shape-library.descriptors.mjs';

const barrels = [
    animationsDescriptors, controlsDescriptors, demosDescriptors,
    patternsDescriptors, stylesDescriptors, shapeLibraryDescriptors,
];

test('all 54 demos are reachable through exactly one group, ids globally unique', () => {
    const all = barrels.flatMap(b => b.map(d => d.id));
    assert.equal(all.length, 54);
    assert.equal(new Set(all).size, 54);   // no demo in two groups, none duplicated
});

test('the registry module no longer exists', async () => {
    const { existsSync } = await import('node:fs');
    for (const gone of ['../registry.mts', '../demo-group-services.mts', '../demo-platform.module.mu']) {
        assert.ok(!existsSync(new URL(gone, import.meta.url)), `${gone} must be deleted`);
    }
});
