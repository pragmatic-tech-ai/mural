import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../../runtime/index.js';
import { Button, ButtonVariant } from '../../../framework/buttons/button.js';
import { ComboBox } from '../../../framework/list/combo-box.js';
import { Pragmatic, PragmaticControls, PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic Button', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        const { control } = ControlHarness.Render(() => new Button(), { scheme: PragmaticLight });
        // The Pragmatic primary template fills with @ActionPrimary; the
        // resolved implicit style is the PragmaticControls one (identity).
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'Button uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('legacy Variant = Filled renders the Primary look (@ActionPrimary)', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const b = new Button();
            b.Variant = ButtonVariant.Filled;
            return b;
        }, { scheme: PragmaticLight });
        // #22824D — the SvgDrawingContext serialises brushes as rgb().
        const actionPrimary = ControlHarness.TokenCss('ActionPrimary');
        assert.equal(actionPrimary, 'rgb(34,130,77)');
        assert.ok(svg.includes(actionPrimary!), 'legacy Filled maps onto the Pragmatic primary surface');
        ControlHarness.Reset();
    });

    test('Variant = Danger renders the danger surface (@StateDanger)', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const b = new Button();
            b.Variant = ButtonVariant.Danger;
            return b;
        }, { scheme: PragmaticLight });
        // #C24532.
        const danger = ControlHarness.TokenCss('StateDanger');
        assert.equal(danger, 'rgb(194,69,50)');
        assert.ok(svg.includes(danger!), 'Danger paints @StateDanger');
        ControlHarness.Reset();
    });

    test('no grey fallback — every token resolves under Pragmatic', () =>
    {
        const { svg } = ControlHarness.Render(() => new Button(), { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral — an unresolved token would paint the marker');
        ControlHarness.Reset();
    });

    test('Material is unaffected — a Button under Material keeps the Material style', () =>
    {
        const { control, svg } = ControlHarness.Render(() => new Button(), { scheme: MaterialLight });
        // #6750A4 — Material Filled fills with @Primary.
        const primary = ControlHarness.TokenCss('Primary');
        assert.equal(primary, 'rgb(103,80,164)');
        assert.ok(svg.includes(primary!), 'Material Button still paints @Primary');
        assert.ok(!ControlHarness.IsPragmaticStyle(control), 'Material Button does NOT resolve the Pragmatic style');
        ControlHarness.Reset();
    });

    test('focus paints the ring stroke (@BorderFocus)', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const b = new Button();
            b._setIsFocused(true);
            return b;
        }, { scheme: PragmaticLight });
        const borderFocus = ControlHarness.TokenCss('BorderFocus');
        assert.equal(borderFocus, 'rgb(34,130,77)');
        // @ActionPrimary resolves to the SAME rgb() as @BorderFocus, so a
        // bare svg.includes(borderFocus) would pass whether or not the ring
        // painted (the primary fill already contains that colour) — assert
        // the STROKE attribute specifically, which only the focus ring emits.
        assert.ok(svg.includes(`stroke="${borderFocus}"`), 'focused Button paints the @BorderFocus ring stroke');
        ControlHarness.Reset();
    });

    test('renders under PragmaticDark with no grey fallback and paints the dark @BorderFocus ring', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const b = new Button();
            b._setIsFocused(true);
            return b;
        }, { scheme: PragmaticDark });
        const borderFocus = ControlHarness.TokenCss('BorderFocus');
        assert.equal(borderFocus, 'rgb(46,168,98)', '@BorderFocus under PragmaticDark is #2EA862');
        assert.ok(svg.includes(`stroke="${borderFocus}"`), 'focused Button paints the dark @BorderFocus ring stroke');
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral fallback — every token resolves under PragmaticDark');
        ControlHarness.Reset();
    });

    test('fallback intact — the fork is Button-scoped, so ComboBox keeps its Material chrome', () =>
    {
        // The override layer must be purely additive: it may shadow Button
        // and nothing else. If it ever grew a ComboBox entry (or lost its
        // Button entry) this fails — that is the real wiring guard.
        //
        // NB: a cross-theme identity check ("ComboBox resolves the SAME
        // object under Pragmatic and Material") is not possible here — each
        // Theme deep-clones its dictionaries via .Clone(), so every control
        // (Button included) resolves a DIFFERENT object per theme. And a
        // ComboBox has no class-keyed implicit Style at all; it loads chrome
        // from the keyed `DefaultComboBoxSelection` ControlTemplate. So the
        // guard is: PragmaticControls forks only Button, and the Material
        // ComboBox chrome stays reachable under Pragmatic.
        ControlHarness.Activate(PragmaticLight);
        const overrides = Pragmatic.instance.dictionaries.find(d => d instanceof PragmaticControls);
        assert.ok(overrides !== undefined, 'PragmaticControls is wired into the theme');
        assert.notEqual(overrides!.Resolve(Button), undefined, 'the override layer forks Button');
        assert.equal(overrides!.Resolve(ComboBox), undefined, 'the override layer does NOT touch ComboBox');
        // With the fork scoped to Button, an un-forked ComboBox still
        // resolves its Material control template (merged before the fork).
        assert.notEqual(
            Application.ResolveDefaultResource('DefaultComboBoxSelection'), undefined,
            'ComboBox still resolves its Material chrome under Pragmatic');
        ControlHarness.Reset();
    });
});
