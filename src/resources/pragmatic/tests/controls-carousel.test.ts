import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { Carousel } from '../../../framework/carousel/carousel.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { ControlHarness } from './control-harness.js';

// Wave 5 Task 4 — Carousel fork (resources PragmaticCarousels). Applies its
// template headless (ctor applyDefaultStyle + adoptParts). Only two tokens:
// PART_Root @Surface->@Bg1, chevrons @OnSurfaceVariant->@Fg2.
describe('Pragmatic Carousel', () =>
{
    test('resolves the Pragmatic style', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.ok(ControlHarness.IsPragmaticStyle(new Carousel()), 'Carousel Pragmatic light');
        ControlHarness.Reset();
        ControlHarness.Activate(PragmaticDark);
        assert.ok(ControlHarness.IsPragmaticStyle(new Carousel()), 'Carousel Pragmatic dark');
        ControlHarness.Reset();
    });

    test('PART_Root fills @Bg1', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const c = new Carousel();
        const root = c.GetTemplateChild('PART_Root') as Border;
        assert.equal((root.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg1'), 'carousel root @Bg1');
        ControlHarness.Reset();
    });

    test('renders with no grey fallback', () =>
    {
        const { svg } = ControlHarness.Render(() => new Carousel(), { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080');
        ControlHarness.Reset();
    });
});
