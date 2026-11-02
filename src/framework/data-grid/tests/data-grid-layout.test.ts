import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Visual } from '../../../runtime/index.js';
import { HeadlessTarget } from '../../../visual-engine/index.js';
import { StackPanel } from '../../../basic/panels/stack-panel.js';
import { Grid, GridLength, GridUnitType } from '../../../basic/panels/grid.js';
import { TextBlock } from '../../../basic/text-block.js';
import { DataGrid, DataGridRow } from '../data-grid.js';
import { DataGridTextColumn } from '../data-grid-column.js';

class Row
{
    constructor(
        public readonly A: string,
        public readonly B: string,
        public readonly C: string,
    )
    {
    }
}

class LayoutHarness
{
    public static readonly Width = 600;

    public static Column(header: string, path: string, width: GridLength): DataGridTextColumn
    {
        const col = new DataGridTextColumn();
        col.Header = header;
        col.BindingPath = path;
        col.Width = width;
        return col;
    }

    public static Mount(...grids: DataGrid[]): HeadlessTarget
    {
        const root = new StackPanel();
        for (const g of grids)
        {
            root.AddChild(g);
        }
        const target = new HeadlessTarget(LayoutHarness.Width, 600, root);
        target.Flush();
        return target;
    }

    public static Build(items: Row[]): DataGrid
    {
        const grid = new DataGrid();
        grid.Columns.Add(LayoutHarness.Column('A', 'A', new GridLength(80, GridUnitType.Pixel)));
        grid.Columns.Add(LayoutHarness.Column('B', 'B', GridLength.Star));
        grid.Columns.Add(LayoutHarness.Column('C', 'C', GridLength.Auto));
        grid.ItemsSource = items;
        return grid;
    }

    public static Walk(v: Visual, out: Visual[] = []): Visual[]
    {
        out.push(v);
        for (const c of v.visualChildren)
        {
            LayoutHarness.Walk(c, out);
        }
        return out;
    }

    // The header Grid and each row's content Grid, as lists of arranged cell visuals.
    public static HeaderCells(grid: DataGrid): Visual[]
    {
        const band = grid.visualChildren[0]!.FindName(DataGrid.HeaderBandPartName)!;
        const g = band.visualChildren[0] as Grid;
        return [...g.visualChildren];
    }

    // Absolute X of the first TextBlock under a cell, summing ArrangedRect.X up to the root.
    public static TextX(cell: Visual): number
    {
        const tb = LayoutHarness.Walk(cell).find(v => v instanceof TextBlock);
        assert.ok(tb !== undefined, 'cell has a TextBlock');
        let x = 0;
        for (let v: Visual | undefined = tb; v !== undefined; v = v.visualParent as Visual | undefined)
        {
            x += v.ArrangedRect.X;
        }
        return x;
    }

    public static RowCells(grid: DataGrid): Visual[][]
    {
        const rows = LayoutHarness.Walk(grid).filter(v => v instanceof DataGridRow) as DataGridRow[];
        return rows.map(r => [...(r.Content as Grid).visualChildren]);
    }
}

describe('DataGrid layout', () =>
{
    beforeEach(initTestApp);

    test('header and data cells align for Pixel, Star and Auto columns', () =>
    {
        const grid = LayoutHarness.Build([new Row('a1', 'b1', 'c'), new Row('a2', 'b2', 'much longer auto')]);
        LayoutHarness.Mount(grid);
        const header = LayoutHarness.HeaderCells(grid);
        const rows = LayoutHarness.RowCells(grid);
        assert.equal(header.length, 3);
        assert.equal(rows.length, 2);
        for (let i = 0; i < 3; i++)
        {
            for (const r of rows)
            {
                assert.equal(r[i]!.ArrangedRect.X, header[i]!.ArrangedRect.X, `col ${i} X`);
                assert.equal(r[i]!.ArrangedRect.Width, header[i]!.ArrangedRect.Width, `col ${i} W`);
            }
        }
        assert.equal(header[0]!.ArrangedRect.Width, 80);
    });

    test('header text and data text share the same absolute X in every column', () =>
    {
        const grid = LayoutHarness.Build([new Row('a1', 'b1', 'c'), new Row('a2', 'b2', 'wide auto')]);
        LayoutHarness.Mount(grid);
        const header = LayoutHarness.HeaderCells(grid);
        const rows = LayoutHarness.RowCells(grid);
        for (let i = 0; i < 3; i++)
        {
            const hx = LayoutHarness.TextX(header[i]!);
            for (const r of rows)
            {
                assert.equal(LayoutHarness.TextX(r[i]!), hx, `col ${i} text X`);
            }
        }
    });

    test('Auto column sizes to the widest cell in a non-first row', () =>
    {
        const grid = LayoutHarness.Build([new Row('a', 'b', 'x'), new Row('a', 'b', 'a considerably wider value')]);
        LayoutHarness.Mount(grid);
        const header = LayoutHarness.HeaderCells(grid);
        const rows = LayoutHarness.RowCells(grid);
        const w = rows[1]![2]!.ArrangedRect.Width;
        assert.ok(w > 40, `expected wide auto column, got ${w}`);
        assert.equal(rows[0]![2]!.ArrangedRect.Width, w);
        assert.equal(header[2]!.ArrangedRect.Width, w);
    });

    test('two DataGrids on one target keep independent Auto widths', () =>
    {
        const narrow = LayoutHarness.Build([new Row('a', 'b', 'x')]);
        const wide = LayoutHarness.Build([new Row('a', 'b', 'a considerably wider value')]);
        LayoutHarness.Mount(narrow, wide);
        const wn = LayoutHarness.RowCells(narrow)[0]![2]!.ArrangedRect.Width;
        const ww = LayoutHarness.RowCells(wide)[0]![2]!.ArrangedRect.Width;
        assert.ok(ww > wn, `wide ${ww} should exceed narrow ${wn}`);
    });

    test('header renders one cell per column with zero items', () =>
    {
        const grid = LayoutHarness.Build([]);
        LayoutHarness.Mount(grid);
        assert.equal(LayoutHarness.HeaderCells(grid).length, 3);
    });
});
