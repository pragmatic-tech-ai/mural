import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Visual } from '../../../runtime/index.js';
import { ItemsPresenter } from '../../../basic/templates/items-presenter.js';
import { StackPanel } from '../../../basic/panels/stack-panel.js';
import { ScrollViewer } from '../../surfaces/scroll-viewer.js';
import { DataGrid, DataGridRow } from '../data-grid.js';

class VisualTreeWalker
{
    public static Collect(v: Visual, out: Visual[] = []): Visual[]
    {
        out.push(v);
        for (const c of v.visualChildren)
        {
            VisualTreeWalker.Collect(c, out);
        }
        return out;
    }
}

describe('DataGrid render', () =>
{
    beforeEach(initTestApp);

    test('DataGrid applies its default style and template parts', () =>
    {
        const grid = new DataGrid();
        const root = grid.visualChildren[0]!;
        assert.ok(root.FindName(DataGrid.ScrollPartName) instanceof ScrollViewer);
        const band = root.FindName(DataGrid.HeaderBandPartName);
        assert.ok(band instanceof StackPanel);
        assert.equal(band.visualChildren.length, 0);
        const all = VisualTreeWalker.Collect(grid);
        assert.ok(all.some(v => v instanceof ItemsPresenter));
    });

    test('empty grid with no columns and no items renders without throwing', () =>
    {
        const grid = new DataGrid();
        assert.doesNotThrow(() => VisualTreeWalker.Collect(grid));
        assert.equal(grid.Columns.Count, 0);
    });

    test('a one-item ItemsSource yields one DataGridRow container', () =>
    {
        const grid = new DataGrid();
        grid.ItemsSource = [{}];
        const rows = grid.logicalChildren.filter(c => c instanceof DataGridRow);
        assert.equal(rows.length, 1);
    });
});
