import { MetaData, MuralBase, Element, Visual } from '../../runtime/index.js';
import { ToggleButton } from '../buttons/toggle-button.js';

// M3 Switch — a binary toggle styled as a track with a sliding thumb.
//
// Descends from ToggleButton so the IsChecked semantics (click flips,
// programmatic assignment stays silent toward Click handlers, post-flip
// state visible inside Command / OnClick) ride for free. The Switch-
// specific surface is purely visual — the chrome lives in the default
// ControlTemplate (basic.resources.mu, `DefaultSwitch`) which uses an
// IsChecked trigger to swap the thumb's Margin between "off" (anchored
// left) and "on" (anchored right). The implicit-transition engine
// running on Visual handles the slide animation because the Margin DP
// carries a Thickness value and Thickness is one of the types the
// engine knows how to interpolate.
//
// Class is named `Switch` to dodge JavaScript's `switch` keyword
// — both the import barrel and consumer markup reference it as `Switch`
// both spell it `Switch`.
export class Switch extends ToggleButton
{
    static
    {
        MuralBase.OverrideMetadata(
            Switch, Element.DefaultStyleKeyKey,
            { default_value: Switch });
    }

    // Switch's `Width` / `Height` defaults override Visual's NaN so an in-flow
    // Switch ships sized without every consumer having to size it. These are the
    // M3-spec 52 × 32 dp scaled to 70% (30% smaller), matching the track/thumb
    // sizes in the default template. The default Style still passes through
    // unchanged, and an explicit Width / Height on the Switch overrides these
    // defaults via the LocalValue tier (above Default in the EVD precedence
    // ladder).
    static
    {
        MuralBase.OverrideMetadata(Switch, Visual.WidthKey,  { default_value: 36.4 });
        MuralBase.OverrideMetadata(Switch, Visual.HeightKey, { default_value: 22.4 });
    }
}

// Suppress the unused-import warning. MetaData is re-exported for any
// future Switch-owned DPs (none today — IsChecked lives on the
// ToggleButton base) and keeping the import keeps the module's bundle
// shape stable across additions.
void MetaData;
