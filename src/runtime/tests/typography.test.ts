import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Typography } from '../index.js';

// § 17.10 — Typography value class.

describe('§ 17.10 — Typography', () => {

    test('constructs immutable instance from a property bag', () => {
        const t = new Typography({
            Family:     'Roboto',
            Size:       14,
            Weight:     400,
            LineHeight: 20,
            Tracking:   0.25,
        });
        assert.equal(t.Family,     'Roboto');
        assert.equal(t.Size,       14);
        assert.equal(t.Weight,     400);
        assert.equal(t.LineHeight, 20);
        assert.equal(t.Tracking,   0.25);
    });

    test('Tracking defaults to 0', () => {
        const t = new Typography({
            Family: 'Roboto', Size: 14, Weight: 400, LineHeight: 20,
        });
        assert.equal(t.Tracking, 0);
    });

    test('Equals returns true for identical bundles, false otherwise', () => {
        const a = new Typography({ Family: 'F', Size: 14, Weight: 400, LineHeight: 20 });
        const b = new Typography({ Family: 'F', Size: 14, Weight: 400, LineHeight: 20 });
        const c = new Typography({ Family: 'F', Size: 16, Weight: 400, LineHeight: 20 });
        assert.equal(a.Equals(b), true);
        assert.equal(a.Equals(c), false);
    });
});
