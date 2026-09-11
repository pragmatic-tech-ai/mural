import { MuralBase, PropertyKey } from '../../runtime/index.js';
import { Signal, type PropertyChangeCallback, type Disposable } from '@pragmatic-tech-ai/todl-runtime';

/**
 * A named collection of properties. Iterating a bag yields `[name, accessor]`
 * entries for every property it holds; `Observe` hands back a property's change
 * `Signal` (the caller subscribes and disposes the returned `Disposable`).
 * `Disposable`: `dispose()` releases any listeners the bag wired on external sources.
 */
export interface IPropertyBag extends Iterable<[string, IReadOnlyPropertyAccessor]>, Disposable {
    GetValue(name: string): unknown;
    SetValue(name: string, value: unknown): void;
    IsReadOnly(name: string): boolean;
    Observe(name: string): Signal<PropertyChangeCallback>;
}

/** The read side of a property accessor: its identity and current value. */
export interface IReadOnlyPropertyAccessor {
    /** The property's stable name (the key it is registered under). */
    id(): string;
    /** A human-readable label for the property, shown to the user. */
    displayName(): string;
    get(): unknown;
}

/**
 * A writable, self-observable accessor. `set` writes the value; `changed`, when
 * present, is the accessor's own change channel — the bag subscribes to it
 * instead of owning notification, and skips its own emit on `SetValue` so a
 * value change fires exactly once.
 */
export interface IPropertyAccessor extends IReadOnlyPropertyAccessor {
    set(value: unknown): void;
    changed?: Signal<PropertyChangeCallback>;
}

/** An accessor is either read-only (`get`) or writable (`get` + `set` [+ `changed`]). */
export type PropertyAccessor = IReadOnlyPropertyAccessor | IPropertyAccessor;

export class MapPropertyBag implements IPropertyBag {
    private readonly _accessors: ReadonlyMap<string, PropertyAccessor>;
    // Bag-owned change channels, one per name, for accessors that do NOT carry
    // their own `changed` Signal. Created lazily on first Observe.
    private readonly _signals: Map<string, Signal<PropertyChangeCallback>> = new Map();

    constructor(accessors: ReadonlyMap<string, PropertyAccessor>) {
        this._accessors = accessors;
    }

    public *[Symbol.iterator](): Iterator<[string, IReadOnlyPropertyAccessor]> {
        yield* this._accessors;
    }

    public GetValue(name: string): unknown {
        return this.entry(name).get();
    }

    public SetValue(name: string, value: unknown): void {
        const accessor = this.entry(name);
        if (!MapPropertyBag.isWritable(accessor)) {
            return;
        }
        accessor.set(value);
        // Fire the bag-owned channel only when the accessor does NOT own a change
        // channel — otherwise notification arrives through accessor.changed.
        if (accessor.changed === undefined) {
            this._signals.get(name)?.emit(() => {});
        }
    }

    public IsReadOnly(name: string): boolean {
        return !MapPropertyBag.isWritable(this.entry(name));
    }

    // Drop the bag-owned change channels. Accessor-owned `changed` Signals are
    // not ours to dispose, so they are left untouched.
    public dispose(): void {
        this._signals.clear();
    }

    public Observe(name: string): Signal<PropertyChangeCallback> {
        const accessor = this.entry(name);
        if (MapPropertyBag.isWritable(accessor) && accessor.changed !== undefined) {
            return accessor.changed;
        }
        return this.signalFor(name);
    }

    private signalFor(name: string): Signal<PropertyChangeCallback> {
        let signal = this._signals.get(name);
        if (signal === undefined) {
            signal = new Signal<PropertyChangeCallback>();
            this._signals.set(name, signal);
        }
        return signal;
    }

    private entry(name: string): PropertyAccessor {
        const accessor = this._accessors.get(name);
        if (accessor === undefined) {
            throw new Error(`MapPropertyBag: unknown property '${name}'`);
        }
        return accessor;
    }

    // Narrow to the writable shape: a settable accessor exposes a `set` method.
    private static isWritable(accessor: PropertyAccessor): accessor is IPropertyAccessor {
        return typeof (accessor as IPropertyAccessor).set === 'function';
    }
}

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
export class DpPropertyBag implements IPropertyBag {
    private readonly _target: MuralBase;
    private readonly _keys: Map<string, PropertyKey<unknown>>;
    // Lazily-created per-name change channels and the DP listener bridging each
    // one, so Dispose() can release the target-side subscriptions.
    private readonly _signals: Map<string, Signal<PropertyChangeCallback>> = new Map();
    private readonly _bridges: Map<string, PropertyChangeCallback> = new Map();

    constructor(target: MuralBase) {
        this._target = target;
        this._keys = new Map();
        for (const descriptor of MuralBase.EnumerateProperties(target.constructor as Function)) {
            this._keys.set(descriptor.Name, new PropertyKey(descriptor));
        }
    }

    public *[Symbol.iterator](): Iterator<[string, IReadOnlyPropertyAccessor]> {
        for (const name of this._keys.keys()) {
            yield [name, this.accessorFor(name)];
        }
    }

    public GetValue(name: string): unknown {
        return this._target.get_property_value(this.key(name));
    }

    public SetValue(name: string, value: unknown): void {
        this._target.set_property_value(this.key(name), value);
    }

    public IsReadOnly(name: string): boolean {
        return this.key(name).descriptor.IsReadOnly;
    }

    public Observe(name: string): Signal<PropertyChangeCallback> {
        const key = this.key(name);
        let signal = this._signals.get(name);
        if (signal === undefined) {
            signal = new Signal<PropertyChangeCallback>();
            this._signals.set(name, signal);
            // Bridge the DP change notification into the Signal. One listener per
            // observed name; released in Dispose().
            const bridge: PropertyChangeCallback = () => { signal!.emit(() => {}); };
            this._bridges.set(name, bridge);
            this._target.AddPropertyChangedListener(key, bridge);
        }
        return signal;
    }

    /** Detach every DP bridge listener wired by `Observe`. */
    public dispose(): void {
        for (const [name, bridge] of this._bridges) {
            this._target.RemovePropertyChangedListener(this.key(name), bridge);
        }
        this._bridges.clear();
        this._signals.clear();
    }

    // A read-only accessor view over one DP. A DP has no human label, so
    // displayName falls back to the property name.
    private accessorFor(name: string): IReadOnlyPropertyAccessor {
        return {
            id: () => name,
            displayName: () => name,
            get: () => this.GetValue(name),
        };
    }

    private key(name: string): PropertyKey<unknown> {
        const k = this._keys.get(name);
        if (k === undefined) {
            throw new Error(`DpPropertyBag: unknown property '${name}'`);
        }
        return k;
    }
}
