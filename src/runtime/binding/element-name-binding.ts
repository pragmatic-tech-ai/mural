import { Binding, type ValueConverter } from './binding.js';
import type { Disposable } from '@pragmatic-tech-ai/todl-runtime';
import { MetaData } from '../metadata.js';
import { MuralBase } from '../model.js';
import { resolveKey } from '../model-internals.js';
import { Application } from '../application.js';
import type { ServiceToken } from '../services/service-provider.js';
import type { Visual } from '../../visual-engine/visual.js';
import { readServiceScope } from './service-scope.js';

// Watcher MuralBase — same shape as DataContextWatcher: a MuralBase with a
// single registered Value property. Bindings feed their resolved value
// into this slot; the consumer EVD subscribes to it as the binding's
// source.
class ElementNameWatcher extends MuralBase
{
    public static readonly ValueKey = MuralBase.RegisterProperty<unknown>(
        ElementNameWatcher, 'Value', undefined, MetaData.None);

    public get Value(): unknown      { return this.get_property_value(ElementNameWatcher.ValueKey); }
    public set Value(value: unknown) { this.set_property_value(ElementNameWatcher.ValueKey, value); }
}

// Binding whose source is a fixed Visual — typically an x:name'd
// descendant inside a template. Mirrors WPF's
// `{Binding ElementName=foo, Path=Bar}`. The path walks against the
// source Visual the same way DataContextBinding's walks against the
// target's DataContext, but the source itself never re-resolves —
// element identity is fixed at binding install time, so there's no
// DataContext-change listener.
//
// Mode is left unset so EVD.ResolveDefaultMode upgrades it to TwoWay
// when the target DP declares BindsTwoWayByDefault — matches the
// DataContextBinding policy for consistency.
// Shared impl for bindings whose source is FIXED (resolved once, never
// re-resolved on a DataContext change): ElementName (an x:name'd Visual)
// and Service (resolved from the ambient ServiceProvider). The source is
// any `MuralBase` — a Visual IS a MuralBase, and a ServiceBase service IS a
// MuralBase, so both ride the same path-walk + property-change machinery.
class FixedSourceBinding extends Binding
{
    private readonly watcher:     ElementNameWatcher;
    private readonly sourceThunk: () => MuralBase | undefined;
    private readonly pathStr:     string;

    private nameSource:         MuralBase | undefined;
    private sourceSubscription: Disposable | undefined;
    private disposed = false;
    // The forward-ref retry (activate) fires at most once. One microtask
    // defers past the current synchronous factory run — the entire forward-ref
    // window — so a second retry would only ever spin for a source that never
    // resolves (an unregistered `$service`, a typo'd ElementName), an infinite
    // microtask loop that starves the event loop. Genuine late arrival is
    // handled reactively by the rebind listener (reresolve), not by retrying.
    private forwardRefRetried = false;
    // A TwoWay writeback that arrived BEFORE the forward-ref source
    // resolved. Buffered (not dropped, not disposed) and flushed to the
    // source by activate() once it resolves. Wrapped in an object so a
    // buffered write of `undefined` (e.g. clearing a value) is
    // distinguishable from "nothing pending".
    private pendingWrite:   { value: unknown } | undefined;

    // Optional "the source may move" watch: a property on some MuralBase whose
    // change means the thunk could now resolve a DIFFERENT source. The
    // ElementName case is genuinely fixed (an x:name'd element never moves),
    // so it passes none. The Service case watches the target's inherited
    // `ServiceScope` — re-parenting the subtree under a different provider
    // must rebind to that provider's service. See reresolve().
    private rebindSubscription: Disposable | undefined;

    constructor(
        source:    MuralBase | (() => MuralBase | undefined),
        path:      string,
        converter?: ValueConverter,
        rebind?:   { target: MuralBase; property: string },
    )
    {
        const watcher = new ElementNameWatcher();
        // Converter (from `$node.path << conv`) rides in opts — apply_transform
        // runs it source→target, convertBack on writeback.
        super(watcher, 'Value', undefined, converter !== undefined ? { converter } : undefined);
        this.watcher     = watcher;
        this.sourceThunk = typeof source === 'function' ? source : () => source;
        this.pathStr     = path;
        this.activate();

        // Subscribe to the rebind-trigger property AFTER the first activate
        // so the initial resolution path (incl. forward-ref retry) owns the
        // first value; subsequent changes re-resolve through reresolve().
        if (rebind !== undefined && MuralBase.HasProperty(rebind.target.constructor, rebind.property))
        {
            const key = resolveKey(rebind.target, undefined, rebind.property);
            this.rebindSubscription = rebind.target.PropertyChanged(key).subscribe(() => this.reresolve());
        }
    }

    // The rebind trigger fired (e.g. the target's ServiceScope changed). Re-
    // run the thunk; if it now yields a DIFFERENT source, detach the old
    // subscription, attach to the new source and pull its value. If the
    // source is unchanged, just re-walk in case its value moved. A change to
    // `undefined` (subtree detached from any provider) clears the value.
    private reresolve(): void
    {
        if (this.disposed) return;
        const src = this.sourceThunk();
        if (src === this.nameSource)
        {
            if (src !== undefined) this.watcher.Value = this.walkPath(src);
            return;
        }
        this.unsubscribeSource();
        this.nameSource = src;
        if (src === undefined)
        {
            this.watcher.Value = undefined;
            return;
        }
        this.subscribeSource();
        this.watcher.Value = this.walkPath(src);
    }

    // Resolve the source. Backward x:name references (declared earlier
    // in the same template body) return a defined Visual on the first
    // call and the binding subscribes + walks immediately. FORWARD
    // references (the named element is constructed LATER in the same
    // factory body) return undefined the first time — the binding
    // re-attempts on the next microtask, by which point the factory's
    // synchronous run has completed and the var holding the named
    // element is initialized.
    private activate(): void
    {
        if (this.disposed) return;
        const src = this.sourceThunk();
        if (src === undefined)
        {
            // Retry once (the forward-ref window is the rest of this
            // synchronous run); then stop and let the rebind listener resolve
            // any genuine late arrival. See forwardRefRetried.
            if (!this.forwardRefRetried)
            {
                this.forwardRefRetried = true;
                queueMicrotask(() => this.activate());
            }
            return;
        }
        this.nameSource = src;
        this.subscribeSource();
        const sourceValue = this.walkPath(src);
        if (this.pendingWrite !== undefined && sourceValue === undefined)
        {
            // A TwoWay writeback landed during the forward-ref window AND the
            // source has no value of its own to offer (e.g. ElementName
            // forward-ref to a still-empty element). The buffered value is
            // the target's intent — push it to the source now.
            const pending = this.pendingWrite;
            this.pendingWrite = undefined;
            this.set_value(pending.value);
        }
        else
        {
            // Source is authoritative on initial load (WPF semantics): pull
            // source→target, discarding any value the target buffered during
            // the forward-ref window. That buffered write is typically the
            // target control's transient DEFAULT (a list's `undefined`
            // selection, a rail's `-1` "no selection" sentinel) that fired
            // before the source resolved — flushing it would clobber a live
            // source value, which is exactly the TwoWay `$service` initial-
            // sync hazard. When the source genuinely has nothing (above), the
            // buffered write still wins.
            this.pendingWrite = undefined;
            this.watcher.Value = sourceValue;
        }
    }

    public override dispose(): void
    {
        this.disposed = true;
        super.dispose();
        this.unsubscribeSource();
        this.rebindSubscription?.dispose();
        this.rebindSubscription = undefined;
    }

    // TwoWay writeback: when the target DP is mutated, push the new
    // value back to the source Visual via the path. WPF parity with
    // ElementName + Path TwoWay. Returns true when the write was accepted.
    //
    // Forward-ref window: when the source is a not-yet-constructed
    // x:name'd element (the thunk still resolves to undefined), the write
    // has nowhere to land YET — but returning false makes the consumer
    // EVD treat the path as unwritable and permanently DISPOSE this
    // binding (effective-value.ts), severing a binding whose source was
    // merely declared later in the same markup. Instead, keep the value
    // on the watcher (so the target reflects it) and BUFFER it; activate()
    // flushes it to the source once resolved. Return true so the binding
    // survives.
    public override set_value(value: unknown): boolean
    {
        if (this.nameSource === undefined)
        {
            if (!super.set_value(value)) return false;
            this.pendingWrite = { value };
            return true;
        }
        if (!super.set_value(value)) return false;
        // A fresh write supersedes any value still buffered from the
        // forward-ref window.
        this.pendingWrite = undefined;
        const segments = this.pathStr.split('.');
        let cur: unknown = this.nameSource;
        for (let i = 0; i < segments.length - 1; i++)
        {
            const seg = segments[i]!;
            if (cur instanceof MuralBase)
            {
                cur = cur.get_property_value(resolveKey(cur, undefined, seg));
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
        // Back-convert for the real element write (the base already wrote
        // the back-converted value to the watcher). No-op when no convertBack.
        const back = this.applyConvertBack(value);
        const lastSeg = segments[segments.length - 1]!;
        if (cur instanceof MuralBase)
        {
            cur.set_property_value(resolveKey(cur, undefined, lastSeg), back);
        }
        else if (cur !== null && typeof cur === 'object')
        {
            (cur as Record<string, unknown>)[lastSeg] = back;
        }
        return true;
    }

    private firstSegment(): string
    {
        const dot = this.pathStr.indexOf('.');
        return dot < 0 ? this.pathStr : this.pathStr.substring(0, dot);
    }

    private subscribeSource(): void
    {
        const src = this.nameSource;
        if (src === undefined) return;
        // Empty path → the binding's value IS the source itself. No
        // per-property subscription needed; the source reference is
        // fixed at activate time. Used for `Foo = $elem` shape bindings
        // that surface the named element itself rather than one of
        // its properties.
        if (this.pathStr === '') return;
        const first = this.firstSegment();
        if (!MuralBase.HasProperty(src.constructor, first)) return;
        const key = resolveKey(src, undefined, first);
        this.sourceSubscription = src.PropertyChanged(key).subscribe(() => { this.watcher.Value = this.walkPath(src); });
    }

    private unsubscribeSource(): void
    {
        this.sourceSubscription?.dispose();
        this.sourceSubscription = undefined;
    }

    private walkPath(root: unknown): unknown
    {
        // Empty path → bind directly to the source Visual itself.
        // Mirrors WPF's `{Binding ElementName=foo}` with no Path —
        // the binding's value IS the named element.
        if (this.pathStr === '') return root;
        let cur: unknown = root;
        for (const seg of this.pathStr.split('.'))
        {
            if (cur === undefined || cur === null) return undefined;
            if (cur instanceof MuralBase)
            {
                if (!MuralBase.HasProperty(cur.constructor, seg)) return undefined;
                cur = cur.get_property_value(resolveKey(cur, undefined, seg));
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

// Public factory — same shape as DataContextBinding so the compiler
// can emit both at value position with the same imperative form.
// `source` is the named element (an x:name'd Visual in a template
// body); `path` is the dotted property path to follow on it.
//
// A function-typed `source` is the compiler's emit shape for forward
// references in DataTemplate / ControlTemplate bodies — the named
// element is constructed LATER in the same factory body, so a direct
// Visual reference would be `undefined` at binding install time. The
// thunk defers resolution to the next microtask, by which point the
// factory's synchronous run has populated the var.
export function ElementNameBinding(source: Visual | (() => Visual | undefined), path: string, converter?: ValueConverter): Binding
{
    return new FixedSourceBinding(source, path, converter);
}

// Public factory for `$service(Token).path` bindings. The source is the
// service resolved from the ambient provider (`Application.current.Services`)
// for `token` — an app-level singleton in practice. Like ElementName, the
// source is fixed and target-independent, so no target arg and no
// SetterFactory wrap: the same binding works in a direct attribute and a
// Style setter.
//
// The thunk + the impl's forward-ref retry cover the install-before-ready
// window: a binding materialised before the service is registered (or
// before Application.current is set) resolves to `undefined` and re-tries
// on the next microtask. An empty path surfaces the service object itself
// (`DataContext=$service(StatusService)`); a non-empty path binds reactively
// to the service's DP (`Text=$service(StatusService).Text`).
//
// Scope reactivity: the binding watches the target's inherited
// `ServiceScope` and re-resolves when it changes, so re-parenting the
// subtree under a different provider rebinds to that provider's service
// (not just the install-before-parent forward-ref window).
export function ServiceBinding(target: MuralBase, token: ServiceToken<unknown>, path: string, converter?: ValueConverter): Binding
{
    return new FixedSourceBinding(
        () => {
            // Resolve the provider from the nearest ancestor that published
            // a `ServiceScope` (inherited DP, read by name to keep the
            // runtime free of an Element value-dependency), falling back to
            // the app root. The thunk re-reads on each forward-ref retry,
            // so a binding that materialises before its host parents it
            // (ServiceScope still undefined) resolves once the scope
            // inherits in. Provided the service is registered in that scope
            // and NOT also at the root, the pre-parent attempt resolves to
            // undefined and the retry lands on the scoped instance.
            const scope = readServiceScope(target) ?? Application.current?.Services;
            return scope?.get(token) as MuralBase | undefined;
        },
        path, converter,
        // Re-resolve whenever the target's inherited ServiceScope changes.
        { target, property: 'ServiceScope' });
}

