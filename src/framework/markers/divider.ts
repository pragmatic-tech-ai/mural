import { MetaData, MuralBase, Element } from '../../runtime/index.js';
import { TemplatedControl } from '../../basic/templated-control.js';
import { Orientation } from '../../basic/panels/orientation.js';

// M3 Divider — 1dp rule that separates sibling content along either
// the horizontal or vertical axis.
//
// Promoted from the historical `Border[BorderThickness=(0,0,0,1),
// Fill=@OutlineVariant]` pattern (called out in
// docs/m3-modernization-plan.md A.4) so consumers get a proper
// control + a named token surface for the inset / colour. Reading
// down from TemplatedControl (not ContentControl) because the Divider
// projects a ControlTemplate but hosts no slotted Content; it paints a
// flat rule and that's it. (Control alone has no template-instance
// machinery, so a Divider based on it never materializes its rule.)
//
// Orientation = Horizontal (default) draws a 1dp tall rule that
// stretches across the parent's width; Vertical draws a 1dp wide
// rule that stretches across the parent's height.
export class Divider extends TemplatedControl
{
    public static readonly OrientationKey = MuralBase.RegisterProperty<Orientation>(
        Divider, 'Orientation', Orientation.Horizontal,
        MetaData.Measure | MetaData.Render);

    public get Orientation(): Orientation { return this.get_property_value(Divider.OrientationKey); }
    public set Orientation(v: Orientation) { this.set_property_value(Divider.OrientationKey, v); }

    constructor()
    {
        super();
        // Resolve + apply the default Style so the PART_Rule Border
        // template materializes (TemplatedControl measures/arranges it).
        this.applyDefaultStyle();
    }

    static
    {
        MuralBase.OverrideMetadata(
            Divider, Element.DefaultStyleKeyKey,
            { default_value: Divider });
    }
}
