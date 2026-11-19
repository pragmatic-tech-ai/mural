import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Point } from '../../../visual-engine/index.js';
import { boardSpaceRect, toParentSpace, type ContainerLike, type SpatialNode } from '../coordinate-space.js';

function container(left: number, top: number, originX: number, originY: number, parent?: ContainerLike): ContainerLike
{
    return { Left: left, Top: top, Width: 200, Height: 200, ContentOrigin: new Point(originX, originY), ContainerParent: parent };
}

test('boardSpaceRect: root node is its own Left/Top', () => {
    const n: SpatialNode = { Left: 10, Top: 20, Width: 30, Height: 40 };
    const r = boardSpaceRect(n);
    assert.deepEqual([r.X, r.Y, r.Width, r.Height], [10, 20, 30, 40]);
});

test('boardSpaceRect: one level sums container origin + content offset', () => {
    // container at (100,100), content inset (5, 25); child local (10, 20).
    const c = container(100, 100, 5, 25);
    const child: SpatialNode = { Left: 10, Top: 20, Width: 30, Height: 40, ContainerParent: c };
    const r = boardSpaceRect(child);
    assert.deepEqual([r.X, r.Y], [100 + 5 + 10, 100 + 25 + 20]); // (115, 145)
});

test('boardSpaceRect: two levels walk the whole chain', () => {
    const outer = container(100, 100, 5, 25);
    const inner = container(10, 10, 2, 8, outer); // inner is a child of outer
    const child: SpatialNode = { Left: 1, Top: 1, Width: 5, Height: 5, ContainerParent: inner };
    const r = boardSpaceRect(child);
    // outer content origin contributes (100+5, 100+25); inner local (10,10) → inner board origin (115,135)
    // + inner content (2,8) = (117,143) + child local (1,1) = (118,144)
    assert.deepEqual([r.X, r.Y], [118, 144]);
});

test('toParentSpace: inverse of one level', () => {
    const c = container(100, 100, 5, 25);
    const p = toParentSpace(new Point(115, 145), c);
    assert.deepEqual([p.X, p.Y], [10, 20]);
});
