import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MapPropertyBag, DpPropertyBag, type PropertyAccessor } from '../property-bag.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { MuralBase, MetaData, PropertyKey, type CoerceValue } from '../../../runtime/index.js';

// ---------------------------------------------------------------------------
// Probe class for DpPropertyBag tests
// ---------------------------------------------------------------------------
class Probe extends MuralBase {
    static readonly ValueKey = MuralBase.RegisterProperty<number>(Probe, 'Value', 0, MetaData.None);
    get Value(): number { return this.get_property_value(Probe.ValueKey); }
    set Value(v: number) { this.set_property_value(Probe.ValueKey, v); }

    // Read-only DP — only the holder of the key may write it
    static readonly ReadOnlyKey = MuralBase.RegisterReadOnlyProperty<string>(Probe, 'ReadOnly', 'initial', MetaData.None);
    get ReadOnly(): string { return this.get_property_value(Probe.ReadOnlyKey); }

    // Coercing DP — clamps number to [0, 100]
    private static readonly clamp: CoerceValue = (_model, v) => Math.max(0, Math.min(100, v as number));
    static readonly ClampedKey = MuralBase.RegisterProperty<number>(Probe, 'Clamped', 50, MetaData.None, Probe.clamp);
    get Clamped(): number { return this.get_property_value(Probe.ClampedKey); }
    set Clamped(v: number) { this.set_property_value(Probe.ClampedKey, v); }
}

describe('MapPropertyBag — get/set via delegates', () => {
    test('GetValue delegates to accessor.get()', () => {
        let stored = 42;
        const accessors = new Map<string, PropertyAccessor>([
            ['count', { get: () => stored, set: (v) => { stored = v as number; } }],
        ]);
        const bag = new MapPropertyBag(accessors);
        assert.equal(bag.GetValue('count'), 42);
    });

    test('SetValue delegates to accessor.set()', () => {
        let stored = 0;
        const accessors = new Map<string, PropertyAccessor>([
            ['count', { get: () => stored, set: (v) => { stored = v as number; } }],
        ]);
        const bag = new MapPropertyBag(accessors);
        bag.SetValue('count', 99);
        assert.equal(stored, 99);
    });
});

describe('MapPropertyBag — IsReadOnly', () => {
    test('IsReadOnly is false when accessor has set', () => {
        const accessors = new Map<string, PropertyAccessor>([
            ['x', { get: () => 1, set: () => {} }],
        ]);
        const bag = new MapPropertyBag(accessors);
        assert.equal(bag.IsReadOnly('x'), false);
    });

    test('IsReadOnly is true when accessor has no set', () => {
        const accessors = new Map<string, PropertyAccessor>([
            ['x', { get: () => 1 }],
        ]);
        const bag = new MapPropertyBag(accessors);
        assert.equal(bag.IsReadOnly('x'), true);
    });
});

describe('MapPropertyBag — bag-owned notification', () => {
    test('SetValue fires bag-owned listeners when accessor has no observe', () => {
        let stored = 0;
        const accessors = new Map<string, PropertyAccessor>([
            ['v', { get: () => stored, set: (val) => { stored = val as number; } }],
        ]);
        const bag = new MapPropertyBag(accessors);
        let notified = 0;
        bag.Observe('v', () => { notified++; });
        bag.SetValue('v', 10);
        assert.equal(notified, 1);
        bag.SetValue('v', 20);
        assert.equal(notified, 2);
    });

    test('Observe returns unsubscribe that stops notifications', () => {
        let stored = 0;
        const accessors = new Map<string, PropertyAccessor>([
            ['v', { get: () => stored, set: (val) => { stored = val as number; } }],
        ]);
        const bag = new MapPropertyBag(accessors);
        let notified = 0;
        const unsub = bag.Observe('v', () => { notified++; });
        bag.SetValue('v', 1);
        assert.equal(notified, 1);
        unsub();
        bag.SetValue('v', 2);
        // Listener was removed — count must not increase
        assert.equal(notified, 1);
    });
});

describe('MapPropertyBag — accessor.observe delegation', () => {
    test('Observe uses accessor.observe when present', () => {
        let externalUnsub: (() => void) | null = null;
        let externalCb: (() => void) | null = null;
        const accessors = new Map<string, PropertyAccessor>([
            ['x', {
                get: () => 0,
                observe: (cb) => {
                    externalCb = cb;
                    externalUnsub = () => { externalCb = null; };
                    return externalUnsub;
                },
            }],
        ]);
        const bag = new MapPropertyBag(accessors);
        let notified = 0;
        bag.Observe('x', () => { notified++; });
        // Simulate the external source firing
        externalCb?.();
        assert.equal(notified, 1);
    });

    test('SetValue does NOT double-fire when accessor supplies observe', () => {
        // The accessor owns notification; SetValue must not also fire bag listeners
        let externalCb: (() => void) | null = null;
        let stored = 0;
        const accessors = new Map<string, PropertyAccessor>([
            ['x', {
                get: () => stored,
                set: (v) => { stored = v as number; },
                observe: (cb) => {
                    externalCb = cb;
                    return () => { externalCb = null; };
                },
            }],
        ]);
        const bag = new MapPropertyBag(accessors);
        let notified = 0;
        bag.Observe('x', () => { notified++; });
        // SetValue calls set() but must NOT fire bag's own emitter (accessor.observe owns it)
        bag.SetValue('x', 7);
        assert.equal(notified, 0, 'bag must not double-fire when accessor owns notification');
        // The accessor's own channel still works independently
        externalCb?.();
        assert.equal(notified, 1);
    });

    test('Observe unsubscribe from accessor.observe path removes listener', () => {
        let externalCb: (() => void) | null = null;
        const accessors = new Map<string, PropertyAccessor>([
            ['x', {
                get: () => 0,
                observe: (cb) => {
                    externalCb = cb;
                    return () => { externalCb = null; };
                },
            }],
        ]);
        const bag = new MapPropertyBag(accessors);
        let notified = 0;
        const unsub = bag.Observe('x', () => { notified++; });
        externalCb?.();
        assert.equal(notified, 1);
        unsub();
        externalCb?.();
        // After unsub the accessor's own source no longer drives our listener
        assert.equal(notified, 1);
    });
});

describe('MapPropertyBag — unknown name throws', () => {
    test('GetValue throws on unknown name', () => {
        const bag = new MapPropertyBag(new Map());
        assert.throws(() => bag.GetValue('missing'), /missing/);
    });

    test('SetValue throws on unknown name', () => {
        const bag = new MapPropertyBag(new Map());
        assert.throws(() => bag.SetValue('missing', 1), /missing/);
    });

    test('IsReadOnly throws on unknown name', () => {
        const bag = new MapPropertyBag(new Map());
        assert.throws(() => bag.IsReadOnly('missing'), /missing/);
    });

    test('Observe throws on unknown name', () => {
        const bag = new MapPropertyBag(new Map());
        assert.throws(() => bag.Observe('missing', () => {}), /missing/);
    });
});

// ---------------------------------------------------------------------------
// DpPropertyBag — reflective bag over MuralBase dependency properties
// ---------------------------------------------------------------------------
describe('DpPropertyBag — GetValue/SetValue round-trip', () => {
    beforeEach(() => { initTestApp(); });

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
    beforeEach(() => { initTestApp(); });

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
    beforeEach(() => { initTestApp(); });

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
    beforeEach(() => { initTestApp(); });

    test('Observe fires when the DP is changed externally via native accessor', () => {
        const probe = new Probe();
        const bag = new DpPropertyBag(probe);
        let callCount = 0;
        bag.Observe('Value', () => { callCount++; });
        probe.Value = 1;
        assert.equal(callCount, 1);
        probe.Value = 2;
        assert.equal(callCount, 2);
    });

    test('Observe fires when SetValue is called through the bag', () => {
        const probe = new Probe();
        const bag = new DpPropertyBag(probe);
        let callCount = 0;
        bag.Observe('Value', () => { callCount++; });
        bag.SetValue('Value', 5);
        assert.equal(callCount, 1);
    });

    test('Disposer returned by Observe stops further callbacks', () => {
        const probe = new Probe();
        const bag = new DpPropertyBag(probe);
        let callCount = 0;
        const dispose = bag.Observe('Value', () => { callCount++; });
        probe.Value = 10;
        assert.equal(callCount, 1);
        dispose();
        probe.Value = 20;
        // Listener removed — count must not increase
        assert.equal(callCount, 1);
    });
});
