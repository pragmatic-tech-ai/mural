import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DesignSystemTokens } from './design-system-tokens.js';

describe('TokenSnapshot', { skip: DesignSystemTokens.SkipReason() }, () =>
{
    test('resolves a direct hex', () =>
    {
        assert.equal(DesignSystemTokens.Load().Resolve('brand-green', 'light'), '#2EA862');
    });

    test('resolves an alias chain', () =>
    {
        // bg-0 → {neutral-50} → #FAFAF9 (light); → {neutral-1000} → #0A0A0B (dark)
        assert.equal(DesignSystemTokens.Load().Resolve('bg-0', 'light'), '#FAFAF9');
        assert.equal(DesignSystemTokens.Load().Resolve('bg-0', 'dark'), '#0A0A0B');
    });

    test('falls back to light when a dark value is absent', () =>
    {
        assert.equal(DesignSystemTokens.Load().Resolve('brand-green', 'dark'), '#2EA862');
    });

    test('keeps rgba() verbatim', () =>
    {
        assert.equal(DesignSystemTokens.Load().Resolve('scrim', 'light'), 'rgba(10, 10, 11, 0.40)');
    });
});
