import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Figure } from '../figure.js';
import { TextNode } from '../text-node.js';
import { Callout } from '../callout.js';

// Importing text-node.js / callout.js registers the 'text' / 'callout' figure
// kinds as a module side-effect (same pattern as container-figure.js).

test("Figure.fromKind('text') yields a TextNode with the given frame", () => {
    initTestApp();
    const t = Figure.fromKind('text', 5, 6, { width: 200, height: 60 });
    assert.ok(t instanceof TextNode);
    assert.equal(t.Left, 5); assert.equal(t.Top, 6);
    assert.equal(t.Width, 200); assert.equal(t.Height, 60);
});

test("Figure.fromKind('text') falls back to the TextNode default box", () => {
    initTestApp();
    const t = Figure.fromKind('text', 0, 0);
    assert.ok(t instanceof TextNode);
    assert.equal(t.Width, 120); assert.equal(t.Height, 44);
});

test("Figure.fromKind('callout') yields a leaderless Callout", () => {
    initTestApp();
    const c = Figure.fromKind('callout', 7, 8, { width: 160, height: 50 });
    assert.ok(c instanceof Callout);
    assert.equal(c.Left, 7); assert.equal(c.Top, 8);
    assert.equal(c.Width, 160); assert.equal(c.Height, 50);
    // Dropped leaderless: no target, hence no leader geometry.
    assert.equal(c.LeaderTargetNode, undefined);
    assert.equal(c.LeaderGeometry, undefined);
});
