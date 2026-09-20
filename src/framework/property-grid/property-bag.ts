import { MuralBase, PropertyKey } from '../../runtime/index.js';
import {
    Signal,
    type PropertyChangedEventArgs,
    type Disposable,
    type IPropertyBag,
    type IReadOnlyPropertyAccessor,
} from '@pragmatic-tech-ai/todl-runtime';

// The DP-free property-bag core — IPropertyBag, the accessor interfaces, and
// MapPropertyBag — now lives in todl-runtime (it depends only on Signal /
// PropertyChangedEventArgs). This module keeps DpPropertyBag, the reflective bag
// over mural dependency properties, which needs the DP system (MuralBase /
// PropertyKey) mural owns.

/**
 * Reflective `IPropertyBag` that reads and writes dependency properties on a
 * `MuralBase` instance by name. The constructor enumerates all DPs registered
 * on the target's class (including inherited ones) and builds an internal
 * name → `PropertyKey` map; subsequent calls look up that map rather than
 * walking the prototype chain on every access.
 *
 * - `GetValue`/`SetValue` delegate to `get_property_value`/`set_property_value`
 *   so DP coercion, validation, and the notification system all apply.
 * - `IsReadOnly` reflects `PropertyDescriptor.IsReadOnly`.
 * - `Observe` returns a per-name `Signal`, bridged from the target's DP change
 *   notification via a single `AddPropertyChangedListener`. The bridge listener
 *   lives until `dispose()` — subscribers detach via the `Disposable` from
 *   `subscribe()`, but the DP listener is released only on `dispose()`.
 * - Iterating yields `[name, accessor]` for every DP; the synthesized accessor's
 *   `displayName` falls back to the name (a DP carries no human label).
 * - Any operation on an unregistered name throws a descriptive `Error`.
 */
export class DpPropertyBag implements IPropertyBag
{
    private readonly _target: MuralBase;
    private readonly _keys: Map<string, PropertyKey<unknown>>;
    // Lazily-created per-name change channels and the DP listener bridging each
    // one, so dispose() can release the target-side subscriptions.
    private readonly _signals: Map<string, Signal<PropertyChangedEventArgs>> = new Map();
    private readonly _bridges: Map<string, Disposable> = new Map();

    constructor(target: MuralBase)
    {
        this._target = target;
        this._keys = new Map();
        for (const descriptor of MuralBase.EnumerateProperties(target.constructor as Function))
        {
            this._keys.set(descriptor.Name, new PropertyKey(descriptor));
        }
    }

    public *[Symbol.iterator](): Iterator<[string, IReadOnlyPropertyAccessor]>
    {
        for (const name of this._keys.keys())
        {
            yield [name, this.accessorFor(name)];
        }
    }

    public GetValue(name: string): unknown
    {
        return this._target.get_property_value(this.key(name));
    }

    public SetValue(name: string, value: unknown): void
    {
        this._target.set_property_value(this.key(name), value);
    }

    public IsReadOnly(name: string): boolean
    {
        return this.key(name).descriptor.IsReadOnly;
    }

    public Observe(name: string): Signal<PropertyChangedEventArgs>
    {
        const key = this.key(name);
        let signal = this._signals.get(name);
        if (signal === undefined)
        {
            signal = new Signal<PropertyChangedEventArgs>();
            this._signals.set(name, signal);
            // Bridge the DP change channel into the bag's Signal, forwarding the
            // args verbatim. One subscription per observed name; disposed in
            // dispose().
            const bridge = signal;
            this._bridges.set(
                name,
                this._target.PropertyChanged(key).subscribe((args) => {
                    bridge.emit(args);
                }),
            );
        }
        return signal;
    }

    /** Detach every DP bridge subscription wired by `Observe`. */
    public dispose(): void
    {
        for (const sub of this._bridges.values())
        {
            sub.dispose();
        }
        this._bridges.clear();
        this._signals.clear();
    }

    // A read-only accessor view over one DP. A DP has no human label, so
    // displayName falls back to the property name.
    private accessorFor(name: string): IReadOnlyPropertyAccessor
    {
        return {
            id: () => name,
            displayName: () => name,
            get: () => this.GetValue(name),
        };
    }

    private key(name: string): PropertyKey<unknown>
    {
        const k = this._keys.get(name);
        if (k === undefined)
        {
            throw new Error(`DpPropertyBag: unknown property '${name}'`);
        }
        return k;
    }
}
