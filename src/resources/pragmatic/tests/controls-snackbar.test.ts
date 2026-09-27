import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Snackbar } from '../../../framework/notifications/snackbar.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

// Snackbar is a bare ContentControl shown via a service; it never applies its
// template on headless construction or Render, so PART_Snackbar is unreachable.
// Gate on the resolved Pragmatic style identity + the inverse-surface token
// proxies (Review Focus: legibility) — the Wave-2 fallback (Ruling in ledger).
describe('Pragmatic Snackbar', () =>
{
    test('resolves the Pragmatic style; Material unaffected', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.ok(ControlHarness.IsPragmaticStyle(new Snackbar()), 'Snackbar uses the Pragmatic style');
        ControlHarness.Reset();
        ControlHarness.Activate(MaterialLight);
        assert.ok(!ControlHarness.IsPragmaticStyle(new Snackbar()), 'Material Snackbar keeps the Material style');
        ControlHarness.Reset();
    });

    test('inverse-surface tokens resolve @BgInverse backdrop + @FgInverse ink (Review Focus: legibility)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.equal(ControlHarness.TokenCss('BgInverse'), 'rgb(10,10,11)', '@BgInverse backdrop resolves');
        assert.equal(ControlHarness.TokenCss('FgInverse'), 'rgb(250,250,249)', '@FgInverse ink resolves — legible on the inverse backdrop');
        ControlHarness.Reset();
    });

    test('resolves the Pragmatic style under dark', () =>
    {
        ControlHarness.Activate(PragmaticDark);
        assert.ok(ControlHarness.IsPragmaticStyle(new Snackbar()), 'Snackbar resolves the Pragmatic style under dark');
        ControlHarness.Reset();
    });
});
