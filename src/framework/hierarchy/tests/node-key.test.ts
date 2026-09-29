import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NodeKey, NodeKeyRegistry, DuplicateNodeKeyError } from '../index.js';

test('NodeKey families have their canonical string values (markup literal <-> constant)', () =>
{
    assert.equal(NodeKey.Solution, 'solution');
    assert.equal(NodeKey.Project, 'project');
    assert.equal(NodeKey.Connections, 'connections');
    assert.equal(NodeKey.References, 'references');
});

test('declaring the same key from two different owners throws at compose', () =>
{
    const reg = new NodeKeyRegistry();
    reg.DeclareOwned(NodeKey.Project, 'todl-project-system');
    assert.throws(() => reg.DeclareOwned(NodeKey.Project, 'some-other-module'), DuplicateNodeKeyError);
});

test('re-declaring the same key from the SAME owner is idempotent, not a collision', () =>
{
    const reg = new NodeKeyRegistry();
    reg.DeclareOwned(NodeKey.Solution, 'framework');
    assert.doesNotThrow(() => reg.DeclareOwned(NodeKey.Solution, 'framework'));
    assert.equal(reg.Owners().get(NodeKey.Solution), 'framework');
});
