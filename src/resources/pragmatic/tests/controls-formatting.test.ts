import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { ColorPicker } from '../../../framework/formatting/color-picker.js';
import { BrushPicker } from '../../../framework/formatting/brush-picker.js';
import { FillEditor } from '../../../framework/formatting/fill-editor.js';
import { PenEditor } from '../../../framework/formatting/pen-editor.js';
import { ShapeFormatControl } from '../../../framework/formatting/shape-format-control.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { ControlHarness } from './control-harness.js';

// Wave 5 Task 6 — formatting foundation. color-picker.ts resolved the swatch
// ring accent and the scheme-row hover by the M3 string keys 'Primary' and
// 'StateHoverOverlay', which don't exist under Pragmatic (fell back to a
// hardcoded brush). Repointed to the theme-agnostic keys AccentInk /
// RowHoverFill so both track the active scheme, per theme.
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
});

// Wave 5 Tasks 7–8 — formatting templates (all 5 editors, resources
// PragmaticFormatting). Every TemplatedControl applies its template headless.
class FormattingControls
{
    public static readonly All: ReadonlyArray<{ readonly Name: string; readonly Make: () => object }> =
    [
        { Name: 'ColorPicker', Make: () => new ColorPicker() },
        { Name: 'BrushPicker', Make: () => new BrushPicker() },
        { Name: 'FillEditor', Make: () => new FillEditor() },
        { Name: 'PenEditor', Make: () => new PenEditor() },
        { Name: 'ShapeFormatControl', Make: () => new ShapeFormatControl() },
    ];
}

describe('Pragmatic Formatting editors — resolution', () =>
{
    for (const entry of FormattingControls.All)
    {
        test(`${entry.Name}: Pragmatic (light + dark)`, () =>
        {
            ControlHarness.Activate(PragmaticLight);
            assert.ok(ControlHarness.IsPragmaticStyle(entry.Make()), `${entry.Name} Pragmatic light`);
            ControlHarness.Reset();
            ControlHarness.Activate(PragmaticDark);
            assert.ok(ControlHarness.IsPragmaticStyle(entry.Make()), `${entry.Name} Pragmatic dark`);
            ControlHarness.Reset();
        });
    }
});

// The static (non-trigger, non-popup) template parts are reachable via
// GetTemplateChild. The variant-driven tab/body chrome (Style triggers) and
// the service-mounted popups need a render/measure pass that crashes headless
// on these controls' embedded TextBoxes, so they are gated on IsPragmaticStyle
// above + the byte-faithful transcription (Ruling in ledger), not asserted here.
describe('Pragmatic Formatting editors — chrome', () =>
{
    test('ColorPicker closed trigger fills @Bg1', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const cp = new ColorPicker();
        const trigger = cp.GetTemplateChild('PART_SelectionTrigger') as Border;
        assert.equal((trigger.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg1'), 'ColorPicker trigger @Bg1');
        ControlHarness.Reset();
    });

    test('ColorPicker chevron paints @Fg2', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const cp = new ColorPicker();
        const chevron = cp.GetTemplateChild('PART_Chevron') as { Fill?: SolidColorBrush };
        assert.equal((chevron.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Fg2'), 'ColorPicker chevron @Fg2');
        ControlHarness.Reset();
    });

    test('FillEditor section header ink is @Fg1 (reachable static part)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const fe = new FillEditor();
        const header = fe.GetTemplateChild('PART_Header') as { Foreground?: SolidColorBrush };
        assert.equal((header.Foreground as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Fg1'), 'FillEditor header ink @Fg1');
        ControlHarness.Reset();
    });
});
