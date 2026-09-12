import { Signal } from '@pragmatic-tech-ai/todl-runtime';
import type { PropertyChangedEventArgs } from '@pragmatic-tech-ai/todl-runtime';
import { ServiceKey } from './service-provider.js';

// DI seam through which the EVD setting-value tier (Task 3) reads a
// setting's current value and subscribes to its change signal.
// Implementations are registered against `SettingSourceKey` in the
// application's root ServiceProvider.
export interface ISettingSource
{
    Get(key: string): unknown;
    Changed(key: string): Signal<PropertyChangedEventArgs>;
}

// Typed DI token for the setting-source seam.
export const SettingSourceKey = new ServiceKey<ISettingSource>('SettingSource');

// A setting-backed value holder (an EffectiveValueDescriptor) that armed its
// SettingValue tier before any ISettingSource was resolvable, and needs to
// re-arm once one becomes available. Kept minimal so the runtime coordinator
// below has no dependency on the EVD's concrete shape.
export interface ISettingReArmable
{
    onSettingSourceAvailable(): void;
}

// Coordinator that lets setting-backed value holders re-arm when an
// ISettingSource becomes available AFTER they were created source-less.
//
// The lifetime invariant makes this leak-free: a setting source (and its
// notifications) outlives every value holder, so the only unsafe reference
// direction is source → holder. We therefore hold waiters WEAKLY — a holder
// whose owner (e.g. a Visual) has been torn down derefs to `undefined` and is
// dropped; a FinalizationRegistry prunes its slot proactively on GC. Correctness
// no longer depends on any explicit teardown reaching the coordinator.
//
// In practice `waiting` only ever holds holders born in the startup window
// before a source is registered, and it drains on the first notifyAvailable();
// the weak refs simply guarantee robustness if a source is late, absent, or
// re-registered.
export class SettingSourceAvailability
{
    private static readonly waiting = new Set<WeakRef<ISettingReArmable>>();
    private static readonly finalizer = new FinalizationRegistry<WeakRef<ISettingReArmable>>(
        (ref) => { SettingSourceAvailability.waiting.delete(ref); });

    // Register a holder to be re-armed on the next notifyAvailable(). Idempotent
    // enough for the demand path: re-registering adds a fresh weak ref, and the
    // one-shot drain clears stale ones — the holder just no-ops if already armed.
    public static waitFor(target: ISettingReArmable): void
    {
        const ref = new WeakRef(target);
        SettingSourceAvailability.waiting.add(ref);
        SettingSourceAvailability.finalizer.register(target, ref);
    }

    // Signal that a source may now be resolvable — fired by an ISettingSource
    // when it comes online (constructed / contributed). Drains the waiting set
    // (one-shot): each live waiter re-arms; a waiter that still can't resolve
    // re-registers itself via waitFor. Dead waiters deref to undefined and are
    // dropped.
    public static notifyAvailable(): void
    {
        if (SettingSourceAvailability.waiting.size === 0) return;
        const pending = [...SettingSourceAvailability.waiting];
        SettingSourceAvailability.waiting.clear();
        for (const ref of pending)
        {
            // A dropped waiter derefs to undefined; the finalizer will prune its
            // slot (harmless no-op now that `waiting` is cleared).
            ref.deref()?.onSettingSourceAvailable();
        }
    }
}
