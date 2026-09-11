import { test, describe, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { initTestApp } from '../../basic/tests/test-app.js';
import { Signal } from '@pragmatic-tech-ai/todl-runtime';
import type { PropertyChangedEventArgs } from '@pragmatic-tech-ai/todl-runtime';
import { type ISettingSource, SettingSourceKey } from '../services/setting-source.js';
import {
    MetaData,
    MuralBase,
    PropertyValueSource,
    type PropertyKey,
} from '../index.js';
import { propertyValues } from '../model-internals.js';

// Minimal ISettingSource fake — writable in-process store.
class FakeSettingSource implements ISettingSource
{
    private readonly _store = new Map<string, unknown>();
    private readonly _signals = new Map<string, Signal<PropertyChangedEventArgs>>();

    public set(key: string, value: unknown): void
    {
        this._store.set(key, value);
    }

    public clear(): void
    {
        this._store.clear();
    }

    public Get(key: string): unknown
    {
        return this._store.get(key);
    }

    public Changed(key: string): Signal<PropertyChangedEventArgs>
    {
        let sig = this._signals.get(key);
        if (sig === undefined)
        {
            sig = new Signal<PropertyChangedEventArgs>();
            this._signals.set(key, sig);
        }
        return sig;
    }
}

// A single fake registered once on the shared app. Each test clears and
// repopulates the store rather than re-registering.
const fake = new FakeSettingSource();

// Probe with a setting-bound DP (ValueKey, default 7) and an unbound DP (PlainKey, default 5).
// Declared at module scope so RegisterProperty runs once.
class Probe extends MuralBase
{
    public static readonly ValueKey: PropertyKey<number> = MuralBase.RegisterProperty<number>(
        Probe, 'Value', 7, MetaData.None,
        undefined, undefined, undefined,
        { key: 'probe.value' },
    );
    public get Value(): number { return this.get_property_value(Probe.ValueKey); }

    public static readonly PlainKey: PropertyKey<number> = MuralBase.RegisterProperty<number>(
        Probe, 'Plain', 5, MetaData.None,
    );
    public get Plain(): number { return this.get_property_value(Probe.PlainKey); }
}

describe('SettingValue no-EVD read path', () =>
{
    before(() =>
    {
        const app = initTestApp();
        app.Services.registerInstance(SettingSourceKey, fake);
    });

    afterEach(() =>
    {
        fake.clear();
    });

    // ── Bound, setting present — no EVD created, no listener attached ────────
    test('bound property reads setting value via no-EVD path', () =>
    {
        fake.set('probe.value', 42);

        const probe = new Probe();
        // Deliberately do NOT attach any listener and do NOT write the property.
        // This leaves property_values empty — no EVD exists for ValueKey.

        assert.strictEqual(probe.Value, 42, 'should resolve setting without an EVD');
        assert.strictEqual(
            probe.GetValueSource(Probe.ValueKey),
            PropertyValueSource.SettingValue,
            'source must be SettingValue even without an EVD',
        );
    });

    // ── Verify no EVD was created and no subscription was made ──────────────
    test('no-EVD read does not allocate an EVD or subscribe to the setting', () =>
    {
        fake.set('probe.value', 42);

        const probe = new Probe();
        // Cold read — should not create an EVD.
        const _ = probe.Value;

        const map = propertyValues(probe);
        assert.strictEqual(
            map.get(Probe.ValueKey.descriptor.ComposedKey),
            undefined,
            'no EVD must be created by the no-EVD read path',
        );

        assert.strictEqual(
            fake.Changed('probe.value').subscriberCount,
            0,
            'static resolver must not subscribe to the setting signal',
        );
    });

    // ── Bound, setting absent: returns DP default; source still SettingValue ─
    test('bound property returns descriptor default when setting is absent, source is SettingValue', () =>
    {
        // fake store is empty.
        const probe = new Probe();

        assert.strictEqual(probe.Value, 7, 'should fall back to DP default');
        assert.strictEqual(
            probe.GetValueSource(Probe.ValueKey),
            PropertyValueSource.SettingValue,
            'source must still be SettingValue for a bound descriptor even with no stored value',
        );
    });

    // ── Unbound property is unaffected ───────────────────────────────────────
    test('unbound property returns descriptor default and source is Default', () =>
    {
        const probe = new Probe();

        assert.strictEqual(probe.Plain, 5, 'unbound DP should return its default');
        assert.strictEqual(
            probe.GetValueSource(Probe.PlainKey),
            PropertyValueSource.Default,
            'unbound descriptor source must be Default',
        );
    });
});
