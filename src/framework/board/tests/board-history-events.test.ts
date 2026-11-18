import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Board } from '../board.js';

describe('Board edit bracket', () => {
    beforeEach(() => { initTestApp(); });

    test('a mutating event dispatch is wrapped in one begin/end', () => {
        const d = new Board();
        const calls: string[] = [];
        d._setEditBracket({ begin: (l) => calls.push('begin:' + l), end: () => calls.push('end') });
        d.AddDeleteRequestedListener(() => calls.push('listener'));
        (d as unknown as { _fireDeleteRequested(a: unknown): void })._fireDeleteRequested({ Items: [], Connectors: [], Shift: false });
        assert.deepEqual(calls, ['begin:Delete', 'listener', 'end'], 'listener runs inside one bracket');
    });

    test('a read-only Copy dispatch is not bracketed', () => {
        const d = new Board();
        const calls: string[] = [];
        d._setEditBracket({ begin: (l) => calls.push('begin:' + l), end: () => calls.push('end') });
        d.AddCopyRequestedListener(() => calls.push('listener'));
        (d as unknown as { _fireCopyRequested(a: unknown): void })._fireCopyRequested({ Items: [], Connectors: [] });
        assert.deepEqual(calls, ['listener'], 'copy does not open a transaction');
    });
});
