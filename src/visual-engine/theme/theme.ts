// Theme + Scheme + ThemeManager — the engine that implements the
// two-level theme architecture (see theme-architecture.md at the repo
// root).
//
// Theme is the structural design language: control templates, default
// styles, DataTemplates, and a token catalog declaring what tokens the
// templates reference. A Theme owns no token VALUES — it owns the
// CONTRACT.
//
// Scheme is a pure value dictionary, declared against a specific Theme:
// `Material light`, `Material dark`, …. Schemes provide values for
// every token in the Theme's catalog.
//
// ThemeManager is a FULLY STATIC class pairing the active Theme with
// the active Scheme, merging their resources into Application.Resources,
// and owning the six ambient/inherited adaptive DPs (Density, Pointer,
// PrefersContrast, PrefersReducedMotion, PrefersColorScheme,
// ViewportClass). Templates trigger on these via
// `when (ThemeManager.Density = Compact) { … }` — the property
// descriptor's owner is the ThemeManager class itself, but values still
// live in per-Visual property bags and inherit through the tree just
// like any other inherited attached DP.
//
// SetTheme/CurrentTheme/ToggleTheme survive as thin convenience aliases
// over ActivateScheme.

import { Application } from '../../runtime/application.js';
import { MetaData } from '../../runtime/metadata.js';
import { MuralBase } from '../../runtime/model.js';
import { ResourceDictionary } from '../../runtime/resource-dictionary.js';
import {
    Density,
    classifyViewport,
    M3_BREAKPOINTS,
    Pointer,
    PreferredScheme,
    PrefersContrast,
    ViewportClass,
    type ViewportBreakpoints,
} from './adaptive.js';
import type { AnimationTimeline, EasingFunction } from '../animation/index.js';
import { Visual } from '../visual.js';
import { ResourceResolver } from '../resource-resolver.js';

// ── Token catalog ──────────────────────────────────────────────────────

// String name of a recognised token type. Keep this open-ended (string
// rather than a strict union) so library consumers can author themes
// that reference types we haven't enumerated here without forking the
// runtime. The compiler does the strict validation against
// CATALOG_TYPES; runtime accepts the broader set.
export type TokenType = string;

// Catalog entry per token. Description is optional but recommended;
// the .mu compiler warns on missing descriptions in CI.
export interface TokenSpec
{
    readonly type:         TokenType;
    readonly description?: string;
}

// Catalog: token name → TokenSpec. Authored explicitly inside the
// `tokens { … }` block of a `.template.mu` theme bundle, then emitted
// as a frozen Map by the compiler.
export type TokenCatalog = ReadonlyMap<string, TokenSpec>;

// ── Scheme ────────────────────────────────────────────────────────────

export interface SchemeOptions
{
    /** Scheme name (e.g. 'light', 'dark', 'high-contrast-light'). */
    name: string;

    /** Name of the Theme this Scheme satisfies. The compiler validates
     *  that the merged token dict matches that Theme's catalog. */
    theme: string;

    /** Token values, keyed by token name. Every catalog entry of the
     *  target Theme must appear here (or come in via `basedOn`). */
    tokens: ReadonlyMap<string, unknown> | Record<string, unknown>;

    /** Optional cross-scheme borrow. Resolved at registration time by
     *  ThemeManager — the named scheme's tokens merge under this one's
     *  (this scheme wins). Borrowing across Themes is fine; the
     *  contract check applies to the merged result. */
    basedOn?: string;
}

// Scheme is a frozen value. ThemeManager handles the basedOn merge at
// registration time so the in-memory Scheme always carries its complete
// token dict.
export class Scheme
{
    public readonly name:    string;
    public readonly theme:   string;
    public readonly tokens:  ReadonlyMap<string, unknown>;
    public readonly basedOn: string | undefined;

    constructor(opts: SchemeOptions)
    {
        this.name    = opts.name;
        this.theme   = opts.theme;
        this.basedOn = opts.basedOn;
        this.tokens  = opts.tokens instanceof Map
            ? opts.tokens
            : new Map<string, unknown>(Object.entries(opts.tokens));
    }

    /** Fully-qualified scheme name: `<theme>.<scheme>`. Distinct from
     *  the short `name` — two themes can ship a scheme named `light`. */
    public get FullName(): string { return `${this.theme}.${this.name}`; }
}

/** Sugar over `new Scheme(opts)` — matches the spec's `defineScheme`. */
export function defineScheme(opts: SchemeOptions): Scheme
{
    return new Scheme(opts);
}

// ── Theme ─────────────────────────────────────────────────────────────

export interface ThemeOptions
{
    /** Theme name (e.g. 'material', 'fluent'). */
    name: string;

    /** Resource dictionaries the theme owns — ControlTemplates,
     *  default Styles, DataTemplates, and any other resources the
     *  theme ships. Authored declaratively in the `.mu` theme block's
     *  `dictionaries: [MuralBasic, MuralFramework, …]` header plus any
     *  body content (the theme's own resources). ThemeManager merges
     *  the whole list into Application.Resources when the Theme is
     *  activated, in array order — earlier entries are shadowed by
     *  later ones for the same key. */
    dictionaries: readonly ResourceDictionary[];

    /** Token catalog — the contract every Scheme must satisfy. Emitted
     *  by the compiler from the theme bundle's `tokens { … }` block.
     *  Used at registration to validate Schemes; at runtime acts as
     *  introspection metadata for tooling. */
    catalog: TokenCatalog;

    /** Schemes declared against this Theme. Compiler-validated; this is
     *  the registration-time list. */
    schemes: readonly Scheme[];

    /** Name of the Scheme to activate when ActivateTheme is called
     *  without an explicit scheme argument. Must match one of `schemes`. */
    defaultScheme: string;
}

export class Theme
{
    public readonly name:          string;
    public readonly dictionaries:  readonly ResourceDictionary[];
    public readonly catalog:       TokenCatalog;
    public readonly schemes:       ReadonlyMap<string, Scheme>;
    public readonly defaultScheme: string;

    /** Activate this theme's instance on the global ThemeManager,
     *  optionally with a specific scheme. Base implementation throws —
     *  the compiler-emitted subclass (`class Foo extends Theme` from a
     *  `.mu` theme bundle) supplies a concrete override that resolves
     *  its singleton instance and calls ThemeManager.ActivateTheme.
     *
     *  Application.initialize calls this on the registered theme class,
     *  so a hand-authored subclass that forgets to override surfaces as
     *  a clear runtime error rather than silently doing nothing. */
    public static Activate(_scheme?: typeof Scheme): void
    {
        throw new Error(
            `Theme.Activate: base implementation invoked on '${this.name}'. ` +
            `Theme subclasses must override the static Activate method.`);
    }

    constructor(opts: ThemeOptions)
    {
        this.name          = opts.name;
        this.dictionaries  = [...opts.dictionaries];
        this.catalog       = opts.catalog;
        this.defaultScheme = opts.defaultScheme;

        const map = new Map<string, Scheme>();
        for (const s of opts.schemes)
        {
            if (s.theme !== opts.name)
            {
                throw new Error(
                    `Theme '${opts.name}': Scheme '${s.name}' targets theme `
                    + `'${s.theme}', not '${opts.name}'.`);
            }
            if (map.has(s.name))
            {
                throw new Error(
                    `Theme '${opts.name}': duplicate scheme '${s.name}'.`);
            }
            map.set(s.name, s);
        }
        if (!map.has(opts.defaultScheme))
        {
            throw new Error(
                `Theme '${opts.name}': defaultScheme '${opts.defaultScheme}' `
                + `is not one of the registered schemes (${[...map.keys()].join(', ')}).`);
        }
        this.schemes = map;
    }
}

/** Sugar over `new Theme(opts)` — matches the spec's `defineTheme`. */
export function defineTheme(opts: ThemeOptions): Theme
{
    return new Theme(opts);
}

// ── ThemeManager ──────────────────────────────────────────────────────

// Activation options for ActivateTheme — currently just `scheme` (the
// scheme name to activate alongside the theme).
export interface ActivateThemeOptions
{
    scheme?: string;
}

// Configuration for AutoScheme — pairs OS color-scheme preference with
// scheme names. `listen: true` attaches a matchMedia listener that
// re-activates on OS preference change; `listen: false` reads the
// preference once and pins it.
export interface AutoSchemeOptions
{
    light:  string;
    dark:   string;
    listen: boolean;
}

// Opt-in animation policy for scheme swaps. When set, Brush-typed
// tokens animate from their previous values to the new ones at the
// configured duration / easing; non-animatable token types
// (CornerRadius, number, Effect, …) snap regardless. Honours
// PrefersReducedMotion — when the ambient DP is true, every swap
// snaps.
//
// The actual animation install runs at the DynamicResource layer.
// Whoever owns the animatable value type (visual-engine for
// SolidColorBrush) registers a SchemeTransitionAnimatorFactory via
// `registerSchemeTransitionAnimator`; DynamicResource consults the
// factory on each resolved-value change and Begins a Storyboard on
// its watcher when a timeline is produced.
export enum SchemeTransitionTokens
{
    All         = 'all',
    BrushesOnly = 'brushes-only',
    None        = 'none',
}

export interface SchemeTransition
{
    /** Animation length in milliseconds. */
    duration: number;
    /** Easing curve applied to the produced timeline. The animator
     *  factory copies this onto the timeline it returns. */
    easing?:  EasingFunction;
    /** Which token types to animate. `'brushes-only'` is the default
     *  and only fully-supported value today. `'none'` skips the
     *  factory call entirely — every swap snaps. */
    tokens?:  SchemeTransitionTokens;
}

// Builder that produces a timeline for a single resolved-value change.
// Receives the old and new values plus the active SchemeTransition.
// Return `undefined` to snap (caller falls back to direct
// watcher.Value = newValue). The returned timeline targets the
// DynamicResource's internal watcher.Value — the factory must build a
// timeline whose Evaluate produces values assignable to the bound
// resource slot.
//
// Registration is a process-global hook installed at module load —
// visual-engine's SolidColorBrush integration registers one. Only one
// factory is supported (last registration wins); a future
// multi-animator setup can layer this as a composite.
export type SchemeTransitionAnimatorFactory = (
    oldValue: unknown,
    newValue: unknown,
    transition: SchemeTransition,
) => AnimationTimeline | undefined;

let _schemeTransitionAnimatorFactory: SchemeTransitionAnimatorFactory | undefined;
// Secondary animator factories (§ 17.3). Registered via
// `addSchemeTransitionAnimator`. Tried in registration order AFTER the
// single primary factory above; the first to return a non-undefined
// timeline wins. Lets multiple type-specialized factories coexist
// without forcing every animator owner to compete for the single
// primary slot. Stored as a flat list — there's no value type registry
// or matching priority beyond order-of-registration.
const _schemeTransitionAnimatorSecondaries: SchemeTransitionAnimatorFactory[] = [];

/** Register the process-global PRIMARY animator factory. Pass
 *  `undefined` to unregister (test helper — production code calls this
 *  once at startup from whichever module owns the animatable value
 *  types). The primary slot is intended for the workhorse factory
 *  (`SolidColorBrush` today); type-specialized factories for non-brush
 *  tokens (Thickness, CornerRadius, number) should use
 *  `addSchemeTransitionAnimator` instead. */
export function registerSchemeTransitionAnimator(
    factory: SchemeTransitionAnimatorFactory | undefined,
): void
{
    _schemeTransitionAnimatorFactory = factory;
}

/** Register an ADDITIONAL animator factory (§ 17.3) that runs after the
 *  primary factory in the same chain. Use for type-specialized
 *  animators (Thickness, CornerRadius, number, …) so each owner can
 *  register its own without competing for the single primary slot.
 *  Returns an unregister function — call to drop the factory; safe to
 *  call multiple times. */
export function addSchemeTransitionAnimator(
    factory: SchemeTransitionAnimatorFactory,
): () => void
{
    _schemeTransitionAnimatorSecondaries.push(factory);
    return () =>
    {
        const i = _schemeTransitionAnimatorSecondaries.indexOf(factory);
        if (i >= 0) _schemeTransitionAnimatorSecondaries.splice(i, 1);
    };
}

/** Test helper — clear EVERY registered animator (primary + secondaries).
 *  Production code never calls this; the existing
 *  `registerSchemeTransitionAnimator(undefined)` test path only clears
 *  the primary slot, which is enough for most tests since per-type
 *  secondaries decline on mismatched value pairs. */
export function _clearAllSchemeTransitionAnimators(): void
{
    _schemeTransitionAnimatorFactory = undefined;
    _schemeTransitionAnimatorSecondaries.length = 0;
}

/** Read the currently-registered animator factory. DynamicResource
 *  calls this on every resolved-value change while a SchemeTransition
 *  is effective. Returns a composite that walks the primary factory
 *  first then each secondary in registration order. */
export function getSchemeTransitionAnimator(): SchemeTransitionAnimatorFactory | undefined
{
    // Fast path — single primary, no secondaries: return the factory
    // directly so the call overhead matches the pre-§ 17.3 behavior.
    if (_schemeTransitionAnimatorSecondaries.length === 0)
    {
        return _schemeTransitionAnimatorFactory;
    }
    // Composite path — try primary, then each secondary.
    return (oldValue, newValue, transition) =>
    {
        const primary = _schemeTransitionAnimatorFactory;
        if (primary !== undefined)
        {
            const tl = primary(oldValue, newValue, transition);
            if (tl !== undefined) return tl;
        }
        for (const f of _schemeTransitionAnimatorSecondaries)
        {
            const tl = f(oldValue, newValue, transition);
            if (tl !== undefined) return tl;
        }
        return undefined;
    };
}

// ── MediaWatcher ──────────────────────────────────────────────────────
//
// Wires matchMedia + ResizeObserver outputs to the ambient DPs on the
// Application root. Activated by `ThemeManager.StartMediaWatcher(root)`.
// Declared before ThemeManager so the static `_mediaWatcher` field can
// instantiate it; its method bodies reference `ThemeManager.SetXxx`
// but only at call time (not at class-init), so the back-reference is
// safe.
//
// Browser-only — when matchMedia / ResizeObserver are unavailable
// (Node/test environments) the watcher is a no-op. Tests that want to
// simulate viewport / OS-pref changes write the DPs directly on a
// Visual instead.
export class MediaWatcher
{
    private _root:   Visual            | undefined;
    private _bps:    ViewportBreakpoints       = M3_BREAKPOINTS;
    private _attached                          = false;
    private _resizeObs: ResizeObserver | undefined;
    private _mqDark:    MediaQueryList | undefined;
    private _mqCoarse:  MediaQueryList | undefined;
    private _mqHC:      MediaQueryList | undefined;
    private _mqRM:      MediaQueryList | undefined;
    private readonly _disposers: (() => void)[] = [];

    public get Breakpoints(): ViewportBreakpoints { return this._bps; }
    public set Breakpoints(v: ViewportBreakpoints)
    {
        this._bps = v;
        if (this._attached) this.reclassifyViewport();
    }

    /** Attach to `root`. Writes the current adaptive state into root's
     *  DPs and starts listening for changes. */
    public Start(root: Visual): void
    {
        if (this._attached && this._root === root) return;
        if (this._attached) this.Stop();
        this._root = root;
        this.attach();
        this._attached = true;
    }

    /** Detach all listeners. Safe to call when not attached. */
    public Stop(): void
    {
        for (const d of this._disposers) d();
        this._disposers.length = 0;
        this._resizeObs = undefined;
        this._mqDark    = undefined;
        this._mqCoarse  = undefined;
        this._mqHC      = undefined;
        this._mqRM      = undefined;
        this._attached  = false;
    }

    private attach(): void
    {
        // Bail out gracefully in non-browser environments. Tests don't
        // exercise this path; production always has window + matchMedia.
        const g: typeof globalThis & {
            window?:           typeof globalThis & { matchMedia?(query: string): MediaQueryList };
            matchMedia?:       (query: string) => MediaQueryList;
            ResizeObserver?:   typeof ResizeObserver;
        } = globalThis;
        const win = g.window;
        const matchMedia = (typeof win?.matchMedia === 'function')
            ? win.matchMedia.bind(win)
            : (typeof g.matchMedia === 'function' ? g.matchMedia : undefined);
        if (matchMedia === undefined) return;

        // matchMedia queries — each one writes its corresponding DP on
        // the root on construction AND on subsequent change events.
        this._mqDark   = matchMedia('(prefers-color-scheme: dark)');
        this._mqCoarse = matchMedia('(pointer: coarse)');
        this._mqHC     = matchMedia('(prefers-contrast: more)');
        this._mqRM     = matchMedia('(prefers-reduced-motion: reduce)');

        const writeDark   = (e: MediaQueryListEvent | MediaQueryList): void =>
        {
            if (this._root === undefined) return;
            ThemeManager.SetPrefersColorScheme(this._root,
                e.matches ? PreferredScheme.Dark : PreferredScheme.Light);
        };
        const writeCoarse = (e: MediaQueryListEvent | MediaQueryList): void =>
        {
            if (this._root === undefined) return;
            ThemeManager.SetPointer(this._root, e.matches ? Pointer.Coarse : Pointer.Fine);
        };
        const writeHC     = (e: MediaQueryListEvent | MediaQueryList): void =>
        {
            if (this._root === undefined) return;
            ThemeManager.SetPrefersContrast(this._root,
                e.matches ? PrefersContrast.More : PrefersContrast.Normal);
        };
        const writeRM     = (e: MediaQueryListEvent | MediaQueryList): void =>
        {
            if (this._root === undefined) return;
            ThemeManager.SetPrefersReducedMotion(this._root, e.matches);
        };

        // Initial sync — pass the MediaQueryList itself (it has the
        // .matches getter so the same writer works for both initial
        // and event-driven calls).
        writeDark(this._mqDark);
        writeCoarse(this._mqCoarse);
        writeHC(this._mqHC);
        writeRM(this._mqRM);

        // Subscribe to changes.
        const subscribe = (
            mq:    MediaQueryList,
            write: (e: MediaQueryListEvent) => void,
        ): void =>
        {
            mq.addEventListener('change', write);
            this._disposers.push(() => mq.removeEventListener('change', write));
        };
        subscribe(this._mqDark,   writeDark);
        subscribe(this._mqCoarse, writeCoarse);
        subscribe(this._mqHC,     writeHC);
        subscribe(this._mqRM,     writeRM);

        // ResizeObserver on the root surface for ViewportClass. The
        // root is typically the Application's mount element; if it
        // isn't a DOM element (test harness), skip the observer.
        const RO = g.ResizeObserver;
        if (RO !== undefined && this._root !== undefined)
        {
            const target = this.resolveDomTarget(this._root);
            if (target !== undefined)
            {
                this._resizeObs = new RO(entries =>
                {
                    if (this._root === undefined) return;
                    const w = entries[0]?.contentRect.width;
                    if (w !== undefined)
                    {
                        ThemeManager.SetViewportClass(this._root,
                            classifyViewport(w, this._bps));
                    }
                });
                this._resizeObs.observe(target);
                this._disposers.push(() => this._resizeObs?.disconnect());

                // Initial sync from the target's current width.
                ThemeManager.SetViewportClass(this._root,
                    classifyViewport(target.clientWidth ?? 0, this._bps));
            }
        }
    }

    // Re-classify the viewport on demand — used when Breakpoints
    // changes mid-watch so the active value reflects the new thresholds.
    private reclassifyViewport(): void
    {
        if (this._root === undefined) return;
        const target = this.resolveDomTarget(this._root);
        if (target === undefined) return;
        ThemeManager.SetViewportClass(this._root,
            classifyViewport(target.clientWidth ?? 0, this._bps));
    }

    // Best-effort DOM-target resolution. Mural's host bindings (HtmlTarget)
    // expose the mount element via various paths; we duck-type through
    // the common ones. Returns undefined for non-DOM hosts (tests).
    private resolveDomTarget(root: Visual): Element | undefined
    {
        const probe = root as Visual & {
            HostElement?:   Element;
            hostElement?:   Element;
            DomNode?:       Element;
        };
        return probe.HostElement ?? probe.hostElement ?? probe.DomNode;
    }
}

// Fully-static theme/ambient registry. No instances — all state hangs
// off the class as private static fields. Activation pushes resources
// into Application.current.Resources; if the current Application
// changes (test harness, multi-app host) the manager re-merges into
// the new one on the next activation call.
//
// The six ambient DPs (Density, Pointer, …) are registered with
// `ThemeManager` as the descriptor owner so trigger expressions
// `when (ThemeManager.Density = Compact) { … }` resolve naturally —
// the property descriptor still cascades inherited values through
// per-Visual property bags exactly like attached DPs registered on
// Visual, but its identity belongs to ThemeManager so the trigger
// system reads it as ambient context, not as a per-Visual concern.
export class ThemeManager
{
    // ── Ambient adaptive DPs (registered against ThemeManager) ────────
    //
    // All `MetaData.Inherits` so a write to the root Application Visual
    // cascades to every descendant — the same path DataContext uses.
    // Templates trigger via `when (ThemeManager.Density = Compact)`;
    // the runtime resolves the descriptor under (ThemeManager,
    // 'Density') and walks the visual hierarchy for the value.

    public static readonly DensityKey = MuralBase.RegisterAttachedProperty<Density>(
        ThemeManager, 'Density', Density.Regular, MetaData.Inherits);

    public static readonly ViewportClassKey = MuralBase.RegisterAttachedProperty<ViewportClass>(
        ThemeManager, 'ViewportClass', ViewportClass.Desktop, MetaData.Inherits);

    public static readonly PointerKey = MuralBase.RegisterAttachedProperty<Pointer>(
        ThemeManager, 'Pointer', Pointer.Fine, MetaData.Inherits);

    public static readonly PrefersContrastKey = MuralBase.RegisterAttachedProperty<PrefersContrast>(
        ThemeManager, 'PrefersContrast', PrefersContrast.Normal, MetaData.Inherits);

    public static readonly PrefersReducedMotionKey = MuralBase.RegisterAttachedProperty<boolean>(
        ThemeManager, 'PrefersReducedMotion', false, MetaData.Inherits);

    public static readonly PrefersColorSchemeKey = MuralBase.RegisterAttachedProperty<PreferredScheme>(
        ThemeManager, 'PrefersColorScheme', PreferredScheme.NoPreference, MetaData.Inherits);

    // Theme / Scheme inherited DPs (§ 17.1 / § 17.2 / § 17.6). The
    // ambient Theme and Scheme that apply to a Visual's subtree. Writes
    // cascade through the logical tree like every other adaptive DP.
    // Setting `Scheme` on a Border lets that subtree resolve `@Primary`
    // (and every other token) against the override scheme; setting
    // `Theme` lets a subtree use a different design language's
    // templates + default styles. Both undefined by default — the
    // global `Application.Resources` fallback still drives lookups
    // when nothing's been set locally. The DynamicResource subscriber
    // listens for Scheme / Theme changes and re-resolves every bound
    // token against the new ancestor chain.
    //
    // Theme types are intentionally NOT class-typed at registration —
    // we want to keep the runtime layer free of a hard dependency on
    // the visual-engine `Theme` class. The DP is typed as `unknown` at
    // registration, then the public Visual getters/setters cast to
    // the structural Theme / Scheme types that come in via the
    // type-only imports.
    public static readonly SchemeKey = MuralBase.RegisterAttachedProperty<Scheme | undefined>(
        ThemeManager, 'Scheme', undefined, MetaData.Inherits);
    public static readonly ThemeKey = MuralBase.RegisterAttachedProperty<Theme | undefined>(
        ThemeManager, 'Theme', undefined, MetaData.Inherits);

    // Static getters/setters mirror the WPF attached-property API
    // (e.g. `DockPanel.GetDock`). Convenient for code that wants typed
    // reads without going through the by-name surface.

    public static GetDensity(v: Visual): Density { return v.get_property_value(ThemeManager.DensityKey); }
    public static SetDensity(v: Visual, value: Density): void { v.set_property_value(ThemeManager.DensityKey, value); }
    public static GetViewportClass(v: Visual): ViewportClass { return v.get_property_value(ThemeManager.ViewportClassKey); }
    public static SetViewportClass(v: Visual, value: ViewportClass): void { v.set_property_value(ThemeManager.ViewportClassKey, value); }
    public static GetPointer(v: Visual): Pointer { return v.get_property_value(ThemeManager.PointerKey); }
    public static SetPointer(v: Visual, value: Pointer): void { v.set_property_value(ThemeManager.PointerKey, value); }
    public static GetPrefersContrast(v: Visual): PrefersContrast { return v.get_property_value(ThemeManager.PrefersContrastKey); }
    public static SetPrefersContrast(v: Visual, value: PrefersContrast): void { v.set_property_value(ThemeManager.PrefersContrastKey, value); }
    public static GetPrefersReducedMotion(v: Visual): boolean { return v.get_property_value(ThemeManager.PrefersReducedMotionKey); }
    public static SetPrefersReducedMotion(v: Visual, value: boolean): void { v.set_property_value(ThemeManager.PrefersReducedMotionKey, value); }
    public static GetPrefersColorScheme(v: Visual): PreferredScheme { return v.get_property_value(ThemeManager.PrefersColorSchemeKey); }
    public static SetPrefersColorScheme(v: Visual, value: PreferredScheme): void { v.set_property_value(ThemeManager.PrefersColorSchemeKey, value); }

    /** Read the ambient Scheme that applies to this Visual's subtree
     *  (§ 17.1). Walks the inheritance chain; falls back to undefined
     *  when no ancestor has set one. */
    public static GetVisualScheme(v: Visual): Scheme | undefined { return v.get_property_value(ThemeManager.SchemeKey); }
    /** Write the local Scheme override (§ 17.1 / § 17.2). Descendants
     *  resolve every `@Token` against this Scheme's token map instead
     *  of the global active scheme. Pairs with `SetVisualTheme` for full
     *  subtree theme overrides. */
    public static SetVisualScheme(v: Visual, value: Scheme | undefined): void { v.set_property_value(ThemeManager.SchemeKey, value); }
    /** Read the ambient Theme override that applies to this Visual's
     *  subtree (§ 17.6). NB: distinct from `GetTheme(name)` which looks
     *  up a registered Theme by string identity. */
    public static GetVisualTheme(v: Visual): Theme | undefined { return v.get_property_value(ThemeManager.ThemeKey); }
    /** Write the local Theme override (§ 17.6). Subtree consumes the
     *  given Theme's ControlTemplates + default Styles. Setting Scheme
     *  alongside picks a particular Scheme inside the override Theme;
     *  leaving Scheme unset uses the override Theme's `defaultScheme`. */
    public static SetVisualTheme(v: Visual, value: Theme | undefined): void { v.set_property_value(ThemeManager.ThemeKey, value); }

    // Module-init: wire the ambient-token resolver hook + register the
    // Scheme / Theme descriptors as ambient-resource triggers. The
    // hooks live on `ResourceResolver` (§ 1.9) — the previous design
    // hung them off Visual as static fields, which kept `theme.ts →
    // visual.ts` import-cycle-free only by going through a function-
    // pointer hook. ResourceResolver is a dedicated collaborator that
    // theme.ts can import directly.
    static
    {
        ResourceResolver._setAmbientTokenResolver((v, key) =>
        {
            // The inherited DP cascade gives us the nearest-ancestor
            // value (or undefined when no ancestor has set Scheme).
            const scheme = v.get_property_value(ThemeManager.SchemeKey);
            if (scheme === undefined) return undefined;
            return scheme.tokens.get(key);
        });
        ResourceResolver._registerAmbientResourceTriggerDp(ThemeManager.SchemeKey.descriptor);
        ResourceResolver._registerAmbientResourceTriggerDp(ThemeManager.ThemeKey.descriptor);
    }

    // Test-only — reset all state. Used by tests that build fresh
    // Applications mid-suite and want a clean theme manager too.
    public static _resetForTesting(): void
    {
        ThemeManager._themes.clear();
        ThemeManager._activeTheme        = undefined;
        ThemeManager._activeScheme       = undefined;
        ThemeManager._activeApp          = undefined;
        ThemeManager._activeDictionaries = [];
        ThemeManager._activeTokenDict    = undefined;
        ThemeManager._activatedListeners.clear();
        ThemeManager._schemeTransition   = undefined;
        ThemeManager._mediaWatcher.Stop();
    }

    // ── Registered themes ─────────────────────────────────────────────

    private static readonly _themes = new Map<string, Theme>();

    /** Register a Theme. Validates each Scheme against the Theme's
     *  catalog (every catalog token must be provided after `basedOn`
     *  merging; types must match). Throws on contract violation. */
    public static RegisterTheme(theme: Theme): void
    {
        if (ThemeManager._themes.has(theme.name))
        {
            throw new Error(`Theme '${theme.name}' is already registered.`);
        }
        // Resolve basedOn for every scheme; validate against catalog.
        for (const scheme of theme.schemes.values())
        {
            const merged = ThemeManager.resolveBasedOn(scheme);
            ThemeManager.validateAgainstCatalog(theme, scheme, merged);
        }
        ThemeManager._themes.set(theme.name, theme);
    }

    /** Look up a registered Theme by name. */
    public static GetTheme(name: string): Theme | undefined
    {
        return ThemeManager._themes.get(name);
    }

    /** All themes currently registered, in registration order. The
     *  ThemeSelector control reads this to populate its theme dropdown;
     *  application-side tooling uses it for diagnostics ("which themes
     *  did this build import?"). The returned array is a fresh copy —
     *  mutating it has no effect on the registry. */
    public static get RegisteredThemes(): readonly Theme[]
    {
        return [...ThemeManager._themes.values()];
    }

    // Resolve `basedOn` chains. Returns the fully merged token dict for
    // the scheme. Detects circular borrowings.
    private static resolveBasedOn(scheme: Scheme): Map<string, unknown>
    {
        const visited = new Set<string>();
        const merged  = new Map<string, unknown>();
        const walk = (s: Scheme): void =>
        {
            if (visited.has(s.FullName))
            {
                throw new Error(
                    `Scheme '${s.FullName}': circular basedOn chain.`);
            }
            visited.add(s.FullName);
            if (s.basedOn !== undefined)
            {
                const [parentTheme, parentScheme] = s.basedOn.split('.');
                if (parentTheme === undefined || parentScheme === undefined)
                {
                    throw new Error(
                        `Scheme '${s.FullName}': basedOn must be '<theme>.<scheme>', `
                        + `got '${s.basedOn}'.`);
                }
                const parent = ThemeManager._themes.get(parentTheme)?.schemes.get(parentScheme);
                if (parent === undefined)
                {
                    throw new Error(
                        `Scheme '${s.FullName}': basedOn references unknown scheme `
                        + `'${s.basedOn}'. (Make sure the parent theme is registered first.)`);
                }
                walk(parent);
            }
            // Overlay this scheme's tokens (later wins).
            for (const [k, v] of s.tokens) merged.set(k, v);
        };
        walk(scheme);
        return merged;
    }

    // Validate that the merged token dict satisfies the theme's catalog.
    // Missing tokens are errors. Tokens beyond the catalog are
    // tolerated at runtime (the compiler issues a warning earlier).
    private static validateAgainstCatalog(
        theme:  Theme,
        scheme: Scheme,
        merged: ReadonlyMap<string, unknown>,
    ): void
    {
        const missing: string[] = [];
        for (const name of theme.catalog.keys())
        {
            if (!merged.has(name)) missing.push(name);
        }
        if (missing.length > 0)
        {
            throw new Error(
                `Scheme '${scheme.FullName}' is missing tokens required by theme `
                + `'${theme.name}': ${missing.join(', ')}.`);
        }
    }

    // ── Activation state ──────────────────────────────────────────────

    private static _activeTheme:    Theme  | undefined;
    private static _activeScheme:   Scheme | undefined;
    private static _activeApp:      Application       | undefined;
    private static _activeDictionaries: ResourceDictionary[]   = [];
    private static _activeTokenDict: ResourceDictionary | undefined;

    public static get ActiveTheme():  Theme  | undefined { return ThemeManager._activeTheme; }
    public static get ActiveScheme(): Scheme | undefined { return ThemeManager._activeScheme; }

    // ── Activation listeners ──────────────────────────────────────────
    //
    // Fired after every successful activate() — both theme swaps and
    // scheme-only swaps. ThemeSelector subscribes to keep its DPs in
    // sync when AutoScheme or any other code flips the active scheme
    // out from under it.
    private static readonly _activatedListeners = new Set<(theme: Theme, scheme: Scheme) => void>();

    public static AddActivatedListener(cb: (theme: Theme, scheme: Scheme) => void): void
    {
        ThemeManager._activatedListeners.add(cb);
    }

    public static RemoveActivatedListener(cb: (theme: Theme, scheme: Scheme) => void): void
    {
        ThemeManager._activatedListeners.delete(cb);
    }

    // ── Adaptive context (root-Visual bridge) ─────────────────────────
    //
    // Static getters/setters on ThemeManager bridge the inherited DPs
    // on the Application root for imperative code that doesn't want to
    // call ThemeManager.GetDensity(rootVisual) directly. The
    // MediaWatcher writes through the root visual; templates read via
    // `when(ThemeManager.Density = …)`.

    private static readonly _mediaWatcher = new MediaWatcher();

    public static get MediaWatcher(): MediaWatcher { return ThemeManager._mediaWatcher; }

    /** ViewportClass breakpoints (§ 17.9). Defaults to M3 baseline —
     *  `mobileMax=600`, `tabletMax=840`. Setting a new value re-classifies
     *  the current viewport immediately, so a downstream `when(ViewportClass=…)`
     *  trigger re-fires without waiting for the next resize. Reads
     *  delegate to MediaWatcher so the two stay in lockstep. */
    public static get Breakpoints(): ViewportBreakpoints
    {
        return ThemeManager._mediaWatcher.Breakpoints;
    }
    public static set Breakpoints(v: ViewportBreakpoints)
    {
        ThemeManager._mediaWatcher.Breakpoints = v;
    }

    /** Attach the MediaWatcher to a Visual (usually Application's
     *  root mount). Idempotent. After this, OS preference / viewport
     *  changes write the corresponding inherited DPs on `root`, which
     *  cascade to every descendant. */
    public static StartMediaWatcher(root: Visual): void
    {
        ThemeManager._mediaWatcher.Start(root);
    }

    /** Detach the MediaWatcher. Safe to call when not started. */
    public static StopMediaWatcher(): void
    {
        ThemeManager._mediaWatcher.Stop();
    }

    private static rootVisual(): Visual | undefined
    {
        const app = Application.current;
        return app?.Resources?.Root;
    }

    public static get Density(): Density
    {
        const v = ThemeManager.rootVisual();
        return v !== undefined ? ThemeManager.GetDensity(v) : Density.Regular;
    }

    public static set Density(value: Density)
    {
        const v = ThemeManager.rootVisual();
        if (v !== undefined) ThemeManager.SetDensity(v, value);
    }

    public static get ViewportClass(): ViewportClass
    {
        const v = ThemeManager.rootVisual();
        return v !== undefined ? ThemeManager.GetViewportClass(v) : ViewportClass.Desktop;
    }

    public static get Pointer(): Pointer
    {
        const v = ThemeManager.rootVisual();
        return v !== undefined ? ThemeManager.GetPointer(v) : Pointer.Fine;
    }

    public static get PrefersContrast(): PrefersContrast
    {
        const v = ThemeManager.rootVisual();
        return v !== undefined ? ThemeManager.GetPrefersContrast(v) : PrefersContrast.Normal;
    }

    public static get PrefersReducedMotion(): boolean
    {
        const v = ThemeManager.rootVisual();
        return v !== undefined ? ThemeManager.GetPrefersReducedMotion(v) : false;
    }

    public static get PrefersColorScheme(): PreferredScheme
    {
        const v = ThemeManager.rootVisual();
        return v !== undefined ? ThemeManager.GetPrefersColorScheme(v) : PreferredScheme.NoPreference;
    }

    // ── Scheme transitions ────────────────────────────────────────────
    //
    // Opt-in animation policy applied to ActivateScheme. Setting this
    // to a SchemeTransition object expresses intent — the actual
    // animation install at the DynamicResource layer is a follow-up
    // (the API surface ships now so consumers can wire their preferred
    // duration / easing without further code changes when the tween
    // lands). When undefined (default), all scheme swaps snap.
    private static _schemeTransition: SchemeTransition | undefined;

    public static get SchemeTransition(): SchemeTransition | undefined { return ThemeManager._schemeTransition; }
    public static set SchemeTransition(v: SchemeTransition | undefined) { ThemeManager._schemeTransition = v; }

    /** Effective transition for the next scheme swap. Returns
     *  `undefined` when no transition was configured OR when the
     *  active PrefersReducedMotion DP is true (a11y override). The
     *  DynamicResource integration consults this before deciding
     *  whether to animate or snap a particular token swap. */
    public static get EffectiveSchemeTransition(): SchemeTransition | undefined
    {
        if (ThemeManager._schemeTransition === undefined) return undefined;
        if (ThemeManager.PrefersReducedMotion)            return undefined;
        return ThemeManager._schemeTransition;
    }

    /** Activate a Theme by name. Optionally specify a starting Scheme;
     *  defaults to the Theme's `defaultScheme`. */
    public static ActivateTheme(name: string, opts?: ActivateThemeOptions): void
    {
        const theme = ThemeManager._themes.get(name);
        if (theme === undefined)
        {
            throw new Error(
                `ThemeManager.ActivateTheme: theme '${name}' is not registered.`);
        }
        const schemeName = opts?.scheme ?? theme.defaultScheme;
        const scheme     = theme.schemes.get(schemeName);
        if (scheme === undefined)
        {
            throw new Error(
                `ThemeManager.ActivateTheme: theme '${name}' has no scheme `
                + `'${schemeName}'.`);
        }
        ThemeManager.activate(theme, scheme);
    }

    /** Swap the scheme on the currently-active theme. */
    public static ActivateScheme(name: string): void
    {
        if (ThemeManager._activeTheme === undefined)
        {
            throw new Error(
                'ThemeManager.ActivateScheme: no active theme — call ActivateTheme first.');
        }
        const scheme = ThemeManager._activeTheme.schemes.get(name);
        if (scheme === undefined)
        {
            throw new Error(
                `ThemeManager.ActivateScheme: theme '${ThemeManager._activeTheme.name}' `
                + `has no scheme '${name}'.`);
        }
        ThemeManager.activate(ThemeManager._activeTheme, scheme);
    }

    /** Activate an arbitrary Scheme OBJECT globally — the seam for a scheme
     *  built at runtime (e.g. a dynamic Material scheme generated from a
     *  user-picked seed) that isn't one of a Theme's pre-registered, named
     *  schemes. Resolves the owning Theme from the scheme's `theme` name (or the
     *  active theme as a fallback), merges the scheme's tokens into
     *  Application.Resources exactly like ActivateScheme, and fires Activated so
     *  bound `@Token` resources re-resolve live. Throws if no owning theme is
     *  resolvable / no Application is current. */
    public static ApplyScheme(scheme: Scheme): void
    {
        const theme = ThemeManager._themes.get(scheme.theme) ?? ThemeManager._activeTheme;
        if (theme === undefined)
        {
            throw new Error(
                `ThemeManager.ApplyScheme: scheme '${scheme.name}' targets theme `
                + `'${scheme.theme}', which is not registered, and no theme is active.`);
        }
        ThemeManager.activate(theme, scheme);
    }

    /** Track OS color-scheme preference (`prefers-color-scheme`) and
     *  activate the matching scheme. `listen: true` attaches a
     *  matchMedia listener so future OS changes re-activate; `listen:
     *  false` reads once and pins. */
    public static AutoScheme(opts: AutoSchemeOptions): void
    {
        const mq = (typeof window !== 'undefined' && typeof window.matchMedia === 'function')
            ? window.matchMedia('(prefers-color-scheme: dark)')
            : undefined;
        const pick = (dark: boolean): string => dark ? opts.dark : opts.light;
        ThemeManager.ActivateScheme(pick(mq?.matches === true));
        if (opts.listen && mq !== undefined)
        {
            // detachable via removing the listener; for v1 we keep the
            // listener forever — the cost is one matchMedia handler.
            mq.addEventListener('change', e => ThemeManager.ActivateScheme(pick(e.matches)));
        }
    }

    // The single mutator — merges resources into Application.Resources.
    // Idempotent for the (theme, scheme) pair against the same
    // Application; re-merges if the Application changed since last call.
    private static activate(theme: Theme, scheme: Scheme): void
    {
        const app = Application.current;
        if (app === undefined || app === null)
        {
            throw new Error(
                'ThemeManager: no Application.current — construct an Application before activating a theme.');
        }

        // Same (theme, scheme, app) tuple? No-op.
        if (ThemeManager._activeTheme === theme
            && ThemeManager._activeScheme === scheme
            && ThemeManager._activeApp   === app)
        {
            return;
        }

        // Scheme-only swap on the SAME (theme, app)? Leave the theme
        // dictionaries in place and only churn the token dict. Removing
        // and re-adding the theme dictionaries with identical refs would
        // fire DynamicResource subscribers on every keyed entry — that
        // cascades through ItemsControl.OnPropertyChanged('ItemsPanel'),
        // which tears down realised containers; for popup-hosting
        // controls (MenuItem / MenuButton / ContextMenu) the cascade
        // hits ItemsControl.rebuildTemplate which assumes the template
        // root is still its visual child, but those controls detach it
        // in their ctor for overlay mounting. Easiest win: don't churn
        // what didn't change.
        const prevApp      = ThemeManager._activeApp;
        const sameApp      = prevApp === app;
        const sameTheme    = ThemeManager._activeTheme === theme && sameApp;
        const oldTokenDict = ThemeManager._activeTokenDict;

        // Theme STRUCTURAL dictionaries (ControlTemplates, default
        // Styles, DataTemplates) change only when the theme (or app)
        // changed. Token VALUES live in the scheme token dict handled
        // below — a scheme-only swap leaves these untouched.
        if (!sameTheme && prevApp !== undefined)
        {
            for (const d of ThemeManager._activeDictionaries)
            {
                prevApp.Resources.RemoveMergedDictionary(d);
            }
            ThemeManager._activeDictionaries = [];
        }

        // Cross-app reactivation: the old token dict lives in the OLD
        // app's Resources, so remove it there now (the add-before-remove
        // optimization below only helps within a single dictionary).
        if (!sameApp && prevApp !== undefined && oldTokenDict !== undefined)
        {
            prevApp.Resources.RemoveMergedDictionary(oldTokenDict);
        }
        ThemeManager._activeTokenDict = undefined;

        // BATCH the whole merge sequence (structural dicts AND the scheme token
        // dict): each AddMergedDictionary would otherwise fire a synchronous
        // style fan-out, letting an element already subscribed to
        // Application.Resources re-apply its style/template (and read eagerly)
        // while the token dict is still absent. Batched, one fan-out fires after
        // every dictionary is merged. Merge order — hence last-merged-wins
        // precedence — is unchanged.
        const tokenDict = new ResourceDictionary();
        app.Resources.Batch(() =>
        {
            // Merge the theme's dictionaries in array order — later entries
            // shadow earlier ones for the same key. The compiled
            // `.template.mu.js` outputs are mutable per-instance (each
            // .Clone() in the Theme ctor produces a fresh ResourceDictionary
            // subclass) so re-activation is symmetric without aliasing.
            if (!sameTheme)
            {
                const dictionaryRefs: ResourceDictionary[] = [];
                for (const d of theme.dictionaries)
                {
                    app.Resources.AddMergedDictionary(d);
                    dictionaryRefs.push(d);
                }
                ThemeManager._activeDictionaries = dictionaryRefs;
            }

            // Token dict — ADD-BEFORE-REMOVE within the same app. Merge the
            // NEW token dict first: `Resolve` walks merged dicts last-added
            // wins, so every token immediately resolves to its new value
            // while the old token dict is still present. Only THEN drop the
            // old dict — at which point no token's resolved value changes, so
            // the removal's notify is a no-op for every consumer.
            //
            // Paired with DynamicResource's per-key SubscribeKey this yields:
            // a token identical across the two schemes fires ZERO binding
            // refreshes; a token that changed fires each consumer exactly
            // ONCE. The previous remove-then-add fired twice per consumer
            // (old → undefined → new) and momentarily flashed `undefined`
            // through every bound slot mid-swap.
            const mergedTokens = ThemeManager.resolveBasedOn(scheme);
            for (const [k, v] of mergedTokens) tokenDict.Set(k, v);
            app.Resources.AddMergedDictionary(tokenDict);
            if (sameApp && oldTokenDict !== undefined)
            {
                app.Resources.RemoveMergedDictionary(oldTokenDict);
            }
        });

        ThemeManager._activeTheme     = theme;
        ThemeManager._activeScheme    = scheme;
        ThemeManager._activeApp       = app;
        ThemeManager._activeTokenDict = tokenDict;

        // Notify subscribers after state is committed so listeners that
        // read ActiveTheme/ActiveScheme observe the new values. Snapshot
        // the set so a listener that unsubscribes (or subscribes) during
        // dispatch doesn't perturb this iteration.
        for (const cb of [...ThemeManager._activatedListeners]) cb(theme, scheme);
    }
}

