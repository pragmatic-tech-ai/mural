import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ThemeManager } from '../../runtime/index.js';
import { initTestApp } from './test-app.js';

test('initTestApp activates Pragmatic as the default theme', () =>
{
    initTestApp();
    assert.equal(ThemeManager.ActiveTheme?.name, 'Pragmatic');
});
