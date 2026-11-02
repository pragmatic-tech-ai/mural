import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { ObservableCollection, PointerButton, toModifierKeys, Visual, type ModifierKeys, type PointerEventInit } from '../../../runtime/index.js';
import { InputManager } from '../../index.js';
import { HeadlessTarget } from '../../../visual-engine/index.js';
import { SelectionMode } from '../../list/selector.js';
import { DataGrid, DataGridRow, DataGridCell } from '../data-grid.js';
import { DataGridTextColumn } from '../data-grid-column.js';

class Person
{
    constructor(public readonly Email: string)
    {
    }
}

class GridFixture
{
    public static Pointer(mods: Partial<ModifierKeys> = {}): PointerEventInit
    {
        return {
            HostX:       0,
            HostY:       0,
            Button:      PointerButton.Primary,
            Buttons:     1,
            Modifiers:   toModifierKeys({ shift: mods.Shift, control: mods.Control, alt: mods.Alt, meta: mods.Meta }),
            PointerId:   0,
            Pressure:    0,
            PointerType: 'mouse',
        };
    }

    public static Column(path: string): DataGridTextColumn
    {
        const c = new DataGridTextColumn();
        c.BindingPath = path;
        return c;
    }

    public static Build(items: Person[], mode?: SelectionMode): DataGrid
    {
        const grid = new DataGrid();
        grid.Columns.Add(GridFixture.Column('Email'));
        if (mode !== undefined) grid.SelectionMode = mode;
        grid.ItemsSource = items;
        const target = new HeadlessTarget(400, 400);
        target.Content = grid;
        target.Flush();
        return grid;
    }

    public static Rows(grid: DataGrid): DataGridRow[]
    {
        return grid.logicalChildren.filter(c => c instanceof DataGridRow) as DataGridRow[];
    }

    public static Cells(root: Visual, out: DataGridCell[] = []): DataGridCell[]
    {
        if (root instanceof DataGridCell) out.push(root);
        for (const c of root.visualChildren) GridFixture.Cells(c, out);
        return out;
    }

    public static Click(im: InputManager, v: Visual, mods: Partial<ModifierKeys> = {}): void
    {
        im.InjectPointerDown(v, GridFixture.Pointer(mods));
        im.InjectPointerUp(v, GridFixture.Pointer(mods));
    }
}

describe('DataGrid selection', () =>
{
    beforeEach(initTestApp);

    test('clicking a row selects its data item', () =>
    {
        const items = [new Person('a'), new Person('b'), new Person('c')];
        const grid = GridFixture.Build(items);
        const rows = GridFixture.Rows(grid);
        GridFixture.Click(new InputManager(), rows[1]!);
        assert.equal(grid.SelectedItem, items[1]);
        assert.equal(grid.SelectedIndex, 1);
        assert.equal(rows[1]!.IsSelected, true);
    });

    test('extended selection with modifiers selects a range', () =>
    {
        const items = [new Person('a'), new Person('b'), new Person('c'), new Person('d')];
        const grid = GridFixture.Build(items, SelectionMode.Extended);
        const rows = GridFixture.Rows(grid);
        const im = new InputManager();
        GridFixture.Click(im, rows[0]!);
        GridFixture.Click(im, rows[2]!, { Shift: true });
        assert.deepEqual(new Set(grid.SelectedItems), new Set([items[0], items[1], items[2]]));
        GridFixture.Click(im, rows[3]!, { Control: true });
        assert.equal(grid.SelectedItems.length, 4);
    });

    test('selection survives items-collection mutation (recycle)', () =>
    {
        const a = new Person('a');
        const b = new Person('b');
        const c = new Person('c');
        const source = new ObservableCollection<Person>();
        source.Add(a);
        source.Add(b);
        source.Add(c);
        const grid = GridFixture.Build([], SelectionMode.Extended);
        grid.ItemsSource = source;
        const im = new InputManager();
        GridFixture.Click(im, GridFixture.Rows(grid)[1]!);
        GridFixture.Click(im, GridFixture.Rows(grid)[2]!, { Control: true });
        assert.equal(grid.SelectedItems.length, 2);
        // Removing an unselected item keeps the others selected (rows get recycled).
        source.Remove(a);
        assert.ok(grid.SelectedItems.includes(b));
        assert.ok(grid.SelectedItems.includes(c));
        assert.equal(grid.SelectedItems.length, 2);
        // Removing a selected item drops it from the selection.
        source.Remove(b);
        assert.ok(!grid.SelectedItems.includes(b));
        assert.ok(grid.SelectedItems.includes(c));
        assert.equal(grid.SelectedItem, c);
    });
});

describe('DataGrid columns mutation', () =>
{
    beforeEach(initTestApp);

    test('adding a column after rows exist adds a cell to every row and a header cell', () =>
    {
        const grid = GridFixture.Build([new Person('a'), new Person('b')]);
        const before = GridFixture.Cells(grid).length;
        grid.Columns.Add(GridFixture.Column('Email'));
        assert.equal(GridFixture.Cells(grid).length, before + 3);
        for (const row of GridFixture.Rows(grid))
        {
            assert.equal(GridFixture.Cells(row).length, 2);
        }
    });

    test('removing a column removes its cells and header cell', () =>
    {
        const grid = GridFixture.Build([new Person('a'), new Person('b')]);
        const extra = GridFixture.Column('Email');
        grid.Columns.Add(extra);
        const before = GridFixture.Cells(grid).length;
        grid.Columns.Remove(extra);
        assert.equal(GridFixture.Cells(grid).length, before - 3);
        for (const row of GridFixture.Rows(grid))
        {
            assert.equal(GridFixture.Cells(row).length, 1);
        }
    });

    test('recycling a row to a new item yields exactly one set of cells', () =>
    {
        const grid = GridFixture.Build([new Person('a'), new Person('b')]);
        grid.Columns.Add(GridFixture.Column('Email'));
        grid.ItemsSource = [new Person('x'), new Person('y')];
        for (const row of GridFixture.Rows(grid))
        {
            assert.equal(GridFixture.Cells(row).length, 2);
        }
    });

    test('dispose stops column changes from touching rows', () =>
    {
        const grid = GridFixture.Build([new Person('a')]);
        grid.dispose();
        grid.Columns.Add(GridFixture.Column('Email'));
        assert.equal(GridFixture.Cells(GridFixture.Rows(grid)[0]!).length, 1);
    });
});
