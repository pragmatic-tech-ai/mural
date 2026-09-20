import {
    MetaData,
    MuralBase,
    Element, Visual,
    type PropertyDescriptor,
} from '../../runtime/index.js';
import { ToggleButton } from '../buttons/toggle-button.js';

// M3 RadioButton — 20 × 20 dp circular toggle, mutually exclusive
// across siblings sharing the same `GroupName`.
//
// Descends from ToggleButton so IsChecked + the click-flip protocol
// ride for free. The mutual-exclusivity contract is enforced here:
// when this RadioButton's IsChecked flips to `true`, the
// OnPropertyChanged override walks the visual tree (rooted at the
// nearest ancestor that has no visual parent) and clears any sibling
// RadioButton with a matching non-empty `GroupName`. Empty GroupName
// disables the exclusivity (the radio behaves as a plain toggle).
//
// Visual-tree walk rather than a static `Map<group, Set<radio>>`:
//   * No process-wide global state — multiple Application instances
//     (e.g. concurrent test fixtures) don't share a group namespace.
//   * No reference-leak risk — detached RadioButtons fall out of the
//     walk naturally because they're not reachable from the root.
//   * Cost is one O(tree-size) walk per IsChecked → true edge, which
//     is fine for typical form UI (dozens of radios). High-density
//     UIs that flip radios in tight loops would notice; the static-
//     map cache can be layered in later if it's ever the bottleneck.
//
// The chrome lives in framework.resources.mu (DefaultRadioButton):
// outer ring + inner dot, both flipping palette on IsChecked.
export class RadioButton extends ToggleButton
{
    // GroupName scopes mutual exclusion. Empty (default) = no group =
    // the radio behaves as an independent toggle. Non-empty string =
    // any sibling RadioButton anywhere in the visual subtree with a
    // matching GroupName mutually excludes when this one is checked.
    public static readonly GroupNameKey = MuralBase.RegisterProperty<string>(
        RadioButton, 'GroupName', '', MetaData.None);

    public get GroupName(): string { return this.get_property_value(RadioButton.GroupNameKey); }
    public set GroupName(v: string) { this.set_property_value(RadioButton.GroupNameKey, v); }

    static
    {
        MuralBase.OverrideMetadata(
            RadioButton, Element.DefaultStyleKeyKey,
            { default_value: RadioButton });
        // 20 × 20 dp default — M3 spec for the radio target.
        MuralBase.OverrideMetadata(RadioButton, Visual.WidthKey,  { default_value: 20 });
        MuralBase.OverrideMetadata(RadioButton, Visual.HeightKey, { default_value: 20 });
    }

    // Re-entry guard — the broadcast loop sets siblings' IsChecked to
    // false, which fires their own OnPropertyChanged, which would
    // otherwise re-broadcast a no-op clear pass. The flag short-
    // circuits any IsChecked write that's already part of an in-flight
    // group sync.
    private _suppressGroupSync = false;

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue:   unknown,
        newValue:   unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (this._suppressGroupSync) return;
        if (descriptor.Name !== 'IsChecked') return;
        if (newValue !== true) return;
        const group = this.GroupName;
        if (group === '') return;
        // Find the root of the visual tree this radio sits in — that's
        // the ancestor whose visualParent is undefined. Walking down
        // from there reaches every sibling RadioButton in the same
        // logical surface (an Application's root, a Window, a popup
        // host) without crossing into a sibling Window's subtree.
        let root: Visual = this;
        while (true)
        {
            const parent = root.GetVisualParent();
            if (parent === undefined) break;
            root = parent;
        }
        this._suppressGroupSync = true;
        try
        {
            RadioButton.clearGroupSiblings(root, this, group);
        }
        finally
        {
            this._suppressGroupSync = false;
        }
    }

    // Depth-first walk: any RadioButton with a matching GroupName that
    // isn't `self` gets cleared. Skips the recursion into a matched
    // sibling's subtree because a sibling's children can't themselves
    // be selected radios in a coherent UI (a radio doesn't host more
    // radios in the same group).
    private static clearGroupSiblings(
        node: Visual, self: RadioButton, group: string,
    ): void
    {
        if (node instanceof RadioButton && node !== self && node.GroupName === group)
        {
            if (node.IsChecked)
            {
                // Mark the sibling's suppress flag so its own
                // OnPropertyChanged short-circuits — the clear here is
                // a direct EVD write, not the start of a fresh group
                // broadcast.
                const sib = node as RadioButton;
                sib._suppressGroupSync = true;
                try { sib.IsChecked = false; }
                finally { sib._suppressGroupSync = false; }
            }
            return;
        }
        // Walk visualChildren — `visualChildren` is the canonical view-
        // tree iterator and works uniformly for both template internals
        // and consumer-supplied content.
        for (const child of node.visualChildren)
        {
            RadioButton.clearGroupSiblings(child, self, group);
        }
    }
}
