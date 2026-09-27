import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Thumb } from '../../../basic/scroll/thumb.js';
import { Splitter } from '../../../basic/splitter.js';
import { GridSplitter } from '../../../basic/grid-splitter.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight, MaterialDark } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

// The Thumb-derived primitives (Thumb, Splitter, GridSplitter) paint their
// chrome imperatively in TS (hardcoded inline Border, not a ControlTemplate),
// so a .mu fork can't reach them. They resolve two theme-agnostic semantic
// keys — @ControlTrack (rest) and @ControlActive (hover/drag/preview) —
// that every scheme defines (Material aliases its M3 values so Material stays
// byte-identical; Pragmatic aliases @BorderStrong / @ControlAccent).

describe('scroll/splitter semantic alias bridge', () =>
{
    test('MaterialLight: @ControlTrack = @OutlineVariant, @ControlActive = @Primary (byte-identical)', () =>
    {
        ControlHarness.Activate(MaterialLight);
        assert.equal(ControlHarness.TokenCss('ControlTrack'), 'rgb(202,196,208)', '@ControlTrack == @OutlineVariant (#CAC4D0)');
        assert.equal(ControlHarness.TokenCss('ControlTrack'), ControlHarness.TokenCss('OutlineVariant'));
        assert.equal(ControlHarness.TokenCss('ControlActive'), 'rgb(103,80,164)', '@ControlActive == @Primary (#6750A4)');
        assert.equal(ControlHarness.TokenCss('ControlActive'), ControlHarness.TokenCss('Primary'));
        ControlHarness.Reset();
    });

    test('MaterialDark: @ControlTrack / @ControlActive track the dark M3 values', () =>
    {
        ControlHarness.Activate(MaterialDark);
        assert.equal(ControlHarness.TokenCss('ControlTrack'), ControlHarness.TokenCss('OutlineVariant'));
        assert.equal(ControlHarness.TokenCss('ControlActive'), ControlHarness.TokenCss('Primary'));
        ControlHarness.Reset();
    });

    test('PragmaticLight: @ControlTrack = @BorderStrong, @ControlActive = @ControlAccent', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.equal(ControlHarness.TokenCss('ControlTrack'), 'rgb(214,213,208)', '@ControlTrack == @BorderStrong');
        assert.equal(ControlHarness.TokenCss('ControlActive'), 'rgb(34,130,77)', '@ControlActive == @ControlAccent');
        ControlHarness.Reset();
    });

    test('PragmaticDark: @ControlActive = dark @ControlAccent (#2EA862)', () =>
    {
        ControlHarness.Activate(PragmaticDark);
        assert.equal(ControlHarness.TokenCss('ControlActive'), 'rgb(46,168,98)');
        assert.equal(ControlHarness.TokenCss('ControlTrack'), 'rgb(61,59,54)');
        ControlHarness.Reset();
    });
});

describe('Pragmatic Thumb (inline TS chrome)', () =>
{
    test('rest fill resolves @ControlTrack (@BorderStrong) under Pragmatic', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const th = new Thumb();
        assert.ok(th.Border.Fill instanceof SolidColorBrush, 'thumb border resolves a fill');
        assert.equal((th.Border.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('BorderStrong'), 'Pragmatic thumb rests @BorderStrong');
        ControlHarness.Reset();
    });

    test('Material byte-identical — thumb rest resolves @OutlineVariant', () =>
    {
        ControlHarness.Activate(MaterialLight);
        const th = new Thumb();
        assert.equal((th.Border.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('OutlineVariant'), 'Material thumb rests @OutlineVariant (unchanged)');
        ControlHarness.Reset();
    });
});

describe('Pragmatic Splitter (inline TS chrome)', () =>
{
    test('rest @ControlTrack, hover @ControlActive under Pragmatic', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const sp = new Splitter();
        assert.equal((sp.Border.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('BorderStrong'), 'rest splitter is @BorderStrong');
        sp._setIsMouseOver(true);
        assert.equal((sp.Border.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('ControlAccent'), 'hovered splitter tints @ControlAccent');
        ControlHarness.Reset();
    });

    test('Material byte-identical — rest @OutlineVariant, hover @Primary', () =>
    {
        ControlHarness.Activate(MaterialLight);
        const sp = new Splitter();
        assert.equal((sp.Border.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('OutlineVariant'), 'Material rest splitter unchanged');
        sp._setIsMouseOver(true);
        assert.equal((sp.Border.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Primary'), 'Material hovered splitter unchanged');
        ControlHarness.Reset();
    });
});

describe('Pragmatic GridSplitter', () =>
{
    // NB: PreviewBrush is set by the Style as a DynamicResource; reading the
    // DP value off a bare/headless control returns undefined for BOTH themes
    // (the binding resolves lazily at drag-adorner time), so the resolved
    // STYLE identity is the gate here — the Pragmatic Style carries
    // PreviewBrush = @ControlActive, the Material one @Primary (unchanged).
    // Value-at-drag-time flow is exercised by the existing grid-splitter
    // drag tests under Material and is the identical mechanism under Pragmatic.
    test('resolves the Pragmatic style (which sets PreviewBrush = @ControlActive)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const gs = new GridSplitter();
        assert.ok(ControlHarness.IsPragmaticStyle(gs), 'GridSplitter uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('Material byte-identical — GridSplitter keeps the Material style (PreviewBrush @Primary)', () =>
    {
        ControlHarness.Activate(MaterialLight);
        const gs = new GridSplitter();
        assert.ok(!ControlHarness.IsPragmaticStyle(gs), 'Material GridSplitter keeps the Material style');
        ControlHarness.Reset();
    });
});
