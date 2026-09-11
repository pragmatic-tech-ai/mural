import { test, describe, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { initTestApp } from '../../../basic/tests/test-app.js';
import { Signal } from '@pragmatic-tech-ai/todl-runtime';
import type { PropertyChangedEventArgs } from '@pragmatic-tech-ai/todl-runtime';
import { type ISettingSource, SettingSourceKey } from '../../services/setting-source.js';
import {
    MetaData,
    MuralBase,
    Panel,
    PropertyValueSource,
    type PropertyKey,
} from '../../index.js';
import { propertyValues } from '../../model-internals.js';

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
// repopulates the store rather than re-registering, which sidesteps the
// ServiceProvider singleton-cache issue (re-registration replaces the
// factory but doesn't invalidate a previously-resolved cached instance).
const fake = new FakeSettingSource();

// Probe with a setting-bound DP (ValueKey) and an unbound DP (PlainKey).
class Probe extends MuralBase
{
    public static readonly ValueKey: PropertyKey<number> = MuralBase.RegisterProperty<number>(
        Probe, 'Value', 7, MetaData.None,
        undefined, undefined, undefined,
        { key: 'probe.value' },
    );
    public get Value(): number { return this.get_property_value(Probe.ValueKey); }
    public set Value(v: number) { this.set_property_value(Probe.ValueKey, v); }

    public static readonly PlainKey: PropertyKey<number> = MuralBase.RegisterProperty<number>(
        Probe, 'Plain', 5, MetaData.None,
    );
    public get Plain(): number { return this.get_property_value(Probe.PlainKey); }
}

// Panel-backed Probe used for the inheritance test — needs Panel so that
// AddChild routes inherited-value propagation through Visual.OnPropertyChanged.
class ProbeSurface extends Panel
{
    public static readonly BoundKey: PropertyKey<number> = MuralBase.RegisterProperty<number>(
        ProbeSurface, 'BoundVal', 3, MetaData.Inherits,
        undefined, undefined, undefined,
        { key: 'probe.bound' },
    );
    public get BoundVal(): number { return this.get_property_value(ProbeSurface.BoundKey); }
    public set BoundVal(v: number) { this.set_property_value(ProbeSurface.BoundKey, v); }
}

// ConvertProbe declared at module scope so its RegisterProperty runs once —
// avoid duplicate registration if describe/test bodies re-run in isolation.
class ConvertProbe extends MuralBase
{
    public static readonly NumKey: PropertyKey<number> = MuralBase.RegisterProperty<number>(
        ConvertProbe, 'Num', 0, MetaData.None,
        undefined, undefined, undefined,
        { key: 'probe.converted', convert: (raw) => Number(raw) * 2 },
    );
    public get Num(): number { return this.get_property_value(ConvertProbe.NumKey); }
}

describe('SettingValue precedence tier', () =>
{
    before(() =>
    {
        const app = initTestApp();
        // Register the shared fake once; subsequent tests mutate its store.
        app.Services.registerInstance(SettingSourceKey, fake);
    });

    afterEach(() =>
    {
        // Reset the store between tests so no key bleeds into the next test.
        fake.clear();
    });

    // ── Bound, setting present ────────────────────────────────────────────────
    test('bound property reads from ISettingSource when EVD exists and key is set', () =>
    {
        fake.set('probe.value', 42);

        const probe = new Probe();
        // Force EVD creation by attaching a listener — get_property_value
        // returns the descriptor default without an EVD (Task 5 adds the
        // no-EVD path). The listener subscribe call triggers ensure_effective_value_for.
        const sub = probe.PropertyChanged('Value').subscribe(() => { /* reactive */ });
        try
        {
            assert.strictEqual(probe.Value, 42);
            assert.strictEqual(probe.GetValueSource(Probe.ValueKey), PropertyValueSource.SettingValue);
        }
        finally
        {
            sub.dispose();
        }
    });

    // ── Bound, setting absent ─────────────────────────────────────────────────
    test('bound property returns descriptor default when key has no value in ISettingSource', () =>
    {
        // fake store is empty (afterEach cleared it).
        const probe = new Probe();
        const sub = probe.PropertyChanged('Value').subscribe(() => { /* reactive */ });
        try
        {
            assert.strictEqual(probe.Value, 7); // DP default
            assert.strictEqual(probe.GetValueSource(Probe.ValueKey), PropertyValueSource.SettingValue);
        }
        finally
        {
            sub.dispose();
        }
    });

    // ── Local overrides setting; ClearValue falls back to setting ─────────────
    test('local set overrides setting; ClearValue reveals setting again', () =>
    {
        fake.set('probe.value', 42);

        const probe = new Probe();
        const sub = probe.PropertyChanged('Value').subscribe(() => { /* reactive */ });
        try
        {
            // Local write shadows setting.
            probe.Value = 100;
            assert.strictEqual(probe.Value, 100);
            assert.strictEqual(probe.GetValueSource(Probe.ValueKey), PropertyValueSource.LocalValue);

            // After clearing the local write, falls back to SettingValue.
            probe.ClearValue(Probe.ValueKey);
            assert.strictEqual(probe.Value, 42);
            assert.strictEqual(probe.GetValueSource(Probe.ValueKey), PropertyValueSource.SettingValue);
        }
        finally
        {
            sub.dispose();
        }
    });

    // ── SetInheritedValue guard fix: inherited value masks SettingValue ──────
    //
    // The guard in SetInheritedValue was updated to allow flipping from
    // SettingValue to InheritedValue (Inherited outranks Setting). This test
    // drives that path directly via the EVD, because the shared descriptor
    // makes it impossible to arrange a "parent provides nothing" scenario
    // through AddChild alone (parent's EVD for the same property also falls
    // to SettingValue, not Default, after clear — so walk_inherited still
    // sees a provided value). Directly calling SetInheritedValue / ClearInherited
    // on the EVD proves the guard permits the flip and that ClearInherited
    // falls through to lowestSource() = SettingValue.
    test('SetInheritedValue flips from SettingValue to InheritedValue; ClearInherited reveals setting', () =>
    {
        fake.set('probe.bound', 99);

        const child = new ProbeSurface();
        // Force EVD creation.
        const sub = child.PropertyChanged('BoundVal').subscribe(() => { /* reactive */ });
        try
        {
            // Child starts at SettingValue.
            assert.strictEqual(child.BoundVal, 99, 'starts at setting value');
            assert.strictEqual(child.GetValueSource(ProbeSurface.BoundKey), PropertyValueSource.SettingValue);

            // Inject an inherited value directly via the EVD.
            const composedKey = ProbeSurface.BoundKey.descriptor.ComposedKey;
            const evd = propertyValues(child).get(composedKey)!;
            assert.ok(evd !== undefined, 'EVD must exist after PropertyChanged subscribe');

            // SetInheritedValue must flip source from SettingValue → InheritedValue.
            evd.SetInheritedValue(55);
            assert.strictEqual(child.BoundVal, 55, 'inherited value masks setting');
            assert.strictEqual(child.GetValueSource(ProbeSurface.BoundKey), PropertyValueSource.InheritedValue);

            // ClearInherited must fall through to SettingValue (lowestSource).
            evd.ClearInherited();
            assert.strictEqual(child.BoundVal, 99, 'setting visible after clear');
            assert.strictEqual(child.GetValueSource(ProbeSurface.BoundKey), PropertyValueSource.SettingValue);
        }
        finally
        {
            sub.dispose();
        }
    });

    // ── Unbound property unchanged ────────────────────────────────────────────
    test('unbound property returns descriptor default and source stays Default', () =>
    {
        // No setting for 'Plain' — it has no SettingValue annotation at all.
        const probe = new Probe();
        const sub = probe.PropertyChanged('Plain').subscribe(() => { /* reactive */ });
        try
        {
            assert.strictEqual(probe.Plain, 5); // DP default
            assert.strictEqual(probe.GetValueSource(Probe.PlainKey), PropertyValueSource.Default);
        }
        finally
        {
            sub.dispose();
        }
    });

    // ── convert callback is applied ───────────────────────────────────────────
    test('convert callback transforms raw setting value', () =>
    {
        fake.set('probe.converted', '21');

        const p = new ConvertProbe();
        const sub = p.PropertyChanged('Num').subscribe(() => { /* reactive */ });
        try
        {
            assert.strictEqual(p.Num, 42); // '21' * 2
            assert.strictEqual(p.GetValueSource(ConvertProbe.NumKey), PropertyValueSource.SettingValue);
        }
        finally
        {
            sub.dispose();
        }
    });
});
