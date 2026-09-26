import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application, ThemeManager } from '../../../runtime/index.js';
import { Pragmatic, PragmaticLight } from '../pragmatic.js';

describe('Pragmatic typography', () =>
{
    test('keyed type styles resolve once the theme is active', () =>
    {
        const app = new Application();
        Application.current = app;
        // Registered at import, but a prior test's _resetForTesting() may
        // have cleared it — register idempotently regardless of order.
        if (!ThemeManager.RegisteredThemes.some(t => t.name === 'Pragmatic'))
        {
            ThemeManager.RegisterTheme(Pragmatic.instance);
        }
        Pragmatic.Activate(PragmaticLight);
        // Material's regression: its Typography dictionary is never merged,
        // so a keyed type style resolves to nothing. Pragmatic lists
        // PragmaticTypography in dictionaries:, so 'Body' must resolve.
        const body = Application.current.Resources.Resolve('Body');
        assert.ok(body, "'Body' style should resolve when Pragmatic is active");
        ThemeManager._resetForTesting();
        Application.current = undefined;
    });
});
