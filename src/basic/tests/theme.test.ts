// Theme.* alias-key resolution — see basic/theme.ts.
//
// `Theme.ink` / `Theme.primary` resolve theme-agnostic semantic keys
// (`@Ink` / `@AccentInk`) rather than hardcoded token names. Pragmatic's
// scheme files define these keys as a literal copy of the scheme's own
// backing colour, so `Theme.primary` resolves Pragmatic's real accent
// instead of the silent NEUTRAL grey fallback it hit when the getter
// asked for `@Primary` (a token Pragmatic never defined).
//
// This file is self-contained (builds its own Application + registers the
// theme) rather than reaching into
// `src/resources/pragmatic/tests/control-harness.ts`, so `basic/tests`
// doesn't depend on a sibling package's test-only harness.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Application, Color, ThemeManager } from '../../runtime/index.js';
import { SolidColorBrush } from '../../visual-engine/index.js';
import { Pragmatic, PragmaticLight, PragmaticDark } from '../../resources/pragmatic/pragmatic.js';
import { Theme } from '../theme.js';

class ThemeAliasFixture
{
    // Register the theme (idempotently — a prior test's
    // `_resetForTesting()` clears the registry populated by the compiled
    // `*.mu.js` modules' import-time side effects) and activate `scheme`
    // on a fresh Application.
    public static Activate(scheme: { instance: { theme: string } }): Application
    {
        if (!ThemeManager.RegisteredThemes.some(t => t.name === Pragmatic.instance.name))
        {
            ThemeManager.RegisterTheme(Pragmatic.instance);
        }
        const app = new Application();
        Application.current = app;
        ThemeManager.ApplyScheme(scheme.instance as never);
        return app;
    }

    public static Reset(): void
    {
        ThemeManager._resetForTesting();
        Application.current = null;
    }

    public static HexOf(brush: unknown): string | undefined
    {
        return brush instanceof SolidColorBrush ? brush.Color.ToHex() : undefined;
    }
}

describe('Theme.* alias keys — Pragmatic (the fix)', () =>
{
    test('PragmaticLight: Ink/AccentInk resolve the real @Fg1/@ControlAccent hex', () =>
    {
        const app = ThemeAliasFixture.Activate(PragmaticLight);
        const ink = app.Resources.Resolve('Ink');
        const accentInk = app.Resources.Resolve('AccentInk');
        assert.equal(ThemeAliasFixture.HexOf(ink), Color.FromHex('#22211E').ToHex());
        assert.equal(ThemeAliasFixture.HexOf(accentInk), Color.FromHex('#22824D').ToHex());
        ThemeAliasFixture.Reset();
    });

    test('PragmaticDark: Ink/AccentInk resolve the real @Fg1/@ControlAccent hex', () =>
    {
        const app = ThemeAliasFixture.Activate(PragmaticDark);
        const ink = app.Resources.Resolve('Ink');
        const accentInk = app.Resources.Resolve('AccentInk');
        assert.equal(ThemeAliasFixture.HexOf(ink), Color.FromHex('#E8E7E2').ToHex());
        assert.equal(ThemeAliasFixture.HexOf(accentInk), Color.FromHex('#2EA862').ToHex());
        ThemeAliasFixture.Reset();
    });

    test('BEFORE state: PragmaticLight never defined @Primary — Resolve(\'Primary\') is undefined', () =>
    {
        // Pins the bug this alias routing fixes: `Theme.primary` used to
        // call `brush('Primary')`, and Pragmatic's scheme files never
        // define `@Primary`, so it silently fell back to the NEUTRAL grey
        // marker (#808080) rather than Pragmatic's real accent. This
        // assertion documents that the OLD key genuinely resolves to
        // nothing under Pragmatic — the fix routes `Theme.primary` through
        // `@AccentInk` instead.
        const app = ThemeAliasFixture.Activate(PragmaticLight);
        assert.equal(app.Resources.Resolve('Primary'), undefined);
        ThemeAliasFixture.Reset();
    });
});

describe('Theme.ink / Theme.primary getters — through the public API', () =>
{
    test('Pragmatic: Theme.primary flips from the grey NEUTRAL fallback to the real accent', () =>
    {
        ThemeAliasFixture.Activate(PragmaticLight);
        assert.equal(ThemeAliasFixture.HexOf(Theme.ink), Color.FromHex('#22211E').ToHex());
        assert.equal(ThemeAliasFixture.HexOf(Theme.primary), Color.FromHex('#22824D').ToHex());
        ThemeAliasFixture.Reset();

        ThemeAliasFixture.Activate(PragmaticDark);
        assert.equal(ThemeAliasFixture.HexOf(Theme.ink), Color.FromHex('#E8E7E2').ToHex());
        assert.equal(ThemeAliasFixture.HexOf(Theme.primary), Color.FromHex('#2EA862').ToHex());
        ThemeAliasFixture.Reset();
    });
});
