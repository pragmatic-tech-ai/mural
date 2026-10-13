import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { IServiceProvider } from '../../../runtime/index.js';
import {
    DocumentsContentHostService,
    type IDocument,
} from '../services/documents-content-host-service.js';
import {
    DocumentCloseInterceptorKey,
    type IDocumentCloseInterceptor,
} from '../services/document-close-interceptor.js';

class FakeDoc implements IDocument
{
    public IsDirty = false;
    constructor(public readonly Id: string, public readonly Title: string = Id) {}
    public Save(): void { this.IsDirty = false; }
}

// Records calls and returns a scripted decision.
class FakeInterceptor implements IDocumentCloseInterceptor
{
    public readonly SingleCalls: IDocument[] = [];
    public readonly BatchCalls: (readonly IDocument[])[] = [];
    constructor(private readonly decision: boolean) {}
    public async TryClose(document: IDocument): Promise<boolean>
    {
        this.SingleCalls.push(document);
        return this.decision;
    }
    public async TryCloseAll(documents: readonly IDocument[]): Promise<boolean>
    {
        this.BatchCalls.push(documents);
        return this.decision;
    }
}

class HostFactory
{
    public static Make(interceptor: IDocumentCloseInterceptor | undefined, ...docs: FakeDoc[]): DocumentsContentHostService
    {
        const provider = {
            get: (key: unknown) => key === DocumentCloseInterceptorKey ? interceptor : undefined,
        } as unknown as IServiceProvider;
        const host = new DocumentsContentHostService(provider);
        for (const d of docs) host.Open(d);
        return host;
    }
}

describe('DocumentsContentHostService — closing veto', () =>
{
    test('TryClose with approving interceptor removes the doc and returns true', async () =>
    {
        const a = new FakeDoc('a');
        const ic = new FakeInterceptor(true);
        const host = HostFactory.Make(ic, a);
        assert.equal(await host.TryClose(a), true);
        assert.equal(host.OpenDocuments.Count, 0);
        assert.deepEqual(ic.SingleCalls, [a]);
    });

    test('TryClose with vetoing interceptor keeps the doc and returns false', async () =>
    {
        const a = new FakeDoc('a');
        const host = HostFactory.Make(new FakeInterceptor(false), a);
        assert.equal(await host.TryClose(a), false);
        assert.equal(host.OpenDocuments.Count, 1);
    });

    test('TryCloseAll approve closes all; veto leaves all', async () =>
    {
        const ok = new FakeInterceptor(true);
        const h1 = HostFactory.Make(ok, new FakeDoc('a'), new FakeDoc('b'));
        assert.equal(await h1.TryCloseAll(), true);
        assert.equal(h1.OpenDocuments.Count, 0);
        assert.equal(ok.BatchCalls[0]!.length, 2);

        const h2 = HostFactory.Make(new FakeInterceptor(false), new FakeDoc('a'), new FakeDoc('b'));
        assert.equal(await h2.TryCloseAll(), false);
        assert.equal(h2.OpenDocuments.Count, 2);
    });

    test('no interceptor registered closes unconditionally', async () =>
    {
        const a = new FakeDoc('a');
        const host = HostFactory.Make(undefined, a, new FakeDoc('b'));
        assert.equal(await host.TryClose(a), true);
        assert.equal(host.OpenDocuments.Count, 1);
        assert.equal(await host.TryCloseAll(), true);
        assert.equal(host.OpenDocuments.Count, 0);
    });

    test('raw Close does not consult the interceptor', () =>
    {
        const a = new FakeDoc('a');
        const ic = new FakeInterceptor(false);
        const host = HostFactory.Make(ic, a);
        host.Close(a);
        assert.equal(host.OpenDocuments.Count, 0);
        assert.equal(ic.SingleCalls.length, 0);
        assert.equal(ic.BatchCalls.length, 0);
    });

    test('CloseDocumentCommand routes through the guarded path', async () =>
    {
        const a = new FakeDoc('a');
        const ic = new FakeInterceptor(false);
        const host = HostFactory.Make(ic, a);
        host.CloseDocumentCommand.Execute('a');
        await new Promise<void>(resolve => setImmediate(resolve));
        assert.equal(ic.SingleCalls.length, 1);
        assert.equal(host.OpenDocuments.Count, 1);
    });
});
