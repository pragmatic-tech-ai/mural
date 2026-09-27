import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ListBox, ListBoxItem } from '../../../framework/list/list-box.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic ListBox', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        const { control } = ControlHarness.Render(() => new ListBox(), { scheme: PragmaticLight });
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'ListBox uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('Material is unaffected — a ListBox under Material keeps the Material style', () =>
    {
        const { control } = ControlHarness.Render(() => new ListBox(), { scheme: MaterialLight });
        assert.ok(!ControlHarness.IsPragmaticStyle(control), 'Material ListBox does NOT resolve the Pragmatic style');
        ControlHarness.Reset();
    });
});

describe('Pragmatic ListBoxItem', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        const { control } = ControlHarness.Render(() =>
        {
            const it = new ListBoxItem();
            it.Content = 'Row';
            return it;
        }, { scheme: PragmaticLight });
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'ListBoxItem uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('selected row fills @SurfaceSelected (#E2F3E9) on the dedicated layer', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const it = new ListBoxItem();
            it.Content = 'Row';
            it.IsSelected = true;
            return it;
        }, { scheme: PragmaticLight });
        const selected = ControlHarness.TokenCss('SurfaceSelected');
        assert.equal(selected, 'rgb(226,243,233)');
        assert.ok(svg.includes(selected!), 'selected ListBoxItem paints @SurfaceSelected');
        ControlHarness.Reset();
    });

    test('selected + hovered keeps the selected fill — PART_Selected wins over @Bg2 hover', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const it = new ListBoxItem();
            it.Content = 'Row';
            it.IsSelected = true;
            it._setIsMouseOver(true);
            return it;
        }, { scheme: PragmaticLight });
        const selected = ControlHarness.TokenCss('SurfaceSelected');
        const hover = ControlHarness.TokenCss('Bg2');
        const si = svg.indexOf(selected!);
        const hi = svg.indexOf(hover!);
        assert.notEqual(si, -1, 'selected + hovered row still paints @SurfaceSelected');
        assert.notEqual(hi, -1, 'the @Bg2 hover surface still paints underneath');
        assert.ok(si > hi, 'PART_Selected (@SurfaceSelected) paints AFTER @Bg2 so selection wins while hovered');
        ControlHarness.Reset();
    });

    test('focus paints the ring stroke (@BorderFocus)', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const it = new ListBoxItem();
            it.Content = 'Row';
            it._setIsFocused(true);
            return it;
        }, { scheme: PragmaticLight });
        const borderFocus = ControlHarness.TokenCss('BorderFocus');
        assert.equal(borderFocus, 'rgb(34,130,77)');
        assert.ok(svg.includes(`stroke="${borderFocus}"`), 'focused ListBoxItem paints the @BorderFocus ring stroke');
        ControlHarness.Reset();
    });

    test('no grey fallback — every token resolves under Pragmatic', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const it = new ListBoxItem();
            it.Content = 'Row';
            return it;
        }, { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080 — every token resolves');
        ControlHarness.Reset();
    });

    test('renders under PragmaticDark with the dark @SurfaceSelected and no grey', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const it = new ListBoxItem();
            it.Content = 'Row';
            it.IsSelected = true;
            return it;
        }, { scheme: PragmaticDark });
        const selected = ControlHarness.TokenCss('SurfaceSelected');
        assert.equal(selected, 'rgb(15,42,26)', '@SurfaceSelected under PragmaticDark is #0F2A1A');
        assert.ok(svg.includes(selected!), 'selected ListBoxItem paints the dark @SurfaceSelected');
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080 under PragmaticDark');
        ControlHarness.Reset();
    });
});
