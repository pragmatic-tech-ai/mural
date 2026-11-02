import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';

import { Observable, DataContextBinding } from '../../../runtime/index.js';
import { GridLength } from '../../../basic/panels/grid.js';
import { TextBlock } from '../../../basic/text-block.js';
import { ContentPresenter } from '../../../basic/templates/content-presenter.js';
import { DataTemplate } from '../../../basic/templates/data-template.js';
import { Checkbox } from '../../toggles/checkbox.js';
import { DataGridTextColumn, DataGridTemplateColumn } from '../data-grid-column.js';

class Person extends Observable
{
    private _name: string;

    constructor(name: string)
    {
        super();
        this._name = name;
    }

    public get Name(): string
    {
        return this._name;
    }

    public set Name(v: string)
    {
        const old = this._name;
        this._name = v;
        this.RaisePropertyChanged('Name', old, v);
    }
}

describe('DataGridColumn model', () =>
{
    beforeEach(() => { initTestApp(); });

    test('text column default Width is Star', () =>
    {
        const col = new DataGridTextColumn();
        assert.equal(col.Width.UnitType, GridLength.Star.UnitType);
        assert.equal(col.Width.Value, GridLength.Star.Value);
    });

    test('column MinWidth defaults to 0', () =>
    {
        assert.equal(new DataGridTextColumn().MinWidth, 0);
    });

    test('column Key is stable and unique', () =>
    {
        const a = new DataGridTextColumn();
        const b = new DataGridTextColumn();
        const c = new DataGridTextColumn();
        assert.equal(a.Key, a.Key);
        assert.match(a.Key, /^dgcol-[0-9]+$/);
        assert.equal(new Set([a.Key, b.Key, c.Key]).size, 3);
    });

    test('text column builds a TextBlock bound to the field', () =>
    {
        const col = new DataGridTextColumn();
        col.BindingPath = 'Name';
        const item = new Person('alice');
        const cell = col.BuildCell(item) as TextBlock;
        assert.ok(cell instanceof TextBlock);
        cell.DataContext = item;
        assert.equal(cell.Text, 'alice');
        item.Name = 'bob';
        assert.equal(cell.Text, 'bob');
    });

    test('template column builds a ContentPresenter from its CellTemplate', () =>
    {
        const col = new DataGridTemplateColumn();
        col.CellTemplate = new DataTemplate(() => new Checkbox());
        const tmpl = col.CellTemplate;
        const item = new Person('x');
        const cell = col.BuildCell(item);
        assert.ok(cell instanceof ContentPresenter);
        assert.equal(cell.Content, item);
        assert.equal(cell.ContentTemplate, tmpl);
        assert.ok(cell.visualChildren[0] instanceof Checkbox);
    });

    test('header content defaults to the stringified Header', () =>
    {
        const col = new DataGridTextColumn();
        col.Header = 'Scopes';
        const h = col.BuildHeaderContent() as TextBlock;
        assert.ok(h instanceof TextBlock);
        assert.equal(h.Text, 'Scopes');
    });

    test('template column HeaderTemplate resolves bindings against the header', () =>
    {
        const col = new DataGridTemplateColumn();
        col.Header = new Person('hdr');
        col.HeaderTemplate = new DataTemplate(() =>
        {
            const tb = new TextBlock();
            tb.set_property_value(TextBlock.TextKey, DataContextBinding(tb, 'Name') as unknown as string);
            return tb;
        });
        const h = col.BuildHeaderContent() as TextBlock;
        assert.equal(h.Text, 'hdr');
    });
});
