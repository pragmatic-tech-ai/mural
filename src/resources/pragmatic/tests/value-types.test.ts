import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FontWeight } from '../../../visual-engine/text/formatted-text.js';
import { Easings } from '../../../visual-engine/animation/easing.js';

// The Pragmatic type scale uses weight 600 for every heading, and the
// motion scale needs the symmetrical in-out curve (0.4, 0, 0.2, 1).
// Neither existed in the Material-era enums.
describe('Pragmatic value-type prerequisites', () =>
{
    test('FontWeight has a SemiBold (600) member', () =>
    {
        assert.equal(FontWeight.SemiBold, '600');
    });

    test('Easings exposes an Inout curve', () =>
    {
        assert.equal(typeof Easings.Inout, 'function');
    });
});
