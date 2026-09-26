import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ColorValue } from '../color-value.js';

// Characterization: the scheme authors alpha colours as hex8 (the .mu
// grammar has no rgba() form) while the snapshot uses rgba(); the
// normalizer must make the two compare equal.
describe('ColorValue.Normalize', () =>
{
    test('hex8 and the equivalent rgba() normalize equal', () =>
    {
        // #0A0A0B66 == rgba(10, 10, 11, 0.40)  (0.40 * 255 = 102 = 0x66)
        assert.equal(ColorValue.Normalize('#0A0A0B66'), ColorValue.Normalize('rgba(10, 10, 11, 0.40)'));
    });

    test('#RGB expands and hex is case-insensitive', () =>
    {
        assert.equal(ColorValue.Normalize('#fff'), '255,255,255,255');
        assert.equal(ColorValue.Normalize('#2ea862'), ColorValue.Normalize('#2EA862'));
    });
});
