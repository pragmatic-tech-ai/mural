import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Figure } from '../figure.js';
import { resolveDefaultPortProvider } from '../port-providers/default-port-providers.js';
import { BoundingBoxPorts } from '../port-providers/bounding-box-ports.js';

test('Figure exposes Kind as an inert provenance accessor, not a DP', () => {
    const f = Figure.fromKind('ellipse', 0, 0);
    // Kind returns the catalog kind for serialization provenance, but it is a
    // plain read-only getter (no registered KindKey DP) and drives no behavior.
    assert.equal(f.Kind, 'ellipse');
    assert.equal((Figure as unknown as { KindKey?: unknown }).KindKey, undefined);
});

test('fromKind still builds the catalog source (drawable shape)', () => {
    const f = Figure.fromKind('ellipse', 0, 0, { width: 40, height: 40 });
    assert.notEqual(f._getSource(), undefined);
    assert.notEqual(f.Geometry, undefined);   // read-only view over the scaled silhouette
});

test('default ports are bounding-box for every figure', () => {
    assert.ok(resolveDefaultPortProvider() instanceof BoundingBoxPorts);
    const ell = Figure.fromKind('ellipse', 0, 0);
    const tri = Figure.fromKind('triangle', 0, 0);
    assert.ok(ell.Ports.length > 0 && tri.Ports.length > 0);
});
