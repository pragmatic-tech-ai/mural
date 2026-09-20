import { MuralBase, Element, Visual } from '../../runtime/index.js';
import { ToggleButton } from '../buttons/toggle-button.js';

// M3 Checkbox — 18 × 18 dp square toggle.
//
// Descends from ToggleButton so IsChecked + the click-flip protocol
// ride for free; the default ControlTemplate (framework.resources.mu,
// `DefaultCheckbox`) draws the box + checkmark glyph and reacts to
// IsChecked via standard `when()` triggers.
//
// Tri-state (checked / unchecked / indeterminate) is intentionally
// out of scope for this pass — the M3 indeterminate glyph (a horizontal
// dash) needs a third DP value, which means breaking IsChecked's
// boolean type or layering a separate IsIndeterminate DP. Both are
// reasonable, both can land later without API churn here.
export class Checkbox extends ToggleButton
{
    static
    {
        MuralBase.OverrideMetadata(
            Checkbox, Element.DefaultStyleKeyKey,
            { default_value: Checkbox });
        // 18 × 18 dp default size — M3 spec for the checkable square.
        // Overrides Visual's NaN default so an in-flow Checkbox ships
        // sized without every consumer having to set Width / Height.
        MuralBase.OverrideMetadata(Checkbox, Visual.WidthKey,  { default_value: 18 });
        MuralBase.OverrideMetadata(Checkbox, Visual.HeightKey, { default_value: 18 });
    }
}
