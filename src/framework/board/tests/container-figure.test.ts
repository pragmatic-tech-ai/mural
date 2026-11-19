import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Panel } from '../../../runtime/index.js';
import { ContainerFigure, CONTAINER_TITLE_BAND, CONTAINER_PADDING } from '../container-figure.js';
import { Figure } from '../figure.js';

test('ContainerFigure exposes a ChildHost panel after style resolution', () => {
    initTestApp();
    const c = new ContainerFigure();
    assert.ok(c.ChildHost instanceof Panel, 'PART_ChildContainer should resolve to a Panel');
});

test('ContentOrigin reserves the title band + padding', () => {
    initTestApp();
    const c = new ContainerFigure();
    assert.equal(c.ContentOrigin.X, CONTAINER_PADDING);
    assert.equal(c.ContentOrigin.Y, CONTAINER_TITLE_BAND + CONTAINER_PADDING);
});

test("Figure.fromKind('container') yields a ContainerFigure", () => {
    initTestApp();
    const c = Figure.fromKind('container', 3, 4, { width: 160, height: 120 });
    assert.ok(c instanceof ContainerFigure);
    assert.equal(c.Left, 3); assert.equal(c.Top, 4);
    assert.equal(c.Width, 160); assert.equal(c.Height, 120);
});
