import {
    MetaData,
    MuralBase,
    Element, Visual,
    type PropertyDescriptor,
} from '../../runtime/index.js';
import { Border } from '../../basic/border.js';
import { ToggleButton } from '../buttons/toggle-button.js';

// M3 Chip — small interactive surface for compact attribute, filter,
// input, or suggestion affordances.
//
// One control class with four variants — Assist / Filter / Input /
// Suggestion. Visually they share the same 32dp pill chrome; the
// per-variant behaviour shows up through state (Filter is the only
// toggleable variant in M3) and through which slots get populated
// (Input typically carries leading + trailing icons; Assist /
// Suggestion typically don't).
//
// Descends from ToggleButton so the click-flip protocol on IsChecked
// is available to the Filter variant for free. Assist / Input /
// Suggestion ignore IsChecked at the template level — the Variant
// trigger ladder ignores it — so toggle-flipping happens silently in
// the background. Consumers who care can read IsChecked back; consumers
// who don't are unaffected.
//
// Leading / Trailing slots mirror the list-row anatomy added in Phase
// 7: each is a plain Border in the template that the Chip class
// populates with the consumer's Visual via Border.SetChild. Empty
// slots collapse to zero size so the chip's natural width tracks the
// label width without padding artifacts.
export enum ChipVariant
{
    Assist     = 'Assist',
    Filter     = 'Filter',
    Input      = 'Input',
    Suggestion = 'Suggestion',
}

export class Chip extends ToggleButton
{
    // Chip class-level DP is named `Kind` (markup writes `Kind=Filter`)
    // rather than `Variant` to avoid a TypeScript type clash with
    // Button.Variant (typed ButtonVariant) which Chip inherits through
    // ToggleButton. Same shape semantically; the symbol-table routes
    // PROPERTY_TO_ENUM under `Kind` to ChipVariant so the markup form
    // `Kind=Filter` still resolves the bare ident against the enum.
    public static readonly KindKey = MuralBase.RegisterProperty<ChipVariant>(
        Chip, 'Kind', ChipVariant.Assist, MetaData.None);

    public static readonly LeadingKey = MuralBase.RegisterProperty<Visual | undefined>(
        Chip, 'Leading', undefined, MetaData.Render);
    public static readonly TrailingKey = MuralBase.RegisterProperty<Visual | undefined>(
        Chip, 'Trailing', undefined, MetaData.Render);

    // Derived state observed by the ControlTemplate filter trigger.
    // The trigger DSL only accepts single-term `when()` conditions in
    // a ControlTemplate (multi-term conjuncts work in Styles but not
    // here), so combining "Kind = Filter" AND "IsChecked" into a
    // template trigger requires a precomputed boolean. OnPropertyChanged
    // below keeps it in lock-step with Kind / IsChecked edges.
    private static readonly _IsFilterSelectedPriv = MuralBase.RegisterReadOnlyProperty<boolean>(
        Chip, 'IsFilterSelected', false, MetaData.None);
    public static readonly IsFilterSelectedKey = Chip._IsFilterSelectedPriv;

    public get IsFilterSelected(): boolean { return this.get_property_value(Chip.IsFilterSelectedKey); }

    public get Kind(): ChipVariant { return this.get_property_value(Chip.KindKey); }
    public set Kind(v: ChipVariant) { this.set_property_value(Chip.KindKey, v); }

    public get Leading(): Visual | undefined { return this.get_property_value(Chip.LeadingKey); }
    public set Leading(v: Visual | undefined) { this.set_property_value(Chip.LeadingKey, v); }

    public get Trailing(): Visual | undefined { return this.get_property_value(Chip.TrailingKey); }
    public set Trailing(v: Visual | undefined) { this.set_property_value(Chip.TrailingKey, v); }

    static
    {
        MuralBase.OverrideMetadata(
            Chip, Element.DefaultStyleKeyKey,
            { default_value: Chip });
    }

    private _leadingSlot:  Border | undefined;
    private _trailingSlot: Border | undefined;

    constructor()
    {
        super();
        this.applyDefaultStyle();
        this.adoptTemplateParts();
        this.syncSlots();
    }

    private adoptTemplateParts(): void
    {
        this._leadingSlot  = this.GetTemplateChild('PART_LeadingSlot')  as Border | undefined;
        this._trailingSlot = this.GetTemplateChild('PART_TrailingSlot') as Border | undefined;
    }

    private syncSlots(): void
    {
        this._leadingSlot?.SetChild(this.Leading);
        this._trailingSlot?.SetChild(this.Trailing);
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue:   unknown,
        newValue:   unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        const name = descriptor.Name;
        if (name === 'Template' && newValue !== oldValue)
        {
            this.adoptTemplateParts();
            this.syncSlots();
            return;
        }
        if (descriptor.Owner === Chip && name === 'Leading')
        {
            this._leadingSlot?.SetChild(newValue as Visual | undefined);
            return;
        }
        if (descriptor.Owner === Chip && name === 'Trailing')
        {
            this._trailingSlot?.SetChild(newValue as Visual | undefined);
            return;
        }
        // Recompute IsFilterSelected on every Kind / IsChecked edge —
        // either one can flip the derived flag.
        if ((descriptor.Owner === Chip && name === 'Kind')
         || name === 'IsChecked')
        {
            const next = this.Kind === ChipVariant.Filter && this.IsChecked;
            if (next !== this.IsFilterSelected)
            {
                this.set_property_value_with_key(Chip._IsFilterSelectedPriv, next);
            }
        }
    }
}
