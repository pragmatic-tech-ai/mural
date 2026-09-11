import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ObservableCollection, Element, Visual } from '../../runtime/index.js';
import { CollectionView, GroupDescription } from '../collections/collection-view.js';
import { CollectionViewGroup } from '../collections/collection-view-group.js';
import { DataTemplate } from '../templates/data-template.js';
import { GroupItem } from '../../framework/surfaces/group-item.js';
import { GroupStyle } from '../collections/group-style.js';
import {
    GeneratorPosition,
    GeneratorStatus,
    ItemsChangedAction,
    type ItemsChangedArgs,
} from '../collections/item-container-generator.js';
import { ItemsControl } from '../../framework/base/items-control.js';
import { StackPanel } from '../panels/stack-panel.js';

class Leaf extends Element
{
    constructor(public readonly label: string) { super(); }
}

function makeIC(items: readonly unknown[]): ItemsControl
{
    const ic = new ItemsControl();
    ic.ItemTemplate = new DataTemplate(data => new Leaf(String(data)));
    ic.ItemsPanel   = () => new StackPanel();
    ic.Items        = items;
    return ic;
}

// ── Status / StatusChanged ──────────────────────────────────────────

describe('ItemContainerGenerator — Status / StatusChanged', () => {
    test('Status flips to GeneratingContainers during a session, to ContainersGenerated on Dispose', () => {
        const ic = makeIC(['a', 'b']);
        // After the constructor's initial rebuild, status is
        // ContainersGenerated (the rebuild's session opened + closed).
        assert.equal(ic.Generator.Status, GeneratorStatus.ContainersGenerated);

        const s = ic.Generator.StartAt();
        assert.equal(ic.Generator.Status, GeneratorStatus.GeneratingContainers);
        s.dispose();
        assert.equal(ic.Generator.Status, GeneratorStatus.ContainersGenerated);
    });

    test('Concurrent sessions reference-count; status only flips on outer transitions', () => {
        const ic = makeIC(['a']);
        const outer = ic.Generator.StartAt();
        assert.equal(ic.Generator.Status, GeneratorStatus.GeneratingContainers);
        const inner = ic.Generator.StartAt();
        assert.equal(ic.Generator.Status, GeneratorStatus.GeneratingContainers);
        inner.dispose();
        // Still inside outer.
        assert.equal(ic.Generator.Status, GeneratorStatus.GeneratingContainers);
        outer.dispose();
        assert.equal(ic.Generator.Status, GeneratorStatus.ContainersGenerated);
    });

    test('StatusChanged fires on each transition', () => {
        const ic = makeIC([]);
        const transitions: GeneratorStatus[] = [];
        ic.Generator.SubscribeStatusChanged(() => transitions.push(ic.Generator.Status));
        const s = ic.Generator.StartAt();
        s.dispose();
        assert.deepEqual(transitions, [
            GeneratorStatus.GeneratingContainers,
            GeneratorStatus.ContainersGenerated,
        ]);
    });
});

// ── Move action (ObservableCollection + ItemsControl) ───────────────

describe('ObservableCollection.Move', () => {
    test('moves the item, leaves identity intact', () => {
        const oc = new ObservableCollection<string>(['a', 'b', 'c', 'd']);
        oc.Move(0, 2);
        assert.deepEqual(oc.ToArray(), ['b', 'c', 'a', 'd']);
    });

    test('fires a single moved event with old + new indices', () => {
        const oc = new ObservableCollection<string>(['a', 'b', 'c']);
        const events: unknown[] = [];
        oc.Subscribe(change => events.push(change));
        oc.Move(2, 0);
        assert.equal(events.length, 1);
        assert.deepEqual(events[0], {
            kind: 'moved', oldIndex: 2, newIndex: 0, item: 'c',
        });
    });

    test('out-of-range indices throw', () => {
        const oc = new ObservableCollection<string>(['a', 'b']);
        assert.throws(() => oc.Move(5, 0));
        assert.throws(() => oc.Move(0, -1));
    });

    test('Move(i, i) is a no-op (no event)', () => {
        const oc = new ObservableCollection<string>(['a', 'b']);
        const events: unknown[] = [];
        oc.Subscribe(c => events.push(c));
        oc.Move(1, 1);
        assert.equal(events.length, 0);
    });
});

describe('ItemsControl — handles moved + raises ItemsChanged.Move', () => {
    test('reorders container in _containers + index map, fires Move event', () => {
        const oc = new ObservableCollection<string>(['a', 'b', 'c']);
        const ic = makeIC(oc as never);

        const cA = ic.Generator.ContainerFromItem('a')!;
        const cC = ic.Generator.ContainerFromItem('c')!;
        assert.ok(cA && cC);

        const events: ItemsChangedArgs[] = [];
        ic.Generator.SubscribeItemsChanged(args => events.push(args));

        oc.Move(0, 2);   // 'a' moves from index 0 to index 2

        // The same container instance for 'a' is now at index 2.
        assert.equal(ic.Generator.IndexFromContainer(cA), 2);
        // 'c' shifted up to index 1.
        assert.equal(ic.Generator.IndexFromContainer(cC), 1);

        const evt = events[0]!;
        assert.equal(evt.Action, ItemsChangedAction.Move);
        assert.equal(evt.Position.Index, 2);
        assert.equal(evt.OldPosition?.Index, 0);
    });
});

// ── Grouping (CollectionView + GroupItem + GroupStyle) ──────────────

describe('CollectionView.Groups', () => {
    test('exposes CollectionViewGroups when GroupDescriptions is set', () => {
        const view = new CollectionView([
            { name: 'Alice',  team: 'A' },
            { name: 'Bob',    team: 'B' },
            { name: 'Carla',  team: 'A' },
        ]);
        view.GroupDescriptions.Add(new GroupDescription(
            d => (d as { team: string }).team));

        const groups = view.Groups!;
        assert.equal(groups.length, 2);
        assert.equal(groups[0]!.Name, 'A');
        assert.equal(groups[0]!.ItemCount, 2);
        assert.equal(groups[1]!.Name, 'B');
        assert.equal(groups[1]!.ItemCount, 1);
    });

    test('Groups is undefined when no GroupDescriptions are active', () => {
        const view = new CollectionView(['a', 'b']);
        assert.equal(view.Groups, undefined);
        assert.equal(view.IsGrouping, false);
    });
});

describe('ItemsControl — grouped rendering via GroupStyle', () => {
    test('wraps each CollectionViewGroup in a GroupItem container', () => {
        const ic = new ItemsControl();
        ic.ItemTemplate = new DataTemplate(d => new Leaf(String((d as { name: string }).name)));
        ic.ItemsPanel   = () => new StackPanel();
        ic.GroupStyle   = new GroupStyle();
        ic.ItemsSource  = [
            { name: 'Alice', team: 'A' },
            { name: 'Bob',   team: 'B' },
            { name: 'Carla', team: 'A' },
        ];
        ic.View!.GroupDescriptions.Add(new GroupDescription(
            d => (d as { team: string }).team));

        // After grouping installs, the top-level containers are
        // GroupItems — one per team.
        const c0 = ic.Generator.ContainerFromIndex(0);
        const c1 = ic.Generator.ContainerFromIndex(1);
        assert.ok(c0 instanceof GroupItem);
        assert.ok(c1 instanceof GroupItem);

        // Each GroupItem hosts the leaf items as its own Items.
        const giA = c0 as GroupItem;
        assert.equal(giA.ItemCount(), 2);   // Alice + Carla
        const giB = c1 as GroupItem;
        assert.equal(giB.ItemCount(), 1);   // Bob
    });

    test('nested grouping: two GroupDescriptions produce two-level CollectionViewGroup tree', () => {
        const ic = new ItemsControl();
        ic.ItemTemplate = new DataTemplate(d => new Leaf(String((d as { name: string }).name)));
        ic.ItemsPanel   = () => new StackPanel();
        ic.GroupStyle   = new GroupStyle();
        ic.ItemsSource  = [
            { name: 'Alice',  team: 'A', tier: 'Senior' },
            { name: 'Bob',    team: 'B', tier: 'Senior' },
            { name: 'Carla',  team: 'A', tier: 'Junior' },
            { name: 'Daniel', team: 'A', tier: 'Senior' },
        ];
        ic.View!.GroupDescriptions.Add(new GroupDescription(d => (d as { team: string }).team));
        ic.View!.GroupDescriptions.Add(new GroupDescription(d => (d as { tier: string }).tier));

        const groups = ic.View!.Groups!;
        // Top level: two teams (A, B).
        assert.equal(groups.length, 2);
        assert.equal(groups[0]!.Name, 'A');
        assert.equal(groups[0]!.Level, 0);
        assert.equal(groups[0]!.IsBottomLevel, false);
        // Team A has two tiers (Senior, Junior).
        const teamA = groups[0]!;
        assert.equal(teamA.ItemCount, 2);
        const tiers = [...teamA.Items];
        assert.ok(tiers[0] instanceof CollectionViewGroup);
        assert.equal((tiers[0] as CollectionViewGroup).Name, 'Senior');
        assert.equal((tiers[0] as CollectionViewGroup).Level, 1);
        assert.equal((tiers[0] as CollectionViewGroup).IsBottomLevel, true);
        // Senior tier in team A: Alice + Daniel.
        assert.equal((tiers[0] as CollectionViewGroup).ItemCount, 2);
    });

    test('GroupStyleSelector picks a different GroupStyle per level', () => {
        const ic = new ItemsControl();
        ic.ItemTemplate = new DataTemplate(d => new Leaf(String((d as { name: string }).name)));
        ic.ItemsPanel   = () => new StackPanel();

        const calls: Array<{ name: unknown; level: number }> = [];
        const teamStyle = new GroupStyle();
        const tierStyle = new GroupStyle();
        ic.GroupStyleSelector = (group, level) => {
            calls.push({ name: group.Name, level });
            return level === 0 ? teamStyle : tierStyle;
        };
        ic.ItemsSource = [
            { name: 'Alice', team: 'A', tier: 'Senior' },
            { name: 'Bob',   team: 'A', tier: 'Junior' },
        ];
        ic.View!.GroupDescriptions.Add(new GroupDescription(d => (d as { team: string }).team));
        ic.View!.GroupDescriptions.Add(new GroupDescription(d => (d as { tier: string }).tier));

        // Selector was consulted at both levels (top group A → level 0;
        // sub-groups Senior/Junior → level 1, fired during the GroupItem's
        // own recursive realization).
        const levels = calls.map(c => c.level);
        assert.ok(levels.includes(0));
        assert.ok(levels.includes(1));
    });

    test('GroupStyle.HeaderTemplate stamps each header from the group data', () => {
        const ic = new ItemsControl();
        ic.ItemTemplate = new DataTemplate(d => new Leaf(String(d)));
        ic.ItemsPanel   = () => new StackPanel();

        const headerLabels: string[] = [];
        ic.GroupStyle = new GroupStyle(
            new DataTemplate(d => {
                const lf = new Leaf(`Header:${String((d as CollectionViewGroup).Name)}`);
                headerLabels.push(lf.label);
                return lf;
            }),
        );
        ic.ItemsSource = ['x.a', 'y.a', 'x.b'];
        ic.View!.GroupDescriptions.Add(new GroupDescription(
            d => (d as string).split('.')[1]));

        // Two groups → two header stamps.
        assert.deepEqual(headerLabels, ['Header:a', 'Header:b']);

        // Each GroupItem now has a Header visual.
        const gi0 = ic.Generator.ContainerFromIndex(0) as GroupItem;
        assert.ok(gi0.Header instanceof Leaf);
        assert.equal((gi0.Header as Leaf).label, 'Header:a');
    });
});
