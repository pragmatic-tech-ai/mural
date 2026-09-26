import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PragmaticShadowEffect } from '../pragmatic-shadow-effect.js';

describe('PragmaticShadowEffect', () =>
{
    test('sm (light) is one soft drop-shadow at 4% black', () =>
    {
        const f = new PragmaticShadowEffect('sm').toCssFilter();
        assert.equal(f, 'drop-shadow(0.0px 1.0px 2.0px rgba(0, 0, 0, 0.040))');
    });

    test('md (light) stacks a 12px ambient over a 2px key shadow', () =>
    {
        const f = new PragmaticShadowEffect('md').toCssFilter();
        assert.equal(f, 'drop-shadow(0.0px 4.0px 12.0px rgba(0, 0, 0, 0.060)) drop-shadow(0.0px 1.0px 2.0px rgba(0, 0, 0, 0.040))');
    });

    test('dark md uses the heavier dark alphas', () =>
    {
        const f = new PragmaticShadowEffect('md', true).toCssFilter();
        assert.equal(f, 'drop-shadow(0.0px 4.0px 12.0px rgba(0, 0, 0, 0.500)) drop-shadow(0.0px 1.0px 2.0px rgba(0, 0, 0, 0.400))');
    });
});
