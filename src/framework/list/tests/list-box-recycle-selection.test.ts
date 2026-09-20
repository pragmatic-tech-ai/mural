import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';

import { Application, Color, Setter, Style, Element, Visual } from '../../../runtime/index.js';
import { ListBox, ListBoxItem } from '../list-box.js';
import { Border } from '../../../basic/border.js';
import { ContentPresenter } from '../../../basic/templates/content-presenter.js';
import { ControlTemplate } from '../../../basic/templates/control-template.js';
import { TargetedSetter, TemplatePropertyTrigger } from '../../../basic/templates/data-template.js';
import { SolidColorBrush } from '../../../visual-engine/index.js';

describe('ListBox selection survives container recycle by data identity', () => {
    beforeEach(() => { initTestApp(); });

    test('recycled container picks up new item selection from _selectedData', () => {
        const lb = new ListBox();
        lb.Items = ['A', 'B', 'C', 'D'];
        lb.SelectedItem = 'B';

        const containerB = lb.Generator.ContainerFromItem('B') as ListBoxItem;
        assert.ok(containerB instanceof ListBoxItem);
        assert.equal(containerB.IsSelected, true);

        lb.Generator.Recycle(containerB);
        const recycled = lb.Generator.ClaimRecycled() as ListBoxItem;
        lb.RebindContainerForItemOverride(recycled, 'D');
        assert.equal(recycled.IsSelected, false,
            'recycled container should not carry the previous row\'s IsSelected');
    });

    test('recycled container picks up TRUE when reused for a previously selected item', () => {
        const lb = new ListBox();
        lb.Items = ['A', 'B', 'C', 'D'];
        lb.SelectedItem = 'B';

        const containerB = lb.Generator.ContainerFromItem('B') as ListBoxItem;
        lb.Generator.Recycle(containerB);
        const recycled = lb.Generator.ClaimRecycled() as ListBoxItem;
        lb.RebindContainerForItemOverride(recycled, 'B');
        assert.equal(recycled.IsSelected, true);
    });

    test('after many recycle/rebind cycles, the original selection survives when its item scrolls back into view', () => {
        // Simulates the VirtualizingWrapPanel scroll loop in the
        // word-toolbox right pane: select a row, scroll it out (recycle
        // its container without ClearContainerForItemOverride — that's
        // what virtualizing panels do), bring NEW rows into view by
        // claiming pool entries and rebinding them, then scroll all the
        // way back to bring the originally-selected item back into
        // view. The recycled-into-the-original-slot container must
        // re-light the selection because _selectedData remembers the
        // item identity across pool churn.
        const lb = new ListBox();
        const items: string[] = [];
        for (let i = 0; i < 50; i++) items.push(`item-${i}`);
        lb.Items = items;
        lb.SelectedItem = 'item-5';

        // Snapshot the realized container for item-5 (selected) and
        // the realized containers for items 0..15 — those represent
        // the initial viewport. Recycle them ALL (simulating a scroll
        // that moves them out of view).
        const initialRealized: ListBoxItem[] = [];
        for (let i = 0; i < 16; i++)
        {
            const c = lb.Generator.ContainerFromItem(`item-${i}`) as ListBoxItem;
            initialRealized.push(c);
        }
        for (const c of initialRealized) lb.Generator.Recycle(c);

        // Pull recycled containers from the pool and bind each to a
        // new row (items 30..45 — the rows now in view after scrolling
        // down). After this loop NONE of them should be IsSelected,
        // because none of those new items is in _selectedData.
        const rebound: ListBoxItem[] = [];
        for (let i = 30; i < 46; i++)
        {
            const c = lb.Generator.ClaimRecycled() as ListBoxItem | undefined;
            if (c === undefined) break;
            lb.RebindContainerForItemOverride(c, `item-${i}`);
            rebound.push(c);
        }
        for (const c of rebound)
        {
            assert.equal(c.IsSelected, false,
                `recycled container rebound to a non-selected item must not show selection chrome`);
        }

        // Now scroll back up. Recycle the rebound containers again,
        // then claim them and re-bind to items 0..15. The container
        // that gets re-bound to item-5 (the originally selected one)
        // MUST re-light its IsSelected.
        for (const c of rebound) lb.Generator.Recycle(c);
        for (let i = 0; i < 16; i++)
        {
            const c = lb.Generator.ClaimRecycled() as ListBoxItem | undefined;
            if (c === undefined)
            {
                // Fresh container path — for items beyond the pool size
                // the generator would normally create a new container.
                // The test doesn't exercise that branch.
                break;
            }
            lb.RebindContainerForItemOverride(c, `item-${i}`);
            if (`item-${i}` === 'item-5')
            {
                assert.equal(c.IsSelected, true,
                    `the originally-selected item must light up again when its row scrolls back into view`);
            }
            else
            {
                assert.equal(c.IsSelected, false,
                    `non-selected items must not carry stale selection chrome`);
            }
        }
    });

    test('ItemContainerStyle + custom template with IsSelected trigger: chrome clears across recycle cycles (word-toolbox parity)', () => {
        // Mimics the WordTileItemStyle setup: an ItemContainerStyle
        // whose Template carries a TemplatePropertyTrigger watching
        // IsSelected and writing PART_Border.Fill. The default
        // ListBoxItem template already has its own IsSelected → chrome
        // trigger, but consumers who supply their OWN template via
        // ItemContainerStyle (word-toolbox right pane) get a different
        // template-instance + trigger-attach lifecycle. Pins that the
        // recycle/rebind path clears chrome for both paths.
        const selectedBrush = new SolidColorBrush(Color.FromHex('#e3f2fd'));
        const customTemplate = new ControlTemplate(
            () => {
                const b = new Border();
                b.Name = 'PART_Border';
                const cp = new ContentPresenter();
                b.SetChild(cp);
                return b;
            },
            [
                new TemplatePropertyTrigger(
                    ListBoxItem, 'IsSelected', true,
                    [new TargetedSetter(Border, 'Fill', selectedBrush, 'PART_Border')],
                ),
            ],
        );
        const itemStyle = new Style(ListBoxItem, [
            new Setter(ListBoxItem, 'Template', customTemplate),
        ]);

        const lb = new ListBox();
        const items: string[] = [];
        for (let i = 0; i < 50; i++) items.push(`item-${i}`);
        lb.ItemContainerStyle = itemStyle;
        lb.Items = items;
        lb.SelectedItem = 'item-5';

        const C5 = lb.Generator.ContainerFromItem('item-5') as ListBoxItem;
        const partBorder5 = C5.visualChildren[0]!.FindName('PART_Border') as Border;
        assert.ok(partBorder5 instanceof Border, 'PART_Border missing in custom template root');
        assert.equal(C5.IsSelected, true);
        assert.equal(partBorder5.Fill, selectedBrush,
            'selected row should have the trigger-applied background');

        // Recycle C5 (and a few siblings) — mimics scroll-out.
        lb.Generator.Recycle(C5);
        const C0 = lb.Generator.ContainerFromItem('item-0') as ListBoxItem;
        const C1 = lb.Generator.ContainerFromItem('item-1') as ListBoxItem;
        lb.Generator.Recycle(C0);
        lb.Generator.Recycle(C1);

        // Pull recycled containers, bind to new items (scroll-in). The
        // recycled C5 must shed its selection chrome AND IsSelected.
        const c30 = lb.Generator.ClaimRecycled() as ListBoxItem;
        lb.RebindContainerForItemOverride(c30, 'item-30');
        const c31 = lb.Generator.ClaimRecycled() as ListBoxItem;
        lb.RebindContainerForItemOverride(c31, 'item-31');
        const c32 = lb.Generator.ClaimRecycled() as ListBoxItem;
        lb.RebindContainerForItemOverride(c32, 'item-32');

        for (const c of [c30, c31, c32])
        {
            assert.equal(c.IsSelected, false,
                `recycled container rebound to a non-selected item must not show IsSelected`);
            const pb = c.visualChildren[0]!.FindName('PART_Border') as Border;
            assert.equal(pb.Fill, undefined,
                `recycled container must shed the trigger-applied background — saw ${pb.Fill}`);
        }
    });

    test('InvalidateVisual fired while detached replays on re-attach (regression: VWP recycle dropping stale-chrome notifications)', () => {
        // Repro for the renderer-side bug behind the word-toolbox
        // scroll-recycle selection issue. During the recycle cycle the
        // container sits in the pool (detached, _target=undefined).
        // bindContainer fires SetIsSelectedInternal(false) → trigger →
        // PART_Border.Fill change → InvalidateVisual on
        // PART_Border. If that call is a no-op while detached, the
        // SVG keeps the prior binding's blue paint. Verified here at
        // the lowest level: confirm the visual queues the invalidation
        // while detached and replays it once SetTarget makes it
        // attached again.
        class StubTarget
        {
            public readonly renderInvalidations: Visual[] = [];
            public OnRenderInvalidated(v: Visual): void { this.renderInvalidations.push(v); }
            public OnMeasureInvalidated(_v: Visual): void {}
            public OnArrangeInvalidated(_v: Visual): void {}
        }
        const target = new StubTarget();
        const leaf = new (class extends Element
        {
            protected override MeasureOverride(_a: never): never { return undefined as never; }
        })();
        // Attach to the stub target first.
        (leaf as unknown as { SetTarget: (t: unknown) => void }).SetTarget(target);
        assert.equal(target.renderInvalidations.length, 0,
            'fresh attach should not produce a stray invalidation');

        // Detach. Then InvalidateVisual should queue, not drop.
        (leaf as unknown as { SetTarget: (t: unknown) => void }).SetTarget(undefined);
        leaf.InvalidateVisual();
        assert.equal(target.renderInvalidations.length, 0,
            'detached InvalidateVisual must NOT reach the stale target');

        // Re-attach to a NEW stub target — verifies the replay routes
        // to the post-attach target, not the pre-detach one.
        const target2 = new StubTarget();
        (leaf as unknown as { SetTarget: (t: unknown) => void }).SetTarget(target2);
        assert.equal(target2.renderInvalidations.length, 1,
            'queued invalidation must replay on re-attach');
        assert.equal(target2.renderInvalidations[0], leaf);
        assert.equal(target.renderInvalidations.length, 0,
            'the original target must not see the replay');

        // Subsequent re-attaches don't replay the same invalidation
        // twice — the flag is one-shot.
        (leaf as unknown as { SetTarget: (t: unknown) => void }).SetTarget(undefined);
        (leaf as unknown as { SetTarget: (t: unknown) => void }).SetTarget(target2);
        assert.equal(target2.renderInvalidations.length, 1,
            're-attach with no new invalidation must not replay anything');
    });

    test('PART_Border.Fill clears on rebind to a non-selected item (chrome end-to-end)', async () => {
        // The default ListBoxItem template's IsSelected trigger writes
        // PART_Border.Fill = @SecondaryContainer. That's a
        // DynamicResource lookup that needs SOME palette merged into
        // Application.Resources — without it the trigger value
        // resolves to undefined and the assertion below has nothing
        // to snapshot. Register a Material palette for the same
        // reason real demos do.
        new Application();
        const { SetTheme } = await import('../../../resources/material/index.js');
        SetTheme('light');

        const lb = new ListBox();
        lb.Items = ['A', 'B', 'C', 'D'];
        lb.SelectedItem = 'B';

        const containerB = lb.Generator.ContainerFromItem('B') as ListBoxItem;
        // Resolve PART_Border via the template root's namescope.
        // Default template wraps content in a PART_Border the
        // IsSelected trigger writes Fill on.
        const root = containerB.visualChildren[0]!;
        const partBorder = root.FindName('PART_Border') as Border | undefined;
        assert.ok(partBorder instanceof Border,
            'PART_Border must be findable in the templated row');
        // While selected, the IsSelected trigger writes the
        // SecondaryContainer brush. Snapshot it so we can verify it
        // clears after rebind.
        const selectedBg = partBorder.Fill;
        assert.ok(selectedBg !== undefined,
            'selected row should have a non-undefined background from the trigger');

        lb.Generator.Recycle(containerB);
        const recycled = lb.Generator.ClaimRecycled() as ListBoxItem;
        lb.RebindContainerForItemOverride(recycled, 'D');
        assert.equal(recycled.IsSelected, false);
        const partBorderAfter = recycled.visualChildren[0]!.FindName('PART_Border') as Border | undefined;
        assert.ok(partBorderAfter instanceof Border);
        assert.equal(partBorderAfter.Fill, undefined,
            'after rebind to a non-selected item the chrome background should clear');
    });
});
