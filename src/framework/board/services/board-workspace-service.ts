import {
    ServiceBase,
    ServiceKey,
    type IServiceProvider,
} from '../../../runtime/index.js'
import {
    BoardDocument,
} from '../board-document.js'

// BoardWorkspaceService — owns the app's in-memory board DOCUMENT (an
// IDocument).
//
// The service no longer builds or holds a Board control. The document is what
// the editor hosts: the app opens it into the DocumentsContentHostService, which
// presents it in the Content region through
// `DataTemplate[DataType=BoardDocument]` — a markup template that materializes
// the Board control IN-TREE (so its adorners mount against a live AdornerLayer
// with no detached-build re-assert workaround). The control publishes itself
// back onto the document's ActiveView (IBoardViewHost), so the shell's
// Commands / Inspector regions reach its editing commands + selection-format
// state via `$service(ContentHostService).ActiveDocument.ActiveView.<X>`.
//
// The document opens EMPTY — architecture boards get their content from the
// bound ArchModel, standalone boards from their own `.board` file.
export class BoardWorkspaceService extends ServiceBase
{
    public static readonly Key = new ServiceKey<BoardWorkspaceService>('BoardWorkspaceService')

    private static readonly DefaultTitle = 'Untitled Board'

    private readonly _document: BoardDocument

    public constructor(provider: IServiceProvider)
    {
        super(provider)

        const doc = new BoardDocument()
        doc.Title = BoardWorkspaceService.DefaultTitle
        this._document = doc
    }

    public get Document(): BoardDocument { return this._document }
}
