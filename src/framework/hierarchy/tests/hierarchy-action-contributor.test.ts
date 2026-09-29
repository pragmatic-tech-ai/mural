import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HierarchyActionDefinition } from '../hierarchy-action-contributor.js';

test('definition holds ActionKeys / Contributor / Order with defaults', () =>
{
    const d = new HierarchyActionDefinition();
    assert.deepEqual(d.ActionKeys, []);
    assert.equal(d.Contributor, undefined);
    assert.equal(d.Order, 0);
    d.ActionKeys = ['project'];
    d.Order = 5;
    assert.deepEqual(d.ActionKeys, ['project']);
    assert.equal(d.Order, 5);
});
