import { ServiceBase, ServiceKey, type IDisposable, type IServiceProvider } from '../../../runtime/index.js'
import { ContentHostService } from '../../shell/services/content-host-service.js'
import type { DocumentsContentHostService, IDocument } from '../../shell/services/documents-content-host-service.js'
import { Board } from '../board.js'
import { BoardDocument } from '../board-document.js'
import { FileBoardStorage } from '../file-board-storage.js'
import { BoardGuidesStore } from './board-guides-store.js'

// App-scoped observer: for every open BoardDocument, restore its persisted ruler
// guides onto the published ActiveView when it mounts, and write them back
// (debounced) into the document metadata whenever they change. The metadata
// round-trips through the .board file, so guides reopen where the user left
// them. Applies to EVERY board. Mirrors BoardCameraService.
export class BoardGuidesService extends ServiceBase
{
    public static readonly Key = new ServiceKey<BoardGuidesService>('BoardGuidesService')

    private readonly bindings = new Map<IDocument, IDisposable>()   // doc → detach

    public constructor(provider: IServiceProvider, private readonly persistDelayMs = 500)
    {
        super(provider)
        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        host?.OpenDocuments.Subscribe(() => this.sync(host))
    }

    private sync(host: DocumentsContentHostService): void
    {
        const current = new Set(host.OpenDocuments.ToArray())
        for (const [doc, detach] of [...this.bindings])
        {
            if (!current.has(doc))
            {
                detach.dispose()
                this.bindings.delete(doc)
            }
        }
        for (const doc of current) this.attach(doc)
    }

    // Idempotent per document. Subscribes to ActiveView (re)publication; on each,
    // hydrates the guides (guarded so the hydrate write doesn't loop back into a
    // persist) and (re)subscribes guide-change persistence.
    private attach(doc: IDocument): void
    {
        if (this.bindings.has(doc) || !(doc instanceof BoardDocument)) return

        let detachView: IDisposable | undefined
        let timer: ReturnType<typeof setTimeout> | undefined
        let hydrating = false

        const persist = (): void => {
            const view = doc.ActiveView
            if (view === undefined) return
            BoardGuidesStore.Write(doc, { guides: view.Guides })
            doc.Save()
            const store = doc.Storage
            if (store instanceof FileBoardStorage) void store.WhenWritten()
        }

        const onChanged = (): void => {
            if (hydrating) return
            if (timer !== undefined) clearTimeout(timer)
            timer = setTimeout(persist, this.persistDelayMs)
        }

        let subActiveView: IDisposable | undefined

        const rebindView = (): void => {
            detachView?.dispose()
            detachView = undefined
            const view = doc.ActiveView
            if (view === undefined) return
            // Hydrate: apply the persisted guides without triggering a persist.
            const saved = BoardGuidesStore.Read(doc)
            if (saved !== undefined)
            {
                hydrating = true
                try
                {
                    view.Guides = saved.guides
                }
                finally
                {
                    hydrating = false
                }
            }
            detachView = view.PropertyChanged(Board.GuidesKey).subscribe(onChanged)
        }

        subActiveView = doc.PropertyChanged(BoardDocument.ActiveViewKey).subscribe(rebindView)
        rebindView()

        this.bindings.set(doc, {
            dispose(): void
            {
                if (timer !== undefined) clearTimeout(timer)
                detachView?.dispose()
                subActiveView?.dispose()
                subActiveView = undefined
            },
        })
    }
}
