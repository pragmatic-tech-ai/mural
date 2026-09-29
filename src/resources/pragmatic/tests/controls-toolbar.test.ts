import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { ToolBar } from '../../../framework/tool-bar/tool-bar.js';
import { ToolBarButton, ToolBarToggleButton, ToolBarSeparator } from '../../../framework/tool-bar/tool-bar-items.js';
import { ToolBarSplitButton } from '../../../framework/tool-bar/tool-bar-split-button.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { ControlHarness } from './control-harness.js';

// ToolBarSplitButton's visible chrome (PART_Primary / PART_Arrow) is applied
// via a SECOND template (TriggerTemplate), not the control's primary
// Template DP — Control.GetTemplateChild only ever resolves against
// `_templateInstance`, which for this control is the popup chrome
// (@DefaultToolBarSplitPopup). The trigger halves are stashed in private
// fields with no public accessor (same shape as MenuButton, which the Wave 3
// menu family fork also gates on IsPragmaticStyle alone — see
// controls-menu.test.ts). RULING: ToolBarSplitButton is exercised via
// IsPragmaticStyle only; per-part token assertions are out of reach headless.
describe('Pragmatic ToolBar family', () =>
{
    test('resolves the Pragmatic style', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.ok(ControlHarness.IsPragmaticStyle(new ToolBarButton()), 'ToolBarButton Pragmatic');
        assert.ok(ControlHarness.IsPragmaticStyle(new ToolBarToggleButton()), 'ToolBarToggleButton Pragmatic');
        assert.ok(ControlHarness.IsPragmaticStyle(new ToolBarSplitButton()), 'ToolBarSplitButton Pragmatic');
        assert.ok(ControlHarness.IsPragmaticStyle(new ToolBarSeparator()), 'ToolBarSeparator Pragmatic');
        assert.ok(ControlHarness.IsPragmaticStyle(new ToolBar()), 'ToolBar Pragmatic');
        ControlHarness.Reset();
    });

    test('ToolBarButton PART_Border rests @Bg2, hover steps @Bg3 (flat-toolbar delta)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const btn = new ToolBarButton();
        const border = btn.GetTemplateChild('PART_Border') as Border;
        assert.equal((border.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg2'), 'rest fill is @Bg2');
        btn._setIsMouseOver(true);
        assert.equal((border.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg3'), 'hover steps PART_Border to @Bg3');
        ControlHarness.Reset();
    });

    test('ToolBarButton PART_StateLayer stays transparent at rest and hover', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const btn = new ToolBarButton();
        const stateLayer = btn.GetTemplateChild('PART_StateLayer') as Border;
        btn._setIsMouseOver(true);
        assert.equal((stateLayer.Fill as SolidColorBrush).Color.ToCss(), 'rgba(0,0,0,0)', 'state layer carries no hover tint');
        ControlHarness.Reset();
    });

    test('ToolBarToggleButton checked -> PART_StateLayer @SurfaceSelected (Review Focus: checked-over-hover)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const tb = new ToolBarToggleButton();
        tb.IsChecked = true;
        const stateLayer = tb.GetTemplateChild('PART_StateLayer') as Border;
        assert.equal((stateLayer.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('SurfaceSelected'), 'checked state layer fills @SurfaceSelected');
        ControlHarness.Reset();
    });

    test('ToolBarToggleButton checked + hover: PART_StateLayer STILL @SurfaceSelected while PART_Border shows @Bg3', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const tb = new ToolBarToggleButton();
        tb.IsChecked = true;
        tb._setIsMouseOver(true);
        const border     = tb.GetTemplateChild('PART_Border')     as Border;
        const stateLayer = tb.GetTemplateChild('PART_StateLayer') as Border;
        assert.equal((stateLayer.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('SurfaceSelected'),
            'checked cue on PART_StateLayer survives hover by z-order');
        assert.equal((border.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg3'),
            'PART_Border still steps to the hover fill underneath');
        ControlHarness.Reset();
    });

    test('ToolBarSeparator LineBrush is @BorderStrong', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const sep = new ToolBarSeparator();
        assert.equal((sep.LineBrush as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('BorderStrong'), 'separator line is @BorderStrong');
        ControlHarness.Reset();
    });

    test('resolves under dark', () =>
    {
        ControlHarness.Activate(PragmaticDark);
        assert.ok(ControlHarness.IsPragmaticStyle(new ToolBarButton()), 'ToolBarButton dark');
        assert.ok(ControlHarness.IsPragmaticStyle(new ToolBarToggleButton()), 'ToolBarToggleButton dark');
        assert.ok(ControlHarness.IsPragmaticStyle(new ToolBarSplitButton()), 'ToolBarSplitButton dark');
        assert.ok(ControlHarness.IsPragmaticStyle(new ToolBarSeparator()), 'ToolBarSeparator dark');
        assert.ok(ControlHarness.IsPragmaticStyle(new ToolBar()), 'ToolBar dark');

        const tb = new ToolBarToggleButton();
        tb.IsChecked = true;
        tb._setIsMouseOver(true);
        const stateLayer = tb.GetTemplateChild('PART_StateLayer') as Border;
        assert.equal((stateLayer.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('SurfaceSelected'),
            'dark checked+hover state layer still @SurfaceSelected');
        ControlHarness.Reset();
    });
});
