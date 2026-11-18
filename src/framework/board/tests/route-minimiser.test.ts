import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Point } from '../../../visual-engine/index.js';
import { waypoint } from '../route-waypoint.js';
import { minimiseRoute } from '../route-minimiser.js';

const src = new Point(0, 0), tgt = new Point(100, 0);

test('drops a collinear auto vertex', () => {
    const out = minimiseRoute([waypoint(new Point(50, 0))], src, tgt);   // on the src->tgt line
    assert.equal(out.length, 0);
});

test('keeps a non-collinear auto vertex (a real bend)', () => {
    const out = minimiseRoute([waypoint(new Point(50, 40))], src, tgt);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.point.Y, 40);
});

test('keeps a pinned vertex even when collinear', () => {
    const out = minimiseRoute([waypoint(new Point(50, 0), true)], src, tgt);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.userAltered, true);
});

test('keeps order and preserves flags; drops the collinear auto between pins', () => {
    const out = minimiseRoute(
        [waypoint(new Point(30, 20), true), waypoint(new Point(60, 20)), waypoint(new Point(90, 20), true)],
        src, tgt);
    assert.deepEqual(out.map(w => [w.point.X, w.userAltered]), [[30, true], [90, true]]);
});
