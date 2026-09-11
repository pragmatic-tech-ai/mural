import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ObservableCollection } from '../../runtime/index.js';
import {
    CollectionView,
    SortDescription,
    GroupDescription,
} from '../collections/collection-view.js';

type Row = { id: number; name: string; group: string };

const ROWS: readonly Row[] = [
    { id: 1, name: 'Charlie', group: 'b' },
    { id: 2, name: 'alice',   group: 'a' },
    { id: 3, name: 'Bob',     group: 'a' },
    { id: 4, name: 'dave',    group: 'b' },
];

describe('CollectionView — passthrough', () => {
    test('no filter / sort / group → projects source in order', () => {
        const v = new CollectionView(ROWS);
        assert.deepEqual(v.ToArray(), ROWS);
        assert.equal(v.Count, 4);
        assert.equal(v.IsEmpty, false);
    });

    test('iterable surface yields the projection', () => {
        const v = new CollectionView(ROWS);
        const out = [];
        for (const r of v) out.push(r);
        assert.equal(out.length, 4);
    });

    test('undefined source projects empty', () => {
        const v = new CollectionView(undefined);
        assert.equal(v.Count, 0);
        assert.equal(v.IsEmpty, true);
    });
});

describe('CollectionView — Filter', () => {
    test('Filter drops non-matching items', () => {
        const v = new CollectionView(ROWS);
        v.Filter = (r) => (r as Row).group === 'a';
        assert.equal(v.Count, 2);
        assert.deepEqual(v.ToArray().map(r => (r as Row).id), [2, 3]);
    });

    test('clearing Filter restores all items', () => {
        const v = new CollectionView(ROWS);
        v.Filter = (r) => (r as Row).group === 'a';
        assert.equal(v.Count, 2);
        v.Filter = undefined;
        assert.equal(v.Count, 4);
    });

    test('Subscribe sees a Cleared followed by per-item Inserts on Refresh', () => {
        const v = new CollectionView(ROWS);
        const changes: string[] = [];
        v.Subscribe(c => changes.push(c.kind));
        v.Filter = (r) => (r as Row).id === 1;
        // Refresh path: Clear, then Insert per item.
        assert.equal(changes[0], 'cleared');
        // 1 surviving item → 1 insert.
        assert.equal(changes.filter(k => k === 'inserted').length, 1);
    });
});

describe('CollectionView — SortDescriptions', () => {
    test('single ascending sort by name (locale-aware)', () => {
        const v = new CollectionView(ROWS);
        v.SortDescriptions.Add(new SortDescription((r) => (r as Row).name));
        // Default localeCompare puts uppercase / lowercase in dictionary
        // order so 'alice' < 'Bob' < 'Charlie' < 'dave'. The point of
        // the test is "sort runs deterministically" — the exact tie-break
        // doesn't matter, just that it's stable.
        const names = v.ToArray().map(r => (r as Row).name);
        const sorted = [...names].sort((a, b) => a.localeCompare(b));
        assert.deepEqual(names, sorted);
    });

    test('descending direction reverses the order', () => {
        const v = new CollectionView(ROWS);
        v.SortDescriptions.Add(new SortDescription((r) => (r as Row).id, 'desc'));
        assert.deepEqual(v.ToArray().map(r => (r as Row).id), [4, 3, 2, 1]);
    });

    test('multi-sort: primary by group asc, secondary by name asc', () => {
        const v = new CollectionView(ROWS);
        v.SortDescriptions.Add(new SortDescription((r) => (r as Row).group, 'asc'));
        v.SortDescriptions.Add(new SortDescription((r) => (r as Row).name, 'asc'));
        // group 'a' first: { 2 alice, 3 Bob } in name order;
        // group 'b' next:  { 1 Charlie, 4 dave }.
        assert.deepEqual(v.ToArray().map(r => (r as Row).id), [2, 3, 1, 4]);
    });

    test('removing a SortDescription re-projects', () => {
        const v = new CollectionView(ROWS);
        const d = new SortDescription((r) => (r as Row).id, 'desc');
        v.SortDescriptions.Add(d);
        assert.deepEqual(v.ToArray().map(r => (r as Row).id), [4, 3, 2, 1]);
        v.SortDescriptions.Remove(d);
        // Back to source order.
        assert.deepEqual(v.ToArray().map(r => (r as Row).id), [1, 2, 3, 4]);
    });
});

describe('CollectionView — GroupDescriptions', () => {
    test('groups by key; items emitted in first-seen group order', () => {
        const v = new CollectionView(ROWS);
        v.GroupDescriptions.Add(new GroupDescription((r) => (r as Row).group));
        // First-seen groups: 'b' (id 1), then 'a' (id 2).
        // Within 'b': id 1, id 4 (source order).
        // Within 'a': id 2, id 3.
        assert.deepEqual(v.ToArray().map(r => (r as Row).id), [1, 4, 2, 3]);
    });

    test('grouping + sort composes (sort first, then group on sorted result)', () => {
        const v = new CollectionView(ROWS);
        v.SortDescriptions.Add(new SortDescription((r) => (r as Row).id, 'desc'));
        v.GroupDescriptions.Add(new GroupDescription((r) => (r as Row).group));
        // After desc sort: id 4, 3, 2, 1 with groups: b, a, a, b.
        // First-seen group: 'b' (id 4). Group 'b' bucket: [4, 1].
        // Then group 'a' bucket: [3, 2]. Final: [4, 1, 3, 2].
        assert.deepEqual(v.ToArray().map(r => (r as Row).id), [4, 1, 3, 2]);
    });
});

describe('CollectionView — CurrentItem', () => {
    test('starts at position 0 with first item when non-empty', () => {
        const v = new CollectionView(ROWS);
        assert.equal(v.CurrentPosition, 0);
        assert.equal(v.CurrentItem, ROWS[0]);
    });

    test('MoveCurrentTo moves to a specific item', () => {
        const v = new CollectionView(ROWS);
        assert.equal(v.MoveCurrentTo(ROWS[2]), true);
        assert.equal(v.CurrentPosition, 2);
        assert.equal(v.CurrentItem, ROWS[2]);
    });

    test('MoveCurrentTo unknown item returns false; position unchanged', () => {
        const v = new CollectionView(ROWS);
        const pos = v.CurrentPosition;
        assert.equal(v.MoveCurrentTo({ id: 999, name: 'x', group: 'z' }), false);
        assert.equal(v.CurrentPosition, pos);
    });

    test('MoveCurrentToNext / Previous wrap-stop at boundaries', () => {
        const v = new CollectionView(ROWS);
        v.MoveCurrentToFirst();
        assert.equal(v.MoveCurrentToNext(), true);
        assert.equal(v.CurrentPosition, 1);
        v.MoveCurrentToLast();
        assert.equal(v.MoveCurrentToNext(), false);
        // Past-end position is `Count` (cursor "after last").
        assert.equal(v.CurrentPosition, ROWS.length);
        v.MoveCurrentToFirst();
        assert.equal(v.MoveCurrentToPrevious(), false);
        // Before-first position is -1.
        assert.equal(v.CurrentPosition, -1);
    });

    test('SubscribeCurrentChanged fires on move; unsubscribe stops further fires', () => {
        const v = new CollectionView(ROWS);
        const fired: number[] = [];
        const unsub = v.SubscribeCurrentChanged(() => fired.push(v.CurrentPosition));
        v.MoveCurrentToPosition(2);
        v.MoveCurrentToPosition(3);
        unsub();
        v.MoveCurrentToPosition(0);
        assert.deepEqual(fired, [2, 3]);
    });

    test('Refresh preserves CurrentItem when still present, else resets to first', () => {
        const v = new CollectionView(ROWS);
        v.MoveCurrentTo(ROWS[2]);
        v.Refresh();
        assert.equal(v.CurrentItem, ROWS[2]);
        v.Filter = (r) => (r as Row).id !== ROWS[2].id;
        // Filtered out — cursor falls back to first surviving item.
        assert.notEqual(v.CurrentItem, ROWS[2]);
        assert.equal(v.CurrentPosition, 0);
    });
});

describe('CollectionView — observable source', () => {
    test('ObservableCollection mutations re-project automatically', () => {
        const obs = new ObservableCollection<Row>([ROWS[0]!, ROWS[1]!]);
        const v = new CollectionView(obs);
        assert.equal(v.Count, 2);
        obs.Add(ROWS[2]!);
        assert.equal(v.Count, 3);
        obs.Remove(ROWS[0]!);
        assert.equal(v.Count, 2);
    });

    test('Dispose stops listening to source mutations', () => {
        const obs = new ObservableCollection<Row>([ROWS[0]!]);
        const v = new CollectionView(obs);
        v.dispose();
        obs.Add(ROWS[1]!);
        assert.equal(v.Count, 1);     // didn't re-refresh
    });
});
