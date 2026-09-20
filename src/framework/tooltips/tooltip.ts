import { MetaData, Element } from '../../runtime/index.js';
import { MuralBase } from '../../runtime/model.js';
import { ContentControl } from '../base/content-control.js';

// M3 Tooltip — short overlay surface describing an interactive element.
//
// A Tooltip is a plain ContentControl. The Content DP holds whatever the
// consumer wants to show — a string is auto-wrapped by ContentPresenter
// in a TextBlock; a VM is resolved through the resource chain's matching
// DataTemplate; a Visual is slotted directly. The chrome (Border +
// padding + inverse-surface ink) lives in the default Style.
//
// The Tooltip itself doesn't manage hover, timing, positioning, or
// overlay mount — that's `ToolTipService` (see tooltip-service.ts). The
// service owns a single pooled Tooltip instance whose Content DP is
// updated on every show. Consumers who want re-templated chrome supply
// their own `Style[TargetType=Tooltip]` in their resource chain — the
// pooled instance picks it up like any other styled Visual.
//
// Authoring shape — declarative (recommended):
//
//   Button [ToolTipService.ToolTip = "Save (Ctrl+S)"]{ … }
//   Button [ToolTipService.ToolTip = $SaveCommandVM,
//           ToolTipService.ToolTipPlacement = Right]{ … }
//
// The string lands on the pooled Tooltip's Content, ContentPresenter
// wraps it in a TextBlock. The VM lands on Content; ContentPresenter
// finds the DataTemplate matching its constructor and applies it.
export class Tooltip extends ContentControl
{
    // Shortcut text displayed under the main Content. Populated by
    // `ToolTipService` after a show when the anchor's Command (a
    // CommandBase) has a matching KeyBinding in its visual tree —
    // resolved via `CommandManager.FindShortcutForCommand(cmd, anchor)`.
    // Empty by default; the default template hides the row when empty.
    public static readonly ShortcutKey = MuralBase.RegisterProperty<string>(
        Tooltip, 'Shortcut', '', MetaData.Measure | MetaData.Render);

    public get Shortcut():  string  { return this.get_property_value(Tooltip.ShortcutKey); }
    public set Shortcut(v:  string) { this.set_property_value(Tooltip.ShortcutKey, v); }

    static
    {
        // Theme-style lookup key — Tooltip instances resolve their
        // default Style via TryFindResource(Tooltip) on attach.
        MuralBase.OverrideMetadata(
            Tooltip, Element.DefaultStyleKeyKey,
            { default_value: Tooltip });
    }

    constructor()
    {
        super();
        this.applyDefaultStyle();
    }
}
