import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ZOrderMode, reorderZ, type ZAccess } from '../zorder.js';

// Model items as plain objects with a mutable z; sibling array is insertion order.
type Item = { id: string; z: number };
const access: ZAccess<Item> = { get: (i) => i.z, set: (i, v) => { i.z = v; } };

function orderIds(siblings: Item[]): string[]
{
    return [...siblings].sort((a, b) => (a.z - b.z) || 0).map(i => i.id);
}

function make(ids: string[]): Item[] { return ids.map(id => ({ id, z: 0 })); }

describe('reorderZ', () => {
    test('Front moves selected to the top, preserving their relative order', () => {
        const s = make(['a', 'b', 'c', 'd']);          // all z=0 -> insertion order
        reorderZ(ZOrderMode.Front, [s[0]!, s[2]!], s, access);  // bring a, c to front
        assert.deepEqual(orderIds(s), ['b', 'd', 'a', 'c']);
    });

    test('Back moves selected to the bottom, preserving relative order', () => {
        const s = make(['a', 'b', 'c', 'd']);
        reorderZ(ZOrderMode.Back, [s[1]!, s[3]!], s, access);   // send b, d to back
        assert.deepEqual(orderIds(s), ['b', 'd', 'a', 'c']);
    });

    test('Forward shifts a selected item up one slot even when all z tie at 0', () => {
        const s = make(['a', 'b', 'c']);               // order a, b, c
        reorderZ(ZOrderMode.Forward, [s[0]!], s, access);        // a moves up past b
        assert.deepEqual(orderIds(s), ['b', 'a', 'c']);
    });

    test('Backward shifts a selected item down one slot', () => {
        const s = make(['a', 'b', 'c']);
        reorderZ(ZOrderMode.Backward, [s[2]!], s, access);       // c moves down past b
        assert.deepEqual(orderIds(s), ['a', 'c', 'b']);
    });

    test('renumbers to 0..n-1 by new position', () => {
        const s = make(['a', 'b', 'c']);
        reorderZ(ZOrderMode.Front, [s[0]!], s, access);          // a to top
        assert.equal(s.find(i => i.id === 'b')!.z, 0);
        assert.equal(s.find(i => i.id === 'c')!.z, 1);
        assert.equal(s.find(i => i.id === 'a')!.z, 2);
    });

    test('empty selection is a no-op', () => {
        const s = make(['a', 'b']);
        reorderZ(ZOrderMode.Front, [], s, access);
        assert.deepEqual(orderIds(s), ['a', 'b']);
    });
});
