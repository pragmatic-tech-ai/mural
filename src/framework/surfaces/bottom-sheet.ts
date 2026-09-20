import { MetaData, MuralBase, Element } from '../../runtime/index.js';
import { ContentControl } from '../base/content-control.js';

// M3 Bottom Sheet — surface that rises from the bottom edge, used to
// expose secondary content or a confirmation flow.
//
// M3 has two variants:
//   * Standard — coexists with content (the page underneath stays
//                interactive while the sheet sits at its docked
//                position). Same shape as Drawer.Persistent.
//   * Modal    — overlays a scrim that absorbs outside clicks. Same
//                shape as Drawer.Temporary.
//
// Mural's existing Drawer chrome carries both behaviours along its
// own Variant axis. BottomSheet is shipped as a parallel control
// because the M3 spec treats it as a distinct surface (different
// affordance, different placement convention) — but the
// implementation could be folded into Drawer as a future `Anchor =
// Bottom` value if the shapes converge. Documented as a known
// parallel rather than a separate code path.
//
// Slots — Content (inherited from ContentControl) for the sheet body;
// no Title / Actions DPs because the M3 spec leaves the sheet's
// internal layout entirely up to the consumer.
export class BottomSheet extends ContentControl
{
    static
    {
        MuralBase.OverrideMetadata(
            BottomSheet, Element.DefaultStyleKeyKey,
            { default_value: BottomSheet });
    }
}

void MetaData;
