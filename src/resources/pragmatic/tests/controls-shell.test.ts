import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { TextBlock } from '../../../basic/text-block.js';
import { Line } from '../../../basic/shapes/line.js';
import type { Visual } from '../../../runtime/index.js';
import { EditorShell, ViewerShell, ShellSideContentPane, PanelButton } from '../../../framework/index.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { ControlHarness } from './control-harness.js';

// The shell family (EditorShell / ViewerShell / ShellSideContentPane /
// PanelButton) is heavily service-coupled, but `new EditorShell()` needs no
// bootstrap beyond an active Application: ShellBase.Services falls back to
// `Application.current?.Services ?? new ServiceProvider()`, and every
// default-service registration in EditorShell's ctor is guarded by a
// `has()` opt-out check — the same shape the framework's own
// `src/framework/tests/shell.test.ts` relies on under `initTestApp()`.
// RULING: ControlHarness.Activate(scheme) (fresh Application + ApplyScheme)
// gives the shells exactly that minimal context, so construction is exercised
// directly, with no extra harness needed.
//
// IsPragmaticStyle (a resolution-only check — no template render required)
// is the primary assertion for all four controls, per the brief: these
// controls are constructed and immediately style-checked, not deeply
// exercised. PanelButton is the one part of this family whose template DOES
// apply headlessly and expose a reachable PART (Button's ctor calls
// applyDefaultStyle() unconditionally, and the Pragmatic icon-button
// template — @DefaultIconButton — names PART_FocusRing/PART_Root/PART_Content,
// unlike Material's PART_Border/PART_StateLayer chain), so PanelButton also
// gets a direct fork-decision assertion: PART_Root's CornerRadius resolves to
// @RadiusMd (6) via the Style's `Template = @DefaultIconButton; CornerRadius
// = @RadiusMd;` delta. EditorShell / ViewerShell / ShellSideContentPane DO
// apply their templates headlessly too (they are TemplatedControl-derived
// and call applyDefaultStyle() in their own ctors, same as the framework's
// own shell.test.ts), so this suite also pins the @Bg1/@Bg2/@Border surface
// tokens directly off their materialised template parts, rather than relying
// on IsPragmaticStyle alone.
describe('Pragmatic Shell family', () =>
{
    // EditorShell's ctor registers ApplicationSettings, whose own ctor
    // unconditionally schedules a microtask (queueMicrotask —
    // scheduleAvailabilityNotify, application-settings-service.ts) to announce
    // ISettingSource availability. Left unflushed, that microtask fires AFTER
    // this test function returns and ControlHarness.Reset() has already
    // nulled Application.current, throwing on the next test's teardown. The
    // framework's own shell tests hit the same shape and flush it the same
    // way (src/framework/tests/shell.test.ts: `await Promise.resolve();
    // await Promise.resolve();` right after construction, before any Reset).
    test('resolves the Pragmatic style under light + dark', async () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.ok(ControlHarness.IsPragmaticStyle(new EditorShell()), 'EditorShell Pragmatic (light)');
        assert.ok(ControlHarness.IsPragmaticStyle(new ViewerShell()), 'ViewerShell Pragmatic (light)');
        assert.ok(ControlHarness.IsPragmaticStyle(new ShellSideContentPane()), 'ShellSideContentPane Pragmatic (light)');
        assert.ok(ControlHarness.IsPragmaticStyle(new PanelButton()), 'PanelButton Pragmatic (light)');
        await Promise.resolve(); await Promise.resolve();
        ControlHarness.Reset();

        ControlHarness.Activate(PragmaticDark);
        assert.ok(ControlHarness.IsPragmaticStyle(new EditorShell()), 'EditorShell Pragmatic (dark)');
        assert.ok(ControlHarness.IsPragmaticStyle(new ViewerShell()), 'ViewerShell Pragmatic (dark)');
        assert.ok(ControlHarness.IsPragmaticStyle(new ShellSideContentPane()), 'ShellSideContentPane Pragmatic (dark)');
        assert.ok(ControlHarness.IsPragmaticStyle(new PanelButton()), 'PanelButton Pragmatic (dark)');
        await Promise.resolve(); await Promise.resolve();
        ControlHarness.Reset();
    });

    test('EditorShell root Border and PART_CommandHost fill @Bg1', async () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const shell = new EditorShell();
        const root = shell.visualChildren[0] as Border;
        assert.ok(root instanceof Border, 'template root is a Border');
        assert.equal((root.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg1'), 'EditorShell root fills @Bg1');

        const commandHost = root.FindName('PART_CommandHost') as Border;
        assert.equal((commandHost.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg1'), 'PART_CommandHost fills @Bg1');
        await Promise.resolve(); await Promise.resolve();
        ControlHarness.Reset();
    });

    test('ViewerShell root Border fills @Bg1', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const shell = new ViewerShell();
        const root = shell.visualChildren[0] as Border;
        assert.equal((root.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg1'), 'ViewerShell root fills @Bg1');
        ControlHarness.Reset();
    });

    test('ShellSideContentPane fills @Bg2 (Style default Fill)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const pane = new ShellSideContentPane();
        const root = pane.visualChildren[0] as Border;
        assert.equal((root.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg2'), 'pane chrome fills @Bg2');
        ControlHarness.Reset();
    });

    test('EditorShell command-host bottom rule strokes @Border', async () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const shell = new EditorShell();
        const root = shell.visualChildren[0] as Border;
        const commandHost = root.FindName('PART_CommandHost') as Border;
        const line = ControlsShellTestHelper.FindFirstLine(commandHost);
        assert.ok(line !== undefined, 'command-host bottom rule Line found');
        assert.equal((line!.Stroke!.Brush as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Border'), 'bottom rule strokes @Border');
        await Promise.resolve(); await Promise.resolve();
        ControlHarness.Reset();
    });

    test('ShellSideContentPane header bottom rule strokes @Border', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const pane = new ShellSideContentPane();
        const root = pane.visualChildren[0]!;
        const header = root.FindName('PART_Header')!;
        const line = ControlsShellTestHelper.FindFirstLine(header);
        assert.ok(line !== undefined, 'side-pane header bottom rule Line found');
        assert.equal((line!.Stroke!.Brush as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Border'), 'header rule strokes @Border');
        ControlHarness.Reset();
    });

    test('ShellSideContentPane title uses @UiLabel + @Fg2 (Review Focus: token-driven title chrome)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const pane = new ShellSideContentPane();
        const root = pane.visualChildren[0]!;
        const title = root.FindName('PART_Title') as TextBlock;
        assert.equal((title.Foreground as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Fg2'), 'title paints @Fg2');
        ControlHarness.Reset();
    });

    test('PanelButton — CornerRadius resolves @RadiusMd (6) on the Pragmatic template root', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const btn = new PanelButton();
        const root = btn.GetTemplateChild('PART_Root') as Border;
        assert.ok(root instanceof Border, 'Pragmatic @DefaultIconButton names its surface PART_Root');
        assert.equal(root.CornerRadius, ControlsShellTestHelper.RadiusMd, 'PART_Root rides $$CornerRadius = @RadiusMd from the PanelButton Style delta');
        ControlHarness.Reset();
    });

    test('no grey fallback under Pragmatic (PanelButton paint)', () =>
    {
        const { svg } = ControlHarness.Render(() => new PanelButton(), { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080 — every token resolves');
        ControlHarness.Reset();
    });
});

// Test-only helper — OOP per house rules: no free functions, so the
// recursive Line search and the RadiusMd literal (used across the two
// PanelButton assertions) live as static members here instead of a
// module-level function/const.
class ControlsShellTestHelper
{
    public static readonly RadiusMd = 6;

    public static FindFirstLine(root: Visual): Line | undefined
    {
        if (root instanceof Line) return root;
        for (const child of root.visualChildren)
        {
            const hit = ControlsShellTestHelper.FindFirstLine(child);
            if (hit !== undefined) return hit;
        }
        return undefined;
    }
}
