import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CornerRadius } from '../corner-radius.js';

describe('CornerRadius ctor', () =>
{
    test('single argument fills all four corners uniformly', () =>
    {
        // Regression: the compiler lowers a 1-element markup tuple `(n)` to
        // `new CornerRadius(n)`. Before the uniform overload this set ONLY
        // TopLeft and left the other three `undefined` (non-finite), which
        // Border.resolveCorners folded to Full at paint time — a lopsided
        // blob (one square corner + three circular). A single arg MUST mean
        // uniform, mirroring Thickness.
        const r = new CornerRadius(5);
        assert.equal(r.TopLeft, 5);
        assert.equal(r.TopRight, 5);
        assert.equal(r.BottomRight, 5);
        assert.equal(r.BottomLeft, 5);
        assert.ok(r.IsUniform, 'single-arg CornerRadius is uniform');
        assert.ok(Number.isFinite(r.TopRight), 'the un-passed corners are NOT left non-finite');
    });

    test('four arguments set each corner in clockwise order', () =>
    {
        const r = new CornerRadius(1, 2, 3, 4);
        assert.deepEqual(
            [r.TopLeft, r.TopRight, r.BottomRight, r.BottomLeft],
            [1, 2, 3, 4]);
        assert.ok(!r.IsUniform);
    });

    test('Uniform static matches the single-arg ctor', () =>
    {
        assert.ok(CornerRadius.Uniform(7).Equals(new CornerRadius(7)));
    });
});
