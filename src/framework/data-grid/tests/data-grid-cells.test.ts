import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Observable, Visual, DataContextBinding } from '../../../runtime/index.js';
import { TextBlock } from '../../../basic/text-block.js';
import { DataTemplate } from '../../../basic/templates/data-template.js';
import { Checkbox } from '../../toggles/checkbox.js';
import { ToggleButton } from '../../buttons/toggle-button.js';
import { DataGrid, DataGridRow, DataGridCell } from '../data-grid.js';
import { DataGridTextColumn, DataGridTemplateColumn } from '../data-grid-column.js';

class Person extends Observable
{
    private _enabled = false;

    constructor(public readonly Email: string)
    {
        super();
    }

    public get Enabled(): boolean
    {
        return this._enabled;
    }

    public set Enabled(v: boolean)
    {
        const old = this._enabled;
        this._enabled = v;
        this.RaisePropertyChanged('Enabled', old, v);
    }
}

class TreeQuery
{
    public static Collect(v: Visual, out: Visual[] = []): Visual[]
    {
        out.push(v);
        for (const c of v.visualChildren)
        {
            TreeQuery.Collect(c, out);
        }
        return out;
    }

    public static Rows(grid: DataGrid): DataGridRow[]
    {
        return grid.logicalChildren.filter(c => c instanceof DataGridRow) as DataGridRow[];
    }
}

describe('DataGrid cells', () =>
{
    beforeEach(initTestApp);

    test('each row gets one cell per column', () =>
    {
        const grid = new DataGrid();
        const a = new DataGridTextColumn();
        a.BindingPath = 'Email';
        grid.Columns.Add(a);
        grid.Columns.Add(new DataGridTextColumn());
        grid.ItemsSource = [new Person('a'), new Person('b'), new Person('c')];
        const rows = TreeQuery.Rows(grid);
        assert.equal(rows.length, 3);
        for (const row of rows)
        {
            const cells = TreeQuery.Collect(row).filter(v => v instanceof DataGridCell);
            assert.equal(cells.length, 2);
        }
    });

    test('text-column cell shows the bound field', () =>
    {
        const grid = new DataGrid();
        const col = new DataGridTextColumn();
        col.BindingPath = 'Email';
        grid.Columns.Add(col);
        grid.ItemsSource = [new Person('x@y.com')];
        const row = TreeQuery.Rows(grid)[0]!;
        const tb = TreeQuery.Collect(row).find(v => v instanceof TextBlock) as TextBlock;
        assert.equal(tb.Text, 'x@y.com');
    });

    test('template-column cell instantiates its CellTemplate', () =>
    {
        const grid = new DataGrid();
        const col = new DataGridTemplateColumn();
        col.CellTemplate = new DataTemplate(() => new Checkbox());
        grid.Columns.Add(col);
        grid.ItemsSource = [new Person('a')];
        const row = TreeQuery.Rows(grid)[0]!;
        assert.ok(TreeQuery.Collect(row).some(v => v instanceof Checkbox));
    });

    test('template-column CheckBox two-way binding writes back to the item', () =>
    {
        const grid = new DataGrid();
        const col = new DataGridTemplateColumn();
        col.CellTemplate = new DataTemplate(() =>
        {
            const cb = new Checkbox();
            cb.set_property_value(ToggleButton.IsCheckedKey, DataContextBinding(cb, 'Enabled') as unknown as boolean);
            return cb;
        });
        grid.Columns.Add(col);
        const p = new Person('a');
        grid.ItemsSource = [p];
        const row = TreeQuery.Rows(grid)[0]!;
        const cb = TreeQuery.Collect(row).find(v => v instanceof Checkbox) as Checkbox;
        cb.IsChecked = true;
        assert.equal(p.Enabled, true);
    });
});
