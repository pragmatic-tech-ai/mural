import { MuralBase, PropertyKey } from '../../runtime/index.js';
import { Signal, type PropertyChangeCallback } from '@pragmatic-tech-ai/todl-runtime';

export interface IPropertyBag {
    GetValue(name: string): unknown;
    SetValue(name: string, value: unknown): void;
    IsReadOnly(name: string): boolean;
    Observe(name: string, onChanged: () => void): () => void;
}

/** The read side of a property accessor: pull the current value. */
export interface IReadOnlyPropertyAccessor {
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
    private readonly _listeners: Map<string, Set<() => void>> = new Map();

    constructor(accessors: ReadonlyMap<string, PropertyAccessor>) {
        this._accessors = accessors;
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
        // Only fire bag-owned listeners when the accessor does NOT own a change
        // channel — otherwise notification arrives through accessor.changed.
        if (accessor.changed === undefined) {
            this.notify(name);
        }
    }

    public IsReadOnly(name: string): boolean {
        return !MapPropertyBag.isWritable(this.entry(name));
    }

    public Observe(name: string, onChanged: () => void): () => void {
        const accessor = this.entry(name);
        if (MapPropertyBag.isWritable(accessor) && accessor.changed !== undefined) {
            const subscription = accessor.changed.subscribe(() => { onChanged(); });
            return () => { subscription.dispose(); };
        }
        return this.registerListener(name, onChanged);
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

    private notify(name: string): void {
        const set = this._listeners.get(name);
        if (set === undefined) {
            return;
        }
        // Snapshot to guard against mutation during iteration
        for (const cb of [...set]) {
            cb();
        }
    }

    private registerListener(name: string, onChanged: () => void): () => void {
        let set = this._listeners.get(name);
        if (set === undefined) {
            set = new Set();
            this._listeners.set(name, set);
        }
        set.add(onChanged);
        return () => {
            this._listeners.get(name)?.delete(onChanged);
        };
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
 * - `Observe` subscribes via `AddPropertyChangedListener` and returns a thunk
 *   that calls `RemovePropertyChangedListener`.
 * - Any operation on an unregistered name throws a descriptive `Error`.
 */
export class DpPropertyBag implements IPropertyBag {
    private readonly _target: MuralBase;
    private readonly _keys: Map<string, PropertyKey<unknown>>;

    constructor(target: MuralBase) {
        this._target = target;
        this._keys = new Map();
        for (const descriptor of MuralBase.EnumerateProperties(target.constructor as Function)) {
            this._keys.set(descriptor.Name, new PropertyKey(descriptor));
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

    public Observe(name: string, onChanged: () => void): () => void {
        const key = this.key(name);
        const callback = () => { onChanged(); };
        this._target.AddPropertyChangedListener(key, callback);
        return () => { this._target.RemovePropertyChangedListener(key, callback); };
    }

    private key(name: string): PropertyKey<unknown> {
        const k = this._keys.get(name);
        if (k === undefined) {
            throw new Error(`DpPropertyBag: unknown property '${name}'`);
        }
        return k;
    }
}
