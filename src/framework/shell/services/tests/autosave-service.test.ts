import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';

import { ServiceKey, ServiceProvider } from '../../../../runtime/index.js';
import { ApplicationSettings } from '../application-settings-service.js';
import { ContentHostService } from '../content-host-service.js';
import { AutosaveService } from '../autosave-service.js';
import type { IDocument } from '../documents-content-host-service.js';

class FakeDocument implements IDocument
{
    public readonly Title = 'doc';
    public constructor(public readonly Id: string, public readonly IsDirty: boolean) { }
    public Save(): void { }
}

class FakeHost
{
    public readonly Saved: IDocument[] = [];
    public constructor(private readonly docs: IDocument[]) { }
    public get OpenDocuments() { return { ToArray: (): IDocument[] => this.docs }; }
    public Save(doc: IDocument): void { this.Saved.push(doc); }
}

class FakeSettings
{
    public constructor(private readonly values: Record<string, unknown>) { }
    public Get(key: string): unknown { return this.values[key]; }
    public GetSetting(): undefined { return undefined; }
}

class Fixture
{
    public readonly Provider = new ServiceProvider();

    public constructor(settings: Record<string, unknown>, public readonly Host: FakeHost)
    {
        this.Provider.registerInstance(ApplicationSettings.Key, new FakeSettings(settings) as unknown as ApplicationSettings);
        this.Provider.registerInstance(ContentHostService.Key, Host as unknown as ContentHostService);
    }
}

describe('AutosaveService', () =>
{
    test('Key is a ServiceKey', () =>
    {
        assert.ok(AutosaveService.Key instanceof ServiceKey);
    });

    test('setting keys match the app SettingDefinition keys exactly', () =>
    {
        const keys = AutosaveService as unknown as Record<string, unknown>;
        assert.equal(keys['EnabledSetting'], 'documents.autosave.enabled');
        assert.equal(keys['IntervalSetting'], 'documents.autosave.intervalMinutes');
    });

    test('SaveDirtyDocuments saves only dirty docs and survives a throwing Save', () =>
    {
        const a = new FakeDocument('a', true);
        const b = new FakeDocument('b', true);
        const c = new FakeDocument('c', false);
        const saved: IDocument[] = [];
        AutosaveService.SaveDirtyDocuments({
            OpenDocuments: { ToArray: () => [a, c, b] },
            Save: (d) => { if (d === a) throw new Error('boom'); saved.push(d); },
        });
        assert.deepEqual(saved, [b]);
    });

    test('enabled: a timer tick sweeps dirty documents', () =>
    {
        mock.timers.enable({ apis: ['setInterval'] });
        try
        {
            const a = new FakeDocument('a', true);
            const b = new FakeDocument('b', true);
            const host = new FakeHost([a, b]);
            const f = new Fixture({ 'documents.autosave.enabled': true, 'documents.autosave.intervalMinutes': 1 }, host);
            const svc = new AutosaveService(f.Provider);
            mock.timers.tick(60_000);
            assert.deepEqual(host.Saved, [a, b]);
            svc.dispose();
        }
        finally { mock.timers.reset(); }
    });

    test('disabled: no sweep happens', () =>
    {
        mock.timers.enable({ apis: ['setInterval'] });
        try
        {
            const host = new FakeHost([new FakeDocument('a', true)]);
            const f = new Fixture({ 'documents.autosave.enabled': false }, host);
            const svc = new AutosaveService(f.Provider);
            mock.timers.tick(10 * 60_000);
            assert.equal(host.Saved.length, 0);
            svc.dispose();
        }
        finally { mock.timers.reset(); }
    });
});
