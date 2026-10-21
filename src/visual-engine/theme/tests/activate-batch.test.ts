import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Application, ThemeManager } from '../../../runtime/index.js';
import { Pragmatic, PragmaticLight } from '../../../resources/pragmatic/pragmatic.js';

class ActivateBatchFixture
{
    public static readonly SchemeOnlyToken = 'Space3';

    public static Prepare(): Application
    {
        ThemeManager._resetForTesting();
        if (ThemeManager.GetTheme(Pragmatic.instance.name) === undefined)
        {
            ThemeManager.RegisterTheme(Pragmatic.instance);
        }
        const app = new Application();
        Application.current = app;
        return app;
    }
}

describe('ThemeManager.activate batches dictionary merges', () =>
{
    test('a style subscriber never observes a scheme token missing mid-activation', () =>
    {
        try
        {
            const app = ActivateBatchFixture.Prepare();
            const observed: unknown[] = [];
            // Eager read (not a composite binding) on every style fan-out, as a
            // control re-applying its style/template would do.
            app.Resources.SubscribeStyle(() =>
            {
                observed.push(app.Resources.Resolve(ActivateBatchFixture.SchemeOnlyToken));
            });

            ThemeManager.ApplyScheme(PragmaticLight.instance as never);

            assert.ok(observed.length > 0, 'activation must fan out to style subscribers');
            assert.ok(observed.every(v => v !== undefined), 'token must resolve in every fan-out');
        }
        finally
        {
            ThemeManager._resetForTesting();
            Application.current = null;
        }
    });
});
