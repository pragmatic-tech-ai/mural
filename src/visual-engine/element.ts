import { Visual, safeFire, KNOWN_ROUTED_EVENTS, type InheritableEntry } from './visual.js';

// Sentinel for "this node provides no value for a key" — distinct from any
// real value (including undefined) so change-detection never confuses a
// genuinely-undefined inherited value with the absence of one.
const NOT_PROVIDED: unique symbol = Symbol('not-provided');

// The value a DESCENDANT's inheritance walk would read from a node's EVD for
// one key: the winning value when the source isn't Default, else NOT_PROVIDED
// (the descendant looks past this node). Mirrors the `Source !== Default`
// predicate `walk_inherited` / `refresh_inherited_batch` use on the read side,
// so the change-gated cascade stays consistent with resolution.
function providedValue(evd: EffectiveValueDescriptor | undefined): unknown
{
    return evd !== undefined && evd.Source !== PropertyValueSource.Default ? evd.value : NOT_PROVIDED;
}
import { MuralBase } from '../runtime/model.js';
import type {
    PointerEventArgs,
    WheelEventArgs,
    KeyEventArgs,
    TextInputEventArgs,
    QueryCursorEventArgs,
    FocusEventArgs,
    DragEventArgs,
} from './routed-event.js';
import type {
    ManipulationStartingEventArgs,
    ManipulationStartedEventArgs,
    ManipulationDeltaEventArgs,
    ManipulationInertiaStartingEventArgs,
    ManipulationCompletedEventArgs,
} from './input/manipulation.js';
import { DragDrop, type DragStartCallback } from './drag-drop.js';
import { Rect } from './primitives.js';
import { AnimationManager } from './animation/manager.js';
import { Easings, type EasingFunction } from './animation/easing.js';
import { propertyValues } from '../runtime/model-internals.js';
import { PropertyValueSource, type EffectiveValueDescriptor } from '../runtime/binding/effective-value.js';
import { MetaData, inherits } from '../runtime/metadata.js';
import { NameScope } from './namescope.js';
import { ObservableCollection, type IReadOnlyObservableCollection } from '../runtime/observable-collection.js';
import { ResourceDictionary, type ResourceKey } from '../runtime/resource-dictionary.js';
import { Application } from '../runtime/application.js';
import { Setter, Style } from '../runtime/style.js';
import type { PropertyDescriptor } from '../runtime/property-descriptor.js';
import type { PropertyTrigger, MultiTrigger, DataTrigger, MultiDataTrigger } from '../runtime/style.js';
import type { EventTrigger } from '../runtime/event-trigger.js';
import { StyleApplicator, SetterTier } from './style-applicator.js';
import { TriggerHost, type ITriggerHost } from './trigger-host.js';
import { ResourceResolver } from './resource-resolver.js';
import type { Behavior } from './behavior.js';

// `Element` — the FrameworkElement-tier seam between `Visual` and the
// control library. Today (§ 1.1) it's an empty subclass of `Visual` —
// the layer exists so every UI-facing subclass (`Single`, `Panel`,
// `Shape`, `TemplatedControl`, `Control` and everything below) can
// already declare itself as Element-tier without touching them again
// when the structural moves land.
//
// Future home (§ 1.7-1.9): DataContext + inheritance machinery, Style
// + Resources + Triggers, dimension knobs (Width / Height / Min / Max
// / Margin / HorizontalAlignment / VerticalAlignment), the dimension-
// aware constrained-sizing pipeline that wraps `MeasureOverride`,
// DefaultStyleKey + theme resolution, Loaded / Unloaded, FindName /
// NameScope, ResourceDictionary, ambient-theme hooks, Behaviors.
//
// What stays on `Visual` (UIElement-tier): visual-tree wiring + host
// attachment, render pipeline, the layout entry points
// (`Measure(availableSize)` / `Arrange(finalRect)`) + cache state,
// routed-event registry + input virtuals, input-state DPs, focus,
// hit-testing.
//
// The `MeasureCore` / `ArrangeCore` seam (§ 1.1 design): `Visual` keeps
// `Measure` / `Arrange` and a default `MeasureCore` / `ArrangeCore`
// that delegates to `MeasureOverride` / `ArrangeOverride` unconstrained;
// `Element` (later) overrides `MeasureCore` to wrap the override with
// the Width / Height / Min / Max / Margin / Alignment dance. Subclass
// authors keep overriding `MeasureOverride` / `ArrangeOverride`
// unchanged — the seam is invisible to them.
// Friend-interface for the cross-class internals reached from
// Element's Style / Resources machinery during the ancestor walk —
// each cursor is a `Visual` (parents may be plain Visuals, not
// Elements), but the fields we touch (`_logicalParent`,
// `_templatedParent`) live on `Visual` and are accessible only
// through a typed cast. Per CLAUDE.md cross-class internals pattern.
// Mural-internal: never re-exported.
interface VisualAncestorAccess
{
    _logicalParent:   Visual | undefined;
    _templatedParent: Visual | undefined;
}

export class Element extends Visual implements ITriggerHost
{
    // ── FrameworkElement-tier DPs ─────────────────────────────────────

    // Style isn't inherited (each Element carries its own); changing
    // it can affect Measure/Arrange/Render via whichever setters
    // it contains, but the Style property itself doesn't need a
    // metadata flag — the underlying property changes from
    // SetStyleValue fire their own invalidation per their own
    // metadata. MetaData.None keeps OnPropertyChanged from doing
    // redundant work.
    public static readonly StyleKey = MuralBase.RegisterProperty<Style | undefined>(Element, 'Style', undefined, MetaData.None);

    // Type-keyed lookup for the theme-supplied default Style. Read-only
    // at the instance level (no public per-instance writes); subclasses
    // opt in by overriding metadata in their static init:
    //
    //     class Button extends ContentControl {
    //         static {
    //             MuralBase.OverrideMetadata(Button, Element.DefaultStyleKeyKey,
    //                 { default_value: Button });
    //         }
    //     }
    //
    // The value is a class function used as a key into the resource
    // chain. resolve_theme_style runs TryFindResource(DefaultStyleKey)
    // and applies the matching Style on a fallback slot below the user
    // ImplicitStyle. A subclass that doesn't override DefaultStyleKey
    // inherits its base's value, so MyFancyButton renders with Button's
    // theme chrome until it opts into its own. Default is undefined —
    // an Element whose DefaultStyleKey is undefined skips theme lookup.
    //
    // Key is public so subclasses can pass it to MuralBase.OverrideMetadata;
    // the read-only gate on set_property_value / by-name paths still
    // prevents per-instance writes (set_property_value_with_key is the
    // documented framework-internal escape hatch).
    public static readonly DefaultStyleKeyKey = MuralBase.RegisterReadOnlyProperty<Function | undefined>(
        Element, 'DefaultStyleKey', undefined, MetaData.None,
    );

    // Generic consumer-side handle, mirroring WPF's FrameworkElement.Tag.
    // Common use: bind a domain object to an Element so a click handler
    // / selection listener can recover the consumer's data without an
    // external WeakMap. Pure storage — never read by the framework
    // itself — hence MetaData.None.
    public static readonly TagKey = MuralBase.RegisterProperty<unknown>(Element, 'Tag', undefined, MetaData.None);

    // Ambient data root for bindings. Inherits down the logical tree so
    // a binding written as `$Path` on a descendant resolves against the
    // nearest ancestor's DataContext. No measure / arrange / render
    // impact — pure data plumbing — hence the inherits-only flag.
    // IsAnimationProhibited: a DataContext swap is a coherent identity
    // change, not a value to tween; animating it would silently break
    // every binding rooted in it.
    public static readonly DataContextKey = MuralBase.RegisterProperty<unknown>(Element, 'DataContext', undefined, MetaData.Inherits | MetaData.IsAnimationProhibited);

    // Ambient service provider for `$service(Token)` bindings. Inherits
    // down the tree the same way DataContext does, so a descendant's
    // `$service()` resolves against the nearest ancestor that published a
    // scope (e.g. a shell publishing its per-instance DI scope). Undefined
    // by default — ServiceBinding falls back to Application.current.Services
    // (the app root) when no ancestor set one. Pure data plumbing, no
    // layout/render impact; animation-prohibited for the same identity-
    // swap reason as DataContext. Typed `unknown` to keep Element free of a
    // runtime dependency on the ServiceProvider class (the runtime layer);
    // ServiceBinding reads it by name and treats it structurally.
    public static readonly ServiceScopeKey = MuralBase.RegisterProperty<unknown>(Element, 'ServiceScope', undefined, MetaData.Inherits | MetaData.IsAnimationProhibited);

    // Disabled-state surface. WPF parity: a disabled Element swallows
    // pointer / keyboard input across its entire subtree, and templates
    // can observe `when (not IsEnabled)` to dim the chrome. Inherited
    // downward — setting it on a control disables every descendant.
    // Default `true` so untouched Elements stay interactive.
    //
    // Input gating lives in the routed-event dispatcher
    // (routed-event.ts): dispatchPointer / dispatchPointerDirect /
    // dispatchKey skip tunnels/bubbles when any ancestor (or the source
    // itself) reports IsEnabled=false. The dispatcher walks the route as
    // `Element[]` (every routed node is an Element). Enter / Leave still
    // update IsMouseOver on enabled ancestors so hover chrome on a
    // disabled descendant's surrounding container behaves naturally.
    public static readonly IsEnabledKey = MuralBase.RegisterProperty<boolean>(
        Element, 'IsEnabled', true, MetaData.Inherits | MetaData.IsAnimationProhibited);

    // ── Style / Resources / apply_setter ──────────────────────────────

    // Per-instance ResourceDictionary, lazy-created on first access.
    // Read directly (not through the public Resources getter) by
    // TryFindResource so an ancestor walk doesn't accidentally allocate
    // empty dicts on every node it passes through.
    private _resources: ResourceDictionary | undefined;

    // Resource-lookup machinery + ThemeManager-facing ambient-token
    // hook live on `ResourceResolver` (§ 1.9). Element retains a lazy
    // `_resourceResolver` field; Elements that never trigger a
    // TryFindResource pay no allocation.
    private _resourceResolver: ResourceResolver | undefined;

    // The Style currently driving the StyleValue slot lives on
    // `StyleApplicator` (§ 1.7) — `_styleApplicator?.ActiveStyle`.
    // The applicator is lazy: undefined for Elements that never opt
    // into Style.
    private _styleApplicator: StyleApplicator | undefined;

    // The implicit style discovered by walking the logical chain at
    // AttachLogical and looking up `this.constructor` in the resource
    // dictionaries. Cached so DetachLogical knows what to unapply, and
    // so Style = undefined can re-promote it to active. Only populated
    // for Elements whose ancestor chain contains a matching Style; left
    // undefined otherwise.
    private _implicitStyle: Style | undefined;

    // The theme style discovered by looking up `this.DefaultStyleKey`
    // in the same logical-chain walk as `_implicitStyle`. Sits below
    // `_implicitStyle` in `refresh_active_style`, so a user-side
    // `Style [TargetType=Button]` in app or element resources always
    // shadows the theme's `[TargetType=Button]` entry — which lives in
    // a merged theme dictionary lower in the resolver chain. Only
    // populated when DefaultStyleKey is set; left undefined otherwise.
    private _themeStyle: Style | undefined;

    // Subscriptions on ancestor ResourceDictionaries that, when fired,
    // re-trigger resolve_implicit_style AND resolve_theme_style — both
    // sources watch the same chain so they share one subscription list.
    // Wired at AttachLogical for every dict found in the current
    // ancestor chain; torn down at DetachLogical or when
    // _refresh_styles_subtree rebuilds them after a tree mutation.
    // Lazy — Elements that never opt into Style / Triggers /
    // DynamicResource pay zero allocation.
    private _styleSubscriptions: Array<() => void> | undefined;

    // Per-instance Resources dictionary, lazy-allocated on first
    // touch. Pure-read consumers (`v.Resources.Has(k)`) pay only the
    // allocation; mutation triggers `_refresh_styles_subtree` +
    // `_refresh_dynamic_resources_subtree` via the dict's subscription
    // (§ 1.12), so descendants pick up new resources at the moment a
    // value lands rather than at the unrelated moment the dict was
    // lazy-allocated.
    public get Resources(): ResourceDictionary
    {
        if (this._resources === undefined)
        {
            const dict = new ResourceDictionary();
            this._resources = dict;
            dict.Subscribe(() => {
                this._refresh_styles_subtree();
                this._refresh_dynamic_resources_subtree();
            });
        }
        return this._resources;
    }

    // Logical-ancestor lookup for a resource key. Same walk pattern as
    // FindName / walk_inherited (logical parent, with templatedParent
    // fallback) — so template internals find resources defined on the
    // templated control or on the consumer's surrounding tree. Each
    // ancestor's dictionary is queried via Resolve so MergedDictionaries
    // are included; closer ancestors shadow farther ones. Returns
    // undefined when no ancestor's composition contains the key.
    public TryFindResource(key: ResourceKey): unknown | undefined
    {
        return (this._resourceResolver ??= new ResourceResolver(this)).TryFindResource(key);
    }

    // Resource-chain walk with a per-dictionary MATCHER instead of a single
    // key — the generalization of TryFindResource for resource kinds that
    // aren't a plain keyed lookup (implicit DataTemplates, resolved by scanning
    // each dictionary for a matching DataType). Same ancestor walk, same
    // nearest-wins precedence ending at Application.Resources, so every resource
    // kind honors local dictionaries uniformly.
    public FindInResourceChain<T>(match: (rd: ResourceDictionary) => T | undefined): T | undefined
    {
        return (this._resourceResolver ??= new ResourceResolver(this)).FindInChain(match);
    }

    // Throws when the resource isn't found anywhere up the chain — use
    // when the caller treats absence as a programming error. For
    // optional lookups use TryFindResource.
    public FindResource(key: ResourceKey): unknown
    {
        const v = this.TryFindResource(key);
        if (v === undefined)
        {
            const desc = typeof key === 'string' ? `'${key}'` : `[${(key as Function).name}]`;
            throw new Error(`Element.FindResource: resource ${desc} not found in any logical ancestor.`);
        }
        return v;
    }

    // Explicit style for this Element. When set, takes priority over
    // any implicit (TargetType-keyed) style discovered in the ancestor
    // resource chain. Setting it to undefined re-promotes the implicit
    // style (if one was found at AttachLogical).
    //
    // Style setters apply to the StyleValue priority tier in EVD —
    // they sit below LocalValue / Binding / Animated / Coerced, so
    // an explicit set or binding always shadows the styled value, but
    // above InheritedValue / Default.
    public get Style(): Style | undefined { return this.get_property_value(Element.StyleKey); }
    public set Style(value: Style | undefined)
    {
        const old = this.Style;
        if (old === value) return;
        this.set_property_value(Element.StyleKey, value);
        this.refresh_active_style();
    }

    // Read-only at the instance level. Subclasses override the default
    // value via MuralBase.OverrideMetadata at type-init; see the docstring
    // on DefaultStyleKeyKey. Returns undefined for any Element whose
    // class (or any base) hasn't opted in.
    public get DefaultStyleKey(): Function | undefined
    {
        return this.get_property_value(Element.DefaultStyleKeyKey);
    }

    // Generic consumer-side handle. The framework never reads Tag;
    // consumers attach arbitrary data (a domain object, a routing key,
    // an action delegate) so click / selection handlers can recover it
    // without an out-of-band map. WPF parity. Overrides Visual's no-op
    // stub pair (§ Phase B / B5.1) with real DP-backed access.
    public override get Tag(): unknown { return this.get_property_value(Element.TagKey); }
    public override set Tag(value: unknown) { this.set_property_value(Element.TagKey, value); }

    // Ambient data root for descendants' bindings. Inherits down the
    // logical tree (§ B4.4). Overrides Visual's no-op stub pair
    // (§ Phase B / B5.2) with real DP-backed access.
    public override get DataContext(): unknown { return this.get_property_value(Element.DataContextKey); }
    public override set DataContext(value: unknown) { this.set_property_value(Element.DataContextKey, value); }

    // Ambient service provider for descendants' `$service(…)` bindings.
    // Inherits downward; a host (e.g. a shell) publishes its DI scope here
    // so the subtree resolves scoped services.
    public get ServiceScope(): unknown { return this.get_property_value(Element.ServiceScopeKey); }
    public set ServiceScope(value: unknown) { this.set_property_value(Element.ServiceScopeKey, value); }

    // Disabled-state surface. WPF parity, inherits down the logical
    // tree (§ B4.4). Overrides Visual's `true`-returning stub pair
    // (§ Phase B / B5.3) with real DP-backed access — only an Element
    // can actually be disabled.
    public override get IsEnabled(): boolean { return this.get_property_value(Element.IsEnabledKey); }
    public override set IsEnabled(value: boolean) { this.set_property_value(Element.IsEnabledKey, value); }

    // Pick which Style should be driving the StyleValue tier. Priority
    // matches WPF: explicit Style > implicit (user-side
    // [TargetType=X] walked from the live tree, exact-match by
    // constructor) > theme (DefaultStyleKey-keyed, lives in merged
    // theme dictionaries). Delegates the diff-swap of setters +
    // triggers to `StyleApplicator` (§ 1.7); the applicator is
    // created lazily on first touch so Elements that never opt into
    // Style pay zero allocation.
    private refresh_active_style(): void
    {
        const desired = this.Style ?? this._implicitStyle ?? this._themeStyle;
        if (desired === this._styleApplicator?.ActiveStyle) return;
        (this._styleApplicator ??= new StyleApplicator(this)).RefreshActiveStyle(desired);
    }

    // § 1.7 trampolines — apply_setter / unapply_setter now live on
    // StyleApplicator. Element keeps thin wrappers so the trigger
    // install / uninstall machinery (on TriggerHost) continues calling
    // them without knowing about the applicator.
    private apply_setter(setter: Setter, tier: SetterTier): void
    {
        (this._styleApplicator ??= new StyleApplicator(this)).ApplySetter(setter, tier);
    }

    private unapply_setter(setter: Setter, tier: SetterTier): void
    {
        this._styleApplicator?.UnapplySetter(setter, tier);
    }

    // Public hooks used by DataTemplate triggers — they let a trigger
    // wired up at the template root apply/clear setters on a named
    // descendant ('TargetName' in WPF) at the Trigger priority tier,
    // exactly the way a Style-installed PropertyTrigger/DataTrigger
    // would but with the styled visual and the setter target being two
    // different Elements. The setter machinery itself doesn't care about
    // the split; it just operates on `this`.
    public ApplyTriggerSetter(setter: Setter): void
    {
        this.apply_setter(setter, SetterTier.Trigger);
    }
    public ClearTriggerSetter(setter: Setter): void
    {
        this.unapply_setter(setter, SetterTier.Trigger);
    }

    // Looks up an implicit Style keyed by this Element's constructor in
    // the ancestor resource chain. Called from AttachLogical (newly in
    // a tree, may have an implicit Style above), from DetachLogical
    // (no chain anymore, implicit clears), and from the ancestor-
    // resource subscriptions wired by subscribe_styles (a dictionary
    // change might add / remove the implicit style).
    private resolve_implicit_style(): void
    {
        // Function-keyed entries in the resource chain may be Styles
        // (user-side `[TargetType=X]`) OR ControlTemplates (the bundled
        // controls theme's `[TargetType=X]` Templates). The implicit-Style
        // path takes Styles only — guard with `instanceof Style` so a
        // ControlTemplate registered under the same key doesn't get
        // mis-applied here (the control's constructor reads the
        // template directly via Application.ResolveDefaultResource).
        const raw = this.TryFindResource(this.constructor);
        const found = raw instanceof Style ? raw : undefined;
        if (found === this._implicitStyle) return;
        this._implicitStyle = found;
        this.refresh_active_style();
    }

    // Theme-style counterpart of resolve_implicit_style. Looks up
    // `this.DefaultStyleKey` (a class function picked by metadata
    // override) in the same ancestor resource chain. An Element whose
    // DefaultStyleKey is undefined (the default) skips the lookup —
    // theme styling is opt-in per subclass. In practice the matching
    // entry lives in a merged theme dictionary on Application.Resources;
    // user-side [TargetType=X] entries closer in the chain hit
    // resolve_implicit_style first and shadow what we find here.
    private resolve_theme_style(): void
    {
        const key = this.DefaultStyleKey;
        const raw = key !== undefined ? this.TryFindResource(key) : undefined;
        // Same instanceof guard as resolve_implicit_style — Function
        // keys are shared with ControlTemplate registrations, so skip
        // anything that isn't a Style.
        const found = raw instanceof Style ? raw : undefined;
        if (found === this._themeStyle) return;
        this._themeStyle = found;
        this.refresh_active_style();
    }

    // Eagerly resolve the default Style and apply it. Convention for
    // templated controls: call this at the end of the subclass
    // constructor. The framework would otherwise only resolve styles
    // on AttachLogical (via _refresh_styles_subtree) — fine for tree-
    // mounted controls, but standalone tests / unmounted instances
    // would have a missing Template (and the visualChildren / Measure
    // contracts would observe an un-templated control). Calling this
    // is the WPF parity for the EnsureTemplate hook that runs lazily
    // in MeasureCore there; mural runs it eagerly at construction so
    // unattached visualChildren reads still see the default chrome.
    //
    // Idempotent: re-resolving the same Style is a no-op
    // (resolve_*_style short-circuits on identity match). Safe to call
    // multiple times during composition (e.g. when a subclass needs
    // the Template to be populated before its own ctor finishes).
    protected applyDefaultStyle(): void
    {
        this.resolve_implicit_style();
        this.resolve_theme_style();
    }

    // Subscribe to every ResourceDictionary in the ancestor chain so
    // changes to any of them re-resolve BOTH the implicit and theme
    // styles. Wired at AttachLogical; tree mutations rebuild via
    // _refresh_styles_subtree. Implicit and theme share one subscription
    // list because they consult the same chain — splitting would
    // double the subscribers on every dict for no benefit.
    private subscribe_styles(): void
    {
        this.unsubscribe_styles();
        // Per-key style subscriptions (§ 3a, notification-primitives design).
        // Implicit style is keyed by this Element's own constructor, theme
        // style by its DefaultStyleKey. Subscribing PER KEY on each dict's
        // STYLE channel means a resource change only re-resolves when it
        // actually alters one of THESE keys' resolved value — string-key
        // churn (e.g. a library populating class templates into
        // Application.Resources) no longer wakes every element's style
        // resolution, which was an O(sets × elements) storm. resolve_*_style
        // does the authoritative full-chain TryFindResource; the per-dict key
        // subscription is only the wake-up trigger. Both keys are stable for
        // the element's lifetime by the time this runs (constructor fixed;
        // DefaultStyleKey a metadata-set read-only DP), and
        // _refresh_styles_subtree re-runs this on tree moves.
        const typeKey = this.constructor;
        const themeKey = this.DefaultStyleKey;
        const subscribeOn = (r: ResourceDictionary): void =>
        {
            (this._styleSubscriptions ??= []).push(
                r.SubscribeStyleKey(typeKey, () => this.resolve_implicit_style()));
            if (themeKey !== undefined)
            {
                (this._styleSubscriptions ??= []).push(
                    r.SubscribeStyleKey(themeKey, () => this.resolve_theme_style()));
            }
        };
        // The cursor walks the Visual ancestor chain, but the
        // `_resources` field we read lives on Element. Plain Visual
        // parents in the chain return undefined for the cast (the
        // field simply isn't on the instance), so the walk skips them.
        let cursor: Visual | undefined = this;
        while (cursor !== undefined)
        {
            const back = cursor as unknown as VisualAncestorAccess;
            if (cursor instanceof Element)
            {
                const r = cursor._resources;
                if (r !== undefined)
                {
                    subscribeOn(r);
                }
            }
            cursor = back._logicalParent ?? back._templatedParent;
        }
        // Mirror the Application-level fallback in TryFindResource —
        // theme / implicit-style changes on the app's root dict must
        // trigger re-resolution here too.
        const appRd = Application.current?.Resources;
        if (appRd !== undefined)
        {
            subscribeOn(appRd);
        }
    }

    private unsubscribe_styles(): void
    {
        if (this._styleSubscriptions === undefined) return;
        for (const unsub of this._styleSubscriptions) unsub();
        this._styleSubscriptions = undefined;
    }

    // Style writes via low-level `set_property_value("Style", …)`
    // (compiler-emitted paths, runtime-installed bindings) bypass the
    // public Style setter and miss its `refresh_active_style` call.
    // Catch them here so the new Style's setters / triggers install
    // no matter how the property is written. Also fans out the
    // ambient-resource-trigger DP cascade (§ 17.1 — ThemeManager-
    // registered Scheme / Theme inherited DPs) so DynamicResource
    // bindings re-resolve against the new scheme. Other DP changes
    // delegate to the base Visual override.
    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        old_value: any,
        new_value: any,
    ): void
    {
        super.OnPropertyChanged(descriptor, old_value, new_value);
        if (descriptor.Name === 'Style') this.refresh_active_style();
        if (inherits(descriptor.MetaData))
        {
            // Cascade the new inherited value to every logical /
            // overlay descendant. The cascade dispatches through
            // Element's `_refresh_inherited` override on each
            // descendant; plain Visual descendants no-op via Visual's
            // stub.
            this.propagate_inheritance_for_children(descriptor);
            this.forEachOverlayChild(c => c._refresh_inherited(descriptor));
            // Ambient resource triggers (§ 17.1) — ThemeManager
            // registers Scheme / Theme as ambient-resource-trigger
            // DPs. When one of those values cascades to this Element,
            // every DynamicResource binding rooted here re-resolves.
            if (ResourceResolver.IsAmbientResourceTriggerDp(descriptor))
            {
                this._fire_dynamic_resource_listeners();
            }
        }

        // Install / uninstall the declarative drag-source latch as
        // IsDraggable flips. Listening on PointerDown/Move/Up rather
        // than overriding the virtuals means subclass overrides of
        // OnPointerDown etc. are untouched — both run.
        if (descriptor.Name === 'IsDraggable')
        {
            const nowDraggable = new_value === true;
            if (nowDraggable && !this._draggableInstalled)
            {
                this.AddRoutedEventListener('PointerDown', this._onDragLatchPointerDown);
                this.AddRoutedEventListener('PointerMove', this._onDragLatchPointerMove);
                this.AddRoutedEventListener('PointerUp',   this._onDragLatchPointerUp);
                this._draggableInstalled = true;
            }
            else if (!nowDraggable && this._draggableInstalled)
            {
                this.RemoveRoutedEventListener('PointerDown', this._onDragLatchPointerDown);
                this.RemoveRoutedEventListener('PointerMove', this._onDragLatchPointerMove);
                this.RemoveRoutedEventListener('PointerUp',   this._onDragLatchPointerUp);
                this._draggableInstalled = false;
                this._draggableLatch = null;
            }
        }
    }

    // ── Triggers (Property / Multi / Data / MultiData / Event) ───────

    // Trigger install / evaluation / teardown machinery lives on
    // `TriggerHost` (§ 1.8). Lazy — Elements that never opt into
    // Style / Triggers pay zero cost.
    private _triggerHost: TriggerHost | undefined;

    // Public hook to wire a stand-alone EventTrigger onto an
    // Element. Templated controls install their own EventTriggers
    // through the Style cascade; this surface is for consumers
    // wiring an EventTrigger directly (rare but documented). Thin
    // aliases for `InstallEventTrigger` / `UninstallEventTrigger`
    // (the `ITriggerHost` surface) — kept for the conventional
    // Add/Remove naming that consumer call sites read with.
    public AddEventTrigger(trigger: EventTrigger): void
    {
        this.InstallEventTrigger(trigger);
    }

    public RemoveEventTrigger(trigger: EventTrigger): void
    {
        this.UninstallEventTrigger(trigger);
    }

    // ── ITriggerHost implementation ──────────────────────────────────
    //
    // Element formally implements `ITriggerHost` by forwarding to a
    // lazily-allocated `TriggerHost`. The seven methods below match
    // the interface signature one-for-one; an Element that never has
    // a trigger installed never allocates a TriggerHost. Called from
    // `StyleApplicator.RefreshActiveStyle` (via the `ITriggerHost`
    // typed reference) during a Style swap and from the public
    // `AddEventTrigger` / `RemoveEventTrigger` consumer surface above.

    public InstallTrigger(trigger: PropertyTrigger): void
    {
        (this._triggerHost ??= new TriggerHost(this)).InstallTrigger(trigger);
    }

    public InstallMultiTrigger(trigger: MultiTrigger): void
    {
        (this._triggerHost ??= new TriggerHost(this)).InstallMultiTrigger(trigger);
    }

    public InstallDataTrigger(trigger: DataTrigger): void
    {
        (this._triggerHost ??= new TriggerHost(this)).InstallDataTrigger(trigger);
    }

    public InstallMultiDataTrigger(trigger: MultiDataTrigger): void
    {
        (this._triggerHost ??= new TriggerHost(this)).InstallMultiDataTrigger(trigger);
    }

    public InstallEventTrigger(trigger: EventTrigger): void
    {
        (this._triggerHost ??= new TriggerHost(this)).InstallEventTrigger(trigger);
    }

    public UninstallTrigger(trigger: PropertyTrigger | MultiTrigger | DataTrigger | MultiDataTrigger): void
    {
        this._triggerHost?.UninstallTrigger(trigger);
    }

    public UninstallEventTrigger(trigger: EventTrigger): void
    {
        this._triggerHost?.UninstallEventTrigger(trigger);
    }

    // ── DynamicResource re-wire support ──────────────────────────────
    //
    // DynamicResource bindings cache their ancestor-chain subscriptions
    // at construction. Reparenting changes the chain (new ancestors
    // visible, old ones gone), so the binding has to re-walk. Each
    // binding registers a re-wire callback via _subscribe_dynamic_resource;
    // AttachLogical / DetachLogical fire them across the subtree.
    private _dynamic_resource_listeners: Array<() => void> | undefined;

    /** @internal — DynamicResourceBinding only. Subscribes a callback
     *  that fires when this Element's ancestor chain may have changed.
     *  Returns an unsubscribe thunk. */
    public _subscribe_dynamic_resource(listener: () => void): () => void
    {
        (this._dynamic_resource_listeners ??= []).push(listener);
        return (): void =>
        {
            if (this._dynamic_resource_listeners === undefined) return;
            const i = this._dynamic_resource_listeners.indexOf(listener);
            if (i >= 0) this._dynamic_resource_listeners.splice(i, 1);
        };
    }

    /** @internal — override of Visual's no-op stub. Fired on the
     *  per-visual edge from `Visual.SetTemplatedParent` so a
     *  freshly-stamped template node's DynamicResource bindings see
     *  the new templated-parent chain. Also called locally from
     *  `_refresh_dynamic_resources_subtree` for the subtree cascade
     *  and from `OnPropertyChanged` for the ambient-resource-trigger
     *  cascade. */
    public override _fire_dynamic_resource_listeners(): void
    {
        safeFire(this._dynamic_resource_listeners);
    }

    /** @internal — § 1.10. Override of Visual's no-op stub. Re-walks
     *  every DynamicResource binding rooted in this subtree so cached
     *  ancestor-chain subscriptions pick up the new chain after a
     *  reparent / theme override. Plain Visual descendants no-op
     *  themselves via the base stub. */
    public override _refresh_dynamic_resources_subtree(): void
    {
        this._fire_dynamic_resource_listeners();
        this.propagate_dynamic_resources_to_logical_children();
        // Overlay children's DynamicResource bindings cached against the
        // OLD chain (before this Element joined / left its ancestor's
        // tree). Re-walking through the popup's subtree re-resolves
        // every `@Token` lookup so theme tokens flip when the owner's
        // chain changes.
        this.forEachOverlayChild(c => c._refresh_dynamic_resources_subtree());
    }

    protected propagate_dynamic_resources_to_logical_children(): void
    {
        this.forEachLogicalChild(c => c._refresh_dynamic_resources_subtree());
    }

    /** @internal — § 1.10. Override of Visual's no-op stub. Walks
     *  this Element and every logical / overlay descendant, re-
     *  resolving implicit + theme styles and re-subscribing to
     *  ancestor ResourceDictionary changes. Recursion dispatches
     *  through Visual.`_refresh_styles_subtree` so plain Visual
     *  descendants no-op themselves; Element descendants run their
     *  override. */
    public override _refresh_styles_subtree(): void
    {
        this.unsubscribe_styles();
        this.resolve_implicit_style();
        this.resolve_theme_style();
        this.subscribe_styles();
        for (const c of this.allLogicalDescendantSubtreeRoots())
        {
            c._refresh_styles_subtree();
        }
    }

    /** @internal — § 1.10. See `_refresh_styles_subtree`. Tears down
     *  ancestor ResourceDictionary subscriptions across the subtree
     *  before a detach so they can't fire through the still-attached
     *  chain. */
    public override _unsubscribe_styles_subtree(): void
    {
        this.unsubscribe_styles();
        for (const c of this.allLogicalDescendantSubtreeRoots())
        {
            c._unsubscribe_styles_subtree();
        }
    }

    // ── Name + NameScope + FindName (§ Phase B / B4.6) ────────────────

    // Optional x:Name-equivalent — a stable identifier used by
    // FindName to look this Element up later. Backed by `_name`
    // because Visual exposes Name as a no-op accessor pair; a TS
    // subclass overrides accessors with accessors.
    private _name: string | undefined;
    public override get Name(): string | undefined { return this._name; }
    public override set Name(v: string | undefined) { this._name = v; }

    // Per-instance NameScope attached to this Element. When set,
    // this Element is the boundary for FindName lookups from any
    // logical descendant — the walk stops here and resolves in this
    // scope. ControlTemplate.Apply attaches a fresh NameScope to the
    // template root so each template instance gets its own name
    // space (PART_Background in two Button templates don't collide).
    private _nameScope: NameScope | undefined;

    public override get nameScope(): NameScope | undefined
    {
        return this._nameScope;
    }

    public override SetNameScope(scope: NameScope | undefined): void
    {
        this._nameScope = scope;
    }

    // Resolves an x:Name to a Visual within the nearest enclosing
    // NameScope. Walks up logical ancestors (with templatedParent
    // fallback for template internals — same path as walk_inherited)
    // until it hits the first Element carrying a NameScope, then
    // resolves in that scope. Returns undefined when no ancestor
    // carries a scope, or when the name isn't registered in the
    // scope that's found.
    public override FindName(name: string): Visual | undefined
    {
        let cursor: Element | undefined = this;
        while (cursor !== undefined)
        {
            if (cursor._nameScope !== undefined)
            {
                return cursor._nameScope.Find(name);
            }
            const next: Visual | undefined = cursor._logicalParent ?? cursor._templatedParent;
            // The cursor walks Element ancestors. A plain-Visual parent
            // (rare; production has none) terminates the walk — it owns
            // no NameScope and no further logical/templated parent.
            cursor = next instanceof Element ? next : undefined;
        }
        return undefined;
    }

    // ── Templated-parent back-pointer (§ Phase B / B4.5) ─────────────

    // The control whose ControlTemplate generated this Element, or
    // undefined for Elements the consumer authored directly. Set by
    // the template-apply pipeline on every node in a template's
    // generated subtree. Read by TemplateBinding, walk_inherited
    // (template internals fall back here to reach the templated
    // control's logical ancestry), and ResourceResolver.
    private _templatedParent: Visual | undefined;

    public override get templatedParent(): Visual | undefined
    {
        return this._templatedParent;
    }

    public override SetTemplatedParent(p: Visual | undefined): void
    {
        const changed = this._templatedParent !== p;
        this._templatedParent = p;
        // Re-fire DynamicResource bindings attached to this Element.
        // Bindings constructed inside a ControlTemplate factory walk
        // the ancestor chain at construction time — when the element
        // had no templated parent yet — and would otherwise hold an
        // empty resolution chain. Stamping the templated parent
        // expands the chain (templatedParent fallback now reaches the
        // owning Application's Resources via the templated control's
        // ancestors), so the binding needs a chance to re-resolve.
        if (changed) this._fire_dynamic_resource_listeners();
    }

    // ── Logical-tree parent (FE-tier inheritance + resource chain) ────

    // Parent in the LOGICAL tree — what property inheritance and
    // resource lookup walk. Set by AttachLogical (still on Visual
    // pre-B4.3), cleared by DetachLogical. For Elements added through
    // the normal `Attach` helper, logicalParent === visualParent. Only
    // the field lives here; AttachLogical / DetachLogical themselves
    // move in B4.3 alongside the inheritance / style cascades that
    // their wiring fires. Typed `Visual | undefined` to match the
    // friend-interface shape Visual code uses to read it through
    // `ElementLogicalChain`.
    private _logicalParent: Visual | undefined;

    protected override get logicalParent(): Visual | undefined
    {
        return this._logicalParent;
    }

    public override GetLogicalParent(): Visual | undefined
    {
        return this._logicalParent;
    }

    protected override SetLogicalParent(p: Visual | undefined): void
    {
        this._logicalParent = p;
    }

    // ── Property-value inheritance (§ Phase B / B4.4) ─────────────────

    private walk_inherited(key: string): unknown | undefined
    {
        // Inheritance follows the LOGICAL tree — DataContext, font
        // properties, etc. flow through "where the consumer wrote
        // this", not "where the template put it visually". For all
        // non-templated trees the logical and visual parents are the
        // same instance, so behavior matches the pre-split codebase.
        //
        // For template-generated Elements (templatedParent set), the
        // top of the logical chain hops onto the templated control —
        // template internals inherit from the consumer's authored
        // ancestry, with the templated control as the bridge.
        //
        // `_logicalParent` (B4.2) and `_templatedParent` (B4.5) are
        // both Element-private fields. The cursor walks Element
        // ancestors and accesses them directly.
        let cursor: Element = this;
        while (true)
        {
            const next = cursor._logicalParent ?? cursor._templatedParent;
            if (next === undefined) break;
            const evd = propertyValues(next).get(key);
            if (evd !== undefined && evd.Source !== PropertyValueSource.Default)
            {
                return evd.value;
            }
            // The cursor walks Element ancestors. Plain Visual parents
            // (rare; production has none) would terminate the walk —
            // their EVD bag would still be inspectable above, but their
            // `_logicalParent` is Visual's no-op stub returning
            // undefined, so the next iteration would exit.
            if (!(next instanceof Element)) break;
            cursor = next;
        }

        // VISUAL-tree fallback. Slotted content (a ContentControl's
        // Content, an item container's child) hangs off the presenter
        // VISUALLY but off the control LOGICALLY — so a value set inside
        // a ControlTemplate (e.g. `TextBlock.Foreground` on a PART_Border)
        // never reaches it through the logical walk above. Walk the visual
        // ancestors to pick those up, matching WPF's visual-tree
        // inheritance for text styling. Logical resolution always wins
        // (checked first), so nothing already-resolving changes; this only
        // fills in keys the authored/logical chain left at Default.
        //
        // DataContext is EXCLUDED: it must follow the authored/logical
        // context (the control / data item), never the template's visual
        // placement — that invariant is why the two-tree split exists.
        if (key !== Element.dataContextComposedKey())
        {
            let v: Visual | undefined = this.GetVisualParent();
            while (v !== undefined)
            {
                if (v instanceof Element)
                {
                    const evd = propertyValues(v).get(key);
                    if (evd !== undefined && evd.Source !== PropertyValueSource.Default)
                    {
                        return evd.value;
                    }
                }
                v = v.GetVisualParent();
            }
        }
        return undefined;
    }

    // Composed key for Element.DataContext, computed lazily (the static
    // can't reference `Element` during its own class initialization).
    private static _dataContextComposedKey: string | undefined;
    private static dataContextComposedKey(): string
    {
        return (Element._dataContextComposedKey ??=
            MuralBase.compose_key(Element, 'DataContext'));
    }

    /** @internal — the DataContext this element would INHERIT from its
     *  logical ancestry, ignoring any value set locally on this element.
     *
     *  Consumed by DataContextBinding for the self-referential case
     *  `DataContext = $Path` (WPF's `DataContext="{Binding Path}"`): the
     *  path must resolve against the CONTEXT THE PARENT PROVIDES, not the
     *  element's own DataContext — which, when a binding is producing it,
     *  is the circular value the binding is itself computing. Reads the
     *  same logical walk inheritance uses, so the binding sees exactly the
     *  value that would have flowed in without the local override. */
    public GetInheritedDataContext(): unknown
    {
        return this.walk_inherited(Element.dataContextComposedKey());
    }

    /** @internal — § 1.10. Override of Visual's no-op stub. Re-
     *  resolves the inherited value for the given descriptor on this
     *  Element; the subtree cascade runs through the logical +
     *  overlay subtree via the propagate_inheritance_* virtuals. */
    public override _refresh_inherited(descriptor: PropertyDescriptor): void
    {
        if (!inherits(descriptor.MetaData)) return;
        const key = descriptor.ComposedKey;
        const value = this.walk_inherited(key);
        if (value !== undefined)
        {
            this['ensure_effective_value_for'](descriptor).SetInheritedValue(value);
        }
        else
        {
            propertyValues(this).get(key)?.ClearInherited();
        }
    }

    /** @internal — § 1.10. Override of Visual's no-op stub. Refresh
     *  every inheritable DP on this Element and cascade through the
     *  logical + overlay subtree. Fired when the ancestor chain
     *  restructures. */
    public override _refresh_inheritance_subtree(): void
    {
        // Resolve ALL inheritable descriptors for this node in ONE ancestor
        // climb (refresh_inherited_batch) rather than a per-descriptor
        // `_refresh_inherited` call that each re-walks the whole ancestor
        // chain. A subtree refresh (attach / reparent) touches every node ×
        // every inheritable DP, so this per-node fold from K climbs to one
        // is the single biggest lever on the refresh cost — the profiled
        // `walk_inherited` hot path.
        // CHANGE-GATED CASCADE. Only recurse into the subtree when refreshing
        // THIS node actually changed one of its descendant-visible ("provided")
        // inherited values. If none changed, every descendant is provably
        // unchanged too — a descendant resolves each key from its nearest
        // providing ancestor, and if this node's provided values held steady
        // then either it shadows the key (a local value, unaffected) or its own
        // inherited value didn't move (so nothing above it moved either). This
        // is what collapses bottom-up assembly from O(N²) to O(N): attaching a
        // bare container node (which provides no inherited values) no longer
        // re-walks the subtree it already carries.
        if (!this.refresh_inherited_batch(Visual._collect_inheritable_keyed(this.constructor))) return;
        this.propagate_inheritance_to_children();
        // Overlay children participate alongside logical children —
        // they're the same logical tree from the popup's perspective.
        this.forEachOverlayChild(c => c._refresh_inheritance_subtree());
    }

    /** @internal — resolve every inheritable descriptor in a SINGLE ancestor
     *  traversal and apply the results, reproducing `walk_inherited`'s exact
     *  per-key priority (nearest logical/templatedParent ancestor with a
     *  non-default value wins; the visual-parent chain is the fallback, with
     *  DataContext excluded from it) but paying the climb once instead of
     *  once per descriptor. Used only by the all-descriptors subtree refresh;
     *  the single-descriptor cascade still routes through `_refresh_inherited`. */
    private refresh_inherited_batch(entries: readonly InheritableEntry[]): boolean
    {
        const n = entries.length;
        if (n === 0) return false;

        // Parallel per-index state (no Map / no compose_key per call — the
        // composite keys are precomputed + cached on `entries`). `found[i]`
        // marks a key already resolved so later ancestors skip it; `remaining`
        // lets the climb stop the instant every key has a value.
        const values: unknown[] = new Array(n);
        const found: boolean[] = new Array(n).fill(false);
        let remaining = n;

        // Phase 1 — logical / templatedParent chain (walk_inherited's primary
        // path). Each key resolves at the first ancestor carrying a
        // non-default value for it; different keys may stop at different depths.
        let cursor: Element = this;
        while (remaining > 0)
        {
            const next = cursor._logicalParent ?? cursor._templatedParent;
            if (next === undefined) break;
            const bag = propertyValues(next);
            for (let i = 0; i < n; i++)
            {
                if (found[i]) continue;
                const evd = bag.get(entries[i]!.key);
                if (evd !== undefined && evd.Source !== PropertyValueSource.Default)
                {
                    values[i] = evd.value; found[i] = true; remaining--;
                }
            }
            // A plain Visual parent (no logical-tree state) terminates the
            // walk — its bag was still inspected above, matching walk_inherited.
            if (!(next instanceof Element)) break;
            cursor = next;
        }

        // Phase 2 — visual-parent fallback for keys the logical chain left
        // unresolved (styling set inside a ControlTemplate reaching slotted
        // content). DataContext is NEVER resolved through the visual tree.
        if (remaining > 0)
        {
            const dck = Element.dataContextComposedKey();
            let v: Visual | undefined = this.GetVisualParent();
            while (v !== undefined && remaining > 0)
            {
                if (v instanceof Element)
                {
                    const bag = propertyValues(v);
                    for (let i = 0; i < n; i++)
                    {
                        if (found[i] || entries[i]!.key === dck) continue;
                        const evd = bag.get(entries[i]!.key);
                        if (evd !== undefined && evd.Source !== PropertyValueSource.Default)
                        {
                            values[i] = evd.value; found[i] = true; remaining--;
                        }
                    }
                }
                v = v.GetVisualParent();
            }
        }

        // Apply — resolved keys take their inherited value; the rest clear any
        // stale inherited value (mirrors _refresh_inherited's two branches).
        // While applying, track whether any DESCENDANT-VISIBLE value moved: the
        // value a child's walk reads from this node for a key is its EVD value
        // when the winning source isn't Default, else "not provided" (the child
        // looks past this node). Comparing that before vs. after per key tells
        // the caller whether the subtree needs cascading — see the gate in
        // `_refresh_inheritance_subtree`.
        const pv = propertyValues(this);
        let changed = false;
        for (let i = 0; i < n; i++)
        {
            const key = entries[i]!.key;
            const before = providedValue(pv.get(key));
            if (found[i])
            {
                this['ensure_effective_value_for'](entries[i]!.descriptor).SetInheritedValue(values[i]);
            }
            else
            {
                pv.get(key)?.ClearInherited();
            }
            if (!changed && before !== providedValue(pv.get(key))) changed = true;
        }
        return changed;
    }

    // Children that participate in property-value inheritance from this
    // node — the UNION of logical children and visual children, deduped
    // by identity. Logical children are the authored content model;
    // visual-only children are template-placed parts (a templated
    // control's root, a ContentPresenter's slotted content, an items
    // panel) that hang off `this` visually but never became logical
    // children. Both must observe an inherited-value change, so the
    // cascade fans out to both HERE, in one place — no per-control
    // override.
    //
    // DataContext is deliberately NOT special-cased: it propagates to
    // every child, and each child re-resolves it through walk_inherited,
    // which routes DataContext via the logical / templatedParent chain
    // only (the visual-parent fallback still excludes it). So pushing the
    // refresh to a visual-only child never lets DataContext leak across
    // raw visual nesting — the read side keeps that invariant.
    protected forEachInheritanceChild(fn: (child: Element) => void): void
    {
        const seen = new Set<Visual>();
        const visit = (c: Visual): void =>
        {
            if (c instanceof Element && !seen.has(c)) { seen.add(c); fn(c); }
        };
        for (const c of this.logicalChildren) visit(c);
        for (const c of this.visualChildren)  visit(c);
    }

    protected propagate_inheritance_to_children(): void
    {
        this.forEachInheritanceChild(c => c._refresh_inheritance_subtree());
    }

    protected propagate_inheritance_for_children(descriptor: PropertyDescriptor): void
    {
        this.forEachInheritanceChild(c => c._refresh_inherited(descriptor));
    }

    // ── Logical-tree attach / detach (§ Phase B / B4.3) ──────────────

    // Convenience for the common case where a child belongs to BOTH
    // trees with the same parent — every user-supplied child of a
    // non-templated Panel or Single goes through here. Templated
    // controls call AttachVisual and AttachLogical independently when
    // the trees diverge. AttachVisual lives on Visual (visual-tree
    // hop) and is inherited; AttachLogical lives here (FE-tier).
    protected Attach(child: Visual): void
    {
        this.AttachVisual(child);
        this.AttachLogical(child);
    }

    protected Detach(child: Visual): void
    {
        // Sever the VISUAL link before the logical one. DetachLogical
        // refreshes property inheritance, and walk_inherited now consults
        // the visual-parent chain as a fallback (so template-set styling
        // reaches slotted content) — so the visual parent must already be
        // gone, or a child being removed would transiently re-inherit from
        // its old parent through that fallback and cache a stale value.
        // DetachVisual only clears the visual parent + target, so it has no
        // dependency on the logical side being intact.
        this.DetachVisual(child);
        this.DetachLogical(child);
    }

    // LOGICAL-tree wiring only: sets the child's logical parent and
    // refreshes property-value inheritance for the new ancestry. Use
    // directly from templating code when slotting consumer-supplied
    // logical content into a templated control (the child's visual
    // parent is set separately by the ContentPresenter /
    // ItemsPresenter doing the visual slotting). Accepts `Visual`
    // because callers' references are Visual-typed; non-Element
    // children silently no-op for the logical-tree state writes
    // (`SetLogicalParent` is a Visual-tier no-op stub on plain
    // Visuals — B4.2) and skip the cascade calls (also Visual stubs).
    protected AttachLogical(child: Visual): void
    {
        if (child === this)
        {
            throw new Error('An Element cannot be its own logical child.');
        }
        // Plain Visuals carry no logical-tree state — the
        // SetLogicalParent / inheritance / style / DynamicResource
        // cascades are all FE-tier. Skip silently for non-Element
        // children; the AttachVisual hop in `Attach()` still runs.
        if (!(child instanceof Element)) return;
        // The Element overrides of GetLogicalParent (B4.2) return the
        // actual parent; the check catches Element children that
        // already have a parent.
        if (child.GetLogicalParent() !== undefined)
        {
            throw new Error('Element already has a logical parent; detach it from the current parent first.');
        }
        child.SetLogicalParent(this);
        child._refresh_inheritance_subtree();
        // Style lookups run AFTER inheritance refresh — the resource
        // chain now reflects the child's new ancestry, so the
        // type-keyed Style lookup (implicit via constructor + theme
        // via DefaultStyleKey) sees what the consumer would see at
        // this position in the tree.
        child._refresh_styles_subtree();
        // DynamicResource bindings cached their ancestor-chain
        // subscriptions at construction. Reparenting grew (or shrank)
        // that chain — re-walk so any new ancestor's Resources dict
        // becomes observable.
        child._refresh_dynamic_resources_subtree();
    }

    protected DetachLogical(child: Visual): void
    {
        // Mirrors AttachLogical: plain Visuals carry no logical-tree
        // state, so DetachLogical is a no-op for them. The DetachVisual
        // hop in `Detach()` still tears down the visual side.
        if (!(child instanceof Element)) return;
        if (child.GetLogicalParent() !== this)
        {
            throw new Error('Cannot detach an Element that is not a logical child of this.');
        }
        // Tear down ancestor-resource subscriptions FIRST (whole
        // subtree) so a mutation on the now-detached chain doesn't
        // fire resolve_implicit_style / resolve_theme_style through
        // stale subs.
        child._unsubscribe_styles_subtree();
        child.SetLogicalParent(undefined);
        child._refresh_inheritance_subtree();
        // No ancestor chain anymore — re-resolve drops any inherited
        // implicit or theme style across the subtree.
        child._refresh_styles_subtree();
        // DynamicResource bindings re-walk their ancestor chain.
        child._refresh_dynamic_resources_subtree();
    }

    /** @internal Detach this Element from its current logical parent, if any.
     *  Logical-tree companion to Visual._release_from_visual_parent: a content
     *  host (ContentControl) calls it to CLAIM a shared Visual that a discarded
     *  prior view still holds as a logical child, instead of hitting the
     *  single-parent guard in AttachLogical. No-op when already parentless. */
    public override _release_from_logical_parent(): void
    {
        const parent = this.GetLogicalParent();
        if (parent instanceof Element) parent.DetachLogical(this);
    }

    // ── Overlay children (logical-owner-side wiring) ─────────────────
    //
    // Elements that THIS Element owns as overlay-mounted children —
    // popups, dropdowns, drag previews, tooltips. Distinct from visual
    // children (which paint as descendants in the visualParent's slot)
    // and from standard logical children: an overlay child has its
    // VISUAL parent set to the host's OverlayLayer but its LOGICAL
    // parent set to this Element (so resource / DataContext /
    // inheritable-DP cascades flow from the owning control, not from
    // the overlay layer — see § 18.10). Populated by
    // `AttachOverlayChild`, cleared by `DetachOverlayChild`. Walked
    // alongside `logicalChildren` by the inheritance / style /
    // dynamic-resource subtree cascades.
    private _overlayChildren: Visual[] | undefined;

    // Cascade-iteration helper (§ 1.5). Yields every direct subtree
    // root that should receive a subtree-wide refresh — logical
    // children for the main tree, plus any overlay children. Override
    // of Visual's empty generator so cascades that walk overlay roots
    // (Style / Resources / DynamicResource subtree refresh) see them.
    protected override *allLogicalDescendantSubtreeRoots(): IterableIterator<Visual>
    {
        for (const c of this.logicalChildren) yield c;
        if (this._overlayChildren !== undefined)
        {
            for (const c of this._overlayChildren) yield c;
        }
    }

    // Companion helper for hot-path cascades that already use the
    // `propagate_*_to_logical_children` virtual quartet. Calling this
    // immediately after the propagate_* call covers the overlay branch
    // without re-traversing the main logical tree.
    protected override forEachOverlayChild(fn: (child: Visual) => void): void
    {
        if (this._overlayChildren === undefined) return;
        for (const c of this._overlayChildren) fn(c);
    }

    /** Public-but-not-for-consumer-use. Attaches `child` as an
     *  overlay-mounted logical child of this Element: visual hop
     *  into the host's OverlayLayer; logical hop sets `child`'s
     *  logicalParent to this. Symmetric with AddChild / RemoveChild
     *  for the in-tree case. Throws if this Element has no host
     *  target yet — the visual hop can't resolve without one. */
    public override AttachOverlayChild(child: Visual): void
    {
        const t = this['target'] as ReturnType<Visual['FindAncestorPresentationTarget']>;
        if (t === undefined)
        {
            throw new Error(
                'Element.AttachOverlayChild: this Element is not attached to a presentation target — '
                + 'wait until the owner is mounted before attaching overlay children.',
            );
        }
        // Logical hop is idempotent — controls that re-mount their
        // popup across a host-target swap tear down the visual hop
        // directly via `oldTarget.DetachOverlay` and then call
        // AttachOverlayChild again. The logical relationship persists;
        // only the visual hop flips.
        const alreadyOwned = this._overlayChildren?.includes(child) === true;
        if (!alreadyOwned)
        {
            if (this._overlayChildren === undefined) this._overlayChildren = [];
            this._overlayChildren.push(child);
            // Logical hop: child._logicalParent = this; runs the
            // inheritance / style / DynamicResource refreshes through
            // child's subtree.
            this.AttachLogical(child);
        }
        // Visual hop: the host materialises its OverlayLayer (if not
        // yet present) and adds the child as a VISUAL-only panel
        // child.
        t.AttachOverlay(child);
    }

    public override DetachOverlayChild(child: Visual): void
    {
        const t = this['target'] as ReturnType<Visual['FindAncestorPresentationTarget']>;
        // Visual hop first so the renderer drops the child before its
        // logical owner releases inheritance state.
        if (t !== undefined) t.DetachOverlay(child);
        if (this._overlayChildren !== undefined)
        {
            const i = this._overlayChildren.indexOf(child);
            if (i >= 0) this._overlayChildren.splice(i, 1);
        }
        // Detach the logical hop only if it still points here — the
        // child may have been re-parented externally (rare).
        if (child.GetLogicalParent() === this) this.DetachLogical(child);
    }

    // ── Lifecycle listeners ───────────────────────────────────────────
    //
    // Loaded — fires exactly once when this Element first attaches to
    // a target. Adding a listener AFTER the Element is already loaded
    // fires it synchronously (matches the React useEffect mount
    // shape — a registered listener never misses the load event).
    //
    // § 1.11 — the symmetric per-attach pair lives on
    // `_attachedListeners` below. Behaviors wiring (setUp, tearDown)
    // wants Attached + Detached (every attach + every detach);
    // WPF-parity consumers wanting `FrameworkElement.Loaded` once-only
    // stay on Loaded + Unloaded. Detached is wired as an alias to
    // Unloaded — same edges, kept separate listener storage so
    // authors can read their intent off the wiring
    // (`AddDetachedListener` signals "I want Attached/Detached
    // symmetry" without forcing the existing Unloaded callers to
    // migrate).
    private _loadedListeners:   Set<() => void> | undefined;
    private _attachedListeners: Set<() => void> | undefined;
    private _unloadedListeners: Set<() => void> | undefined;
    private _hasFiredLoaded: boolean = false;

    public AddLoadedListener(listener: () => void): void
    {
        (this._loadedListeners ??= new Set()).add(listener);
        // Already loaded — fire synchronously so consumers attaching
        // after mount still see the load edge.
        if (this._hasFiredLoaded) listener();
    }

    public RemoveLoadedListener(listener: () => void): void
    {
        this._loadedListeners?.delete(listener);
    }

    /** § 1.11 — Per-attach edge listener. Fires every time this
     *  Element's visualParent transitions from undefined to defined,
     *  including re-attaches after a detach (recycled containers,
     *  popups mounted+unmounted across hover edges). Symmetric with
     *  `AddUnloadedListener` / `AddDetachedListener`. If the Element
     *  is already attached at registration time, the listener fires
     *  synchronously so consumers don't miss the current edge. */
    public AddAttachedListener(listener: () => void): void
    {
        (this._attachedListeners ??= new Set()).add(listener);
        if (this['target'] !== undefined) listener();
    }

    public RemoveAttachedListener(listener: () => void): void
    {
        this._attachedListeners?.delete(listener);
    }

    // Unloaded — fires on every `visualParent` defined → undefined
    // edge (not one-shot like Loaded). A Visual that's added →
    // removed → added → removed fires Unloaded twice. The asymmetry
    // is pragmatic — behaviors that need to release a resource on
    // detach should run their cleanup each time the Element leaves
    // the tree.
    public AddUnloadedListener(listener: () => void): void
    {
        (this._unloadedListeners ??= new Set()).add(listener);
    }

    public RemoveUnloadedListener(listener: () => void): void
    {
        this._unloadedListeners?.delete(listener);
    }

    /** § 1.11 — Symmetric companion to `AddAttachedListener`. Wired
     *  as an alias to `AddUnloadedListener` — same per-detach edges,
     *  separate name so authors picking the per-attach / per-detach
     *  pair signal their intent at the wiring site. WPF-parity
     *  consumers (Loaded + Unloaded) stay on the existing methods. */
    public AddDetachedListener(listener: () => void): void
    {
        this.AddUnloadedListener(listener);
    }

    public RemoveDetachedListener(listener: () => void): void
    {
        this.RemoveUnloadedListener(listener);
    }

    // Hooks fired by Visual.SetTarget / Visual.SetVisualParent — see
    // `on_attach_edge` / `on_detach_edge` on Visual.
    protected override on_attach_edge(): void
    {
        // Loaded: one-shot. Subsequent re-attach cycles never re-fire.
        if (!this._hasFiredLoaded)
        {
            this._hasFiredLoaded = true;
            safeFire(this._loadedListeners);
        }
        // Attached: every attach edge.
        safeFire(this._attachedListeners);
    }

    protected override on_detach_edge(): void
    {
        safeFire(this._unloadedListeners);
    }

    // ── Behavior attachment ───────────────────────────────────────────
    //
    // Behaviors are markup-attachable wiring objects (see
    // [./behavior.ts](./behavior.ts)). The compiler emits per-element
    // `<element>.AddBehavior(<behavior>)` after constructing the
    // behavior and applying its DP setters, so by the time
    // `OnAttached` fires the behavior's per-instance properties are
    // already populated.
    //
    // The Element holds a reference to every attached behavior so it
    // can survive GC alongside the Element itself; that matches the
    // behavior's natural lifetime — it's wired up to listen on the
    // Element it was attached to, so as long as the Element is alive
    // the behavior should be too.
    private _behaviors: Behavior[] | undefined;
    // Per-behavior unload listener — kept so `RemoveBehavior` can
    // pull the listener back off `AddUnloadedListener` and fire
    // `OnDetached` exactly once on imperative removal (vs. the
    // unload edge firing it later anyway).
    private _behaviorUnloadListeners: Map<Behavior, () => void> | undefined;

    public AddBehavior(behavior: Behavior): void
    {
        (this._behaviors ??= []).push(behavior);
        // Auto-wire OnDetached via the Unloaded listener so behaviors
        // get a teardown edge without their author writing the
        // subscription themselves. Each detach fires OnDetached again
        // (matching the underlying Unloaded semantics) — a behavior
        // that needs once-only teardown should track that itself.
        const onUnloaded = (): void => { behavior.OnDetached(this); };
        this.AddUnloadedListener(onUnloaded);
        (this._behaviorUnloadListeners ??= new Map()).set(behavior, onUnloaded);
        behavior.OnAttached(this);
    }

    // Imperative companion to AddBehavior — used by triggered-behavior
    // actions (style triggers with a Behaviors block) and any consumer
    // that needs to drop a behavior before the Element is unloaded.
    // Fires `OnDetached` once and unsubscribes the unload listener so
    // a later Unloaded edge doesn't fire `OnDetached` a second time.
    // No-op when `behavior` is not currently attached.
    public RemoveBehavior(behavior: Behavior): void
    {
        if (this._behaviors === undefined) return;
        const idx = this._behaviors.indexOf(behavior);
        if (idx < 0) return;
        this._behaviors.splice(idx, 1);

        const onUnloaded = this._behaviorUnloadListeners?.get(behavior);
        if (onUnloaded !== undefined)
        {
            this.RemoveUnloadedListener(onUnloaded);
            this._behaviorUnloadListeners!.delete(behavior);
        }
        behavior.OnDetached(this);
    }

    public get Behaviors(): readonly Behavior[]
    {
        return this._behaviors ?? [];
    }

    // ══════════════════════════════════════════════════════════════════
    // Input — routed-event virtuals, input-state DPs, focus, hit-test,
    // per-instance routed-listener registry, declarative drag source.
    //
    // Moved from `Visual` (§ Phase B / input): the whole input surface is
    // FE-tier. The routed-event dispatcher, InputManager, and the
    // InputBinding table all operate on `Element` now — every node that
    // participates in routing is an Element. `Visual` keeps no-op accessor
    // stubs for the public reads so a Visual-typed reference still
    // typechecks; the protected virtuals and the routed-listener registry
    // live ONLY here.
    // ══════════════════════════════════════════════════════════════════

    // Input-state flags. Maintained by the InputManager + per-control
    // press chrome (Button / ClickableBorder), not by user code.
    // Read-only DPs (§ 1.13) — external `set_property_value` writes throw;
    // maintainers route through the typed `_setIsXxx` @internal methods.
    public static readonly IsMouseOverKey = MuralBase.RegisterReadOnlyProperty<boolean>(Element, 'IsMouseOver', false, MetaData.None);
    public static readonly IsPressedKey   = MuralBase.RegisterReadOnlyProperty<boolean>(Element, 'IsPressed',   false, MetaData.None);
    // IsFocused — true when this Element is the InputManager's current
    // focused target. Read-only; use `Focus()` / `Blur()` to change.
    public static readonly IsFocusedKey   = MuralBase.RegisterReadOnlyProperty<boolean>(Element, 'IsFocused',   false, MetaData.None);

    // IsKeyboardFocusWithin — true when this Element OR any descendant holds
    // keyboard focus (WPF parity). Maintained by InputManager.SetFocus, which
    // sets it up the focused element's visual-parent chain and clears it up the
    // previous one's. Read-only; a container styles its "focus is within me"
    // state via `when($IsKeyboardFocusWithin)` (e.g. an active-pane affordance).
    public static readonly IsKeyboardFocusWithinKey = MuralBase.RegisterReadOnlyProperty<boolean>(
        Element, 'IsKeyboardFocusWithin', false, MetaData.None);

    // Drop-target flags. AllowDrop is consumer-set (defaults false so a
    // random Element never accidentally accepts drops); IsDragOver is
    // framework-written and behaves like IsMouseOver — public read, no
    // public setter (Style triggers like `when{ IsDragOver }` read it).
    public static readonly AllowDropKey  = MuralBase.RegisterProperty<boolean>(Element, 'AllowDrop',  false, MetaData.None);
    public static readonly IsDragOverKey = MuralBase.RegisterReadOnlyProperty<boolean>(Element, 'IsDragOver', false, MetaData.None);

    // Hit-test opt-out (WPF parity — UIElement.IsHitTestVisible). When
    // false, this Element AND its visual subtree are transparent to the
    // hit-test pipeline. Renderer emits `pointer-events="none"` on the
    // outer <g>; the routed-event dispatcher skips it in the route walk.
    // MetaData.Render so flips repaint without further wiring.
    public static readonly IsHitTestVisibleKey = MuralBase.RegisterProperty<boolean>(Element, 'IsHitTestVisible', true, MetaData.Render);

    // Focusable — opt-in for keyboard focus. Default false so a random
    // Border / TextBlock / Panel never accidentally swallows keys;
    // controls that handle keyboard input (TextBox, Button) set this to
    // true. The InputManager refuses to focus an Element whose Focusable
    // is false.
    public static readonly FocusableKey = MuralBase.RegisterProperty<boolean>(Element, 'Focusable', false, MetaData.None);

    // Keyboard-navigation order (WPF parity). `IsTabStop` opts an element
    // into Tab traversal (true by default — WPF Control default); a
    // focusable element with IsTabStop=false can be focused
    // programmatically / by click but is skipped by Tab. `TabIndex`
    // orders the tab sequence ascending; equal indices fall back to
    // document (visual-tree) order. Default TabIndex is +Infinity so an
    // unset element sorts AFTER any explicitly-indexed one (mirrors WPF's
    // Int32.MaxValue default).
    public static readonly IsTabStopKey = MuralBase.RegisterProperty<boolean>(Element, 'IsTabStop', true, MetaData.None);
    public static readonly TabIndexKey  = MuralBase.RegisterProperty<number>(Element, 'TabIndex', Number.POSITIVE_INFINITY, MetaData.None);

    // Touch-manipulation opt-in (WPF parity). When true, touch contacts
    // on this element drive Manipulation* routed events (pan / pinch /
    // rotate + inertia) via the InputManager's ManipulationCoordinator.
    public static readonly IsManipulationEnabledKey = MuralBase.RegisterProperty<boolean>(Element, 'IsManipulationEnabled', false, MetaData.None);

    // Declarative drag source. When IsDraggable = true the framework
    // installs a PointerDown / Move / Up latch (see _onDragLatch* below)
    // that calls OnDragStart after the pointer travels >
    // DragDrop.DragThreshold pixels. The callback returns either null
    // (cancel) or { data, effects, preview? } which the framework feeds
    // straight into DragDrop.DoDragDrop. Spec § 6.
    public static readonly IsDraggableKey = MuralBase.RegisterProperty<boolean>(Element, 'IsDraggable', false, MetaData.None);
    // Declarative drag-source callback. See `DragStartCallback` /
    // `DragStartSpec` in drag-drop.ts for the return-shape contract.
    public static readonly OnDragStartKey = MuralBase.RegisterProperty<DragStartCallback | undefined>(Element, 'OnDragStart', undefined, MetaData.None);

    // Input state — read-only mirrors of the DPs, set exclusively by the
    // InputManager during pointer dispatch.
    public override get IsMouseOver(): boolean { return this.get_property_value(Element.IsMouseOverKey); }
    public override get IsPressed():   boolean { return this.get_property_value(Element.IsPressedKey); }

    /** @internal — InputManager only. Typed writeback for the read-only
     *  `IsMouseOver` DP (§ 1.13). Routes through the privileged
     *  `set_property_value_with_key` so the read-only contract holds for
     *  external callers. */
    public _setIsMouseOver(value: boolean): void
    {
        this.set_property_value_with_key(Element.IsMouseOverKey, value);
    }

    /** @internal — Button / ClickableBorder / InputManager only. Typed
     *  writeback for the read-only `IsPressed` DP (§ 1.13). */
    public _setIsPressed(value: boolean): void
    {
        this.set_property_value_with_key(Element.IsPressedKey, value);
    }

    public override get IsFocused(): boolean { return this.get_property_value(Element.IsFocusedKey); }

    /** @internal — InputManager only. Typed writeback for the read-only
     *  `IsFocused` DP (§ 1.13). */
    public _setIsFocused(value: boolean): void
    {
        this.set_property_value_with_key(Element.IsFocusedKey, value);
    }

    public override get IsKeyboardFocusWithin(): boolean { return this.get_property_value(Element.IsKeyboardFocusWithinKey); }

    /** @internal — InputManager only. Typed writeback for the read-only
     *  `IsKeyboardFocusWithin` DP — set/cleared along a focused element's
     *  visual-parent chain on every focus move. */
    public _setIsKeyboardFocusWithin(value: boolean): void
    {
        this.set_property_value_with_key(Element.IsKeyboardFocusWithinKey, value);
    }

    // Drop-target opt-in. The InputManager's drag dispatcher walks the
    // visual ancestor chain from the pointer-hit Element until it finds
    // one with AllowDrop=true (`findAllowDropAncestor`); that Element
    // becomes the drag receiver.
    public override get AllowDrop(): boolean { return this.get_property_value(Element.AllowDropKey); }
    public override set AllowDrop(v: boolean) { this.set_property_value(Element.AllowDropKey, v); }

    // Framework-written mirror of "this Element is the current drag
    // receiver". Read-only (§ 1.13) — InputManager writes through
    // `_setIsDragOver` below.
    public override get IsDragOver(): boolean { return this.get_property_value(Element.IsDragOverKey); }

    /** @internal — InputManager only. Typed writeback for the read-only
     *  `IsDragOver` DP (§ 1.13). */
    public _setIsDragOver(value: boolean): void
    {
        this.set_property_value_with_key(Element.IsDragOverKey, value);
    }

    // Hit-test opt-out — see IsHitTestVisibleKey.
    public override get IsHitTestVisible(): boolean { return this.get_property_value(Element.IsHitTestVisibleKey); }
    public override set IsHitTestVisible(v: boolean) { this.set_property_value(Element.IsHitTestVisibleKey, v); }

    // Opt-in for keyboard focus — see FocusableKey.
    public override get Focusable(): boolean { return this.get_property_value(Element.FocusableKey); }
    public override set Focusable(v: boolean) { this.set_property_value(Element.FocusableKey, v); }

    // Tab-traversal opt-in + ordering — see IsTabStopKey / TabIndexKey.
    public get IsTabStop(): boolean { return this.get_property_value(Element.IsTabStopKey); }
    public set IsTabStop(v: boolean) { this.set_property_value(Element.IsTabStopKey, v); }
    public get TabIndex(): number { return this.get_property_value(Element.TabIndexKey); }
    public set TabIndex(v: number) { this.set_property_value(Element.TabIndexKey, v); }

    // Touch-manipulation opt-in — see IsManipulationEnabledKey.
    public get IsManipulationEnabled(): boolean { return this.get_property_value(Element.IsManipulationEnabledKey); }
    public set IsManipulationEnabled(v: boolean) { this.set_property_value(Element.IsManipulationEnabledKey, v); }

    public override get IsDraggable(): boolean { return this.get_property_value(Element.IsDraggableKey); }
    public override set IsDraggable(v: boolean) { this.set_property_value(Element.IsDraggableKey, v); }

    public override get OnDragStart(): DragStartCallback | undefined
    {
        return this.get_property_value(Element.OnDragStartKey);
    }
    public override set OnDragStart(v: DragStartCallback | undefined)
    {
        this.set_property_value(Element.OnDragStartKey, v);
    }

    // Take keyboard focus on this Element. Delegates to the host's
    // InputManager via the optional `SetFocus` method on VisualHost.
    // No-op when unattached, when Focusable is false, or when the host
    // doesn't implement SetFocus (tests that mock VisualHost without the
    // focus surface).
    public override Focus(): void
    {
        if (!this.Focusable) return;
        this.target?.SetFocus?.(this);
    }

    // Clear focus from this Element. No-op when this isn't the currently
    // focused Element — Blur() always asks for "no focus", which the
    // InputManager applies only if we're actually the focused target.
    public override Blur(): void
    {
        if (this.target?.SetFocus === undefined) return;
        if (this.target.GetFocusedVisual?.() !== this) return;
        this.target.SetFocus(undefined);
    }

    // ── Per-instance routed listener registry ──────────────────────────
    //
    // Routed events that pass through dispatchPointer / dispatchKey /
    // dispatchFocus invoke per-Element virtuals (OnPointerDown, etc.) on
    // each node along the route. They ALSO invoke FireRoutedListeners
    // here so per-instance EventTriggers / consumer-attached listeners get
    // the same hooks subclasses do — without forcing subclass overrides
    // to call `super` to keep listeners working. Lazy-allocated — most
    // Elements never register a routed listener.
    private _routedListeners: Map<string, Set<(args: unknown) => void>> | undefined;

    public override AddRoutedEventListener(eventName: string, listener: (args: unknown) => void): void
    {
        // § 1.16 — validate at registration so a typo (`'PointreDown'`)
        // fails loudly instead of subscribing to a name that never fires.
        if (!KNOWN_ROUTED_EVENTS.has(eventName))
        {
            throw new Error(
                `Element.AddRoutedEventListener: unknown routed event '${eventName}'. `
                + `Known names: ${Array.from(KNOWN_ROUTED_EVENTS).join(', ')}.`,
            );
        }
        if (this._routedListeners === undefined) this._routedListeners = new Map();
        let set = this._routedListeners.get(eventName);
        if (set === undefined)
        {
            set = new Set();
            this._routedListeners.set(eventName, set);
        }
        set.add(listener);
    }

    public override RemoveRoutedEventListener(eventName: string, listener: (args: unknown) => void): void
    {
        this._routedListeners?.get(eventName)?.delete(listener);
    }

    // Called by the routed-event dispatcher's bubble loop. No-op when no
    // listeners are registered (the common case).
    public override FireRoutedListeners(eventName: string, args: unknown): void
    {
        safeFire(this._routedListeners?.get(eventName), args);
    }

    // ── Routed-event virtuals ──────────────────────────────────────────
    //
    // The dispatcher (`dispatchPointer` in routed-event.ts) walks the
    // visual tree twice per event — tunnel root → target calling
    // `OnPreview*`, then bubble target → root calling `On*`. Subclasses
    // override the pair they care about; the base no-op lets every Element
    // participate in the tree walk without forcing trivial overrides.
    // Setting `args.Handled = true` from any handler stops the remainder
    // of BOTH passes. Enter / Leave are direct routed events (WPF
    // semantics) with no Preview counterpart.
    protected OnPointerEnter       (_args: PointerEventArgs): void { }
    protected OnPointerLeave       (_args: PointerEventArgs): void { }
    protected OnPreviewPointerMove (_args: PointerEventArgs): void { }
    protected OnPointerMove        (_args: PointerEventArgs): void { }
    protected OnPreviewPointerDown (_args: PointerEventArgs): void { }
    protected OnPointerDown        (_args: PointerEventArgs): void { }
    protected OnPreviewPointerUp   (_args: PointerEventArgs): void { }
    protected OnPointerUp          (_args: PointerEventArgs): void { }
    protected OnPreviewPointerWheel(_args: WheelEventArgs): void { }
    protected OnPointerWheel       (_args: WheelEventArgs): void { }

    // Button-specific mouse virtuals (WPF parity). Raised by the
    // InputManager after the generic PointerDown / PointerUp when the
    // changed button is the primary / secondary button. Tunnel (Preview)
    // + bubble, same as the generic pointer events.
    protected OnPreviewMouseLeftButtonDown (_args: PointerEventArgs): void { }
    protected OnMouseLeftButtonDown        (_args: PointerEventArgs): void { }
    protected OnPreviewMouseLeftButtonUp   (_args: PointerEventArgs): void { }
    protected OnMouseLeftButtonUp          (_args: PointerEventArgs): void { }
    protected OnPreviewMouseRightButtonDown(_args: PointerEventArgs): void { }
    protected OnMouseRightButtonDown       (_args: PointerEventArgs): void { }
    protected OnPreviewMouseRightButtonUp  (_args: PointerEventArgs): void { }
    protected OnMouseRightButtonUp         (_args: PointerEventArgs): void { }

    // Mouse-capture virtuals (WPF parity). Raised by the InputManager
    // when this element gains / loses pointer capture. Tunnel + bubble.
    protected OnPreviewGotMouseCapture  (_args: PointerEventArgs): void { }
    protected OnGotMouseCapture         (_args: PointerEventArgs): void { }
    protected OnPreviewLostMouseCapture (_args: PointerEventArgs): void { }
    protected OnLostMouseCapture        (_args: PointerEventArgs): void { }

    // Stylus virtuals (WPF parity). Promoted from pen pointer events.
    protected OnPreviewStylusDown (_args: PointerEventArgs): void { }
    protected OnStylusDown        (_args: PointerEventArgs): void { }
    protected OnPreviewStylusUp   (_args: PointerEventArgs): void { }
    protected OnStylusUp          (_args: PointerEventArgs): void { }
    protected OnPreviewStylusMove (_args: PointerEventArgs): void { }
    protected OnStylusMove        (_args: PointerEventArgs): void { }

    // Touch virtuals (WPF parity). Promoted from touch pointer events.
    protected OnPreviewTouchDown (_args: PointerEventArgs): void { }
    protected OnTouchDown        (_args: PointerEventArgs): void { }
    protected OnPreviewTouchUp   (_args: PointerEventArgs): void { }
    protected OnTouchUp          (_args: PointerEventArgs): void { }
    protected OnPreviewTouchMove (_args: PointerEventArgs): void { }
    protected OnTouchMove        (_args: PointerEventArgs): void { }

    // Manipulation virtuals (WPF parity). Bubble; raised by the
    // ManipulationCoordinator on the IsManipulationEnabled container.
    protected OnManipulationStarting        (_args: ManipulationStartingEventArgs): void { }
    protected OnManipulationStarted         (_args: ManipulationStartedEventArgs): void { }
    protected OnManipulationDelta           (_args: ManipulationDeltaEventArgs): void { }
    protected OnManipulationInertiaStarting (_args: ManipulationInertiaStartingEventArgs): void { }
    protected OnManipulationCompleted       (_args: ManipulationCompletedEventArgs): void { }

    // Keyboard virtuals — dispatched by InputManager.InjectKeyDown /
    // InjectKeyUp / InjectTextInput when this Element is the focused
    // target (or an ancestor of it for the tunnel / bubble passes).
    protected OnPreviewKeyDown   (_args: KeyEventArgs): void { }
    protected OnKeyDown          (_args: KeyEventArgs): void { }
    protected OnPreviewKeyUp     (_args: KeyEventArgs): void { }
    protected OnKeyUp            (_args: KeyEventArgs): void { }
    protected OnPreviewTextInput (_args: TextInputEventArgs): void { }
    protected OnTextInput        (_args: TextInputEventArgs): void { }

    // QueryCursor virtual (WPF parity). Bubbles on each pointer move; a
    // handler sets args.Cursor + Handled to choose the cursor.
    protected OnQueryCursor (_args: QueryCursorEventArgs): void { }

    // Focus virtuals — fired by InputManager.SetFocus on the Element that
    // lost focus and the one that gained it. Bubble only (no Preview).
    protected OnGotFocus  (_args: FocusEventArgs): void { }
    protected OnLostFocus (_args: FocusEventArgs): void { }

    // Keyboard-focus virtuals (WPF parity). Tunnel (Preview) + bubble,
    // fired by InputManager.SetFocus alongside GotFocus / LostFocus.
    protected OnPreviewGotKeyboardFocus  (_args: FocusEventArgs): void { }
    protected OnGotKeyboardFocus         (_args: FocusEventArgs): void { }
    protected OnPreviewLostKeyboardFocus (_args: FocusEventArgs): void { }
    protected OnLostKeyboardFocus        (_args: FocusEventArgs): void { }

    // Drag-event virtuals. Default no-ops; subclasses (and consumer
    // Elements via AddRoutedEventListener) override these. Receivers are
    // gated by AllowDrop; the InputManager only invokes dispatchDrag
    // against an ancestor with AllowDrop=true (findAllowDropAncestor).
    protected OnPreviewDragEnter(_args: DragEventArgs): void { }
    protected OnDragEnter       (_args: DragEventArgs): void { }
    protected OnPreviewDragLeave(_args: DragEventArgs): void { }
    protected OnDragLeave       (_args: DragEventArgs): void { }
    protected OnPreviewDragOver (_args: DragEventArgs): void { }
    protected OnDragOver        (_args: DragEventArgs): void { }
    protected OnPreviewDrop     (_args: DragEventArgs): void { }
    protected OnDrop            (_args: DragEventArgs): void { }

    // ── Declarative drag-source latch ──────────────────────────────────
    //
    // Installed / torn down from OnPropertyChanged as IsDraggable flips.
    private _draggableInstalled = false;
    private _draggableLatch:
        { downX: number; downY: number; pointerId: number; armed: boolean } | null = null;

    private readonly _onDragLatchPointerDown = (raw: unknown): void => {
        const args = raw as PointerEventArgs;
        this._draggableLatch = {
            downX: args.HostX, downY: args.HostY,
            pointerId: args.PointerId,
            armed: true,
        };
        // DO NOT capture the pointer here. Capturing on every press redirects
        // the matching PointerUp to THIS element (InputManager.InjectPointerUp
        // dispatches to `captured ?? hit`), stealing the release from any
        // DESCENDANT click handler. A TreeViewItem's selectable ClickableRow
        // (PART_Row) is such a descendant: with capture-on-down its OnPointerUp
        // never fires, so the press-here-release-here click never completes and
        // selection / activation silently break on every draggable row. Capture
        // is instead deferred to _onDragLatchPointerMove, acquired only once the
        // drag threshold is actually crossed — a real drag crosses the small
        // threshold while the cursor is still inside the (large) source row, so
        // out-of-bbox move tracking is preserved, while a plain click (no move
        // past threshold) never captures and its PointerUp routes normally.
    };
    private readonly _onDragLatchPointerMove = (raw: unknown): void => {
        const args = raw as PointerEventArgs;
        const latch = this._draggableLatch;
        if (latch === null || !latch.armed || latch.pointerId !== args.PointerId) return;
        const dx = args.HostX - latch.downX;
        const dy = args.HostY - latch.downY;
        if (Math.hypot(dx, dy) < DragDrop.DragThreshold) return;
        // Threshold reached — invoke OnDragStart and start the drag.
        // Disarm before the callback so a re-entrant move that fires
        // synchronously can't double-start.
        latch.armed = false;
        const start = this.OnDragStart;
        if (start === undefined) return;
        const r = start(this);
        if (r === null) return;
        // The drag is really starting — capture NOW (deferred from PointerDown,
        // see _onDragLatchPointerDown) so subsequent moves that leave the source
        // bbox keep tracking and the host acquires OS/browser pointer capture
        // for the drag session.
        args.CapturePointer(this);
        // Press-relative offset within the source: how far the press
        // landed from the source's host-coord top-left. The HtmlTarget
        // subtracts this from each move sample so the cursor stays
        // anchored at the press point inside the ghost.
        let srcX = 0, srcY = 0;
        for (let cur: Visual | undefined = this; cur !== undefined; cur = cur.GetVisualParent())
        {
            srcX += cur.ArrangedRect.X;
            srcY += cur.ArrangedRect.Y;
        }
        const ghostCursorOffset = { x: latch.downX - srcX, y: latch.downY - srcY };
        const session = DragDrop.DoDragDrop(this, r.data, r.effects, { preview: r.preview, ghostCursorOffset });
        // Wire any optional source-side hooks (8.3) onto the freshly
        // started session before the InputManager polls and picks it up.
        if (r.onFeedback      !== undefined) session.OnFeedback(r.onFeedback);
        if (r.onContinueQuery !== undefined) session.OnContinueQuery(r.onContinueQuery);
    };
    private readonly _onDragLatchPointerUp = (raw: unknown): void => {
        const args = raw as PointerEventArgs;
        if (this._draggableLatch?.pointerId === args.PointerId)
        {
            this._draggableLatch = null;
        }
    };
}

/** Class constructor reference for an `Element` subclass. Used as the
 *  type for `Style.TargetType`, `DefaultStyleKey` defaults, and any
 *  metadata that names a templated control's class. Replaces the
 *  loose `Function | undefined` typing for these slots — `ElementCtor`
 *  keeps the `instanceof` check on the consumer side typed without
 *  an `as new (...args: any[]) => Visual` cast at each use site
 *  (§ 1.10). */
export type ElementCtor = new (...args: any[]) => Element;

// A Visual that owns at most one child. SetChild(undefined) clears the
// slot. Replacing a non-undefined child first detaches the previous one.
export abstract class Single extends Element
{
    private _child: Visual | undefined;

    public get child(): Visual | undefined
    {
        return this._child;
    }

    public SetChild(child: Visual | undefined): void
    {
        if (child === this._child) return;

        if (this._child !== undefined)
        {
            this.Detach(this._child);
        }

        this._child = child;

        if (child !== undefined)
        {
            this.Attach(child);
        }

        // Dynamic SetChild after the Single has already been measured
        // must re-flow on the next layout pass — without this, a child
        // swapped in post-layout would stay un-measured and arrange to
        // (0,0,0×0). Symmetric with Panel's collection subscription.
        this.InvalidateMeasure();
    }

    // The single child belongs to both trees — a non-templated Single
    // never separates its visual and logical content. Templated
    // subclasses (Phase 2) override these independently.
    public override get visualChildren(): readonly Visual[]
    {
        return this._child !== undefined ? [this._child] : [];
    }

    public override get logicalChildren(): readonly Visual[]
    {
        return this._child !== undefined ? [this._child] : [];
    }

    protected override forEachVisualChild(fn: (child: Visual) => void): void
    {
        if (this._child !== undefined) fn(this._child);
    }

    protected override forEachLogicalChild(fn: (child: Visual) => void): void
    {
        if (this._child !== undefined) fn(this._child);
    }
}

// A Visual that owns an ordered collection of children.
//
// The internal child list is an ObservableCollection<Visual>; public
// reads / iterations / subscriptions go through `Children` (the read-
// only view typed as IReadOnlyObservableCollection). Mutation is
// routed through AddChild / InsertChild / RemoveChild (full Attach
// pair: both trees) or AddVisualChild / InsertVisualChild /
// RemoveVisualChild (visual-tree only — used by ItemsControl-style
// hosts where containers live visually in the items panel but
// logically belong to the outer control).
//
// `visualChildren` / `logicalChildren` continue to return a
// `readonly Visual[]`, materialized lazily from the ObservableCollection
// and invalidated by a per-Panel subscription so the snapshot stays
// fresh without per-call allocation in the common case where children
// don't mutate between reads.
// Per-child bookkeeping for Panel's arrange-time layout transitions
// (§18.3). `displayed` is the rect last handed to child.Arrange() — the
// visual anchor a retarget tweens away from. `from` / `startAt` are set
// only while a tween is in flight; both undefined means the child rests
// on `target`.
interface ArrangeChildState
{
    displayed: Rect;
    target:    Rect;
    from?:     Rect;
    startAt?:  number;
}

// Component-wise linear interpolation of two rects at progress p ∈ [0, 1].
// X / Y / Width / Height each interpolate independently, so a single
// tween covers both a child's position and its size.
function lerpRect(a: Rect, b: Rect, p: number): Rect
{
    return new Rect(
        a.X      + (b.X      - a.X)      * p,
        a.Y      + (b.Y      - a.Y)      * p,
        a.Width  + (b.Width  - a.Width)  * p,
        a.Height + (b.Height - a.Height) * p,
    );
}

export class Panel extends Element
{
    private readonly _children: ObservableCollection<Visual> = new ObservableCollection<Visual>();

    // Z-order among a panel's children. Higher paints on top; equal ZIndex
    // breaks ties by insertion order. Honored by EVERY panel via the sorted
    // `visualChildren` below. MetaData.None — the reorder invalidation is
    // bespoke (Panel.SetZIndex notifies the parent, § Task 2), not standard
    // self-invalidation.
    public static readonly ZIndexKey = MuralBase.RegisterAttachedProperty<number>(
        Panel, 'ZIndex', 0, MetaData.None);

    public static GetZIndex(v: Visual): number
    {
        return v.get_property_value(Panel.ZIndexKey);
    }

    public static SetZIndex(v: Visual, value: number): void
    {
        v.set_property_value(Panel.ZIndexKey, value);
        // Reorder is driven from the setter, not a per-child listener: a listener
        // would add a ZIndex EVD + subscription to every child of every panel
        // app-wide. Notifying the parent here costs nothing for children that
        // never touch Z. A runtime Binding / raw set_property_value to ZIndex will
        // NOT auto-reorder — the diagram commands and markup both use SetZIndex /
        // construction-time set, the supported paths.
        const parent = v.GetVisualParent();
        if (parent instanceof Panel) parent._invalidateZOrder();
    }

    // ── Arrange-time layout transitions (§18.3) ──────────────────────
    //
    // A Panel subclass whose arrange decisions should interpolate over
    // time — hover-expand, accordion, drawer-collapse — routes each child
    // through `ArrangeChild(child, target)` instead of `child.Arrange(
    // target)`. When `ArrangeTransitionDurationMs > 0`, the base tweens
    // each child from its currently-displayed rect to the new target
    // across the duration, sampled on the shared animation clock
    // (deterministic ManualClock under test, RafClock in the browser) with
    // `ArrangeTransitionEasing` applied. The whole rect interpolates —
    // position and size in one seam.
    //
    // The subclass writes `ArrangeOverride` as if layout were
    // instantaneous: compute each child's TARGET rect and hand it to
    // `ArrangeChild`. Retargeting mid-flight (a hover redirected to a
    // sibling), the clock subscription, and teardown are all handled here.
    // Duration 0 (the default) makes `ArrangeChild` a pass-through with no
    // allocation and no clock traffic, so panels that don't opt in pay
    // nothing. This is the general replacement for per-child polled tweens
    // (ButtonGroup's old setTimeout loop) — custom easing and frame-sync
    // with Storyboards come for free from riding the animation clock.
    private _arrangeState:      Map<Visual, ArrangeChildState> | undefined;
    private _arrangeClockUnsub: (() => void) | undefined;

    // Lazily-materialized snapshot for logicalChildren (insertion order).
    // Invalidated by the subscription wired in the constructor.
    private _childrenSnapshot: readonly Visual[] | undefined;

    // Lazily-materialized ZIndex-sorted snapshot for visualChildren. Distinct
    // from _childrenSnapshot (insertion order): visual order sorts by ZIndex,
    // logical order does not (ItemsControl index mapping must stay insertion order).
    private _visualSnapshot: readonly Visual[] | undefined;

    constructor()
    {
        super();
        // Subscribe once at construction; the unsubscribe is never
        // called — the subscription's lifetime is tied to this Panel.
        // Invalidates the visualChildren snapshot AND the panel's
        // measure: a child added (or removed) after the panel has
        // already been measured must re-flow on the next layout pass —
        // without this, dynamically-appended children stay un-measured
        // and arrange to (0,0,0×0). Panel-driven Attach / Detach
        // doesn't itself invalidate measure, so the ObservableCollection
        // subscription is the natural seam.
        this._children.Subscribe(() =>
        {
            this._childrenSnapshot = undefined;
            this._visualSnapshot   = undefined;
            this.InvalidateMeasure();
        });
    }

    // Public read-only view: iterate, count, lookup, subscribe — but
    // not mutate. Mutation goes through Panel's AddChild / InsertChild
    // / RemoveChild so Attach / Detach run alongside.
    public get Children(): IReadOnlyObservableCollection<Visual>
    {
        return this._children;
    }

    public AddChild(child: Visual): void
    {
        this.Attach(child);
        this._children.Add(child);
    }

    public InsertChild(index: number, child: Visual): void
    {
        this.Attach(child);
        this._children.Insert(index, child);
    }

    public RemoveChild(child: Visual): void
    {
        if (this._children.IndexOf(child) === -1) return;
        this._children.Remove(child);
        this.Detach(child);
    }

    // Visual-only attach: adds child to the panel's visual children
    // (renderer / hit-testing) WITHOUT wiring its logical parent.
    // Used by ItemsControl-style hosts where containers live visually
    // in the items panel but logically belong to the outer control
    // (so DataContext / inheritance flow through the outer control,
    // not the panel). Plain consumers should use AddChild.
    public AddVisualChild(child: Visual): void
    {
        this.AttachVisual(child);
        this._children.Add(child);
    }

    public InsertVisualChild(index: number, child: Visual): void
    {
        this.AttachVisual(child);
        // Clamp to a valid slot. An ItemsControl syncs children at ITEM indices,
        // but a host that reparents some containers OUT of this panel — a diagram's
        // ContentContainerFigure adopts its nested nodes' figures — leaves fewer
        // visual children than items, so an item's index can exceed the child
        // count (e.g. restoring/rebuilding a nested diagram). The exact slot of
        // such an out-of-order insert is irrelevant: the reparenting host re-places
        // the figure. Append rather than throw.
        const at = Math.max(0, Math.min(index, this._children.Count));
        this._children.Insert(at, child);
    }

    public RemoveVisualChild(child: Visual): void
    {
        if (this._children.IndexOf(child) === -1) return;
        this._children.Remove(child);
        this.DetachVisual(child);
    }

    // Children added via AddChild belong to both trees; visual and
    // logical iteration return the same snapshot array. Templated
    // subclasses (Phase 2) override these independently.
    public override get visualChildren(): readonly Visual[]  { return this.visualSnapshotSorted(); }
    public override get logicalChildren(): readonly Visual[] { return this.childrenSnapshot(); }

    private childrenSnapshot(): readonly Visual[]
    {
        if (this._childrenSnapshot === undefined)
        {
            this._childrenSnapshot = this._children.ToArray();
        }
        return this._childrenSnapshot;
    }

    // visualChildren order = ZIndex ascending (last painted on top), with the
    // explicit insertion-index tiebreak keeping the result deterministic
    // regardless of the engine's sort stability. Default (all ZIndex 0) reduces
    // to insertion order, so panels that never touch ZIndex are unchanged.
    // @internal — drop the sorted snapshot and schedule a render so the walk
    // re-reads child order. Called by Panel.SetZIndex on this panel's children.
    public _invalidateZOrder(): void
    {
        this._visualSnapshot = undefined;
        this.InvalidateVisual();
    }

    private visualSnapshotSorted(): readonly Visual[]
    {
        if (this._visualSnapshot === undefined)
        {
            this._visualSnapshot = this._children.ToArray()
                .map((v, i) => ({ v, i, z: Panel.GetZIndex(v) }))
                .sort((a, b) => (a.z - b.z) || (a.i - b.i))
                .map(e => e.v);
        }
        return this._visualSnapshot;
    }

    protected override forEachVisualChild(fn: (child: Visual) => void): void
    {
        for (const c of this._children) fn(c);
    }

    protected override forEachLogicalChild(fn: (child: Visual) => void): void
    {
        for (const c of this._children) fn(c);
    }

    // ── Arrange-time layout transitions (§18.3) ──────────────────────

    /** Duration, in ms, over which `ArrangeChild` interpolates a child
     *  toward a changed target rect. 0 (the default) disables the tween —
     *  `ArrangeChild` becomes a direct `child.Arrange`. Subclasses that
     *  want animated arrange override this (usually surfacing a DP so
     *  consumers can retune the cadence). */
    protected get ArrangeTransitionDurationMs(): number { return 0; }

    /** Easing applied to the 0→1 tween progress. Defaults to the M3
     *  `Standard` curve; subclasses override to expose a consumer-settable
     *  curve. */
    protected get ArrangeTransitionEasing(): EasingFunction { return Easings.Standard; }

    /** Arrange `child` into `target`, interpolating from its currently-
     *  displayed rect when `ArrangeTransitionDurationMs > 0`. Panel
     *  subclasses call this from `ArrangeOverride` in place of
     *  `child.Arrange(target)`. The first arrange for a child always snaps
     *  (nothing to animate from); subsequent target changes tween. */
    protected ArrangeChild(child: Visual, target: Rect): void
    {
        const duration = this.ArrangeTransitionDurationMs;
        const state    = this._arrangeState?.get(child);

        // Transitions off, or first-ever arrange for this child (no anchor
        // to slide from) — snap. When transitions are on, seed the state so
        // the NEXT target change has a `displayed` rect to tween away from.
        if (duration <= 0 || state === undefined)
        {
            child.Arrange(target);
            if (duration > 0)
            {
                this.arrangeStateMap().set(child, { displayed: target, target });
            }
            else if (state !== undefined)
            {
                // Duration turned off mid-flight — drop any live tween so a
                // later re-enable starts clean.
                state.displayed = target;
                state.target    = target;
                state.from      = undefined;
                state.startAt   = undefined;
            }
            return;
        }

        // Retarget: destination moved since the last pass. Anchor a fresh
        // tween at wherever the child is currently shown so an in-flight
        // expand redirects smoothly instead of snapping.
        if (!state.target.Equals(target))
        {
            state.from    = state.displayed;
            state.target  = target;
            state.startAt = AnimationManager.Instance.Clock.Now();
            this.ensureArrangeClock();
        }

        // At rest on target — no active tween.
        if (state.from === undefined || state.startAt === undefined)
        {
            state.displayed = state.target;
            child.Arrange(state.target);
            return;
        }

        // Sample the tween at the current clock time.
        const elapsed = AnimationManager.Instance.Clock.Now() - state.startAt;
        if (elapsed >= duration)
        {
            state.displayed = state.target;
            state.from      = undefined;
            state.startAt   = undefined;
            child.Arrange(state.target);
            return;
        }
        const p    = this.ArrangeTransitionEasing(elapsed <= 0 ? 0 : elapsed / duration);
        const rect = lerpRect(state.from, state.target, p);
        state.displayed = rect;
        child.Arrange(rect);
    }

    private arrangeStateMap(): Map<Visual, ArrangeChildState>
    {
        if (this._arrangeState === undefined) this._arrangeState = new Map();
        return this._arrangeState;
    }

    private ensureArrangeClock(): void
    {
        if (this._arrangeClockUnsub !== undefined) return;
        this._arrangeClockUnsub = AnimationManager.Instance.Clock.Subscribe(
            () => this.onArrangeTick());
    }

    // Clock tick while any child tween is live: re-invalidate arrange so
    // the next layout pass re-samples `ArrangeChild`. Drops state for
    // children that have since left the panel (so a child removed
    // mid-tween can't keep the clock alive), and releases the clock
    // subscription once nothing is animating.
    private onArrangeTick(): void
    {
        this.pruneArrangeState();
        if (!this.hasActiveArrangeTween())
        {
            this._arrangeClockUnsub?.();
            this._arrangeClockUnsub = undefined;
            return;
        }
        this.InvalidateArrange();
    }

    private pruneArrangeState(): void
    {
        if (this._arrangeState === undefined) return;
        for (const child of [...this._arrangeState.keys()])
        {
            if (this._children.IndexOf(child) === -1) this._arrangeState.delete(child);
        }
    }

    private hasActiveArrangeTween(): boolean
    {
        if (this._arrangeState === undefined) return false;
        for (const st of this._arrangeState.values())
        {
            if (st.from !== undefined) return true;
        }
        return false;
    }
}
