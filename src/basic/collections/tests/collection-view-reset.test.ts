import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ObservableCollection, type CollectionChange } from '../../../runtime/index.js';
import { CollectionView } from '../collection-view.js';

describe('CollectionView reset semantics', () => {
    test('Refresh emits a single reset (not cleared + N inserted)', () => {
        const src = new ObservableCollection<number>([1, 2, 3]);
        const view = new CollectionView(src);
        const log: CollectionChange<unknown>[] = [];
        view.Subscribe(ch => log.push(ch));
        view.Refresh();
        assert.deepEqual(log, [{ kind: 'reset' }]);
        assert.deepEqual(view.ToArray(), [1, 2, 3]);
    });

    test('a source Batch (reset) re-projects and emits one downstream reset', () => {
        const src = new ObservableCollection<number>([1, 2]);
        const view = new CollectionView(src);
        const log: CollectionChange<unknown>[] = [];
        view.Subscribe(ch => log.push(ch));
        src.Batch(() => { src.Clear(); src.Add(7); src.Add(8); src.Add(9); });
        assert.deepEqual(log, [{ kind: 'reset' }]);
        assert.deepEqual(view.ToArray(), [7, 8, 9]);
    });
});
