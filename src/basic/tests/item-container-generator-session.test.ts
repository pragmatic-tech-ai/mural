import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ObservableCollection, Element, Visual } from '../../runtime/index.js';
import { DataTemplate } from '../templates/data-template.js';
import { ItemsControl } from '../../framework/base/items-control.js';
import { StackPanel } from '../panels/stack-panel.js';
import {
    GeneratorDirection,
    GeneratorPosition,
    ItemsChangedAction,
    type ItemsChangedArgs,
} from '../collections/item-container-generator.js';

// Minimal Visual leaf used as a container; the DataTemplate stamps
// these for each test item.
class Leaf extends Element
{
    constructor(public readonly label: string) { super(); }
}

// Containers are per-item ContentPresenters wrapping the template
// output. `inner` peels the wrap so tests can assert on the Leaf
// directly.
function inner(container: Visual | undefined): Visual | undefined
{
    return container === undefined
        ? undefined
        : (container.visualChildren[0] ?? container);
}

function makeIC(items: readonly unknown[]): ItemsControl
{
    const ic = new ItemsControl();
    ic.ItemTemplate = new DataTemplate(data => new Leaf(String(data)));
    ic.ItemsPanel   = () => {
        // Plain Panel via a thin subclass — we don't need it to lay
        // anything out for these tests, just to exist so the
        // ItemsControl wires containers into it.
        // Use any of mural's panels; StackPanel is the lightest that
        // also propagates target / arrange correctly when items
        // attach. Tests don't measure, so even a no-op subclass is
        // fine; we just need a container.
        return new StackPanel();
    };
    ic.Items = items;
    return ic;
}

describe('ItemContainerGenerator — index map', () => {
    test('ContainerFromIndex + IndexFromContainer round-trip after rebuildContainers', () => {
        const ic = makeIC(['a', 'b', 'c']);
        const c0 = ic.Generator.ContainerFromIndex(0)!;
        const c1 = ic.Generator.ContainerFromIndex(1)!;
        const c2 = ic.Generator.ContainerFromIndex(2)!;
        assert.ok(c0 && c1 && c2);
        assert.equal(ic.Generator.IndexFromContainer(c0), 0);
        assert.equal(ic.Generator.IndexFromContainer(c1), 1);
        assert.equal(ic.Generator.IndexFromContainer(c2), 2);
    });

    test('IndexFromContainer returns -1 for unmanaged containers (WPF parity)', () => {
        const ic = makeIC(['a']);
        const stranger = new Leaf('not in any IC');
        assert.equal(ic.Generator.IndexFromContainer(stranger), -1);
    });

    test('ContainerFromIndex returns undefined past the end', () => {
        const ic = makeIC(['a', 'b']);
        assert.equal(ic.Generator.ContainerFromIndex(99), undefined);
    });
});

describe('ItemContainerGenerator — StartAt / GenerateNext session', () => {
    test('StartAt(StartOfList) generates each item once, marks newly realized', () => {
        const ic = new ItemsControl();
        ic.ItemTemplate = new DataTemplate(data => new Leaf(String(data)));
        ic.ItemsPanel   = () => new StackPanel();
        // Items first time — rebuildContainers ran via the session.
        ic.Items = ['a', 'b', 'c'];

        // Re-run a session on the same generator: items are already
        // realized, so isNewlyRealized should come back false.
        const s = ic.Generator.StartAt(GeneratorPosition.StartOfList, GeneratorDirection.Forward);
        const r0 = s.GenerateNext();
        const r1 = s.GenerateNext();
        const r2 = s.GenerateNext();
        const r3 = s.GenerateNext();
        s.dispose();

        assert.ok(inner(r0.container) instanceof Leaf);
        assert.ok(inner(r1.container) instanceof Leaf);
        assert.ok(inner(r2.container) instanceof Leaf);
        assert.equal(r0.isNewlyRealized, false);
        assert.equal(r1.isNewlyRealized, false);
        assert.equal(r2.isNewlyRealized, false);
        // Past the end: undefined.
        assert.equal(r3.container, undefined);
    });

    test('Dispose stops the session — further GenerateNext returns undefined', () => {
        const ic = makeIC(['a', 'b']);
        const s  = ic.Generator.StartAt();
        s.dispose();
        const after = s.GenerateNext();
        assert.equal(after.container, undefined);
    });

    test('StartAt at a positional offset starts mid-collection', () => {
        const ic = makeIC(['a', 'b', 'c', 'd']);
        // Position(0, 2) → start at absolute index 0+2 = 2.
        const s  = ic.Generator.StartAt(new GeneratorPosition(0, 2));
        const r0 = s.GenerateNext();
        const r1 = s.GenerateNext();
        s.dispose();
        assert.equal((inner(r0.container) as Leaf).label, 'c');
        assert.equal((inner(r1.container) as Leaf).label, 'd');
    });

    test('StartAt(StartOfList, Backward) walks the collection right-to-left', () => {
        const ic = makeIC(['a', 'b', 'c']);
        const s  = ic.Generator.StartAt(GeneratorPosition.StartOfList, GeneratorDirection.Backward);
        const r0 = s.GenerateNext();
        const r1 = s.GenerateNext();
        const r2 = s.GenerateNext();
        const r3 = s.GenerateNext();
        s.dispose();
        assert.equal((inner(r0.container) as Leaf).label, 'c');
        assert.equal((inner(r1.container) as Leaf).label, 'b');
        assert.equal((inner(r2.container) as Leaf).label, 'a');
        // Past the front of the list: undefined.
        assert.equal(r3.container, undefined);
    });
});

describe('ItemContainerGenerator — PrepareItemContainer', () => {
    test('routes through ItemsControl.PrepareContainerForItemOverride with the right item + index', () => {
        const calls: Array<[string, number]> = [];

        class TrackingIC extends ItemsControl
        {
            public override PrepareContainerForItemOverride(c: Visual, item: unknown, index: number): void
            {
                super.PrepareContainerForItemOverride(c, item, index);
                calls.push([String(item), index]);
            }
        }

        const ic = new TrackingIC();
        ic.ItemTemplate = new DataTemplate(data => new Leaf(String(data)));
        ic.ItemsPanel   = () => new StackPanel();
        ic.Items = ['x', 'y', 'z'];

        assert.deepEqual(calls, [['x', 0], ['y', 1], ['z', 2]]);
    });
});

describe('ItemContainerGenerator — ItemsChanged event', () => {
    test('fires Add when an ObservableCollection item is inserted', async () => {
const oc = new ObservableCollection<string>(['a', 'b']);
        const ic = makeIC(oc as never);
        const events: ItemsChangedArgs[] = [];
        ic.Generator.SubscribeItemsChanged(args => events.push(args));

        oc.Insert(1, 'inserted');

        assert.equal(events.length, 1);
        assert.equal(events[0]!.Action, ItemsChangedAction.Add);
        assert.equal(events[0]!.Position.Index, 1);
        assert.equal(events[0]!.ItemCount, 1);
    });

    test('fires Remove on RemoveAt', async () => {
const oc = new ObservableCollection<string>(['a', 'b', 'c']);
        const ic = makeIC(oc as never);
        const events: ItemsChangedArgs[] = [];
        ic.Generator.SubscribeItemsChanged(args => events.push(args));

        oc.RemoveAt(1);

        assert.equal(events[0]!.Action, ItemsChangedAction.Remove);
        assert.equal(events[0]!.Position.Index, 1);
    });

    test('fires Replace on SetAt', async () => {
const oc = new ObservableCollection<string>(['a', 'b', 'c']);
        const ic = makeIC(oc as never);
        const events: ItemsChangedArgs[] = [];
        ic.Generator.SubscribeItemsChanged(args => events.push(args));

        oc.SetAt(1, 'B');

        assert.equal(events[0]!.Action, ItemsChangedAction.Replace);
        assert.equal(events[0]!.Position.Index, 1);
    });
});

describe('ItemContainerGenerator — ShiftIndicesFrom (index map under mutation)', () => {
    test('Insert shifts indices of later containers up', async () => {
const oc = new ObservableCollection<string>(['a', 'b', 'c']);
        const ic = makeIC(oc as never);
        const cBefore = ic.Generator.ContainerFromIndex(2)!;  // container for 'c'

        oc.Insert(1, 'inserted');

        // 'c' now lives at index 3.
        assert.equal(ic.Generator.IndexFromContainer(cBefore), 3);
        assert.equal(ic.Generator.ContainerFromIndex(3), cBefore);
    });

    test('Remove shifts indices of later containers down', async () => {
const oc = new ObservableCollection<string>(['a', 'b', 'c']);
        const ic = makeIC(oc as never);
        const cBefore = ic.Generator.ContainerFromIndex(2)!;  // 'c'

        oc.RemoveAt(0);  // remove 'a'

        // 'c' is now at index 1.
        assert.equal(ic.Generator.IndexFromContainer(cBefore), 1);
        assert.equal(ic.Generator.ContainerFromIndex(1), cBefore);
    });
});
