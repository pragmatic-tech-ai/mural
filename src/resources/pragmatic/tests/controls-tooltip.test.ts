import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { TextBlock } from '../../../basic/text-block.js';
import { Tooltip } from '../../../framework/tooltips/tooltip.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic Tooltip', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const t = new Tooltip();
        assert.ok(ControlHarness.IsPragmaticStyle(t), 'Tooltip uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('Material is unaffected', () =>
    {
        ControlHarness.Activate(MaterialLight);
        const t = new Tooltip();
        assert.ok(!ControlHarness.IsPragmaticStyle(t), 'Material Tooltip keeps the Material style');
        ControlHarness.Reset();
    });

    test('inverse surface: @FgInverse ink over @BgInverse backdrop (Review Focus: string legibility)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const t = new Tooltip();
        assert.equal(ControlHarness.TokenCss('BgInverse'), 'rgb(10,10,11)', '@BgInverse backdrop');
        assert.equal(ControlHarness.TokenCss('FgInverse'), 'rgb(250,250,249)', '@FgInverse ink');
        // The control-level inherited Foreground is not materialized on a bare
        // headless Tooltip, so verify the inverse ink via the template's
        // PART_Shortcut element, which the fork wires to @FgInverse (Ruling in ledger).
        const shortcut = t.GetTemplateChild('PART_Shortcut') as TextBlock;
        assert.equal((shortcut.Foreground as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('FgInverse'), 'Tooltip ink is @FgInverse so it is legible on the inverse backdrop');
        ControlHarness.Reset();
    });

    test('resolves under dark with resolvable ink', () =>
    {
        ControlHarness.Activate(PragmaticDark);
        const t = new Tooltip();
        assert.ok(ControlHarness.IsPragmaticStyle(t), 'Tooltip resolves the Pragmatic style under dark');
        const shortcut = t.GetTemplateChild('PART_Shortcut') as TextBlock;
        assert.notEqual(shortcut.Foreground, undefined, 'Tooltip ink resolves under dark');
        ControlHarness.Reset();
    });
});
