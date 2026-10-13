import { ServiceKey } from '../../../runtime/index.js';
import type { IDocument } from './documents-content-host-service.js';

// Optional veto consulted by DocumentsContentHostService before a USER-initiated
// close removes a document. Resolve true to proceed, false to cancel. The batch
// form guards Close-All / quit and returns false to abort the whole batch. A
// host with no interceptor registered closes unconditionally (unchanged behavior).
// mural's default implementation is SaveOnCloseGuard (dirty-save prompt).
export interface IDocumentCloseInterceptor
{
    TryClose(document: IDocument): Promise<boolean>;
    TryCloseAll(documents: readonly IDocument[]): Promise<boolean>;
}

export const DocumentCloseInterceptorKey = new ServiceKey<IDocumentCloseInterceptor>('DocumentCloseInterceptor');
