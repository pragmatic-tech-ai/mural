import {
    Application, Color, ServiceBase, ServiceKey, ThemeManager, type IServiceProvider,
} from '../../../runtime/index.js'
import { ApplicationSettings } from '../../shell/services/application-settings-service.js'
import { ContentHostService } from '../../shell/services/content-host-service.js'
import type { DocumentsContentHostService, IDocument } from '../../shell/services/documents-content-host-service.js'
import { Setting } from '../../shell/settings/setting.js'
import { DiagramDocument } from '../diagram-document.js'
import { PaginatedCanvas } from '../../../basic/index.js'
import { PatternBrush, PatternKind, SolidColorBrush } from '../../../visual-engine/index.js'

// App-scoped observer that drives the diagram canvas background from settings.
// For every open DiagramDocument it grabs the live Diagram's PaginatedCanvas
// (its ItemsPanel) and applies two things:
//   * Page size — PageWidth / PageHeight from the page settings.
//   * Grid — when "Show grid" is on, sets PaperBrush to a grid PatternBrush
//     whose background is the theme page colour (@CanvasBg) and whose
//     lines are that colour lightened 10% — so the grid is a subtle,
//     theme-adaptive tint of the paper, with no user-set colour. When off, it
//     CLEARS the PaperBrush so the template's @CanvasBg dynamic-resource
//     paper re-applies.
//
// Reactive on three axes: a settings change (show / size / page size) and a
// theme (light/dark) swap both re-apply to every live canvas, and a document
// (re)publishing its ActiveView re-grabs the canvas and applies. Mirrors
// DiagramCameraService's open-docs + ActiveView attach pattern.
export class DiagramCanvasService extends ServiceBase
{
    public static readonly Key = new ServiceKey<DiagramCanvasService>('DiagramCanvasService')

    private static readonly ShowKey = 'diagram.grid.show'
    private static readonly SizeKey = 'diagram.grid.size'
    private static readonly WidthKey = 'diagram.page.width'
    private static readonly HeightKey = 'diagram.page.height'
    private static readonly DefaultSize = 20
    private static readonly DefaultWidth = 2000
    private static readonly DefaultHeight = 2000
    // The diagram page background is the theme's @CanvasBg token (Pragmatic light
    // #F4F4F1 / dark #111112). The grid lines are that colour shifted 10% toward
    // CONTRAST — lighter on a dark page, darker on a light one — so the grid stays
    // a subtle-but-visible tint of the paper in every theme (a strict "lighten"
    // would vanish on a near-white light page). NOTE: the token is @CanvasBg — the
    // Pragmatic name for what the retired Material theme called @DiagramCanvas; the
    // framework's own PART_CanvasBg paper fills @CanvasBg too (see mural's
    // controls-diagram-chrome test). Reading the old name here left the grid painting
    // on the CanvasFallback instead of the themed paper (washed-out white surface).
    private static readonly CanvasToken = 'CanvasBg'
    private static readonly CanvasFallback = '#F4F4F1'
    private static readonly GridStep = 0.1

    private readonly bindings = new Map<IDocument, () => void>()   // doc → detach
    private readonly canvases = new Set<PaginatedCanvas>()          // live canvases to apply to

    public constructor(provider: IServiceProvider)
    {
        super(provider)
        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        host?.OpenDocuments.Subscribe(() => this.sync(host))
        this.watchSettings()
        // The grid colour is derived from the theme's page background, so a
        // light/dark scheme swap must repaint every live canvas.
        ThemeManager.AddActivatedListener(() => this.reapplyAll())
    }

    // The diagram page background colour from the active theme (@CanvasBg), or a
    // light-paper fallback before the theme is registered. Static + public: it
    // reads only Application.current and class constants (no instance state), and
    // exposing it lets the token wiring be unit-tested without standing up the whole
    // settings/canvas observer.
    public static PageBackgroundColor(): Color
    {
        const res = Application.current?.Resources.Resolve(DiagramCanvasService.CanvasToken)
        return res instanceof SolidColorBrush ? res.Color : Color.FromHex(DiagramCanvasService.CanvasFallback)
    }

    // Perceived-luminance test (Rec. 601 weights, 0..1). Below the midpoint the
    // paper is dark, so the grid shifts toward white; at/above it toward black.
    private static isDark(c: Color): boolean
    {
        return (0.299 * c.R + 0.587 * c.G + 0.114 * c.B) / 255 < 0.5
    }

    private reapplyAll(): void
    {
        for (const c of this.canvases) this.applyTo(c)
    }

    private sync(host: DocumentsContentHostService): void
    {
        const current = new Set(host.OpenDocuments.ToArray())
        for (const [doc, detach] of [...this.bindings])
        {
            if (!current.has(doc)) { detach(); this.bindings.delete(doc) }
        }
        for (const doc of current) this.attach(doc)
    }

    // Idempotent per document. Subscribes to ActiveView (re)publication; on each,
    // (re)grabs the live PaginatedCanvas and applies the current settings.
    private attach(doc: IDocument): void
    {
        if (this.bindings.has(doc) || !(doc instanceof DiagramDocument)) return

        let canvas: PaginatedCanvas | undefined

        const rebindView = (): void => {
            if (canvas !== undefined) { this.canvases.delete(canvas); canvas = undefined }
            const view = doc.ActiveView
            if (view === undefined) return
            const panel = view.ItemsPanelInstance
            if (!(panel instanceof PaginatedCanvas)) return
            canvas = panel
            this.canvases.add(canvas)
            this.applyTo(canvas)
        }

        const subActiveView = doc.PropertyChanged(DiagramDocument.ActiveViewKey).subscribe(rebindView)
        rebindView()

        this.bindings.set(doc, () => {
            if (canvas !== undefined) this.canvases.delete(canvas)
            subActiveView.dispose()
        })
    }

    // Attach change listeners to the canvas settings; any change re-applies to
    // every live canvas. No-op headless / before settings are wired.
    private watchSettings(): void
    {
        const settings = this.settings()
        if (settings === undefined) return
        const reapply = (): void => this.reapplyAll()
        for (const key of [DiagramCanvasService.ShowKey, DiagramCanvasService.SizeKey, DiagramCanvasService.WidthKey, DiagramCanvasService.HeightKey])
        {
            settings.GetSetting(key)?.PropertyChanged(Setting.ValueKey).subscribe(reapply)
        }
    }

    private settings(): ApplicationSettings | undefined
    {
        return Application.current?.Services.get(ApplicationSettings.Key)
    }

    // Apply page size + grid to one canvas from the current setting values.
    private applyTo(canvas: PaginatedCanvas): void
    {
        const settings = this.settings()
        if (settings === undefined) return

        // Page size.
        const widthVal  = settings.Get(DiagramCanvasService.WidthKey)
        const heightVal = settings.Get(DiagramCanvasService.HeightKey)
        canvas.PageWidth  = typeof widthVal  === 'number' && widthVal  > 0 ? widthVal  : DiagramCanvasService.DefaultWidth
        canvas.PageHeight = typeof heightVal === 'number' && heightVal > 0 ? heightVal : DiagramCanvasService.DefaultHeight

        // Grid. Off → drop the local PaperBrush so the template's @CanvasBg
        // dynamic-resource paper re-applies (theme-adaptive again).
        if (settings.Get(DiagramCanvasService.ShowKey) === false)
        {
            canvas.ClearValue(PaginatedCanvas.PaperBrushKey)
            return
        }

        const sizeVal = settings.Get(DiagramCanvasService.SizeKey)
        const size    = typeof sizeVal === 'number' && sizeVal > 0 ? sizeVal : DiagramCanvasService.DefaultSize

        // Grid colour = the theme page background, shifted 10% toward contrast
        // (lighter on a dark page, darker on a light one). The pattern's
        // background is that same page colour, so the page keeps its theme paper
        // and the grid reads as a subtle tint of it.
        const bg   = DiagramCanvasService.PageBackgroundColor()
        const line = Color.Lerp(bg, DiagramCanvasService.isDark(bg) ? Color.White : Color.Black, DiagramCanvasService.GridStep)

        const brush = new PatternBrush(PatternKind.Grid, line)
        brush.Background      = bg
        brush.Size            = size
        brush.StrokeThickness = 1
        canvas.PaperBrush = brush
    }
}
