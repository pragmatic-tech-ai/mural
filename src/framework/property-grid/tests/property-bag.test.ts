import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DpPropertyBag } from '../property-bag.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { MuralBase, MetaData, type CoerceValue } from '../../../runtime/index.js';

// The DP-free MapPropertyBag core lives in @pragmatic-tech-ai/todl-runtime and is
// exercised by todl-runtime's own property-bag.test.ts. This file covers
// DpPropertyBag — the reflective bag over MuralBase dependency properties.

// ---------------------------------------------------------------------------
// Probe class for DpPropertyBag tests
// ---------------------------------------------------------------------------
class Probe extends MuralBase
{
    static readonly ValueKey = MuralBase.RegisterProperty<number>(Probe, 'Value', 0, MetaData.None);
    get Value(): number
    {
        return this.get_property_value(Probe.ValueKey);
    }
    set Value(v: number)
    {
        this.set_property_value(Probe.ValueKey, v);
    }

    // Read-only DP — only the holder of the key may write it
    static readonly ReadOnlyKey = MuralBase.RegisterReadOnlyProperty<string>(
        Probe,
        'ReadOnly',
        'initial',
        MetaData.None,
    );
    get ReadOnly(): string
    {
        return this.get_property_value(Probe.ReadOnlyKey);
    }

    // Coercing DP — clamps number to [0, 100]
    private static readonly clamp: CoerceValue = (_model, v) =>
        Math.max(0, Math.min(100, v as number));
    static readonly ClampedKey = MuralBase.RegisterProperty<number>(
        Probe,
        'Clamped',
        50,
        MetaData.None,
        Probe.clamp,
    );
    get Clamped(): number
    {
        return this.get_property_value(Probe.ClampedKey);
    }
    set Clamped(v: number)
    {
        this.set_property_value(Probe.ClampedKey, v);
    }
}

// ---------------------------------------------------------------------------
// DpPropertyBag — reflective bag over MuralBase dependency properties
// ---------------------------------------------------------------------------
describe('DpPropertyBag — GetValue/SetValue round-trip', () => {
    beforeEach(() => {
        initTestApp();
    });

    test('GetValue returns the DP default before any write', () => {
        const probe = new Probe();
        const bag = new DpPropertyBag(probe);
        assert.equal(bag.GetValue('Value'), 0);
    });

    test('SetValue writes through to the DP; GetValue reflects it', () => {
        const probe = new Probe();
        const bag = new DpPropertyBag(probe);
        bag.SetValue('Value', 42);
        assert.equal(bag.GetValue('Value'), 42);
    });

    test('SetValue is visible via the native accessor on the instance', () => {
        const probe = new Probe();
        const bag = new DpPropertyBag(probe);
        bag.SetValue('Value', 7);
        assert.equal(probe.Value, 7);
    });

    test('GetValue picks up a write made via the native accessor', () => {
        const probe = new Probe();
        const bag = new DpPropertyBag(probe);
        probe.Value = 99;
        assert.equal(bag.GetValue('Value'), 99);
    });

    test('GetValue throws on unknown name', () => {
        const probe = new Probe();
        const bag = new DpPropertyBag(probe);
        assert.throws(() => bag.GetValue('NoSuch'), /NoSuch/);
    });

    test('SetValue throws on unknown name', () => {
        const probe = new Probe();
        const bag = new DpPropertyBag(probe);
        assert.throws(() => bag.SetValue('NoSuch', 1), /NoSuch/);
    });
});

describe('DpPropertyBag — IsReadOnly', () => {
    beforeEach(() => {
        initTestApp();
    });

    test('IsReadOnly is false for a normal read/write DP', () => {
        const probe = new Probe();
        const bag = new DpPropertyBag(probe);
        assert.equal(bag.IsReadOnly('Value'), false);
    });

    test('IsReadOnly is true for a read-only DP', () => {
        const probe = new Probe();
        const bag = new DpPropertyBag(probe);
        assert.equal(bag.IsReadOnly('ReadOnly'), true);
    });
});

describe('DpPropertyBag — coercion', () => {
    beforeEach(() => {
        initTestApp();
    });

    test('SetValue runs DP coercion — value above ceiling is clamped', () => {
        const probe = new Probe();
        const bag = new DpPropertyBag(probe);
        bag.SetValue('Clamped', 200);
        assert.equal(bag.GetValue('Clamped'), 100);
    });

    test('SetValue runs DP coercion — value below floor is clamped', () => {
        const probe = new Probe();
        const bag = new DpPropertyBag(probe);
        bag.SetValue('Clamped', -50);
        assert.equal(bag.GetValue('Clamped'), 0);
    });

    test('GetValue returns coerced default even before any write', () => {
        const probe = new Probe();
        const bag = new DpPropertyBag(probe);
        // default is 50, within [0, 100] → coerce returns 50 unchanged
        assert.equal(bag.GetValue('Clamped'), 50);
    });
});

describe('DpPropertyBag — Observe', () => {
    beforeEach(() => {
        initTestApp();
    });

    test('Observe fires when the DP is changed externally via native accessor', () => {
        const probe = new Probe();
        const bag = new DpPropertyBag(probe);
        let callCount = 0;
        bag.Observe('Value').subscribe(() => {
            callCount++;
        });
        probe.Value = 1;
        assert.equal(callCount, 1);
        probe.Value = 2;
        assert.equal(callCount, 2);
    });

    test('Observe fires when SetValue is called through the bag', () => {
        const probe = new Probe();
        const bag = new DpPropertyBag(probe);
        let callCount = 0;
        bag.Observe('Value').subscribe(() => {
            callCount++;
        });
        bag.SetValue('Value', 5);
        assert.equal(callCount, 1);
    });

    test('Disposer returned by Observe stops further callbacks', () => {
        const probe = new Probe();
        const bag = new DpPropertyBag(probe);
        let callCount = 0;
        const sub = bag.Observe('Value').subscribe(() => {
            callCount++;
        });
        probe.Value = 10;
        assert.equal(callCount, 1);
        sub.dispose();
        probe.Value = 20;
        // Listener removed — count must not increase
        assert.equal(callCount, 1);
    });

    test('Dispose detaches the DP bridge so later changes do not emit', () => {
        const probe = new Probe();
        const bag = new DpPropertyBag(probe);
        let callCount = 0;
        bag.Observe('Value').subscribe(() => {
            callCount++;
        });
        probe.Value = 1;
        assert.equal(callCount, 1);
        bag.dispose();
        probe.Value = 2;
        // Bridge listener removed — the signal no longer receives DP changes
        assert.equal(callCount, 1);
    });
});

describe('DpPropertyBag — iteration', () => {
    beforeEach(() => {
        initTestApp();
    });

    test('yields an accessor per DP; displayName falls back to the name', () => {
        const probe = new Probe();
        const bag = new DpPropertyBag(probe);
        const byName = new Map([...bag].map(([name, acc]) => [name, acc]));
        const value = byName.get('Value');
        assert.ok(value !== undefined, 'Value DP is enumerated');
        assert.equal(value!.id(), 'Value');
        assert.equal(value!.displayName(), 'Value');
        assert.equal(value!.get(), 0); // DP default before any write
    });
});
