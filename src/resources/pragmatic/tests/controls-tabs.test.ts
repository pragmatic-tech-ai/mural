import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TabControl, TabItem } from '../../../framework/tabs/tabs.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic TabControl', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        const { control } = ControlHarness.Render(() => new TabControl(), { scheme: PragmaticLight });
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'TabControl uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('Material is unaffected', () =>
    {
        const { control } = ControlHarness.Render(() => new TabControl(), { scheme: MaterialLight });
        assert.ok(!ControlHarness.IsPragmaticStyle(control), 'Material TabControl keeps the Material style');
        ControlHarness.Reset();
    });

    test('strip renders with no grey under Pragmatic', () =>
    {
        const { svg } = ControlHarness.Render(() => new TabControl(), { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080 — every token resolves');
        ControlHarness.Reset();
    });
});

describe('Pragmatic TabItem', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        const { control } = ControlHarness.Render(() =>
        {
            const it = new TabItem();
            it.Header = 'Files';
            return it;
        }, { scheme: PragmaticLight });
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'TabItem uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('selected tab paints the @ControlAccent underline (Pen stroke)', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const it = new TabItem();
            it.Header = 'Files';
            it.IsSelected = true;
            return it;
        }, { scheme: PragmaticLight });
        const accent = ControlHarness.TokenCss('ControlAccent');
        assert.equal(accent, 'rgb(34,130,77)');
        assert.ok(svg.includes(`stroke="${accent}"`), 'selected TabItem strokes the @ControlAccent underline');
        ControlHarness.Reset();
    });

    test('rest tab has no accent underline', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const it = new TabItem();
            it.Header = 'Files';
            return it;
        }, { scheme: PragmaticLight });
        const accent = ControlHarness.TokenCss('ControlAccent');
        assert.ok(!svg.includes(`stroke="${accent}"`), 'rest TabItem underline is transparent (no accent stroke)');
        ControlHarness.Reset();
    });

    test('focus paints the ring stroke (@BorderFocus)', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const it = new TabItem();
            it.Header = 'Files';
            it._setIsFocused(true);
            return it;
        }, { scheme: PragmaticLight });
        const borderFocus = ControlHarness.TokenCss('BorderFocus');
        assert.equal(borderFocus, 'rgb(34,130,77)');
        assert.ok(svg.includes(`stroke="${borderFocus}"`), 'focused TabItem paints the @BorderFocus stroke');
        ControlHarness.Reset();
    });

    test('no grey fallback under Pragmatic', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const it = new TabItem();
            it.Header = 'Files';
            return it;
        }, { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080 — every token resolves');
        ControlHarness.Reset();
    });

    test('selected underline uses the dark @ControlAccent under PragmaticDark', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const it = new TabItem();
            it.Header = 'Files';
            it.IsSelected = true;
            return it;
        }, { scheme: PragmaticDark });
        const accent = ControlHarness.TokenCss('ControlAccent');
        assert.equal(accent, 'rgb(46,168,98)');
        assert.ok(svg.includes(`stroke="${accent}"`), 'dark selected TabItem strokes the dark @ControlAccent');
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080 under PragmaticDark');
        ControlHarness.Reset();
    });
});
