import { Binding, BindingMode } from './binding.js';
import { isAnimationProhibited, isNotDataBindable } from '../metadata.js';
import type { MuralBase } from '../model.js';
import type { PropertyDescriptor, SettingValue } from '../property-descriptor.js';
import { Validation } from './validation.js';
import { Signal } from '@pragmatic-tech-ai/todl-runtime';
import type { Disposable, PropertyChangedEventArgs } from '@pragmatic-tech-ai/todl-runtime';
import { readServiceScope } from './service-scope.js';
import { Application } from '../application.js';
import { SettingSourceKey, type ISettingSource } from '../services/setting-source.js';

// The property-change payload now lives with `Observable` in
// @pragmatic-tech-ai/todl-runtime — its `owner` is typed `Observable`, the common
// base of a plain Observable source and a MuralBase. Re-exported here so
// consumers keep importing it from `@pragmatic-tech-ai/mural/runtime`. Treat
// `owner` as an opaque notifying identity; it is NOT guaranteed to be a
// `MuralBase`, so do not reach for the DP surface on it.
export type { PropertyChangedEventArgs };

// Internal callback used by MuralBase to route invalidation / inheritance.
// Carries the PropertyDescriptor directly so MuralBase.OnPropertyChanged
// doesn't need to re-look it up — important for cross-class properties
// where the descriptor doesn't live on the target's class hierarchy.
export type InternalPropertyChangeCallback = (
    model: MuralBase,
    descriptor: PropertyDescriptor,
    old_value: any,
    new_value: any,
) => void;

// Where the effective value came from. Read via MuralBase.GetValueSource(key).
//
// Priority order (highest to lowest):
//   Coerced > Animated > Trigger > Binding > Local > Style > Inherited > Setting > Default
//
// Deviation from WPF: mural promotes Trigger ABOVE Binding and Local.
// In WPF the order is Local > Trigger, but mural's `.mu` templates emit
// per-part defaults via the factory's `set_property_value` calls
// (LocalValue tier) and then express state-driven overrides
// (`when ( IsMouseOver ) { PART_Border.Fill = … }`) via
// TemplatePropertyTrigger — which writes at TriggerValue. With the WPF
// order those state triggers were invisible (LocalValue blocked them),
// so every templated control's hover / press / IsChecked feedback
// silently broke. Promoting Trigger above Local matches the way
// authors write templates here, at the cost of consumers no longer
// being able to write `widget.Fill = brush` over an active
// trigger.
//
// The enum values themselves don't encode priority — the EVD's `value`
// getter and the various Set / Clear methods encode the priority via
// their dispatch.
export enum PropertyValueSource
{
    AnimatedValue,
    LocalValue,
    Binding,
    CoercedValue,
    TriggerValue,
    StyleValue,
    InheritedValue,
    SettingValue,
    Default
}

// Per-instance state for one registered property. Holds the base-value
// slots (animated / binding / local / trigger / style / inherited), the
// current base source, and the per-instance change listeners. Created
// lazily by MuralBase on first set or first listener attach.
//
// Coercion is NOT a base slot — it's a pure transform applied on every
// `value` read (and on binding push notifications). The descriptor's
// `CoerceValue` callback runs against whichever base slot wins; the
// resulting value is what listeners and `value` consumers see. When
// coerce is registered AND its result differs from the base, `Source`
// reports `CoercedValue`; otherwise it reports the base source.
export class EffectiveValueDescriptor
{
    private local_value: any;
    private has_local_value: boolean = false;
    private binding_value: Binding | undefined;
    private animated_value: any;
    private has_animated_value: boolean = false;
    // Style / Trigger / Inherited slots use parallel flags because
    // `undefined` is a legitimate value (a style setter MAY want to
    // set a property to undefined explicitly, distinct from "no style
    // value cached"; the inherited cache must distinguish "ancestor
    // resolved to undefined" from "no ancestor value at all" for the
    // fall-through chain in ClearStyleValue / ClearTriggerValue /
    // ClearValue).
    //
    // Local + Animated also carry has_* flags. Local distinguishes
    // "user explicitly wrote undefined" from "never set"; Animated lets
    // ClearAnimatedValue know whether there was a slot to drop at all.
    // Per-setter contributions to the Trigger tier. Multiple
    // PropertyTriggers can each apply a setter to the same property at
    // the same tier; the stack tracks (setter, value) pairs in
    // activation order so the top entry is the current effective
    // trigger value and ClearTriggerValue can remove a specific
    // setter's entry without wiping a still-active sibling trigger's
    // contribution. Without this, a second trigger's deactivation
    // (whose setter targeted the same property as a first trigger
    // already in the slot) used to wipe the first trigger's value too,
    // collapsing the source to the next tier — see the FillEditor
    // Variant=Picture→Linear failure that surfaced when two triggers'
    // setters targeted BodyTemplate.
    private _triggerStack: Array<{ setter: object; value: any }> = [];
    private style_value: any;
    private has_style_value: boolean = false;
    private inherited_value: any;
    private has_inherited_value: boolean = false;

    private property_descriptor: PropertyDescriptor;
    // User-facing change channel: consumers subscribe via ChangedSignal() and
    // own the returned Disposable. Held as a Signal so change notification
    // rides the runtime's one subscribe/emit primitive.
    private readonly changed = new Signal<PropertyChangedEventArgs>();
    // Reserved for the owning MuralBase to route every effective-value change
    // through its virtual OnPropertyChanged hook. Stored separately from the
    // `changed` Signal so user-facing subscriber counts stay clean. Carries
    // the descriptor (not just a name) so cross-class property changes
    // can be dispatched without re-lookup.
    private internal_callback: InternalPropertyChangeCallback | undefined;

    private owner: MuralBase;
    private source: PropertyValueSource = PropertyValueSource.Default;
    private setting_subscription: Disposable | undefined;

    constructor(propertyDescriptor: PropertyDescriptor, owner: MuralBase)
    {
        this.property_descriptor = propertyDescriptor;
        this.owner = owner;
        this.source = this.lowestSource();
    }

    // Returns the lowest-priority base source for this descriptor.
    // When the descriptor has a SettingValue binding, the floor is
    // SettingValue; unbound descriptors keep the existing Default floor.
    private lowestSource(): PropertyValueSource
    {
        return this.property_descriptor.SettingValue !== undefined
            ? PropertyValueSource.SettingValue
            : PropertyValueSource.Default;
    }

    // Pure static resolver used by both the EVD (which then also subscribes)
    // and the MuralBase no-EVD read path. Returns the resolved ISettingSource
    // (for the caller to subscribe if it wants) plus whether a value was found.
    // No side effects — safe to call without creating an EVD or subscription.
    public static resolveSetting(
        owner: MuralBase,
        binding: SettingValue,
    ): { src: ISettingSource | undefined; has: boolean; value: unknown }
    {
        const provider = readServiceScope(owner) ?? Application.current?.Services;
        const src = provider?.get(SettingSourceKey) as ISettingSource | undefined;
        if (src === undefined) return { src: undefined, has: false, value: undefined };
        const raw = src.Get(binding.key);
        if (raw === undefined) return { src, has: false, value: undefined };
        return { src, has: true, value: binding.convert !== undefined ? binding.convert(raw) : raw };
    }

    // Resolves the current setting value from the ambient ISettingSource.
    // Falls back through readServiceScope (per-element scope) then
    // Application.current.Services (app-wide root). Returns { has: false }
    // when no source is registered or the key has no stored value.
    // Also lazily subscribes to the setting's change signal so future
    // mutations are reflected via OnPropertyChange.
    private resolveSettingValue(): { has: boolean; value: unknown }
    {
        const binding = this.property_descriptor.SettingValue;
        if (binding === undefined) return { has: false, value: undefined };
        const r = EffectiveValueDescriptor.resolveSetting(this.owner, binding);
        if (r.src !== undefined) this.ensureSettingSubscription(r.src, binding.key);
        return { has: r.has, value: r.value };
    }

    private ensureSettingSubscription(src: ISettingSource, key: string): void
    {
        if (this.setting_subscription !== undefined) return;
        this.setting_subscription = src.Changed(key).subscribe((args) => this.onSettingChanged(args));
    }

    private onSettingChanged(args: PropertyChangedEventArgs): void
    {
        if (this.source !== PropertyValueSource.SettingValue) return; // masked — pull covers it
        const binding = this.property_descriptor.SettingValue;
        if (binding === undefined) return;
        const oldEff = this.apply_coerce(binding.convert !== undefined ? binding.convert(args.oldValue) : args.oldValue);
        const newEff = this.value; // re-resolves current setting value (post convert + coerce)
        if (oldEff !== newEff) this.OnPropertyChange(oldEff, newEff);
    }

    public teardown(): void
    {
        this.setting_subscription?.dispose();
        this.setting_subscription = undefined;
    }

    OnPropertyChange(old_value: any, new_value: any): void
    {
        // Internal callback first (matches WPF: metadata callbacks run
        // before user PropertyChanged subscribers), then user listeners.
        // The internal callback gets the descriptor directly so cross-class
        // properties can be routed without re-lookup; user listeners get
        // the simple property name for ergonomic context.
        this.internal_callback?.(this.owner, this.property_descriptor, old_value, new_value);
        this.changed.emit({
            owner:    this.owner,
            property: this.property_descriptor.Name,
            oldValue: old_value,
            newValue: new_value,
        });
    }

    SetInternalCallback(cb: InternalPropertyChangeCallback): void
    {
        this.internal_callback = cb;
    }

    // The user-facing change channel for this property. Subscribe to observe
    // effective-value changes; dispose the returned subscription to detach.
    // Excludes the internal MuralBase routing callback, so subscriberCount
    // reflects only user-facing listeners.
    ChangedSignal(): Signal<PropertyChangedEventArgs>
    {
        return this.changed;
    }

    // Reports the effective source. When a CoerceValue callback is
    // registered AND its result differs from the underlying base value,
    // returns CoercedValue (matches WPF — the diagnostic "this isn't
    // what you set"). Otherwise returns the base source.
    get Source(): PropertyValueSource
    {
        const coerce = this.property_descriptor.CoerceValue;
        if (coerce !== undefined)
        {
            const base = this.compute_base_value();
            if (coerce(this.owner, base) !== base)
            {
                return PropertyValueSource.CoercedValue;
            }
        }
        return this.source;
    }

    // Resets every base-value slot, disposes any active binding, drops the
    // source to the next-lower priority slot still set (style → inherited
    // → default), and fires a change notification if the effective value
    // differed. Listeners on this EVD are preserved. Note: doesn't touch
    // the style or inherited caches — those are managed by the style
    // machinery and the inheritance machinery respectively.
    ClearValue(): void
    {
        const old_effective_value = this.value;

        if (this.binding_value !== undefined)
        {
            this.binding_value.dispose();
            this.binding_value = undefined;
        }
        this.local_value = undefined;
        this.has_local_value = false;
        this.animated_value = undefined;
        this.has_animated_value = false;
        this.source = this.has_trigger_value
            ? PropertyValueSource.TriggerValue
            : this.has_style_value
                ? PropertyValueSource.StyleValue
                : this.has_inherited_value
                    ? PropertyValueSource.InheritedValue
                    : this.lowestSource();

        const new_effective_value = this.value;
        if (old_effective_value !== new_effective_value)
        {
            this.OnPropertyChange(old_effective_value, new_effective_value);
        }
    }

    // Caches the inherited value resolved from an ancestor. ALWAYS
    // updates the cached slot — even when a higher-priority source is
    // currently active — so a later clear of that higher source falls
    // through to a fresh inherited value rather than a stale one
    // captured before the higher source was installed. The source flip
    // and change-notification only fire when no higher-priority source
    // is masking inheritance.
    SetInheritedValue(value: any): void
    {
        const old_effective_value = this.value;
        const old_inherited_value = this.inherited_value;
        this.inherited_value = value;
        this.has_inherited_value = true;

        // Higher-priority source active: cache is updated but stays
        // invisible until that source clears. No source flip, no
        // notification. SettingValue is outranked by Inherited so it is
        // included in the "must flip" set — an arriving inherited value
        // takes over when the current source is SettingValue.
        if (this.source !== PropertyValueSource.InheritedValue
            && this.source !== PropertyValueSource.Default
            && this.source !== PropertyValueSource.SettingValue)
        {
            // …with ONE exception: a Binding whose own source IS this
            // inherited value (the self-referential `DataContext = $Path`)
            // must re-resolve when the inherited context arrives/changes.
            // The effective value (the binding) is unchanged, so the normal
            // notification below never fires — hand the binding a direct
            // signal instead. Ordinary bindings ignore it (no-op).
            if (old_inherited_value !== value
                && this.source === PropertyValueSource.Binding
                && this.binding_value !== undefined)
            {
                this.binding_value.onInheritedValueChanged();
            }
            return;
        }
        this.source = PropertyValueSource.InheritedValue;
        const new_effective_value = this.value;
        if (old_effective_value !== new_effective_value)
        {
            this.OnPropertyChange(old_effective_value, new_effective_value);
        }
    }

    // Caches a Style-driven value for this property. Style sits below
    // LocalValue / Binding / Animated / Coerced / Trigger in the
    // priority stack — if one of those is active, the style value is
    // stored but the current source stays unchanged (style takes over
    // later if the higher-priority source is cleared). Fires change
    // notification when the effective value actually changes.
    SetStyleValue(value: any): void
    {
        const old_effective_value = this.value;
        this.style_value = value;
        this.has_style_value = true;
        if (this.source === PropertyValueSource.LocalValue
            || this.source === PropertyValueSource.Binding
            || this.source === PropertyValueSource.AnimatedValue
            || this.source === PropertyValueSource.TriggerValue)
        {
            return;
        }
        this.source = PropertyValueSource.StyleValue;
        const new_effective_value = this.value;
        if (old_effective_value !== new_effective_value)
        {
            this.OnPropertyChange(old_effective_value, new_effective_value);
        }
    }

    // Drops the style slot. If Style was the current source, falls
    // through to InheritedValue (if cached) or Default. Higher-
    // priority sources are unaffected.
    ClearStyleValue(): void
    {
        if (!this.has_style_value) return;
        const old_effective_value = this.value;
        this.style_value = undefined;
        this.has_style_value = false;
        if (this.source === PropertyValueSource.StyleValue)
        {
            this.source = this.has_inherited_value
                ? PropertyValueSource.InheritedValue
                : this.lowestSource();
        }
        const new_effective_value = this.value;
        if (old_effective_value !== new_effective_value)
        {
            this.OnPropertyChange(old_effective_value, new_effective_value);
        }
    }

    private get has_trigger_value(): boolean
    {
        return this._triggerStack.length > 0;
    }

    // Current Trigger-tier effective value — top of the stack. WPF
    // parity: when multiple triggers contribute setters to the same
    // property at the same tier, last-applied wins.
    private get trigger_value(): any
    {
        return this._triggerStack.length > 0
            ? this._triggerStack[this._triggerStack.length - 1]!.value
            : undefined;
    }

    // Caches a Trigger-driven value for this property. Trigger sits
    // above Binding / Local / Style / Inherited / Default; only
    // Animated and Coerced outrank it. Same pattern as SetStyleValue
    // otherwise — stash regardless, but only flip source if no higher-
    // priority slot is active.
    //
    // `setter` identifies which trigger setter contributed this value
    // so ClearTriggerValue can drop just this setter's entry without
    // wiping a sibling trigger's still-active contribution. If the
    // same setter calls again (e.g., a binding push updates the
    // tracked value), the existing stack entry's value updates in
    // place — re-applying does NOT promote the setter past a later-
    // activated trigger; that would invert WPF's last-applied-wins
    // ordering when nothing about the setter itself changed.
    SetTriggerValue(setter: object, value: any): void
    {
        const old_effective_value = this.value;
        const existing = this._triggerStack.find(e => e.setter === setter);
        if (existing !== undefined)
        {
            existing.value = value;
        }
        else
        {
            this._triggerStack.push({ setter, value });
        }
        if (this.source === PropertyValueSource.AnimatedValue)
        {
            return;
        }
        this.source = PropertyValueSource.TriggerValue;
        const new_effective_value = this.value;
        if (old_effective_value !== new_effective_value)
        {
            this.OnPropertyChange(old_effective_value, new_effective_value);
        }
    }

    // Removes this setter's entry from the Trigger stack. If another
    // trigger setter is still on the stack, the source stays
    // TriggerValue and the next-down entry's value becomes effective.
    // If the stack drains empty, source falls through to Binding /
    // LocalValue / StyleValue / InheritedValue / Default in the usual
    // order. Higher-priority sources (Animated) are unaffected.
    ClearTriggerValue(setter: object): void
    {
        const idx = this._triggerStack.findIndex(e => e.setter === setter);
        if (idx === -1) return;
        const old_effective_value = this.value;
        this._triggerStack.splice(idx, 1);
        if (this._triggerStack.length === 0
         && this.source === PropertyValueSource.TriggerValue)
        {
            this.source = this.binding_value !== undefined
                ? PropertyValueSource.Binding
                : this.has_local_value
                    ? PropertyValueSource.LocalValue
                    : this.has_style_value
                        ? PropertyValueSource.StyleValue
                        : this.has_inherited_value
                            ? PropertyValueSource.InheritedValue
                            : this.lowestSource();
        }
        const new_effective_value = this.value;
        if (old_effective_value !== new_effective_value)
        {
            this.OnPropertyChange(old_effective_value, new_effective_value);
        }
    }

    // Drops the inherited cache. If InheritedValue was the current
    // source, falls through to Default. ALWAYS clears the cached slot
    // — even when a higher-priority source is masking inheritance —
    // so a later clear of that higher source falls through to Default
    // rather than to a stale inherited value the ancestor no longer
    // provides. Used when the ancestor chain no longer carries a
    // value (after Detach or when an ancestor's value was cleared).
    ClearInherited(): void
    {
        if (!this.has_inherited_value) return;
        const old_effective_value = this.value;
        this.inherited_value = undefined;
        this.has_inherited_value = false;
        if (this.source !== PropertyValueSource.InheritedValue) return;
        this.source = this.lowestSource();
        const new_effective_value = this.value;
        if (old_effective_value !== new_effective_value)
        {
            this.OnPropertyChange(old_effective_value, new_effective_value);
        }
    }

    // Base-value entry point.
    //
    // If a Binding is being installed, the previous binding (if any) is
    // disposed and the new one takes the Binding source slot.
    //
    // For non-Binding writes: if the existing source is a TwoWay /
    // OneWayToSource binding, the write flows through that binding to
    // the source rather than replacing it (WPF's PropertyChanged
    // UpdateSourceTrigger behavior). The source's own set_property_value
    // fires the binding's push notification, which routes back through
    // this EVD's OnPropertyChange — so listeners still see one change.
    //
    // For all other cases (no existing binding, or existing binding is
    // OneWay/OneTime, or TwoWay writeback failed because the path isn't
    // writable), the write replaces the current source as a LocalValue
    // and the previous binding (if any) is disposed.
    set value(val: any)
    {
        // IsNotDataBindable gate: structural DPs (Style.TargetType,
        // DataTemplate.DataType, Setter.Property, …) refuse Binding
        // installs at the call site rather than producing weird
        // downstream behavior when the binding resolves to something
        // the framework can't interpret. Direct value writes go
        // through unchanged.
        if (val instanceof Binding && isNotDataBindable(this.property_descriptor.MetaData))
        {
            throw new Error(
                `Property '${this.property_descriptor.RootOwner.name}.${this.property_descriptor.Name}' is marked IsNotDataBindable — Binding installs are rejected.`,
            );
        }

        const old_effective_value = this.value;

        // TwoWay / OneWayToSource writeback: route non-Binding writes
        // through the installed binding instead of replacing it.
        if (!(val instanceof Binding)
            && this.binding_value !== undefined
            && (this.binding_value.mode === BindingMode.TwoWay
             || this.binding_value.mode === BindingMode.OneWayToSource))
        {
            // Validation gate: any failing rule blocks the writeback
            // and surfaces the errors on the target via Validation
            // attached properties. The source keeps its previous
            // value; consumers see the target's previous value too
            // (no OnPropertyChange fires).
            if (this.binding_value.HasValidationRules)
            {
                const errors = this.binding_value.Validate(val);
                Validation.SetErrors(this.owner, this.binding_value, errors);
                if (errors.length > 0) return;
            }
            if (this.binding_value.set_value(val))
            {
                // Source update fired the binding's push notification,
                // which has already invoked OnPropertyChange on this EVD.
                return;
            }
            // Writeback failed (path not writable). Fall through to the
            // local-replace path so the user's write isn't silently lost.
        }

        // When replacing a previous binding, dispose it so its path listeners
        // are removed from every chain MuralBase. Without this the old chain
        // would keep holding (now-silent) listener references — a leak.
        if (this.binding_value !== undefined && this.binding_value !== val)
        {
            // Clear any validation errors the old binding had set on
            // the target — the binding is no longer the source of
            // truth for those errors.
            if (this.binding_value.HasValidationRules)
            {
                Validation.SetErrors(this.owner, this.binding_value, []);
            }
            this.binding_value.dispose();
            this.binding_value = undefined;
        }

        if (val instanceof Binding)
        {
            // Resolve default mode against the target property's metadata
            // BEFORE any reads of binding.mode (push-callback handler below
            // and any subsequent writeback). Bindings without an explicit
            // mode pick up TwoWay when the target declares
            // BindsTwoWayByDefault; explicit modes are preserved.
            val.ResolveDefaultMode(this.property_descriptor);
            this.binding_value = val;
            // Push-style propagation: when the path's resolved value
            // changes, transform both old and new through the binding's
            // pipeline (converter / stringFormat / fallback) so consumer
            // listeners see post-pipeline values. Dedupe if the
            // transformed values are equal — pre-pipeline change might
            // produce no post-pipeline change (e.g., format strings or
            // fallbacks can collapse two raw values to one displayed one).
            val.setOnValueChanged((old_resolved, new_resolved) =>
            {
                const old_final = this.apply_coerce(val.apply_transform(old_resolved));
                const new_final = this.apply_coerce(val.apply_transform(new_resolved));
                // Validation on every push: source-side reads update
                // the target's error state but the value still flows
                // through to consumers (per the chosen scope).
                if (val.HasValidationRules)
                {
                    Validation.SetErrors(this.owner, val, val.Validate(new_final));
                }
                if (old_final !== new_final)
                {
                    this.OnPropertyChange(old_final, new_final);
                }
            });
            // Collection-as-leaf pulse: the binding's source path
            // resolves to a collection (ObservableCollection or
            // observable-array proxy) and its contents change. The
            // value identity hasn't shifted — bypassing the dedup
            // above is exactly the point. Listeners fire with
            // (coll, coll) so a consumer bound to the collection
            // sees PropertyChanged on every mutation, mirroring
            // INotifyCollectionChanged.
            val.setOnCollectionPulse(() =>
            {
                const v = this.value;
                this.OnPropertyChange(v, v);
            });
            // Animation AND active triggers stay on top — the binding
            // cache updates so a later Stop / ClearTriggerValue /
            // ClearAnimated falls through to the fresh binding, but
            // the visible source stays at the higher tier until that
            // clears.
            if (this.source === PropertyValueSource.AnimatedValue
                || this.source === PropertyValueSource.TriggerValue)
            {
                return;
            }
            this.source = PropertyValueSource.Binding;
            // New value reads through `this.value` so coerce (if any)
            // is applied; listeners see the same values consumers do.
            const new_effective_value = this.value;
            // Initial validation pass on install so the target's
            // Validation state reflects the freshly-resolved value
            // before any push notification fires.
            if (val.HasValidationRules)
            {
                Validation.SetErrors(this.owner, val, val.Validate(new_effective_value));
            }
            this.OnPropertyChange(old_effective_value, new_effective_value);
        }
        else
        {
            this.local_value = val;
            this.has_local_value = true;
            // Local writes are NOT visible while an animation OR an
            // active trigger shadows them. Mural's priority order
            // (Animated > Trigger > Binding > Local) intentionally
            // deviates from WPF's (Local > Trigger) so template
            // factories can set per-part defaults while state-driven
            // triggers in the same template still take effect. The
            // local slot still updates so that ClearAnimatedValue /
            // ClearTriggerValue drops back to the freshest user-
            // written value, not a stale snapshot.
            if (this.source === PropertyValueSource.AnimatedValue
                || this.source === PropertyValueSource.TriggerValue)
            {
                return;
            }
            this.source = PropertyValueSource.LocalValue;
            // Coerce applied via `this.value` — clamped/normalized
            // values reach listeners, not the raw write.
            this.OnPropertyChange(old_effective_value, this.value);
        }
    }

    // ── Animated slot ──────────────────────────────────────────────────

    // Pin a value on the Animated slot. Animation overrides Binding /
    // Local / Trigger / Style / Inherited / Default (highest priority
    // among the base-value sources — Coerced still wins). Used by
    // Storyboard.AdvanceTo every clock tick; consumers normally drive
    // it indirectly via Visual.BeginAnimation / Storyboard.Add. Calling
    // it directly is a valid escape hatch but the slot is then nobody's
    // responsibility to release.
    SetAnimatedValue(value: any): void
    {
        if (isAnimationProhibited(this.property_descriptor.MetaData))
        {
            throw new Error(
                `Property '${this.property_descriptor.RootOwner.name}.${this.property_descriptor.Name}' is marked IsAnimationProhibited — animation writes are rejected.`,
            );
        }
        const old_effective_value = this.value;
        this.animated_value = value;
        this.has_animated_value = true;
        // Coerced stays on top — animations don't override the coercion
        // pass (coercion is the final word on what's writable). The
        // animation cache still updates so that ClearCoerced (when it
        // lands) falls through to the animated value.
        if (this.source === PropertyValueSource.CoercedValue) return;
        this.source = PropertyValueSource.AnimatedValue;
        const new_effective_value = this.value;
        if (old_effective_value !== new_effective_value)
        {
            this.OnPropertyChange(old_effective_value, new_effective_value);
        }
    }

    // Drop the Animated slot. If Animated was the current source, falls
    // through to Trigger / Binding / Local / Style / Inherited / Default
    // in priority order — whichever slot is still set wins. The
    // underlying value is whatever was last written to those slots
    // BEFORE / DURING the animation (the value setter keeps trigger /
    // local / binding caches fresh under the animated mask), so the
    // post-ClearAnimatedValue effective value matches the highest-
    // priority slot still set.
    ClearAnimatedValue(): void
    {
        if (!this.has_animated_value) return;
        const old_effective_value = this.value;
        this.animated_value = undefined;
        this.has_animated_value = false;
        if (this.source === PropertyValueSource.AnimatedValue)
        {
            this.source = this.has_trigger_value
                ? PropertyValueSource.TriggerValue
                : this.binding_value !== undefined
                    ? PropertyValueSource.Binding
                    : this.has_local_value
                        ? PropertyValueSource.LocalValue
                        : this.has_style_value
                            ? PropertyValueSource.StyleValue
                            : this.has_inherited_value
                                ? PropertyValueSource.InheritedValue
                                : this.lowestSource();
        }
        const new_effective_value = this.value;
        if (old_effective_value !== new_effective_value)
        {
            this.OnPropertyChange(old_effective_value, new_effective_value);
        }
    }

    // The effective value: the highest-priority base entry (Animated >
    // Binding > Local > Trigger > Style > Inherited > Default), then
    // the descriptor's CoerceValue callback (if any) applied on top.
    // Coerce runs on every read so a write to a coerce-influencing
    // sibling property is reflected on the next access without any
    // explicit "recoerce" call.
    get value(): any
    {
        return this.apply_coerce(this.compute_base_value());
    }

    // Highest-priority base slot, excluding coercion. Source enum cases
    // map 1:1 to slots; the field `source` never holds CoercedValue
    // (coercion is a transform, not a base slot).
    private compute_base_value(): any
    {
        switch (this.source)
        {
            case PropertyValueSource.AnimatedValue:
                return this.animated_value;
            case PropertyValueSource.Binding:
                return this.binding_value!.get_value();
            case PropertyValueSource.LocalValue:
                return this.local_value;
            case PropertyValueSource.TriggerValue:
                return this.trigger_value;
            case PropertyValueSource.StyleValue:
                return this.style_value;
            case PropertyValueSource.InheritedValue:
                return this.inherited_value;
            case PropertyValueSource.SettingValue:
            {
                const r = this.resolveSettingValue();
                return r.has ? r.value : this.property_descriptor.DefaultValue;
            }
            default:
                return this.property_descriptor.DefaultValue;
        }
    }

    // Apply the descriptor's coerce callback if one is registered.
    // Used by the value getter and the binding push handler so consumer
    // listeners see the same values `value` returns.
    private apply_coerce(base: any): any
    {
        const coerce = this.property_descriptor.CoerceValue;
        return coerce !== undefined ? coerce(this.owner, base) : base;
    }
}
