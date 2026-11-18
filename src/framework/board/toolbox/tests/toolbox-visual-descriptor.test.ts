import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceKey } from '../../../../runtime/index.js';
import { ToolboxVisualDescriptor } from '../toolbox-visual-descriptor.js';
import { VisualContext, type IToolboxVisualResolver } from '../toolbox-visual-resolver.js';

test('descriptor carries its resolver key and handle', () => {
    const key = new ServiceKey<IToolboxVisualResolver>('test-resolver');
    const d = new ToolboxVisualDescriptor(key, 'shape:box');
    assert.equal(d.ResolverKey, key);
    assert.equal(d.Key, 'shape:box');
});

test('VisualContext values are stable strings', () => {
    assert.equal(VisualContext.Tile, 'tile');
    assert.equal(VisualContext.Figure, 'figure');
});
