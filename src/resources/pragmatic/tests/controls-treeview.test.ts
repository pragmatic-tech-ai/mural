import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TreeView, TreeViewItem, CollapsibleStack } from '../../../framework/list/tree-view.js';
import { ItemsPresenter } from '../../../basic/templates/items-presenter.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic TreeView', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        const { control } = ControlHarness.Render(() => new TreeView(), { scheme: PragmaticLight });
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'TreeView uses the Pragmatic override style');
        ControlHarness.Reset();
    });
});

describe('Pragmatic TreeViewItem', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        const { control } = ControlHarness.Render(() =>
        {
            const it = new TreeViewItem();
            it.Header = 'Node';
            return it;
        }, { scheme: PragmaticLight });
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'TreeViewItem uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('selected row fills @SurfaceSelected on the dedicated layer', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const it = new TreeViewItem();
            it.Header = 'Node';
            it.IsSelected = true;
            return it;
        }, { scheme: PragmaticLight });
        const selected = ControlHarness.TokenCss('SurfaceSelected');
        assert.equal(selected, 'rgb(226,243,233)');
        assert.ok(svg.includes(selected!), 'selected TreeViewItem paints @SurfaceSelected');
        ControlHarness.Reset();
    });

    test('focus paints the ring stroke (@BorderFocus) on the row', () =>
    {
        // The focus trigger is on PART_Row.IsFocused (the ClickableRow's
        // own focus, per Material's design so a parent row doesn't light
        // up when a child is focused), so drive PART_Row directly.
        const { svg } = ControlHarness.Render(() =>
        {
            const it = new TreeViewItem();
            it.Header = 'Node';
            const row = it.GetTemplateChild('PART_Row');
            row!._setIsFocused(true);
            return it;
        }, { scheme: PragmaticLight });
        const borderFocus = ControlHarness.TokenCss('BorderFocus');
        assert.equal(borderFocus, 'rgb(34,130,77)');
        assert.ok(svg.includes(`stroke="${borderFocus}"`), 'focused TreeViewItem paints the @BorderFocus stroke');
        ControlHarness.Reset();
    });

    // Row HOVER. The hover trigger is `when ( PART_Row.IsMouseOver )` — on the
    // ClickableRow part, NOT the item's own IsMouseOver (so a parent row doesn't
    // light up when a child is hovered), so drive PART_Row directly. The fill is
    // the brand-green-tinted @RowHoverFill: a plain neutral step (@Bg2/@Bg3) was
    // too low-contrast on a @Bg2 side pane to register as feedback.
    test('hovering PART_Row paints @RowHoverFill (PragmaticDark)', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const it = new TreeViewItem();
            it.Header = 'Node';
            it.GetTemplateChild('PART_Row')!._setIsMouseOver(true);
            return it;
        }, { scheme: PragmaticDark });
        const hover = ControlHarness.TokenCss('RowHoverFill');
        assert.equal(hover, 'rgb(38,56,43)', '@RowHoverFill under PragmaticDark is #26382B');
        assert.notEqual(hover, ControlHarness.TokenCss('Bg2'), 'hover must differ from the @Bg2 side pane');
        assert.ok(svg.includes(hover!), 'hovered TreeViewItem paints @RowHoverFill');
        ControlHarness.Reset();
    });

    test('hovering PART_Row paints @RowHoverFill (PragmaticLight)', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const it = new TreeViewItem();
            it.Header = 'Node';
            it.GetTemplateChild('PART_Row')!._setIsMouseOver(true);
            return it;
        }, { scheme: PragmaticLight });
        const hover = ControlHarness.TokenCss('RowHoverFill');
        assert.equal(hover, 'rgb(212,232,218)', '@RowHoverFill under PragmaticLight is #D4E8DA');
        assert.notEqual(hover, ControlHarness.TokenCss('Bg2'), 'hover must differ from the @Bg2 side pane');
        assert.ok(svg.includes(hover!), 'hovered TreeViewItem paints @RowHoverFill');
        ControlHarness.Reset();
    });

    test('no hover fill at rest', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const it = new TreeViewItem();
            it.Header = 'Node';
            return it;
        }, { scheme: PragmaticDark });
        assert.ok(!svg.includes(ControlHarness.TokenCss('RowHoverFill')!), 'a resting row paints no @RowHoverFill');
        ControlHarness.Reset();
    });

    test('nested virtualization intact — PART_ChildHost still hosts a CollapsibleStack of sub-rows', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const parent = new TreeViewItem(); parent.Header = 'P';
        const child = new TreeViewItem(); child.Header = 'C';
        parent.AddChild(child);
        parent.IsExpanded = true;
        assert.deepEqual(parent.SubItems, [child], 'child is a logical sub-item');
        const childHost = parent.GetTemplateChild('PART_ChildHost') as ItemsPresenter;
        assert.ok(childHost instanceof ItemsPresenter, 'PART_ChildHost preserved as the ItemsPresenter');
        const stack = childHost.visualChildren[0]!;
        assert.ok(stack instanceof CollapsibleStack, 'child host still slots a CollapsibleStack');
        assert.deepEqual(stack.visualChildren, [child], 'the sub-row realizes inside the CollapsibleStack');
        ControlHarness.Reset();
    });

    test('no grey fallback — every token resolves under Pragmatic', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const it = new TreeViewItem();
            it.Header = 'Node';
            return it;
        }, { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080 — every token resolves');
        ControlHarness.Reset();
    });

    test('renders under PragmaticDark with the dark @SurfaceSelected and no grey', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const it = new TreeViewItem();
            it.Header = 'Node';
            it.IsSelected = true;
            return it;
        }, { scheme: PragmaticDark });
        const selected = ControlHarness.TokenCss('SurfaceSelected');
        assert.equal(selected, 'rgb(15,42,26)', '@SurfaceSelected under PragmaticDark is #0F2A1A');
        assert.ok(svg.includes(selected!), 'selected TreeViewItem paints the dark @SurfaceSelected');
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080 under PragmaticDark');
        ControlHarness.Reset();
    });
});
