import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ItemIdAllocator, NoneId } from '../item-id.js';

describe('ItemIdAllocator', () =>
{
    test('mints monotonic ids from 1; NoneId is 0 and is never minted', () =>
    {
        assert.equal(NoneId, 0);
        const alloc = new ItemIdAllocator();
        const a = alloc.Mint();
        const b = alloc.Mint();
        const c = alloc.Mint();
        assert.equal(a, 1);
        assert.equal(b, 2);
        assert.equal(c, 3);
        assert.notEqual(a, NoneId);
    });

    test('separate allocators are independent', () =>
    {
        const first = new ItemIdAllocator();
        const second = new ItemIdAllocator();
        assert.equal(first.Mint(), 1);
        assert.equal(second.Mint(), 1);
    });
});
