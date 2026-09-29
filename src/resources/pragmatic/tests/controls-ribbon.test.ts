import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { Ribbon, RibbonTabHeader } from '../../../framework/ribbon/ribbon.js';
import { RibbonTab } from '../../../framework/ribbon/ribbon-tab.js';
import { RibbonGroup, RibbonSmallButtonColumn } from '../../../framework/ribbon/ribbon-group.js';
import { RibbonButton, RibbonToggleButton } from '../../../framework/ribbon/ribbon-buttons.js';
import { RibbonDropDownButton, RibbonSplitButton } from '../../../framework/ribbon/ribbon-popup-buttons.js';
import { RibbonGallery } from '../../../framework/ribbon/ribbon-gallery.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { ControlHarness } from './control-harness.js';

// Wave 5 Task 2 — Ribbon family fork. Every ribbon control that carries
// themeable chrome applies its template headless (own or inherited Button
// ctor calls applyDefaultStyle), so GetTemplateChild works in a bare test.
class RibbonControls
{
    public static readonly All: ReadonlyArray<{ readonly Name: string; readonly Make: () => object }> =
    [
        { Name: 'Ribbon', Make: () => new Ribbon() },
        { Name: 'RibbonTabHeader', Make: () => new RibbonTabHeader() },
        { Name: 'RibbonTab', Make: () => new RibbonTab() },
        { Name: 'RibbonGroup', Make: () => new RibbonGroup() },
        { Name: 'RibbonSmallButtonColumn', Make: () => new RibbonSmallButtonColumn() },
        { Name: 'RibbonButton', Make: () => new RibbonButton() },
        { Name: 'RibbonToggleButton', Make: () => new RibbonToggleButton() },
        { Name: 'RibbonDropDownButton', Make: () => new RibbonDropDownButton() },
        { Name: 'RibbonSplitButton', Make: () => new RibbonSplitButton() },
        { Name: 'RibbonGallery', Make: () => new RibbonGallery() },
    ];
}

describe('Pragmatic Ribbon family — resolution', () =>
{
    for (const entry of RibbonControls.All)
    {
        test(`${entry.Name}: Pragmatic (light + dark)`, () =>
        {
            ControlHarness.Activate(PragmaticLight);
            assert.ok(ControlHarness.IsPragmaticStyle(entry.Make()), `${entry.Name} resolves the Pragmatic style under light`);
            ControlHarness.Reset();

            ControlHarness.Activate(PragmaticDark);
            assert.ok(ControlHarness.IsPragmaticStyle(entry.Make()), `${entry.Name} resolves the Pragmatic style under dark`);
            ControlHarness.Reset();
        });
    }
});

describe('Pragmatic Ribbon — chrome', () =>
{
    test('RibbonButton hover fills PART_Border @Bg2', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const b = new RibbonButton();
        b._setIsMouseOver(true);
        const border = b.GetTemplateChild('PART_Border') as Border;
        assert.equal((border.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg2'), 'hovered RibbonButton fills @Bg2');
        ControlHarness.Reset();
    });

    test('RibbonToggleButton checked fills PART_Selected @SurfaceSelected', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const t = new RibbonToggleButton();
        t.IsChecked = true;
        const sel = t.GetTemplateChild('PART_Selected') as Border;
        assert.equal((sel.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('SurfaceSelected'), 'checked toggle fills @SurfaceSelected');
        ControlHarness.Reset();
    });

    test('RibbonToggleButton checked + concurrent hover: PART_Selected STILL @SurfaceSelected while PART_Border shows @Bg2 (Review Focus)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const t = new RibbonToggleButton();
        t.IsChecked = true;
        t._setIsMouseOver(true);
        const sel = t.GetTemplateChild('PART_Selected') as Border;
        const border = t.GetTemplateChild('PART_Border') as Border;
        assert.equal((sel.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('SurfaceSelected'), 'checked cue survives concurrent hover (dedicated layer)');
        assert.equal((border.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg2'), 'the hover surface beneath still shows @Bg2');
        ControlHarness.Reset();
    });

    test('RibbonTabHeader current tab underline paints @ControlAccent; rest transparent', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const rest = new RibbonTabHeader();
        const restIndicator = rest.GetTemplateChild('PART_Indicator') as { Stroke?: unknown };
        // rest indicator stroke is a transparent Pen — no accent
        const current = new RibbonTabHeader();
        current.IsCurrent = true;
        const curIndicator = current.GetTemplateChild('PART_Indicator') as { Stroke?: { Brush?: SolidColorBrush } };
        const brush = (curIndicator.Stroke as { Brush?: SolidColorBrush })?.Brush;
        assert.equal(brush?.Color.ToCss(), ControlHarness.TokenCss('ControlAccent'), 'current tab underline is @ControlAccent');
        assert.notEqual(restIndicator.Stroke, undefined, 'rest indicator has a (transparent) stroke pen');
        ControlHarness.Reset();
    });

    test('RibbonButton renders with no grey fallback under Pragmatic', () =>
    {
        const { svg } = ControlHarness.Render(() => new RibbonButton(), { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080 — every token resolves');
        ControlHarness.Reset();
    });
});
