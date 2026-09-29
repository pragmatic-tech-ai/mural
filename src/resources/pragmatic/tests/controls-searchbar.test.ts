import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush, Pen } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { SearchBar } from '../../../framework/search-bar/search-bar.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic SearchBar', () =>
{
    test('resolves the Pragmatic style under Pragmatic (Light + Dark)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.ok(ControlHarness.IsPragmaticStyle(new SearchBar()), 'SearchBar resolves under PragmaticLight');
        ControlHarness.Reset();

        ControlHarness.Activate(PragmaticDark);
        assert.ok(ControlHarness.IsPragmaticStyle(new SearchBar()), 'SearchBar resolves under PragmaticDark');
        ControlHarness.Reset();
    });

    // SearchBar wraps a TextBox — an input, so (per the Wave-1/3 precedent)
    // its template materializes at construction under an active
    // Application; PART_Border should be reachable via GetTemplateChild
    // without a full Render/paint pass (mirrors controls-topappbar.test.ts).
    test('PART_Border rests at @Bg2 (Review Focus)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const sb = new SearchBar();
        const border = sb.GetTemplateChild('PART_Border') as Border | undefined;
        assert.notEqual(border, undefined, 'PART_Border is reachable via GetTemplateChild');
        assert.ok(border!.Fill instanceof SolidColorBrush, 'PART_Border resolves a fill');
        assert.equal((border!.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg2'), 'rest field fills @Bg2');
        ControlHarness.Reset();
    });

    test('hover steps the fill to @Bg1', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const sb = new SearchBar();
        sb._setIsMouseOver(true);
        const border = sb.GetTemplateChild('PART_Border') as Border;
        assert.equal((border.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg1'), 'hovered field steps to @Bg1');
        ControlHarness.Reset();
    });

    // Delta beyond a plain token swap: Material's SearchBar has no focus
    // ring at all (rest Stroke is transparent, and neither `when` clause
    // touches it). The Pragmatic fork adds one — rest @BorderStrong 1dp,
    // focus @BorderFocus 2dp — the same pattern Wave 1 established for
    // TextBox (framework/pragmatic/inputs/textbox.template.mu).
    test('focus paints the @BorderFocus ring (delta: Material has none here)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const sb = new SearchBar();
        const border = sb.GetTemplateChild('PART_Border') as Border;

        assert.ok(border.Stroke instanceof Pen, 'rest PART_Border.Stroke is a Pen');
        assert.equal(((border.Stroke as Pen).Brush as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('BorderStrong'),
            'rest ring is @BorderStrong');

        sb._setIsFocused(true);
        assert.ok(border.Stroke instanceof Pen, 'focused PART_Border.Stroke is a Pen');
        assert.equal(((border.Stroke as Pen).Brush as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('BorderFocus'),
            'focused ring is @BorderFocus');
        assert.equal((border.Stroke as Pen).Thickness, 2, 'focused ring thickens to 2dp');
        assert.equal((border.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg1'), 'focused field also steps to @Bg1');
        ControlHarness.Reset();
    });

    test('field ink is @Fg1, selection is @TextSelectionBg', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const sb = new SearchBar();
        const fg1 = ControlHarness.TokenCss('Fg1');
        const selectionBg = ControlHarness.TokenCss('TextSelectionBg');
        assert.ok(sb.Foreground instanceof SolidColorBrush, 'SearchBar resolves a Foreground brush');
        assert.equal((sb.Foreground as SolidColorBrush).Color.ToCss(), fg1, 'Foreground is @Fg1');
        assert.ok(sb.CaretBrush instanceof SolidColorBrush, 'SearchBar resolves a CaretBrush');
        assert.equal((sb.CaretBrush as SolidColorBrush).Color.ToCss(), fg1, 'CaretBrush is @Fg1');
        assert.ok(sb.SelectionBrush instanceof SolidColorBrush, 'SearchBar resolves a SelectionBrush');
        assert.equal((sb.SelectionBrush as SolidColorBrush).Color.ToCss(), selectionBg, 'SelectionBrush is @TextSelectionBg');
        ControlHarness.Reset();
    });

    test('renders under PragmaticDark with no grey fallback', () =>
    {
        const { svg } = ControlHarness.Render(() => new SearchBar(), { scheme: PragmaticDark });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral fallback — every token resolves under PragmaticDark');
        ControlHarness.Reset();
    });
});
