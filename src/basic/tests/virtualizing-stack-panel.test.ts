import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    ObservableCollection,
    Panel,
    Rect,
    Size,
    Element,
    Visual,
    type DrawingContext,
} from '../../runtime/index.js';
import { DataTemplate, Orientation, VirtualizingStackPanel } from '../index.js';
import { ItemsControl } from '@pragmatic-tech-ai/mural/framework';

class Leaf extends Element
{
    constructor(public readonly source: unknown) { super(); }
    // Match the panel's ItemHeight (20) so the new variable-size
    // cache lands on 20 per item — tests authored for the original
    // uniform-height behavior continue to assert the same offsets.
    protected override MeasureOverride(_a: Size): Size { return new Size(10, 20); }
    protected override RenderOverride(_dc: DrawingContext): void { }
}

function makeVirtualizingIC(
    items: readonly unknown[] | ObservableCollection<any>,
    panelOpts?: { viewport?: Rect, itemHeight?: number },
): { ic: ItemsControl, panel: VirtualizingStackPanel }
{
    const panel = new VirtualizingStackPanel();
    if (panelOpts?.viewport   !== undefined) panel.Viewport   = panelOpts.viewport;
    if (panelOpts?.itemHeight !== undefined) panel.ItemHeight = panelOpts.itemHeight;
    const ic = new ItemsControl();
    ic.ItemsPanel   = () => panel;
    ic.ItemTemplate = new DataTemplate(data => new Leaf(data));
    ic.Items        = items;
    return { ic, panel };
}

describe('VirtualizingStackPanel — realization based on Viewport', () => {
    test('realizes only items whose vertical band intersects the Viewport', () => {
        // 20 items, ItemHeight = 20 → extent 0..400. Viewport (0, 30, 100, 60)
        // covers y = 30..90, which is items 1, 2, 3, 4 (bands 20..40, 40..60, 60..80, 80..100).
        const items = Array.from({ length: 20 }, (_, i) => `item-${i}`);
        const { ic, panel } = makeVirtualizingIC(items, {
            viewport: new Rect(0, 30, 100, 60),
            itemHeight: 20,
        });
        ic.Measure(new Size(100, 400));
        assert.deepEqual(panel.RealizedIndices, [1, 2, 3, 4]);
        // The realized containers are logical children of the
        // ItemsControl (not the panel).
        assert.equal(ic.logicalChildren.length, 4);
    });

    test('changing Viewport recycles out-of-range items and realizes new ones', () => {
        const items = Array.from({ length: 20 }, (_, i) => `item-${i}`);
        const { ic, panel } = makeVirtualizingIC(items, {
            viewport: new Rect(0, 0, 100, 40),  // items 0, 1
            itemHeight: 20,
        });
        ic.Measure(new Size(100, 400));
        assert.deepEqual(panel.RealizedIndices, [0, 1]);
        const container0_first = ic.Generator.ContainerFromItem('item-0');

        // Move the viewport to a non-overlapping range. The old
        // containers get recycled; new ones come in.
        panel.Viewport = new Rect(0, 100, 100, 40);  // items 5, 6
        ic.Measure(new Size(100, 400));
        assert.deepEqual(panel.RealizedIndices, [5, 6]);
        assert.equal(ic.Generator.IsRealized('item-0'), false);
        assert.equal(ic.Generator.IsRealized('item-5'), true);
        // Generator returns a fresh container if we re-realize item-0,
        // confirming the old one was recycled (not just hidden).
        const container0_second = ic.Generator.Realize('item-0');
        assert.notEqual(container0_first, container0_second);
        // Cleanup the test-only realization so subsequent assertions
        // aren't surprised.
        ic.Generator.Recycle(container0_second);
    });

    test('partial-overlap viewport realizes existing containers without churn', () => {
        // Viewport moves so it still overlaps 2 items but adds a new one.
        // Items 0..3 are realized; new viewport overlaps 1..4. Items 1,2,3
        // stay (same container instances), item 0 recycled, item 4 added.
        const items = Array.from({ length: 10 }, (_, i) => `item-${i}`);
        const { ic, panel } = makeVirtualizingIC(items, {
            viewport: new Rect(0, 0, 100, 80),  // items 0, 1, 2, 3
            itemHeight: 20,
        });
        ic.Measure(new Size(100, 200));
        const c1 = ic.Generator.ContainerFromItem('item-1');
        const c2 = ic.Generator.ContainerFromItem('item-2');
        const c3 = ic.Generator.ContainerFromItem('item-3');

        panel.Viewport = new Rect(0, 20, 100, 80);  // items 1, 2, 3, 4
        ic.Measure(new Size(100, 200));
        assert.deepEqual(panel.RealizedIndices, [1, 2, 3, 4]);
        assert.equal(ic.Generator.ContainerFromItem('item-1'), c1);
        assert.equal(ic.Generator.ContainerFromItem('item-2'), c2);
        assert.equal(ic.Generator.ContainerFromItem('item-3'), c3);
        assert.equal(ic.Generator.IsRealized('item-0'), false);
        assert.equal(ic.Generator.IsRealized('item-4'), true);
    });

    test('Arrange positions each realized container at index * ItemHeight', () => {
        const items = ['a', 'b', 'c', 'd'];
        const { ic, panel } = makeVirtualizingIC(items, {
            viewport: new Rect(0, 0, 100, 80),
            itemHeight: 20,
        });
        ic.Measure(new Size(100, 80));
        ic.Arrange(new Rect(0, 0, 100, 80));
        for (const i of panel.RealizedIndices)
        {
            const c = ic.Generator.ContainerFromItem(items[i])!;
            assert.equal(c.ArrangedRect.Y, i * 20);
        }
    });

    test('Panel extent (DesiredSize.Height) reflects ALL items, not just realized ones', () => {
        // The panel must report its full extent so a host scrollviewer
        // (when it lands) knows how much to scroll over.
        const items = Array.from({ length: 100 }, (_, i) => i);
        const { ic, panel } = makeVirtualizingIC(items, {
            viewport: new Rect(0, 0, 100, 40),  // realize 2 items
            itemHeight: 20,
        });
        ic.Measure(new Size(100, 2000));
        assert.equal(panel.DesiredSize.Height, 100 * 20);
        assert.equal(panel.RealizedIndices.length, 2);
    });

    test('ObservableCollection mutation invalidates the panel and re-realizes', () => {
        const items = new ObservableCollection<string>(['a', 'b', 'c', 'd']);
        const { ic, panel } = makeVirtualizingIC(items, {
            viewport: new Rect(0, 0, 100, 40),  // items 0, 1
            itemHeight: 20,
        });
        ic.Measure(new Size(100, 80));
        assert.deepEqual(panel.RealizedIndices, [0, 1]);

        // Insert at the front — the items shift; the viewport now shows
        // the new items. After re-measure, indices 0 and 1 are realized
        // again (they represent the new front items now).
        items.Insert(0, 'X');
        ic.Measure(new Size(100, 100));
        assert.deepEqual(panel.RealizedIndices, [0, 1]);
        // The realized containers correspond to the new front items.
        // Containers are per-item ContentPresenters wrapping the
        // template's Leaf output — assert on the inner Visual.
        const c0 = ic.Generator.ContainerFromItem('X');
        const c1 = ic.Generator.ContainerFromItem('a');
        assert.ok(c0?.visualChildren[0] instanceof Leaf);
        assert.ok(c1?.visualChildren[0] instanceof Leaf);
    });

    test('removing all items via Clear recycles everything', () => {
        const items = new ObservableCollection<string>(['a', 'b', 'c']);
        const { ic, panel } = makeVirtualizingIC(items, {
            viewport: new Rect(0, 0, 100, 60),
            itemHeight: 20,
        });
        ic.Measure(new Size(100, 60));
        assert.equal(panel.RealizedIndices.length, 3);
        items.Clear();
        ic.Measure(new Size(100, 60));
        assert.equal(panel.RealizedIndices.length, 0);
        assert.equal(ic.Generator.Count, 0);
    });

    test('swapping ItemsPanel from virtualizing to plain panel tears down realized containers cleanly', () => {
        const items = ['a', 'b', 'c'];
        const { ic, panel } = makeVirtualizingIC(items, {
            viewport: new Rect(0, 0, 100, 40),  // 2 realized
            itemHeight: 20,
        });
        ic.Measure(new Size(100, 60));
        assert.equal(panel.RealizedIndices.length, 2);
        assert.equal(ic.logicalChildren.length, 2);

        // Switch to a non-virtualizing panel — virtualizing one tears
        // down its realizations; ItemsControl builds all containers
        // for the new panel.
        class TestPanel extends Panel { }
        ic.ItemsPanel = () => new TestPanel();
        assert.equal(ic.logicalChildren.length, 3);  // all items now
    });
});

describe('VirtualizingStackPanel — variable item heights', () => {
    // Custom container whose measured height varies by source index.
    class VarLeaf extends Element
    {
        constructor(public readonly source: unknown) { super(); }
        protected override MeasureOverride(_a: Size): Size
        {
            // Map 'item-N' → height 10 + N*5: item-0=10, item-1=15, item-2=20, ...
            const m = /item-(\d+)/.exec(String(this.source));
            const n = m ? Number(m[1]) : 0;
            return new Size(10, 10 + n * 5);
        }
        protected override RenderOverride(_dc: DrawingContext): void { }
    }

    test('measured size populates the cache; the panel converges the realized range in one pass', () => {
        const items = Array.from({ length: 6 }, (_, i) => `item-${i}`);
        const panel = new VirtualizingStackPanel();
        panel.ItemHeight = 20;             // default estimate for un-measured items
        panel.Viewport   = new Rect(0, 0, 100, 35);
        const ic = new ItemsControl();
        ic.ItemsPanel   = () => panel;
        ic.ItemTemplate = new DataTemplate(d => new VarLeaf(d));
        ic.Items        = items;

        // First measure: the empty cache estimates 20/each, so the [0..35] viewport
        // hit-tests items 0, 1. But measuring them shrinks the cache (item-0=10,
        // item-1=15), which pulls item-2 [25..45) into the viewport — MeasureOverride
        // re-runs the hit-test against the updated cache and realizes it in the SAME
        // pass rather than deferring to a later re-measure.
        ic.Measure(new Size(100, 200));
        assert.deepEqual(panel.RealizedIndices, [0, 1, 2]);

        // A forced re-measure is stable: the cache already holds the measured sizes.
        panel.InvalidateMeasure();
        ic.Measure(new Size(100, 200));
        assert.deepEqual(panel.RealizedIndices, [0, 1, 2]);
    });

    test('Arrange positions each realized container at its cumulative offset', () => {
        const items = Array.from({ length: 4 }, (_, i) => `item-${i}`);
        const panel = new VirtualizingStackPanel();
        panel.ItemHeight = 30;
        panel.Viewport   = new Rect(0, 0, 100, 200);  // big viewport — all realize
        const ic = new ItemsControl();
        ic.ItemsPanel   = () => panel;
        ic.ItemTemplate = new DataTemplate(d => new VarLeaf(d));
        ic.Items        = items;

        ic.Measure(new Size(100, 200));
        ic.Arrange(new Rect(0, 0, 100, 200));

        // Sizes: item-0=10, item-1=15, item-2=20, item-3=25.
        // Offsets: 0, 10, 25, 45.
        const c0 = ic.Generator.ContainerFromItem('item-0')!;
        const c1 = ic.Generator.ContainerFromItem('item-1')!;
        const c2 = ic.Generator.ContainerFromItem('item-2')!;
        const c3 = ic.Generator.ContainerFromItem('item-3')!;
        assert.equal(c0.ArrangedRect.Y, 0);
        assert.equal(c1.ArrangedRect.Y, 10);
        assert.equal(c2.ArrangedRect.Y, 25);
        assert.equal(c3.ArrangedRect.Y, 45);
    });

    test('Horizontal orientation arranges items along X', () => {
        const items = ['a', 'b', 'c'];
        const panel = new VirtualizingStackPanel();
        panel.Orientation = Orientation.Horizontal;
        panel.ItemWidth   = 30;
        panel.Viewport    = new Rect(0, 0, 200, 40);
        const ic = new ItemsControl();
        ic.ItemsPanel   = () => panel;
        ic.ItemTemplate = new DataTemplate(d => {
            const v = new Leaf(d);
            // Uniform width = 30, height = 10.
            (v as unknown as { _w: number; _h: number })._w = 30;
            (v as unknown as { _w: number; _h: number })._h = 10;
            return v;
        });
        ic.Items = items;

        ic.Measure(new Size(200, 40));
        ic.Arrange(new Rect(0, 0, 200, 40));

        const ca = ic.Generator.ContainerFromItem('a')!;
        const cb = ic.Generator.ContainerFromItem('b')!;
        const cc = ic.Generator.ContainerFromItem('c')!;
        // Width = ItemWidth = 30 (Leaf measures to 10 wide; sizeCache uses that)
        // — so offsets are 0, 10, 20.
        assert.equal(ca.ArrangedRect.X, 0);
        assert.equal(cb.ArrangedRect.X, 10);
        assert.equal(cc.ArrangedRect.X, 20);
    });
});

// § 10.4 — Incremental items-change handling.
describe('VirtualizingStackPanel — § 10.4 incremental items-change', () => {

    test('insert in-range shifts surviving realized indices forward', () => {
        const items = new ObservableCollection<string>(['a', 'b', 'c', 'd']);
        const { ic, panel } = makeVirtualizingIC(items, {
            viewport: new Rect(0, 0, 100, 80),  // covers indices 0..3 at itemHeight=20
            itemHeight: 20,
        });
        ic.Measure(new Size(100, 80));
        assert.deepEqual(panel.RealizedIndices, [0, 1, 2, 3]);
        const containerB = ic.Generator.ContainerFromItem('b')!;

        // Insert at index 1 → 'b' becomes index 2, 'c' becomes 3, 'd' becomes 4.
        items.Insert(1, 'NEW');
        ic.Measure(new Size(100, 80));

        // The container that was bound to 'b' should STILL be the same
        // instance, just under a new index. This is the headline win
        // of incremental handling vs full recycle.
        const newBContainer = ic.Generator.ContainerFromItem('b');
        assert.equal(newBContainer, containerB,
            'container identity for surviving "b" should be preserved across insert');
    });

    test('remove in-range recycles only the removed containers; survivors shift down', () => {
        const items = new ObservableCollection<string>(['a', 'b', 'c', 'd', 'e']);
        const { ic, panel } = makeVirtualizingIC(items, {
            viewport: new Rect(0, 0, 100, 100),
            itemHeight: 20,
        });
        ic.Measure(new Size(100, 100));
        assert.deepEqual(panel.RealizedIndices, [0, 1, 2, 3, 4]);
        const containerA = ic.Generator.ContainerFromItem('a')!;
        const containerC = ic.Generator.ContainerFromItem('c')!;
        const containerE = ic.Generator.ContainerFromItem('e')!;

        // Remove index 1 ('b') → 'a' stays at 0, 'c' shifts to 1, etc.
        items.RemoveAt(1);
        ic.Measure(new Size(100, 100));

        assert.equal(ic.Generator.ContainerFromItem('a'), containerA,
            '"a" container survives a remove of its sibling');
        assert.equal(ic.Generator.ContainerFromItem('c'), containerC,
            '"c" container survives + shifts down');
        assert.equal(ic.Generator.ContainerFromItem('e'), containerE,
            '"e" container survives + shifts down');
        assert.equal(ic.Generator.IsRealized('b'), false,
            'removed item "b" is fully recycled');
    });

    test('replace at index recycles the old container; new item realizes on next measure', () => {
        const items = new ObservableCollection<string>(['a', 'b', 'c']);
        const { ic, panel } = makeVirtualizingIC(items, {
            viewport: new Rect(0, 0, 100, 80),
            itemHeight: 20,
        });
        ic.Measure(new Size(100, 80));
        const originalContainer = ic.Generator.ContainerFromItem('b')!;

        items.SetAt(1, 'B-NEW');
        ic.Measure(new Size(100, 80));

        // Old item 'b' is no longer realized — its container went back
        // to the recycle pool. The new item 'B-NEW' picked up a
        // container at index 1 (likely the recycled instance).
        assert.equal(ic.Generator.IsRealized('b'), false,
            'replaced data item should no longer be realized');
        assert.equal(ic.Generator.IsRealized('B-NEW'), true,
            'replacement data item should be realized after re-measure');
        // Index 1 still has a container, but it's bound to B-NEW now.
        assert.ok(panel.RealizedIndices.includes(1),
            'index 1 stays realized across a replace');
        void originalContainer;
    });

    test('clear recycles every realized container', () => {
        const items = new ObservableCollection<string>(['a', 'b', 'c']);
        const { ic, panel } = makeVirtualizingIC(items, {
            viewport: new Rect(0, 0, 100, 80),
            itemHeight: 20,
        });
        ic.Measure(new Size(100, 80));
        assert.deepEqual(panel.RealizedIndices, [0, 1, 2]);

        items.Clear();
        ic.Measure(new Size(100, 80));

        assert.deepEqual(panel.RealizedIndices, []);
    });
});

// ── Nested (per-level) virtualization primitives ────────────────────────
// The building blocks TreeViewItem uses for hierarchical virtualization:
// OriginOffset shifts the shared viewport into a panel's local item space, and
// Collapsed short-circuits an unexpanded level to zero size / no realization.
describe('VirtualizingStackPanel — nested-level primitives', () => {
    test('OriginOffset shifts realization into local item space', () => {
        // 40 rows @ 20px. A nested panel whose item[0] sits at absolute 100,
        // sharing a viewport window of absolute 120..160, should realize the
        // LOCAL rows whose band meets 20..60 → rows 1, 2.
        const items = Array.from({ length: 40 }, (_, i) => `item-${i}`);
        const { ic, panel } = makeVirtualizingIC(items, { itemHeight: 20 });
        panel.SetNestedViewport(100, new Rect(0, 120, 100, 40));
        panel.Measure(new Size(100, 40));
        assert.deepEqual(panel.RealizedIndices, [1, 2]);
    });

    test('OriginOffset past the window realizes nothing local', () => {
        // Shared window 0..40 but this panel's origin is 200 → its rows are all
        // far below the window → nothing realizes.
        const items = Array.from({ length: 40 }, (_, i) => `item-${i}`);
        const { ic, panel } = makeVirtualizingIC(items, { itemHeight: 20 });
        panel.SetNestedViewport(200, new Rect(0, 0, 100, 40));
        panel.Measure(new Size(100, 40));
        assert.deepEqual(panel.RealizedIndices, []);
    });

    test('Collapsed realizes nothing and measures to zero; un-collapse restores', () => {
        const items = Array.from({ length: 40 }, (_, i) => `item-${i}`);
        const { ic, panel } = makeVirtualizingIC(items, {
            viewport: new Rect(0, 0, 100, 60), itemHeight: 20,
        });
        ic.Measure(new Size(100, 60));
        assert.deepEqual(panel.RealizedIndices, [0, 1, 2]);

        panel.SetCollapsed(true);
        const size = panel.Measure(new Size(100, 60)), zero = panel.DesiredSize;
        void size;
        assert.equal(zero.Height, 0, 'collapsed panel measures to zero height');
        assert.deepEqual(panel.RealizedIndices, [], 'collapsed panel realizes nothing');

        panel.SetCollapsed(false);
        panel.Measure(new Size(100, 60));
        assert.deepEqual(panel.RealizedIndices, [0, 1, 2], 'un-collapse re-realizes the viewport rows');
    });
});

describe('VirtualizingStackPanel — IScrollInfo Extent reflects measured (variable) sizes', () => {
    // An item whose container measures taller than the ItemHeight estimate —
    // e.g. an expanded TreeViewItem whose nested panel reports its full subtree
    // height. The scroll Extent must include that measured height, not
    // count × ItemHeight, or a host ScrollViewer sees no overflow and shows no
    // scrollbar (the meta-model tree bug).
    class VarLeaf extends Element
    {
        constructor(public readonly source: unknown) { super(); }
        protected override MeasureOverride(_a: Size): Size
        {
            return new Size(10, this.source === 'big' ? 500 : 20);
        }
        protected override RenderOverride(_dc: DrawingContext): void { }
    }

    test('ExtentHeight sums cached measured sizes, not itemCount × ItemHeight', () => {
        const panel = new VirtualizingStackPanel();
        // Viewport tall enough that all three rows realize (and thus measure).
        panel.Viewport = new Rect(0, 0, 100, 600);
        const ic = new ItemsControl();
        ic.ItemsPanel   = () => panel;
        ic.ItemTemplate = new DataTemplate((d) => new VarLeaf(d));
        ic.Items        = ['big', 'b', 'c'];

        ic.Measure(new Size(100, 600));

        // 500 (measured 'big') + 20 + 20 = 540 — NOT 3 × 20 = 60.
        assert.equal(panel.ExtentHeight, 540);
    });

    // A vertical panel whose rows are wider than the viewport must pan on the
    // CROSS axis when the viewport's X offset changes — in delegate mode the SCP
    // applies no translate, so the panel itself has to. Rows also arrange at
    // their full cross extent (measuredCross), not the viewport width, or there's
    // nothing to reveal.
    class WideLeaf extends Element
    {
        constructor(public readonly source: unknown) { super(); }
        protected override MeasureOverride(_a: Size): Size { return new Size(200, 20); }
        protected override RenderOverride(_dc: DrawingContext): void { }
    }

    test('horizontal (cross-axis) offset pans a vertical panel and rows keep full width', () => {
        const panel = new VirtualizingStackPanel();
        panel.Viewport = new Rect(0, 0, 100, 100);   // 100-wide viewport, rows are 200 wide
        const ic = new ItemsControl();
        ic.ItemsPanel   = () => panel;
        ic.ItemTemplate = new DataTemplate((d) => new WideLeaf(d));
        ic.Items        = ['a', 'b', 'c'];

        ic.Measure(new Size(100, 100));
        ic.Arrange(new Rect(0, 0, 100, 100));
        const c0 = ic.Generator.ContainerFromItem('a')!;
        // No horizontal scroll yet: row at x = 0, arranged at its 200 width.
        assert.equal(c0.ArrangedRect.X, 0);
        assert.equal(c0.ArrangedRect.Width, 200);

        // Scroll right by 60 → rows pan left by 60 so later content shows.
        panel.Viewport = new Rect(60, 0, 100, 100);
        ic.Measure(new Size(100, 100));
        ic.Arrange(new Rect(0, 0, 100, 100));
        assert.equal(ic.Generator.ContainerFromItem('a')!.ArrangedRect.X, -60);
    });
});
