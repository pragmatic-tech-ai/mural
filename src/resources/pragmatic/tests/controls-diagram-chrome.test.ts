import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { DiagramSettings } from '../../../framework/diagram/diagram-settings.js';
import { Diagram } from '../../../framework/diagram/diagram.js';
import { Group } from '../../../framework/diagram/group.js';
import { ContainerFigure } from '../../../framework/diagram/container-figure.js';
import { SizePositionControl } from '../../../framework/diagram/size-position-control.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { ControlHarness } from './control-harness.js';

// Wave 5 Task 9 — diagram chrome painted in TS via DiagramSettings.THEME_LINK,
// which resolved M3 token names by string ('OnSurface'/'OnSurfaceVariant'/
// 'Surface'/'Primary') that don't exist under Pragmatic (fell back to the
// compiled default). Repointed to the theme-agnostic keys Ink/InkVariant/
// SurfaceBg/AccentInk so diagram chrome tracks the active scheme.
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
});

// Wave 5 Task 10 — diagram template fork (resources PragmaticDiagrams). The
// ~10 token-driven template touch-points: canvas-bg @DiagramCanvas->@CanvasBg,
// drop-candidate/selection @SecondaryContainer->@SurfaceSelected, editing/
// selection strokes @Primary->@ControlAccent, inspector-rail tokens, and
// SizePositionControl labels @BodySmall->@BodySm. caps.template.mu needs no
// fork (per-instance $Brush/$Pen only). All four controls apply headless.
describe('Pragmatic diagram template fork', () =>
{
    for (const entry of [
        { Name: 'Diagram', Make: () => new Diagram() },
        { Name: 'Group', Make: () => new Group() },
        { Name: 'ContainerFigure', Make: () => new ContainerFigure() },
        { Name: 'SizePositionControl', Make: () => new SizePositionControl() },
    ])
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

    test('Diagram PART_CanvasBg fills @CanvasBg (drawing paper)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const d = new Diagram();
        const canvas = d.GetTemplateChild('PART_CanvasBg') as Border;
        assert.equal((canvas.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('CanvasBg'), 'canvas paper @CanvasBg');
        ControlHarness.Reset();
    });
});
