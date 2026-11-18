import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../../runtime/index.js';
import { Figure } from '../figure.js';
import { TextAutoFit } from '../shape-text.js';
import { TextNode } from '../text-node.js';

function make(): TextNode { Application.current = null; new Application(); return new TextNode(); }

describe('TextNode', () => {
    test('is a shapeless Figure (no silhouette source)', () => {
        const t = make();
        assert.ok(t instanceof Figure);
        assert.equal(t._getSource(), undefined);
    });
    test('defaults: 120x44, empty label, GrowShape autofit', () => {
        const t = make();
        assert.equal(t.Width, 120);
        assert.equal(t.Height, 44);
        assert.equal(t.Text.Content, '');
        assert.equal(t.Text.AutoFit, TextAutoFit.GrowShape);
    });
    test('LabelText proxies Text.Content', () => {
        const t = make();
        t.LabelText = 'hi';
        assert.equal(t.Text.Content, 'hi');
    });
});
