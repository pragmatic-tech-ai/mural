import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Panel } from '../../../runtime/index.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { ContentContainerFigure, CONTAINER_HEADER_BAND } from '../content-container-figure.js';
import { CONTAINER_PADDING, ContainerFigure } from '../container-figure.js';

test('ContentContainerFigure resolves a ChildHost and is a ContainerFigure', () => {
    initTestApp();
    const c = new ContentContainerFigure();
    assert.ok(c instanceof ContainerFigure, 'is-a ContainerFigure (inherits nesting/placement)');
    assert.ok(c.ChildHost instanceof Panel, 'PART_ChildContainer resolves to a Panel');
});

test('ContentOrigin reserves the icon+label header band + padding', () => {
    initTestApp();
    const c = new ContentContainerFigure();
    assert.equal(c.ContentOrigin.X, CONTAINER_PADDING);
    assert.equal(c.ContentOrigin.Y, CONTAINER_HEADER_BAND + CONTAINER_PADDING);
});
