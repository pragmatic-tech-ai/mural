import {
    MetaData,
    MuralBase,
    Visual,
    DataContextBinding,
} from '../../runtime/index.js';
import { GridLength } from '../../basic/panels/grid.js';
import { TextBlock } from '../../basic/text-block.js';
import { ContentPresenter } from '../../basic/templates/content-presenter.js';
import type { DataTemplate } from '../../basic/templates/data-template.js';

// Column model for DataGrid. A column is a non-Visual, DP-bearing definition
// object (like ColumnDefinition), so it extends MuralBase. Concrete columns
// build the per-row cell Visual; the header content is built by the column too
// so a template column can customize it.
export abstract class DataGridColumn extends MuralBase
{
    private static readonly HeaderName   = 'Header';
    private static readonly WidthName    = 'Width';
    private static readonly MinWidthName = 'MinWidth';
    private static readonly KeyPrefix    = 'dgcol-';

    private static _nextKey: number = 1;

    public static readonly HeaderKey   = MuralBase.RegisterProperty<unknown>(  DataGridColumn, DataGridColumn.HeaderName,   undefined,       MetaData.None);
    public static readonly WidthKey    = MuralBase.RegisterProperty<GridLength>(DataGridColumn, DataGridColumn.WidthName,    GridLength.Star, MetaData.None);
    public static readonly MinWidthKey = MuralBase.RegisterProperty<number>(    DataGridColumn, DataGridColumn.MinWidthName, 0,               MetaData.None);

    private _key: string | undefined;

    public get Header(): unknown
    {
        return this.get_property_value(DataGridColumn.HeaderKey);
    }

    public set Header(v: unknown)
    {
        this.set_property_value(DataGridColumn.HeaderKey, v);
    }

    public get Width(): GridLength
    {
        return this.get_property_value(DataGridColumn.WidthKey);
    }

    public set Width(v: GridLength)
    {
        this.set_property_value(DataGridColumn.WidthKey, v);
    }

    public get MinWidth(): number
    {
        return this.get_property_value(DataGridColumn.MinWidthKey);
    }

    public set MinWidth(v: number)
    {
        this.set_property_value(DataGridColumn.MinWidthKey, v);
    }

    // Stable, unique identity for this column; assigned lazily on first read.
    public get Key(): string
    {
        if (this._key === undefined)
        {
            this._key = `${DataGridColumn.KeyPrefix}${DataGridColumn._nextKey++}`;
        }
        return this._key;
    }

    public abstract BuildCell(item: unknown): Visual;

    public BuildHeaderContent(): Visual
    {
        return new TextBlock(DataGridColumn.Stringify(this.Header));
    }

    private static Stringify(value: unknown): string
    {
        if (value === undefined || value === null) return '';
        return String(value);
    }
}

export class DataGridTextColumn extends DataGridColumn
{
    private static readonly BindingPathName = 'BindingPath';
    private static readonly EmptyPath = '';

    public static readonly BindingPathKey = MuralBase.RegisterProperty<string>(
        DataGridTextColumn, DataGridTextColumn.BindingPathName, DataGridTextColumn.EmptyPath, MetaData.None);

    public get BindingPath(): string
    {
        return this.get_property_value(DataGridTextColumn.BindingPathKey);
    }

    public set BindingPath(v: string)
    {
        this.set_property_value(DataGridTextColumn.BindingPathKey, v);
    }

    public BuildCell(_item: unknown): Visual
    {
        // BindingPath is snapshotted at build time; changing a column's own properties after build is not observed in v1
        // (whole-column add/remove via DataGrid.Columns is reactive).
        const tb = new TextBlock();
        if (this.BindingPath === DataGridTextColumn.EmptyPath)
        {
            return tb;
        }
        // One-way bind to the field on the cell's inherited DataContext.
        // Safe cast: model.ts:693 exempts Binding instances from DP value validation, so this installs a live binding rather than storing a bad string.
        tb.set_property_value(TextBlock.TextKey, DataContextBinding(tb, this.BindingPath) as unknown as string);
        return tb;
    }
}

export class DataGridTemplateColumn extends DataGridColumn
{
    private static readonly CellTemplateName   = 'CellTemplate';
    private static readonly HeaderTemplateName = 'HeaderTemplate';

    public static readonly CellTemplateKey = MuralBase.RegisterProperty<DataTemplate | undefined>(
        DataGridTemplateColumn, DataGridTemplateColumn.CellTemplateName, undefined, MetaData.None);
    public static readonly HeaderTemplateKey = MuralBase.RegisterProperty<DataTemplate | undefined>(
        DataGridTemplateColumn, DataGridTemplateColumn.HeaderTemplateName, undefined, MetaData.None);

    public get CellTemplate(): DataTemplate | undefined
    {
        return this.get_property_value(DataGridTemplateColumn.CellTemplateKey);
    }

    public set CellTemplate(v: DataTemplate | undefined)
    {
        this.set_property_value(DataGridTemplateColumn.CellTemplateKey, v);
    }

    public get HeaderTemplate(): DataTemplate | undefined
    {
        return this.get_property_value(DataGridTemplateColumn.HeaderTemplateKey);
    }

    public set HeaderTemplate(v: DataTemplate | undefined)
    {
        this.set_property_value(DataGridTemplateColumn.HeaderTemplateKey, v);
    }

    public BuildCell(item: unknown): Visual
    {
        const cp = new ContentPresenter();
        cp.ContentTemplate = this.CellTemplate;
        cp.Content = item;
        return cp;
    }

    public override BuildHeaderContent(): Visual
    {
        const tmpl = this.HeaderTemplate;
        if (tmpl === undefined) return super.BuildHeaderContent();
        const v = tmpl.Apply(this.Header);
        v.DataContext = this.Header;
        return v;
    }
}
