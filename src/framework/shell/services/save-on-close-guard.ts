import { ServiceBase, ServiceKey, type IServiceProvider } from '../../../runtime/index.js';
import { DialogService } from './dialog-service.js';
import type { IDocument } from './documents-content-host-service.js';
import type { IDocumentCloseInterceptor } from './document-close-interceptor.js';
import { promptSave, SavePromptResult } from './save-prompt.js';

// Default IDocumentCloseInterceptor: a dirty document prompts Save / Don't Save /
// Cancel before it closes. Save persists then approves; Don't Save approves and
// discards; Cancel vetoes. A save failure vetoes (keeps the tab open + dirty).
// Register under DocumentCloseInterceptorKey to opt an app in. The HOST performs
// the actual Close() after approval — this guard only decides (and saves).
export class SaveOnCloseGuard extends ServiceBase implements IDocumentCloseInterceptor
{
    public static readonly Key = new ServiceKey<SaveOnCloseGuard>('SaveOnCloseGuard');

    private static readonly PromptTitle = 'Unsaved changes';
    private static readonly SaveLabel = 'Save';
    private static readonly DontSaveLabel = "Don't Save";

    public constructor(provider: IServiceProvider, private readonly promptFn: typeof promptSave = promptSave)
    {
        super(provider);
    }

    public async TryClose(document: IDocument): Promise<boolean>
    {
        if (!document.IsDirty) return true;
        const choice = await this.promptFn(this.Provider.get(DialogService.Key), {
            title: SaveOnCloseGuard.PromptTitle,
            message: `"${document.Title}" has unsaved changes.`,
            saveLabel: SaveOnCloseGuard.SaveLabel,
            dontSaveLabel: SaveOnCloseGuard.DontSaveLabel,
        });
        if (choice === SavePromptResult.Cancel) return false;
        if (choice === SavePromptResult.Save)
        {
            try { await document.Save(); }
            catch { return false; }
        }
        return true;
    }

    public async TryCloseAll(documents: readonly IDocument[]): Promise<boolean>
    {
        for (const doc of documents)
        {
            if (!(await this.TryClose(doc))) return false;
        }
        return true;
    }
}
