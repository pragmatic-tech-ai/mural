import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Point, Size, type Geometry } from '../../../visual-engine/index.js';
import { Figure } from '../figure.js';
import { BoardDocument } from '../board-document.js';
import { serializerFor, serializerByType } from '../serialization/node-serialization.js';
import '../serialization/node-serializers-default.js';   // side-effect: registers serializers

test('CreateNode produces a self-painting Figure shape node', () => {
    const doc = new BoardDocument();
    const node = doc.CreateNode('diamond', 10, 20);
    assert.ok(node instanceof Figure, 'CreateNode returns a Figure');
    assert.equal(node!.Kind, 'diamond');
    assert.ok(node!._getSource() !== undefined, 'has a silhouette source');
    assert.ok(doc.Nodes.IndexOf(node!) >= 0, 'added to Nodes');
});

test('a created diamond confines picking to its silhouette', () => {
    const doc = new BoardDocument();
    const f = doc.CreateNode('diamond', 0, 0)!;
    f.Width = 80; f.Height = 60;
    const seams = f as unknown as { buildClipGeometry(s: Size): Geometry };
    const g = seams.buildClipGeometry(new Size(80, 60));
    assert.ok(g.Contains(new Point(40, 30)), 'interior inside');
    assert.ok(!g.Contains(new Point(2, 2)), 'bbox corner outside the diamond');
});

test('the shape serializer round-trips a Figure (content only)', () => {
    const doc = new BoardDocument();
    const f = doc.CreateNode('ellipse', 5, 6)!;
    f.Width = 50; f.Height = 30;
    const s = serializerFor(f);
    assert.ok(s !== undefined && s.type === 'shape', 'shape serializer matches a Figure');
    const data = s!.serialize(f);
    assert.equal(data.kind, 'ellipse');
    // Geometry-free: the serializer builds the content at the origin; the
    // document applies position + id from the visuals section.
    const back = s!.deserialize(data);
    assert.ok(back instanceof Figure);
    assert.equal((back as Figure).Kind, 'ellipse');
    assert.equal(back.Left, 0, 'built at the origin, no geometry from the serializer');
});

test('a shape record (kind + d) builds a Figure of that kind', () => {
    const s = serializerByType('shape')!;
    const back = s.deserialize({ kind: 'triangle', d: '' });
    assert.ok(back instanceof Figure);
    assert.equal((back as Figure).Kind, 'triangle');
});
