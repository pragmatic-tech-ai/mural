import type { PropertyChangedEventArgs } from './effective-value.js';
import type { Disposable } from '@pragmatic-tech-ai/todl-runtime';
import { bindsTwoWayByDefault } from '../metadata.js';
import { MuralBase } from '../model.js';
import { Observable } from '../observable.js';
import type { PropertyKey } from '../model.js';
import { findDescriptor, resolveKey } from '../model-internals.js';
import { ObservableCollection } from '../observable-collection.js';
import { observe_array, subscribe_array } from '../observable-array.js';
import type { PropertyDescriptor } from '../property-descriptor.js';
import type { ValidationError, ValidationRule } from './validation.js';

// Internal: one parsed segment of a property path. Tracks the MuralBase the
// segment is currently bound to so listeners can be detached on rebind.
// For attached-property syntax — `(Owner.Property)` — `ownerName` holds
// the owner-class name (resolved to a class via MuralBase.find_class at
// traversal time) and `propertyName` holds the property name. For
// regular dotted segments, `ownerName` is undefined.
//
// When a segment is stepped into an ObservableCollection or a plain
// Array (observable-array-wrapped), the collection subscription's
// unsubscribe thunk lives on `collectionUnsub`. `MuralBase` and
// `collectionUnsub` are mutually exclusive at any given time — each
// segment is either attached to a MuralBase property or to a collection
// mutation channel.
class PropertyPathSegment
{
    private propertyName: string;
    private ownerName: string | undefined;
    private object: MuralBase | undefined;
    private collectionUnsub: (() => void) | undefined;
    // The change-channel subscription for this segment, captured at
    // attach_and_step time. Disposing it detaches the onChanged handler from
    // whichever channel the segment subscribed to (MuralBase key OR plain-
    // Observable name) — no need to re-derive source/key at detach.
    private subscription: Disposable | undefined;
    // Cached at attach_and_step time so re-resolution can reuse the same key
    // without re-walking the class hierarchy for the descriptor.
    private resolvedKey: PropertyKey<unknown> | undefined;
    // Set when the segment is attached to a PLAIN Observable (non-MuralBase)
    // source. A MuralBase source uses the `object`/`resolvedKey` (key) path
    // above; a bare Observable has no descriptor, so reactivity is keyed by
    // the property NAME instead. Mutually exclusive with `object` at any time.
    private observableSource: Observable | undefined;
    private observableName: string | undefined;

    constructor(
        propertyName: string,
        ownerName: string | undefined,
        object: MuralBase | undefined,
    )
    {
        this.propertyName = propertyName;
        this.ownerName = ownerName;
        this.object = object;
    }

    set MuralBase(value: MuralBase | undefined)
    {
        this.object = value;
    }

    get MuralBase(): MuralBase | undefined
    {
        return this.object;
    }

    set CollectionUnsub(unsub: (() => void) | undefined)
    {
        this.collectionUnsub = unsub;
    }

    get CollectionUnsub(): (() => void) | undefined
    {
        return this.collectionUnsub;
    }

    set Subscription(sub: Disposable | undefined)
    {
        this.subscription = sub;
    }

    get Subscription(): Disposable | undefined
    {
        return this.subscription;
    }

    set ResolvedKey(key: PropertyKey<unknown> | undefined)
    {
        this.resolvedKey = key;
    }

    get ResolvedKey(): PropertyKey<unknown> | undefined
    {
        return this.resolvedKey;
    }

    set ObservableSource(value: Observable | undefined)
    {
        this.observableSource = value;
    }

    get ObservableSource(): Observable | undefined
    {
        return this.observableSource;
    }

    set ObservableName(value: string | undefined)
    {
        this.observableName = value;
    }

    get ObservableName(): string | undefined
    {
        return this.observableName;
    }

    get PropertyName(): string
    {
        return this.propertyName;
    }

    get OwnerName(): string | undefined
    {
        return this.ownerName;
    }
}

// Internal to the binding subsystem. Parses a WPF-style property path,
// traverses a MuralBase graph at construction (registering per-instance
// listeners on each MuralBase along the way), and propagates terminal-value
// changes to a subscriber when a chain mutation alters what the path
// resolves to.
class PropertyPath
{
    readonly path: string;
    private readonly segments: ReadonlyArray<PropertyPathSegment>;
    private readonly onChangedBound: (args: PropertyChangedEventArgs) => void;
    private resolvedValue: any;
    private onValueChanged: ((old_value: any, new_value: any) => void) | undefined;
    // Fires when the resolved-leaf value is a collection (Observable
    // Collection OR plain array) and its contents mutate. The
    // resolved value's identity is unchanged, so the regular
    // onValueChanged dedup would swallow the notification — this
    // separate channel exists so consumers can see a "collection
    // mutated" pulse. Consumers fetch the current resolved value
    // via the regular `get_value` path if they need it.
    private onCollectionPulseCallback: (() => void) | undefined;
    model: MuralBase | undefined;

    constructor(source: MuralBase, path: string)
    {
        this.path = path;
        this.segments = PropertyPath.parse(path);
        this.onChangedBound = this.OnChanged.bind(this);
        this.model = source;
        this.Traverse();
    }

    // Subscribe to terminal-value changes. The callback fires when a chain
    // mutation causes the path-resolved value to differ from the previous
    // resolved value. Pass undefined to detach.
    setOnValueChanged(cb: ((old_value: any, new_value: any) => void) | undefined): void
    {
        this.onValueChanged = cb;
    }

    // Subscribe to collection-as-leaf mutation pulses. The callback
    // fires whenever the resolved leaf value is a collection (Observable
    // Collection or plain array) and that collection mutates. The
    // resolved value's identity is unchanged across the pulse — call
    // `get_value` if you need the current contents. Pass undefined to
    // detach.
    setOnCollectionPulse(cb: (() => void) | undefined): void
    {
        this.onCollectionPulseCallback = cb;
    }

    // Removes every listener registered by Traverse/OnChanged from chain
    // Models and clears the callback. Idempotent. After disposal the path
    // is detached: get_value/set_value still walk the source argument, but
    // no chain mutation can push notifications back through this path.
    dispose(): void
    {
        for (const segment of this.segments)
        {
            if (segment.MuralBase !== undefined
                || segment.CollectionUnsub !== undefined
                || segment.ObservableSource !== undefined)
            {
                this.detach_segment(segment);
                segment.MuralBase = undefined;
            }
        }
        if (this.leafCollectionUnsub !== undefined)
        {
            this.leafCollectionUnsub();
            this.leafCollectionUnsub = undefined;
        }
        this.onValueChanged = undefined;
        this.onCollectionPulseCallback = undefined;
        this.resolvedValue = undefined;
        this.model = undefined;
    }

    // Splits a path into segments. Supports:
    //   * dotted members        a.b.c           → ['a', 'b', 'c']
    //   * indexed accessors     items[0]        → ['items', '0']
    //   * attached property     (Owner.Prop)    → one segment with ownerName='Owner', name='Prop'
    //   * mixed                 dept.(Grid.Row).color
    //
    // Quoted indexer keys ('foo' / "foo") have their surrounding quotes
    // stripped after the split.
    private static parse(path: string): ReadonlyArray<PropertyPathSegment>
    {
        // Match either a `(Owner.Property)` group OR a run of chars that
        // aren't structural separators. The capture in group 1 only fires
        // for the parenthesised form.
        const pattern = /\(([^)]+)\)|[^.[\]()]+/g;
        const segments: PropertyPathSegment[] = [];
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(path)) !== null)
        {
            const attached = match[1];
            if (attached !== undefined)
            {
                const dot = attached.indexOf('.');
                if (dot === -1)
                {
                    throw new Error(
                        `Invalid attached-property segment '(${attached})' — expected 'Owner.Property'.`,
                    );
                }
                const ownerName = attached.slice(0, dot).trim();
                const propertyName = attached.slice(dot + 1).trim();
                segments.push(new PropertyPathSegment(propertyName, ownerName, undefined));
            }
            else
            {
                const raw = match[0]!.trim().replace(/^["']|["']$/g, '');
                segments.push(new PropertyPathSegment(raw, undefined, undefined));
            }
        }
        return segments;
    }

    // Resolve `segment` against `model` to a typed `PropertyKey`. Handles
    // both implicit-owner segments (regular dotted path) and explicit-owner
    // `(Owner.Property)` attached-property syntax. Returns undefined when
    // the explicit owner class is unknown to `MuralBase.find_class` — silently
    // bails the binding rather than throwing.
    // Returns undefined (rather than throwing) when the name isn't a registered
    // dependency property, so callers can fall back to reading it as a plain JS
    // property on the source (which, for a MuralBase, still carries Observable INPC).
    private static resolve_segment_key(
        model: MuralBase,
        segment: PropertyPathSegment,
    ): PropertyKey<unknown> | undefined
    {
        const ownerName = segment.OwnerName;
        if (ownerName === undefined)
        {
            return findDescriptor(model.constructor, segment.PropertyName) !== undefined
                ? resolveKey(model, undefined, segment.PropertyName)
                : undefined;
        }
        const owner = MuralBase.find_class(ownerName);
        if (owner === undefined) return undefined;
        return findDescriptor(owner, segment.PropertyName) !== undefined
            ? resolveKey(model, owner, segment.PropertyName)
            : undefined;
    }

    // Reads `segment` from `current` via the typed-key API when `current`
    // is a MuralBase. For ObservableCollection parents the segment name is
    // parsed as a numeric index and routed through `.Get(idx)`. For
    // plain arrays + every other shape, falls back to bracket access.
    private static read_segment(current: any, segment: PropertyPathSegment): any
    {
        if (current === undefined || current === null) return undefined;
        if (current instanceof MuralBase)
        {
            const key = PropertyPath.resolve_segment_key(current, segment);
            if (key !== undefined) return current.get_property_value(key);
            // Not a dependency property — fall through to the plain-property read
            // below (a plain field / getter on the MuralBase).
        }
        if (current instanceof ObservableCollection)
        {
            const idx = Number(segment.PropertyName);
            if (Number.isFinite(idx)) return current.Get(idx);
            return undefined;
        }
        return current[segment.PropertyName];
    }

    // Writes value into `segment` on `parent`. Same dispatch rules as
    // read_segment. Plain (non-MuralBase) parents use bracket assignment.
    private static write_segment(parent: any, segment: PropertyPathSegment, value: any): void
    {
        if (parent instanceof MuralBase)
        {
            const key = PropertyPath.resolve_segment_key(parent, segment);
            if (key !== undefined) { parent.set_property_value(key, value); return; }
            // Not a dependency property — fall through to the plain setter below.
        }
        parent[segment.PropertyName] = value;
    }

    // Attaches the path's onChanged listener to `current` for `segment`,
    // using the right MuralBase overload. Sets segment.MuralBase for later
    // detachment. Returns the next value along the chain.
    //
    // Collection branches:
    //   * `current` is ObservableCollection — subscribe to its
    //     CollectionChange channel and return `Get(idx)`.
    //   * `current` is a plain Array — wrap via `observe_array`,
    //     subscribe to the proxy's mutation channel, and return the
    //     value at the index. Mutations through the proxy push;
    //     mutations on the unwrapped original do not (caveat
    //     documented on observable-array.ts).
    // Either way the unsubscribe thunk lives on `segment.CollectionUnsub`
    // so dispose / re-resolve tears it down deterministically.
    private attach_and_step(current: any, segment: PropertyPathSegment): any
    {
        if (current === undefined || current === null)
        {
            segment.MuralBase = undefined;
            segment.ObservableSource = undefined;
            segment.ResolvedKey = undefined;
            return undefined;
        }
        if (current instanceof MuralBase)
        {
            const key = PropertyPath.resolve_segment_key(current, segment);
            if (key !== undefined)
            {
                segment.MuralBase = current;
                segment.ResolvedKey = key;
                segment.Subscription = current.PropertyChanged(key).subscribe(this.onChangedBound);
                return current.get_property_value(key);
            }
            // Not a dependency property — fall through to the plain Observable
            // branch below (MuralBase extends Observable), subscribing to the
            // property NAME via the base INPC store.
        }
        // A plain-property Observable source (a non-MuralBase VM, OR a MuralBase
        // whose bound name isn't a DP). No descriptor — key reactivity off the
        // property NAME. Read stays a bracket access, which invokes the getter.
        if (current instanceof Observable)
        {
            segment.MuralBase = undefined;
            segment.ResolvedKey = undefined;
            segment.ObservableSource = current;
            segment.ObservableName = segment.PropertyName;
            segment.Subscription = current.PropertyChanged(segment.PropertyName).subscribe(this.onChangedBound);
            return (current as unknown as Record<string, unknown>)[segment.PropertyName];
        }
        if (current instanceof ObservableCollection)
        {
            segment.MuralBase = undefined;
            segment.ObservableSource = undefined;
            const idx = Number(segment.PropertyName);
            if (!Number.isFinite(idx)) return undefined;
            segment.CollectionUnsub = current.Subscribe(() => this.OnCollectionChanged(segment));
            return current.Get(idx);
        }
        if (Array.isArray(current))
        {
            segment.MuralBase = undefined;
            segment.ObservableSource = undefined;
            const idx = Number(segment.PropertyName);
            if (!Number.isFinite(idx)) return (current as any)[segment.PropertyName];
            const wrapped = observe_array(current);
            segment.CollectionUnsub = subscribe_array(wrapped, () => this.OnCollectionChanged(segment));
            return wrapped[idx];
        }
        segment.MuralBase = undefined;
        segment.ObservableSource = undefined;
        return current[segment.PropertyName];
    }

    // Detaches the path's onChanged listener for a previously-attached
    // segment. Mirrors attach_and_step — handles MuralBase property
    // listeners and collection-mutation subscriptions.
    private detach_segment(segment: PropertyPathSegment): void
    {
        if (segment.CollectionUnsub !== undefined)
        {
            segment.CollectionUnsub();
            segment.CollectionUnsub = undefined;
            return;
        }
        // Property-change teardown. One Disposable tears down whichever
        // channel the segment subscribed to — a MuralBase key OR a plain-
        // Observable name — so no source/key re-derivation is needed here.
        segment.Subscription?.dispose();
        segment.Subscription = undefined;
        segment.ObservableSource = undefined;
        segment.ObservableName = undefined;
        segment.ResolvedKey = undefined;
    }

    // Fires from an ObservableCollection / observed-array mutation
    // affecting an index segment we're attached to. The collection's
    // identity is unchanged — only the value AT the index may have
    // shifted. Re-resolves from the index segment forward; emits an
    // onValueChanged when the resolved value changes (standard dedup).
    OnCollectionChanged(targetSegment: PropertyPathSegment): void
    {
        const segmentIdx = this.segments.indexOf(targetSegment);
        if (segmentIdx === -1) return;

        // Walk to the collection (segments before the index) — these
        // are still valid; their MuralBase subscriptions haven't fired.
        let current: any = this.model;
        for (let j = 0; j < segmentIdx; j++)
        {
            current = PropertyPath.read_segment(current, this.segments[j]!);
        }
        // Read the value at the index from the still-subscribed
        // collection.
        let stepped: any = PropertyPath.read_segment(current, targetSegment);

        // Detach + re-attach every segment AFTER the index segment;
        // their upstream values may have changed.
        for (let j = segmentIdx + 1; j < this.segments.length; j++)
        {
            this.detach_segment(this.segments[j]!);
        }
        for (let j = segmentIdx + 1; j < this.segments.length; j++)
        {
            stepped = this.attach_and_step(stepped, this.segments[j]!);
        }

        const previous = this.resolvedValue;
        this.resolvedValue = stepped;
        if (previous !== stepped)
        {
            this.onValueChanged?.(previous, stepped);
        }
        // Re-wire the leaf-collection pulse: if the resolved leaf is
        // (still) a collection, the subscription needs to track the
        // current resolved value.
        this.refresh_leaf_collection_subscription();
    }

    // Maintains a subscription on the resolved leaf value when that
    // leaf is itself a collection (ObservableCollection OR a plain
    // Array — both are observable via observe_array). Fires
    // onValueChanged((coll, coll)) on every mutation so consumers
    // bound to the collection itself see a pulse — collection
    // identity is unchanged but contents shifted. WPF parity: this
    // is the INotifyCollectionChanged channel surfaced through the
    // same binding callback that delivers INotifyPropertyChanged
    // events. Called after Traverse and after OnChanged /
    // OnCollectionChanged refit the resolved value.
    private leafCollectionUnsub: (() => void) | undefined;

    private refresh_leaf_collection_subscription(): void
    {
        if (this.leafCollectionUnsub !== undefined)
        {
            this.leafCollectionUnsub();
            this.leafCollectionUnsub = undefined;
        }
        const value = this.resolvedValue;
        const pulse = (): void => { this.onCollectionPulseCallback?.(); };
        if (value instanceof ObservableCollection)
        {
            this.leafCollectionUnsub = value.Subscribe(pulse);
            return;
        }
        if (Array.isArray(value))
        {
            // Wrap so mutations routed through the binding-returned
            // proxy notify. Mutations on the underlying raw array
            // bypass the Proxy and don't push — see
            // observable-array.ts for the caveat.
            const wrapped = observe_array(value);
            this.leafCollectionUnsub = subscribe_array(wrapped, pulse);
        }
    }

    OnChanged(args: PropertyChangedEventArgs): void
    {
        const model = args.owner;
        const property = args.property;
        const new_value = args.newValue;
        for (let i = 0; i < this.segments.length; i++)
        {
            const seg_i = this.segments[i];
            // Match a MuralBase-keyed segment OR a plain-Observable segment —
            // for the latter the notifying `model` is the Observable itself
            // (its MuralBase is undefined). Both key off the property name.
            const matches = seg_i !== undefined
                && seg_i.PropertyName === property
                && (seg_i.MuralBase === model
                    || (seg_i.ObservableSource !== undefined
                        && (seg_i.ObservableSource as unknown) === (model as unknown)));
            if (matches)
            {
                let current: any = new_value;
                for (let j = i + 1; j < this.segments.length; j++)
                {
                    const seg_j = this.segments[j];
                    if (seg_j === undefined) continue;
                    this.detach_segment(seg_j);
                    current = this.attach_and_step(current, seg_j);
                }

                const previous = this.resolvedValue;
                this.resolvedValue = current;
                if (previous !== current)
                {
                    this.onValueChanged?.(previous, current);
                }
                this.refresh_leaf_collection_subscription();
                break;
            }
        }
    }

    Traverse(): void
    {
        let current: any = this.model;
        for (const segment of this.segments)
        {
            current = this.attach_and_step(current, segment);
        }
        this.resolvedValue = current;
        this.refresh_leaf_collection_subscription();
    }

    get_value(root: any): any
    {
        let current: any = root;
        for (const segment of this.segments)
        {
            if (current === undefined || current === null) return undefined;
            current = PropertyPath.read_segment(current, segment);
        }
        return current;
    }

    // Assigns value to the final segment of the path, after resolving the
    // parent object. For MuralBase parents, the final write goes through
    // set_property_value so it participates in EffectiveValue priority and
    // PropertyChanged notifications; everything else is a plain assignment.
    // Returns false when the path is empty or the parent cannot be reached.
    set_value(root: any, value: any): boolean
    {
        if (this.segments.length === 0)
        {
            return false;
        }

        let parent: any = root;
        for (let i = 0; i < this.segments.length - 1; i++)
        {
            if (parent === undefined || parent === null)
            {
                return false;
            }
            parent = PropertyPath.read_segment(parent, this.segments[i]!);
        }

        if (parent === undefined || parent === null)
        {
            return false;
        }

        // Attached-segment writes require a resolvable owner class; if
        // the class isn't registered, the write silently no-ops (matches
        // read_segment's behavior). For plain Models / objects, write
        // through.
        const leaf = this.segments[this.segments.length - 1]!;
        if (leaf.OwnerName !== undefined && MuralBase.find_class(leaf.OwnerName) === undefined)
        {
            return false;
        }
        PropertyPath.write_segment(parent, leaf, value);
        return true;
    }
}

export enum BindingMode
{
    OneWay,
    TwoWay,
    OneTime,
    OneWayToSource
}

// User-supplied value transformer applied between source and target.
// `convert` runs source → target; `convertBack` (if present) runs target → source
// for TwoWay / OneWayToSource writeback. Converters without `convertBack`
// pass writeback values through unchanged.
export interface ValueConverter
{
    convert(value: any): any;
    convertBack?(value: any): any;
}

// Optional configuration for a Binding. Fields are independent — any
// subset can be supplied. The resolved value flows through this
// pipeline (in order): converter → stringFormat → targetNullValue →
// fallbackValue. For TwoWay writeback, only converter.convertBack
// reverses; stringFormat is one-way by design.
export interface BindingOptions
{
    converter?: ValueConverter;
    // Format string applied after the converter. Currently supports
    // '{0}' substitution only (e.g., '$ {0}' → '$ 42'). Richer
    // formatting (number/date formats) can layer on later.
    stringFormat?: string;
    // Used when the resolved value is null (after Convert/Format).
    targetNullValue?: any;
    // Used when the resolved value is undefined (path couldn't reach
    // the source) OR — if you want WPF parity later — when anything
    // in the pipeline threw.
    fallbackValue?: any;
    // Rules that run on every read (push notification → consumer) and
    // on every TwoWay/OneWayToSource writeback. Failing rules surface
    // on the target via the `Validation.HasError` / `Validation.Errors`
    // attached properties; on writeback, the source write is blocked
    // and the old source value stays put.
    validationRules?: readonly ValidationRule[];
}

// Compose a converter CHAIN left-to-right for the `$path << a << b`
// syntax: `convert` runs a, then b, … (each feeding the next); on TwoWay
// writeback `convertBack` runs them in REVERSE, skipping any link that
// has no convertBack (that stage passes through, matching a single
// converter's pass-through contract). A single converter is returned
// as-is so its own convertBack presence is preserved; an empty chain is
// the identity converter.
export function composeConverters(converters: readonly ValueConverter[]): ValueConverter
{
    if (converters.length === 1) return converters[0]!;
    return {
        convert(value: any): any
        {
            let out = value;
            for (const c of converters) out = c.convert(out);
            return out;
        },
        convertBack(value: any): any
        {
            let out = value;
            for (let i = converters.length - 1; i >= 0; i--)
            {
                const back = converters[i]!.convertBack;
                if (back !== undefined) out = back(out);
            }
            return out;
        },
    };
}

// Composes two converters: outer(inner(value)) for convert; for
// convertBack, only the inner one applies (outer is treated as one-way,
// since StringFormat composition uses this and string formatting is
// inherently lossy).
function compose_converters(inner: ValueConverter, outer: ValueConverter): ValueConverter
{
    return {
        convert(v: any): any { return outer.convert(inner.convert(v)); },
        convertBack: inner.convertBack ? (v: any) => inner.convertBack!(v) : undefined,
    };
}

// A Binding pairs a source root with a PropertyPath. get_value walks the
// path lazily and applies the converter / stringFormat / fallback pipeline;
// set_value (TwoWay / OneWayToSource only) writes back to the leaf via
// the path, running the value through convertBack first if a converter
// supplies one. Lifecycle is owned by whoever installs the Binding
// (typically a MuralBase property's EVD, which disposes the previous Binding
// on replacement).
export class Binding
{
    private readonly source: any;
    private readonly path: PropertyPath;
    // Backing storage for `mode`. Not readonly because ResolveDefaultMode
    // may flip an unset mode to TwoWay when the target property's metadata
    // declares BindsTwoWayByDefault.
    private resolvedMode: BindingMode;
    private readonly modeExplicit: boolean;

    private readonly converter: ValueConverter | undefined;
    private readonly hasFallback: boolean;
    private readonly fallbackValue: any;
    private readonly hasTargetNull: boolean;
    private readonly targetNullValue: any;
    private readonly validationRules: readonly ValidationRule[];

    constructor(
        source: MuralBase,
        path: string,
        mode?: BindingMode,
        opts?: BindingOptions,
    )
    {
        this.source = source;
        this.path = new PropertyPath(source, path);
        this.resolvedMode = mode ?? BindingMode.OneWay;
        this.modeExplicit = mode !== undefined;

        // Compose converter + stringFormat into a single converter.
        if (opts?.stringFormat !== undefined)
        {
            const fmt = opts.stringFormat;
            const formatter: ValueConverter = {
                convert(v: any): any { return fmt.replace('{0}', String(v)); },
            };
            this.converter = opts.converter
                ? compose_converters(opts.converter, formatter)
                : formatter;
        }
        else
        {
            this.converter = opts?.converter;
        }

        // `'field' in opts` distinguishes "not provided" from "explicitly
        // undefined" — lets callers use undefined as a fallback value.
        this.hasFallback = opts !== undefined && 'fallbackValue' in opts;
        this.fallbackValue = opts?.fallbackValue;
        this.hasTargetNull = opts !== undefined && 'targetNullValue' in opts;
        this.targetNullValue = opts?.targetNullValue;
        this.validationRules = opts?.validationRules ?? [];
    }

    // True when at least one ValidationRule was supplied at construction.
    // EVD reads this to skip validation overhead on bindings with no rules.
    public get HasValidationRules(): boolean
    {
        return this.validationRules.length > 0;
    }

    // Runs every rule against `value` and returns the list of failures.
    // Empty list means "all rules pass". Used by EVD on push notifications
    // and on TwoWay/OneWayToSource writeback.
    public Validate(value: unknown): readonly ValidationError[]
    {
        if (this.validationRules.length === 0) return [];
        const errors: ValidationError[] = [];
        for (const rule of this.validationRules)
        {
            const result = rule.validate(value);
            if (!result.isValid)
            {
                errors.push({
                    rule,
                    errorContent: result.errorContent ?? '(no message)',
                    value,
                });
            }
        }
        return errors;
    }

    public get mode(): BindingMode
    {
        return this.resolvedMode;
    }

    // Called by EffectiveValueDescriptor at install time. If the binding
    // was constructed without an explicit mode and the target property's
    // metadata declares BindsTwoWayByDefault, the mode flips to TwoWay
    // (WPF's FrameworkPropertyMetadataOptions.BindsTwoWayByDefault
    // behavior). An explicitly-supplied mode is preserved.
    ResolveDefaultMode(descriptor: PropertyDescriptor): void
    {
        if (this.modeExplicit) return;
        if (bindsTwoWayByDefault(descriptor.MetaData))
        {
            this.resolvedMode = BindingMode.TwoWay;
        }
    }

    // Called by EffectiveValueDescriptor.SetInheritedValue when THIS binding
    // is the active (masking) source on the target property AND the property's
    // inherited value just changed. Almost every binding ignores this — its
    // source is unrelated to the target's own inherited value. The exception
    // is a DataContextBinding installed AS the DataContext (`DataContext =
    // $Path`), whose source IS the inherited DataContext: it must re-resolve
    // when the parent's context arrives/changes, which the masked
    // SetInheritedValue would otherwise never surface. No-op by default.
    onInheritedValueChanged(): void { }

    // Source → target transformation: converter, then stringFormat
    // (folded into converter), then targetNullValue / fallbackValue
    // substitution. Used by get_value and by EVD push notifications so
    // consumer listeners see the post-pipeline value.
    public apply_transform(raw: any): any
    {
        const converted = this.converter ? this.converter.convert(raw) : raw;
        if (converted === undefined && this.hasFallback) return this.fallbackValue;
        if (converted === null && this.hasTargetNull) return this.targetNullValue;
        return converted;
    }

    // Resolves the current value of the bound source property,
    // post-pipeline.
    get_value(): any
    {
        return this.apply_transform(this.path.get_value(this.source));
    }

    // Subscribe to terminal-value changes on the underlying path. The
    // callback fires when a chain mutation alters the resolved value. Pass
    // undefined to detach (used when the consumer is replaced by another
    // base value).
    setOnValueChanged(cb: ((old_value: any, new_value: any) => void) | undefined): void
    {
        this.path.setOnValueChanged(cb);
    }

    // Subscribe to collection-as-leaf mutation pulses. Fires when the
    // bound source path resolves to a collection (ObservableCollection
    // or plain array) and its contents change. The path-resolved value
    // identity stays the same; consumers receive a pulse to know the
    // collection's contents shifted (mirrors WPF's
    // INotifyCollectionChanged channel surfaced through the same
    // binding). EVD wires this during install so a target property
    // bound to a collection sees PropertyChanged listeners fire on
    // every Add / Remove / Insert / Move / Clear.
    setOnCollectionPulse(cb: (() => void) | undefined): void
    {
        this.path.setOnCollectionPulse(cb);
    }

    // Tears down the underlying path: removes every listener it registered
    // on chain Models and clears its callback. Call when the Binding is
    // no longer needed (the EVD does this automatically when one Binding
    // replaces another).
    dispose(): void
    {
        this.path.dispose();
    }

    // Pushes a value back to the source property. Only meaningful for
    // TwoWay / OneWayToSource bindings; returns false otherwise, or when
    // the source path cannot be written. Runs through convertBack first
    // if the converter supplies one; otherwise the value passes through.
    set_value(value: any): boolean
    {
        if (this.mode !== BindingMode.TwoWay && this.mode !== BindingMode.OneWayToSource)
        {
            return false;
        }
        return this.path.set_value(this.source, this.applyConvertBack(value));
    }

    // Run a writeback value through the converter's `convertBack` (or pass
    // it through when absent). Subclass bindings whose real source differs
    // from the base watcher (DataContext / ElementName write to the VM /
    // named element, not `watcher.Value`) call this so that source gets the
    // back-converted value — matching what the base wrote to the watcher.
    protected applyConvertBack(value: any): any
    {
        return this.converter?.convertBack !== undefined
            ? this.converter.convertBack(value)
            : value;
    }
}
