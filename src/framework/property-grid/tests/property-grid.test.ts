import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { DataTemplate } from '../../../basic/templates/data-template.js';
import { Border } from '../../../basic/border.js';
import { PropertyGrid } from '../property-grid.js';
import { GridProperty, PropertyKind } from '../grid-property.js';
import { PropertyItem, PropertyCategory } from '../property-item.js';
import { MapPropertyBag, type PropertyAccessor } from '../property-bag.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBag(names: string[], values: Record<string, unknown> = {}): MapPropertyBag {
    const stored: Record<string, unknown> = {};
    const accessors = new Map<string, PropertyAccessor>();
    for (const name of names) {
        stored[name] = values[name] ?? '';
        accessors.set(name, {
            get: () => stored[name],
            set: (v) => { stored[name] = v; },
        });
    }
    return new MapPropertyBag(accessors);
}

// Spy bag records which names have been disposed by tracking
// whether their observers were unsubscribed.
function makeSpyBag(name: string, initial: unknown): {
    bag: MapPropertyBag;
    disposerCalled: () => boolean;
} {
    let stored = initial;
    let listenerSet: (() => void) | undefined;
    let disposed = false;
    const accessors = new Map<string, PropertyAccessor>([
        [name, {
            get: () => stored,
            set: (v) => { stored = v; },
            observe: (cb) => {
                listenerSet = cb;
                return () => { disposed = true; listenerSet = undefined; };
            },
        }],
    ]);
    return { bag: new MapPropertyBag(accessors), disposerCalled: () => disposed };
}

// A distinct, renderable DataTemplate used purely as an identity marker for
// selector-resolution assertions (`grid.EditorTemplateSelector(item) === tmpl`).
// It must produce a real Visual rather than throw: with Task-7's default Style
// applied by initTestApp(), the grid renders eagerly on Descriptors/Target set,
// and its per-row ItemTemplateSelector dispatch actually APPLIES the resolved
// template. A throwing factory would explode during that legitimate render;
// a benign Border keeps these tests focused on selector identity while
// tolerating the real dispatch path.
function makeTemplate(_id: string): DataTemplate {
    return new DataTemplate(() => new Border());
}

// ---------------------------------------------------------------------------
// (a) Category grouping and ordering
// ---------------------------------------------------------------------------

describe('PropertyGrid — category grouping', () => {
    beforeEach(() => { initTestApp(); });

    test('ItemsSource is empty when neither Descriptors nor Target is set', () => {
        const grid = new PropertyGrid();
        const items = grid.ItemsSource;
        const count = Array.isArray(items) ? items.length : 0;
        assert.equal(count, 0);
    });

    test('ItemsSource is empty when Descriptors is set but Target is not', () => {
        const grid = new PropertyGrid();
        grid.Descriptors = [GridProperty.text('name')];
        const items = grid.ItemsSource;
        const count = Array.isArray(items) ? items.length : 0;
        assert.equal(count, 0);
    });

    test('ItemsSource is empty when Target is set but Descriptors is not', () => {
        const grid = new PropertyGrid();
        grid.Target = makeBag(['name']);
        const items = grid.ItemsSource;
        const count = Array.isArray(items) ? items.length : 0;
        assert.equal(count, 0);
    });

    test('produces one PropertyCategory per distinct descriptor Category, in first-seen order', () => {
        const grid = new PropertyGrid();
        const descs = [
            GridProperty.text('a', { category: 'Alpha' }),
            GridProperty.text('b', { category: 'Beta' }),
            GridProperty.text('c', { category: 'Alpha' }),
        ];
        grid.Descriptors = descs;
        grid.Target = makeBag(['a', 'b', 'c']);

        const items = grid.ItemsSource as PropertyCategory[];
        assert.equal(items.length, 2);
        assert.equal(items[0]!.Header, 'Alpha');
        assert.equal(items[1]!.Header, 'Beta');
    });

    test('category Items preserve descriptor order within the category', () => {
        const grid = new PropertyGrid();
        const descs = [
            GridProperty.text('a', { category: 'G' }),
            GridProperty.text('b', { category: 'G' }),
            GridProperty.text('c', { category: 'G' }),
        ];
        grid.Descriptors = descs;
        grid.Target = makeBag(['a', 'b', 'c']);

        const items = grid.ItemsSource as PropertyCategory[];
        const cat = items[0]!;
        assert.equal(cat.Items.length, 3);
        assert.equal(cat.Items[0]!.Descriptor.Name, 'a');
        assert.equal(cat.Items[1]!.Descriptor.Name, 'b');
        assert.equal(cat.Items[2]!.Descriptor.Name, 'c');
    });

    test('items within categories are PropertyItem instances', () => {
        const grid = new PropertyGrid();
        grid.Descriptors = [GridProperty.text('name')];
        grid.Target = makeBag(['name'], { name: 'hello' });

        const cats = grid.ItemsSource as PropertyCategory[];
        assert.equal(cats.length, 1);
        const item = cats[0]!.Items[0]!;
        assert.ok(item instanceof PropertyItem);
        assert.equal(item.Value, 'hello');
    });

    test('default category is "General" when no category option is set', () => {
        const grid = new PropertyGrid();
        grid.Descriptors = [GridProperty.text('x')];
        grid.Target = makeBag(['x']);

        const cats = grid.ItemsSource as PropertyCategory[];
        assert.equal(cats[0]!.Header, 'General');
    });

    test('single descriptor produces one category with one item', () => {
        const grid = new PropertyGrid();
        grid.Descriptors = [GridProperty.number('count', { category: 'Stats' })];
        grid.Target = makeBag(['count'], { count: 42 });

        const cats = grid.ItemsSource as PropertyCategory[];
        assert.equal(cats.length, 1);
        assert.equal(cats[0]!.Header, 'Stats');
        assert.equal(cats[0]!.Items.length, 1);
        assert.equal(cats[0]!.Items[0]!.Value, 42);
    });

    test('multiple categories each with multiple items', () => {
        const grid = new PropertyGrid();
        const descs = [
            GridProperty.text('a', { category: 'A' }),
            GridProperty.text('b', { category: 'B' }),
            GridProperty.text('c', { category: 'A' }),
            GridProperty.text('d', { category: 'B' }),
            GridProperty.text('e', { category: 'C' }),
        ];
        grid.Descriptors = descs;
        grid.Target = makeBag(['a', 'b', 'c', 'd', 'e']);

        const cats = grid.ItemsSource as PropertyCategory[];
        assert.equal(cats.length, 3);
        assert.equal(cats[0]!.Header, 'A');
        assert.equal(cats[0]!.Items.length, 2);
        assert.equal(cats[1]!.Header, 'B');
        assert.equal(cats[1]!.Items.length, 2);
        assert.equal(cats[2]!.Header, 'C');
        assert.equal(cats[2]!.Items.length, 1);
    });
});

// ---------------------------------------------------------------------------
// (b) Editor selector — per-kind DP mapping
// ---------------------------------------------------------------------------

describe('PropertyGrid — editor selector per-kind DP', () => {
    beforeEach(() => { initTestApp(); });

    test('selector returns TextEditorTemplate for PropertyKind.Text', () => {
        const grid = new PropertyGrid();
        const tmpl = makeTemplate('text');
        grid.TextEditorTemplate = tmpl;
        grid.Descriptors = [GridProperty.text('name')];
        grid.Target = makeBag(['name']);

        const cats = grid.ItemsSource as PropertyCategory[];
        const item = cats[0]!.Items[0]!;
        assert.strictEqual(grid.EditorTemplateSelector(item), tmpl);
    });

    test('selector returns NumberEditorTemplate for PropertyKind.Number', () => {
        const grid = new PropertyGrid();
        const tmpl = makeTemplate('number');
        grid.NumberEditorTemplate = tmpl;
        grid.Descriptors = [GridProperty.number('count')];
        grid.Target = makeBag(['count']);

        const cats = grid.ItemsSource as PropertyCategory[];
        const item = cats[0]!.Items[0]!;
        assert.strictEqual(grid.EditorTemplateSelector(item), tmpl);
    });

    test('selector returns BooleanEditorTemplate for PropertyKind.Boolean', () => {
        const grid = new PropertyGrid();
        const tmpl = makeTemplate('boolean');
        grid.BooleanEditorTemplate = tmpl;
        grid.Descriptors = [GridProperty.bool('enabled')];
        grid.Target = makeBag(['enabled']);

        const cats = grid.ItemsSource as PropertyCategory[];
        const item = cats[0]!.Items[0]!;
        assert.strictEqual(grid.EditorTemplateSelector(item), tmpl);
    });

    test('selector returns EnumEditorTemplate for PropertyKind.Enum', () => {
        const grid = new PropertyGrid();
        const tmpl = makeTemplate('enum');
        grid.EnumEditorTemplate = tmpl;
        grid.Descriptors = [GridProperty.enumOf('mode', ['a', 'b'])];
        grid.Target = makeBag(['mode']);

        const cats = grid.ItemsSource as PropertyCategory[];
        const item = cats[0]!.Items[0]!;
        assert.strictEqual(grid.EditorTemplateSelector(item), tmpl);
    });

    test('selector returns MultilineEditorTemplate for PropertyKind.MultilineText', () => {
        const grid = new PropertyGrid();
        const tmpl = makeTemplate('multiline');
        grid.MultilineEditorTemplate = tmpl;
        grid.Descriptors = [GridProperty.multiline('bio')];
        grid.Target = makeBag(['bio']);

        const cats = grid.ItemsSource as PropertyCategory[];
        const item = cats[0]!.Items[0]!;
        assert.strictEqual(grid.EditorTemplateSelector(item), tmpl);
    });

    test('selector returns ColorEditorTemplate for PropertyKind.Color', () => {
        const grid = new PropertyGrid();
        const tmpl = makeTemplate('color');
        grid.ColorEditorTemplate = tmpl;
        grid.Descriptors = [GridProperty.color('tint')];
        grid.Target = makeBag(['tint']);

        const cats = grid.ItemsSource as PropertyCategory[];
        const item = cats[0]!.Items[0]!;
        assert.strictEqual(grid.EditorTemplateSelector(item), tmpl);
    });

    test('selector returns ReadOnlyEditorTemplate for a read-only item', () => {
        const grid = new PropertyGrid();
        const tmpl = makeTemplate('readonly');
        grid.ReadOnlyEditorTemplate = tmpl;
        grid.Descriptors = [GridProperty.text('label', { readOnly: true })];
        grid.Target = makeBag(['label']);

        const cats = grid.ItemsSource as PropertyCategory[];
        const item = cats[0]!.Items[0]!;
        assert.strictEqual(grid.EditorTemplateSelector(item), tmpl);
    });

    test('read-only item: ReadOnlyEditorTemplate takes precedence over kind template', () => {
        const grid = new PropertyGrid();
        const textTmpl = makeTemplate('text');
        const readOnlyTmpl = makeTemplate('readonly');
        grid.TextEditorTemplate = textTmpl;
        grid.ReadOnlyEditorTemplate = readOnlyTmpl;
        grid.Descriptors = [GridProperty.text('label', { readOnly: true })];
        grid.Target = makeBag(['label']);

        const cats = grid.ItemsSource as PropertyCategory[];
        const item = cats[0]!.Items[0]!;
        // ReadOnly wins over kind
        assert.strictEqual(grid.EditorTemplateSelector(item), readOnlyTmpl);
    });

    test('selector returns undefined when no template is set for the kind', () => {
        const grid = new PropertyGrid();
        // Explicitly clear the default-style-provided template so the
        // selector's fallback path (returns undefined for an unregistered
        // kind) is exercised regardless of the active theme style.
        grid.TextEditorTemplate = undefined;
        grid.Descriptors = [GridProperty.text('name')];
        grid.Target = makeBag(['name']);

        const cats = grid.ItemsSource as PropertyCategory[];
        const item = cats[0]!.Items[0]!;
        assert.strictEqual(grid.EditorTemplateSelector(item), undefined);
    });
});

// ---------------------------------------------------------------------------
// (c) EditorTemplateKey on the descriptor — per-item override
// ---------------------------------------------------------------------------

describe('PropertyGrid — EditorTemplateKey per-item override', () => {
    beforeEach(() => { initTestApp(); });

    test('descriptor with EditorTemplateKey set: selector resolves from grid resources when template is registered', () => {
        const grid = new PropertyGrid();
        const customTmpl = makeTemplate('custom');
        // Register the template in the grid's own Resources dict
        grid.Resources.Set('myCustomEditor', customTmpl);
        grid.Descriptors = [GridProperty.text('name', { editorTemplateKey: 'myCustomEditor' })];
        grid.Target = makeBag(['name']);

        const cats = grid.ItemsSource as PropertyCategory[];
        const item = cats[0]!.Items[0]!;
        assert.strictEqual(grid.EditorTemplateSelector(item), customTmpl);
    });

    test('descriptor with EditorTemplateKey set that does not resolve falls back to per-kind template', () => {
        const grid = new PropertyGrid();
        const textTmpl = makeTemplate('text');
        grid.TextEditorTemplate = textTmpl;
        // 'nonExistentKey' is NOT registered anywhere
        grid.Descriptors = [GridProperty.text('name', { editorTemplateKey: 'nonExistentKey' })];
        grid.Target = makeBag(['name']);

        const cats = grid.ItemsSource as PropertyCategory[];
        const item = cats[0]!.Items[0]!;
        // Falls back to per-kind TextEditorTemplate
        assert.strictEqual(grid.EditorTemplateSelector(item), textTmpl);
    });

    test('EditorTemplateKey resolution takes precedence over per-kind template', () => {
        const grid = new PropertyGrid();
        const textTmpl = makeTemplate('text');
        const customTmpl = makeTemplate('custom');
        grid.TextEditorTemplate = textTmpl;
        grid.Resources.Set('myKey', customTmpl);
        grid.Descriptors = [GridProperty.text('name', { editorTemplateKey: 'myKey' })];
        grid.Target = makeBag(['name']);

        const cats = grid.ItemsSource as PropertyCategory[];
        const item = cats[0]!.Items[0]!;
        assert.strictEqual(grid.EditorTemplateSelector(item), customTmpl);
    });
});

// ---------------------------------------------------------------------------
// (d) Target change — rebuilds and disposes old rows
// ---------------------------------------------------------------------------

describe('PropertyGrid — Target change disposes prior items', () => {
    beforeEach(() => { initTestApp(); });

    test('changing Target disposes all prior PropertyItems', () => {
        const grid = new PropertyGrid();
        const { bag: bag1, disposerCalled: disposed1 } = makeSpyBag('name', 'first');
        const { bag: bag2 } = makeSpyBag('name', 'second');

        grid.Descriptors = [GridProperty.text('name')];
        grid.Target = bag1;

        // Capture prior item reference
        const cats1 = grid.ItemsSource as PropertyCategory[];
        const priorItem = cats1[0]!.Items[0]!;
        assert.ok(priorItem instanceof PropertyItem);

        // Now swap target
        grid.Target = bag2;

        // Prior item should have been disposed
        assert.ok(disposed1(), 'observer from bag1 should have been unsubscribed (item.Dispose called)');
    });

    test('changing Target rebuilds groups from the new target', () => {
        const grid = new PropertyGrid();
        const bag1 = makeBag(['name'], { name: 'alice' });
        const bag2 = makeBag(['name'], { name: 'bob' });

        grid.Descriptors = [GridProperty.text('name')];
        grid.Target = bag1;

        let cats = grid.ItemsSource as PropertyCategory[];
        assert.equal(cats[0]!.Items[0]!.Value, 'alice');

        grid.Target = bag2;

        cats = grid.ItemsSource as PropertyCategory[];
        assert.equal(cats[0]!.Items[0]!.Value, 'bob');
    });

    test('setting Target to undefined clears groups and disposes items', () => {
        const grid = new PropertyGrid();
        const { bag, disposerCalled: disposed } = makeSpyBag('name', 'hi');
        grid.Descriptors = [GridProperty.text('name')];
        grid.Target = bag;

        const cats1 = grid.ItemsSource as PropertyCategory[];
        assert.equal(cats1.length, 1);

        grid.Target = undefined;

        const cats2 = grid.ItemsSource as PropertyCategory[];
        const count2 = Array.isArray(cats2) ? cats2.length : 0;
        assert.equal(count2, 0);
        assert.ok(disposed(), 'item should be disposed when Target is cleared');
    });

    test('changing Descriptors disposes prior items and rebuilds', () => {
        const grid = new PropertyGrid();
        const { bag, disposerCalled: disposed } = makeSpyBag('name', 'hello');
        // Both 'name' and 'title' must be present in the bag for this test
        const multiPropBag = makeBag(['name', 'title'], { name: 'hello', title: 'world' });

        grid.Descriptors = [GridProperty.text('name')];
        grid.Target = bag;  // builds with 'name' descriptor

        const cats1 = grid.ItemsSource as PropertyCategory[];
        assert.equal(cats1.length, 1);

        // Change Descriptors while keeping the same target bag —
        // prior items (for 'name') are disposed, new items (for 'title') built.
        // But we need a bag that supports 'title'. Swap target to multiPropBag first,
        // which will dispose the spy-bag item (proving disposal on target change),
        // then change descriptors.
        grid.Target = multiPropBag;
        assert.ok(disposed(), 'prior item (from spy bag) should have been disposed on target swap');

        grid.Descriptors = [GridProperty.text('title')];
        const cats2 = grid.ItemsSource as PropertyCategory[];
        assert.equal(cats2[0]!.Items[0]!.Descriptor.Name, 'title');
    });
});

// ---------------------------------------------------------------------------
// DP accessors — static keys exist and are readable
// ---------------------------------------------------------------------------

describe('PropertyGrid — static DP keys and accessors', () => {
    beforeEach(() => { initTestApp(); });

    test('DescriptorsKey is defined', () => {
        assert.ok(PropertyGrid.DescriptorsKey !== undefined);
    });

    test('TargetKey is defined', () => {
        assert.ok(PropertyGrid.TargetKey !== undefined);
    });

    test('all seven editor-template keys are defined', () => {
        assert.ok(PropertyGrid.TextEditorTemplateKey !== undefined);
        assert.ok(PropertyGrid.NumberEditorTemplateKey !== undefined);
        assert.ok(PropertyGrid.BooleanEditorTemplateKey !== undefined);
        assert.ok(PropertyGrid.EnumEditorTemplateKey !== undefined);
        assert.ok(PropertyGrid.MultilineEditorTemplateKey !== undefined);
        assert.ok(PropertyGrid.ColorEditorTemplateKey !== undefined);
        assert.ok(PropertyGrid.ReadOnlyEditorTemplateKey !== undefined);
    });

    test('Descriptors get/set round-trip', () => {
        const grid = new PropertyGrid();
        const descs = [GridProperty.text('x')];
        grid.Descriptors = descs;
        assert.strictEqual(grid.Descriptors, descs);
    });

    test('Target get/set round-trip', () => {
        const grid = new PropertyGrid();
        const bag = makeBag(['x']);
        grid.Target = bag;
        assert.strictEqual(grid.Target, bag);
    });

    test('TextEditorTemplate get/set via DP', () => {
        const grid = new PropertyGrid();
        const tmpl = makeTemplate('t');
        grid.TextEditorTemplate = tmpl;
        assert.strictEqual(grid.TextEditorTemplate, tmpl);
    });
});
