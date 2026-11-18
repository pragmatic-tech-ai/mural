import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isToolboxContextTarget } from '../toolbox-context.js';

test('isToolboxContextTarget recognises a document exposing ToolboxContexts', () => {
    assert.equal(isToolboxContextTarget({ ToolboxContexts: new Set(['a']) }), true);
    assert.equal(isToolboxContextTarget({}), false);
    assert.equal(isToolboxContextTarget(undefined), false);
    assert.equal(isToolboxContextTarget({ ToolboxContexts: ['a'] }), false, 'array is not a Set');
});
