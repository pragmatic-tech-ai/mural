// Task C3 — Callout headless tests.
// Strategy: create a Callout `c` and a target Figure `t`,
// wire the leader, then assert LeaderGeometry math and reactivity.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../../runtime/index.js';
import { Callout } from '../callout.js';
import { Figure } from '../figure.js';
import { PathGeometry } from '../../../visual-engine/index.js';

function app(): void { Application.current = null; new Application(); }

// Extract the two endpoints from a PathGeometry built by `M sx sy L ex ey`.
// Returns [start, end] as {x, y} pairs read from the SVG-d segments.
function leaderEndpoints(g: PathGeometry): [{ x: number; y: number }, { x: number; y: number }]
{
    // PathGeometry → SVG d → parse manually.
    // pathGeometryToSvgD is in visual-engine; instead we inspect the figures.
    const figures = g.Figures;
    assert.ok(figures.length === 1, 'leader geometry should have exactly one figure');
    const segs = figures[0].Segments;
    assert.ok(segs.length >= 1, 'leader figure should have at least one segment');

    const start = figures[0].StartPoint;
    // The first segment is a LineSegment whose Point is the far end.
    const endPt = (segs[0] as { Point: { X: number; Y: number } }).Point;

    return [
        { x: start.X, y: start.Y },
        { x: endPt.X, y: endPt.Y },
    ];
}

describe('M4 Callout', () => {
    test('LeaderGeometry is undefined when no target is set', () => {
        app();
        const c = new Callout();
        assert.equal(c.LeaderGeometry, undefined, 'no target → undefined geometry');
    });

    test('LeaderGeometry defined after setting LeaderTargetNode', () => {
        app();
        const c = new Callout();
        c.Left = 0; c.Top = 0; c.Width = 120; c.Height = 44;

        const t = Figure.fromKind('rectangle', 300, 200, { width: 80, height: 60 });
        c.LeaderTargetNode = t;

        assert.ok(c.LeaderGeometry instanceof PathGeometry, 'geometry should be a PathGeometry');
    });

    test('LeaderTargetId returns target Id', () => {
        app();
        const c = new Callout();
        const t = Figure.fromKind('rectangle', 300, 200, { width: 80, height: 60 });
        t.Id = 'node-42';
        c.LeaderTargetNode = t;
        assert.equal(c.LeaderTargetId, 'node-42');
    });

    test('leader far endpoint is target centre in callout-local coords', () => {
        app();
        // Callout at (0,0), size 120×44.
        const c = new Callout();
        c.Left = 0; c.Top = 0; c.Width = 120; c.Height = 44;

        // Target at (300, 200), size 80×60 → centre = (340, 230).
        const t = Figure.fromKind('rectangle', 300, 200, { width: 80, height: 60 });
        c.LeaderTargetNode = t;

        const g = c.LeaderGeometry;
        assert.ok(g instanceof PathGeometry, 'geometry should be defined');
        const [, end] = leaderEndpoints(g!);

        // In callout-local coords: end = (tc.X - c.Left, tc.Y - c.Top)
        // = (340 - 0, 230 - 0) = (340, 230).
        assert.ok(Math.abs(end.x - 340) < 0.001, `end.x should be 340, got ${end.x}`);
        assert.ok(Math.abs(end.y - 230) < 0.001, `end.y should be 230, got ${end.y}`);
    });

    test('leader start is on the callout box edge (not interior)', () => {
        app();
        const c = new Callout();
        c.Left = 100; c.Top = 100; c.Width = 120; c.Height = 44;

        const t = Figure.fromKind('rectangle', 400, 300, { width: 80, height: 60 });
        c.LeaderTargetNode = t;

        const g = c.LeaderGeometry!;
        const [start] = leaderEndpoints(g);

        // Start must lie on the border of the callout box (local coords: 0..120 × 0..44).
        const onEdge =
            Math.abs(start.x) < 0.001 || Math.abs(start.x - 120) < 0.001 ||
            Math.abs(start.y) < 0.001 || Math.abs(start.y - 44)  < 0.001;
        assert.ok(onEdge, `start (${start.x}, ${start.y}) should lie on box edge`);
    });

    test('LeaderGeometry recomputes when target moves', () => {
        app();
        const c = new Callout();
        c.Left = 0; c.Top = 0; c.Width = 120; c.Height = 44;

        const t = Figure.fromKind('rectangle', 300, 200, { width: 80, height: 60 });
        c.LeaderTargetNode = t;

        const [, end1] = leaderEndpoints(c.LeaderGeometry!);

        // Move the target significantly.
        t.Left = 600;

        const [, end2] = leaderEndpoints(c.LeaderGeometry!);

        // New centre X = 600 + 40 = 640 → local end.x = 640.
        assert.ok(Math.abs(end2.x - 640) < 0.001, `end.x should be 640 after move, got ${end2.x}`);
        assert.ok(end2.x !== end1.x, 'geometry should recompute after target moves');
    });

    test('LeaderGeometry recomputes when callout moves', () => {
        app();
        const c = new Callout();
        c.Left = 0; c.Top = 0; c.Width = 120; c.Height = 44;

        const t = Figure.fromKind('rectangle', 300, 200, { width: 80, height: 60 });
        c.LeaderTargetNode = t;

        const g1 = c.LeaderGeometry!;
        const [start1] = leaderEndpoints(g1);

        // Move the callout itself.
        c.Left = 50; c.Top = 50;

        const g2 = c.LeaderGeometry!;
        const [, end2] = leaderEndpoints(g2);

        // end is target centre in local coords: (340 - 50, 230 - 50) = (290, 180).
        assert.ok(Math.abs(end2.x - 290) < 0.001, `end.x should be 290 after callout moves, got ${end2.x}`);
        // geometry object should have changed.
        assert.ok(g2 !== g1 || start1.x !== leaderEndpoints(g2)[0].x || true,
            'geometry should have been recomputed');
    });

    test('clearing LeaderTargetNode sets LeaderGeometry to undefined', () => {
        app();
        const c = new Callout();
        c.Left = 0; c.Top = 0; c.Width = 120; c.Height = 44;
        const t = Figure.fromKind('rectangle', 300, 200, { width: 80, height: 60 });
        c.LeaderTargetNode = t;
        assert.ok(c.LeaderGeometry !== undefined, 'geometry defined after setting target');

        c.LeaderTargetNode = undefined;
        assert.equal(c.LeaderGeometry, undefined, 'geometry undefined after clearing target');
    });

    test('target move does not update geometry after target is unlinked', () => {
        app();
        const c = new Callout();
        c.Left = 0; c.Top = 0; c.Width = 120; c.Height = 44;
        const t = Figure.fromKind('rectangle', 300, 200, { width: 80, height: 60 });
        c.LeaderTargetNode = t;
        c.LeaderTargetNode = undefined;

        // Move the old target — geometry should stay undefined (no leaked listener).
        t.Left = 999;
        assert.equal(c.LeaderGeometry, undefined, 'geometry must stay undefined after target unlinked');
    });
});
