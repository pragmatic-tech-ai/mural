import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BoardDocument } from '../board-document.js';
import { Figure } from '../figure.js';
import { GeometryCombineMode } from '../commands/combine.js';

// Pure document-mutation tests for CombineSelection emitting Figure.
// No layout / Application needed — these exercise the mutation API only.
describe('CombineSelection emits Figure (M2)', () => {

    test('Union of two rectangles produces one Figure with defined Geometry', () => {
        const doc = new BoardDocument();
        const a = doc.CreateNode('rectangle',  0, 0)!;
        const b = doc.CreateNode('rectangle', 40, 0)!;
        assert.ok(a instanceof Figure, 'CreateNode should return Figure');
        assert.ok(b instanceof Figure, 'CreateNode should return Figure');
        const before = doc.Nodes.Count;  // 2

        doc.CombineSelection([a, b], GeometryCombineMode.Union);

        assert.equal(doc.Nodes.Count, before - 1,
            `Combine should collapse ${before} nodes to ${before - 1}; got ${doc.Nodes.Count}`);

        const remaining = doc.Nodes.Get(0)!;
        assert.ok(remaining instanceof Figure,
            'Remaining node must be a Figure');
        assert.notEqual(remaining.Geometry, undefined,
            'Combined Figure must have a defined Geometry');

        // Inputs must no longer be in Nodes.
        assert.equal(doc.Nodes.IndexOf(a), -1, 'Input a must be removed from Nodes');
        assert.equal(doc.Nodes.IndexOf(b), -1, 'Input b must be removed from Nodes');
    });

    test('Fewer than two Figure leaves is a no-op', () => {
        const doc = new BoardDocument();
        const a = doc.CreateNode('rectangle', 0, 0)!;
        const before = doc.Nodes.Count;  // 1

        doc.CombineSelection([a], GeometryCombineMode.Union);

        assert.equal(doc.Nodes.Count, before, 'Single-item combine must leave Nodes unchanged');
    });

    test('Non-Figure items in selection are ignored; Figures are combined', () => {
        const doc = new BoardDocument();
        const a = doc.CreateNode('rectangle',  0, 0)!;
        const b = doc.CreateNode('rectangle', 40, 0)!;
        const before = doc.Nodes.Count;  // 2

        // Pass a foreign object alongside the two VMs — should not crash,
        // and should still combine a + b.
        const foreign = { unrelated: true };
        doc.CombineSelection([a, foreign, b], GeometryCombineMode.Union);

        assert.equal(doc.Nodes.Count, before - 1,
            `Foreign items must be skipped; combined ${before} → ${before - 1}`);
        const remaining = doc.Nodes.Get(0)!;
        assert.ok(remaining instanceof Figure, 'Remaining node must be Figure');
    });

    test('Status message reflects combine mode after successful combine', () => {
        const doc = new BoardDocument();
        const a = doc.CreateNode('rectangle',  0, 0)!;
        const b = doc.CreateNode('rectangle', 40, 0)!;

        doc.CombineSelection([a, b], GeometryCombineMode.Union);

        assert.ok(doc.Status.includes('Union'),
            `Status should mention the combine mode; got: "${doc.Status}"`);
    });

});
