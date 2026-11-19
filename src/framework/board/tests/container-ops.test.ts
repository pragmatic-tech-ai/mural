import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../../runtime/index.js';
import { Figure } from '../figure.js';
import { ContainerFigure, CONTAINER_PADDING, CONTAINER_TITLE_BAND } from '../container-figure.js';
import { wrapTargets, selectedContainers, containerGeometryFor } from '../commands/container-ops.js';

function app(): void { Application.current = null; new Application(); }
function rect(l: number, t: number, w = 40, h = 30): Figure { return Figure.fromKind('rectangle', l, t, { width: w, height: h }); }

test('wrapTargets keeps top-level Figures, drops nested and non-Figures', () => {
    app();
    const a = rect(10, 10);
    const b = rect(100, 10);
    const nested = rect(5, 5); (nested as unknown as { ContainerParent: unknown }).ContainerParent = a; // simulate nested
    const targets = wrapTargets([a, b, nested, { notAFigure: true }]);
    assert.deepEqual(targets, [a, b]);
});

test('selectedContainers keeps only ContainerFigures', () => {
    app();
    const c = Figure.fromKind('container', 0, 0) as ContainerFigure;
    const r = rect(0, 0);
    assert.deepEqual(selectedContainers([r, c]), [c]);
});

test('containerGeometryFor encloses the union inset below the title band', () => {
    app();
    // two root nodes: union = (10,10)..(140,40) → w=130, h=30.
    const a = rect(10, 10, 40, 30);   // 10..50 x 10..40
    const b = rect(100, 20, 40, 20);  // 100..140 x 20..40
    const box = containerGeometryFor([a, b]);
    // left = unionX - ContentOrigin.X - PAD = 10 - 8 - 8 = -6
    // top  = unionY - ContentOrigin.Y - PAD = 10 - 32 - 8 = -30
    // width  = unionW + ContentOrigin.X + 2*PAD = 130 + 8 + 16 = 154
    // height = unionH + ContentOrigin.Y + 2*PAD = 30 + 32 + 16 = 78
    assert.deepEqual([box.left, box.top, box.width, box.height], [-6, -30, 154, 78]);
    // sanity: the origin constants are the ones we reasoned from.
    assert.equal(CONTAINER_PADDING, 8);
    assert.equal(CONTAINER_TITLE_BAND, 24);
});
