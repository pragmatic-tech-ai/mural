import { ResourceDictionary, type ResourceKey } from './resource-dictionary.js';
import { ServiceProvider } from '@pragmatic-tech-ai/todl-runtime';
import { ApplicationService } from './services/application-service.js';
import { ObservableCollection } from './observable-collection.js';
import { CompositionRoot, type HostKind, type IModule } from '@pragmatic-tech-ai/todl-runtime';
import type { IShellModule } from './shell-modules.js';
import type { Visual } from '../visual-engine/visual.js';

/** Theme class accepted by Application.initialize. Any subclass of
 *  `Theme` with the static `Activate(scheme?)` method satisfies this
 *  — the compiler-emitted `.mu` theme class implements it, as does
 *  the hand-written `Material` class. Kept as a structural type so
 *  consumers can author themes that don't share a base import. */
export interface ActivatableTheme extends Function
{
    Activate(scheme?: Function): void;
}

// Options for Application.initialize. Optional — when omitted, the
// theme registered via `Application.RegisterDefaultTheme(...)` is
// activated with its default scheme. Pass class references
// (`Material`, `MaterialLight`), never strings — the no-string-type-
// proxies rule applies here too.
export interface ApplicationInitOptions
{
    /** Theme class to activate. Defaults to whichever theme was
     *  registered first via `Application.RegisterDefaultTheme` when
     *  omitted. */
    theme?:  ActivatableTheme;

    /** Scheme class to activate inside the named theme. Defaults to
     *  the theme's `DefaultScheme` when omitted. Ignored when
     *  `autoScheme` is provided (OS preference wins). */
    scheme?: Function;

    /** Pick light/dark scheme from the OS `prefers-color-scheme` media
     *  query at startup. When set, takes precedence over `scheme`. */
    autoScheme?: AutoSchemeInitOptions;

    /** Optional DataContext to assign to the root visual. Equivalent
     *  to writing `app.DataContext = value` after the call returns. */
    dataContext?: unknown;
}

// Bind a light/dark scheme pair to the OS's `prefers-color-scheme`
// preference. Activated at `initialize()` time alongside the theme.
//
// Class refs match `ApplicationInitOptions.scheme` for consistency
// (no string proxies). When the host has no `matchMedia` available
// (Node tests, SSR), `light` is chosen — same semantics as a browser
// reporting `prefers-color-scheme: no-preference`.
export interface AutoSchemeInitOptions
{
    /** Scheme class activated when the OS reports a light preference
     *  (or no preference, or no `matchMedia` support). */
    light:  Function;

    /** Scheme class activated when the OS reports a dark preference. */
    dark:   Function;

    /** When `true` (default), attach a `matchMedia` change listener so
     *  later OS preference flips re-activate the scheme. Pass `false`
     *  to read once at init and pin. */
    listen?: boolean;
}

// Root container for a µ-mural application. Owns app-wide resources
// (themes, implicit styles, keyed templates, named brushes) and
// designates which Visual gets attached to a PresentationTarget at
// mount time.
//
// What Application is NOT: it isn't a Visual, doesn't participate in
// layout or render, doesn't dispatch events. Its only roles are
//   (1) holding the root ResourceDictionary,
//   (2) being the terminal stop of Visual.TryFindResource's ancestor
//       walk so app-level resources resolve from anywhere in the tree,
//   (3) carrying the x:root marker (via Resources.Root) so the host
//       knows what to mount.
//
// `current` is the WPF-style ambient singleton. Set in the constructor
// (last-construction-wins). For multi-app contexts (SSR with concurrent
// requests, embedded surfaces in a host app) callers can ignore
// `current` and pass an Application instance explicitly — the resource
// walk's fallback consults `current` only when the tree's logical
// parent chain exhausts without resolving.
//
// `Mount` is the generic ergonomic entry point: takes any object with
// a writable `Content` slot (typically a PresentationTarget subclass —
// HtmlTarget, HeadlessTarget) and writes Root into it. Duck-typed on
// purpose to keep the runtime layer from importing visual-engine; the
// consumer's import of HtmlTarget (or HeadlessTarget) supplies the
// concrete target type.

export interface MountableTarget
{
    Content: Visual | undefined;
}

export class Application extends CompositionRoot
{
    // Ambient singleton — last constructed instance wins. Cleared
    // explicitly by tests that need isolation.
    public static current: Application | null = null;

    // Listeners fired when a new Application becomes `current`. A resource
    // reference resolved before any Application exists — e.g. a DynamicResource
    // on a module const built at import time, before app.mu constructs the
    // Application — cannot subscribe to the app's Resources at creation. It
    // registers here and re-wires when the app appears, so a later `merge` /
    // Set resolves it. Not a general event bus: one narrow lifecycle signal.
    private static readonly _currentListeners = new Set<() => void>();

    /** INTERNAL — subscribe to "an Application became current". Returns an
     *  unsubscribe. Used by DynamicResource to recover a binding created
     *  before any Application existed. */
    public static _onCurrentChanged(listener: () => void): () => void
    {
        Application._currentListeners.add(listener);
        return () => { Application._currentListeners.delete(listener); };
    }

    public readonly Resources: ResourceDictionary = new ResourceDictionary();

    // Modules composed onto the shell via a `.modules:` block on the
    // Application (a sibling of `resources:`). Held as the runtime
    // IShellModule contract so runtime doesn't depend on the framework where
    // the concrete ShellModule lives; the shell's NavigationService flattens
    // their capabilities into the root navigation layer.
    public readonly Modules: ObservableCollection<IShellModule> = new ObservableCollection<IShellModule>();

    // The module dictionaries this Application has merged into `Resources`.
    // Tracked so a reconcile pass can tell module-contributed merged dicts
    // apart from the theme dictionaries `ThemeManager.activate` also merges in
    // — we only ever add/remove the ones a module owns.
    private readonly _mergedModuleDicts = new Set<ResourceDictionary>();

    // App-wide service composition root. Lazily created so apps that
    // never touch services pay nothing. The bootstrap registers
    // implementations here (storage, clock, navigation, …); demo
    // factories resolve from it to inject deps into VMs, keeping the VMs
    // themselves pure. Framework code and Behaviors may pull directly.
    // Per-view overrides layer on via `Services.createScope()`.
    // App-wide composition root provider. The CompositionRoot base builds it
    // lazily via CreateProvider (so apps that never compose a service-bearing
    // module pay nothing); we override CreateProvider to seed the application's
    // self-service. `Services` is the historical accessor — it delegates to the
    // base `Provider`.
    public get Services(): ServiceProvider { return this.Provider; }

    protected override CreateProvider(): ServiceProvider
    {
        const provider = new ServiceProvider();
        // The application's self-service — a singleton every scope beneath the
        // root can resolve to reach this Application and its modules. `Modules`
        // is live, so services that resolve it later see the fully populated set
        // even though it's empty at this point.
        provider.registerInstance(ApplicationService.Key, new ApplicationService(this));
        return provider;
    }

    constructor(hostKind?: HostKind)
    {
        super(hostKind);
        Application.current = this;
        // Wake any resource bindings that were created before an Application
        // existed (module-const DynamicResources) so they re-wire to this
        // app's Resources. Snapshot the set: listeners unsubscribe themselves.
        for (const listener of [...Application._currentListeners]) listener();
        // A module contributes its resources app-global: whenever `Modules`
        // changes (the `.modules:` block emits `Modules.Add(...)`), reconcile
        // the merged module dictionaries into `Resources`. Subscribing once and
        // reconciling from scratch handles add / remove / replace / move /
        // clear uniformly — the `cleared` event carries no items, so a
        // diff-from-current-contents pass is the only correct shape.
        this.Modules.Subscribe(() => {
            this.reconcileModuleResources();
            this.registerModuleServices();
        });
    }

    // Modules already composed into `Services` — so a module's registrations
    // are replayed exactly once, even though the subscription fires on every
    // Modules change. Registration is add-only: `ServiceProvider` exposes no
    // un-register, and the module's services are singletons on the root, so a
    // removed module's registrations linger harmlessly (nothing resolves their
    // tokens once its capabilities leave the navigation layer).
    private readonly _servicedModules = new Set<IShellModule>();

    // Compose one admitted module (CompositionRoot calls this only for modules
    // this host's kind admits). Route it through `Modules`, whose subscription
    // reconciles resources and registers services. Deliberately does NOT call
    // super — the subscription already registers into the same provider, so
    // calling super too would double-register.
    protected override ComposeModule(module: IModule): void
    {
        this.Modules.Add(module as IShellModule);
    }

    // Replay each newly-added module's declared service registrations into the
    // root `Services` provider (the module's "register services" seam). Guarded
    // by `HasServiceRegistrations` so a module that contributes none does NOT
    // realize the lazy provider — apps that never touch services still pay
    // nothing.
    private registerModuleServices(): void
    {
        for (const m of this.Modules)
        {
            if (this._servicedModules.has(m)) continue;
            this._servicedModules.add(m);
            if (!m.HasServiceRegistrations) continue;
            m.RegisterServices(this.Services);
        }
    }

    // Sync `Resources`' module-contributed merged dictionaries to the current
    // `Modules` contents. Idempotent: only touches dicts owned by a module
    // (tracked in `_mergedModuleDicts`), leaving theme dictionaries alone.
    private reconcileModuleResources(): void
    {
        const desired = new Set<ResourceDictionary>();
        for (const m of this.Modules) desired.add(m.Resources);

        for (const dict of this._mergedModuleDicts)
        {
            if (desired.has(dict)) continue;
            this.Resources.RemoveMergedDictionary(dict);
            this._mergedModuleDicts.delete(dict);
        }
        for (const dict of desired)
        {
            if (this._mergedModuleDicts.has(dict)) continue;
            this.Resources.AddMergedDictionary(dict);
            this._mergedModuleDicts.add(dict);
        }
    }

    // Resolve a resource (typically a default ControlTemplate) by key.
    // Walks `Application.current.Resources`, which the active theme
    // populates via its `dictionaries:` header (MuralBasic, MuralFramework,
    // and the theme's own body dict are all merged in by
    // ThemeManager.activate). A theme that hasn't been activated will
    // return undefined — `app.initialize({ theme, scheme })` is
    // mandatory before constructing any control that reads its
    // default Style.
    //
    // Accepts `string | Function` keys: built-in control templates are
    // keyed by the control's class function (Button, ListBox, …) under
    // the no-string-type-proxies rule; ad-hoc resources stay string-keyed.
    //
    // Class-keyed lookups walk the prototype chain on miss: a Style with
    // TargetType = ToggleButton (which doesn't register a theme of its
    // own) cleanly falls back to the Button theme it inherits from. This
    // matches the way DefaultStyleKey resolves and lets `[TargetType=X]`
    // Styles auto-BasedOn the nearest ancestor's theme without forcing
    // each subclass to redeclare its theme entry.
    public static ResolveDefaultResource<T = unknown>(key: ResourceKey): T | undefined
    {
        const app = Application.current;
        if (app === null) return undefined;
        for (let cur: ResourceKey | null = key; cur !== null; cur = nextPrototypeKey(cur))
        {
            const v = app.Resources.Resolve(cur);
            if (v !== undefined) return v as T;
        }
        return undefined;
    }

    // The root visual is INTERNAL state — consumers reach it through
    // `app.initialize(target, …)` (which mounts it onto a target),
    // through `app.DataContext` (which proxies to the root's
    // DataContext), or through the resource dictionary's marker
    // (`app.Resources.Root`) when tests need to assert against the
    // constructed tree. No `app.Root` shortcut by design: exposing the
    // root visual on the Application invites callers to mutate the
    // visual tree from outside, bypassing the data-bindings + lifecycle
    // contracts that the mount path enforces.
    private get _root(): Visual | undefined
    {
        return this.Resources.Root;
    }

    /** DataContext on the root visual. Reads/writes proxy to
     *  `Resources.Root.DataContext`. Setting before the root is
     *  registered (the compiler-emitted bind pass sets `Resources.Root`
     *  after constructing the tree) throws — the caller's data is
     *  meaningless without a tree to flow into. Reading before that
     *  point returns undefined. */
    public get DataContext(): unknown
    {
        return this._root?.DataContext;
    }
    public set DataContext(value: unknown)
    {
        const root = this._root;
        if (root === undefined)
        {
            throw new Error(
                'Application.DataContext: no x:root marker in Resources — '
                + 'set DataContext after the visual tree is constructed.',
            );
        }
        root.DataContext = value;
    }

    // ── Initialisation lifecycle ─────────────────────────────────────
    //
    // `initialize()` is the canonical "ready before any control gets
    // constructed" hook. Demo bootstraps call it after `new
    // Application()` and BEFORE building the visual tree — that ordering
    // guarantees DynamicResource lookups in the first paint see the
    // active theme's token dictionary, rather than resolving to
    // `undefined` and falling back to default-value brushes.
    //
    // What it does:
    //   1. If `opts.theme` is provided, calls
    //      `ThemeManager.ActivateTheme(theme, { scheme })` —
    //      same effect as the legacy `SetTheme(scheme)` helper, but
    //      generic across theme bundles.
    //   2. Marks the Application as initialised. `IsInitialized` flips
    //      to `true`; future tooling can assert against this.
    //
    // Idempotent — repeat calls are no-ops, so demo modules that import
    // each other can both call `initialize()` without conflict. The
    // first call wins.
    //
    // The named theme must already be registered with ThemeManager
    // BEFORE initialize runs. The standard pattern is to import the
    // theme bundle so its module-load side effect performs the
    // registration:
    //
    //   import '@pragmatic-tech-ai/mural/resources/material'; // registers Material
    //   const app = new Application();
    //   app.initialize({ theme: 'material', scheme: 'light' });
    //   // …construct the visual tree…
    private _initialized = false;

    public get IsInitialized(): boolean { return this._initialized; }

    // ── Default-theme registry ───────────────────────────────────────
    //
    // Theme bundles register themselves as default candidates at
    // module-load time. The FIRST class to call this wins; subsequent
    // registrations are ignored. Importing
    // `mural/resources/material` enrols `Material`
    // as the default — every demo that loads the Material bundle gets
    // it for free.
    //
    // This is NOT a callback hook: Application doesn't store a thunk
    // it calls later. The registered value is a CLASS reference whose
    // own static `Activate` method runs the activation. The class owns
    // its behaviour; Application just remembers which class is the
    // default.
    private static _defaultTheme: ActivatableTheme | undefined;

    public static RegisterDefaultTheme(themeClass: ActivatableTheme): void
    {
        if (Application._defaultTheme === undefined)
        {
            Application._defaultTheme = themeClass;
        }
    }

    /** The registered default theme, or `undefined` when no theme
     *  bundle has been imported yet. Test helper — production code
     *  should rely on `initialize()` picking it up implicitly. */
    public static get DefaultTheme(): ActivatableTheme | undefined
    {
        return Application._defaultTheme;
    }

    /** Test-only — drops the registered default so the next theme
     *  bundle re-registers on import. Production code never calls
     *  this; tests use it after `ThemeManager._resetForTesting`. */
    public static _resetDefaultThemeForTesting(): void
    {
        Application._defaultTheme = undefined;
    }

    /** Theme-only initialize — called by the compiler-emitted IIFE
     *  *before* the visual tree is built so DynamicResource lookups
     *  inside the body resolve against the active token dictionary on
     *  first paint. Theme activation is idempotent: a subsequent
     *  initialize call with a different theme does NOT re-activate
     *  (the second activation would unmount live visuals from the
     *  first theme's dictionaries). */
    public initialize(opts?: ApplicationInitOptions): void;
    /** Mount-mode initialize — called by the host script *after* the
     *  visual tree is built. Activates the theme (idempotent — no-op
     *  if a prior initialize already did), attaches the root visual to
     *  `target.Content`, and applies `opts.dataContext` to the root if
     *  provided. Returns the target so callers can chain a handle. */
    public initialize<T extends MountableTarget>(target: T, opts?: ApplicationInitOptions): T;
    public initialize<T extends MountableTarget>(
        targetOrOpts?: T | ApplicationInitOptions,
        opts?: ApplicationInitOptions,
    ): T | void
    {
        // Distinguish the two overloads. MountableTarget has a writable
        // `Content` slot — the duck-type check matches any concrete
        // PresentationTarget (HtmlTarget, HeadlessTarget, custom hosts).
        // ApplicationInitOptions doesn't carry `Content`, so the
        // discrimination is unambiguous.
        let target: T | undefined;
        let init: ApplicationInitOptions | undefined;
        if (targetOrOpts !== undefined && 'Content' in (targetOrOpts as object))
        {
            target = targetOrOpts as T;
            init   = opts;
        }
        else
        {
            init = targetOrOpts as ApplicationInitOptions | undefined;
        }

        // Theme activation rides the existing idempotency. Re-activation
        // would tear down the first theme's dictionaries and re-merge
        // the new ones — a Resource cascade that can fire on already-
        // realised Visuals whose Style.Resource subscriptions outlived
        // the first theme. First-wins keeps that hazard out.
        if (!this._initialized)
        {
            const themeClass = init?.theme ?? Application._defaultTheme;
            if (themeClass !== undefined)
            {
                // `autoScheme` overrides `scheme` — when both are present
                // the OS preference wins at the first activation.
                const initialScheme = init?.autoScheme !== undefined
                    ? pickAutoScheme(init.autoScheme)
                    : init?.scheme;
                themeClass.Activate(initialScheme);
            }
            this._initialized = true;
        }

        // autoScheme handling lives OUTSIDE the _initialized gate so a
        // host script can override OS-preference tracking on a later
        // `initialize(target, ...)` call even when an earlier theme-only
        // IIFE already ran (and activated the .mu file's defaultScheme).
        // Re-activation here is the WHOLE POINT — the .mu IIFE picked
        // its compile-time default; the host's autoScheme call replaces
        // that pick with the OS preference. Same-(theme, scheme) is a
        // no-op inside ThemeManager, so calls where the .mu default and
        // the OS preference happen to match cost nothing.
        if (init?.autoScheme !== undefined)
        {
            const themeClass = init.theme ?? Application._defaultTheme;
            if (themeClass !== undefined)
            {
                themeClass.Activate(pickAutoScheme(init.autoScheme));
                this.attachAutoSchemeListener(themeClass, init.autoScheme);
            }
        }

        // Mount + DataContext are NOT gated by _initialized — the host
        // can call initialize repeatedly with a different target /
        // dataContext to re-host or rebind the same Application
        // (e.g. portal-mounted previews, hot-reload).
        if (target !== undefined)
        {
            const root = this._root;
            if (root === undefined)
            {
                throw new Error(
                    'Application.initialize: no x:root marker in Resources — nothing to mount.',
                );
            }
            target.Content = root;
        }

        if (init?.dataContext !== undefined)
        {
            const root = this._root;
            if (root === undefined)
            {
                throw new Error(
                    'Application.initialize: cannot set DataContext without an x:root marker.',
                );
            }
            root.DataContext = init.dataContext;
        }

        return target;
    }

    // Once per Application instance — guards against stacking duplicate
    // matchMedia listeners when initialize() runs multiple times (e.g.
    // theme-only IIFE + host mount, both carrying autoScheme).
    private _autoSchemeListenerAttached = false;

    private attachAutoSchemeListener(
        themeClass: ActivatableTheme,
        opts:       AutoSchemeInitOptions,
    ): void
    {
        if (opts.listen === false) return;
        if (this._autoSchemeListenerAttached) return;
        const mql = osColorSchemeMql();
        if (mql === undefined) return;
        const handler = (e: { matches: boolean }): void => {
            themeClass.Activate(e.matches ? opts.dark : opts.light);
        };
        mql.addEventListener('change', handler);
        this._autoSchemeListenerAttached = true;
    }
}

// One-shot OS-preference read: returns the scheme class matching the
// current `prefers-color-scheme` media query. Used to seed
// `themeClass.Activate(...)` at initialize() time. Falls back to
// `opts.light` when `matchMedia` is unavailable (Node tests, SSR) or
// when the OS reports no preference.
function pickAutoScheme(opts: AutoSchemeInitOptions): Function
{
    const mql = osColorSchemeMql();
    return mql?.matches === true ? opts.dark : opts.light;
}

// Resolve the `prefers-color-scheme: dark` MediaQueryList off either
// `window.matchMedia` (browsers) or a globalThis-mounted `matchMedia`
// shim (test fixtures). Returns undefined when neither is available.
// Mirrors the detection pattern in adaptive.ts so behaviour stays
// consistent across the runtime.
function osColorSchemeMql():
    { matches: boolean; addEventListener(t: 'change', l: (e: { matches: boolean }) => void): void } | undefined
{
    const g: typeof globalThis & {
        window?:    typeof globalThis & { matchMedia?(query: string): MediaQueryList };
        matchMedia?: (query: string) => MediaQueryList;
    } = globalThis;
    const win = g.window;
    const matchMedia = (typeof win?.matchMedia === 'function')
        ? win.matchMedia.bind(win)
        : (typeof g.matchMedia === 'function' ? g.matchMedia : undefined);
    if (matchMedia === undefined) return undefined;
    return matchMedia('(prefers-color-scheme: dark)');
}

// Walk the prototype chain of a class-keyed lookup. String keys end
// the walk immediately (they're not class-shaped). For Function keys,
// `Object.getPrototypeOf(C)` is `C`'s parent constructor — `Button`'s
// parent is `ContentControl`, etc. The walk terminates when the chain
// hits the base `Function.prototype` (Object's own constructor proto).
function nextPrototypeKey(key: ResourceKey): ResourceKey | null
{
    if (typeof key !== 'function') return null;
    const proto = Object.getPrototypeOf(key);
    if (typeof proto !== 'function' || proto === Function.prototype) return null;
    return proto;
}
