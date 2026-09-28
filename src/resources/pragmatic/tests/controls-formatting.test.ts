import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { ColorPicker } from '../../../framework/formatting/color-picker.js';
import { PragmaticLight } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

// Wave 5 Task 6 — formatting foundation. color-picker.ts resolved the swatch
// ring accent and the scheme-row hover by the M3 string keys 'Primary' and
// 'StateHoverOverlay', which don't exist under Pragmatic (fell back to a
// hardcoded brush). Repointed to the theme-agnostic keys AccentInk /
// RowHoverFill so both track the active scheme. This pins the resource chain
// the code now relies on, per theme.
describe('Pragmatic ColorPicker — code-level token resolution', () =>
{
    test('under Pragmatic: AccentInk = @ControlAccent, RowHoverFill = @Bg2', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const cp = new ColorPicker();
        assert.equal((cp.TryFindResource('AccentInk') as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('ControlAccent'), 'swatch ring accent tracks @ControlAccent');
        assert.equal((cp.TryFindResource('RowHoverFill') as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg2'), 'scheme-row hover tracks @Bg2');
        ControlHarness.Reset();
    });

    test('under Material: AccentInk = @Primary, RowHoverFill = @StateHoverOverlay (byte-identical)', () =>
    {
        ControlHarness.Activate(MaterialLight);
        const cp = new ColorPicker();
        assert.equal((cp.TryFindResource('AccentInk') as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Primary'), 'Material swatch ring keeps @Primary');
        assert.equal((cp.TryFindResource('RowHoverFill') as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('StateHoverOverlay'), 'Material scheme-row hover keeps @StateHoverOverlay');
        ControlHarness.Reset();
    });
});
