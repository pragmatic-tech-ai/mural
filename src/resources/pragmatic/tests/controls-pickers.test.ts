import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { DatePicker } from '../../../framework/pickers/date-picker.js';
import { TimePicker } from '../../../framework/pickers/time-picker.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { ControlHarness } from './control-harness.js';

// Wave 5 Task 3 — DatePicker / TimePicker fork. Both apply their template
// headless (ctor calls applyDefaultStyle + adoptParts), and both resolve
// their selected/accent colours in code (date-picker.ts / time-picker.ts
// via TryFindResource) — repointed to the theme-agnostic keys AccentInk /
// AccentInkOn / Ink so the selected cell tracks Pragmatic, not M3 purple.
describe('Pragmatic Pickers — resolution', () =>
{
    for (const entry of [{ Name: 'DatePicker', Make: () => new DatePicker() }, { Name: 'TimePicker', Make: () => new TimePicker() }])
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

describe('Pragmatic Pickers — chrome', () =>
{
    test('DatePicker PART_Root fills @Bg1', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const dp = new DatePicker();
        const root = dp.GetTemplateChild('PART_Root') as Border;
        assert.equal((root.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg1'), 'DatePicker root @Bg1');
        ControlHarness.Reset();
    });

    test('TimePicker PART_Root fills @Bg1', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const tp = new TimePicker();
        const root = tp.GetTemplateChild('PART_Root') as Border;
        assert.equal((root.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg1'), 'TimePicker root @Bg1');
        ControlHarness.Reset();
    });

    test('code-level selection keys resolve to Pragmatic tokens (AccentInk/AccentInkOn/Ink)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const dp = new DatePicker();
        assert.equal((dp.TryFindResource('AccentInk') as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('ControlAccent'), 'AccentInk = @ControlAccent (selected day fill / today ring)');
        assert.equal((dp.TryFindResource('AccentInkOn') as SolidColorBrush).Color.ToCss(), 'rgb(255,255,255)', 'AccentInkOn = white (selected day text)');
        assert.equal((dp.TryFindResource('Ink') as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Fg1'), 'Ink = @Fg1 (normal day text)');
        ControlHarness.Reset();
    });

    test('DatePicker with a selected day renders the @ControlAccent cell and no grey (Review Focus)', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const dp = new DatePicker();
            dp.DisplayMonth = new Date(2026, 8, 1);
            dp.SelectedDate = new Date(2026, 8, 15);
            return dp;
        }, { scheme: PragmaticLight });
        const accent = ControlHarness.TokenCss('ControlAccent');
        assert.ok(svg.includes(`fill="${accent}"`), 'selected day paints the @ControlAccent cell');
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080 — every token resolves');
        ControlHarness.Reset();
    });

    test('TimePicker renders with no grey fallback', () =>
    {
        const { svg } = ControlHarness.Render(() => new TimePicker(), { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080');
        ControlHarness.Reset();
    });
});
