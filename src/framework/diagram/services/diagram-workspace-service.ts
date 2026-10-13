import {
    ServiceBase,
    ServiceKey,
    type IServiceProvider,
} from '../../../runtime/index.js'
import {
    DiagramDocument,
} from '../diagram-document.js'

// DiagramWorkspaceService — owns the app's in-memory diagram DOCUMENT (an
// IDocument), ported from the Diagrammer demo (demo/demos/diagram).
//
// The service no longer builds or holds a Diagram control. The document is what
// the editor hosts: the app opens it into the DocumentsContentHostService, which
// presents it in the Content region through
// `DataTemplate[DataType=DiagramDocument]` — a markup template that materializes
// the Diagram control IN-TREE (so its adorners mount against a live AdornerLayer
// with no detached-build re-assert workaround). The control publishes itself
// back onto the document's ActiveView (IDiagramViewHost), so the shell's
// Commands / Inspector regions reach its editing commands + selection-format
// state via `$service(ContentHostService).ActiveDocument.ActiveView.<X>`.
//
// The document opens EMPTY — architecture diagrams get their content from the
// bound ArchModel, standalone diagrams from their own `.diagram` file.
export class DiagramWorkspaceService extends ServiceBase
{
    public static readonly Key = new ServiceKey<DiagramWorkspaceService>('DiagramWorkspaceService')

    private static readonly DefaultTitle = 'Untitled Diagram'

    private readonly _document: DiagramDocument

    constructor(provider: IServiceProvider)
    {
        super(provider)

        const doc = new DiagramDocument()
        doc.Title = DiagramWorkspaceService.DefaultTitle
        this._document = doc
    }

    public get Document(): DiagramDocument { return this._document }
}
