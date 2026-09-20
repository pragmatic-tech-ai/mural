import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Panel, Element, Size, type DrawingContext } from '../../runtime/index.js';

class Leaf extends Element
{
    protected override MeasureOverride(_a: Size): Size { return new Size(10, 10); }
    protected override RenderOverride(_dc: DrawingContext): void { }
}

class TestPanel extends Panel { }

describe('Panel.InsertVisualChild — clamps an out-of-range index', () => {
    test('an index past the child count appends instead of throwing', () => {
        // A host that reparents some containers OUT of the panel (a diagram
        // container adopting nested figures) leaves fewer visual children than the
        // items it syncs at item indices — so an insert index can exceed the count.
        const panel = new TestPanel();
        const a = new Leaf(); const b = new Leaf();
        panel.InsertVisualChild(0, a);
        panel.InsertVisualChild(1, b);
        assert.equal(panel.visualChildren.length, 2);

        const c = new Leaf();
        // Index 5 is out of range for a 2-child panel — clamp to append, no throw.
        assert.doesNotThrow(() => panel.InsertVisualChild(5, c));
        assert.equal(panel.visualChildren.length, 3, 'the child was appended');
        assert.equal(panel.visualChildren[2], c, 'appended at the end');
    });

    test('an in-range index still inserts at that exact slot', () => {
        const panel = new TestPanel();
        const a = new Leaf(); const b = new Leaf(); const mid = new Leaf();
        panel.InsertVisualChild(0, a);
        panel.InsertVisualChild(1, b);
        panel.InsertVisualChild(1, mid);   // valid middle insert — unchanged behavior
        assert.equal(panel.visualChildren[1], mid, 'inserted at the requested slot');
        assert.equal(panel.visualChildren.length, 3);
    });
});
