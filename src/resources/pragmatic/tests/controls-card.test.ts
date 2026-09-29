import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { Card, CardVariant } from '../../../framework/surfaces/card.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic Card', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const c = new Card();
        assert.ok(ControlHarness.IsPragmaticStyle(c), 'Card uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('Filled card fills @Bg2 with no border', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const c = new Card();
        const border = c.GetTemplateChild('PART_Border') as Border;
        assert.equal((border.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg2'), 'Filled card fills @Bg2');
        ControlHarness.Reset();
    });

    test('Elevated card fills @Bg1 and carries a resting shadow', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const c = new Card();
        c.Variant = CardVariant.Elevated;
        const border = c.GetTemplateChild('PART_Border') as Border;
        assert.equal((border.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg1'), 'Elevated card fills @Bg1');
        assert.notEqual(border.Effect, undefined, 'Elevated card carries a resting shadow Effect');
        ControlHarness.Reset();
    });

    test('Outlined card strokes @BorderStrong', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const c = new Card();
            c.Variant = CardVariant.Outlined;
            return c;
        }, { scheme: PragmaticLight });
        const strong = ControlHarness.TokenCss('BorderStrong');
        assert.ok(svg.includes(`stroke="${strong}"`), 'Outlined card strokes @BorderStrong');
        ControlHarness.Reset();
    });

    test('hover steps the state layer surface', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const c = new Card();
        const layer = c.GetTemplateChild('PART_StateLayer') as Border;
        c._setIsMouseOver(true);
        assert.equal((layer.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg3'), 'hovered Filled card steps @Bg3');
        ControlHarness.Reset();
    });

    test('no grey fallback under Pragmatic, and renders under dark', () =>
    {
        const { svg } = ControlHarness.Render(() => new Card(), { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080 — every token resolves');
        const dark = ControlHarness.Render(() => new Card(), { scheme: PragmaticDark });
        assert.ok(!dark.svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080 under PragmaticDark');
        ControlHarness.Reset();
    });
});
