import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Application, MuralBase, Observable } from '../../../runtime/index.js';
import { HeadlessTarget } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { DialogService } from '../services/dialog-service.js';

// A trivial content VM to stand in for a settings page (rendered via ContentPresenter).
class FakeContent extends MuralBase { }
class FakeObservableContent extends Observable { }

function makeService(host: Border): DialogService
{
    const svc = new DialogService(Application.current!.Services);
    svc.SetHost(host);
    return svc;
}

describe('DialogService', () => {
    test('Show mounts a dialog + scrim on the overlay; Close resolves with the result', async () => {
        initTestApp();
        const host = new Border();
        const target = new HeadlessTarget(400, 300);
        target.Content = host;
        target.Flush();

        const svc = makeService(host);
        assert.equal(svc.IsOpen, false, 'no dialog before Show');

        const closed = svc.Show<string>({ Title: 'Settings', Content: new FakeContent() });
        assert.equal(svc.IsOpen, true, 'open after Show');

        const overlay = target.OverlayRoot as unknown as { Children: { Count: number } } | undefined;
        assert.ok(overlay !== undefined, 'overlay layer created');
        assert.equal(overlay!.Children.Count, 2, 'scrim + dialog attached');

        svc.Close('ok');
        assert.equal(await closed, 'ok', 'Close result flows to the promise');
        assert.equal(svc.IsOpen, false, 'closed after Close');
        const after = (target.OverlayRoot as unknown as { Children?: { Count: number } } | undefined)?.Children;
        assert.equal(after?.Count ?? 0, 0, 'scrim + dialog detached');
    });

    test('a second Show supersedes the first (single active dialog)', async () => {
        initTestApp();
        const host = new Border();
        const target = new HeadlessTarget(400, 300);
        target.Content = host;
        target.Flush();

        const svc = makeService(host);
        const first = svc.Show({ Content: new FakeContent() });
        const second = svc.Show({ Content: new FakeContent() });

        // The first resolves (cancelled) when superseded; the overlay holds one dialog.
        assert.equal(await first, undefined, 'first dialog cancelled by the second');
        const overlay = target.OverlayRoot as unknown as { Children: { Count: number } };
        assert.equal(overlay.Children.Count, 2, 'exactly one dialog (scrim + surface) mounted');
        svc.Close();
        await second;
    });

    test('Show is a no-op without a host (resolves undefined, mounts nothing)', async () => {
        initTestApp();
        const svc = new DialogService(Application.current!.Services);   // no SetHost
        const closed = svc.Show({ Content: new FakeContent() });
        assert.equal(await closed, undefined);
        assert.equal(svc.IsOpen, false);
    });

    test('Show accepts plain Observable content (not just MuralBase)', () => {
        initTestApp();
        const host = new Border();
        const target = new HeadlessTarget(400, 300);
        target.Content = host;
        target.Flush();
        const svc = makeService(host);
        const content = new FakeObservableContent();
        void svc.Show<string>({ Title: 'About', Content: content });
        target.Flush();
        const overlay = target.OverlayRoot as unknown as { Children: { Count: number } };
        assert.equal(overlay.Children.Count, 2);
    });
});
