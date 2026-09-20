import { MetaData, MuralBase, Element } from '../../runtime/index.js';
import { ContentControl } from '../base/content-control.js';
import { DialogAction } from './dialog-action.js';

// M3 Dialog — modal surface with title + content + actions, anchored
// over a scrim that absorbs outside clicks.
//
// mural ships the surface DPs here. The modal-mount behaviour (open
// onto the PresentationTarget's OverlayLayer with the scrim Below,
// trap focus inside the dialog until close, run Cancel-on-Escape)
// follows the Drawer Temporary variant pattern — Drawer's OverlayHost
// + ScrimSurface are already in src/framework/drawer.ts; Dialog
// reuses the same overlay infrastructure once the wiring lands as a
// follow-up Behaviour or class-level method.
//
// API parity with WPF's MessageDialog: open via a static `Show()`
// (not added here) that returns a Promise of the user's chosen
// action; consumer-supplied actions surface back through the action
// button's Command / ClickHandler bound at the consumer site.
//
// Slots — Title (string DP for the headline), Content (inherited
// from ContentControl) for the body, Actions for the trailing action
// row: an array of DialogAction view-models the template's ItemsControl
// stamps into Buttons (one per action) via its DataTemplate.
export class Dialog extends ContentControl
{
    public static readonly TitleKey = MuralBase.RegisterProperty<string>(
        Dialog, 'Title', '', MetaData.Render);
    public static readonly ActionsKey = MuralBase.RegisterProperty<readonly DialogAction[] | undefined>(
        Dialog, 'Actions', undefined, MetaData.Render);

    public get Title(): string { return this.get_property_value(Dialog.TitleKey); }
    public set Title(v: string) { this.set_property_value(Dialog.TitleKey, v); }

    public get Actions(): readonly DialogAction[] | undefined { return this.get_property_value(Dialog.ActionsKey); }
    public set Actions(v: readonly DialogAction[] | undefined) { this.set_property_value(Dialog.ActionsKey, v); }

    constructor()
    {
        super();
        // Eagerly resolve the default Style (DefaultDialog template) — the
        // convention for templated controls (Element.applyDefaultStyle), so a
        // standalone Dialog (e.g. DialogService's `new Dialog()`, or a test) has
        // its chrome + Actions ItemsControl before it's tree-mounted.
        this.applyDefaultStyle();
    }

    static
    {
        MuralBase.OverrideMetadata(
            Dialog, Element.DefaultStyleKeyKey,
            { default_value: Dialog });
    }
}
