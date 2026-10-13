import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Application } from '../../runtime/index.js';
import { initTestApp } from './test-app.js';

// Regression guard for the cross-realm Application.current slot.
//
// Under the test runner, mural is loaded as TWO module instances at once: tsx
// resolves `src` for transpiled imports, while the compiled Pragmatic theme
// (`build/resources/pragmatic/pragmatic.mu.js`) resolves its bare
// `@pragmatic-tech-ai/mural/runtime` import to `dist`. initTestApp builds the
// Application from `src` and activates the theme, whose activation runs in `dist`
// and reads `Application.current`. If `current` were a plain per-class static the
// dist ThemeManager would see `null` and throw
// "ThemeManager: no Application.current". Backing it with a Symbol.for globalThis
// slot makes both instances share one value, so activation finds the app. (The
// ThemeManager's own static state is likewise realm-split, which is harmless — it
// just means initTestApp rebuilds each call; what MUST hold is that the dist-side
// activation no longer throws for want of a current Application.)
describe('initTestApp theme activation (src/dist module split)', () =>
{
    test('activates the theme without throwing and sets Application.current', () =>
    {
        let app: Application | undefined;
        assert.doesNotThrow(() => { app = initTestApp(); }, 'initTestApp must not throw "no Application.current"');
        assert.ok(app === Application.current, 'the built app is the ambient current');
    });
});
