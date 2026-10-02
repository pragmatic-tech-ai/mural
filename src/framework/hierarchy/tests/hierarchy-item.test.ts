import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ObservableCollection } from '../../../runtime/index.js';
import { HierarchyItem, type IHierarchyItemOwner, type IHierarchyItemHost } from '../hierarchy-item.js';
import { NodeSeverity } from '../node-severity.js';
import { ItemIdAllocator } from '../item-id.js';

function fakeHost(over: Partial<IHierarchyItemHost> = {}): IHierarchyItemHost
{
    return {
        Activate: () => {},
        CommitRename: () => {},
        OnItemRemoved: () => {},
        ...over,
    };
}

function fakeOwner(over: Partial<IHierarchyItemOwner> = {}): IHierarchyItemOwner
{
    return {
        NewItem: (key, init) => new HierarchyItem(alloc.Mint(), key, fakeOwner(), fakeHost(), init),
        Realize: () => {},
        Collapse: () => {},
        CanonicalNameOf: () => '/',
        BuildActions: () => new ObservableCollection(),
        OnItemDisposed: () => {},
        ...over,
    };
}

const alloc = new ItemIdAllocator();

describe('HierarchyItem', () => {
    test('display properties raise PropertyChanged when set', () => {
        const item = new HierarchyItem(alloc.Mint(), 'project', fakeOwner(), fakeHost(), { Caption: 'A' });
        let fired = 0;
        item.PropertyChanged('Caption').subscribe(() => { fired += 1; });
        assert.equal(item.Caption, 'A');
        item.Caption = 'B';
        assert.equal(item.Caption, 'B');
        assert.equal(fired, 1);
    });

    test('OnExpand asks the owner to realize; OnCollapse asks it to collapse', () => {
        let realized = 0;
        let collapsed = 0;
        const owner = fakeOwner({ Realize: () => { realized += 1; }, Collapse: () => { collapsed += 1; } });
        const item = new HierarchyItem(alloc.Mint(), 'project', owner, fakeHost(), { IsExpandable: true });
        item.OnExpand();
        assert.equal(item.IsExpanded, true);
        assert.equal(realized, 1);
        item.OnCollapse();
        assert.equal(item.IsExpanded, false);
        assert.equal(collapsed, 1);
    });

    test('an expandable collapsed item seeds a single Loading… placeholder child', () => {
        const item = new HierarchyItem(alloc.Mint(), 'project', fakeOwner(), fakeHost(), { IsExpandable: true });
        assert.equal(item.Children.Count, 1);
        assert.equal(item.Children.ToArray()[0].Caption, HierarchyItem.LoadingText);
    });

    test('CommitEdit routes the new name to the host and ends editing', () => {
        let committed = '';
        const item = new HierarchyItem(alloc.Mint(), 'project', fakeOwner(), fakeHost({ CommitRename: (_i, name) => { committed = name; } }), {});
        item.BeginEdit();
        item.EditingName = 'renamed';
        item.CommitEdit();
        assert.equal(committed, 'renamed');
        assert.equal(item.IsEditing, false);
    });

    test('dispose notifies the host and the owner, and disposes children too', () => {
        let removed = 0;
        let ownerNotified = 0;
        const owner = fakeOwner({ OnItemDisposed: () => { ownerNotified += 1; } });
        const host = fakeHost({ OnItemRemoved: () => { removed += 1; } });
        const item = new HierarchyItem(alloc.Mint(), 'project', owner, host, {});
        const child = new HierarchyItem(alloc.Mint(), 'child', owner, host, {});
        item.Children.Add(child);
        item.dispose();
        assert.equal(removed, 2);
        assert.equal(ownerNotified, 2);
        assert.equal(item.Children.Count, 0);
    });
});
