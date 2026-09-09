import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MapPropertyBag, type PropertyAccessor } from '../property-bag.js';

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
