import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { ScrollBar } from '../../../basic/scroll/scroll-bar.js';
import { ScrollViewer } from '../../../framework/index.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic ScrollBar', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const sb = new ScrollBar();
        assert.ok(ControlHarness.IsPragmaticStyle(sb), 'ScrollBar uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('flat track @Bg2 + pill thumb @BorderStrong at rest', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const sb = new ScrollBar();
        const track = sb.GetTemplateChild('PART_Track') as Border;
        const thumb = sb.GetTemplateChild('PART_Thumb') as Border;
        assert.equal((track.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg2'), 'track fills @Bg2');
        assert.equal((thumb.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('BorderStrong'), 'rest thumb fills @BorderStrong');
        ControlHarness.Reset();
    });

    test('thumb hover ramps to @Fg3', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const sb = new ScrollBar();
        const thumb = sb.GetTemplateChild('PART_Thumb') as Border;
        thumb._setIsMouseOver(true);
        assert.equal((thumb.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Fg3'), 'hovered thumb ramps to @Fg3');
        ControlHarness.Reset();
    });

    test('auto-hide structure preserved — PART_Layout still present', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const sb = new ScrollBar();
        const layout = sb.GetTemplateChild('PART_Layout');
        assert.notEqual(layout, undefined, 'PART_Layout preserved so the IsFaded→Opacity auto-hide still applies');
        ControlHarness.Reset();
    });

    test('rest thumb fills the dark @BorderStrong under PragmaticDark', () =>
    {
        ControlHarness.Activate(PragmaticDark);
        const sb = new ScrollBar();
        const thumb = sb.GetTemplateChild('PART_Thumb') as Border;
        assert.equal((thumb.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('BorderStrong'), 'dark rest thumb fills @BorderStrong');
        ControlHarness.Reset();
    });
});

describe('Pragmatic ScrollViewer (unforked — inherits the Pragmatic ScrollBar)', () =>
{
    test('its scrollbars resolve the Pragmatic ScrollBar style', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const sv = new ScrollViewer();
        const vbar = sv.GetTemplateChild('PART_VerticalScrollBar') as ScrollBar;
        assert.ok(vbar instanceof ScrollBar, 'ScrollViewer hosts a PART_VerticalScrollBar');
        assert.ok(ControlHarness.IsPragmaticStyle(vbar), 'the nested scrollbar resolves the Pragmatic style');
        ControlHarness.Reset();
    });

    test('renders with no grey fallback under Pragmatic', () =>
    {
        const { svg } = ControlHarness.Render(() => new ScrollViewer(), { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080 — ScrollViewer + forked ScrollBar compose cleanly');
        ControlHarness.Reset();
    });
});
