import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { HierarchyContext } from '../hierarchy-context.js';

describe('HierarchyContext — key→token interner', () =>
{
    test('returns the same token instance for equal keys', () =>
    {
        assert.equal(HierarchyContext.For('project'), HierarchyContext.For('project'));
    });

    test('returns distinct tokens for distinct keys', () =>
    {
        assert.notEqual(HierarchyContext.For('project'), HierarchyContext.For('folder'));
    });

    test('the token carries the key as its debug name', () =>
    {
        const token = HierarchyContext.For('connection') as { description?: string };
        assert.equal(token.description, 'hierarchy.context:connection');
    });
});
