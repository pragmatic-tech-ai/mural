import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { TopAppBar } from '../../../framework/top-app-bar/top-app-bar.js';
import { ScrollViewer } from '../../../framework/surfaces/scroll-viewer.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic TopAppBar', () =>
{
    test('resolves the Pragmatic style; Material unaffected', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.ok(ControlHarness.IsPragmaticStyle(new TopAppBar()), 'TopAppBar Pragmatic');
        ControlHarness.Reset();
        ControlHarness.Activate(MaterialLight);
        assert.ok(!ControlHarness.IsPragmaticStyle(new TopAppBar()), 'Material TopAppBar unchanged');
        ControlHarness.Reset();
    });

    test('Small bar fills @Bg1 at rest', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const b = new TopAppBar();
        const border = b.GetTemplateChild('PART_Border') as Border;
        assert.equal((border.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg1'), 'rest bar fills @Bg1');
        ControlHarness.Reset();
    });

    test('scroll tint steps @Bg1 -> @Bg2 (Review Focus)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const b = new TopAppBar();
        // ScrollViewer offsets are NOT clamped on assignment (clamping only
        // happens at Arrange, via effectiveVerticalOffset) — see scroll-viewer.ts
        // — so setting VerticalOffset directly flips IsScrolled true without
        // needing real layout/content-taller-than-viewport. Wiring the
        // ScrollViewer as ScrollSource then mirrors that into the bar's own
        // IsScrolled DP (TopAppBar.rebindScrollSource), which drives the
        // fork's `when(IsScrolled)` template trigger end-to-end.
        const sv = new ScrollViewer();
        sv.VerticalOffset = 10;
        b.ScrollSource = sv;
        assert.equal(b.IsScrolled, true, 'ScrollSource offset flips TopAppBar.IsScrolled');
        const border = b.GetTemplateChild('PART_Border') as Border;
        assert.equal((border.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg2'),
            'scrolled bar tints @Bg2');
        ControlHarness.Reset();
    });

    test('title ink is @Fg1 and resolves under dark', () =>
    {
        ControlHarness.Activate(PragmaticDark);
        assert.ok(ControlHarness.IsPragmaticStyle(new TopAppBar()), 'TopAppBar dark');
        ControlHarness.Reset();
    });
});
