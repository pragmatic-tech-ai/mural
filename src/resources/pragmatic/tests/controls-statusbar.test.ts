import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { StatusBar, StatusBarItem, StatusBarSeparator } from '../../../framework/status-bar/status-bar.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { ControlHarness } from './control-harness.js';

// StatusBar / StatusBarItem are ItemsControl / ContentControl subclasses
// whose ctors omit the protected applyDefaultStyle — same shape as
// Banner (Wave 3) — so their Template never materialises on bare
// headless construction and PART_-style lookups are unreachable. Gate on
// the resolved Pragmatic style identity + the @Bg1 / @Border token
// proxies instead (the Wave 3 Banner/ComboBox/GridSplitter Ruling).
// StatusBarSeparator's own ctor DOES call applyDefaultStyle (it has no
// Template, just direct Width/MinHeight/LineBrush setters), so it
// resolves the same way but is included here for parity across the family.
describe('Pragmatic StatusBar family', () =>
{
    test('resolves the Pragmatic style', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.ok(ControlHarness.IsPragmaticStyle(new StatusBar()), 'StatusBar uses the Pragmatic style');
        assert.ok(ControlHarness.IsPragmaticStyle(new StatusBarItem()), 'StatusBarItem uses the Pragmatic style');
        assert.ok(ControlHarness.IsPragmaticStyle(new StatusBarSeparator()), 'StatusBarSeparator uses the Pragmatic style');
        ControlHarness.Reset();
    });

    test('@Bg1 fill + @Border top-rule/separator tokens resolve under Pragmatic', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.equal(ControlHarness.TokenCss('Bg1'), 'rgb(255,255,255)', '@Bg1 strip fill resolves');
        assert.equal(ControlHarness.TokenCss('Border'), 'rgb(233,232,228)', '@Border top-rule/separator resolves');
        assert.notEqual(ControlHarness.TokenCss('Bg1'), ControlHarness.NeutralFallbackCss, 'not the grey fallback');
        ControlHarness.Reset();
    });

    test('StatusBarSeparator LineBrush references @Border directly (reachable — its ctor applies the default style)', () =>
    {
        // StatusBarSeparator has no Template; its ctor calls applyDefaultStyle,
        // so LineBrush is reachable headless (same as ToolBarSeparator). Assert
        // the fork REFERENCES @Border, not just that @Border resolves in the
        // table — a regression to @OutlineVariant/@BorderStrong would pass a
        // token-value proxy but fail this identity-of-value check.
        ControlHarness.Activate(PragmaticLight);
        const sep = new StatusBarSeparator();
        assert.equal((sep.LineBrush as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Border'), 'separator line is @Border');
        ControlHarness.Reset();
    });

    test('resolves the Pragmatic style under dark', () =>
    {
        ControlHarness.Activate(PragmaticDark);
        assert.ok(ControlHarness.IsPragmaticStyle(new StatusBar()), 'StatusBar dark');
        assert.ok(ControlHarness.IsPragmaticStyle(new StatusBarItem()), 'StatusBarItem dark');
        assert.ok(ControlHarness.IsPragmaticStyle(new StatusBarSeparator()), 'StatusBarSeparator dark');
        ControlHarness.Reset();
    });
});
