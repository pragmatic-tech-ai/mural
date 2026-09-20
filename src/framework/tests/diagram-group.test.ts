import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Application } from '../../runtime/index.js';
import { Figure } from '../diagram/figure.js';
import { Group } from '../diagram/group.js';

function freshFigure(left: number, top: number, w: number, h: number): Figure
{
    const f = new Figure();
    f.Left   = left;
    f.Top    = top;
    f.Width  = w;
    f.Height = h;
    return f;
}

function freshGroup(members: Figure[]): Group
{
    Application.current = null;
    new Application();
    return new Group(members);
}

describe('Group — bbox derivation from members', () => {

    test('three-member union bbox (top-left + size)', () => {
        // Members:  (10,20 20×30)  (40,15 15×10)  (5,50 12×8)
        // Right edges: 30, 55, 17 → max 55. Bottom edges: 50, 25, 58 → max 58.
        // Union: left ∈ [5, 55], top ∈ [15, 58]  →  Left=5 Top=15 W=50 H=43.
        const a = freshFigure(10, 20, 20, 30);
        const b = freshFigure(40, 15, 15, 10);
        const c = freshFigure( 5, 50, 12,  8);
        const g = freshGroup([a, b, c]);

        assert.equal(g.Left,   5);
        assert.equal(g.Top,   15);
        assert.equal(g.Width, 50);
        assert.equal(g.Height,43);
    });

    test('zero members yields (0,0,0,0)', () => {
        const g = freshGroup([]);
        assert.equal(g.Left,   0);
        assert.equal(g.Top,    0);
        assert.equal(g.Width,  0);
        assert.equal(g.Height, 0);
    });

    test('member Left / Top change re-derives bbox', () => {
        const a = freshFigure(10, 10, 20, 20);
        const b = freshFigure(40, 40, 20, 20);
        const g = freshGroup([a, b]);
        assert.equal(g.Left,   10);
        assert.equal(g.Width,  50);

        a.Left = 0;
        assert.equal(g.Left,   0);
        assert.equal(g.Width, 60);
    });

    test('member Width / Height change re-derives bbox', () => {
        const a = freshFigure(0, 0, 10, 10);
        const g = freshGroup([a]);
        assert.equal(g.Width,  10);
        assert.equal(g.Height, 10);

        a.Width  = 25;
        a.Height = 18;
        assert.equal(g.Width,  25);
        assert.equal(g.Height, 18);
    });

    test('inserting a member updates bbox + attaches listener', () => {
        const a = freshFigure(0, 0, 10, 10);
        const g = freshGroup([a]);
        assert.equal(g.Width, 10);

        const b = freshFigure(20, 0, 10, 10);
        g.Members.Add(b);
        assert.equal(g.Left, 0);
        assert.equal(g.Width, 30);

        // Moving the newly-inserted member should refire bbox recompute.
        b.Left = 50;
        assert.equal(g.Width, 60);
    });

    test('removing a member updates bbox + detaches listener', () => {
        const a = freshFigure(0, 0, 10, 10);
        const b = freshFigure(40, 0, 10, 10);
        const g = freshGroup([a, b]);
        assert.equal(g.Width, 50);

        g.Members.RemoveAt(1);
        assert.equal(g.Width, 10);

        // After remove, mutating the gone member shouldn't ping the group.
        b.Left = 999;
        assert.equal(g.Width, 10);
    });

    test('clearing the collection collapses bbox to zeros', () => {
        const a = freshFigure(10, 10, 20, 20);
        const b = freshFigure(40, 40, 20, 20);
        const g = freshGroup([a, b]);
        assert.equal(g.Width, 50);

        g.Members.Clear();
        assert.equal(g.Left,   0);
        assert.equal(g.Top,    0);
        assert.equal(g.Width,  0);
        assert.equal(g.Height, 0);
    });
});

describe('Group — rigid translate', () => {

    test('Translate(dx, dy) shifts every member by the delta in lock-step', () => {
        const a = freshFigure(10, 10, 20, 20);
        const b = freshFigure(40, 40, 20, 20);
        const c = freshFigure(70, 70, 20, 20);
        const g = freshGroup([a, b, c]);

        g.Translate(5, -3);

        assert.equal(a.Left, 15); assert.equal(a.Top,  7);
        assert.equal(b.Left, 45); assert.equal(b.Top, 37);
        assert.equal(c.Left, 75); assert.equal(c.Top, 67);
    });

    test('Translate updates the group bbox after the shift', () => {
        const a = freshFigure(0, 0, 10, 10);
        const b = freshFigure(40, 40, 10, 10);
        const g = freshGroup([a, b]);
        assert.equal(g.Left, 0);
        assert.equal(g.Top,  0);

        g.Translate(100, 50);

        assert.equal(g.Left, 100);
        assert.equal(g.Top,   50);
        assert.equal(g.Width,  50);
        assert.equal(g.Height, 50);
    });

    test('Translate(0, 0) is a no-op', () => {
        const a = freshFigure(10, 10, 20, 20);
        const g = freshGroup([a]);

        let bboxRefires = 0;
        g.PropertyChanged(Group.LeftKey).subscribe(() => bboxRefires++);
        g.Translate(0, 0);
        assert.equal(bboxRefires, 0);
        assert.equal(a.Left, 10);
    });

    test('per-member PropertyChanged listeners stay quiet during the shift cascade', () => {
        // Recomputing bbox per member-change inside the shift would fire
        // Group.Left / Group.Top changes N times instead of once. Pinned via
        // the listener count: a 3-member shift should fire each bbox DP
        // exactly once (the post-shift recompute).
        const a = freshFigure(0, 0, 10, 10);
        const b = freshFigure(20, 0, 10, 10);
        const c = freshFigure(40, 0, 10, 10);
        const g = freshGroup([a, b, c]);

        let leftFires = 0;
        g.PropertyChanged(Group.LeftKey).subscribe(() => leftFires++);
        g.Translate(7, 0);
        assert.equal(leftFires, 1, 'bbox Left must fire exactly once per Translate');
        assert.equal(a.Left, 7);
        assert.equal(b.Left, 27);
        assert.equal(c.Left, 47);
    });

    test('writing Left absolute-translates members to make bbox.Left equal to the target', () => {
        const a = freshFigure(10, 10, 10, 10);
        const b = freshFigure(50, 10, 10, 10);
        const g = freshGroup([a, b]);

        g.Left = 100;

        // dx = 100 - 10 = 90.
        assert.equal(a.Left, 100);
        assert.equal(b.Left, 140);
        assert.equal(g.Left, 100);
    });
});

describe('Group — Parent / EnumerateLeaves / EnumerateSubGroups', () => {

    test('child Figure.Parent is set when added through the constructor', () => {
        const a = freshFigure(0, 0, 10, 10);
        const g = freshGroup([a]);
        assert.equal(a.Parent, g);
    });

    test('EnumerateLeaves walks nested groups recursively', () => {
        Application.current = null;
        new Application();
        const leaf1 = freshFigure(0, 0, 10, 10);
        const leaf2 = freshFigure(20, 0, 10, 10);
        const inner = new Group([leaf2]);
        const outer = new Group([leaf1, inner]);

        const leaves = [...outer.EnumerateLeaves()];
        assert.equal(leaves.length, 2);
        assert.ok(leaves.includes(leaf1));
        assert.ok(leaves.includes(leaf2));
    });

    test('EnumerateSubGroups yields nested groups (not the outer self)', () => {
        Application.current = null;
        new Application();
        const inner = new Group([]);
        const outer = new Group([inner]);

        const subs = [...outer.EnumerateSubGroups()];
        assert.equal(subs.length, 1);
        assert.equal(subs[0], inner);
    });
});
