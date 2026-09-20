import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Rect, Size, Element, Visual } from '../../runtime/index.js';
import { UniformGrid } from '../panels/uniform-grid.js';

class FixedSizeLeaf extends Element
{
    constructor(private box: Size) { super(); }
    protected override MeasureOverride(_a: Size): Size { return this.box; }
}

function leaves(n: number, w = 10, h = 10): FixedSizeLeaf[]
{
    const out: FixedSizeLeaf[] = [];
    for (let i = 0; i < n; i++) out.push(new FixedSizeLeaf(new Size(w, h)));
    return out;
}

describe('UniformGrid — DP defaults', () => {
    test('Rows / Columns / FirstColumn all default to 0', () => {
        const g = new UniformGrid();
        assert.equal(g.Rows, 0);
        assert.equal(g.Columns, 0);
        assert.equal(g.FirstColumn, 0);
    });
});

describe('UniformGrid — dimension auto-resolution', () => {
    test('both 0 → square-ish grid via ceil(sqrt(n))', () => {
        const g = new UniformGrid();
        for (const c of leaves(9)) g.AddChild(c);
        // 9 children → sqrt(9) = 3 → 3×3 grid; each cell of a 90×90
        // panel is 30×30, so child[8] sits at (60,60).
        g.Measure(new Size(90, 90));
        g.Arrange(new Rect(0, 0, 90, 90));
        const last = g.visualChildren[8]!;
        assert.deepEqual([last.ArrangedRect.X, last.ArrangedRect.Y],
                         [60, 60]);
    });

    test('Columns set explicitly; Rows derives from child count', () => {
        const g = new UniformGrid();
        g.Columns = 4;
        for (const c of leaves(10)) g.AddChild(c);
        // 10 children at 4 cols → 3 rows. Last child lands at row 2 col 1.
        g.Measure(new Size(80, 60));
        g.Arrange(new Rect(0, 0, 80, 60));
        const cellW = 80 / 4, cellH = 60 / 3;
        const last = g.visualChildren[9]!;
        assert.equal(last.ArrangedRect.X, 1 * cellW);
        assert.equal(last.ArrangedRect.Y, 2 * cellH);
    });

    test('Rows set explicitly; Columns derives from child count', () => {
        const g = new UniformGrid();
        g.Rows = 2;
        for (const c of leaves(7)) g.AddChild(c);
        // 7 children at 2 rows → 4 cols. Last child = index 6 → row 1 col 2.
        g.Measure(new Size(80, 40));
        g.Arrange(new Rect(0, 0, 80, 40));
        const cellW = 80 / 4, cellH = 40 / 2;
        const last = g.visualChildren[6]!;
        assert.equal(last.ArrangedRect.X, 2 * cellW);
        assert.equal(last.ArrangedRect.Y, 1 * cellH);
    });

    test('Rows AND Columns both set — overflow children clip silently', () => {
        const g = new UniformGrid();
        g.Rows    = 2;
        g.Columns = 2;
        const all = leaves(6);
        for (const c of all) g.AddChild(c);
        g.Measure(new Size(40, 40));
        g.Arrange(new Rect(0, 0, 40, 40));
        // First 4 children fill the 2×2 grid; child[4] and child[5] don't
        // get arranged. Their ArrangedRect stays at default.
        assert.deepEqual([all[0]!.ArrangedRect.X, all[0]!.ArrangedRect.Y], [0, 0]);
        assert.deepEqual([all[3]!.ArrangedRect.X, all[3]!.ArrangedRect.Y], [20, 20]);
        // child[4] never arranged — ArrangedRect stays at (0,0,0,0).
        assert.equal(all[4]!.ArrangedRect.Width,  0);
        assert.equal(all[4]!.ArrangedRect.Height, 0);
    });
});

describe('UniformGrid — FirstColumn offset', () => {
    test('FirstColumn=2 leaves the first two cells empty', () => {
        const g = new UniformGrid();
        g.Rows        = 2;
        g.Columns     = 4;
        g.FirstColumn = 2;
        const all = leaves(4);
        for (const c of all) g.AddChild(c);
        g.Measure(new Size(40, 20));
        g.Arrange(new Rect(0, 0, 40, 20));
        const cellW = 10, cellH = 10;
        // child[0] starts at cell 2 (row 0 col 2)
        assert.equal(all[0]!.ArrangedRect.X, 2 * cellW);
        assert.equal(all[0]!.ArrangedRect.Y, 0);
        // child[2] wraps to (row 1 col 0)
        assert.equal(all[2]!.ArrangedRect.X, 0);
        assert.equal(all[2]!.ArrangedRect.Y, 1 * cellH);
    });

    test('FirstColumn >= Columns is silently clamped to 0', () => {
        const g = new UniformGrid();
        g.Rows        = 1;
        g.Columns     = 3;
        g.FirstColumn = 99;
        const all = leaves(2);
        for (const c of all) g.AddChild(c);
        g.Measure(new Size(30, 10));
        g.Arrange(new Rect(0, 0, 30, 10));
        // FirstColumn was clamped to 0, so child[0] sits at column 0.
        assert.equal(all[0]!.ArrangedRect.X, 0);
        assert.equal(all[1]!.ArrangedRect.X, 10);
    });

    test('Negative FirstColumn is silently clamped to 0', () => {
        const g = new UniformGrid();
        g.Rows        = 1;
        g.Columns     = 2;
        g.FirstColumn = -5;
        const all = leaves(2);
        for (const c of all) g.AddChild(c);
        g.Measure(new Size(20, 10));
        g.Arrange(new Rect(0, 0, 20, 10));
        assert.equal(all[0]!.ArrangedRect.X, 0);
        assert.equal(all[1]!.ArrangedRect.X, 10);
    });
});

describe('UniformGrid — measure', () => {
    test('DesiredSize = (maxChildW × cols, maxChildH × rows)', () => {
        const g = new UniformGrid();
        g.Rows    = 2;
        g.Columns = 3;
        g.AddChild(new FixedSizeLeaf(new Size(10, 10)));
        g.AddChild(new FixedSizeLeaf(new Size(20,  5)));    // widest
        g.AddChild(new FixedSizeLeaf(new Size( 5, 15)));    // tallest
        g.Measure(new Size(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY));
        assert.equal(g.DesiredSize.Width,  20 * 3);
        assert.equal(g.DesiredSize.Height, 15 * 2);
    });

    test('each child sees the cell-sized constraint at measure', () => {
        // The cell-sized constraint is what makes a UniformGrid behave
        // like a grid: a child that wants to be 1000×1000 still
        // measures against (availW/cols, availH/rows) and arranges into
        // that cell.
        let observed: Size | undefined;
        class Probe extends Element
        {
            protected override MeasureOverride(a: Size): Size
            {
                observed = a;
                return new Size(0, 0);
            }
        }
        const g = new UniformGrid();
        g.Rows    = 2;
        g.Columns = 4;
        g.AddChild(new Probe());
        g.Measure(new Size(80, 40));
        // 80 / 4 = 20, 40 / 2 = 20
        assert.equal(observed?.Width,  20);
        assert.equal(observed?.Height, 20);
    });

    test('empty grid measures to Size.Zero', () => {
        const g = new UniformGrid();
        g.Measure(new Size(100, 100));
        assert.equal(g.DesiredSize.Width,  0);
        assert.equal(g.DesiredSize.Height, 0);
    });
});

describe('UniformGrid — arrange', () => {
    test('row-major fill — index k lands at (row=k÷cols, col=k mod cols)', () => {
        const g = new UniformGrid();
        g.Rows    = 3;
        g.Columns = 2;
        const all = leaves(6);
        for (const c of all) g.AddChild(c);
        g.Arrange(new Rect(0, 0, 40, 60));      // arranges without measure pass
        // Each cell is 20×20.
        const expected = [
            [0,  0],   // index 0: row 0 col 0
            [20, 0],   // index 1: row 0 col 1
            [0, 20],   // index 2: row 1 col 0
            [20, 20],  // index 3: row 1 col 1
            [0, 40],   // index 4: row 2 col 0
            [20, 40],  // index 5: row 2 col 1
        ];
        for (let i = 0; i < expected.length; i++)
        {
            const [x, y] = expected[i]!;
            assert.equal(all[i]!.ArrangedRect.X, x, `child ${i} X`);
            assert.equal(all[i]!.ArrangedRect.Y, y, `child ${i} Y`);
        }
    });

    test('cell size = finalSize / (cols, rows)', () => {
        const g = new UniformGrid();
        g.Rows    = 2;
        g.Columns = 5;
        const all = leaves(10);
        for (const c of all) g.AddChild(c);
        g.Measure(new Size(100, 40));
        g.Arrange(new Rect(0, 0, 100, 40));
        assert.equal(all[0]!.ArrangedRect.Width,  20);
        assert.equal(all[0]!.ArrangedRect.Height, 20);
    });
});
