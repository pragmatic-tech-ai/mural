import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    MetaData,
    MuralBase,
    ObservableCollection,
    Panel,
    Setter,
    Size,
    Style,
    Element,
    Visual,
    type DrawingContext,
} from '../../runtime/index.js';
import { resolveKey } from '../../runtime/model-internals.js';
import { DataTemplate, DataTemplateSelector, HierarchicalDataTemplate, type ItemTemplateSelector } from '../../basic/index.js';
import { ItemsControl } from '@pragmatic-tech-ai/mural/framework';

// Tiny container — registered DP `Tag` lets ItemContainerStyle drive a
// visible value the test can assert on.
class Leaf extends Element
{
    static
    {
        MuralBase.RegisterProperty(Leaf, 'Tag', 'plain', MetaData.None);
    }
    constructor(public readonly source: unknown) { super(); }
    public get Tag(): string { return this.get_property_value(resolveKey(this, undefined, 'Tag')); }
    protected override MeasureOverride(_a: Size): Size { return new Size(10, 10); }
    protected override RenderOverride(_dc: DrawingContext): void { }
}

class TestPanel extends Panel { }

// Test subclass: the base ItemsControl wraps each item in a
// ContentPresenter for WPF parity, but most tests in this file are
// validating the original "template's Visual IS the container"
// semantic (ItemContainerStyle targeting Leaf, AlternationIndex
// stamped on Leaf, etc.). Skipping the wrap keeps the existing
// assertions readable; the wrap behavior is exercised separately
// where it's actually under test.
class TestIC extends ItemsControl
{
    public override GetContainerForItemOverride(item: unknown): Visual
    {
        const tmpl = DataTemplateSelector.resolve(this.ItemTemplateSelector, item, this) ?? this.ItemTemplate;
        if (tmpl === undefined)
        {
            throw new Error('test fixture: no template');
        }
        return tmpl.Apply(item);
    }
}

function makeTemplate(): DataTemplate
{
    return new DataTemplate(d => new Leaf(d));
}

function makeIC(items: readonly unknown[]): ItemsControl
{
    const ic = new TestIC();
    ic.ItemTemplate = makeTemplate();
    ic.ItemsPanel = () => new TestPanel();
    ic.Items = items;
    return ic;
}

describe('ItemsControl — ItemContainerStyle', () => {
    test('applies style to each generated container on initial load', () => {
        const ic = new TestIC();
        ic.ItemTemplate = makeTemplate();
        ic.ItemsPanel = () => new TestPanel();
        ic.ItemContainerStyle = new Style(Leaf, [new Setter(Leaf, 'Tag', 'styled')]);
        ic.Items = ['a', 'b'];
        const a = ic.Generator.ContainerFromItem('a') as Leaf;
        const b = ic.Generator.ContainerFromItem('b') as Leaf;
        assert.equal(a.Tag, 'styled');
        assert.equal(b.Tag, 'styled');
    });

    test('reapplies style when ItemContainerStyle changes after load', () => {
        const ic = makeIC(['a']);
        const c = ic.Generator.ContainerFromItem('a') as Leaf;
        assert.equal(c.Tag, 'plain');
        ic.ItemContainerStyle = new Style(Leaf, [new Setter(Leaf, 'Tag', 'red')]);
        assert.equal(c.Tag, 'red');
        ic.ItemContainerStyle = new Style(Leaf, [new Setter(Leaf, 'Tag', 'blue')]);
        assert.equal(c.Tag, 'blue');
    });

    test('clearing ItemContainerStyle unapplies setters', () => {
        const ic = makeIC(['a']);
        const c = ic.Generator.ContainerFromItem('a') as Leaf;
        ic.ItemContainerStyle = new Style(Leaf, [new Setter(Leaf, 'Tag', 'green')]);
        assert.equal(c.Tag, 'green');
        ic.ItemContainerStyle = undefined;
        assert.equal(c.Tag, 'plain');
    });

    test('style applies to inserted containers too (incremental path)', () => {
        const obs = new ObservableCollection<string>(['a']);
        const ic = new TestIC();
        ic.ItemTemplate = makeTemplate();
        ic.ItemsPanel = () => new TestPanel();
        ic.ItemContainerStyle = new Style(Leaf, [new Setter(Leaf, 'Tag', 'styled')]);
        ic.Items = obs;
        obs.Add('b');
        const b = ic.Generator.ContainerFromItem('b') as Leaf;
        assert.equal(b.Tag, 'styled');
    });
});

describe('ItemsControl — AlternationCount / AlternationIndex', () => {
    test('AlternationCount=0 leaves AlternationIndex at default 0', () => {
        const ic = makeIC(['a', 'b', 'c']);
        for (const item of ['a', 'b', 'c'])
        {
            const c = ic.Generator.ContainerFromItem(item)!;
            assert.equal(ItemsControl.GetAlternationIndex(c), 0);
        }
    });

    test('AlternationCount=2 stamps alternating 0,1,0,1,...', () => {
        const ic = new TestIC();
        ic.AlternationCount = 2;
        ic.ItemTemplate = makeTemplate();
        ic.ItemsPanel = () => new TestPanel();
        ic.Items = ['a', 'b', 'c', 'd'];
        const expected = [0, 1, 0, 1];
        ['a', 'b', 'c', 'd'].forEach((item, i) => {
            const c = ic.Generator.ContainerFromItem(item)!;
            assert.equal(ItemsControl.GetAlternationIndex(c), expected[i]);
        });
    });

    test('inserting an item re-stamps subsequent containers', () => {
        const obs = new ObservableCollection<string>(['a', 'b', 'c']);
        const ic = new TestIC();
        ic.AlternationCount = 2;
        ic.ItemTemplate = makeTemplate();
        ic.ItemsPanel = () => new TestPanel();
        ic.Items = obs;
        // Pre-insert: [a=0, b=1, c=0]
        // Insert 'x' at index 1 → [a, x, b, c] → [0, 1, 0, 1]
        obs.Insert(1, 'x');
        assert.equal(ItemsControl.GetAlternationIndex(ic.Generator.ContainerFromItem('a')!), 0);
        assert.equal(ItemsControl.GetAlternationIndex(ic.Generator.ContainerFromItem('x')!), 1);
        assert.equal(ItemsControl.GetAlternationIndex(ic.Generator.ContainerFromItem('b')!), 0);
        assert.equal(ItemsControl.GetAlternationIndex(ic.Generator.ContainerFromItem('c')!), 1);
    });

    test('changing AlternationCount re-stamps every realized container', () => {
        const ic = new TestIC();
        ic.AlternationCount = 2;
        ic.ItemTemplate = makeTemplate();
        ic.ItemsPanel = () => new TestPanel();
        ic.Items = ['a', 'b', 'c', 'd'];
        // [0, 1, 0, 1]
        ic.AlternationCount = 3;
        // [0, 1, 2, 0]
        const expected = [0, 1, 2, 0];
        ['a', 'b', 'c', 'd'].forEach((item, i) => {
            assert.equal(ItemsControl.GetAlternationIndex(ic.Generator.ContainerFromItem(item)!), expected[i]);
        });
    });
});

describe('ItemsControl — HasItems', () => {
    test('starts false with no Items', () => {
        const ic = new TestIC();
        assert.equal(ic.HasItems, false);
    });

    test('becomes true on non-empty Items assignment', () => {
        const ic = makeIC(['a']);
        assert.equal(ic.HasItems, true);
    });

    test('reverts to false when Items become empty', () => {
        const ic = makeIC(['a']);
        ic.Items = [];
        assert.equal(ic.HasItems, false);
    });

    test('tracks ObservableCollection mutations', () => {
        const obs = new ObservableCollection<string>();
        const ic = new TestIC();
        ic.ItemTemplate = makeTemplate();
        ic.ItemsPanel = () => new TestPanel();
        ic.Items = obs;
        assert.equal(ic.HasItems, false);
        obs.Add('a');
        assert.equal(ic.HasItems, true);
        obs.Add('b');
        assert.equal(ic.HasItems, true);
        obs.Clear();
        assert.equal(ic.HasItems, false);
    });
});

describe('ItemsControl — ItemTemplateSelector', () => {
    class TagA extends Leaf { }
    class TagB extends Leaf { }

    test('selector picks a template per item; falls back to ItemTemplate when undefined', () => {
        const tplA = new DataTemplate(d => new TagA(d));
        const tplB = new DataTemplate(d => new TagB(d));
        const tplDefault = new DataTemplate(d => new Leaf(d));

        const selector: ItemTemplateSelector = (item) => {
            if (item === 'A') return tplA;
            if (item === 'B') return tplB;
            return undefined;
        };

        const ic = new TestIC();
        ic.ItemTemplate = tplDefault;
        ic.ItemTemplateSelector = selector;
        ic.ItemsPanel = () => new TestPanel();
        ic.Items = ['A', 'B', 'C'];

        assert.ok(ic.Generator.ContainerFromItem('A') instanceof TagA);
        assert.ok(ic.Generator.ContainerFromItem('B') instanceof TagB);
        // C: selector returned undefined → ItemTemplate used.
        const c = ic.Generator.ContainerFromItem('C')!;
        assert.ok(c instanceof Leaf);
        assert.ok(!(c instanceof TagA));
        assert.ok(!(c instanceof TagB));
    });

    test('changing the selector rebuilds containers', () => {
        const ic = new TestIC();
        ic.ItemTemplate = new DataTemplate(d => new Leaf(d));
        ic.ItemsPanel = () => new TestPanel();
        ic.Items = ['x', 'y'];
        const before = ic.Generator.ContainerFromItem('x')!;
        ic.ItemTemplateSelector = (item) => item === 'x' ? new DataTemplate(d => new TagA(d)) : undefined;
        const after = ic.Generator.ContainerFromItem('x')!;
        assert.notEqual(before, after);
        assert.ok(after instanceof TagA);
    });

    // The DP now accepts a DataTemplateSelector OBJECT as well as a function
    // (markup can only author the object). Same per-item behaviour + fallback.
    test('accepts a DataTemplateSelector object (union with the function form)', () => {
        const tplA = new DataTemplate(d => new TagA(d));
        const tplB = new DataTemplate(d => new TagB(d));
        const tplDefault = new DataTemplate(d => new Leaf(d));

        class PickSelector extends DataTemplateSelector
        {
            public SelectTemplate(item: unknown): DataTemplate | undefined
            {
                if (item === 'A') return tplA;
                if (item === 'B') return tplB;
                return undefined;   // → ItemTemplate fallback
            }
        }

        const ic = new TestIC();
        ic.ItemTemplate = tplDefault;
        ic.ItemTemplateSelector = new PickSelector();
        ic.ItemsPanel = () => new TestPanel();
        ic.Items = ['A', 'B', 'C'];

        assert.ok(ic.Generator.ContainerFromItem('A') instanceof TagA);
        assert.ok(ic.Generator.ContainerFromItem('B') instanceof TagB);
        const c = ic.Generator.ContainerFromItem('C')!;
        assert.ok(c instanceof Leaf);
        assert.ok(!(c instanceof TagA));
    });
});

describe('ItemsControl — subclass override points', () => {
    class CustomItemsControl extends ItemsControl
    {
        public prepares: { item: unknown; index: number }[] = [];
        public clears:   { item: unknown }[] = [];

        public override GetContainerForItemOverride(item: unknown): Visual
        {
            // Wrap items in a TagA regardless of template — exercises
            // the "subclass owns the container shape" pattern.
            return new (class extends Leaf {})(item);
        }

        public override PrepareContainerForItemOverride(c: Visual, item: unknown, i: number): void
        {
            super.PrepareContainerForItemOverride(c, item, i);
            this.prepares.push({ item, index: i });
        }

        public override ClearContainerForItemOverride(c: Visual, item: unknown): void
        {
            super.ClearContainerForItemOverride(c, item);
            this.clears.push({ item });
        }
    }

    test('GetContainerForItemOverride is called per item; default delegates to ItemTemplate / Selector', () => {
        const ic = new CustomItemsControl();
        ic.ItemsPanel = () => new TestPanel();
        // No ItemTemplate, no Selector — subclass override owns
        // container creation. Rebuild should NOT throw.
        ic.Items = ['a', 'b'];
        assert.equal(ic.Generator.Count, 2);
    });

    test('Prepare fires after Realize with monotonic indices', () => {
        const ic = new CustomItemsControl();
        ic.ItemsPanel = () => new TestPanel();
        ic.Items = ['a', 'b', 'c'];
        assert.deepEqual(
            ic.prepares.map(p => ({ item: p.item, index: p.index })),
            [{ item: 'a', index: 0 }, { item: 'b', index: 1 }, { item: 'c', index: 2 }],
        );
    });

    test('Clear fires for every container on items removal', () => {
        const obs = new ObservableCollection<string>(['a', 'b']);
        const ic = new CustomItemsControl();
        ic.ItemsPanel = () => new TestPanel();
        ic.Items = obs;
        obs.Remove('a');
        assert.equal(ic.clears.length, 1);
        assert.equal(ic.clears[0]!.item, 'a');
    });

    test('Items reassignment Clears every prior container', () => {
        const ic = new CustomItemsControl();
        ic.ItemsPanel = () => new TestPanel();
        ic.Items = ['a', 'b'];
        ic.clears.length = 0;
        ic.Items = ['c'];
        assert.equal(ic.clears.length, 2);
    });
});

describe('ItemContainerGenerator — recycle pool', () => {
    test('Recycle pushes container into pool', () => {
        const ic = makeIC(['a', 'b']);
        const a = ic.Generator.ContainerFromItem('a')!;
        ic.Generator.Recycle(a);
        assert.equal(ic.Generator.RecycledCount, 1);
    });

    test('ClaimRecycled returns LIFO; undefined when pool empty', () => {
        const ic = makeIC(['a', 'b']);
        const a = ic.Generator.ContainerFromItem('a')!;
        const b = ic.Generator.ContainerFromItem('b')!;
        ic.Generator.Recycle(a);
        ic.Generator.Recycle(b);
        assert.equal(ic.Generator.ClaimRecycled(), b);   // LIFO
        assert.equal(ic.Generator.ClaimRecycled(), a);
        assert.equal(ic.Generator.ClaimRecycled(), undefined);
    });

    test('Clear drops the pool', () => {
        const ic = makeIC(['a', 'b']);
        ic.Generator.Recycle(ic.Generator.ContainerFromItem('a')!);
        ic.Generator.Clear();
        assert.equal(ic.Generator.RecycledCount, 0);
    });
});

describe('ItemsControl — ItemsSource', () => {
    test('assigning ItemsSource auto-wraps in a CollectionView; Items returns it', () => {
        const ic = new TestIC();
        ic.ItemTemplate = makeTemplate();
        ic.ItemsPanel = () => new TestPanel();
        ic.ItemsSource = ['a', 'b', 'c'];
        assert.ok(ic.View !== undefined);
        assert.equal(ic.View!.Count, 3);
        // Items is the projected view.
        assert.equal(ic.Items, ic.View);
    });

    test('directly assigning Items while ItemsSource is set throws', () => {
        const ic = new TestIC();
        ic.ItemTemplate = makeTemplate();
        ic.ItemsPanel = () => new TestPanel();
        ic.ItemsSource = ['a'];
        assert.throws(() => { ic.Items = ['x']; }, /ItemsSource/);
    });

    test('clearing ItemsSource clears the projection', () => {
        const ic = new TestIC();
        ic.ItemTemplate = makeTemplate();
        ic.ItemsPanel = () => new TestPanel();
        ic.ItemsSource = ['a', 'b'];
        ic.ItemsSource = undefined;
        assert.equal(ic.View, undefined);
        assert.equal(ic.Items, undefined);
    });
});

describe('HierarchicalDataTemplate', () => {
    test('ItemsOf walks the selector', () => {
        const tpl = new HierarchicalDataTemplate(
            d => new Leaf(d),
            d => (d as { children?: unknown[] }).children,
        );
        const data = { name: 'root', children: [{ name: 'a' }, { name: 'b' }] };
        const out = [...tpl.ItemsOf(data)];
        assert.deepEqual(out, data.children);
    });

    test('ItemsOf yields empty for leaf items (selector returns undefined)', () => {
        const tpl = new HierarchicalDataTemplate(
            d => new Leaf(d),
            _ => undefined,
        );
        assert.deepEqual([...tpl.ItemsOf({ name: 'leaf' })], []);
    });

    test('itemTemplate field carries the nested DataTemplate', () => {
        const nested = new DataTemplate(d => new Leaf(d));
        const tpl = new HierarchicalDataTemplate(
            d => new Leaf(d),
            _ => undefined,
            nested,
        );
        assert.equal(tpl.itemTemplate, nested);
    });
});
