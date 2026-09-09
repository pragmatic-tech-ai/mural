import { Binding, type ValueConverter } from './binding.js';
import { MetaData } from '../metadata.js';
import { MuralBase } from '../model.js';
import { Observable } from '../observable.js';
import type { PropertyKey } from '../model.js';
import { resolveKey } from '../model-internals.js';
import type { PropertyChangeCallback } from './effective-value.js';
import type { PropertyDescriptor } from '../property-descriptor.js';
import type { Visual } from '../../visual-engine/visual.js';

// The self-DataContext resolution hook (element.ts): the value THIS element
// would inherit from its logical ancestry, ignoring its own local value.
// Reached through a typed cast per the cross-class-internals rule.
interface ElementWithInheritedDataContext
{
    GetInheritedDataContext(): unknown;
}

// Internal MuralBase that carries the resolved DataContext-path value as
// its own property. DataContextBinding inherits from Binding with this
// watcher as the source; setting `Value` here fires Binding's change
// machinery which then propagates to the EVD that owns the binding.
//
// Same pattern as `ResourceWatcher` in dynamic-resource.ts. Kept
// private since DataContextBinding owns the lifecycle.
class DataContextWatcher extends MuralBase
{
    public static readonly ValueKey = MuralBase.RegisterProperty<unknown>(
        DataContextWatcher, 'Value', undefined, MetaData.None);

    public get Value(): unknown { return this.get_property_value(DataContextWatcher.ValueKey); }
    public set Value(v: unknown) { this.set_property_value(DataContextWatcher.ValueKey, v); }
}

// Binding that resolves a dotted path against the target Visual's
// DataContext, refreshing whenever DataContext changes (DataContext is
// inherited so an ancestor mutation flows down via the existing
// property-inheritance path) or whenever a MuralBase in the resolution
// chain raises a property change on a segment we're watching.
//
// Resolution rules:
//   * `dc instanceof MuralBase` → use `dc.get_property_value(segment)` and
//     subscribe to that segment's property changes for reactivity.
//   * Plain object → use `dc[segment]` (one-shot read; no reactive
//     update on plain-object mutation — out of scope for v0).
//   * `dc === undefined / null` → the binding's value is undefined.
//
// Dotted paths walk segment-by-segment; intermediate undefined/null
// short-circuits to undefined. Only the FIRST segment subscribes for
// reactivity in v0; mutations deeper in the chain (e.g. swapping
// `customer.address` to a different Address instance) won't auto-
// re-resolve. Documented limitation; common cases (one-segment paths
// like `$Name`) work.
class DataContextBindingImpl extends Binding
{
    private readonly watcher: DataContextWatcher;
    private readonly target:  Visual;
    private readonly pathStr: string;
    private readonly dcCallback: PropertyChangeCallback;

    // The source we're currently subscribed to for property changes on
    // the first path segment, the callback we registered, and the key
    // we registered it under. Cleared on each refresh so we can detach
    // cleanly without re-resolving the descriptor.
    //
    // Typed `Observable` (the common base) so both mechanisms typecheck: a
    // MuralBase source keys off `currentSourceKey` (its RemovePropertyChanged
    // Listener widened to PropertyKey), a plain Observable source keys off
    // `currentSourceName` (Observable's name-based overload). Exactly one of
    // the two keys is set at a time.
    private currentSource:      Observable | undefined;
    private sourceCallback:     PropertyChangeCallback | undefined;
    private currentSourceKey:   PropertyKey<unknown> | undefined;
    private currentSourceName:  string | undefined;
    // Cached at construction — `'DataContext'` resolves on every Visual,
    // and the binding listens to it for its entire lifetime.
    private readonly dataContextKey: PropertyKey<unknown>;
    // True when this binding IS the target's DataContext (`DataContext =
    // $Path`). The source path then resolves against the INHERITED
    // DataContext (the parent's), not the target's own — which would be the
    // circular value this binding is producing. Set from ResolveDefaultMode
    // (the EVD hands us the target descriptor there), which then re-refreshes.
    private isDataContextTarget = false;

    constructor(target: Visual, path: string, converter?: ValueConverter)
    {
        const watcher = new DataContextWatcher();
        // Mode is left unset so the EVD's ResolveDefaultMode hook can
        // upgrade it to TwoWay when the target DP declares
        // BindsTwoWayByDefault (e.g., TreeView.SelectedDataItem). For
        // every other DP the binding stays OneWay (the default mode
        // when the EVD doesn't flip it). A converter (from `$path << conv`)
        // rides in opts so apply_transform runs it source→target and
        // convertBack runs it on writeback.
        super(watcher, 'Value', undefined, converter !== undefined ? { converter } : undefined);
        this.watcher = watcher;
        this.target  = target;
        this.pathStr = path;
        this.dataContextKey = resolveKey(target, undefined, 'DataContext');

        // React to the target's DataContext changing — EXCEPT in the self-
        // referential case (`DataContext = $Path`), where target.DataContext
        // is this binding's OWN output. Listening to it there would form a
        // feedback loop (write DataContext → fire → refresh → write again).
        // The self-DC case instead reacts to the INHERITED context via
        // onInheritedValueChanged() and to the source segment via the
        // per-refresh source subscription — both real inputs, neither our
        // own output.
        this.dcCallback = () => { if (!this.isDataContextTarget) this.refresh(); };
        // `$Self` short-circuits to "the Visual where the binding is
        // authored". It's a control-self relative source, not a path
        // walk — WPF's `{Binding RelativeSource={RelativeSource Self}}`
        // semantic. The target identity is fixed for the binding's
        // lifetime, so we set watcher.Value once and skip the
        // DataContext subscription entirely. Without this short-circuit,
        // `$Self` would walk `DataContext.Self` and fail unless the
        // current DataContext has a registered `Self` DP — a footgun
        // that's bitten the diagram demo before.
        if (path === 'Self')
        {
            this.watcher.Value = target;
            return;
        }
        target.AddPropertyChangedListener(this.dataContextKey, this.dcCallback);
        this.refresh();
    }

    public override dispose(): void
    {
        super.dispose();
        this.target.RemovePropertyChangedListener(this.dataContextKey, this.dcCallback);
        this.unsubscribeSource();
    }

    // The EVD calls this when the binding is installed, handing us the
    // TARGET property's descriptor — our only signal of what we're bound to.
    // Detect the self-referential DataContext case and re-resolve against
    // the inherited context now that we know. Delegates mode resolution to
    // the base (TwoWay-by-default upgrade, etc.).
    public override ResolveDefaultMode(descriptor: PropertyDescriptor): void
    {
        super.ResolveDefaultMode(descriptor);
        // `$Self` is a fixed relative source resolved once in the ctor (no
        // path walk, no DataContext subscription) — leave it untouched.
        if (this.pathStr === 'Self') return;
        const isDcTarget = descriptor === this.dataContextKey.descriptor;
        if (isDcTarget !== this.isDataContextTarget)
        {
            this.isDataContextTarget = isDcTarget;
            // The ctor's refresh() ran against the target's own (circular,
            // undefined) DataContext; re-resolve against the inherited one.
            this.refresh();
        }
    }

    // The inherited DataContext this binding resolves against just changed
    // (arrived from the parent, or the parent's context swapped) while this
    // binding masks the DataContext slot. Re-resolve — only meaningful in the
    // self-referential `DataContext = $Path` case.
    public override onInheritedValueChanged(): void
    {
        if (this.isDataContextTarget) this.refresh();
    }

    // The DataContext the source path resolves against. Normally the target's
    // own DataContext; for the self-referential `DataContext = $Path` case
    // it's the value the parent provides (target.DataContext is this binding).
    private sourceDataContext(): unknown
    {
        if (this.isDataContextTarget)
        {
            return (this.target as unknown as ElementWithInheritedDataContext)
                .GetInheritedDataContext();
        }
        return this.target.DataContext;
    }

    // TwoWay writeback: when the target DP changes and the EVD asks
    // the binding to push the value back, send it through the
    // DataContext path so the actual VM property updates. Without
    // this override, the base Binding.set_value writes only to the
    // internal `watcher.Value` slot — the VM never sees the change
    // and the source-side listener never re-fires. Returns true when
    // the writeback succeeded (mode is TwoWay/OneWayToSource and the
    // path is reachable + writable); false leaves the EVD to fall
    // back to local-replace as if no binding were installed.
    public override set_value(value: unknown): boolean
    {
        // Mode check lives in the base — bail out fast if this binding
        // isn't writable. The base call also writes `watcher.Value`,
        // which fires our setOnValueChanged hook in the EVD so the
        // target DP's effective value reflects the new push without
        // waiting for the source-side listener to round-trip.
        if (!super.set_value(value)) return false;

        const dc = this.sourceDataContext();
        if (dc === undefined || dc === null) return true;
        const segments = this.pathStr.split('.');
        let cur: unknown = dc;
        for (let i = 0; i < segments.length - 1; i++)
        {
            const seg = segments[i]!;
            if (cur instanceof MuralBase)
            {
                cur = MuralBase.HasProperty(cur.constructor, seg)
                    ? cur.get_property_value(resolveKey(cur, undefined, seg))
                    : (cur as unknown as Record<string, unknown>)[seg];
            }
            else if (cur !== null && typeof cur === 'object')
            {
                cur = (cur as Record<string, unknown>)[seg];
            }
            else
            {
                return true;
            }
            if (cur === undefined || cur === null) return true;
        }
        // Back-convert for the real VM write (the base already wrote the
        // back-converted value to the watcher). No-op when no convertBack.
        const back = this.applyConvertBack(value);
        const lastSeg = segments[segments.length - 1]!;
        if (cur instanceof MuralBase)
        {
            // A registered DP writes through the DP store; a non-DP name writes
            // through the plain setter (which is expected to raise INPC), so a
            // MuralBase VM's plain two-way property round-trips like a plain
            // Observable one.
            if (MuralBase.HasProperty(cur.constructor, lastSeg))
            {
                cur.set_property_value(resolveKey(cur, undefined, lastSeg), back);
            }
            else
            {
                (cur as unknown as Record<string, unknown>)[lastSeg] = back;
            }
        }
        else if (cur !== null && typeof cur === 'object')
        {
            (cur as Record<string, unknown>)[lastSeg] = back;
        }
        return true;
    }

    private unsubscribeSource(): void
    {
        if (this.currentSource !== undefined && this.sourceCallback !== undefined)
        {
            // MuralBase source → remove by descriptor key (its widened
            // overload). Plain Observable source → remove by property name.
            if (this.currentSourceKey !== undefined)
            {
                (this.currentSource as MuralBase)
                    .RemovePropertyChangedListener(this.currentSourceKey, this.sourceCallback);
            }
            else if (this.currentSourceName !== undefined)
            {
                this.currentSource.RemovePropertyChangedListener(this.currentSourceName, this.sourceCallback);
            }
        }
        this.currentSource      = undefined;
        this.sourceCallback     = undefined;
        this.currentSourceKey   = undefined;
        this.currentSourceName  = undefined;
    }

    private firstSegment(): string
    {
        const dot = this.pathStr.indexOf('.');
        return dot < 0 ? this.pathStr : this.pathStr.substring(0, dot);
    }

    // Re-resolve the path against the target's current DataContext and
    // wire up a fresh source-side subscription on the first segment so
    // mutations propagate while this binding lives.
    //
    // WPF parity: when the first path segment isn't a registered DP on
    // the current DataContext, the binding silently resolves to
    // undefined rather than throwing. This matters when a binding is
    // installed against an inherited DataContext that will later be
    // replaced with the "real" source — e.g. `OnDragStart=$Foo` set on
    // an ItemsControl's container Style: the container's DataContext
    // briefly points at the outer VM (no `Foo` DP) before the
    // ContentPresenter swaps it to the per-item VM (which DOES carry
    // `Foo`). A throw in the brief window would abort template apply
    // and leave the demo blank. The DataContext re-bind triggers a
    // fresh refresh() once the per-item source is set, and the
    // subscription targets the right MuralBase at that point.
    private refresh(): void
    {
        this.unsubscribeSource();
        const dc = this.sourceDataContext();
        if (dc === undefined || dc === null)
        {
            this.watcher.Value = undefined;
            return;
        }
        const first = this.firstSegment();
        if (dc instanceof MuralBase && MuralBase.HasProperty(dc.constructor, first))
        {
            const key = resolveKey(dc, undefined, first);
            this.currentSource    = dc;
            this.currentSourceKey = key;
            this.sourceCallback   = () => { this.watcher.Value = this.walkPath(dc); };
            dc.AddPropertyChangedListener(key, this.sourceCallback);
        }
        else if (dc instanceof Observable)
        {
            // A plain Observable VM, OR a MuralBase whose first segment is a
            // plain (non-DP) property — both subscribe by NAME. MuralBase is
            // also an Observable, and its AddPropertyChangedListener falls back
            // to the Observable INPC store for a non-DP name (mural >= 0.46.16),
            // so a getter/setter that raises RaisePropertyChanged stays
            // reactive. Before this a MuralBase whose segment wasn't a DP fell
            // through BOTH branches and got no subscription — .mu `$plain`
            // bindings against a ServiceBase panel never updated.
            this.currentSource     = dc;
            this.currentSourceName = first;
            this.sourceCallback    = () => { this.watcher.Value = this.walkPath(dc); };
            dc.AddPropertyChangedListener(first, this.sourceCallback);
        }
        this.watcher.Value = this.walkPath(dc);
    }

    // Walk the dotted path starting from `root`. Each segment reads
    // either a MuralBase property or a plain-object field; intermediate
    // undefined/null short-circuits to undefined. Same WPF-parity
    // tolerance as `refresh` — a missing segment in the middle of the
    // path resolves to undefined rather than throwing, so a partial
    // DataContext (or a path against a sibling type) silently no-ops.
    private walkPath(root: unknown): unknown
    {
        let cur: unknown = root;
        for (const seg of this.pathStr.split('.'))
        {
            if (cur === undefined || cur === null) return undefined;
            if (cur instanceof MuralBase)
            {
                // A registered DP reads through the DP store; a non-DP name
                // falls through to a plain property read (a getter/field on the
                // subclass), mirroring the core binding engine so a MuralBase VM
                // (e.g. a ServiceBase capability panel) can expose bindable
                // commands / lists / state as plain members with no dependency-
                // property boilerplate (mural >= 0.46.19).
                cur = MuralBase.HasProperty(cur.constructor, seg)
                    ? cur.get_property_value(resolveKey(cur, undefined, seg))
                    : (cur as unknown as Record<string, unknown>)[seg];
            }
            else if (typeof cur === 'object')
            {
                cur = (cur as Record<string, unknown>)[seg];
            }
            else
            {
                return undefined;
            }
        }
        return cur;
    }
}

// Public factory — matches the DynamicResource shape so the compiler
// can emit both at value-position uses with the same imperative form.
//
// Usage:
//   border.set_property_value(Border.FillKey, DataContextBinding(border, 'AccentBrush'));
//
// In Style setters where the target isn't yet known, wrap in a
// SetterFactory so each application gets its own per-target binding:
//   new Setter(Border, 'Fill',
//              new SetterFactory(t => DataContextBinding(t, 'AccentBrush')));
export function DataContextBinding(target: Visual, path: string, converter?: ValueConverter): Binding
{
    return new DataContextBindingImpl(target, path, converter);
}
