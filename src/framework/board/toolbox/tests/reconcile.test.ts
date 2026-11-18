import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObservableCollection } from '../../../../runtime/index.js';
import { reconcile } from '../reconcile.js';

interface Row { id: string; label: string }
const key = (r: Row): string => r.id;

test('reconcile adds, removes, and preserves untouched instances', () => {
    const c = new ObservableCollection<Row>();
    const a = { id: 'a', label: 'A' }, b = { id: 'b', label: 'B' };
    c.Add(a); c.Add(b);
    const events: string[] = [];
    c.Subscribe((e) => events.push(e.kind));
    // desired: keep a (same instance expected), drop b, add c
    reconcile(c, [{ id: 'a', label: 'A' }, { id: 'c', label: 'C' }], key);
    assert.deepEqual(c.ToArray().map(key), ['a', 'c']);
    assert.equal(c.Get(0), a, 'existing key keeps its live instance');
    assert.ok(!events.includes('cleared'), 'never clears');
});

test('reconcile reorders via Move and updates matched in place', () => {
    const c = new ObservableCollection<Row>();
    const a = { id: 'a', label: 'A' }, b = { id: 'b', label: 'B' };
    c.Add(a); c.Add(b);
    reconcile(c, [{ id: 'b', label: 'B2' }, { id: 'a', label: 'A' }], key,
        (live, next) => { live.label = next.label; });
    assert.deepEqual(c.ToArray().map(key), ['b', 'a']);
    assert.equal(c.Get(0), b, 'b moved, same instance');
    assert.equal(b.label, 'B2', 'matched instance updated in place');
});
