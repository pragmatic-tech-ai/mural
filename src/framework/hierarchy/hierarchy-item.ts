import { Observable, ObservableCollection } from '../../runtime/index.js';
import type { ItemId } from './item-id.js';
import { NodeSeverity } from './node-severity.js';

// The domain seam HierarchyItem routes user intent through (activation, rename
// commit, removal). Task 11 reconciles the full HierarchyHost to this shape.
export interface IHierarchyItemHost
{
    Activate(item: HierarchyItem): void;
    CommitRename(item: HierarchyItem, newName: string): void;
    OnItemRemoved(item: HierarchyItem): void;
}

// The structural owner (a Hierarchy) that allocates ids, realizes children,
// computes canonical names, and builds the per-open command menu.
export interface IHierarchyItemOwner
{
    NewItem(key: string, init?: HierarchyItemInit): HierarchyItem;
    Realize(item: HierarchyItem): void;
    Collapse(item: HierarchyItem): void;
    CanonicalNameOf(item: HierarchyItem): string;
    BuildActions(item: HierarchyItem, context: unknown): ObservableCollection<unknown>;
    OnItemDisposed(item: HierarchyItem): void;
}

export interface HierarchyItemInit
{
    Caption?: string;
    IconKey?: string;
    Severity?: NodeSeverity;
    Error?: string;
    IsExpandable?: boolean;
    CanonicalSegment?: string;
    ExtObject?: unknown;
}

export class HierarchyItem extends Observable
{
    public static readonly LoadingText = 'Loading…';

    private static readonly CaptionProp = 'Caption';
    private static readonly IconKeyProp = 'IconKey';
    private static readonly SeverityProp = 'Severity';
    private static readonly ErrorProp = 'Error';
    private static readonly IsExpandableProp = 'IsExpandable';
    private static readonly IsEditingProp = 'IsEditing';
    private static readonly EditingNameProp = 'EditingName';
    private static readonly IsExpandedProp = 'IsExpanded';

    public readonly Children = new ObservableCollection<HierarchyItem>();
    public readonly CanonicalSegment: string | undefined;
    public Parent: HierarchyItem | undefined;
    public ExtObject: unknown;

    private _caption: string;
    private _iconKey: string;
    private _severity: NodeSeverity;
    private _error: string | undefined;
    private _isExpandable: boolean;
    private _isEditing = false;
    private _editingName = '';
    private _isExpanded = false;
    private _placeholder: HierarchyItem | undefined;

    constructor(
        public readonly Id: ItemId,
        public readonly Key: string,
        private readonly owner: IHierarchyItemOwner,
        private readonly host: IHierarchyItemHost,
        init: HierarchyItemInit = {},
    )
    {
        super();
        this._caption = init.Caption ?? '';
        this._iconKey = init.IconKey ?? '';
        this._severity = init.Severity ?? NodeSeverity.Ok;
        this._error = init.Error;
        this._isExpandable = init.IsExpandable ?? false;
        this.CanonicalSegment = init.CanonicalSegment;
        this.ExtObject = init.ExtObject;
        if (this._isExpandable)
        {
            this.seedPlaceholder();
        }
    }

    public get Caption(): string { return this._caption; }
    public set Caption(v: string)
    {
        const old = this._caption;
        if (old === v) return;
        this._caption = v;
        this.RaisePropertyChanged(HierarchyItem.CaptionProp, old, v);
    }

    public get IconKey(): string { return this._iconKey; }
    public set IconKey(v: string)
    {
        const old = this._iconKey;
        if (old === v) return;
        this._iconKey = v;
        this.RaisePropertyChanged(HierarchyItem.IconKeyProp, old, v);
    }

    public get Severity(): NodeSeverity { return this._severity; }
    public set Severity(v: NodeSeverity)
    {
        const old = this._severity;
        if (old === v) return;
        this._severity = v;
        this.RaisePropertyChanged(HierarchyItem.SeverityProp, old, v);
    }

    public get Error(): string | undefined { return this._error; }
    public set Error(v: string | undefined)
    {
        const old = this._error;
        if (old === v) return;
        this._error = v;
        this.RaisePropertyChanged(HierarchyItem.ErrorProp, old, v);
    }

    public get IsExpandable(): boolean { return this._isExpandable; }
    public set IsExpandable(v: boolean)
    {
        const old = this._isExpandable;
        if (old === v) return;
        this._isExpandable = v;
        this.RaisePropertyChanged(HierarchyItem.IsExpandableProp, old, v);
        if (v && !this._isExpanded && this._placeholder === undefined)
        {
            this.seedPlaceholder();
        }
        else if (!v)
        {
            this.clearPlaceholder();
        }
    }

    public get IsEditing(): boolean { return this._isEditing; }

    public get EditingName(): string { return this._editingName; }
    public set EditingName(v: string)
    {
        const old = this._editingName;
        if (old === v) return;
        this._editingName = v;
        this.RaisePropertyChanged(HierarchyItem.EditingNameProp, old, v);
    }

    public get IsExpanded(): boolean { return this._isExpanded; }

    public get CanonicalName(): string { return this.owner.CanonicalNameOf(this); }

    public OnExpand(): void
    {
        if (this._isExpanded) return;
        this.clearPlaceholder();
        this.setExpanded(true);
        this.owner.Realize(this);
    }

    public OnCollapse(): void
    {
        if (!this._isExpanded) return;
        this.setExpanded(false);
        this.owner.Collapse(this);
        if (this._isExpandable)
        {
            this.seedPlaceholder();
        }
    }

    public OnActivate(): void
    {
        this.host.Activate(this);
    }

    public BeginEdit(): void
    {
        this._editingName = this._caption;
        this.setEditing(true);
    }

    public CommitEdit(): void
    {
        this.host.CommitRename(this, this._editingName);
        this.setEditing(false);
    }

    public CancelEdit(): void
    {
        this.setEditing(false);
    }

    public dispose(): void
    {
        this.host.OnItemRemoved(this);
        this.owner.OnItemDisposed(this);
        for (const child of this.Children.ToArray())
        {
            child.dispose();
        }
        this.Children.Clear();
    }

    private setExpanded(v: boolean): void
    {
        const old = this._isExpanded;
        if (old === v) return;
        this._isExpanded = v;
        this.RaisePropertyChanged(HierarchyItem.IsExpandedProp, old, v);
    }

    private setEditing(v: boolean): void
    {
        const old = this._isEditing;
        if (old === v) return;
        this._isEditing = v;
        this.RaisePropertyChanged(HierarchyItem.IsEditingProp, old, v);
    }

    private seedPlaceholder(): void
    {
        if (this._placeholder !== undefined) return;
        const placeholder = this.owner.NewItem(this.Key, { Caption: HierarchyItem.LoadingText });
        this._placeholder = placeholder;
        this.Children.Add(placeholder);
    }

    private clearPlaceholder(): void
    {
        if (this._placeholder === undefined) return;
        const index = this.Children.IndexOf(this._placeholder);
        if (index >= 0) this.Children.RemoveAt(index);
        this._placeholder = undefined;
    }
}
