import { MetaData, MuralBase, Element, Visual } from '../../runtime/index.js';
import { ContentControl } from '../base/content-control.js';

// M3 Snackbar — transient single-line message that floats at the
// bottom of the surface for a few seconds.
//
// mural ships the chrome here. The transient-mount-on-overlay
// behaviour (4-6 second auto-dismiss, queue handling, action button's
// "Undo" click that gets exposed to the consumer) is a follow-up
// Behaviour that walks the same OverlayLayer the existing Drawer's
// Temporary variant uses. Until that wiring lands, a consumer can
// open the snackbar manually:
//
//   const sb = new Snackbar();
//   sb.Content = new TextBlock('Saved');
//   target.OverlayLayer.AddChild(sb);
//   setTimeout(() => target.OverlayLayer.RemoveChild(sb), 4000);
//
// Slots — Content (inherited from ContentControl) for the message
// text, Actions for the trailing action row (typically a Text Button
// per M3 spec).
export class Snackbar extends ContentControl
{
    public static readonly ActionsKey = MuralBase.RegisterProperty<Visual | undefined>(
        Snackbar, 'Actions', undefined, MetaData.Render);

    public get Actions(): Visual | undefined { return this.get_property_value(Snackbar.ActionsKey); }
    public set Actions(v: Visual | undefined) { this.set_property_value(Snackbar.ActionsKey, v); }

    static
    {
        MuralBase.OverrideMetadata(
            Snackbar, Element.DefaultStyleKeyKey,
            { default_value: Snackbar });
    }
}
