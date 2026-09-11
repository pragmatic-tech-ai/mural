import { test, describe, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { initTestApp } from '../../../basic/tests/test-app.js';
import { Signal } from '@pragmatic-tech-ai/todl-runtime';
import type { PropertyChangedEventArgs } from '@pragmatic-tech-ai/todl-runtime';
import { type ISettingSource, SettingSourceKey } from '../../services/setting-source.js';
import {
    MetaData,
    MuralBase,
    PropertyValueSource,
    type PropertyKey,
} from '../../index.js';
import { propertyValues } from '../../model-internals.js';

// Fake ISettingSource that emits real PropertyChangedEventArgs with
// oldValue/newValue when its in-process store is mutated.
class FakeSettingSource implements ISettingSource
{
    private readonly _store = new Map<string, unknown>();
    private readonly _signals = new Map<string, Signal<PropertyChangedEventArgs>>();

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

    // Mutate the store and emit a change event with correct old/new values.
    public change(key: string, oldValue: unknown, newValue: unknown): void
    {
        this._store.set(key, newValue);
        this.Changed(key).emit({ property: key, oldValue, newValue } as PropertyChangedEventArgs);
    }

    public set(key: string, value: unknown): void
    {
        this._store.set(key, value);
    }

    public clear(): void
    {
        this._store.clear();
    }
}

const fake = new FakeSettingSource();

class Probe extends MuralBase
{
    public static readonly ValueKey: PropertyKey<number> = MuralBase.RegisterProperty<number>(
        Probe, 'Value', 7, MetaData.None,
        undefined, undefined, undefined,
        { key: 'probe.value' },
    );
    public get Value(): number { return this.get_property_value(Probe.ValueKey); }
    public set Value(v: number) { this.set_property_value(Probe.ValueKey, v); }

    public ClearValue(key: PropertyKey<number>): void { super.ClearValue(key); }
}

describe('SettingValue reactivity (Task 4)', () =>
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

    // ── Reacts to setting change ──────────────────────────────────────────────
    test('reacts: listener fires when setting value changes while at SettingValue tier', () =>
    {
        fake.set('probe.value', 7);

        const probe = new Probe();
        let fired = false;
        let capturedNew: unknown;
        const sub = probe.PropertyChanged('Value').subscribe((args) =>
        {
            fired = true;
            capturedNew = args.newValue;
        });
        try
        {
            // Force lazy subscribe by reading the value (triggers resolveSettingValue).
            const initial = probe.Value;
            assert.strictEqual(initial, 7, 'should read setting value initially');
            assert.strictEqual(probe.GetValueSource(Probe.ValueKey), PropertyValueSource.SettingValue);

            // Now change the setting.
            fired = false;
            fake.change('probe.value', 7, 55);

            assert.ok(fired, 'listener must have fired after setting change');
            assert.strictEqual(capturedNew, 55, 'listener must report newValue = 55');
            assert.strictEqual(probe.Value, 55, 'probe.Value must reflect new setting');
        }
        finally
        {
            sub.dispose();
        }
    });

    // ── Masked by local value: no emit ────────────────────────────────────────
    test('masked: no listener emit when setting changes but local value masks it', () =>
    {
        fake.set('probe.value', 10);

        const probe = new Probe();
        let fired = false;
        const sub = probe.PropertyChanged('Value').subscribe(() => { fired = true; });
        try
        {
            // Read once to force subscription.
            void probe.Value;

            // Install a local value that masks the setting.
            probe.Value = 100;
            assert.strictEqual(probe.GetValueSource(Probe.ValueKey), PropertyValueSource.LocalValue);

            // Reset fired flag, then change the underlying setting.
            fired = false;
            fake.change('probe.value', 10, 99);

            assert.ok(!fired, 'listener must NOT fire when setting is masked by local value');
            assert.strictEqual(probe.Value, 100, 'probe.Value must still be the local value');

            // After clearing local value the pull path reveals latest setting.
            probe.ClearValue(Probe.ValueKey);
            assert.strictEqual(probe.GetValueSource(Probe.ValueKey), PropertyValueSource.SettingValue);
            assert.strictEqual(probe.Value, 99, 'probe.Value must reflect the latest setting after ClearValue');
        }
        finally
        {
            sub.dispose();
        }
    });

    // ── Demand-driven: subscription tracks changed-listener lifetime ──────────
    test('demand-driven: setting subscription opens on first listener, closes on last', () =>
    {
        fake.set('probe.value', 5);

        const probe = new Probe();
        // Baseline before this probe observes anything (the shared fake Signal
        // may carry leaked subscriptions from sibling tests).
        const baseline = fake.Changed('probe.value').subscriberCount;

        // No listener yet — no setting subscription, even after a read (the
        // read path no longer subscribes on its own).
        void probe.Value;
        assert.strictEqual(
            fake.Changed('probe.value').subscriberCount,
            baseline,
            'reading without a listener must not open a setting subscription',
        );

        // First listener opens exactly one setting subscription.
        const sub1 = probe.PropertyChanged('Value').subscribe(() => { /* reactive */ });
        assert.strictEqual(
            fake.Changed('probe.value').subscriberCount,
            baseline + 1,
            'first listener must open exactly one setting subscription',
        );

        // A second listener does not open another.
        const sub2 = probe.PropertyChanged('Value').subscribe(() => { /* reactive */ });
        assert.strictEqual(
            fake.Changed('probe.value').subscriberCount,
            baseline + 1,
            'additional listeners must not open more setting subscriptions',
        );

        // Dropping one of two keeps the subscription alive.
        sub2.dispose();
        assert.strictEqual(
            fake.Changed('probe.value').subscriberCount,
            baseline + 1,
            'subscription must survive while any listener remains',
        );

        // Dropping the last listener releases the setting subscription.
        sub1.dispose();
        assert.strictEqual(
            fake.Changed('probe.value').subscriberCount,
            baseline,
            'last listener leaving must release the setting subscription',
        );
    });

    // ── Teardown (EVD removal) releases the subscription ──────────────────────
    test('teardown: releases setting subscription and subsequent changes do not fire listener', () =>
    {
        fake.set('probe.value', 5);

        const probe = new Probe();
        const baseline = fake.Changed('probe.value').subscriberCount;

        let fired = false;
        const sub = probe.PropertyChanged('Value').subscribe(() => { fired = true; });
        try
        {
            // Listener attach opened the subscription.
            assert.strictEqual(
                fake.Changed('probe.value').subscriberCount,
                baseline + 1,
                'listener attach must open the setting subscription',
            );
            assert.strictEqual(probe.GetValueSource(Probe.ValueKey), PropertyValueSource.SettingValue);

            // teardown() (the remove_via_descriptor path) hard-releases the
            // subscription even though a listener is still attached.
            const composedKey = Probe.ValueKey.descriptor.ComposedKey;
            const evd = propertyValues(probe).get(composedKey);
            assert.ok(evd !== undefined, 'EVD must exist after PropertyChanged subscribe');
            evd.teardown();
            assert.strictEqual(
                fake.Changed('probe.value').subscriberCount,
                baseline,
                'teardown must release the setting subscription',
            );

            // A subsequent setting change must NOT fire the listener (no read
            // occurs, so the guarded retry never re-opens the subscription).
            fired = false;
            fake.change('probe.value', 5, 77);
            assert.ok(!fired, 'listener must NOT fire after teardown');
        }
        finally
        {
            sub.dispose();
        }
    });
});
