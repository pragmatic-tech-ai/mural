import type { MetaData } from './metadata.js';
import type { MuralBase } from './model.js';

// Invoked to coerce a property's base value into its allowed range,
// returning the value that becomes the coerced entry.
export type CoerceValue = (model: MuralBase, base_value: any) => any;

// Invoked to gate a write at the property boundary. `true` accepts the
// value; `false` rejects it and the set throws. Runs BEFORE coerce on
// every set and on default-value registration — a default the rule
// rejects is a registration-time error. Mirrors WPF's
// ValidateValueCallback (PropertyMetadata.PropertyChangedCallback's
// companion).
export type ValidateValue = (value: any) => boolean;

// Invoked when an attached property is set on a MuralBase whose constructor
// chain doesn't reach the property's registering class. Returns `true`
// if the target is allowed; `false` rejects and the set throws with a
// "property only valid on …" message. Use the `validateTargetTypes`
// helper to construct the common "instance of one of these classes"
// predicate. Optional — descriptors without a validate_target accept
// any MuralBase (the existing behavior pre-§ 15.1).
export type ValidateTarget = (target: MuralBase) => boolean;

// Declares that a dependency property's value is backed by an application
// setting. `key` identifies the setting (e.g. 'editor.fontSize'); the
// optional `convert` callback coerces the raw stored value into the
// property's expected type. Consumed by the PropertyValueSource.SettingValue
// tier (added in a later task); recording the annotation here is a
// purely additive data-model change.
export interface SettingValue
{
    key: string;
    convert?: (raw: unknown) => unknown;
}

// Per-class metadata options. Root registrations must supply default_value
// and meta_data; overrides may omit any field, in which case reads fall
// through to the parent descriptor's value (WPF-style metadata merge).
export interface PropertyMetadata
{
    default_value?: any;
    meta_data?: MetaData;
    coerce_value?: CoerceValue;
    validate_value?: ValidateValue;
    validate_target?: ValidateTarget;
    setting_value?: SettingValue;
}

// Class-level schema entry for a registered property. One descriptor per
// (class, property) pair; subclasses can chain a descriptor with a parent
// reference via MuralBase.OverrideMetadata so unspecified fields fall through.
//
// `propertyClass` is the class this particular descriptor is filed under
// (the class passed to RegisterProperty or OverrideMetadata). `RootOwner`
// walks the override chain to find the class that originally registered
// the property — that's the one used to compose the per-instance storage
// key, so overrides don't accidentally change a property's identity.
export class PropertyDescriptor
{
    private propertyClass: Function;
    private name: string;
    private own: PropertyMetadata;
    private parent_descriptor: PropertyDescriptor | undefined;
    private readOnly: boolean;
    // Memoised per-instance storage key `${RootOwner.name}.${name}`. Computed
    // once (RootOwner + name never change after construction) so the hot
    // get/set/clear paths stop re-allocating the composite string every access.
    private composedKey: string | undefined;

    constructor(
        owner: Function,
        name: string,
        own: PropertyMetadata,
        parent_descriptor?: PropertyDescriptor,
        readOnly: boolean = false,
    )
    {
        this.propertyClass = owner;
        this.name = name;
        this.own = own;
        this.parent_descriptor = parent_descriptor;
        this.readOnly = readOnly;
    }

    // Read-only-ness lives on the root descriptor — OverrideMetadata
    // can change metadata fields but not access semantics. Walking the
    // parent chain ensures override descriptors inherit the root's flag.
    public get IsReadOnly(): boolean
    {
        return this.parent_descriptor !== undefined
            ? this.parent_descriptor.IsReadOnly
            : this.readOnly;
    }

    public get Owner(): Function
    {
        return this.propertyClass;
    }

    // The class that originally registered this property (walks past any
    // metadata-override descriptors). Used as the canonical identity for
    // composing the per-instance storage key.
    public get RootOwner(): Function
    {
        return this.parent_descriptor?.RootOwner ?? this.propertyClass;
    }

    public get Name(): string
    {
        return this.name;
    }

    // The per-instance storage key `${RootOwner.name}.${name}` — identical to
    // `MuralBase.compose_key(descriptor.RootOwner, descriptor.Name)` but computed
    // once and cached. RootOwner and name are fixed at construction, so this is
    // safe to memoise; it removes a template-string allocation from every DP
    // read/write (a top CPU hotspot in the render walk).
    public get ComposedKey(): string
    {
        return (this.composedKey ??= `${this.RootOwner.name}.${this.name}`);
    }

    public get DefaultValue(): any
    {
        if ('default_value' in this.own) return this.own.default_value;
        return this.parent_descriptor?.DefaultValue;
    }

    public get MetaData(): MetaData
    {
        if ('meta_data' in this.own) return this.own.meta_data!;
        return this.parent_descriptor!.MetaData;
    }

    public get CoerceValue(): CoerceValue | undefined
    {
        if ('coerce_value' in this.own) return this.own.coerce_value;
        return this.parent_descriptor?.CoerceValue;
    }

    public get ValidateValue(): ValidateValue | undefined
    {
        if ('validate_value' in this.own) return this.own.validate_value;
        return this.parent_descriptor?.ValidateValue;
    }

    public get ValidateTarget(): ValidateTarget | undefined
    {
        if ('validate_target' in this.own) return this.own.validate_target;
        return this.parent_descriptor?.ValidateTarget;
    }

    public get SettingValue(): SettingValue | undefined
    {
        if ('setting_value' in this.own) return this.own.setting_value;
        return this.parent_descriptor?.SettingValue;
    }
}

// Common predicate factory: accept only targets that are instances of
// one of the supplied classes (or any of their subclasses, since
// `instanceof` walks the prototype chain). Useful for restricting
// attached properties to families of Visuals — e.g.,
// `Grid.SetRow(visual, n)` should only accept `Visual` (not raw MuralBase).
export function validateTargetTypes(
    ...classes: readonly Function[]
): ValidateTarget
{
    if (classes.length === 0)
    {
        // Defensive — a caller passing no classes presumably meant
        // "accept everything", which is the same as omitting
        // validate_target entirely. Returning a tautology rather than
        // throwing keeps the registration site forgiving.
        return _ => true;
    }
    return (target: MuralBase): boolean =>
    {
        for (const c of classes)
        {
            if (target instanceof (c as new (...args: any[]) => MuralBase)) return true;
        }
        return false;
    };
}
