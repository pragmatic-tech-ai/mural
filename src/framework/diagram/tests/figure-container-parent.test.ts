import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../../runtime/index.js';
import { Figure } from '../figure.js';
import { diagramSpaceRect } from '../coordinate-space.js';

function fig(l: number, t: number): Figure
{
    Application.current = null; new Application();
    return Figure.fromKind('rectangle', l, t, { width: 40, height: 30 });
}

test('base Figure: ContentOrigin is (0,0) and ContainerParent defaults undefined', () => {
    const f = fig(5, 6);
    assert.deepEqual([f.ContentOrigin.X, f.ContentOrigin.Y], [0, 0]);
    assert.equal(f.ContainerParent, undefined);
});

test('diagramSpaceRect uses a Figure ContainerParent link', () => {
    const parent = fig(100, 100);
    const child = fig(10, 20);
    child.ContainerParent = parent;
    const r = diagramSpaceRect(child);
    // base ContentOrigin (0,0): 100+0+10, 100+0+20
    assert.deepEqual([r.X, r.Y], [110, 120]);
});
