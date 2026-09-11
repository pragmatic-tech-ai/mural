import { Binding } from './binding.js';
import { MetaData } from '../metadata.js';
import { MuralBase } from '../model.js';
import type { PropertyKey } from '../model.js';
import { resolveKey } from '../model-internals.js';
import type { Disposable } from '@pragmatic-tech-ai/todl-runtime';
import type { Visual } from '../../visual-engine/visual.js';

// Internal MuralBase that mirrors the templated parent's watched property.
// Same shape as DataContextWatcher / ResourceWatcher — a single Value
// slot that Binding's change-notification machinery rides on.
class TemplatedParentWatcher extends MuralBase
{
    public static readonly ValueKey = MuralBase.RegisterProperty<unknown>(
        TemplatedParentWatcher, 'Value', undefined, MetaData.None);

    public get Value(): unknown { return this.get_property_value(TemplatedParentWatcher.ValueKey); }
    public set Value(v: unknown) { this.set_property_value(TemplatedParentWatcher.ValueKey, v); }
}

// Binding that reads a single property off the templated parent of a
// ControlTemplate factory. Used to express the `$$Fill`-style
// markup-extension form: `_b.Fill = TemplateBinding(_templatedParent, 'Fill')`.
//
// Templated parent's property changes propagate to the binding via a
// property-changed listener installed at construction. Disposed when
// the binding is torn down (EVD does that automatically when a
// replacement binding lands or the property is cleared).
//
// v0 scope: single property name only. Dotted paths (`$$Content.Name`)
// are not supported — control templates rarely need them, and the
// dotted form is more naturally a chained Binding inside a DataTemplate.
class TemplateBindingImpl extends Binding
{
    private readonly watcher:         TemplatedParentWatcher;
    private readonly templatedParent: Visual;
    private readonly callback:        () => void;
    private subscription:             Disposable | undefined;
    // Resolved once at construction; used to install the change-channel
    // subscription and (via set_value) to write back to the templated parent.
    private readonly key:             PropertyKey<unknown>;

    constructor(templatedParent: Visual, property: string)
    {
        const watcher = new TemplatedParentWatcher();
        // Mode is left unset so the EVD's ResolveDefaultMode hook upgrades it
        // to TwoWay when the target DP declares BindsTwoWayByDefault (an
        // editable template field — SpinEdit.Value, TextBox.Text,
        // ComboBox.SelectedItem, Switch.IsChecked). For an ordinary display DP
        // it stays OneWay. Same policy as DataContextBinding's `$`; without it
        // an editable `$$` field is display-only and its edits never reach the
        // templated parent.
        super(watcher, 'Value');
        this.watcher         = watcher;
        this.templatedParent = templatedParent;
        this.key             = resolveKey(templatedParent, undefined, property);

        this.callback = () =>
        {
            this.watcher.Value = templatedParent.get_property_value(this.key);
        };
        this.subscription = templatedParent.PropertyChanged(this.key).subscribe(this.callback);
        this.watcher.Value = templatedParent.get_property_value(this.key);
    }

    public override dispose(): void
    {
        super.dispose();
        this.subscription?.dispose();
        this.subscription = undefined;
    }

    // TwoWay writeback: when the target DP changes and the EVD asks the binding
    // to push back, write the value onto the templated parent's property so the
    // control's own DP actually updates. Without this the base Binding writes
    // only the internal `watcher.Value` slot and the templated parent never
    // sees the edit. Mirrors DataContextBinding.set_value. The base call is
    // gated on mode (TwoWay / OneWayToSource) — a OneWay `$$` returns false
    // here and no writeback happens, so display bindings are untouched.
    public override set_value(value: unknown): boolean
    {
        if (!super.set_value(value)) return false;
        this.templatedParent.set_property_value(this.key, this.applyConvertBack(value));
        return true;
    }
}

// Public factory — matches the DynamicResource / DataContextBinding
// shape so the compiler emits all three uniformly.
//
// Usage from a ControlTemplate factory body:
//   const border = new Border();
//   border.set_property_value(Border.FillKey,
//       TemplateBinding(templatedParent, 'Fill'));
export function TemplateBinding(templatedParent: Visual, property: string): Binding
{
    return new TemplateBindingImpl(templatedParent, property);
}
