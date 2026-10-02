import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { HierarchyContributorDefinition } from '../index.js';
import { CommandDefinition } from '../../shell/commands/command-definition.js';

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

describe('HierarchyContributorDefinition.Actions', () =>
{
    test('defaults to an empty, shared, frozen list', () =>
    {
        const a = new HierarchyContributorDefinition();
        const b = new HierarchyContributorDefinition();
        assert.equal(a.Actions.length, 0);
        assert.equal(a.Actions, b.Actions);           // shared default instance
        assert.throws(() => (a.Actions as CommandDefinition[]).push(new CommandDefinition()));
    });

    test('round-trips an assigned action list', () =>
    {
        const def = new HierarchyContributorDefinition();
        const cmd = new CommandDefinition();
        cmd.Id = 'project.rename';
        def.Actions = [cmd];
        assert.deepEqual(def.Actions.map(a => a.Id), ['project.rename']);
    });
});
