import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ThemeManager } from '../../runtime/index.js';
import { initTestApp } from './test-app.js';

test('initTestApp activates Pragmatic as the default theme', () =>
{
    initTestApp();
    assert.equal(ThemeManager.ActiveTheme?.name, 'Pragmatic');
});

test('initTestApp re-activates Pragmatic after a prior test reset the ThemeManager', () =>
{
    // A suite that builds a fresh Application mid-run tears the whole
    // theme registry down with `_resetForTesting()`. The next test that
    // asks the harness for the shared app must still get Pragmatic active
    // — otherwise its controls resolve no default template. This guards
    // the reset -> re-init path the harness claims to cover.
    initTestApp();
    ThemeManager._resetForTesting();
    assert.equal(ThemeManager.ActiveTheme, undefined, 'reset must clear the active theme first');

    initTestApp();
    assert.equal(ThemeManager.ActiveTheme?.name, 'Pragmatic');
});
