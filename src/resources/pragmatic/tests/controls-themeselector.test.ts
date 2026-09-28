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

    test('icon glyph foreground resolves @Fg2 (no grey)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.equal(ControlHarness.TokenCss('Fg2'), 'rgb(95,92,86)', '@Fg2 resolves for the icon glyphs');
        assert.notEqual(ControlHarness.TokenCss('Fg2'), ControlHarness.NeutralFallbackCss, 'not the grey fallback');
        ControlHarness.Reset();
    });
});
