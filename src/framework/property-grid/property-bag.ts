export interface IPropertyBag {
    GetValue(name: string): unknown;
    SetValue(name: string, value: unknown): void;
    IsReadOnly(name: string): boolean;
    Observe(name: string, onChanged: () => void): () => void;
}

export interface PropertyAccessor {
    get(): unknown;
    set?(value: unknown): void;
    observe?(onChanged: () => void): () => void;
}

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
        accessor.set?.(value);
        // Only fire bag-owned listeners when the accessor does NOT own notifications
        if (accessor.observe === undefined) {
            this.notify(name);
        }
    }

    public IsReadOnly(name: string): boolean {
        return this.entry(name).set === undefined;
    }

    public Observe(name: string, onChanged: () => void): () => void {
        const accessor = this.entry(name);
        if (accessor.observe !== undefined) {
            return accessor.observe(onChanged);
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
