import { MuralBase } from '../runtime/model.js';
import type { Disposable } from '@pragmatic-tech-ai/todl-runtime';
import type { PropertyDescriptor } from '../runtime/property-descriptor.js';
import { findDescriptor, propertyValues } from '../runtime/model-internals.js';
import { inherits } from '../runtime/metadata.js';

// Resolve a Setter's (owner, property) → PropertyDescriptor with a
// cross-class fallback for inheritable DPs. A Setter inside a
// `Style [TargetType=Tooltip] { Foreground = … }` carries
// `owner=Tooltip` because the markup-implicit owner is the target
// type, but `Foreground` is registered on TextBlock with `Inherits`.
// The standard prototype-chain walk in `findDescriptor` misses it
// because TextBlock isn't in Tooltip's chain — the setter would
// silently no-op, leaving the tooltip's chrome with default
// (inherited-from-elsewhere) Foreground on a dark @InverseSurface
// background. This helper takes a second pass through the global
// inheritable-DP registry on a name match.
//
// Compiler-emitted explicit-owner setters
// (`Setter(TextBlock, 'Foreground', …)` for `_border.Foreground = …`
// shorthand on a non-TextBlock owner) take the fast path through
// `findDescriptor` and never reach the fallback. The fallback only
// catches the `[TargetType=Foo] { CrossClassProp = … }` markup path
// where the target-type-implicit owner has no such DP.
function resolveSetterDescriptor(setter: Setter): PropertyDescriptor | undefined
{
    const desc = findDescriptor(setter.owner, setter.property);
    if (desc !== undefined) return desc;
    for (const candidate of MuralBase._getInheritableDescriptors())
    {
        if (candidate.Name === setter.property && inherits(candidate.MetaData))
        {
            return candidate;
        }
    }
    return undefined;
}
import { Binding, BindingMode } from '../runtime/binding/binding.js';
import {
    Setter,
    SetterFactory,
    Style,
} from '../runtime/style.js';
import type {
    EffectiveValueDescriptor,
} from '../runtime/binding/effective-value.js';
import type { Element, ElementCtor } from './element.js';
import type { ITriggerHost } from './trigger-host.js';

// Per-setter TwoWay / OneWayToSource writeback bookkeeping. Replaces
// the Symbol-keyed slot the previous design hung off the Binding —
// see § 1.4. A Setter that legally appears in BOTH the style tier
// and the trigger tier (same instance, different application) needs
// two independent writeback entries; the per-tier Map keying makes
// that explicit without the per-Binding slot-clobber risk the symbol
// approach carried.
interface WritebackEntry
{
    // The EVD change-channel subscription installed for TwoWay writeback;
    // disposed in UnapplySetter to detach before the tier slot is cleared.
    readonly sub: Disposable;
}

// Friend-interface for the EVD ensure-helper on Visual that
// `ApplySetter` reaches into to materialize a per-property
// EffectiveValueDescriptor lazily. Same cross-class internals
// pattern.
interface EnsureEvdHost
{
    ensure_effective_value_for: (descriptor: PropertyDescriptor) => EffectiveValueDescriptor;
}

// StyleApplicator — § 1.7. The per-Element collaborator that owns
// the active Style + the bookkeeping for every setter and trigger
// that style installs. Pulls `refresh_active_style`, `apply_setter`,
// `unapply_setter`, both setter-binding maps, and the TwoWay
// writeback Map (§ 1.4) out of Visual.
//
// One instance per Element, created lazily on first Style touch.
// Visuals that never opt into Style still pay zero cost — the
// applicator is `undefined` on the receiver until needed.
//
// Pairs with `TriggerHost` (§ 1.8) — that collaborator will own the
// install / uninstall / evaluate machinery currently still on Visual
// and will call back into `StyleApplicator.ApplySetter` /
// `UnapplySetter` for trigger-tier setter writes the way the install
// methods do today.
export enum SetterTier
{
    Style   = 'style',
    Trigger = 'trigger',
}

export class StyleApplicator
{
    private _activeStyle:            Style                       | undefined;
    private _styleSetterBindings:    Map<Setter, Binding>        | undefined;
    private _triggerSetterBindings:  Map<Setter, Binding>        | undefined;
    private _styleSetterWriteback:   Map<Setter, WritebackEntry> | undefined;
    private _triggerSetterWriteback: Map<Setter, WritebackEntry> | undefined;

    constructor(private readonly _target: Element) {}

    /** The Style currently driving the StyleValue tier on this
     *  Element. `undefined` when none has been applied (or all three
     *  resolvers — explicit, implicit, theme — returned undefined). */
    public get ActiveStyle(): Style | undefined { return this._activeStyle; }

    /** Diff-style swap from the current active Style to `desired`.
     *  Setters that exist on both sides at the same Setter instance
     *  stay put — only genuinely new / removed setters fire the
     *  EVD's tier write. Same diff for the eight trigger
     *  collections. Called from `Visual.refresh_active_style` which
     *  computes `desired = Style ?? _implicitStyle ?? _themeStyle`
     *  per the WPF priority rule.
     *
     *  Validates `desired.TargetType` against the target's type —
     *  applying a `Style[TargetType=Foo]` to a non-Foo instance
     *  throws. */
    public RefreshActiveStyle(desired: Style | undefined): void
    {
        if (desired === this._activeStyle) return;
        const previous = this._activeStyle;
        this._activeStyle = desired;
        // Diff-style swap. The naive sequence — unapply(previous) →
        // apply(desired) — transitions every shared property through
        // the StyleValue=default fallback even when both styles set the
        // same value (typical for an ItemContainerStyle chained
        // BasedOn → theme: Template lives on the theme, NavRowStyle
        // contributes only IsExpanded, ResolveSetters returns the same
        // Template setter on both sides). The two OnPropertyChange
        // pulses that result trigger ContentControl.rebuildTemplate
        // twice, invalidating any constructor-cached template-part
        // references (TreeViewItem._label etc.) and leaving Header
        // writes pointed at a detached TextBlock — every group row in
        // the platform's HDT-driven nav tree rendered blank.
        //
        // Instead, diff the resolved setter maps and only touch what
        // actually changed. Property values for shared-value setters
        // stay put; OnPropertyChange fires only for genuinely new or
        // removed setters. Same diff strategy applies to triggers.
        if (previous !== undefined) previous.Seal();
        if (desired  !== undefined) desired.Seal();

        const prevSetters = previous?.ResolveSetters() ?? new Map<string, Setter>();
        const nextSetters = desired?.ResolveSetters()  ?? new Map<string, Setter>();
        // Unapply first when the property is gone OR the setter
        // instance has been replaced — replacement disposes the old
        // Binding subscription before the next setter installs its own.
        // Setters that live on the shared theme base (same instance on
        // both sides via ResolveSetters' BasedOn walk) skip both
        // branches and leave their EVD untouched.
        for (const [name, prevSetter] of prevSetters)
        {
            if (nextSetters.get(name) === prevSetter) continue;
            this.UnapplySetter(prevSetter, SetterTier.Style);
        }
        for (const [name, nextSetter] of nextSetters)
        {
            if (prevSetters.get(name) === nextSetter) continue;
            this.ApplySetter(nextSetter, SetterTier.Style);
        }

        // Element implements `ITriggerHost`; address it directly
        // through that surface so the trigger machinery isn't coupled
        // to a private trampoline shape.
        const host: ITriggerHost = this._target;

        // Triggers: install / uninstall on identity-mismatch only. The
        // resolved arrays come from the chain walk, so a trigger that
        // lives on the theme base appears in both arrays as the same
        // instance — skipping it preserves any latched trigger state.
        const prevTriggers = previous?.ResolveTriggers() ?? [];
        const nextTriggers = desired?.ResolveTriggers()  ?? [];
        const prevTriggerSet = new Set(prevTriggers);
        const nextTriggerSet = new Set(nextTriggers);
        for (const t of prevTriggers) if (!nextTriggerSet.has(t)) host.UninstallTrigger(t);
        for (const t of nextTriggers) if (!prevTriggerSet.has(t)) host.InstallTrigger(t);

        const prevMulti = previous?.ResolveMultiTriggers() ?? [];
        const nextMulti = desired?.ResolveMultiTriggers()  ?? [];
        const prevMultiSet = new Set(prevMulti);
        const nextMultiSet = new Set(nextMulti);
        for (const t of prevMulti) if (!nextMultiSet.has(t)) host.UninstallTrigger(t);
        for (const t of nextMulti) if (!prevMultiSet.has(t)) host.InstallMultiTrigger(t);

        const prevData = previous?.ResolveDataTriggers() ?? [];
        const nextData = desired?.ResolveDataTriggers()  ?? [];
        const prevDataSet = new Set(prevData);
        const nextDataSet = new Set(nextData);
        for (const t of prevData) if (!nextDataSet.has(t)) host.UninstallTrigger(t);
        for (const t of nextData) if (!prevDataSet.has(t)) host.InstallDataTrigger(t);

        const prevMultiData = previous?.ResolveMultiDataTriggers() ?? [];
        const nextMultiData = desired?.ResolveMultiDataTriggers()  ?? [];
        const prevMultiDataSet = new Set(prevMultiData);
        const nextMultiDataSet = new Set(nextMultiData);
        for (const t of prevMultiData) if (!nextMultiDataSet.has(t)) host.UninstallTrigger(t);
        for (const t of nextMultiData) if (!prevMultiDataSet.has(t)) host.InstallMultiDataTrigger(t);

        const prevEvt = previous?.ResolveEventTriggers() ?? [];
        const nextEvt = desired?.ResolveEventTriggers()  ?? [];
        const prevEvtSet = new Set(prevEvt);
        const nextEvtSet = new Set(nextEvt);
        for (const t of prevEvt) if (!nextEvtSet.has(t)) host.UninstallEventTrigger(t);
        for (const t of nextEvt) if (!prevEvtSet.has(t)) host.InstallEventTrigger(t);

        // TargetType-mismatch guard. Validates that the target Visual
        // is an instance of the Style's declared TargetType — applying
        // a `Style[TargetType=Foo]` to a non-Foo throws.
        if (desired !== undefined
            && !(this._target instanceof (desired.TargetType as ElementCtor)))
        {
            const actual = (this._target as Element).constructor.name;
            throw new Error(
                `Style.TargetType '${desired.TargetType.name}' does not match target '${actual}'.`,
            );
        }
    }

    /** Apply a single setter at the requested priority tier. Handles
     *  all three Setter.value shapes:
     *    * SetterFactory<T>  — invoked with the target to produce the
     *                          actual value, recursively normalized.
     *    * Binding           — installed reactively; the binding's
     *                          current value is pushed to the tier and
     *                          a change subscription keeps it updated.
     *                          Stashed in the per-tier binding map for
     *                          later disposal. TwoWay /
     *                          OneWayToSource bindings also install
     *                          a writeback listener tracked via the
     *                          per-tier writeback map.
     *    * any other value   — pushed to the tier directly. */
    public ApplySetter(setter: Setter, tier: SetterTier): void
    {
        const descriptor = resolveSetterDescriptor(setter);
        if (descriptor === undefined) return;
        const target = this._target;
        const evd = (target as unknown as EnsureEvdHost).ensure_effective_value_for(descriptor);

        let value: unknown = setter.value;
        if (value instanceof SetterFactory)
        {
            value = (value as SetterFactory).create(target);
        }

        if (value instanceof Binding)
        {
            const binding = value;
            // Resolve TwoWay default upfront — Binding's mode defaults
            // to OneWay until the EVD's metadata says BindsTwoWayByDefault,
            // and we need to know the effective mode RIGHT NOW to decide
            // whether to wire the target → source writeback. The
            // descriptor's metadata is the same one the EVD's set value
            // path consults; resolving here keeps both paths consistent.
            binding.ResolveDefaultMode(descriptor);

            // Source → target push. SetStyleValue / SetTriggerValue land
            // the value in the requested tier and fire OnPropertyChange
            // when the effective value changes. The suppression flag
            // below cooperates with the target listener: source-driven
            // pushes must NOT loop back as target writes.
            let suppressTargetListener = false;
            const push = (v: any): void => {
                suppressTargetListener = true;
                try
                {
                    if (tier === SetterTier.Style) evd.SetStyleValue(v);
                    else                  evd.SetTriggerValue(setter, v);
                }
                finally
                {
                    suppressTargetListener = false;
                }
            };
            push(binding.get_value());
            binding.setOnValueChanged((_old, newRaw) => {
                push(binding.apply_transform(newRaw));
            });

            // Target → source writeback (TwoWay / OneWayToSource only).
            // Without this branch, a Style-installed binding behaves as
            // OneWay regardless of mode: writes on the target (a user's
            // drag on Figure.X, a TextBox typing into its bound VM
            // property) update the local slot but never reach the source,
            // and the next source-driven push (triggered by any layout-
            // affecting change) snaps the target back to the original
            // source value.
            //
            // We listen on the EVD for effective-value changes and route
            // them through binding.set_value, which the DataContextBinding
            // override translates into a write on the underlying VM
            // property. Suppression keeps the source-driven push above
            // from being interpreted as a target-driven write and looping.
            const writebackEnabled = binding.mode === BindingMode.TwoWay
                                  || binding.mode === BindingMode.OneWayToSource;
            let targetSub: Disposable | undefined;
            if (writebackEnabled)
            {
                targetSub = evd.ChangedSignal().subscribe(({ newValue }): void => {
                    if (suppressTargetListener) return;
                    binding.set_value(newValue);
                });
            }

            const bindings = tier === SetterTier.Style
                ? (this._styleSetterBindings   ??= new Map())
                : (this._triggerSetterBindings ??= new Map());
            bindings.set(setter, binding);
            // Writeback metadata in a per-tier Map<Setter, …> (§ 1.4
            // fix). The previous design hung this off the Binding via a
            // Symbol-keyed slot, which silently clobbered when the same
            // Setter's Binding was reused across tiers. Per-tier keying
            // makes the per-tier storage explicit.
            if (targetSub !== undefined)
            {
                const writeback = tier === SetterTier.Style
                    ? (this._styleSetterWriteback   ??= new Map())
                    : (this._triggerSetterWriteback ??= new Map());
                writeback.set(setter, { sub: targetSub });
            }
        }
        else
        {
            if (tier === SetterTier.Style) evd.SetStyleValue(value);
            else                  evd.SetTriggerValue(setter, value);
        }
    }

    /** Undo `ApplySetter` — clear the tier on the target EVD,
     *  dispose the per-target binding if one was installed, drop the
     *  bookkeeping entry. Critical ordering: the TwoWay writeback
     *  listener is detached BEFORE the tier slot is cleared —
     *  otherwise the slot-clear's OnPropertyChange pulse fires
     *  through the still-attached listener and pushes the
     *  fall-through value (typically the descriptor's default) back
     *  to the source VM, destroying genuine VM state on every Style
     *  swap / container teardown. */
    public UnapplySetter(setter: Setter, tier: SetterTier): void
    {
        const descriptor = resolveSetterDescriptor(setter);
        if (descriptor === undefined) return;
        const target = this._target;
        const key = descriptor.ComposedKey;
        const evd = propertyValues(target).get(key);
        const bindings  = tier === SetterTier.Style ? this._styleSetterBindings   : this._triggerSetterBindings;
        const writeback = tier === SetterTier.Style ? this._styleSetterWriteback  : this._triggerSetterWriteback;
        const binding = bindings?.get(setter);
        if (binding !== undefined)
        {
            const wb = writeback?.get(setter);
            if (wb !== undefined)
            {
                wb.sub.dispose();
                writeback?.delete(setter);
            }
        }
        if (evd !== undefined)
        {
            if (tier === SetterTier.Style) evd.ClearStyleValue();
            else                  evd.ClearTriggerValue(setter);
        }
        if (binding !== undefined)
        {
            binding.setOnValueChanged(undefined);
            binding.dispose();
            bindings?.delete(setter);
        }
    }
}
