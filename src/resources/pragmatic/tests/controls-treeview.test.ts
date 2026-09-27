import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TreeView, TreeViewItem, CollapsibleStack } from '../../../framework/list/tree-view.js';
import { ItemsPresenter } from '../../../basic/templates/items-presenter.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic TreeView', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        const { control } = ControlHarness.Render(() => new TreeView(), { scheme: PragmaticLight });
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'TreeView uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('Material is unaffected — a TreeView under Material keeps the Material style', () =>
    {
        const { control } = ControlHarness.Render(() => new TreeView(), { scheme: MaterialLight });
        assert.ok(!ControlHarness.IsPragmaticStyle(control), 'Material TreeView does NOT resolve the Pragmatic style');
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
