import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DiagramSettings } from '../../../framework/diagram/diagram-settings.js';
import { PragmaticLight } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

// Wave 5 Task 9 — diagram chrome painted in TS via DiagramSettings.THEME_LINK,
// which resolved M3 token names by string ('OnSurface'/'OnSurfaceVariant'/
// 'Surface'/'Primary') that don't exist under Pragmatic (fell back to the
// compiled default). Repointed to the theme-agnostic keys Ink/InkVariant/
// SurfaceBg/AccentInk so diagram chrome tracks the active scheme, unchanged
// under Material (agnostic keys = the M3 tokens there).
describe('Pragmatic diagram chrome — THEME_LINK theme-tracking', () =>
{
    test('under Pragmatic: chrome colours track the Pragmatic scheme (Review Focus)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.equal(DiagramSettings.ShapeLabelInk().Color.ToCss(), ControlHarness.TokenCss('Fg1'), 'shape-label ink = @Fg1 (Ink)');
        assert.equal(DiagramSettings.ConnectorDefaultStroke().Color.ToCss(), ControlHarness.TokenCss('Fg2'), 'connector stroke = @Fg2 (InkVariant)');
        assert.equal(DiagramSettings.RulerFill().Color.ToCss(), ControlHarness.TokenCss('Bg1'), 'ruler fill = @Bg1 (SurfaceBg)');
        assert.equal(DiagramSettings.RulerTickColor().Color.ToCss(), ControlHarness.TokenCss('Fg2'), 'ruler tick = @Fg2 (InkVariant)');
        // Container wash is AccentInk @ ~11% — RGB tracks @ControlAccent (alpha aside).
        const accentRgb = (ControlHarness.TokenCss('ControlAccent') ?? '').replace('rgb(', '').replace(')', '');
        assert.ok(DiagramSettings.ContainerDefaultFill().Color.ToCss().includes(accentRgb), 'container wash RGB tracks @ControlAccent (AccentInk)');
        ControlHarness.Reset();
    });

    test('under Material: THEME_LINK still resolves the original M3 values (byte-identical)', () =>
    {
        ControlHarness.Activate(MaterialLight);
        assert.equal(DiagramSettings.ShapeLabelInk().Color.ToCss(), ControlHarness.TokenCss('OnSurface'), 'Material shape-label ink = @OnSurface');
        assert.equal(DiagramSettings.ConnectorDefaultStroke().Color.ToCss(), ControlHarness.TokenCss('OnSurfaceVariant'), 'Material connector = @OnSurfaceVariant');
        assert.equal(DiagramSettings.RulerFill().Color.ToCss(), ControlHarness.TokenCss('Surface'), 'Material ruler fill = @Surface');
        ControlHarness.Reset();
    });
});
