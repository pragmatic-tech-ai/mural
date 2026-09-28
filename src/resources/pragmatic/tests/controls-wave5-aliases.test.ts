import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight, MaterialDark } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

// Wave 5 Task 1: three theme-agnostic semantic aliases, following the
// @Ink / @AccentInk / @ControlTrack convention. They let code that resolves
// theme colours by string (color-picker.ts row hover; diagram-settings.ts
// THEME_LINK) stay theme-neutral: each alias is a literal copy of the
// scheme's own backing token (kept in sync by this test, not a live ref).
//   @RowHoverFill : Material @StateHoverOverlay / Pragmatic @Bg2
//   @InkVariant   : Material @OnSurfaceVariant  / Pragmatic @Fg2
//   @SurfaceBg    : Material @Surface           / Pragmatic @Bg1
describe('Wave 5 semantic aliases (RowHoverFill / InkVariant / SurfaceBg)', () =>
{
    test('MaterialLight: aliases equal their M3 backing tokens (byte-identical)', () =>
    {
        ControlHarness.Activate(MaterialLight);
        assert.equal(ControlHarness.TokenCss('RowHoverFill'), ControlHarness.TokenCss('StateHoverOverlay'), '@RowHoverFill == @StateHoverOverlay');
        assert.equal(ControlHarness.TokenCss('InkVariant'), ControlHarness.TokenCss('OnSurfaceVariant'), '@InkVariant == @OnSurfaceVariant');
        assert.equal(ControlHarness.TokenCss('SurfaceBg'), ControlHarness.TokenCss('Surface'), '@SurfaceBg == @Surface');
        ControlHarness.Reset();
    });

    test('MaterialDark: aliases track the dark M3 values', () =>
    {
        ControlHarness.Activate(MaterialDark);
        assert.equal(ControlHarness.TokenCss('RowHoverFill'), ControlHarness.TokenCss('StateHoverOverlay'));
        assert.equal(ControlHarness.TokenCss('InkVariant'), ControlHarness.TokenCss('OnSurfaceVariant'));
        assert.equal(ControlHarness.TokenCss('SurfaceBg'), ControlHarness.TokenCss('Surface'));
        ControlHarness.Reset();
    });

    test('PragmaticLight: @RowHoverFill=@Bg2, @InkVariant=@Fg2, @SurfaceBg=@Bg1', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.equal(ControlHarness.TokenCss('RowHoverFill'), 'rgb(244,244,242)', '@RowHoverFill == @Bg2 (#F4F4F2)');
        assert.equal(ControlHarness.TokenCss('RowHoverFill'), ControlHarness.TokenCss('Bg2'));
        assert.equal(ControlHarness.TokenCss('InkVariant'), ControlHarness.TokenCss('Fg2'), '@InkVariant == @Fg2');
        assert.equal(ControlHarness.TokenCss('SurfaceBg'), ControlHarness.TokenCss('Bg1'), '@SurfaceBg == @Bg1');
        ControlHarness.Reset();
    });

    test('PragmaticDark: aliases track the dark Pragmatic values', () =>
    {
        ControlHarness.Activate(PragmaticDark);
        assert.equal(ControlHarness.TokenCss('RowHoverFill'), ControlHarness.TokenCss('Bg2'));
        assert.equal(ControlHarness.TokenCss('InkVariant'), ControlHarness.TokenCss('Fg2'));
        assert.equal(ControlHarness.TokenCss('SurfaceBg'), ControlHarness.TokenCss('Bg1'));
        ControlHarness.Reset();
    });
});
