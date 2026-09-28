import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ThemeSelector } from '../../../framework/theme-selector/theme-selector.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

// Wave 5 Task 5 — ThemeSelector fork (resources PragmaticThemeSelectors).
// Retokenize only: icon glyphs @LabelLarge->@UiLabel, @OnSurfaceVariant->@Fg2.
// The two inner ComboBoxes inherit the already-forked PragmaticComboBox. The
// spec's Custom-seed / makeDynamicScheme retirement is a .ts feature removal
// (decoupled from this template) and is deferred as a user-facing decision.
describe('Pragmatic ThemeSelector', () =>
{
    test('resolves the Pragmatic style; Material unaffected', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.ok(ControlHarness.IsPragmaticStyle(new ThemeSelector()), 'ThemeSelector Pragmatic light');
        ControlHarness.Reset();
        ControlHarness.Activate(PragmaticDark);
        assert.ok(ControlHarness.IsPragmaticStyle(new ThemeSelector()), 'ThemeSelector Pragmatic dark');
        ControlHarness.Reset();
        ControlHarness.Activate(MaterialLight);
        assert.ok(!ControlHarness.IsPragmaticStyle(new ThemeSelector()), 'ThemeSelector Material');
        ControlHarness.Reset();
    });

    test('renders with no grey fallback (icon glyphs resolve @Fg2)', () =>
    {
        const { svg } = ControlHarness.Render(() => new ThemeSelector(), { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080 — every ThemeSelector token resolves');
        assert.ok(svg.includes(`fill="${ControlHarness.TokenCss('Fg2')}"`), 'icon glyphs paint @Fg2');
        ControlHarness.Reset();
    });
});
