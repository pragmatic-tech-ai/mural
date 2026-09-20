import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    MetaData,
    MuralBase,
    Setter,
    Size,
    Style,
    Element,
    Visual,
    type DrawingContext,
} from '../../runtime/index.js';
import { resolveKey } from '../../runtime/model-internals.js';
import { AlternationConverter, ContentPresenter, DataTemplate, DataTemplateSelector, StackPanel } from '../../basic/index.js';
import { ItemsControl } from '@pragmatic-tech-ai/mural/framework';

// Tiny container with a registered DP so the per-item style picker
// has somewhere visible to land.
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

// Subclass that skips the ContentPresenter wrap so style assertions can
// target Leaf directly. (The wrap behavior is exercised by
// items-control.test.ts.)
class TestIC extends ItemsControl
{
    public override GetContainerForItemOverride(item: unknown): Visual
    {
        const tmpl = DataTemplateSelector.resolve(this.ItemTemplateSelector, item, this) ?? this.ItemTemplate;
        if (tmpl === undefined) throw new Error('test fixture: no template');
        return tmpl.Apply(item);
    }
}

// ── AlternationConverter ────────────────────────────────────────────

describe('AlternationConverter', () => {
    test('round-robins through Values by integer index', () => {
        const conv = new AlternationConverter(['white', 'gray', 'blue']);
        assert.equal(conv.convert(0), 'white');
        assert.equal(conv.convert(1), 'gray');
        assert.equal(conv.convert(2), 'blue');
        assert.equal(conv.convert(3), 'white');   // wraps
        assert.equal(conv.convert(4), 'gray');
    });

    test('negative / non-integer inputs clamp to Values[0]', () => {
        const conv = new AlternationConverter(['white', 'gray']);
        assert.equal(conv.convert(-1), 'white');
        assert.equal(conv.convert(undefined), 'white');
        assert.equal(conv.convert('two'), 'white');
    });

    test('empty Values returns undefined', () => {
        const conv = new AlternationConverter([]);
        assert.equal(conv.convert(0), undefined);
    });
});

// ── ItemContainerStyleSelector ──────────────────────────────────────

describe('ItemContainerStyleSelector', () => {
    test('takes precedence over ItemContainerStyle when set', () => {
        const ic = new TestIC();
        ic.ItemTemplate = new DataTemplate(d => new Leaf(d));
        ic.ItemsPanel   = () => new StackPanel();
        const redStyle  = new Style(Leaf, [new Setter(Leaf, 'Tag', 'red')]);
        const blueStyle = new Style(Leaf, [new Setter(Leaf, 'Tag', 'blue')]);
        ic.ItemContainerStyle = redStyle;       // single-style fallback
        ic.ItemContainerStyleSelector = (item) =>
            item === 'b' ? blueStyle : undefined;   // per-item override for 'b'
        ic.Items = ['a', 'b', 'c'];

        // 'a' / 'c' fall back to red; 'b' is blue.
        const a = ic.Generator.ContainerFromItem('a') as Leaf;
        const b = ic.Generator.ContainerFromItem('b') as Leaf;
        const c = ic.Generator.ContainerFromItem('c') as Leaf;
        assert.equal(a.Tag, 'red');
        assert.equal(b.Tag, 'blue');
        assert.equal(c.Tag, 'red');
    });

    test('changing the selector re-applies across realized containers', () => {
        const ic = new TestIC();
        ic.ItemTemplate = new DataTemplate(d => new Leaf(d));
        ic.ItemsPanel   = () => new StackPanel();
        const greenStyle = new Style(Leaf, [new Setter(Leaf, 'Tag', 'green')]);
        ic.Items = ['x', 'y'];
        // No selector yet — both are 'plain'.
        const x = ic.Generator.ContainerFromItem('x') as Leaf;
        const y = ic.Generator.ContainerFromItem('y') as Leaf;
        assert.equal(x.Tag, 'plain');

        ic.ItemContainerStyleSelector = (item) =>
            item === 'x' ? greenStyle : undefined;

        assert.equal(x.Tag, 'green');
        assert.equal(y.Tag, 'plain');
    });
});

// ── DisplayMemberPath ───────────────────────────────────────────────

describe('DisplayMemberPath', () => {
    test('auto-template renders String(item[path]) in a TextBlock', async () => {
        const { TextBlock } = await import('../../basic/text-block.js');
        const ic = new ItemsControl();
        ic.ItemsPanel = () => new StackPanel();
        ic.DisplayMemberPath = 'name';
        ic.Items = [
            { name: 'Alice', age: 30 },
            { name: 'Bob',   age: 22 },
        ];
        const c0 = ic.Generator.ContainerFromIndex(0)!;
        // Container is a ContentPresenter; its inner Visual is the
        // auto-template's TextBlock.
        const inner = c0.visualChildren[0] as InstanceType<typeof TextBlock>;
        assert.ok(inner instanceof TextBlock);
        assert.equal(inner.Text, 'Alice');
    });

    test('explicit ItemTemplate wins over DisplayMemberPath', () => {
        const ic = new ItemsControl();
        ic.ItemsPanel        = () => new StackPanel();
        ic.DisplayMemberPath = 'name';
        ic.ItemTemplate      = new DataTemplate(d => new Leaf(`tpl:${String((d as { name: string }).name)}`));
        ic.Items             = [{ name: 'Alice' }];
        const c0 = ic.Generator.ContainerFromIndex(0)!;
        const inner = c0.visualChildren[0] as Leaf;
        assert.ok(inner instanceof Leaf);
        assert.equal(inner.source, 'tpl:Alice');
    });
});

// ── RebindContainerForItemOverride (recycling) ──────────────────────

describe('RebindContainerForItemOverride', () => {
    test('default ContentPresenter container flips Content on rebind', () => {
        const ic = new ItemsControl();
        ic.ItemsPanel   = () => new StackPanel();
        ic.ItemTemplate = new DataTemplate(d => new Leaf(d));
        ic.Items        = ['a'];

        const cp = ic.Generator.ContainerFromIndex(0)!;
        assert.ok(cp instanceof ContentPresenter);
        assert.equal((cp as ContentPresenter).Content, 'a');

        // Simulate a recycle-then-reuse sequence: ItemsControl
        // routes recycled containers through RebindContainerForItemOverride
        // when GenerateNext claims from the pool.
        ic.RebindContainerForItemOverride(cp, 'rebinding-here');
        assert.equal((cp as ContentPresenter).Content, 'rebinding-here');
    });
});
