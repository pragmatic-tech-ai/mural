import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SegmentedButton, SegmentedItem } from '../../../framework/button-groups/segmented-button.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic SegmentedButton', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        const { control } = ControlHarness.Render(() => new SegmentedButton(), { scheme: PragmaticLight });
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'SegmentedButton uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('group outline strokes @BorderStrong', () =>
    {
        const { svg } = ControlHarness.Render(() => new SegmentedButton(), { scheme: PragmaticLight });
        const strong = ControlHarness.TokenCss('BorderStrong');
        assert.equal(strong, 'rgb(214,213,208)');
        assert.ok(svg.includes(`stroke="${strong}"`), 'group outline strokes @BorderStrong');
        ControlHarness.Reset();
    });
});

describe('Pragmatic SegmentedItem', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        const { control } = ControlHarness.Render(() =>
        {
            const it = new SegmentedItem();
            it.Content = 'One';
            return it;
        }, { scheme: PragmaticLight });
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'SegmentedItem uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('selected segment fills @SurfaceSelected on the dedicated layer', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const it = new SegmentedItem();
            it.Content = 'One';
            it.IsSelected = true;
            return it;
        }, { scheme: PragmaticLight });
        const selected = ControlHarness.TokenCss('SurfaceSelected');
        assert.equal(selected, 'rgb(226,243,233)');
        assert.ok(svg.includes(selected!), 'selected SegmentedItem paints @SurfaceSelected');
        ControlHarness.Reset();
    });

    test('selected + hovered keeps the selected fill — PART_Selected wins over @Bg2', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const it = new SegmentedItem();
            it.Content = 'One';
            it.IsSelected = true;
            it._setIsMouseOver(true);
            return it;
        }, { scheme: PragmaticLight });
        const selected = ControlHarness.TokenCss('SurfaceSelected');
        const hover = ControlHarness.TokenCss('Bg2');
        const si = svg.indexOf(selected!);
        const hi = svg.indexOf(hover!);
        assert.notEqual(si, -1, 'selected + hovered segment still paints @SurfaceSelected');
        assert.notEqual(hi, -1, 'the @Bg2 hover surface still paints underneath');
        assert.ok(si > hi, 'PART_Selected (@SurfaceSelected) paints AFTER @Bg2 so selection wins while hovered');
        ControlHarness.Reset();
    });

    test('focus paints the ring stroke (@BorderFocus)', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const it = new SegmentedItem();
            it.Content = 'One';
            it._setIsFocused(true);
            return it;
        }, { scheme: PragmaticLight });
        const borderFocus = ControlHarness.TokenCss('BorderFocus');
        assert.equal(borderFocus, 'rgb(34,130,77)');
        assert.ok(svg.includes(`stroke="${borderFocus}"`), 'focused SegmentedItem paints the @BorderFocus stroke');
        ControlHarness.Reset();
    });

    test('no grey fallback under Pragmatic', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const it = new SegmentedItem();
            it.Content = 'One';
            return it;
        }, { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080 — every token resolves');
        ControlHarness.Reset();
    });

    test('renders under PragmaticDark with the dark @SurfaceSelected and no grey', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const it = new SegmentedItem();
            it.Content = 'One';
            it.IsSelected = true;
            return it;
        }, { scheme: PragmaticDark });
        const selected = ControlHarness.TokenCss('SurfaceSelected');
        assert.equal(selected, 'rgb(15,42,26)');
        assert.ok(svg.includes(selected!), 'selected SegmentedItem paints the dark @SurfaceSelected');
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080 under PragmaticDark');
        ControlHarness.Reset();
    });
});
