import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HierarchyContributorDefinition } from '../index.js';

test('definition exposes DP-backed ParentKeys / Contributor / Order with defaults', () =>
{
    const d = new HierarchyContributorDefinition();
    assert.deepEqual(d.ParentKeys, []);
    assert.equal(d.Contributor, undefined);
    assert.equal(d.Order, 0);
});

test('definition round-trips set values', () =>
{
    const d = new HierarchyContributorDefinition();
    d.ParentKeys = ['solution'];
    d.Order = 5;
    assert.deepEqual(d.ParentKeys, ['solution']);
    assert.equal(d.Order, 5);
});
