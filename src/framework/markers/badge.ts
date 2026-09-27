import { MetaData, MuralBase, Element } from '../../runtime/index.js';
import { Control } from '../base/control.js';

// M3 Badge — small visual flag, either a 6dp dot (no count) or a pill
// carrying a numeric label.
//
// Two variants per the M3 spec, picked by the Variant DP:
//   * Dot      — 6 × 6 dp filled circle, no label. Used to signal
//                "something new here" without a count.
//   * Numeric  — pill that grows to fit Count's label. Counts ≥ 100
//                conventionally cap to "99+" but the cap is the
//                consumer's call — Badge just renders whatever Count
//                gets passed in (or an explicit Label string).
//
// Badge is standalone — it doesn't anchor itself onto a target Visual.
// Consumers position it on top of an anchor (typically inside an
// AdornerLayer or a Canvas). Keeps the control's surface simple and
// avoids hard-wiring a positioning policy that doesn't fit every
// host.
export enum BadgeVariant
{
    Dot     = 'Dot',
    Numeric = 'Numeric',
}

export class Badge extends Control
{
    public static readonly VariantKey = MuralBase.RegisterProperty<BadgeVariant>(
        Badge, 'Variant', BadgeVariant.Numeric,
        MetaData.Render);

    // The numeric value displayed by the Numeric variant. Ignored by
    // the Dot variant. Defaulted to 0; the consumer's UI typically
    // hides the badge entirely when Count = 0 (mural doesn't enforce
    // that policy — see the class doc comment).
    public static readonly CountKey = MuralBase.RegisterProperty<number>(
        Badge, 'Count', 0, MetaData.Render);

    public get Variant(): BadgeVariant { return this.get_property_value(Badge.VariantKey); }
    public set Variant(v: BadgeVariant) { this.set_property_value(Badge.VariantKey, v); }

    public get Count(): number { return this.get_property_value(Badge.CountKey); }
    public set Count(v: number) { this.set_property_value(Badge.CountKey, v); }

    constructor()
    {
        super();
        // Resolve + apply the default Style so the PART_Dot / PART_Pill
        // template materializes for a standalone/unmounted Badge (a
        // tree-mounted one would eventually pick it up via AttachLogical,
        // but a bare `new Badge()` — e.g. under a headless render harness —
        // would otherwise carry Template = undefined and paint nothing).
        // Every other templated control in this codebase (its sibling
        // Divider included, right below) makes this call per Control's own
        // subclass contract (basic/control.ts); Badge had been missing it.
        this.applyDefaultStyle();
    }

    static
    {
        MuralBase.OverrideMetadata(
            Badge, Element.DefaultStyleKeyKey,
            { default_value: Badge });
    }
}
