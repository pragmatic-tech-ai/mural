import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Point } from '../../../../runtime/index.js';
import { Figure } from '../../figure.js';
import { ToolboxVisualDescriptor } from '../toolbox-visual-descriptor.js';
import { VisualContext } from '../toolbox-visual-resolver.js';
import { ShapeVisualResolver, ShapeVisualResolverKey } from '../shape-visual-resolver.js';
import { ShapeDropFactory } from '../shape-drop-factory.js';
import { ShapeToolboxItem } from '../shape-toolbox-item.js';

test('shape resolver returns a 48x48 non-hit-test Figure for a Tile', () => {
    const r = new ShapeVisualResolver();
    const v = r.Resolve(new ToolboxVisualDescriptor(ShapeVisualResolverKey, 'rectangle'), VisualContext.Tile);
    assert.ok(v instanceof Figure);
    assert.equal((v as Figure).Width, 48);
    assert.equal((v as Figure).Height, 48);
    assert.equal((v as Figure).IsHitTestVisible, false);
});

test('shape factory delegates to mutator.CreateNode and returns the node', () => {
    const created: Array<{ kind: string; x: number; y: number }> = [];
    const sentinel = {};
    const mutator = {
        Group() {}, Ungroup() {}, WrapInContainer() {}, UnwrapContainer() {}, CombineSelection() {}, DeleteNodes() {},
        CreateNode(kind: string, x: number, y: number) { created.push({ kind, x, y }); return sentinel; },
    };
    const factory = new ShapeDropFactory();
    const item = new ShapeToolboxItem('rectangle', 'Rectangle');
    const node = factory.CreateDropped({
        Item: item, Descriptor: item.Descriptor!, Position: new Point(10, 20),
        Board: undefined as never, Mutator: mutator as never,
    });
    assert.equal(node, sentinel);
    assert.deepEqual(created, [{ kind: 'rectangle', x: 10, y: 20 }]);
});

test('ShapeToolboxItem id/descriptor/factory wiring', () => {
    const item = new ShapeToolboxItem('rectangle', 'Rectangle');
    assert.equal(item.Id, 'shape:rectangle');
    assert.equal(item.Label, 'Rectangle');
    assert.equal(item.Descriptor?.Key, 'rectangle');
    assert.equal(item.Descriptor?.ResolverKey, ShapeVisualResolverKey);
});
