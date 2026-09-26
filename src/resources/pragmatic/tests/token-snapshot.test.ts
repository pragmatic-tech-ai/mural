import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TokenSnapshot } from '../token-snapshot.js';

function load(): TokenSnapshot
{
    const path = fileURLToPath(new URL('../../../../../dev-kit/design/design-systems/pragmatic/tokens.json', import.meta.url));
    return new TokenSnapshot(JSON.parse(readFileSync(path, 'utf8')));
}

describe('TokenSnapshot', () =>
{
    test('resolves a direct hex', () =>
    {
        assert.equal(load().Resolve('brand-green', 'light'), '#2EA862');
    });

    test('resolves an alias chain', () =>
    {
        // bg-0 → {neutral-50} → #FAFAF9 (light); → {neutral-1000} → #0A0A0B (dark)
        assert.equal(load().Resolve('bg-0', 'light'), '#FAFAF9');
        assert.equal(load().Resolve('bg-0', 'dark'), '#0A0A0B');
    });

    test('falls back to light when a dark value is absent', () =>
    {
        assert.equal(load().Resolve('brand-green', 'dark'), '#2EA862');
    });

    test('keeps rgba() verbatim', () =>
    {
        assert.equal(load().Resolve('scrim', 'light'), 'rgba(10, 10, 11, 0.40)');
    });
});
