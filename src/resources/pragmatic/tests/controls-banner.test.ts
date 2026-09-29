import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Banner } from '../../../framework/notifications/banner.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { ControlHarness } from './control-harness.js';

// Banner is a bare ContentControl shown via a service; it never applies its
// template on headless construction or Render (its ctor omits the protected
// applyDefaultStyle), so PART_Banner is unreachable and a headless render is
// empty. Gate on the resolved Pragmatic style identity + the surface/hairline
// token proxies — the Wave-2 ComboBox/GridSplitter fallback (Ruling in ledger).
describe('Pragmatic Banner', () =>
{
    test('resolves the Pragmatic style', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.ok(ControlHarness.IsPragmaticStyle(new Banner()), 'Banner uses the Pragmatic style');
        ControlHarness.Reset();
    });

    test('surface + hairline tokens resolve under Pragmatic', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.equal(ControlHarness.TokenCss('Bg1'), 'rgb(255,255,255)', '@Bg1 strip surface resolves');
        assert.equal(ControlHarness.TokenCss('Border'), 'rgb(233,232,228)', '@Border hairline resolves');
        assert.notEqual(ControlHarness.TokenCss('Bg1'), ControlHarness.NeutralFallbackCss, 'not the grey fallback');
        ControlHarness.Reset();
    });

    test('resolves the Pragmatic style under dark', () =>
    {
        ControlHarness.Activate(PragmaticDark);
        assert.ok(ControlHarness.IsPragmaticStyle(new Banner()), 'Banner resolves the Pragmatic style under dark');
        ControlHarness.Reset();
    });
});
