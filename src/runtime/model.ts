import { Binding } from './binding/binding.js';
import { EffectiveValueDescriptor, PropertyValueSource } from './binding/effective-value.js';
import type { InternalPropertyChangeCallback, PropertyChangedEventArgs } from './binding/effective-value.js';
import { Observable } from './observable.js';
import { Signal } from '@pragmatic-tech-ai/todl-runtime';
import { PropertyDescriptor } from './property-descriptor.js';
import type { CoerceValue, PropertyMetadata, ValidateTarget, ValidateValue } from './property-descriptor.js';
import { inherits, type MetaData } from './metadata.js';

// Branded handle returned by MuralBase.RegisterProperty (and the read-only /
// attached variants). Serves two purposes:
//
//   * Typed identity — `PropertyKey<T>` carries a phantom `T` so the
//     typed overloads of `get_property_value` / `set_property_value`
//     can read and write the property with no `as` cast at the call
//     site. The descriptor field is the runtime identity; `T` is purely
//     a compile-time contract authored by whoever declared the DP.
//
//   * Write capability — for read-only properties, possession of the
//     key is what grants write access via `set_property_value_with_key`
//     / `ClearValueWithKey`. Read/write properties also get a key from
//     RegisterProperty; the capability bit is moot for them (anyone can
//     write a read/write DP), so the key is just typed identity.
//
// `_phantom` is never assigned — it exists only to make the generic
// parameter load-bearing at the type level so `PropertyKey<number>` and
// `PropertyKey<string>` are not assignable to each other.
export class PropertyKey<T = unknown>
{
    declare private readonly _phantom: T;
    constructor(public readonly descriptor: PropertyDescriptor) {}
}

// Root of the property/binding system. `MuralBase extends Observable`
// (a minimal name/setter INotifyPropertyChanged); MuralBase owns the
// per-class descriptor registry, `PropertyKey`, per-instance value state
// (`property_values`), and a virtual OnPropertyChanged hook that fires for
// every effective-value change. The base hook is a no-op; Visual (in
// visual.ts) overrides it to route layout/render invalidation and property
// value inheritance through the visual tree.
//
// MuralBase's notification surface (`PropertyChanged`) OVERRIDES Observable's
// virtual, widened to `string | PropertyKey`, and returns the change channel
// from the EffectiveValueDescriptor — MuralBase does NOT use Observable's
// name-keyed `_signals` store or its `RaisePropertyChanged` for registered
// DPs; their notifications flow through the EVD system. A string naming a
// plain (non-DP) property still falls through to the base Observable Signal.
//
// Property storage uses composite keys `${descriptor.RootOwner.name}.${name}`
// uniformly. This lets any property registered on any class be set on
// any MuralBase instance (WPF-style cross-class / "attached" usage). The
// accessors expose two surfaces:
//   * implicit owner — `set_property_value('width', 100)` walks the
//     target's class hierarchy to find the property, then composes the
//     key from descriptor.RootOwner.
//   * explicit owner — `set_property_value(TextBlock, 'fontSize', 14)`
//     bypasses the hierarchy walk; uses the supplied owner directly.
export class MuralBase extends Observable
{
    // Per-class descriptor bags keyed by class constructor. WeakMap means
    // a class becoming unreachable lets its bag be GC'd; lookup walks the
    // prototype chain to support inherited and overridden metadata.
    private static property_bags: WeakMap<Function, Map<string, PropertyDescriptor>> = new WeakMap();

    // Name → class registry used by the PropertyPath parser to resolve
    // owner-class names in attached-property syntax like '(Grid.Row)'.
    // Populated whenever a class is used in RegisterProperty /
    // OverrideMetadata. WeakRef so classes that go out of use can still
    // be GC'd; stale entries are pruned lazily on first lookup.
    private static class_registry: Map<string, WeakRef<Function>> = new Map();

    // Global registry of every PropertyDescriptor whose registered
    // metadata includes `MetaData.Inherits` (§ 15.2). Populated at
    // RegisterProperty time; consumed by `Visual.collect_inheritable_descriptors`
    // to discover cross-class inheritable attached properties whose
    // owning class isn't in the target Visual's prototype chain. Without
    // this registry, an inheritable attached property registered on, say,
    // `Border` would never be visible to descendants whose class chain
    // doesn't pass through Border, since the per-class bag walk would
    // skip Border's bag entirely.
    //
    // Set vs. Map: descriptors are unique per (owner, property) pair —
    // identity-based lookup is fine. WeakSet would let us drop entries
    // for descriptors whose owning class is GC'd, but PropertyDescriptor
    // holds a strong reference to its owner already, so a regular Set
    // keeps the lookup cheap without leaking. The set is module-static
    // — there is no per-Application registry of inheritable properties.
    private static inheritable_descriptors: Set<PropertyDescriptor> = new Set();

    // Monotonic counter bumped every time a NEW inheritable descriptor
    // joins the registry (RegisterProperty / RegisterReadOnlyProperty with
    // MetaData.Inherits). Consumers that memoize a derived view of the
    // inheritable-property universe — `Visual._collect_inheritable_descriptors`
    // caches its per-class result — key their cache on this generation so a
    // late inheritable registration invalidates every stale entry. In
    // practice all registration happens at module-load time, before any
    // tree exists, so the generation settles once and caches never miss;
    // the counter exists only to keep the memo correct if that ever changes.
    private static inheritable_generation: number = 0;

    // Single funnel for both add-sites (RegisterProperty +
    // RegisterReadOnlyProperty) so the generation bump can't be forgotten.
    // Only a genuinely new descriptor bumps the generation — re-adding an
    // existing one (Set no-op) leaves memo caches valid.
    private static register_inheritable(descriptor: PropertyDescriptor): void
    {
        const before = MuralBase.inheritable_descriptors.size;
        MuralBase.inheritable_descriptors.add(descriptor);
        if (MuralBase.inheritable_descriptors.size !== before) MuralBase.inheritable_generation++;
    }

    /** @internal — Visual.collect_inheritable_descriptors reads this
     *  to union the global cross-class inheritable property set with
     *  the target's class-chain walk. Consumers outside `Visual` should
     *  not depend on the registry shape. */
    public static _getInheritableDescriptors(): ReadonlySet<PropertyDescriptor>
    {
        return MuralBase.inheritable_descriptors;
    }

    /** @internal — memoization key for `_collect_inheritable_descriptors`.
     *  Changes iff the set of inheritable descriptors changed, so a cached
     *  per-class descriptor list is valid exactly while this is unchanged. */
    public static _inheritableGeneration(): number
    {
        return MuralBase.inheritable_generation;
    }

    // Per-instance value store keyed by composite `${RootOwner.name}.${name}`.
    // Protected so Visual's inheritance helpers can walk parent state.
    protected property_values: Map<string, EffectiveValueDescriptor> = new Map();

    constructor()
    {
        super();
    }

    // ------------------------------------------------------------------
    // Static registry and lookup
    // ------------------------------------------------------------------

    protected static get_property_bag(klass: Function): Map<string, PropertyDescriptor>
    {
        let bag = MuralBase.property_bags.get(klass);
        if (bag === undefined)
        {
            bag = new Map<string, PropertyDescriptor>();
            MuralBase.property_bags.set(klass, bag);
        }
        return bag;
    }

    // Non-creating peek used by Visual.collect_inheritable_descriptors —
    // iterating the prototype chain shouldn't allocate empty bags for
    // ancestors that never registered anything.
    protected static peek_property_bag(klass: Function): Map<string, PropertyDescriptor> | undefined
    {
        return MuralBase.property_bags.get(klass);
    }

    // Composes the per-instance storage key for a given (owner, name).
    public static compose_key(owner: Function, property: string): string
    {
        return `${owner.name}.${property}`;
    }

    // Walks the given class's prototype chain looking for the first
    // ancestor that registered `property`. Returns undefined if no
    // ancestor has it.
    //
    // Used in two modes: implicit owner (klass = this.constructor — walks
    // the target's hierarchy), and explicit owner (klass = the caller-
    // supplied owner — walks the owner's hierarchy so a subclass
    // override of metadata wins). Same body for both; the call site
    // chooses which class to walk.
    protected static find_descriptor(klass: Function, property: string): PropertyDescriptor | undefined
    {
        let current: Function | null = klass;
        while (current !== null && current !== Function.prototype)
        {
            const desc = MuralBase.property_bags.get(current)?.get(property);
            if (desc !== undefined) return desc;
            current = Object.getPrototypeOf(current);
        }
        return undefined;
    }

    // Public peek used by bindings to check whether a property is
    // registered on a class without throwing. Same body as
    // find_descriptor; exposed so the binding layer (DataContextBinding,
    // future MultiBinding) can implement WPF-style "silent no-op on
    // missing path" without reaching into protected internals.
    public static HasProperty(klass: Function, property: string): boolean
    {
        return MuralBase.find_descriptor(klass, property) !== undefined;
    }

    // Resolves a class-name string (e.g. 'Grid') to the registered class
    // object. Used by the PropertyPath parser for attached-property
    // syntax. Returns undefined if no such class has been registered, or
    // if the class has been garbage-collected.
    public static find_class(name: string): Function | undefined
    {
        const ref = MuralBase.class_registry.get(name);
        if (ref === undefined) return undefined;
        const cls = ref.deref();
        if (cls === undefined)
        {
            MuralBase.class_registry.delete(name);
            return undefined;
        }
        return cls;
    }

    // Public DP enumeration — walks `klass`'s prototype chain and
    // gathers every PropertyDescriptor registered on it or any ancestor.
    // Used by tooling (LSP completion / hover) that needs the full DP
    // surface of a class identified by name from source. When a
    // descendant overrides a property (rare — typically only changing
    // metadata), the descendant's descriptor wins.
    //
    // Output order: descendant-first within each class's bag (insertion
    // order), then walks up the prototype chain so child classes'
    // properties come before parents'. Duplicates by name are
    // de-duplicated keeping the most-derived descriptor.
    public static EnumerateProperties(klass: Function): PropertyDescriptor[]
    {
        const seen = new Set<string>();
        const out: PropertyDescriptor[] = [];
        let current: Function | null = klass;
        while (current !== null && current !== Function.prototype)
        {
            const bag = MuralBase.property_bags.get(current);
            if (bag !== undefined)
            {
                for (const [name, desc] of bag)
                {
                    if (seen.has(name)) continue;
                    seen.add(name);
                    out.push(desc);
                }
            }
            current = Object.getPrototypeOf(current);
        }
        return out;
    }

    private static remember_class(klass: Function): void
    {
        MuralBase.class_registry.set(klass.name, new WeakRef(klass));
    }

    // Registers a read/write dependency property and returns a typed
    // `PropertyKey<T>`. Callers that just want the registration side
    // effect can ignore the return value. Callers that want typed access
    // (no `as T` casts at the accessor sites) store the key on the class
    // and pass it to the typed `get_property_value` / `set_property_value`
    // overloads. The string `property` is still the binding-path name
    // (`Binding(t, 'Width')` resolves by string), so existing string-
    // keyed access continues to work.
    //
    // Idempotent: re-registering the same (owner, property) leaves the
    // existing descriptor in place and returns a key pointing at it, so
    // a module re-imported under HMR doesn't clobber state.
    public static RegisterProperty<T = unknown>(
        owner: Function,
        property: string,
        default_value: T,
        meta_data: MetaData,
        coerce_value?: CoerceValue,
        validate_value?: ValidateValue,
        validate_target?: ValidateTarget,
    ): PropertyKey<T>
    {
        if (property.includes('.'))
        {
            throw new Error(`Property name '${property}' may not contain '.' (reserved for composite keys).`);
        }
        if (validate_value !== undefined && !validate_value(default_value))
        {
            throw new Error(
                `Default value for property '${owner.name}.${property}' fails its validate_value callback.`,
            );
        }
        MuralBase.remember_class(owner);
        const bag = MuralBase.get_property_bag(owner);
        let descriptor = bag.get(property);
        if (descriptor === undefined)
        {
            const opts: PropertyMetadata = { default_value, meta_data };
            if (coerce_value !== undefined)
            {
                opts.coerce_value = coerce_value;
            }
            if (validate_value !== undefined)
            {
                opts.validate_value = validate_value;
            }
            if (validate_target !== undefined)
            {
                opts.validate_target = validate_target;
            }
            descriptor = new PropertyDescriptor(owner, property, opts);
            bag.set(property, descriptor);
            // Inheritable descriptors join the global registry so
            // Visual.collect_inheritable_descriptors can discover them
            // even when the property's owning class isn't in the
            // descendant's prototype chain. See § 15.2.
            if (inherits(meta_data))
            {
                MuralBase.register_inheritable(descriptor);
            }
        }
        return new PropertyKey<T>(descriptor);
    }

    // Sugar synonym for RegisterProperty at attached-property declaration
    // sites. Same runtime — any registered property can be set on any
    // MuralBase via the explicit-owner overload of set_property_value — but
    // exposes one extra parameter (`validate_target`) that's primarily
    // useful for attached properties.
    //
    // `validate_target` (§ 15.1): when set, every write to this property
    // on ANY target MuralBase passes through the predicate first. Returning
    // `false` throws with a "property only valid on …" message. Used to
    // constrain attached properties to specific target families — e.g.
    // `Grid.Row` only makes sense on Visuals laid out by a Grid parent,
    // so its registration can declare `validateTargetTypes(Visual)`.
    // Helper exported from runtime/property-descriptor.js.
    public static RegisterAttachedProperty<T = unknown>(
        owner: Function,
        property: string,
        default_value: T,
        meta_data: MetaData,
        coerce_value?: CoerceValue,
        validate_value?: ValidateValue,
        validate_target?: ValidateTarget,
    ): PropertyKey<T>
    {
        return MuralBase.RegisterProperty<T>(
            owner, property, default_value, meta_data,
            coerce_value, validate_value, validate_target,
        );
    }

    // Registers a read-only property and returns a PropertyKey that
    // grants write privileges. External code can read the property
    // (and bind to it) but only the holder of the key can write or
    // clear it. Throws if the property is already registered on owner.
    public static RegisterReadOnlyProperty<T = unknown>(
        owner: Function,
        property: string,
        default_value: T,
        meta_data: MetaData,
        coerce_value?: CoerceValue,
        validate_value?: ValidateValue,
    ): PropertyKey<T>
    {
        if (property.includes('.'))
        {
            throw new Error(`Property name '${property}' may not contain '.' (reserved for composite keys).`);
        }
        if (validate_value !== undefined && !validate_value(default_value))
        {
            throw new Error(
                `Default value for property '${owner.name}.${property}' fails its validate_value callback.`,
            );
        }
        MuralBase.remember_class(owner);
        const bag = MuralBase.get_property_bag(owner);
        if (bag.has(property))
        {
            throw new Error(`Property '${property}' is already registered on '${owner.name}'.`);
        }
        const opts: PropertyMetadata = { default_value, meta_data };
        if (coerce_value !== undefined)
        {
            opts.coerce_value = coerce_value;
        }
        if (validate_value !== undefined)
        {
            opts.validate_value = validate_value;
        }
        const descriptor = new PropertyDescriptor(owner, property, opts, undefined, /* readOnly */ true);
        bag.set(property, descriptor);
        // Inheritable read-only DPs also join the global registry — see
        // § 15.2. Same shape as RegisterProperty above.
        if (inherits(meta_data))
        {
            MuralBase.register_inheritable(descriptor);
        }
        return new PropertyKey<T>(descriptor);
    }

    // Overrides metadata (default value / coerce / meta flags) on `klass`
    // for the property identified by `key`. The PropertyKey is the typed
    // handle returned by `RegisterProperty` / `RegisterReadOnlyProperty`;
    // it carries the original descriptor so the override chains cleanly
    // and the value type `T` is threaded through `opts.default_value`.
    // No string-named overload — type references are first-class through
    // the key, matching the rest of the typed accessor surface.
    public static OverrideMetadata<T>(
        klass: Function,
        key: PropertyKey<T>,
        opts: PropertyMetadata,
    ): void
    {
        MuralBase.remember_class(klass);
        const property = key.descriptor.Name;
        const bag = MuralBase.get_property_bag(klass);
        const parent_descriptor = bag.get(property)
            ?? MuralBase.find_descriptor(Object.getPrototypeOf(klass) as Function, property);
        if (parent_descriptor === undefined)
        {
            throw new Error(
                `Cannot override metadata for property '${property}' — not registered on any ancestor of '${klass.name}'.`,
            );
        }
        bag.set(property, new PropertyDescriptor(klass, property, opts, parent_descriptor));
    }

    // ------------------------------------------------------------------
    // Public accessors
    //
    // The canonical consumer surface is the typed-key form on every
    // accessor — `model.get_property_value(Border.FillKey)`,
    // `model.set_property_value(Border.FillKey, brush)`, etc.
    // The phantom `T` on `PropertyKey<T>` makes a typo at the call site
    // a compile error and threads the value type through the accessor
    // signature so no `as T` cast is needed.
    //
    // There is no by-name accessor on `MuralBase`. The µ-mural compiler
    // resolves every markup property write to a typed key at compile
    // time (`compileAttribute` in `src/compiler/compiler.ts` queries
    // `MuralBase.find_class` + `findDescriptor` and emits `Owner.PropKey`).
    // Framework-internal hot paths (binding, Style.Setter / Trigger,
    // animation, trigger evaluators) resolve names through
    // [./model-internals.ts](./model-internals.ts)'s `resolveKey`
    // helper at install time and cache the resulting `PropertyKey`.
    // ------------------------------------------------------------------

    // Typed-key public API ---------------------------------------------

    // Resolves the `string | PropertyKey` argument of `PropertyChanged` to its
    // PropertyDescriptor, or undefined when a STRING name isn't a registered
    // dependency property. A non-DP name is not an error: `PropertyChanged`
    // falls back to the base Observable name-keyed Signal store, so plain
    // getter/setter properties on a MuralBase are observable exactly like on a
    // plain Observable.
    private resolve_listener_descriptor(nameOrKey: string | PropertyKey<unknown>): PropertyDescriptor | undefined
    {
        if (typeof nameOrKey !== 'string') return nameOrKey.descriptor;
        return MuralBase.find_descriptor(this.constructor, nameOrKey);
    }

    // Overrides Observable.PropertyChanged, widened to `string | PropertyKey`.
    // A PropertyKey (or a string naming a registered DP) returns that
    // property's EffectiveValueDescriptor change channel — created lazily on
    // first access. A string naming a plain (non-DP) property falls through to
    // the base Observable name-keyed Signal, so a getter/setter that calls
    // RaisePropertyChanged stays reactive, exactly as on a plain Observable VM
    // (a binding to a plain property on a MuralBase source relies on this).
    // Consumers subscribe to the returned Signal and own the Disposable.
    public override PropertyChanged(
        nameOrKey: string | PropertyKey<unknown>,
    ): Signal<PropertyChangedEventArgs>
    {
        const descriptor = this.resolve_listener_descriptor(nameOrKey);
        if (descriptor === undefined)
        {
            return super.PropertyChanged(nameOrKey as string);
        }
        return this.ensure_effective_value_for(descriptor).ChangedSignal();
    }

    public ClearValue<T>(key: PropertyKey<T>): void
    {
        this.require_writable(key.descriptor);
        this.clear_via_descriptor(key.descriptor);
    }

    // Privileged ClearValue for read-only properties — the key carries
    // the descriptor so no lookup is needed and no read-only gate applies.
    public ClearValueWithKey(key: PropertyKey<unknown>): void
    {
        this.clear_via_descriptor(key.descriptor);
    }

    // Drops the entire EffectiveValueDescriptor slot for `key` — value,
    // binding, animated slot, change listeners, internal callback. Future
    // reads fall back to the registered default; a future write creates
    // a fresh EVD slot.
    //
    // Use case: per-target memory reclamation when a property has been
    // set (or had listeners attached) on this instance but won't be
    // again — virtualized list containers shedding their per-item
    // bookkeeping at recycle time, for example. ClearValue alone
    // preserves the EVD slot (Map entry, listeners array, base-source
    // slots) so the property stays observable; RemoveValue throws the
    // whole slot away.
    //
    // Returns true when an EVD slot was actually deleted, false when
    // the property was never observed on this instance (already at
    // default with no slot to free). Calling on a never-touched
    // property is a cheap no-op.
    //
    // Safety: any active binding is disposed BEFORE the slot is dropped
    // so the binding doesn't keep firing into a freed EVD. Change
    // listeners are silently discarded — they were registered against
    // an EVD identity that no longer exists, and a fresh EVD created by
    // a future write has its own listener list. Callers that need to
    // preserve listeners should call ClearValue instead.
    public RemoveValue<T>(key: PropertyKey<T>): boolean
    {
        this.require_writable(key.descriptor);
        return this.remove_via_descriptor(key.descriptor);
    }

    // Privileged RemoveValue for read-only properties — same shape as
    // ClearValueWithKey vs. ClearValue.
    public RemoveValueWithKey(key: PropertyKey<unknown>): boolean
    {
        return this.remove_via_descriptor(key.descriptor);
    }

    public GetValueSource<T>(key: PropertyKey<T>): PropertyValueSource
    {
        const composed = key.descriptor.ComposedKey;
        return this.property_values.get(composed)?.Source ?? PropertyValueSource.Default;
    }

    // Pin a value on the Animated slot. Animation overrides Binding /
    // Local / Trigger / Style / Inherited / Default (highest priority
    // among base-value sources). Storyboard.AdvanceTo calls this every
    // clock tick; consumers normally drive it via Visual.BeginAnimation
    // rather than directly. Calling SetAnimatedValue from outside the
    // animation engine works but the slot is then nobody's job to
    // release — pair every direct call with a matching ClearAnimatedValue.
    public SetAnimatedValue<T>(key: PropertyKey<T>, value: T): void
    {
        const composed = key.descriptor.ComposedKey;
        let evd = this.property_values.get(composed);
        if (evd === undefined)
        {
            evd = this.new_effective_value(key.descriptor);
            this.property_values.set(composed, evd);
        }
        evd.SetAnimatedValue(value);
    }

    public ClearAnimatedValue<T>(key: PropertyKey<T>): void
    {
        const composed = key.descriptor.ComposedKey;
        this.property_values.get(composed)?.ClearAnimatedValue();
    }

    public get_property_value<T>(key: PropertyKey<T>): T
    {
        const composed = key.descriptor.ComposedKey;
        const evd = this.property_values.get(composed);
        if (evd !== undefined) return evd.value;
        // Default-value fallback walks this instance's class chain so
        // MuralBase.OverrideMetadata on a subclass is honored. The key's
        // own descriptor is the root-owner registration â€” fine as the
        // last-resort fallback when no subclass override exists.
        const descriptor = MuralBase.find_descriptor(this.constructor, key.descriptor.Name)
                        ?? key.descriptor;
        return this.resolve_default(descriptor);
    }

    public set_property_value<T>(key: PropertyKey<T>, value: T): void
    {
        // Read-only gate still applies — a read-only DP's key was
        // returned to the registering class only; passing it back here
        // without going through set_property_value_with_key is treated
        // like any other attempt at writing a read-only DP.
        this.require_writable(key.descriptor);
        this.set_via_descriptor(key.descriptor, value);
    }

    // Privileged set for read-only properties — the key carries the
    // descriptor so no public lookup is needed and the read-only gate
    // doesn't apply. Also works for read/write properties (the key is
    // a more direct write path; bypasses the implicit-owner resolution).
    public set_property_value_with_key<T>(key: PropertyKey<T>, value: T): void
    {
        this.set_via_descriptor(key.descriptor, value);
    }

    private clear_via_descriptor(descriptor: PropertyDescriptor): void
    {
        const key = descriptor.ComposedKey;
        const evd = this.property_values.get(key);
        if (evd !== undefined)
        {
            evd.ClearValue();
        }
        // Registered but never set — already at default. No-op.
    }

    private remove_via_descriptor(descriptor: PropertyDescriptor): boolean
    {
        const key = descriptor.ComposedKey;
        const evd = this.property_values.get(key);
        if (evd === undefined) return false;
        // Dispose any active binding FIRST. ClearValue would have done
        // this for us, but it also leaves the slot in place + fires
        // listener notifications for the synthetic default-value
        // restoration — wasted work when we're about to delete the
        // whole EVD. Reach through the same path effective-value uses
        // internally so binding lifecycle stays consistent.
        evd.ClearValue();
        this.property_values.delete(key);
        return true;
    }

    // ------------------------------------------------------------------
    // Shared cores
    // ------------------------------------------------------------------

    private require_writable(descriptor: PropertyDescriptor): void
    {
        if (descriptor.IsReadOnly)
        {
            throw new Error(
                `Property '${descriptor.Name}' is read-only — write via the PropertyKey returned from MuralBase.RegisterReadOnlyProperty.`,
            );
        }
    }

    // Returns the descriptor's default value after passing it through
    // the registered CoerceValue callback (if any). Used by the
    // property-get paths that don't yet have an EVD â€” the unset value
    // is conceptually the default, and coerce gets to clamp/normalize
    // it the same way it would clamp any explicit write.
    private resolve_default(descriptor: PropertyDescriptor): any
    {
        const def = descriptor.DefaultValue;
        const coerce = descriptor.CoerceValue;
        return coerce !== undefined ? coerce(this, def) : def;
    }

    private set_via_descriptor(descriptor: PropertyDescriptor, value: any): void
    {
        // Validate-target gate (§ 15.1). Runs FIRST so a misuse of an
        // attached property surfaces before any other side effect. Only
        // attached properties declare a validate_target predicate;
        // regular DPs leave it undefined and skip this check.
        const validateTarget = descriptor.ValidateTarget;
        if (validateTarget !== undefined && !validateTarget(this))
        {
            throw new Error(
                `Property '${descriptor.RootOwner.name}.${descriptor.Name}' is not valid on `
                + `target of type '${this.constructor.name}' — its registered validate_target `
                + `predicate rejected the assignment.`,
            );
        }

        // Validate-value gate runs second (before storage / coerce /
        // listener-firing) so an invalid write is a clean rejection
        // with no side effects. Bindings are exempt — the value is a
        // Binding instance, not a "value" in the property's domain.
        const validate = descriptor.ValidateValue;
        if (validate !== undefined && !(value instanceof Binding) && !validate(value))
        {
            throw new Error(
                `Value ${JSON.stringify(value)} rejected by validate_value for '${descriptor.RootOwner.name}.${descriptor.Name}'.`,
            );
        }

        const key = descriptor.ComposedKey;
        let effective_value = this.property_values.get(key);

        if (effective_value === undefined)
        {
            effective_value = this.new_effective_value(descriptor);
            this.property_values.set(key, effective_value);
        }

        // Pre-write event fan-out (§ 1.14). Fires before the
        // base-value tier is updated, regardless of whether a
        // higher-priority tier (Animated, Trigger) currently masks
        // the effective value. `OnPropertyChanged` only fires when
        // the EFFECTIVE value changes, which means a Local write
        // that's masked by an active animation never reaches
        // OnPropertyChanged — but the implicit-transition engine
        // on Visual still needs to see it so a re-write mid-animation
        // can re-target. Subscribers register via
        // `AddBaseValueWriteListener` for "fires on every raw write"
        // semantics; Visual's constructor self-subscribes to drive
        // the implicit-transition engine.
        if (this._baseValueWriteListeners !== undefined)
        {
            for (const fn of this._baseValueWriteListeners) fn(descriptor, value);
        }

        // Raw value is stored; coerce runs on every read via EVD.value.
        // WPF semantics: coerce never sees its previous output as input,
        // so a clamp like `min(x, ceiling)` works idempotently even when
        // `ceiling` later widens.
        effective_value.value = value;
    }

    // § 1.14 — Pre-write listener registry. Replaces the prior
    // `OnBeforeBaseValueWrite` protected virtual: subclasses don't
    // have to override an inherited method they didn't ask for, and
    // the coupling reads as a real event ("MuralBase emits a
    // base-value-write-request, transitions engine subscribes")
    // rather than "Visual override carries EVD tier knowledge."
    private _baseValueWriteListeners: Set<(d: PropertyDescriptor, v: any) => void> | undefined;

    /** Subscribe to the pre-write event. Listener fires every time
     *  `set_via_descriptor` lands a base-tier write (Local / Binding
     *  / Style), regardless of whether a higher-priority tier
     *  (Animated, Trigger, Coerced) currently masks the effective
     *  value. Returns an unsubscribe thunk. */
    public AddBaseValueWriteListener(fn: (descriptor: PropertyDescriptor, value: any) => void): () => void
    {
        (this._baseValueWriteListeners ??= new Set()).add(fn);
        return () => { this._baseValueWriteListeners?.delete(fn); };
    }

    // Returns the EVD for the given descriptor, creating it lazily at
    // Default source if no value has been set yet. Used by listener
    // attach paths and by Visual's inheritance refresh.
    protected ensure_effective_value_for(descriptor: PropertyDescriptor): EffectiveValueDescriptor
    {
        const key = descriptor.ComposedKey;
        let evd = this.property_values.get(key);
        if (evd === undefined)
        {
            evd = this.new_effective_value(descriptor);
            this.property_values.set(key, evd);
        }
        return evd;
    }

    private new_effective_value(descriptor: PropertyDescriptor): EffectiveValueDescriptor
    {
        const evd = new EffectiveValueDescriptor(descriptor, this);
        const cb: InternalPropertyChangeCallback = (_owner, desc, old_value, new_value) =>
        {
            this.OnPropertyChanged(desc, old_value, new_value);
        };
        evd.SetInternalCallback(cb);
        return evd;
    }

    // Virtual hook fired after every effective-value change on this model
    // (direct set, binding push, ClearValue, etc.). No-op at the MuralBase
    // layer; Visual overrides this to route invalidation and inheritance.
    protected OnPropertyChanged(_descriptor: PropertyDescriptor, _old_value: any, _new_value: any): void
    {
        // Pure storage layer — nothing to do. Visual override handles
        // Mark*Dirty dispatch and inheritance propagation.
    }
}
