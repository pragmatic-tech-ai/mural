import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application, ThemeManager } from '../../../runtime/index.js';
import { Pragmatic, PragmaticLight, PragmaticDark } from '../pragmatic.js';

function reset(): void
{
    ThemeManager._resetForTesting();
    Application.current = undefined;
}

describe('Pragmatic theme', () =>
{
    test('declares both schemes against itself', () =>
    {
        assert.equal(Pragmatic.instance.name, 'Pragmatic');
        assert.ok(Pragmatic.instance.schemes.get('PragmaticLight'));
        assert.ok(Pragmatic.instance.schemes.get('PragmaticDark'));
        assert.equal(Pragmatic.instance.defaultScheme, 'PragmaticLight');
        reset();
    });

    test('every catalog token is supplied by both schemes', () =>
    {
        const app = new Application();
        Application.current = app;
        for (const name of Pragmatic.instance.catalog.keys())
        {
            assert.ok(PragmaticLight.instance.tokens.has(name), `light missing ${name}`);
            assert.ok(PragmaticDark.instance.tokens.has(name),  `dark missing ${name}`);
        }
        reset();
    });

    test('activates without throwing and exposes the active scheme', () =>
    {
        const app = new Application();
        Application.current = app;
        // A prior test's _resetForTesting() clears the registry that the
        // compiled pragmatic.mu.js populated at import — re-register here,
        // idempotently (import may already have registered it).
        if (!ThemeManager.RegisteredThemes.some(t => t.name === 'Pragmatic'))
        {
            ThemeManager.RegisterTheme(Pragmatic.instance);
        }
        Pragmatic.Activate(PragmaticDark);
        assert.equal(ThemeManager.ActiveScheme?.name, 'PragmaticDark');
        reset();
    });
});
