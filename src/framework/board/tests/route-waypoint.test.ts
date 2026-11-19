import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Point } from '../../../visual-engine/index.js';
import { waypoint, routePoints, hasPinned, type RouteWaypoint } from '../route-waypoint.js';

test('waypoint defaults to auto (not user-altered)', () => {
    const w = waypoint(new Point(10, 20));
    assert.equal(w.userAltered, false);
    assert.equal(w.point.X, 10);
    assert.equal(w.point.Y, 20);
});

test('routePoints projects to bare Points in order; undefined -> []', () => {
    const wps: RouteWaypoint[] = [waypoint(new Point(1, 2), true), waypoint(new Point(3, 4))];
    const pts = routePoints(wps);
    assert.deepEqual(pts.map(p => [p.X, p.Y]), [[1, 2], [3, 4]]);
    assert.deepEqual(routePoints(undefined), []);
});

test('hasPinned is true iff some waypoint is user-altered', () => {
    assert.equal(hasPinned([waypoint(new Point(0, 0))]), false);
    assert.equal(hasPinned([waypoint(new Point(0, 0), true)]), true);
    assert.equal(hasPinned(undefined), false);
});
