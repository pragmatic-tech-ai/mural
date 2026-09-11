import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { initTestApp } from '../../../../basic/tests/test-app.js';
import {
    Application,
    MetaData,
    MuralBase,
    SettingSourceKey,
    type PropertyKey,
} from '../../../../runtime/index.js';
import { ShellModule } from '../../module.js';
import { SettingDefinition, SettingKind } from '../../settings/setting-definition.js';
import {
    ApplicationSettings,
} from '../application-settings-service.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function definition(key: string, kind: SettingKind, def: unknown): SettingDefinition
{
    const d = new SettingDefinition();
    d.Key = key;
    d.Kind = kind;
    d.Default = def;
    return d;
}

function moduleWith(...defs: SettingDefinition[]): ShellModule
{
    const mod = new ShellModule();
    for (const d of defs) mod.Settings.Add(d);
    return mod;
}

function appWith(...modules: ShellModule[]): Application
{
    const app = new Application();
    for (const m of modules) app.Modules.Add(m);
    app.Services.register(ApplicationSettings.Key, (p) => new ApplicationSettings(p));
    return app;
}

// ── 1. Changed fires on Set ───────────────────────────────────────────────────

describe('ApplicationSettings.Changed fires on Set', () =>
{
    test('Changed(key) emits when Set(key, value) is called', () =>
    {
        const app = appWith(moduleWith(definition('c.num', SettingKind.Number, 0)));
        const settings = app.Services.getRequired(ApplicationSettings.Key);

        let fired = false;
        settings.Changed('c.num').subscribe(() => { fired = true; });

        settings.Set('c.num', 99);

        assert.ok(fired, 'Changed signal must fire after Set');
        assert.equal(settings.Get('c.num'), 99);
    });

    test('Changed for unknown key returns a stable empty signal (same instance)', () =>
    {
        const app = appWith();
        const settings = app.Services.getRequired(ApplicationSettings.Key);

        const s1 = settings.Changed('no.such.key');
        const s2 = settings.Changed('no.such.key');
        assert.strictEqual(s1, s2, 'same Signal instance must be returned for the same unknown key');
    });
});

// ── 2. SettingSourceKey resolves to the same instance ─────────────────────────

describe('SettingSourceKey resolves to ApplicationSettings singleton', () =>
{
    test('provider.getRequired(SettingSourceKey) === provider.getRequired(ApplicationSettings.Key)', () =>
    {
        const app = new Application();
        app.Services.register(ApplicationSettings.Key, (p) => new ApplicationSettings(p));
        app.Services.register(SettingSourceKey, (p) => p.getRequired(ApplicationSettings.Key));

        const asSettings = app.Services.getRequired(ApplicationSettings.Key);
        const asSource   = app.Services.getRequired(SettingSourceKey);

        assert.strictEqual(asSource, asSettings,
            'SettingSourceKey must resolve to the same singleton as ApplicationSettings.Key');
    });
});

// ── 3. End-to-end: bound DP reflects and reacts to ApplicationSettings ────────

// Probe declared at module scope so RegisterProperty runs exactly once.
class Probe extends MuralBase
{
    public static readonly BoundKey: PropertyKey<number> = MuralBase.RegisterProperty<number>(
        Probe, 'Bound', -1, MetaData.None,
        undefined, undefined, undefined,
        { key: 'probe.setting' },
    );
    public get Bound(): number { return this.get_property_value(Probe.BoundKey); }
}

describe('End-to-end: bound DP reflects ApplicationSettings via SettingSourceKey', () =>
{
    test('cold read: probe.Bound equals the current setting value', () =>
    {
        const app = initTestApp();
        app.Services.register(ApplicationSettings.Key, (p) => new ApplicationSettings(p));
        app.Services.register(SettingSourceKey, (p) => p.getRequired(ApplicationSettings.Key));
        const settings = app.Services.getRequired(ApplicationSettings.Key);
        settings.Contribute([definition('probe.setting', SettingKind.Number, 77)]);

        const probe = new Probe();
        // Subscribe once to arm the EVD / SettingValue tier.
        const sub = probe.PropertyChanged('Bound').subscribe(() => { /* arm */ });
        try
        {
            assert.equal(probe.Bound, 77, 'cold read must return the setting default');
        }
        finally
        {
            sub.dispose();
        }
    });

    test('pull path: Set(key, X) is reflected on a fresh read of probe.Bound', () =>
    {
        const app = initTestApp();
        app.Services.register(ApplicationSettings.Key, (p) => new ApplicationSettings(p));
        app.Services.register(SettingSourceKey, (p) => p.getRequired(ApplicationSettings.Key));
        const settings = app.Services.getRequired(ApplicationSettings.Key);
        settings.Contribute([definition('probe.setting', SettingKind.Number, 0)]);

        const probe = new Probe();
        const sub = probe.PropertyChanged('Bound').subscribe(() => { /* arm */ });
        try
        {
            void probe.Bound; // force EVD creation
            settings.Set('probe.setting', 42);
            assert.equal(probe.Bound, 42, 'pull path: Bound must reflect the updated setting');
        }
        finally
        {
            sub.dispose();
        }
    });

    test('reactive path: Set(key, Y) fires probe.PropertyChanged listener', () =>
    {
        const app = initTestApp();
        app.Services.register(ApplicationSettings.Key, (p) => new ApplicationSettings(p));
        app.Services.register(SettingSourceKey, (p) => p.getRequired(ApplicationSettings.Key));
        const settings = app.Services.getRequired(ApplicationSettings.Key);
        settings.Contribute([definition('probe.setting', SettingKind.Number, 0)]);

        const probe = new Probe();
        let fired = false;
        const sub = probe.PropertyChanged('Bound').subscribe(() => { fired = true; });
        try
        {
            void probe.Bound; // arm the setting subscription
            settings.Set('probe.setting', 55);
            assert.ok(fired, 'reactive path: PropertyChanged on Bound must fire after Set');
            assert.equal(probe.Bound, 55);
        }
        finally
        {
            sub.dispose();
        }
    });
});
