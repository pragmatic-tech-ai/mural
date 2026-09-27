import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { Drawer } from '../../../framework/surfaces/drawer.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic Drawer', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const d = new Drawer();
        assert.ok(ControlHarness.IsPragmaticStyle(d), 'Drawer uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('Material is unaffected', () =>
    {
        ControlHarness.Activate(MaterialLight);
        const d = new Drawer();
        assert.ok(!ControlHarness.IsPragmaticStyle(d), 'Material Drawer keeps the Material style');
        ControlHarness.Reset();
    });

    test('pane fills @Bg2 with a @Border edge', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const d = new Drawer();
        const pane = d.GetTemplateChild('PART_Pane') as Border;
        assert.equal((pane.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg2'), 'drawer pane fills @Bg2');
        ControlHarness.Reset();
    });

    test('resolves the Pragmatic style under dark', () =>
    {
        ControlHarness.Activate(PragmaticDark);
        const d = new Drawer();
        assert.ok(ControlHarness.IsPragmaticStyle(d), 'Drawer resolves the Pragmatic style under dark');
        ControlHarness.Reset();
    });
});
