import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    Application,
    MetaData,
    MuralBase,
    SettingSourceKey,
    type PropertyKey,
} from '../../../../runtime/index.js';
import { ApplicationSettings } from '../application-settings-service.js';
import { SettingDefinition, SettingKind } from '../../settings/setting-definition.js';

// Regression for the canvas-icon bug: a setting-backed DP that is bound/observed
// BEFORE any ISettingSource is reachable (early render, before shell services
// wire) must re-arm and pick up its value once a source comes online — not latch
// the DP default forever. Uses a fresh Application (not the shared initTestApp) so
// the "no source yet" starting state is real.

class LateProbe extends MuralBase
{
    public static readonly BoundKey: PropertyKey<number> = MuralBase.RegisterProperty<number>(
        LateProbe, 'Bound', -1, MetaData.None,
        undefined, undefined, undefined,
        { key: 'late.probe' },
    );
    public get Bound(): number { return this.get_property_value(LateProbe.BoundKey); }
}

function numDef(key: string, def: number): SettingDefinition
{
    const d = new SettingDefinition();
    d.Key = key; d.Kind = SettingKind.Number; d.Default = def;
    return d;
}

let prior: Application | undefined;
afterEach(() => { if (prior !== undefined) Application.current = prior; });

describe('setting-backed DP re-arms when a source comes online late', () =>
{
    test('armed source-less, then ApplicationSettings + setting appear → DP updates and notifies', () =>
    {
        prior = Application.current;
        const app = new Application();
        Application.current = app;

        const probe = new LateProbe();
        let fired = 0;
        // Subscribing arms the SettingValue tier; with no source it registers to wait.
        const sub = probe.PropertyChanged('Bound').subscribe(() => { fired++; });
        try
        {
            assert.equal(probe.Bound, -1, 'source-less read returns the DP default');

            // The source comes online AFTER the arm — the exact race that latched 0.
            app.Services.register(ApplicationSettings.Key, (p) => new ApplicationSettings(p));
            app.Services.register(SettingSourceKey, (p) => p.getRequired(ApplicationSettings.Key));
            const settings = app.Services.getRequired(ApplicationSettings.Key);
            settings.Contribute([numDef('late.probe', 80)]);   // fires notifyAvailable → re-arm

            assert.equal(probe.Bound, 80, 'DP re-armed off the late source and re-read its value');
            assert.ok(fired >= 1, 'PropertyChanged fired when the value moved off the default');

            // And the live path works now that the subscription is armed.
            settings.Set('late.probe', 120);
            assert.equal(probe.Bound, 120, 'a later Set is reflected');
        }
        finally
        {
            sub.dispose();
        }
    });
});
