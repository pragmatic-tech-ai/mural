import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Point, Rect, Size } from '../../../visual-engine/primitives.js';
import { cameraMatrix, zoomAtPoint, fitBounds, clampZoom, CAMERA_MIN, CAMERA_MAX } from '../camera.js';

test('cameraMatrix maps content->viewport as content*zoom - offset', () => {
    const m = cameraMatrix({ zoom: 2, offsetX: 30, offsetY: 50 });
    const s = m.Transform(new Point(10, 10));
    assert.equal(s.X, 10 * 2 - 30);
    assert.equal(s.Y, 10 * 2 - 50);
});

test('zoomAtPoint keeps the content point under the pivot fixed', () => {
    const before = { zoom: 1, offsetX: 0, offsetY: 0 };
    const pivot = new Point(100, 80);
    const after = zoomAtPoint(before, pivot, 2);
    // The viewport point that was at `pivot` must still be at `pivot`.
    const contentUnderPivot = cameraMatrix(before).Invert()!.Transform(pivot);
    const s = cameraMatrix(after).Transform(contentUnderPivot);
    assert.ok(Math.abs(s.X - pivot.X) < 1e-9);
    assert.ok(Math.abs(s.Y - pivot.Y) < 1e-9);
    assert.equal(after.zoom, 2);
});

test('zoomAtPoint clamps zoom to the interactive range', () => {
    assert.equal(zoomAtPoint({ zoom: CAMERA_MAX, offsetX: 0, offsetY: 0 }, new Point(0, 0), 2).zoom, CAMERA_MAX);
    assert.equal(zoomAtPoint({ zoom: CAMERA_MIN, offsetX: 0, offsetY: 0 }, new Point(0, 0), 0.5).zoom, CAMERA_MIN);
    assert.equal(clampZoom(99), CAMERA_MAX);
});

test('fitBounds frames content top-left with padding (no centering)', () => {
    // 100x100 content at (200,100), 500x300 viewport, 20 padding. Limiting axis
    // is height: (300-40)/100 = 2.6.
    const c = fitBounds(new Rect(200, 100, 100, 100), new Size(500, 300), 20);
    assert.ok(Math.abs(c.zoom - 2.6) < 1e-9);
    // content top-left (200,100) maps to (padding, padding) in the viewport.
    const tl = cameraMatrix(c).Transform(new Point(200, 100));
    assert.ok(Math.abs(tl.X - 20) < 1e-9);
    assert.ok(Math.abs(tl.Y - 20) < 1e-9);
});

test('fitBounds clamps offset to >= 0 for content at the origin', () => {
    const c = fitBounds(new Rect(0, 0, 100, 100), new Size(500, 300), 20);
    assert.equal(c.offsetX, 0);
    assert.equal(c.offsetY, 0);
});
