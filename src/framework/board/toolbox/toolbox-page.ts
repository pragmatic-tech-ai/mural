import { MetaData, MuralBase, ObservableCollection } from '../../../runtime/index.js';
import { reconcile } from './reconcile.js';
import type { ToolboxItem } from './toolbox-item.js';

// One palette section: a titled, ordered set of items.
export class ToolboxPage extends MuralBase
{
    public static readonly IdKey = MuralBase.RegisterProperty<string>(
        ToolboxPage, 'Id', '', MetaData.None);
    public static readonly TitleKey = MuralBase.RegisterProperty<string>(
        ToolboxPage, 'Title', '', MetaData.None);
    public static readonly ItemsKey = MuralBase.RegisterProperty<ObservableCollection<ToolboxItem>>(
        ToolboxPage, 'Items', undefined as unknown as ObservableCollection<ToolboxItem>, MetaData.None);
    // Collapsed / expanded state for a palette section that renders as an
    // accordion. Settable so a header toggle can two-way bind `IsChecked` to it;
    // defaults expanded so a section shows its items until the user collapses it.
    public static readonly IsExpandedKey = MuralBase.RegisterProperty<boolean>(
        ToolboxPage, 'IsExpanded', true, MetaData.None);
    // The content-context token this page belongs to (e.g. a published
    // `<id>@<version>` ref or a model id). undefined → the page is context-free
    // and always visible.
    public static readonly ContextKey = MuralBase.RegisterProperty<string | undefined>(
        ToolboxPage, 'Context', undefined, MetaData.None);
    // Whether the page shows for the active document. The view binds Visibility to
    // this; it is flipped only by applyContext.
    public static readonly IsVisibleKey = MuralBase.RegisterProperty<boolean>(
        ToolboxPage, 'IsVisible', true, MetaData.None);

    constructor(id: string, title: string)
    {
        super();
        this.set_property_value(ToolboxPage.IdKey, id);
        this.set_property_value(ToolboxPage.TitleKey, title);
        this.set_property_value(ToolboxPage.ItemsKey, new ObservableCollection<ToolboxItem>());
    }

    public get Id():    string { return this.get_property_value(ToolboxPage.IdKey); }
    public get Title(): string { return this.get_property_value(ToolboxPage.TitleKey); }
    public get Items(): ObservableCollection<ToolboxItem> { return this.get_property_value(ToolboxPage.ItemsKey); }
    public get IsExpanded(): boolean { return this.get_property_value(ToolboxPage.IsExpandedKey); }
    public set IsExpanded(v: boolean) { this.set_property_value(ToolboxPage.IsExpandedKey, v); }
    public get Context(): string | undefined { return this.get_property_value(ToolboxPage.ContextKey); }
    public set Context(v: string | undefined) { this.set_property_value(ToolboxPage.ContextKey, v); }
    public get IsVisible(): boolean { return this.get_property_value(ToolboxPage.IsVisibleKey); }
    public set IsVisible(v: boolean) { this.set_property_value(ToolboxPage.IsVisibleKey, v); }

    // Visibility filter: visible iff context-free, or the active document's context
    // set contains this page's token. Never touches Items or IsExpanded, so the
    // user's manual expand/collapse survives a context change.
    public applyContext(ctx: ReadonlySet<string>): void
    {
        this.IsVisible = this.Context === undefined || ctx.has(this.Context);
    }

    // Lifecycle: subclasses override to subscribe to their triggers on attach and
    // dispose on detach. The base page (static content) has no triggers.
    public attach(): void { /* no triggers */ }
    public detach(): void { /* no subscriptions */ }

    // Granular item update by stable Id — subclasses call this from their trigger
    // handler instead of Clear()+rebuild.
    protected reconcileItems(desired: readonly ToolboxItem[], update?: (live: ToolboxItem, next: ToolboxItem) => void): void
    {
        reconcile(this.Items, desired, (it) => it.Id, update);
    }
}
