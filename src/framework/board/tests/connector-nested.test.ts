import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../../runtime/index.js';
import { Figure } from '../figure.js';
import { ContainerFigure } from '../container-figure.js';
import { boardSpaceRect } from '../coordinate-space.js';
import { __nodeRectForTesting } from '../connector.js';

function app(): void { Application.current = null; new Application(); }

test('nodeRect returns the board-space rect for a nested node', () => {
    app();
    const container = new ContainerFigure();
    container.Left = 100; container.Top = 100; container.Width = 220; container.Height = 160;
    const child = Figure.fromKind('rectangle', 22, 18, { width: 30, height: 20 });
    child.ContainerParent = container;   // nested → Left/Top are container-local

    const r = __nodeRectForTesting(child)!;
    const ds = boardSpaceRect(child);
    assert.equal(r.X, ds.X);
    assert.equal(r.Y, ds.Y);
    // container origin (100,100) + ContentOrigin (8,32) + local (22,18)
    assert.equal(r.X, 130);
    assert.equal(r.Y, 150);
    assert.equal(r.Width, 30);
    assert.equal(r.Height, 20);
});

test('nodeRect returns the raw Left/Top rect for a root node', () => {
    app();
    const f = Figure.fromKind('rectangle', 40, 50, { width: 30, height: 20 });
    const r = __nodeRectForTesting(f)!;
    assert.equal(r.X, 40);
    assert.equal(r.Y, 50);
});
