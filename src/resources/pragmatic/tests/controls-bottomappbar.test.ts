import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { BottomAppBar } from '../../../framework/bottom-app-bar/bottom-app-bar.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic BottomAppBar', () =>
{
    test('resolves the Pragmatic style', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.ok(ControlHarness.IsPragmaticStyle(new BottomAppBar()), 'BottomAppBar Pragmatic');
        ControlHarness.Reset();
    });

    test('PART_Border fills @Bg2 and carries a shadow Effect', () =>
    {
        // Unlike some Wave 3 controls, BottomAppBar's own ctor forces its
        // template to materialise synchronously (adoptTemplateParts throws
        // if it doesn't), so PART_Border is reachable via GetTemplateChild
        // on bare headless construction — no IsPragmaticStyle proxy needed.
        ControlHarness.Activate(PragmaticLight);
        const bar = new BottomAppBar();
        const border = bar.GetTemplateChild('PART_Border') as Border;
        assert.equal((border.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg2'), 'bar fills @Bg2');
        assert.notEqual(border.Effect, undefined, 'bar carries a shadow Effect');
        ControlHarness.Reset();
    });

    test('resolves under dark', () =>
    {
        ControlHarness.Activate(PragmaticDark);
        assert.ok(ControlHarness.IsPragmaticStyle(new BottomAppBar()), 'BottomAppBar dark');
        ControlHarness.Reset();
    });
});
