import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application, ThemeManager } from '../../../runtime/index.js';
import { Button, ButtonVariant } from '../../../framework/buttons/button.js';
import { ComboBox } from '../../../framework/list/combo-box.js';
import { PragmaticLight } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

function reset(): void
{
    ThemeManager._resetForTesting();
    Application.current = undefined;
}

describe('Pragmatic Button', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        const { control } = ControlHarness.Render(() => new Button(), { scheme: PragmaticLight });
        // The Pragmatic primary template fills with @ActionPrimary; the
        // resolved implicit style is the PragmaticControls one (identity).
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'Button uses the Pragmatic override style');
        reset();
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
        reset();
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
        reset();
    });

    test('no grey fallback — every token resolves under Pragmatic', () =>
    {
        const { svg } = ControlHarness.Render(() => new Button(), { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral — an unresolved token would paint the marker');
        reset();
    });

    test('Material is unaffected — a Button under Material keeps the Material style', () =>
    {
        const { control, svg } = ControlHarness.Render(() => new Button(), { scheme: MaterialLight });
        // #6750A4 — Material Filled fills with @Primary.
        const primary = ControlHarness.TokenCss('Primary');
        assert.equal(primary, 'rgb(103,80,164)');
        assert.ok(svg.includes(primary!), 'Material Button still paints @Primary');
        assert.ok(!ControlHarness.IsPragmaticStyle(control), 'Material Button does NOT resolve the Pragmatic style');
        reset();
    });

    test('fallback intact — an un-forked control (ComboBox) still resolves its Material style under Pragmatic', () =>
    {
        // Resolution-only check — a bare ComboBox needn't paint. Activate
        // Pragmatic, then confirm the un-forked ComboBox still resolves its
        // Material chrome: PragmaticControls forks only Button, so every
        // other control falls through to the Material dictionaries merged
        // before it. ComboBox loads its chrome from a keyed ControlTemplate
        // (via Application.ResolveDefaultResource), so that is what we probe.
        ControlHarness.Activate(PragmaticLight);
        const combo = new ComboBox();
        assert.notEqual(
            Application.ResolveDefaultResource('DefaultComboBoxSelection'), undefined,
            'ComboBox still resolves its (Material) control template under Pragmatic');
        assert.ok(!ControlHarness.IsPragmaticStyle(combo), 'ComboBox is not a Pragmatic-forked control');
        reset();
    });
});
