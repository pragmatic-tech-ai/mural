import { ServiceBase, ServiceKey, type IServiceProvider } from '../../../runtime/index.js'
import { ApplicationSettings } from './application-settings-service.js'
import { ContentHostService } from './content-host-service.js'
import type { DocumentsContentHostService, IDocument } from './documents-content-host-service.js'
import { Setting } from '../settings/setting.js'

// App-scoped background service: on an interval (default 5 min, from settings),
// save every dirty document. Reacts live to the enabled toggle and interval
// setting. Renderer-only — setInterval is fine here (the timer prohibition is
// main-process). Mirrors DiagramCameraService's provider/host wiring.
export class AutosaveService extends ServiceBase
{
    public static readonly Key = new ServiceKey<AutosaveService>('AutosaveService')

    // Setting keys — MUST byte-match the SettingDefinition Key values the app
    // declares (Plexus save.module.mu), or autosave silently never runs.
    private static readonly EnabledSetting = 'documents.autosave.enabled'
    private static readonly IntervalSetting = 'documents.autosave.intervalMinutes'

    private timer: ReturnType<typeof setInterval> | undefined
    private ticking = false

    public constructor(provider: IServiceProvider)
    {
        super(provider)
        const settings = this.Provider.get(ApplicationSettings.Key)
        const reschedule = (): void => this.reschedule()
        settings?.GetSetting(AutosaveService.EnabledSetting)?.PropertyChanged(Setting.ValueKey).subscribe(reschedule)
        settings?.GetSetting(AutosaveService.IntervalSetting)?.PropertyChanged(Setting.ValueKey).subscribe(reschedule)
        this.reschedule()
    }

    // Save every dirty open document. Isolated from timers/settings so it is
    // unit-testable with a fake host, and so one document's failed Save cannot abort
    // the sweep (a transient write error must not skip the rest or kill the timer).
    public static SaveDirtyDocuments(
        host: { OpenDocuments: { ToArray(): IDocument[] }; Save(doc: IDocument): void | Promise<void> },
    ): void
    {
        for (const doc of host.OpenDocuments.ToArray())
        {
            if (!doc.IsDirty) continue
            try { void host.Save(doc) }
            catch { /* transient write failure — keep sweeping, retry next tick */ }
        }
    }

    public override dispose(): void
    {
        if (this.timer !== undefined) { clearInterval(this.timer); this.timer = undefined }
        super.dispose()
    }

    private reschedule(): void
    {
        if (this.timer !== undefined) { clearInterval(this.timer); this.timer = undefined }
        const settings = this.Provider.get(ApplicationSettings.Key)
        const enabled = settings?.Get(AutosaveService.EnabledSetting)
        if (enabled === false) return
        const minutes = settings?.Get(AutosaveService.IntervalSetting)
        const ms = (typeof minutes === 'number' && minutes >= 1 ? minutes : 5) * 60_000
        this.timer = setInterval(() => this.tick(), ms)
    }

    private tick(): void
    {
        if (this.ticking) return
        this.ticking = true
        try
        {
            const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
            if (host !== undefined) AutosaveService.SaveDirtyDocuments(host)
        }
        finally { this.ticking = false }
    }
}
