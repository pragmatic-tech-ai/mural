import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Figure } from '../figure.js';
import { SHAPE_CATALOG_MAP } from '../shape-catalog.js';

test('fromKind records the catalog kind as inert provenance', () => {
    const f = Figure.fromKind('diamond', 0, 0, { width: 40, height: 40 });
    assert.equal(f.Kind, 'diamond');
});

test('a bare Figure and a kindless fromSource have undefined Kind', () => {
    assert.equal(new Figure().Kind, undefined);
    const src = SHAPE_CATALOG_MAP.get('ellipse')!.unit();
    const f = Figure.fromSource(src, 0, 0, { width: 40, height: 40 });
    assert.equal(f.Kind, undefined);
});

test('fromSource carries an explicit kind option through', () => {
    const src = SHAPE_CATALOG_MAP.get('ellipse')!.unit();
    const f = Figure.fromSource(src, 0, 0, { width: 40, height: 40, kind: 'ellipse' });
    assert.equal(f.Kind, 'ellipse');
});
