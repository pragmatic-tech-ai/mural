import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Rect, Size, Element } from '../../runtime/index.js';
import { WrapPanel } from '../panels/wrap-panel.js';

// A leaf that reports a fixed desired size; ArrangedRect (public on Visual)
// is what the assertions read.
class Leaf extends Element
{
    constructor(private box: Size) { super(); }
    protected override MeasureOverride(_a: Size): Size { return this.box; }
}

function layout(el: Element, w: number, h: number): void
{
    el.Measure(new Size(w, h));
    el.Arrange(new Rect(0, 0, w, h));
}

describe('WrapPanel.IsUniformChildren', () => {
    test('off by default — cells keep each child\'s own size', () => {
        const wp = new WrapPanel();
        const a = new Leaf(new Size(20, 10));
        const b = new Leaf(new Size(40, 30));
        wp.AddChild(a); wp.AddChild(b);
        layout(wp, 200, 200);
        assert.deepEqual([a.ArrangedRect.Width, a.ArrangedRect.Height], [20, 30], 'a keeps its width; line height is the line max');
        assert.deepEqual([b.ArrangedRect.Width, b.ArrangedRect.Height], [40, 30]);
    });

    test('on — every cell is the largest child\'s size, wrapping to fit', () => {
        const wp = new WrapPanel();
        wp.IsUniformChildren = true;
        // largest is 40x30 → cells become 40x30
        const sizes = [[20, 10], [40, 20], [30, 30], [10, 15]] as const;
        const leaves = sizes.map(([w, h]) => new Leaf(new Size(w, h)));
        for (const l of leaves) wp.AddChild(l);
        // width 100 → two 40-wide cells per line (80 <= 100; a third at 120 > 100 wraps)
        layout(wp, 100, 200);
        for (const l of leaves)
        {
            assert.equal(l.ArrangedRect.Width, 40, 'uniform cell width');
            assert.equal(l.ArrangedRect.Height, 30, 'uniform cell height');
        }
        assert.deepEqual([leaves[0]!.ArrangedRect.X, leaves[0]!.ArrangedRect.Y], [0, 0]);
        assert.deepEqual([leaves[1]!.ArrangedRect.X, leaves[1]!.ArrangedRect.Y], [40, 0]);
        assert.deepEqual([leaves[2]!.ArrangedRect.X, leaves[2]!.ArrangedRect.Y], [0, 30]);
        assert.deepEqual([leaves[3]!.ArrangedRect.X, leaves[3]!.ArrangedRect.Y], [40, 30]);
    });
});
