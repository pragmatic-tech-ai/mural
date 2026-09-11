import { Binding, BindingMode, type ValueConverter } from './binding.js';
import { MetaData } from '../metadata.js';
import { MuralBase } from '../model.js';
import { resolveKey } from '../model-internals.js';
import type { Disposable } from '@pragmatic-tech-ai/todl-runtime';
import type { Visual } from '../../visual-engine/visual.js';

// Internal watcher MuralBase — same shape as AncestorWatcher: holds the
// resolved property value in a single `Value` slot the outer Binding
// reads from.
class SelfWatcher extends MuralBase
{
    public static readonly ValueKey = MuralBase.RegisterProperty<unknown>(
        SelfWatcher, 'Value', undefined, MetaData.None);

    public get Value(): unknown { return this.get_property_value(SelfWatcher.ValueKey); }
    public set Value(v: unknown) { this.set_property_value(SelfWatcher.ValueKey, v); }
}

// Binding whose source is the TARGET element's OWN property — the
// RelativeSource Self case. Resolves a property (which may be an
// attached property on a different owner type, e.g.
// `TextBlock.Foreground`) on the element the binding is set on, and
// tracks it OneWay.
//
// The headline use is reading an INHERITED attached property: a brush
// like `TextBlock.Foreground` cascades by key down the logical tree to
// any Element (not just TextBlocks), so a Shape can paint its Fill from
// the inherited foreground and re-tint live as that value flips (e.g. an
// IconButtonToggle's checked-ink Style trigger). At construction the
// element usually isn't attached yet, so the value reads `undefined`;
// it resolves once inheritance cascades on attach, via the change
// notification SetInheritedValue raises.
class SelfBindingImpl extends Binding
{
    private readonly watcher:  SelfWatcher;
    private readonly callback: () => void;
    private subscription:      Disposable | undefined;

    constructor(target: Visual, ownerType: Function, property: string, converter?: ValueConverter)
    {
        const watcher = new SelfWatcher();
        super(watcher, 'Value', BindingMode.OneWay, converter !== undefined ? { converter } : undefined);
        this.watcher = watcher;

        const key = resolveKey(target, ownerType, property);
        this.callback = () =>
        {
            this.watcher.Value = target.get_property_value(key);
        };
        this.subscription = target.PropertyChanged(key).subscribe(this.callback);
        this.watcher.Value = target.get_property_value(key);
    }

    public override dispose(): void
    {
        super.dispose();
        this.subscription?.dispose();
        this.subscription = undefined;
    }
}

// Public factory — mirrors WPF's `{Binding (TextBlock.Foreground),
// RelativeSource={RelativeSource Self}}`.
//
//   SelfBinding(shape, TextBlock, 'Foreground')   // shape's own inherited ink
//
// `ownerType` is the class the property is registered on (a real class
// reference, never a string) — for a plain self property it's the
// element's own type; for an attached property it's the declaring owner.
export function SelfBinding(
    target: Visual,
    ownerType: Function,
    property: string,
    converter?: ValueConverter,
): Binding
{
    return new SelfBindingImpl(target, ownerType, property, converter);
}
