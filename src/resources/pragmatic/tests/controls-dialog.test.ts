import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { Dialog } from '../../../framework/surfaces/dialog.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic Dialog', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const d = new Dialog();
        assert.ok(ControlHarness.IsPragmaticStyle(d), 'Dialog uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('Material is unaffected', () =>
    {
        ControlHarness.Activate(MaterialLight);
        const d = new Dialog();
        assert.ok(!ControlHarness.IsPragmaticStyle(d), 'Material Dialog keeps the Material style');
        ControlHarness.Reset();
    });

    test('dialog surface is opaque @Bg1 with a shadow, over a resolvable @Scrim (Review Focus: scrim backdrop legibility)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const d = new Dialog();
        const surface = d.GetTemplateChild('PART_Dialog') as Border;
        assert.equal((surface.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg1'), 'dialog surface is opaque @Bg1');
        assert.notEqual(surface.Effect, undefined, 'dialog carries a shadow so it reads above the scrim');
        assert.equal(ControlHarness.TokenCss('Scrim'), 'rgba(10,10,11,0.4)', '@Scrim resolves to a semi-opaque dark under Pragmatic');
        ControlHarness.Reset();
    });

    test('resolves under dark with the title present', () =>
    {
        ControlHarness.Activate(PragmaticDark);
        const d = new Dialog();
        assert.ok(ControlHarness.IsPragmaticStyle(d), 'Dialog resolves the Pragmatic style under dark');
        assert.notEqual(d.GetTemplateChild('PART_Title'), undefined, 'PART_Title present');
        ControlHarness.Reset();
    });
});
