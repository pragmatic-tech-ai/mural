import { Binding, BindingMode } from './binding.js';
import { MetaData } from '../metadata.js';
import { MuralBase } from '../model.js';
import { resolveKey } from '../model-internals.js';
import type { Disposable } from '@pragmatic-tech-ai/todl-runtime';
import type { Visual } from '../../visual-engine/visual.js';

// Internal watcher MuralBase — same shape as DataContextWatcher /
// TemplatedParentWatcher. Holds the resolved ancestor-property value
// in a single `Value` slot the outer Binding reads from.
class AncestorWatcher extends MuralBase
{
    public static readonly ValueKey = MuralBase.RegisterProperty<unknown>(
        AncestorWatcher, 'Value', undefined, MetaData.None);

    public get Value(): unknown { return this.get_property_value(AncestorWatcher.ValueKey); }
    public set Value(v: unknown) { this.set_property_value(AncestorWatcher.ValueKey, v); }
}

// Binding that walks the start Visual's visualParent chain to find the
// `level`-th ancestor that is an instance of `ancestorType`, then
// subscribes to one of its properties.
//
// Reactivity scope: the path mutation on the resolved ancestor pushes
// through. Re-parenting the start Visual (or any intermediate ancestor)
// does NOT trigger an ancestor re-resolve — the resolution is captured
// at construction time. This matches the common WPF use case where
// FindAncestor is used inside a ControlTemplate body where the
// templated-element hierarchy is set once at materialization. Callers
// that need re-parenting reactivity should dispose and recreate the
// binding on the relevant Loaded edge.
class AncestorBindingImpl extends Binding
{
    private readonly watcher:  AncestorWatcher;
    private readonly callback: (() => void) | undefined;
    private subscription:      Disposable | undefined;

    constructor(start: Visual, ancestorType: Function, property: string, level: number)
    {
        const watcher = new AncestorWatcher();
        super(watcher, 'Value', BindingMode.OneWay);
        this.watcher  = watcher;

        // Walk parents.
        let current: Visual | undefined = start.GetVisualParent();
        let remaining = level;
        let found: Visual | undefined;
        while (current !== undefined)
        {
            if (current instanceof ancestorType)
            {
                remaining--;
                if (remaining <= 0)
                {
                    found = current;
                    break;
                }
            }
            current = current.GetVisualParent();
        }

        if (found === undefined)
        {
            // No matching ancestor — watcher stays at undefined. Consumer
            // can rely on the outer Binding's fallbackValue.
            this.callback = undefined;
            return;
        }

        // Resolve the key once and seed the watcher with the current
        // value. Subscription installs against the same key the
        // dispose-time removal will use.
        const key = resolveKey(found, undefined, property);
        this.callback = () =>
        {
            this.watcher.Value = found.get_property_value(key);
        };
        this.subscription = found.PropertyChanged(key).subscribe(this.callback);
        this.watcher.Value = found.get_property_value(key);
    }

    public override dispose(): void
    {
        super.dispose();
        this.subscription?.dispose();
        this.subscription = undefined;
    }
}

// Public factory — mirrors WPF's `{Binding RelativeSource={RelativeSource
// FindAncestor, AncestorType=…, AncestorLevel=N}, Path=Property}`.
//
//   AncestorBinding(start, ListBox, 'SelectedItem')        // nearest ListBox
//   AncestorBinding(start, ItemsControl, 'ItemsSource', 2) // 2nd-nearest
//
// `level` defaults to 1 (nearest matching ancestor). Returns a Binding
// whose resolved value tracks the chosen property on the found
// ancestor. When no matching ancestor exists, the binding resolves to
// `undefined` and stays that way — `fallbackValue` on the outer
// Binding can fill in.
export function AncestorBinding(
    start:        Visual,
    ancestorType: Function,
    property:     string,
    level:        number = 1,
): Binding
{
    return new AncestorBindingImpl(start, ancestorType, property, level);
}
