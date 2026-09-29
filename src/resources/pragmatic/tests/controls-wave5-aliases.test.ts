import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { ControlHarness } from './control-harness.js';

// Wave 5 Task 1: three theme-agnostic semantic aliases, following the
// @Ink / @AccentInk / @ControlTrack convention. They let code that resolves
// theme colours by string (color-picker.ts row hover; diagram-settings.ts
// THEME_LINK) stay theme-neutral: each alias is a literal copy of the
// scheme's own backing token (kept in sync by this test, not a live ref).
//   @RowHoverFill : Pragmatic @Bg2
//   @InkVariant   : Pragmatic @Fg2
//   @SurfaceBg    : Pragmatic @Bg1
describe('Wave 5 semantic aliases (RowHoverFill / InkVariant / SurfaceBg)', () =>
{
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
