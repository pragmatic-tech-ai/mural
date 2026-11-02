import {
    MetaData,
    MuralBase,
    Element,
    type PropertyDescriptor,
    ObservableCollection,
    Disposable,
    type IDisposable,
    Visual,
    PointerEventArgs,
} from '../../runtime/index.js';
import { ContentControl } from '../base/content-control.js';
import { Selector } from '../list/selector.js';
import { StackPanel } from '../../basic/panels/stack-panel.js';
import { Grid, ColumnDefinition, GridLength } from '../../basic/panels/grid.js';
import { DataGridColumn } from './data-grid-column.js';

// Tabular, column-driven selector built on ItemsControl. This skeleton renders
// its default template (scroll viewer, header band, rows presenter); row cells,
// header population, column alignment and selection arrive in later tasks.
export class DataGrid extends Selector implements IDisposable
{
    static
    {
        MuralBase.OverrideMetadata(DataGrid, Element.DefaultStyleKeyKey, { default_value: DataGrid });
    }

    public static readonly ScrollPartName     = 'PART_Scroll';
    public static readonly HeaderBandPartName = 'PART_HeaderBand';

    private static readonly SharedGroupPrefix    = 'dg';
    private static readonly SharedGroupSeparator = ':';

    private static _nextInstanceId: number = 1;

    private readonly _instanceId: number;
    private readonly _columns = new ObservableCollection<DataGridColumn>();
    private readonly _headerBand: StackPanel | undefined;
    // Columns change subscription; released by dispose(), the control's teardown seam.
    private readonly _columnsSubscription: IDisposable;
    // Item each realized row's content was last built for; guards the
    // Rebind-then-Prepare sequence against building the same row twice.
    private readonly _builtFor = new WeakMap<DataGridRow, unknown>();

    constructor()
    {
        super();
        this._instanceId = DataGrid._nextInstanceId++;
        this.ItemsPanel = () => new StackPanel();
        this.applyDefaultStyle();
        this._headerBand = this.GetTemplateChild(DataGrid.HeaderBandPartName) as StackPanel | undefined;
        this._columnsSubscription = new Disposable(this._columns.Subscribe(() => this.OnColumnsChanged()));
        this.RebuildHeader();
    }

    private OnColumnsChanged(): void
    {
        this.RebuildHeader();
        for (const row of this.Rows)
        {
            this.BuildInto(row, row.Tag);
        }
    }

    // Teardown seam: releases the Columns subscription.
    public dispose(): void
    {
        this._columnsSubscription.dispose();
    }

    // Realized rows in items order; the index space for selection.
    private get Rows(): readonly DataGridRow[]
    {
        return this.logicalChildren.filter(c => c instanceof DataGridRow) as DataGridRow[];
    }

    protected override resolveItemAt(index: number): unknown
    {
        const rows = this.Rows;
        if (index < 0 || index >= rows.length) return undefined;
        return this.exposedValueOf(rows[index]!);
    }

    protected override resolveIndexOf(item: unknown): number
    {
        if (item === undefined) return -1;
        return this.Rows.findIndex(r => r.Tag === item || r === item);
    }

    protected override containerForItem(item: unknown): Visual | undefined
    {
        if (item === undefined) return undefined;
        return this.Rows.find(r => r.Tag === item || r === item);
    }

    protected override getPrimaryIndex(container: Visual): number
    {
        return this.Rows.indexOf(container as DataGridRow);
    }

    public get Columns(): ObservableCollection<DataGridColumn>
    {
        return this._columns;
    }

    public override IsItemItsOwnContainerOverride(item: unknown): boolean
    {
        return item instanceof DataGridRow;
    }

    public override GetContainerForItemOverride(item: unknown): Visual
    {
        const row = new DataGridRow();
        row.Tag         = item;
        row.DataContext = item;
        return row;
    }

    public override PrepareContainerForItemOverride(container: Visual, item: unknown, index: number): void
    {
        super.PrepareContainerForItemOverride(container, item, index);
        if (container instanceof DataGridRow
            && !(this._builtFor.has(container) && this._builtFor.get(container) === item))
        {
            this.BuildInto(container, item);
        }
    }

    public override RebindContainerForItemOverride(container: Visual, item: unknown): void
    {
        // Tag/DataContext/cells first so the base's selection re-sync sees the NEW item, not the pooled row's stale Tag.
        if (container instanceof DataGridRow)
        {
            container.Tag         = item;
            container.DataContext = item;
            this.BuildInto(container, item);
        }
        super.RebindContainerForItemOverride(container, item);
    }

    public override ClearContainerForItemOverride(container: Visual, item: unknown): void
    {
        if (container instanceof DataGridRow)
        {
            container.Content = undefined;
            this._builtFor.delete(container);
        }
        super.ClearContainerForItemOverride(container, item);
    }

    private BuildInto(row: DataGridRow, item: unknown): void
    {
        row.Content = this.BuildRowContent(item);
        this._builtFor.set(row, item);
    }

    // Fresh definitions per call: a ColumnDefinition belongs to exactly one Grid.
    private BuildColumnDefinitions(): ColumnDefinition[]
    {
        const defs: ColumnDefinition[] = [];
        for (const column of this._columns)
        {
            const def = new ColumnDefinition();
            const width = column.Width;
            if (width.IsAuto)
            {
                def.Width           = GridLength.Auto;
                def.SharedSizeGroup = this.SharedGroupName(column.Key);
            }
            else
            {
                def.Width = width;
            }
            def.MinWidth = column.MinWidth;
            defs.push(def);
        }
        return defs;
    }

    private SharedGroupName(columnKey: string): string
    {
        return `${DataGrid.SharedGroupPrefix}${this._instanceId}${DataGrid.SharedGroupSeparator}${columnKey}`;
    }

    private RebuildHeader(): void
    {
        const band = this._headerBand;
        if (band === undefined) return;
        for (const child of [...band.visualChildren])
        {
            band.RemoveChild(child);
        }
        const grid = new Grid();
        for (const def of this.BuildColumnDefinitions())
        {
            grid.ColumnDefinitions.Add(def);
        }
        let i = 0;
        for (const column of this._columns)
        {
            // Same DataGridCell wrapper as data cells so header text gets identical padding.
            const cell = new DataGridCell();
            cell.Content = column.BuildHeaderContent();
            Grid.SetColumn(cell, i);
            grid.AddChild(cell);
            i++;
        }
        if (grid.ColumnDefinitions.Count > 0)
        {
            band.AddChild(grid);
        }
    }

    private BuildRowContent(item: unknown): Visual
    {
        const grid = new Grid();
        for (const def of this.BuildColumnDefinitions())
        {
            grid.ColumnDefinitions.Add(def);
        }
        let i = 0;
        for (const column of this._columns)
        {
            const cell = new DataGridCell();
            cell.Content = column.BuildCell(item);
            Grid.SetColumn(cell, i);
            grid.AddChild(cell);
            i++;
        }
        return grid;
    }
}

export class DataGridRow extends ContentControl
{
    static
    {
        MuralBase.OverrideMetadata(DataGridRow, Element.DefaultStyleKeyKey, { default_value: DataGridRow });
    }

    private static readonly IsSelectedName = 'IsSelected';

    // Instance mirror of the attached Selector.IsSelected so the template's
    // `when (IsSelected)` trigger can observe it (same scheme as ListBoxItem).
    public static readonly IsSelectedKey = MuralBase.RegisterProperty<boolean>(
        DataGridRow, DataGridRow.IsSelectedName, false, MetaData.Render);

    private _syncingIsSelected = false;
    private _pressOriginatedHere = false;

    constructor()
    {
        super();
        this.Focusable = true;
        this.applyDefaultStyle();
    }

    public get IsSelected(): boolean
    {
        return Selector.GetIsSelected(this);
    }

    public set IsSelected(v: boolean)
    {
        Selector.SetIsSelected(this, v);
    }

    protected override OnPointerDown(_args: PointerEventArgs): void
    {
        this._pressOriginatedHere = true;
    }

    // Press-here-release-here gate; delegates selection to the owning Selector.
    protected override OnPointerUp(args: PointerEventArgs): void
    {
        const fire = this._pressOriginatedHere && this.IsMouseOver;
        this._pressOriginatedHere = false;
        if (!fire) return;
        args.SetFocus(this);
        const owner = Selector.FromContainer<Selector>(
            this, (v: Visual): v is Selector => v instanceof Selector);
        if (owner !== undefined) owner.HandleContainerClick(this, args.Modifiers);
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue: unknown,
        newValue: unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (this._syncingIsSelected) return;
        if (descriptor.Name !== DataGridRow.IsSelectedName) return;
        const fromAttached = descriptor.Owner === Selector;
        const fromInstance = descriptor.Owner === DataGridRow;
        if (!fromAttached && !fromInstance) return;
        this._syncingIsSelected = true;
        try
        {
            if (fromAttached)
            {
                this.set_property_value(DataGridRow.IsSelectedKey, newValue as boolean);
            }
            else
            {
                Selector.SetIsSelected(this, newValue as boolean);
            }
        }
        finally
        {
            this._syncingIsSelected = false;
        }
    }
}

export class DataGridCell extends ContentControl
{
    static
    {
        MuralBase.OverrideMetadata(DataGridCell, Element.DefaultStyleKeyKey, { default_value: DataGridCell });
    }

    constructor()
    {
        super();
        this.applyDefaultStyle();
    }
}
