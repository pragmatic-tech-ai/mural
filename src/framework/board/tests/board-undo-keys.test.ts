import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Board } from '../board.js';
import { Key, ModifierKeys } from '../../../runtime/index.js';

function keydown(d: Board, key: Key, mods: ModifierKeys): boolean
{
    const args = { Key: key, Modifiers: mods, Handled: false };
    (d as unknown as { OnKeyDown(a: unknown): void }).OnKeyDown(args);
    return args.Handled;
}

describe('undo/redo keys', () => {
    beforeEach(() => { initTestApp(); });

    test('Ctrl+Z requests undo, Ctrl+Shift+Z requests redo', () => {
        const d = new Board();
        const seen: string[] = [];
        d.AddUndoRequestedListener(() => seen.push('undo'));
        d.AddRedoRequestedListener(() => seen.push('redo'));
        assert.equal(keydown(d, Key.Z, ModifierKeys.Control), true);
        assert.equal(keydown(d, Key.Z, ModifierKeys.Control | ModifierKeys.Shift), true);
        assert.deepEqual(seen, ['undo', 'redo']);
    });

    test('plain Z is not consumed', () => {
        const d = new Board();
        d.AddUndoRequestedListener(() => { throw new Error('should not fire'); });
        assert.equal(keydown(d, Key.Z, ModifierKeys.None), false);
    });
});
