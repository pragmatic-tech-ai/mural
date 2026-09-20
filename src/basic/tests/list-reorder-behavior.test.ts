import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    DataObject,
    DragDropEffects,
    DragEventArgs,
    DragSession,
    NoModifiers,
    ObservableCollection,
    Rect,
    Size,
    Element,
    Visual,
} from '../../runtime/index.js';
import { Canvas } from '../panels/canvas.js';
import { DataTemplate } from '../templates/data-template.js';
import { ItemsControl } from '../../framework/base/items-control.js';
import { ListReorderBehavior } from '../behaviors/list-reorder-behavior.js';
import { VirtualizingWrapPanel } from '../panels/virtualisation/virtualizing-wrap-panel.js';

// Stand-in row visual whose ArrangedRect we can stamp directly so the
// reorder math has predictable container midpoints to compare against.
class StubRow extends Element
{
    public stampRect(r: Rect): void { this['_arrangedRect'] = r; }
    protected override MeasureOverride(_a: Size): Size { return Size.Zero; }
}

function buildItemsControl(items: readonly unknown[]): { ic: ItemsControl; rows: StubRow[]; coll: ObservableCollection<unknown> }
{
    const ic   = new ItemsControl();
    const coll = new ObservableCollection<unknown>();
    for (const v of items) coll.Add(v);
    ic.Items = coll;
    // Bypass the full container-generation machinery — stamp explicit
    // logicalChildren by reusing the private `_containers` slot the
    // ItemsControl reads in its logicalChildren getter. Each container
    // is given a known ArrangedRect so the cursor-to-index math has a
    // deterministic input.
    const rows: StubRow[] = [];
    for (let i = 0; i < items.length; i++)
    {
        const r = new StubRow();
        r.stampRect(new Rect(0, i * 20, 100, 20));
        rows.push(r);
    }
    (ic as unknown as { _containers: Visual[] })._containers = rows;
    return { ic, rows, coll };
}

function dropArgs(hostY: number, fromIndex: number, format = '@pragmatic-tech-ai/mural/reorder/from-index'): DragEventArgs
{
    const data = new DataObject().Set(format, fromIndex);
    return new DragEventArgs('Drop', new StubRow(), {
        HostX: 0, HostY: hostY,
        Data: data,
        AllowedEffects: DragDropEffects.Move,
        Modifiers: NoModifiers,
    });
}

describe('ListReorderBehavior — receiver-side drop logic', () => {
    test('AllowDrop is set when the behavior attaches', () => {
        const { ic } = buildItemsControl(['a', 'b', 'c']);
        ic.AddBehavior(new ListReorderBehavior());
        assert.equal(ic.AllowDrop, true);
    });

    test('drop above row 1 midpoint moves the source there', () => {
        const { ic, coll } = buildItemsControl(['a', 'b', 'c']);
        ic.AddBehavior(new ListReorderBehavior());
        // Row midpoints (height 20 each, top y = i*20) live at 10, 30,
        // 50. Drop at hostY=25 lands ABOVE row 1's midpoint, so insertion
        // index is 1. Moving from index 2 ('c') → insertion 1 yields
        // ['a','c','b'].
        ic.FireRoutedListeners('Drop', dropArgs(25, 2));
        assert.deepEqual(snapshot(coll), ['a', 'c', 'b']);
    });

    test('drop below the last row appends to end', () => {
        const { ic, coll } = buildItemsControl(['a', 'b', 'c']);
        ic.AddBehavior(new ListReorderBehavior());
        // Beyond the last midpoint (50) — insertion index is 3 (end).
        // Moving from index 0 ('a') → insertion adjusted to 2 after the
        // removal index-shift; result ['b','c','a'].
        ic.FireRoutedListeners('Drop', dropArgs(200, 0));
        assert.deepEqual(snapshot(coll), ['b', 'c', 'a']);
    });

    test('dragging onto its own slot is a no-op', () => {
        const { ic, coll } = buildItemsControl(['a', 'b', 'c']);
        ic.AddBehavior(new ListReorderBehavior());
        // hostY=15 → insertion before row 1 (above midpoint 30) → 1.
        // Source from=0 → target 1 → no-op (the gap immediately after
        // the source row).
        ic.FireRoutedListeners('Drop', dropArgs(15, 0));
        assert.deepEqual(snapshot(coll), ['a', 'b', 'c']);
    });

    test('drop with no matching format key is ignored', () => {
        const { ic, coll } = buildItemsControl(['a', 'b', 'c']);
        ic.AddBehavior(new ListReorderBehavior());
        // No format set → behavior bails out without mutating Items.
        const args = new DragEventArgs('Drop', new StubRow(), {
            HostX: 0, HostY: 25,
            Data: new DataObject(),
            AllowedEffects: DragDropEffects.Move,
            Modifiers: NoModifiers,
        });
        ic.FireRoutedListeners('Drop', args);
        assert.deepEqual(snapshot(coll), ['a', 'b', 'c']);
    });

    test('DragOver sets Effect=Move when the format key is present', () => {
        const { ic } = buildItemsControl(['a', 'b']);
        ic.AddBehavior(new ListReorderBehavior());
        const args = new DragEventArgs('DragOver', new StubRow(), {
            HostX: 0, HostY: 5,
            Data: new DataObject().Set('@pragmatic-tech-ai/mural/reorder/from-index', 0),
            AllowedEffects: DragDropEffects.Move,
            Modifiers: NoModifiers,
        });
        ic.FireRoutedListeners('DragOver', args);
        assert.equal(args.Effect, DragDropEffects.Move);
    });
});

function snapshot<T>(c: ObservableCollection<T>): T[]
{
    const out: T[] = [];
    for (let i = 0; i < c.Count; i++) out.push(c.Get(i)!);
    return out;
}

// Wrap-mode coverage. Spins up a real VirtualizingWrapPanel inside an
// ItemsControl with non-zero HorizontalSpacing / VerticalSpacing so the
// behavior's cursor-to-cell and adorner-placement math has to use cell
// strides (cell + spacing), not raw ItemWidth / ItemHeight.
describe('ListReorderBehavior — VirtualizingWrapPanel with spacing', () => {
    class Cell extends Element
    {
        protected override MeasureOverride(_a: Size): Size { return new Size(100, 100); }
    }

    function buildWrapIC(
        itemCount: number,
        opts: {
            viewport:           Rect;
            horizontalSpacing?: number;
            verticalSpacing?:   number;
        },
    ): { ic: ItemsControl; panel: VirtualizingWrapPanel; coll: ObservableCollection<string> }
    {
        const panel = new VirtualizingWrapPanel();
        panel.ItemWidth         = 100;
        panel.ItemHeight        = 100;
        if (opts.horizontalSpacing !== undefined) panel.HorizontalSpacing = opts.horizontalSpacing;
        if (opts.verticalSpacing   !== undefined) panel.VerticalSpacing   = opts.verticalSpacing;
        panel.Viewport = opts.viewport;
        const ic = new ItemsControl();
        ic.ItemsPanel   = () => panel;
        ic.ItemTemplate = new DataTemplate(() => new Cell());
        const coll = new ObservableCollection<string>();
        for (let i = 0; i < itemCount; i++) coll.Add(`w${i}`);
        ic.Items = coll;
        ic.Measure(new Size(opts.viewport.Width, opts.viewport.Height));
        ic.Arrange(new Rect(0, 0, opts.viewport.Width, opts.viewport.Height));
        return { ic, panel, coll };
    }

    function dropAt(hostX: number, hostY: number, fromIndex: number): DragEventArgs
    {
        return new DragEventArgs('Drop', new StubRow(), {
            HostX: hostX, HostY: hostY,
            Data: new DataObject().Set('@pragmatic-tech-ai/mural/reorder/from-index', fromIndex),
            AllowedEffects: DragDropEffects.Move,
            Modifiers: NoModifiers,
        });
    }

    test('cursor in the inter-column gap resolves the same column as a cursor just inside that column', () => {
        // 4 cols × 100 + 3 gaps × 20 = 460 → fits in 460-wide viewport.
        // Stride X = 120.
        // Cell 1 paints x = [120, 220), gap to cell 2 = [220, 240).
        // A cursor at x = 230 is in the GAP between col 1 and col 2; the
        // floor-stride map says col = floor(230 / 120) = 1, and the
        // midpoint refinement (x > col*120 + 50 = 170) tips to "after col
        // 1" → insertion index = 2. Without stride-aware math, x=230 would
        // resolve to col = floor(230 / 100) = 2 and the midpoint would
        // also shift, giving a different insertion column.
        const { ic, coll } = buildWrapIC(8, {
            viewport:          new Rect(0, 0, 460, 200),
            horizontalSpacing: 20,
        });
        ic.AddBehavior(new ListReorderBehavior());
        // From index 0; with target insertion 2, after the RemoveAt
        // adjustment we get insert=1 → ['w1','w0','w2','w3',…].
        ic.FireRoutedListeners('Drop', dropAt(230, 50, 0));
        assert.deepEqual(snapshot(coll).slice(0, 4), ['w1', 'w0', 'w2', 'w3']);
    });

    test('row mapping uses ItemHeight + VerticalSpacing as the stride', () => {
        // 3 cols, stride X = 100 (no hSp). Stride Y = 120 (vSp=20).
        // Row 0 paints y = [0, 100); gap y = [100, 120); row 1 paints
        // y = [120, 220). Cursor at y = 180 (middle of row 1) →
        // row = floor(180/120) = 1 → cells [3..5]. Cursor X = 50 sits
        // squarely in col 0 → candidate index = 3. Midpoint of col 0
        // = 50; localX(50) > 50 is false → insertion at 3. Without
        // stride-aware Y math, the old code would compute row =
        // floor(180/100) = 1 too — but only coincidentally; bumping
        // y to 110 (in the row-gap) used to spuriously say row 1
        // (floor(110/100)=1) when the cursor is between rows. With
        // the stride floor(110/120)=0, row 0 wins, which is correct.
        // We pick y=180 here because it's unambiguously inside row 1
        // under either policy; the spacing-sensitive case (y in the
        // gap) is what the formula change protects.
        const { ic, coll } = buildWrapIC(9, {
            viewport:        new Rect(0, 0, 300, 300),
            verticalSpacing: 20,
        });
        ic.AddBehavior(new ListReorderBehavior());
        // Drop from=7 (w7); insertion=3; after RemoveAt(7) the insert
        // index doesn't shift (target < from) → coll = [w0,w1,w2,w7,w3..w6,w8].
        ic.FireRoutedListeners('Drop', dropAt(50, 180, 7));
        assert.deepEqual(snapshot(coll), ['w0', 'w1', 'w2', 'w7', 'w3', 'w4', 'w5', 'w6', 'w8']);
    });

    test('insertion adorner sits centered in the inter-column gap (col > 0) and at the panel left edge (col 0)', () => {
        // 3 cols × 100 + 2 gaps × 30 = 360 fits a 360-wide viewport.
        // Stride X = 130. Cell 0 left = 0; cell 1 left = 130; cell 2
        // left = 260. The gap between cells 0 and 1 spans x = [100, 130);
        // its center is x = 115 = col(1)*130 − 30/2.
        const target = new (class
        {
            public readonly attached: Visual[] = [];
            public AttachOverlay(v: Visual): void { this.attached.push(v); }
            public DetachOverlay(_v: Visual): void { }
        })();
        const { ic, panel } = buildWrapIC(6, {
            viewport:          new Rect(0, 0, 360, 200),
            horizontalSpacing: 30,
            verticalSpacing:   30,
        });
        (ic as unknown as { _target: typeof target })._target = target;
        const beh = new ListReorderBehavior();
        beh.InsertionAdornerTemplate = new DataTemplate(() => new (class extends Element
        {
            protected override MeasureOverride(_a: Size): Size { return new Size(0, 0); }
        })());
        ic.AddBehavior(beh);

        // Cursor at panel-local x=120 (in the gap between col 0 and col
        // 1). Floor-stride says col=0; midpoint of col 0 = 50; x > 50 →
        // insertion at col 1 → index = 1.
        const session = new DragSession(undefined, new DataObject(), DragDropEffects.Move);
        const data = session.Data;
        data.Set('@pragmatic-tech-ai/mural/reorder/from-index', 5);
        ic.FireRoutedListeners('DragOver', new DragEventArgs('DragOver', new StubRow(), {
            HostX: 120, HostY: 50,
            Data: data,
            AllowedEffects: DragDropEffects.Move,
            Modifiers: NoModifiers,
            Session: session,
        }));
        const wrapper = target.attached[0]!;
        const adorner = wrapper.visualChildren[0]!;
        // Indicator centered in the gap = col(1)*130 − 15 = 115.
        assert.equal(Canvas.GetLeft(adorner), 115);
        // Width is 2px, height = ItemHeight.
        assert.equal(adorner.Width,  2);
        assert.equal(adorner.Height, panel.ItemHeight);

        // Now move to a cursor that lands in col 0 (index 0 insertion).
        // The indicator pins to the panel's left edge (x=0).
        ic.FireRoutedListeners('DragOver', new DragEventArgs('DragOver', new StubRow(), {
            HostX: 10, HostY: 50,
            Data: data,
            AllowedEffects: DragDropEffects.Move,
            Modifiers: NoModifiers,
            Session: session,
        }));
        assert.equal(Canvas.GetLeft(adorner), 0);
        session.Cancel();
    });
});

// Pins backlog 8.5: InsertionAdornerTemplate DP — when set, the
// behavior materializes the template at the insertion gap on the
// host's overlay layer. The framework computes the gap position from
// the same midpoint math the drop logic already uses.
describe('ListReorderBehavior — insertion-line adorner (8.5)', () => {
    // Stub PresentationTarget that records what gets attached / detached
    // on its overlay. Pluggable directly into the ItemsControl's
    // `target` field bypassing the renderer; the behavior reads
    // `host['target']` and calls AttachOverlay / DetachOverlay on it.
    class StubTarget
    {
        public readonly attached: Visual[] = [];
        public readonly detached: Visual[] = [];
        public AttachOverlay(v: Visual): void { this.attached.push(v); }
        public DetachOverlay(v: Visual): void { this.detached.push(v); }
    }

    function lineTemplate(): DataTemplate
    {
        return new DataTemplate(() => {
            const line = new (class extends Element
            {
                protected override MeasureOverride(_a: Size): Size { return new Size(0, 2); }
            })();
            return line;
        });
    }

    function dragOverArgs(hostY: number, session: DragSession): DragEventArgs
    {
        const data = session.Data;
        data.Set('@pragmatic-tech-ai/mural/reorder/from-index', 0);
        return new DragEventArgs('DragOver', new StubRow(), {
            HostX: 0, HostY: hostY,
            Data: data,
            AllowedEffects: DragDropEffects.Move,
            Modifiers: NoModifiers,
            Session: session,
        });
    }

    test('Without a template, no overlay attachment happens', () => {
        const { ic } = buildItemsControl(['a', 'b', 'c']);
        const target = new StubTarget();
        (ic as unknown as { _target: StubTarget })._target = target;
        ic.AddBehavior(new ListReorderBehavior());

        const session = new DragSession(undefined, new DataObject(), DragDropEffects.Move);
        ic.FireRoutedListeners('DragOver', dragOverArgs(10, session));
        assert.equal(target.attached.length, 0);
        session.Cancel();
    });

    test('First valid DragOver materializes the template and attaches it to the overlay', () => {
        const { ic } = buildItemsControl(['a', 'b', 'c']);
        (ic as unknown as { _arrangedRect: Rect })._arrangedRect = new Rect(0, 0, 100, 60);
        const target = new StubTarget();
        (ic as unknown as { _target: StubTarget })._target = target;
        const beh = new ListReorderBehavior();
        beh.InsertionAdornerTemplate = lineTemplate();
        ic.AddBehavior(beh);

        const session = new DragSession(undefined, new DataObject(), DragDropEffects.Move);
        // hostY = 10 → cursor in row 0 (which spans y 0..20). midpoint = 10.
        // hostY < midpoint? No (10 < 10 false), but boundary case.
        // Try hostY = 5 → midpoint of row 0 = 10. 5 < 10 → insertion index 0.
        ic.FireRoutedListeners('DragOver', dragOverArgs(5, session));
        assert.equal(target.attached.length, 1);
        // Attached value is the Canvas wrapper; the produced template
        // visual is its child. Canvas.Top steers the child within the
        // wrapper so the OverlayLayer's full-surface arrange slot
        // doesn't squash the positioning.
        const wrapper = target.attached[0]!;
        const adorner = wrapper.visualChildren[0]!;
        // Adorner at gap before row 0 → y = top of row 0 = 0.
        assert.equal(Canvas.GetTop(adorner), 0);
        // Adorner width follows the host's arranged width.
        assert.equal(adorner.Width, 100);
        session.Cancel();
    });

    test('Subsequent DragOvers re-use the same adorner and shift Canvas.Top', () => {
        const { ic } = buildItemsControl(['a', 'b', 'c']);
        (ic as unknown as { _arrangedRect: Rect })._arrangedRect = new Rect(0, 0, 100, 60);
        const target = new StubTarget();
        (ic as unknown as { _target: StubTarget })._target = target;
        const beh = new ListReorderBehavior();
        beh.InsertionAdornerTemplate = lineTemplate();
        ic.AddBehavior(beh);

        const session = new DragSession(undefined, new DataObject(), DragDropEffects.Move);
        ic.FireRoutedListeners('DragOver', dragOverArgs(5, session));      // gap before row 0
        const wrapper = target.attached[0]!;
        const adorner = wrapper.visualChildren[0]!;
        const before = Canvas.GetTop(adorner);
        ic.FireRoutedListeners('DragOver', dragOverArgs(35, session));     // mid row 1 → gap between 1 and 2 = y 40
        assert.equal(target.attached.length, 1, 'still one adorner attached');
        const after = Canvas.GetTop(adorner);
        assert.notEqual(after, before);
        session.Cancel();
    });

    test('DragLeave tears down the adorner', () => {
        const { ic } = buildItemsControl(['a', 'b']);
        (ic as unknown as { _arrangedRect: Rect })._arrangedRect = new Rect(0, 0, 100, 40);
        const target = new StubTarget();
        (ic as unknown as { _target: StubTarget })._target = target;
        const beh = new ListReorderBehavior();
        beh.InsertionAdornerTemplate = lineTemplate();
        ic.AddBehavior(beh);

        const session = new DragSession(undefined, new DataObject(), DragDropEffects.Move);
        ic.FireRoutedListeners('DragOver', dragOverArgs(5, session));
        assert.equal(target.attached.length, 1);

        ic.FireRoutedListeners('DragLeave', new DragEventArgs('DragLeave', ic, {
            HostX: 0, HostY: 100,
            Data: session.Data,
            AllowedEffects: DragDropEffects.Move,
            Modifiers: NoModifiers,
            Session: session,
        }));
        assert.equal(target.detached.length, 1, 'adorner detached on DragLeave');
        session.Cancel();
    });
});
