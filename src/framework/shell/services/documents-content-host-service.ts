import {
    type ICommand,
    MetaData,
    MuralBase,
    ObservableCollection,
    RelayCommand,
    type Disposable,
    type IServiceProvider,
    type PropertyDescriptor,
} from '../../../runtime/index.js';
import { findDescriptor, resolveKey } from '../../../runtime/model-internals.js';
import { ContentHostService } from './content-host-service.js';
import { CommandRegistry } from '../commands/command-registry.js';
import { CommandViewModel } from '../commands/command-view-model.js';
import type { CommandDefinition } from '../commands/command-definition.js';
import { ShellRegion } from '../commands/shell-control-definition.js';
import { isCommandTarget } from '../commands/command-target.js';
import { TabMenuAction, TabMenuSeparator, TabMenuDocument } from './tab-menu-item.js';

// A document the DocumentsContentHostService manages. The host owns the
// open-set + active-document lifecycle; the document owns its own identity,
// dirty state, and persistence. Kept minimal — an app's concrete document
// MuralBase implements this and carries whatever payload it needs.
export interface IDocument
{
    // Stable identity — dedupes opens and locates a document to close. Two
    // opens of the same Id re-activate the existing document rather than
    // adding a duplicate.
    readonly Id: string;
    // Display label (a tab / title bar binds this).
    readonly Title: string;
    // Unsaved-changes flag — a dirty indicator / close prompt reads it.
    readonly IsDirty: boolean;
    // Persist this document. save() delegates here — the document owns the
    // actual IO (or delegates internally). May be async.
    Save(): void | Promise<void>;
}

// Content host that manages a workspace of open documents — the classic
// tabbed-document (TDI) shape. Extends ContentHostService: the ActiveDocument
// is what the base presents (View(ActiveDocument)), so the shell's content
// region shows the active document rendered through its DataTemplate. Register
// this against `ContentHostService.Key` to drive the region with documents
// instead of the plain single-object host; document commands resolve that same
// key and cast to this type to call Open / Close / Save.
export class DocumentsContentHostService extends ContentHostService
{
    // The open document set. A stable per-instance collection a tab strip
    // binds (`ItemsSource = $OpenDocuments`); the reference never changes, so
    // this DP only hands it back — mirrors NavigationService.Items.
    public static readonly OpenDocumentsKey = MuralBase.RegisterProperty<ObservableCollection<IDocument>>(
        DocumentsContentHostService, 'OpenDocuments',
        undefined as unknown as ObservableCollection<IDocument>, MetaData.None);

    // The active document — what the host presents. Written through Open() /
    // Close(); a tab strip may also bind SelectedItem TwoWay to it. Every
    // write routes View() (see OnPropertyChanged), so activation and the
    // presented content stay in lock-step.
    public static readonly ActiveDocumentKey = MuralBase.RegisterProperty<IDocument | undefined>(
        DocumentsContentHostService, 'ActiveDocument', undefined, MetaData.None);

    // Close a document by its Id — the command a tab strip's close button binds
    // (`Command = $service(ContentHostService).CloseDocumentCommand`,
    // `CommandParameter = $Id`). Takes the Id string (not the document) because
    // a per-item template can bind a plain path segment but has no binding for
    // "the whole DataContext object". Non-string / unknown-id parameters no-op.
    public static readonly CloseDocumentCommandKey = MuralBase.RegisterProperty<ICommand>(
        DocumentsContentHostService, 'CloseDocumentCommand',
        undefined as unknown as ICommand, MetaData.None);

    // Close EVERY open document (the "Close All" tab-strip action). Parameterless
    // — a menu item binds `Command = $service(ContentHostService).CloseAllCommand`
    // with no CommandParameter. Ends with an empty open-set and no active
    // document, so the content region clears.
    public static readonly CloseAllCommandKey = MuralBase.RegisterProperty<ICommand>(
        DocumentsContentHostService, 'CloseAllCommand',
        undefined as unknown as ICommand, MetaData.None);

    // Activate (make current) a document by its Id — the command an open-tabs
    // menu binds (`Command = $service(ContentHostService).ActivateDocumentCommand`,
    // `CommandParameter = $Id`) so clicking a tab entry switches to it. Takes the
    // Id string for the same reason as CloseDocumentCommand (a per-item template
    // binds a path segment, not the whole object). Unknown / non-string ids no-op.
    public static readonly ActivateDocumentCommandKey = MuralBase.RegisterProperty<ICommand>(
        DocumentsContentHostService, 'ActivateDocumentCommand',
        undefined as unknown as ICommand, MetaData.None);

    // Module-contributed action buttons for the editor tab-strip (the ExtendedTabControl
    // renders these beside the tabs). Collected from the CommandRegistry: every
    // CommandDefinition whose Region is ShellRegion.EditorActions, adapted into a
    // button-bindable CommandViewModel whose command dispatches to the ACTIVE
    // document (an ICommandTarget), exactly like the toolbar. Empty when no
    // CommandRegistry is registered (a bare host). A stable per-instance collection.
    public static readonly ExtendedCommandsKey = MuralBase.RegisterProperty<ObservableCollection<CommandViewModel>>(
        DocumentsContentHostService, 'ExtendedCommands',
        undefined as unknown as ObservableCollection<CommandViewModel>, MetaData.None);

    // The editor tab-strip overflow-menu rows (the ⋯ dropdown's ItemsSource): a
    // "Close All" action, a separator, then one TabMenuDocument per open document.
    // Re-synthesised whenever the open set changes. A stable per-instance
    // collection (the tab control binds it once).
    public static readonly TabMenuKey = MuralBase.RegisterProperty<ObservableCollection<MuralBase>>(
        DocumentsContentHostService, 'TabMenu',
        undefined as unknown as ObservableCollection<MuralBase>, MetaData.None);

    // True while at least one open document has unsaved changes. Read-only —
    // recomputed from the open set + each document's IsDirty. Drives SaveAll
    // enablement and any dirty affordance.
    private static readonly _AnyDirtyPriv = MuralBase.RegisterReadOnlyProperty<boolean>(
        DocumentsContentHostService, 'AnyDirty', false, MetaData.None);
    public static readonly AnyDirtyKey = DocumentsContentHostService._AnyDirtyPriv;

    // Save the ACTIVE document. Enabled iff the active doc is dirty. A toolbar
    // button binds `$service(ContentHostService).SaveActiveCommand`.
    public static readonly SaveActiveCommandKey = MuralBase.RegisterProperty<ICommand>(
        DocumentsContentHostService, 'SaveActiveCommand', undefined as unknown as ICommand, MetaData.None);

    // Save EVERY dirty open document. Enabled iff AnyDirty.
    public static readonly SaveAllCommandKey = MuralBase.RegisterProperty<ICommand>(
        DocumentsContentHostService, 'SaveAllCommand', undefined as unknown as ICommand, MetaData.None);

    // Per-open-document IsDirty subscriptions, keyed by document, so the
    // aggregation reconciles as the open set changes.
    private readonly dirtySubs = new Map<IDocument, Disposable>();

    constructor(provider: IServiceProvider)
    {
        super(provider);
        this.set_property_value(
            DocumentsContentHostService.OpenDocumentsKey, new ObservableCollection<IDocument>());
        this.set_property_value(
            DocumentsContentHostService.CloseDocumentCommandKey,
            new RelayCommand((id) => this.CloseById(id as string), undefined,
                { Text: 'Close', Description: 'Close this document.' }));
        this.set_property_value(
            DocumentsContentHostService.CloseAllCommandKey,
            new RelayCommand(() => this.CloseAll(), undefined,
                { Text: 'Close All', Description: 'Close all open documents.' }));
        this.set_property_value(
            DocumentsContentHostService.ActivateDocumentCommandKey,
            new RelayCommand((id) => this.ActivateById(id as string), undefined,
                { Text: 'Activate', Description: 'Switch to this document.' }));
        this.set_property_value(
            DocumentsContentHostService.ExtendedCommandsKey, new ObservableCollection<CommandViewModel>());
        this.set_property_value(
            DocumentsContentHostService.TabMenuKey, new ObservableCollection<MuralBase>());
        this.set_property_value(
            DocumentsContentHostService.SaveActiveCommandKey,
            new RelayCommand(
                () => { void this.Save(); },
                () => this.ActiveDocument?.IsDirty === true,
                { Text: 'Save', Description: 'Save the active document.' }));
        this.set_property_value(
            DocumentsContentHostService.SaveAllCommandKey,
            new RelayCommand(
                () => { void this.SaveAll(); },
                () => this.AnyDirty,
                { Text: 'Save All', Description: 'Save all documents with unsaved changes.' }));
        this.wireExtendedCommands();
        this.rebuildTabMenu();
        this.OpenDocuments.Subscribe(() => this.rebuildTabMenu());
        // Keep dirty subscriptions in sync with the open set, then seed.
        this.OpenDocuments.Subscribe(() => this.reconcileDirtySubscriptions());
        this.reconcileDirtySubscriptions();
    }

    // Re-synthesise the overflow menu: [Close All action] + [separator] + one
    // TabMenuDocument per open document (in tab order). Called on every open-set
    // change; the separator/action are dropped when nothing is open.
    private rebuildTabMenu(): void
    {
        const menu = this.TabMenu;
        menu.Clear();
        if (this.OpenDocuments.Count === 0) return;
        menu.Add(new TabMenuAction('Close All', this.CloseAllCommand));
        menu.Add(new TabMenuSeparator());
        for (const doc of this.OpenDocuments) menu.Add(new TabMenuDocument(doc));
    }

    // Resolve the CommandRegistry (optional — a bare host has none) and build the
    // editor-region command VMs, rebuilding whenever the registry's command set
    // changes (modules populate it after this host is constructed).
    private extendedCommandsUnsub: (() => void) | undefined;
    private wireExtendedCommands(): void
    {
        const registry = this.Provider.get(CommandRegistry.Key);
        if (registry === undefined) return;
        this.rebuildExtendedCommands(registry);
        this.extendedCommandsUnsub = registry.Commands.Subscribe(() => this.rebuildExtendedCommands(registry));
    }

    // (Re)project the EditorActions-region CommandDefinitions into ExtendedCommands.
    // Each VM's command dispatches to the ACTIVE document when it is an
    // ICommandTarget (read live at invoke time, so no rebuild is needed on a tab
    // switch — only a CanExecute requery, see OnPropertyChanged).
    private rebuildExtendedCommands(registry: CommandRegistry): void
    {
        const list = this.ExtendedCommands;
        list.Clear();
        for (const def of registry.Commands)
        {
            if (def.Region !== ShellRegion.EditorActions) continue;
            const command = new RelayCommand(
                () => this.commandTarget()?.Execute(def),
                () => this.commandTarget()?.CanExecute(def) ?? false,
                { Text: def.Title });
            list.Add(new CommandViewModel(def, command));
        }
    }

    // The active document as a command target, or undefined when nothing is active
    // (or the active document doesn't handle commands).
    private commandTarget(): { Execute(d: CommandDefinition): void; CanExecute(d: CommandDefinition): boolean } | undefined
    {
        const doc = this.ActiveDocument;
        return doc !== undefined && isCommandTarget(doc) ? doc : undefined;
    }

    public get CloseDocumentCommand(): ICommand
    {
        return this.get_property_value(DocumentsContentHostService.CloseDocumentCommandKey);
    }

    public get CloseAllCommand(): ICommand
    {
        return this.get_property_value(DocumentsContentHostService.CloseAllCommandKey);
    }

    public get ActivateDocumentCommand(): ICommand
    {
        return this.get_property_value(DocumentsContentHostService.ActivateDocumentCommandKey);
    }

    public get ExtendedCommands(): ObservableCollection<CommandViewModel>
    {
        return this.get_property_value(DocumentsContentHostService.ExtendedCommandsKey);
    }

    public get TabMenu(): ObservableCollection<MuralBase>
    {
        return this.get_property_value(DocumentsContentHostService.TabMenuKey);
    }

    public get AnyDirty(): boolean
    {
        return this.get_property_value(DocumentsContentHostService.AnyDirtyKey);
    }

    public get SaveActiveCommand(): ICommand
    {
        return this.get_property_value(DocumentsContentHostService.SaveActiveCommandKey);
    }

    public get SaveAllCommand(): ICommand
    {
        return this.get_property_value(DocumentsContentHostService.SaveAllCommandKey);
    }

    public get OpenDocuments(): ObservableCollection<IDocument>
    {
        return this.get_property_value(DocumentsContentHostService.OpenDocumentsKey);
    }

    public get ActiveDocument(): IDocument | undefined
    {
        return this.get_property_value(DocumentsContentHostService.ActiveDocumentKey);
    }
    // Settable so a TwoWay tab-strip SelectedItem binding can re-activate;
    // activation drives View() via OnPropertyChanged.
    public set ActiveDocument(doc: IDocument | undefined)
    {
        this.set_property_value(DocumentsContentHostService.ActiveDocumentKey, doc);
    }

    // Open a document: add it to the open set if new (dedupe by Id) and make
    // it active. Re-opening an already-open document just re-activates the
    // existing instance. Activation presents it via the base View().
    public Open(document: IDocument): void
    {
        const existing = this.find(document.Id);
        if (existing === undefined) this.OpenDocuments.Add(document);
        this.ActiveDocument = existing ?? document;
    }

    // Close a document: remove it from the open set. If it was active,
    // activate a neighbour (the one that shifts into its slot, else the last,
    // else none) so the region never strands on a closed document.
    public Close(document: IDocument): void
    {
        const index = this.OpenDocuments.IndexOf(document);
        if (index < 0) return;
        const wasActive = this.ActiveDocument === document;
        this.OpenDocuments.RemoveAt(index);
        if (!wasActive) return;
        const count = this.OpenDocuments.Count;
        this.ActiveDocument = count === 0
            ? undefined
            : this.OpenDocuments.Get(Math.min(index, count - 1));
    }

    // Persist a document (defaults to the active one). Delegates to the
    // document's own Save() — the host owns lifecycle, not IO. Returns the
    // Save() result so an async caller can await it. No-op when nothing is
    // active and no document is passed.
    public Save(document?: IDocument): void | Promise<void>
    {
        const target = document ?? this.ActiveDocument;
        return target?.Save();
    }

    // Subscribe to each open document's IsDirty (dropping subscriptions for docs
    // that left the set), then recompute AnyDirty. A document that isn't a MuralBase
    // (no reactive IsDirty) contributes its static IsDirty with no live updates.
    private reconcileDirtySubscriptions(): void
    {
        const open = new Set(this.OpenDocuments);
        for (const [doc, sub] of this.dirtySubs)
        {
            if (!open.has(doc)) { sub.dispose(); this.dirtySubs.delete(doc); }
        }
        for (const doc of open)
        {
            if (this.dirtySubs.has(doc)) continue;
            // Live subscription requires a REGISTERED IsDirty DP. A MuralBase that
            // exposes IsDirty as a plain field (or a non-MuralBase document)
            // contributes its static IsDirty with no live updates — never throw
            // (findDescriptor returns undefined where resolveKey would throw).
            if (doc instanceof MuralBase && findDescriptor(doc.constructor, 'IsDirty') !== undefined)
            {
                const key = resolveKey(doc, undefined, 'IsDirty');
                const sub = doc.PropertyChanged(key).subscribe((): void => this.recomputeDirty());
                this.dirtySubs.set(doc, sub);
            }
        }
        this.recomputeDirty();
    }

    // Recompute AnyDirty and requery the save commands' enablement.
    private recomputeDirty(): void
    {
        let any = false;
        for (const doc of this.OpenDocuments) { if (doc.IsDirty) { any = true; break; } }
        this.set_property_value_with_key(DocumentsContentHostService._AnyDirtyPriv, any);
        (this.SaveActiveCommand as RelayCommand | undefined)?.RaiseCanExecuteChanged();
        (this.SaveAllCommand as RelayCommand | undefined)?.RaiseCanExecuteChanged();
    }

    // Save every open document that has unsaved changes, in tab order.
    public async SaveAll(): Promise<void>
    {
        for (const doc of [...this.OpenDocuments])
        {
            if (doc.IsDirty) await doc.Save();
        }
    }

    // Close every open document. Iterates a snapshot so each removal goes
    // through Close() (keeping the neighbour-reactivation invariant per step);
    // the set ends empty and ActiveDocument settles to undefined. No-op when
    // nothing is open.
    public CloseAll(): void
    {
        for (const doc of [...this.OpenDocuments]) this.Close(doc);
    }

    // Activate the document with the given Id (the ActivateDocumentCommand
    // target) — makes it the ActiveDocument, which routes View(). No-op on an
    // unknown or non-string id.
    public ActivateById(id: string): void
    {
        if (typeof id !== 'string') return;
        const doc = this.find(id);
        if (doc !== undefined) this.ActiveDocument = doc;
    }

    // Close the document with the given Id (the CloseDocumentCommand target).
    // Silently no-ops on an unknown or non-string id.
    public CloseById(id: string): void
    {
        if (typeof id !== 'string') return;
        const doc = this.find(id);
        if (doc !== undefined) this.Close(doc);
    }

    private find(id: string): IDocument | undefined
    {
        for (let i = 0; i < this.OpenDocuments.Count; i++)
        {
            const doc = this.OpenDocuments.Get(i);
            if (doc?.Id === id) return doc;
        }
        return undefined;
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor, oldValue: unknown, newValue: unknown): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        // ActiveDocument IS what the host presents — route it through the base
        // View() so the content region always tracks the active document.
        if (descriptor.Name === 'ActiveDocument')
        {
            this.View(newValue as IDocument | undefined);
            // The extended-command VMs dispatch to the LIVE active document, so
            // they don't rebuild on a switch — but their CanExecute must requery
            // so the buttons enable/disable for the new document.
            for (const vm of this.ExtendedCommands)
            {
                (vm.Command as RelayCommand).RaiseCanExecuteChanged();
            }
            // The active doc changed, so its dirtiness may differ — requery Save.
            (this.SaveActiveCommand as RelayCommand | undefined)?.RaiseCanExecuteChanged();
        }
    }

    public override dispose(): void
    {
        this.extendedCommandsUnsub?.();
        this.extendedCommandsUnsub = undefined;
        for (const sub of this.dirtySubs.values()) sub.dispose();
        this.dirtySubs.clear();
        super.dispose();
    }
}
