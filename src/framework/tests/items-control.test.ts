import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    MetaData,
    MuralBase,
    ObservableCollection,
    Panel,
    Size,
    Element,
    Visual,
    type DrawingContext,
} from '../../runtime/index.js';
import { resolveKey } from '../../runtime/model-internals.js';
import { Canvas, DataTemplate, DataTemplateSelector } from '../../basic/index.js';
import { ItemsControl } from '@pragmatic-tech-ai/mural/framework';

// Test-side accessor for Visual's protected parent getters.
function visualParentOf(v: Visual | undefined): Visual | undefined
{
    if (v === undefined) return undefined;
    return (v as unknown as { visualParent: Visual | undefined }).visualParent;
}
function logicalParentOf(v: Visual | undefined): Visual | undefined
{
    if (v === undefined) return undefined;
    return (v as unknown as { logicalParent: Visual | undefined }).logicalParent;
}

// Tiny leaf used as the container Visual produced by the data template.
// Carries the source data on a field so tests can identify which item
// each container represents. The Tint property exists to verify
// inheritance flows from the ItemsControl (logical parent of each
// container) down to the container.
class ItemLeaf extends Element
{
    static {
        MuralBase.RegisterProperty(ItemLeaf, 'Tint', 'default', MetaData.Inherits);
    }
    constructor(public readonly source: unknown) { super(); }

    public get Tint(): string { return this.get_property_value(resolveKey(this, undefined, 'Tint')); }

    protected override MeasureOverride(_a: Size): Size { return new Size(10, 10); }
    protected override RenderOverride(_dc: DrawingContext): void { }
}

// Minimal Panel — Canvas would work but we want something dependency-
// free. Plain Panel doesn't override MeasureOverride / ArrangeOverride,
// so it reports zero size; that's OK for the wiring assertions below.
class TestPanel extends Panel { }

// Test subclass: base ItemsControl wraps each item in a
// ContentPresenter for WPF parity, but these tests are verifying the
// "template Visual IS the container" semantic (inheritance to the
// leaf, container == ItemTemplate output). Skipping the wrap here
// keeps the assertions readable; the wrap behavior is exercised in
// the dedicated WPF-parity tests.
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
    return new DataTemplate(data => new ItemLeaf(data));
}

describe('ItemsControl', () => {
    test('renders no containers when Items / ItemTemplate / ItemsPanel are missing', () => {
        const ic = new TestIC();
        assert.equal(ic.visualChildren.length,  0);
        assert.equal(ic.logicalChildren.length, 0);

        ic.Items = ['a', 'b', 'c'];           // panel + template still missing
        assert.equal(ic.logicalChildren.length, 0);

        ic.ItemTemplate = makeTemplate();     // panel still missing
        assert.equal(ic.logicalChildren.length, 0);
    });

    test('materializes a container per item once all three are set', () => {
        const ic = new TestIC();
        ic.ItemsPanel   = () => new TestPanel();
        ic.ItemTemplate = makeTemplate();
        ic.Items        = ['a', 'b', 'c'];

        assert.equal(ic.logicalChildren.length, 3);
        for (let i = 0; i < 3; i++)
        {
            const container = ic.logicalChildren[i] as ItemLeaf;
            assert.equal(container.source, ['a', 'b', 'c'][i]);
        }
    });

    test('container visual parent is the items panel; logical parent is the ItemsControl', () => {
        // The headline two-tree divergence for data-driven UI.
        const ic = new TestIC();
        const panel = new TestPanel();
        ic.ItemsPanel   = () => panel;
        ic.ItemTemplate = makeTemplate();
        ic.Items        = ['only'];

        const container = ic.logicalChildren[0]!;
        assert.equal(visualParentOf(container),  panel);
        assert.equal(logicalParentOf(container), ic);
    });

    test('items panel is the only visual child of the ItemsControl', () => {
        const ic = new TestIC();
        const panel = new TestPanel();
        ic.ItemsPanel   = () => panel;
        ic.ItemTemplate = makeTemplate();
        ic.Items        = ['x', 'y'];
        assert.equal(ic.visualChildren.length, 1);
        assert.equal(ic.visualChildren[0], panel);
    });

    test('reassigning Items rebuilds containers', () => {
        const ic = new TestIC();
        ic.ItemsPanel   = () => new TestPanel();
        ic.ItemTemplate = makeTemplate();
        ic.Items        = ['a', 'b'];
        const firstBatch = [...ic.logicalChildren];
        assert.equal(firstBatch.length, 2);

        ic.Items = ['x', 'y', 'z'];
        const secondBatch = [...ic.logicalChildren];
        assert.equal(secondBatch.length, 3);
        // Different instances — full rebuild.
        for (const c of firstBatch)
        {
            assert.equal(secondBatch.includes(c), false);
        }
    });

    test('replacing ItemTemplate rebuilds containers', () => {
        const ic = new TestIC();
        ic.ItemsPanel   = () => new TestPanel();
        ic.ItemTemplate = makeTemplate();
        ic.Items        = ['a', 'b'];
        const before = [...ic.logicalChildren];

        ic.ItemTemplate = new DataTemplate(data => new ItemLeaf(`wrapped:${data}`));
        const after = [...ic.logicalChildren];
        for (const c of after)
        {
            assert.ok(c instanceof ItemLeaf);
            assert.ok((c as ItemLeaf).source!.toString().startsWith('wrapped:'));
        }
        assert.notDeepEqual(before, after);
    });

    test('replacing ItemsPanel tears down containers and remounts under the new panel', () => {
        const ic = new TestIC();
        const panelA = new TestPanel();
        ic.ItemsPanel   = () => panelA;
        ic.ItemTemplate = makeTemplate();
        ic.Items        = ['a', 'b'];
        assert.equal(panelA.Children.Count, 2);

        const panelB = new TestPanel();
        ic.ItemsPanel = () => panelB;
        assert.equal(panelA.Children.Count, 0);
        assert.equal(panelB.Children.Count, 2);
        for (const c of panelB.Children)
        {
            assert.equal(visualParentOf(c),  panelB);
            assert.equal(logicalParentOf(c), ic);
        }
    });

    // ----------------------------------------------------------------
    // ObservableCollection
    // ----------------------------------------------------------------

    test('ObservableCollection: Add triggers a rebuild including the new item', () => {
        const items = new ObservableCollection<string>(['a']);
        const ic = new TestIC();
        ic.ItemsPanel   = () => new TestPanel();
        ic.ItemTemplate = makeTemplate();
        ic.Items        = items;
        assert.equal(ic.logicalChildren.length, 1);

        items.Add('b');
        assert.equal(ic.logicalChildren.length, 2);
        assert.equal((ic.logicalChildren[1] as ItemLeaf).source, 'b');
    });

    test('ObservableCollection: Remove triggers a rebuild without the removed item', () => {
        const items = new ObservableCollection<string>(['a', 'b', 'c']);
        const ic = new TestIC();
        ic.ItemsPanel   = () => new TestPanel();
        ic.ItemTemplate = makeTemplate();
        ic.Items        = items;
        assert.equal(ic.logicalChildren.length, 3);

        items.Remove('b');
        assert.equal(ic.logicalChildren.length, 2);
        assert.deepEqual(
            ic.logicalChildren.map(c => (c as ItemLeaf).source),
            ['a', 'c'],
        );
    });

    test('ObservableCollection: Add reuses existing containers (incremental, not full rebuild)', () => {
        // Snapshot the existing container instances; after Add, those
        // SAME instances are still present — only the new item gets a
        // freshly-made container. Distinguishes the incremental path
        // from the previous full-rebuild behavior.
        const items = new ObservableCollection<string>(['a', 'b']);
        const ic = new TestIC();
        ic.ItemsPanel   = () => new TestPanel();
        ic.ItemTemplate = makeTemplate();
        ic.Items        = items;
        const containerA = ic.logicalChildren[0];
        const containerB = ic.logicalChildren[1];

        items.Add('c');
        assert.equal(ic.logicalChildren[0], containerA);  // preserved
        assert.equal(ic.logicalChildren[1], containerB);
        assert.equal((ic.logicalChildren[2] as ItemLeaf).source, 'c');
    });

    test('ObservableCollection: Insert places the new container at the right index, preserving others', () => {
        const items = new ObservableCollection<string>(['a', 'c']);
        const ic = new TestIC();
        ic.ItemsPanel   = () => new TestPanel();
        ic.ItemTemplate = makeTemplate();
        ic.Items        = items;
        const cA = ic.logicalChildren[0];
        const cC = ic.logicalChildren[1];

        items.Insert(1, 'b');
        assert.equal(ic.logicalChildren.length, 3);
        assert.equal(ic.logicalChildren[0], cA);
        assert.equal((ic.logicalChildren[1] as ItemLeaf).source, 'b');
        assert.equal(ic.logicalChildren[2], cC);
    });

    test('ObservableCollection: Remove keeps surrounding containers intact', () => {
        const items = new ObservableCollection<string>(['a', 'b', 'c']);
        const ic = new TestIC();
        ic.ItemsPanel   = () => new TestPanel();
        ic.ItemTemplate = makeTemplate();
        ic.Items        = items;
        const cA = ic.logicalChildren[0];
        const cC = ic.logicalChildren[2];

        items.Remove('b');
        assert.equal(ic.logicalChildren.length, 2);
        assert.equal(ic.logicalChildren[0], cA);  // same instance, NOT a rebuild
        assert.equal(ic.logicalChildren[1], cC);
    });

    test('ObservableCollection: SetAt replaces one container, leaves the rest', () => {
        const items = new ObservableCollection<string>(['a', 'b', 'c']);
        const ic = new TestIC();
        ic.ItemsPanel   = () => new TestPanel();
        ic.ItemTemplate = makeTemplate();
        ic.Items        = items;
        const cA = ic.logicalChildren[0];
        const cBOriginal = ic.logicalChildren[1];
        const cC = ic.logicalChildren[2];

        items.SetAt(1, 'B');
        const cBNew = ic.logicalChildren[1];
        assert.equal(ic.logicalChildren[0], cA);          // preserved
        assert.equal(ic.logicalChildren[2], cC);          // preserved
        assert.notEqual(cBNew, cBOriginal);                // swapped
        assert.equal((cBNew as ItemLeaf).source, 'B');
    });

    test('ObservableCollection: Clear empties the containers', () => {
        const items = new ObservableCollection<string>(['a', 'b']);
        const ic = new TestIC();
        ic.ItemsPanel   = () => new TestPanel();
        ic.ItemTemplate = makeTemplate();
        ic.Items        = items;
        assert.equal(ic.logicalChildren.length, 2);

        items.Clear();
        assert.equal(ic.logicalChildren.length, 0);
    });

    test('reassigning Items unsubscribes from the previous ObservableCollection', () => {
        const itemsA = new ObservableCollection<string>(['a']);
        const itemsB = new ObservableCollection<string>(['b']);
        const ic = new TestIC();
        ic.ItemsPanel   = () => new TestPanel();
        ic.ItemTemplate = makeTemplate();
        ic.Items        = itemsA;
        assert.equal(ic.logicalChildren.length, 1);

        ic.Items = itemsB;
        assert.equal(ic.logicalChildren.length, 1);
        assert.equal((ic.logicalChildren[0] as ItemLeaf).source, 'b');

        // Mutating the OLD collection must not affect the ItemsControl now.
        itemsA.Add('a2');
        assert.equal(ic.logicalChildren.length, 1);
        assert.equal((ic.logicalChildren[0] as ItemLeaf).source, 'b');
    });

    // ----------------------------------------------------------------
    // Inheritance through the two-tree divergence
    // ----------------------------------------------------------------

    test('inheritable values set on the ItemsControl reach each container via the logical tree', () => {
        // The Tint inheritance walk goes container → logical parent
        // (ItemsControl) → ... The items panel is bypassed since it's
        // template-internal (visual only). Set Tint on the ItemsControl
        // and confirm every container sees it.
        MuralBase.RegisterProperty(ItemsControl, 'Tint', 'default', MetaData.Inherits);

        const ic = new TestIC();
        ic.ItemsPanel   = () => new TestPanel();
        ic.ItemTemplate = makeTemplate();
        ic.set_property_value(resolveKey(ic, ItemLeaf, 'Tint'), 'mint');
        ic.Items        = ['a', 'b', 'c'];

        for (const c of ic.logicalChildren)
        {
            assert.equal((c as ItemLeaf).Tint, 'mint');
        }

        // Changing the value after mount also propagates.
        ic.set_property_value(resolveKey(ic, ItemLeaf, 'Tint'), 'rose');
        for (const c of ic.logicalChildren)
        {
            assert.equal((c as ItemLeaf).Tint, 'rose');
        }
    });

    test('ItemsControl + Canvas as ItemsPanel works end-to-end', () => {
        // Sanity check: the abstract Panel works as ItemsPanel, and
        // so do real concrete subclasses like Canvas.
        const ic = new TestIC();
        ic.ItemsPanel   = () => new Canvas();
        ic.ItemTemplate = makeTemplate();
        ic.Items        = ['a', 'b', 'c'];
        assert.equal(ic.logicalChildren.length, 3);
        const canvas = ic.visualChildren[0] as Canvas;
        assert.equal(canvas.Children.Count, 3);
    });
});
