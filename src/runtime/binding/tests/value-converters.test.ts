import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { Is } from '../value-converters.js';

// `Is(x)` — the value-reflection converter behind the board alignment
// toolbars. convert reflects equality; convertBack always yields x (clicking
// a toggle SELECTS x — clicking the active one re-writes x, a no-op).

enum Align { Left = 'Left', Center = 'Center', Right = 'Right' }

describe('Is(value) converter', () => {
    test('convert → true only when the source equals the expected value', () => {
        const isCenter = Is(Align.Center);
        assert.equal(isCenter.convert(Align.Center), true);
        assert.equal(isCenter.convert(Align.Left), false);
        assert.equal(isCenter.convert(undefined), false);
    });

    test('convertBack always yields the expected value (radio select)', () => {
        const isRight = Is(Align.Right);
        // Whether the toggle was checked (true) or unchecked (false), clicking
        // it means "select Right".
        assert.equal(isRight.convertBack!(true), Align.Right);
        assert.equal(isRight.convertBack!(false), Align.Right);
    });

    test('uses identity equality (works for numbers, strings, refs)', () => {
        assert.equal(Is(3).convert(3), true);
        assert.equal(Is(3).convert(4), false);
        const ref = {};
        assert.equal(Is(ref).convert(ref), true);
        assert.equal(Is(ref).convert({}), false);
    });
});
