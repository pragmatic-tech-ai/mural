import { MetaData, MuralBase, Element, Visual } from '../../runtime/index.js';
import { ContentControl } from '../base/content-control.js';

// M3 Banner — in-flow alert / message strip with a leading icon and an
// optional trailing action row.
//
// Banner is NOT modal. It lives in the document flow (typically docked
// at the top of a feed or settings list), unlike Snackbar (transient
// overlay at the bottom) and Dialog (modal blocker). Mural's existing
// surfaces — TopAppBar's NavigationIcon slot, Snackbar's leading
// status icon — show the same shape; Banner is just the in-flow
// take where the icon + text + actions live together.
//
// Slots:
//   * Leading — DP carrying a Visual into the leading icon slot
//     (typically a 24dp status icon).
//   * Content — inherited from ContentControl; carries the headline
//     + supporting text payload.
//   * Actions — slot for a horizontal stack of action Buttons,
//     anchored on the trailing edge.
//
// Variant is intentionally narrow — M3 spec describes only the
// "neutral" Banner; tone is communicated through the consumer's
// chosen icon + colour palette, not through a Variant DP.
export class Banner extends ContentControl
{
    public static readonly LeadingKey = MuralBase.RegisterProperty<Visual | undefined>(
        Banner, 'Leading', undefined, MetaData.Render);
    public static readonly ActionsKey = MuralBase.RegisterProperty<Visual | undefined>(
        Banner, 'Actions', undefined, MetaData.Render);

    public get Leading(): Visual | undefined { return this.get_property_value(Banner.LeadingKey); }
    public set Leading(v: Visual | undefined) { this.set_property_value(Banner.LeadingKey, v); }

    public get Actions(): Visual | undefined { return this.get_property_value(Banner.ActionsKey); }
    public set Actions(v: Visual | undefined) { this.set_property_value(Banner.ActionsKey, v); }

    static
    {
        MuralBase.OverrideMetadata(
            Banner, Element.DefaultStyleKeyKey,
            { default_value: Banner });
    }
}
