import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ObservableCollection, type CollectionChange } from '../observable-collection.js';

function record<T>(c: ObservableCollection<T>): CollectionChange<T>[]
{
    const log: CollectionChange<T>[] = [];
    c.Subscribe(ch => log.push(ch));
    return log;
}

describe('ObservableCollection.Batch', () => {
    test('emits exactly one reset after N interior mutations', () => {
        const c = new ObservableCollection<number>();
        const log = record(c);
        c.Batch(() => { for (let i = 0; i < 5; i++) c.Add(i); });
        assert.deepEqual(log, [{ kind: 'reset' }]);
        assert.deepEqual(c.ToArray(), [0, 1, 2, 3, 4]);
    });

    test('suppresses all interior events (Clear + Adds => one reset)', () => {
        const c = new ObservableCollection<number>([9, 9, 9]);
        const log = record(c);
        c.Batch(() => { c.Clear(); c.Add(1); c.Add(2); });
        assert.deepEqual(log, [{ kind: 'reset' }]);
        assert.deepEqual(c.ToArray(), [1, 2]);
    });

    test('a Batch that changes nothing emits no notification', () => {
        const c = new ObservableCollection<number>([1]);
        const log = record(c);
        c.Batch(() => { /* no mutations */ });
        assert.deepEqual(log, []);
    });

    test('emits the reset even when mutate throws', () => {
        const c = new ObservableCollection<number>();
        const log = record(c);
        assert.throws(() => c.Batch(() => { c.Add(1); throw new Error('boom'); }), /boom/);
        assert.deepEqual(log, [{ kind: 'reset' }]);
        assert.deepEqual(c.ToArray(), [1]);
    });

    test('nested Batch emits only once (outermost)', () => {
        const c = new ObservableCollection<number>();
        const log = record(c);
        c.Batch(() => {
            c.Add(1);
            c.Batch(() => { c.Add(2); c.Add(3); });
            c.Add(4);
        });
        assert.deepEqual(log, [{ kind: 'reset' }]);
        assert.deepEqual(c.ToArray(), [1, 2, 3, 4]);
    });

    test('normal single mutations still fire granular events (unchanged)', () => {
        const c = new ObservableCollection<number>();
        const log = record(c);
        c.Add(1);
        c.Add(2);
        assert.deepEqual(log, [
            { kind: 'inserted', index: 0, items: [1] },
            { kind: 'inserted', index: 1, items: [2] },
        ]);
    });
});
