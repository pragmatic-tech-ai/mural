import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Callout } from '../callout.js';
import { TextNode } from '../text-node.js';

describe('Callout — inherits auto-grow, leader follows', () => {
    beforeEach(() => { initTestApp(); });

    test('a long label grows the callout box', () => {
        const c = new Callout();
        const w0 = c.Width;
        c.LabelText = 'A callout label long enough to force the box to grow wider';
        assert.ok(c.Width > w0, `expected grow from ${w0}, got ${c.Width}`);
    });

    test('leader geometry recomputes after the box auto-grows', () => {
        const c = new Callout();
        c.Left = 0; c.Top = 0;
        const target = new TextNode();
        target.Left = 400; target.Top = 300;
        c.LeaderTargetNode = target;
        const before = c.LeaderGeometry;
        assert.ok(before !== undefined, 'leader present with a target');
        c.LabelText = 'Grow the callout so its edge point moves and the leader is recomputed';
        assert.ok(c.LeaderGeometry !== undefined, 'leader still present after grow');
    });
});
