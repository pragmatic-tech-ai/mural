import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { SettingSourceAvailability, type ISettingReArmable } from '../setting-source.js';

// Unit tests for the weak re-arm coordinator. The GC-driven prune (a dropped
// waiter's WeakRef derefs to undefined and the FinalizationRegistry removes its
// slot) is not deterministically forceable in a unit test — it is guaranteed by
// the runtime — so these cover the observable logic: live waiters are re-armed,
// the drain is one-shot, and a waiter may re-register itself.

class Waiter implements ISettingReArmable
{
    public calls = 0;
    public onSettingSourceAvailable(): void { this.calls++; }
}

describe('SettingSourceAvailability', () =>
{
    test('notifyAvailable re-arms a live waiter', () =>
    {
        const w = new Waiter();
        SettingSourceAvailability.waitFor(w);
        SettingSourceAvailability.notifyAvailable();
        assert.equal(w.calls, 1);
    });

    test('drain is one-shot — a second notify does not re-call an already-drained waiter', () =>
    {
        const w = new Waiter();
        SettingSourceAvailability.waitFor(w);
        SettingSourceAvailability.notifyAvailable();
        SettingSourceAvailability.notifyAvailable();
        assert.equal(w.calls, 1);
    });

    test('empty waiting set — notifyAvailable is a no-op', () =>
    {
        assert.doesNotThrow(() => SettingSourceAvailability.notifyAvailable());
    });

    test('a still-unresolved waiter can re-register and is re-armed on the next notify', () =>
    {
        let calls = 0;
        const w: ISettingReArmable = {
            onSettingSourceAvailable(): void
            {
                calls++;
                if (calls < 2) SettingSourceAvailability.waitFor(w);   // still no source → keep waiting
            },
        };
        SettingSourceAvailability.waitFor(w);
        SettingSourceAvailability.notifyAvailable();   // calls → 1, re-registers
        SettingSourceAvailability.notifyAvailable();   // calls → 2, done
        SettingSourceAvailability.notifyAvailable();   // drained → no further calls
        assert.equal(calls, 2);
    });
});
