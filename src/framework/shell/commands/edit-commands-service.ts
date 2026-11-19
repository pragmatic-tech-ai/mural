import {
    Disposable, RelayCommand, ServiceBase, ServiceKey,
    type ICommand, type IDisposable, type IServiceProvider,
} from '../../../runtime/index.js'
import { ContentHostService } from '../services/content-host-service.js'
import type { DocumentsContentHostService } from '../services/documents-content-host-service.js'
import { BoardDocument } from '../../board/board-document.js'
import type { Board } from '../../board/board.js'

// Board-scoped bridge from the main menu's Edit commands (Undo/Redo/Cut/Copy/
// Paste) to the active document. Only a BoardDocument supports these ops
// today; any other active document (or none) disables all five and Execute is
// a no-op — it never throws. Undo/Redo route through the board's own
// History; Cut/Copy defer to the active view's own CopyCommand/CutCommand
// (which already gate on selection); Paste is unconditionally enabled once a
// board is active — the view's own PasteCommand has no selection gate
// either, so this stays true even before a view is attached. Delete and
// Select-All are out of scope.
export class EditCommandsService extends ServiceBase
{
    public static readonly Key = new ServiceKey<EditCommandsService>('EditCommandsService')

    private static readonly ActiveDocumentPropertyName = 'ActiveDocument'

    private readonly _undoCommand: RelayCommand
    private readonly _redoCommand: RelayCommand
    private readonly _cutCommand: RelayCommand
    private readonly _copyCommand: RelayCommand
    private readonly _pasteCommand: RelayCommand
    private readonly _commands: readonly RelayCommand[]
    private readonly _activeDocumentSubscription: IDisposable

    public constructor(provider: IServiceProvider)
    {
        super(provider)

        this._undoCommand = new RelayCommand(
            () => this.ActiveBoard()?.Undo(),
            () => this.ActiveBoard()?.History.CanUndo ?? false,
        )
        this._redoCommand = new RelayCommand(
            () => this.ActiveBoard()?.Redo(),
            () => this.ActiveBoard()?.History.CanRedo ?? false,
        )
        this._cutCommand = new RelayCommand(
            () => this.ActiveView()?.CutCommand?.Execute(),
            () => this.ActiveView()?.CutCommand?.CanExecute() ?? false,
        )
        this._copyCommand = new RelayCommand(
            () => this.ActiveView()?.CopyCommand?.Execute(),
            () => this.ActiveView()?.CopyCommand?.CanExecute() ?? false,
        )
        this._pasteCommand = new RelayCommand(
            () => this.ActiveView()?.PasteCommand?.Execute(),
            () => this.ActiveBoard() !== undefined,
        )
        this._commands = [this._undoCommand, this._redoCommand, this._cutCommand, this._copyCommand, this._pasteCommand]

        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        this._activeDocumentSubscription = host !== undefined
            ? host.PropertyChanged(EditCommandsService.ActiveDocumentPropertyName).subscribe(() => this.RaiseAllCanExecuteChanged())
            : Disposable.None
    }

    public get UndoCommand(): ICommand { return this._undoCommand }
    public get RedoCommand(): ICommand { return this._redoCommand }
    public get CutCommand(): ICommand { return this._cutCommand }
    public get CopyCommand(): ICommand { return this._copyCommand }
    public get PasteCommand(): ICommand { return this._pasteCommand }

    public override dispose(): void
    {
        this._activeDocumentSubscription.dispose()
        super.dispose()
    }

    private ActiveBoard(): BoardDocument | undefined
    {
        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        const doc = host?.ActiveDocument
        return doc instanceof BoardDocument ? doc : undefined
    }

    private ActiveView(): Board | undefined
    {
        return this.ActiveBoard()?.ActiveView
    }

    private RaiseAllCanExecuteChanged(): void
    {
        for (const command of this._commands)
        {
            command.RaiseCanExecuteChanged()
        }
    }
}
