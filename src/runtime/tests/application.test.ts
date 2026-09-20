import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    Application,
    MetaData,
    MuralBase,
    Panel,
    ResourceDictionary,
    Scheme,
    Size,
    Theme,
    ThemeManager,
    Element,
    Visual,
    ServiceKey,
    type DrawingContext,
    type MountableTarget,
} from '../index.js';
import { resolveKey } from '../model-internals.js';

// Tiny Visual used as a stand-in for the application's root and as a
// resource-walk leaf. Plain Visual is abstract; this satisfies it
// minimally.
class TestLeaf extends Element
{
    static
    {
        MuralBase.RegisterProperty(TestLeaf, 'Brush', undefined, MetaData.None);
    }
    public get Brush(): unknown { return this.get_property_value(resolveKey(this, undefined, 'Brush')); }
    public set Brush(v: unknown) { this.set_property_value(resolveKey(this, undefined, 'Brush'), v); }
    protected override MeasureOverride(_a: Size): Size { return Size.Zero; }
    protected override RenderOverride(_dc: DrawingContext): void { }
}

// Minimal MountableTarget — the consumer's PresentationTarget would
// satisfy this structurally; for tests a plain object is enough.
function makeFakeTarget(): MountableTarget
{
    return { Content: undefined };
}

describe('Application — construction and ambient singleton', () => {
    // Tests intentionally clear the ambient singleton before each run
    // so cross-test pollution doesn't mask bugs in the fallback path.
    beforeEach(() => { Application.current = null; });

    test('constructor sets Application.current to the new instance', () => {
        assert.equal(Application.current, null);
        const app = new Application();
        assert.equal(Application.current, app);
    });

    test('last-constructed wins for the ambient singleton', () => {
        const a = new Application();
        const b = new Application();
        assert.equal(Application.current, b);
        // The earlier instance still exists; nothing destroys it.
        assert.notEqual(a, b);
    });

    test('Resources is a fresh ResourceDictionary per instance', () => {
        const a = new Application();
        const b = new Application();
        assert.notEqual(a.Resources, b.Resources);
        a.Resources.Set('K', 'a-value');
        assert.equal(b.Resources.CanResolve('K'), false);
    });
});

describe('Application — initialize(target) mounting', () => {
    beforeEach(() => { Application.current = null; });

    test('initialize(target) throws when no x:root has been registered', () => {
        const app = new Application();
        const target = makeFakeTarget();
        assert.throws(
            () => app.initialize(target),
            /no x:root marker in Resources/,
        );
        // Target unchanged on failure.
        assert.equal(target.Content, undefined);
    });

    test('initialize(target) assigns Resources.Root to target.Content and returns the target', () => {
        const app = new Application();
        const root = new TestLeaf();
        app.Resources.Root = root;
        const target = makeFakeTarget();
        const result = app.initialize(target);
        assert.equal(target.Content, root);
        assert.equal(result, target);
    });

    test('initialize(target, { dataContext }) assigns dataContext to the root', () => {
        const app = new Application();
        const root = new TestLeaf();
        app.Resources.Root = root;
        const target = makeFakeTarget();
        const vm = { name: 'vm' };
        app.initialize(target, { dataContext: vm });
        assert.equal(root.DataContext, vm);
    });

    test('app.DataContext getter/setter proxies to the root visual', () => {
        const app = new Application();
        const root = new TestLeaf();
        app.Resources.Root = root;
        const vm = { name: 'vm' };
        app.DataContext = vm;
        assert.equal(root.DataContext, vm);
        assert.equal(app.DataContext, vm);
    });

    test('app.DataContext setter throws before Resources.Root is set', () => {
        const app = new Application();
        assert.throws(
            () => { app.DataContext = { x: 1 }; },
            /no x:root marker in Resources/,
        );
    });
});

describe('Application — resource-walk fallback', () => {
    beforeEach(() => { Application.current = null; });

    test('Visual.TryFindResource falls back to Application.current.Resources after tree exhaustion', () => {
        // A leaf with no Resources, no parents — the tree walk
        // exhausts immediately. The Application fallback should pick
        // up the key from the app's root dict.
        const app = new Application();
        app.Resources.Set('Theme', 'dark');

        const leaf = new TestLeaf();
        assert.equal(leaf.TryFindResource('Theme'), 'dark');
    });

    test('falls back to undefined when no Application.current is set', () => {
        // No `new Application()` — the beforeEach hook nulled the singleton.
        const leaf = new TestLeaf();
        assert.equal(leaf.TryFindResource('Theme'), undefined);
    });

    test('ancestor Resources shadow Application.Resources for the same key', () => {
        const app = new Application();
        app.Resources.Set('Brush', 'app-level');

        class TestPanel extends Panel { }
        const root = new TestPanel();
        root.Resources.Set('Brush', 'ancestor-level');

        const leaf = new TestLeaf();
        root.AddChild(leaf);

        // The tree walk hits root.Resources first and short-circuits.
        assert.equal(leaf.TryFindResource('Brush'), 'ancestor-level');
    });

    test('Application.Resources answers when no ancestor has the key', () => {
        const app = new Application();
        app.Resources.Set('OnlyAtApp', 42);

        class TestPanel extends Panel { }
        const root = new TestPanel();
        root.Resources.Set('Other', 'something-else');

        const leaf = new TestLeaf();
        root.AddChild(leaf);

        assert.equal(leaf.TryFindResource('OnlyAtApp'), 42);
        assert.equal(leaf.TryFindResource('Other'),    'something-else');
        assert.equal(leaf.TryFindResource('Missing'),  undefined);
    });
});

describe('Application.initialize', () => {
    // Fresh manager + app per test — initialize is stateful (flips
    // IsInitialized to true) and ThemeManager activates merge into
    // Application.Resources. Cross-test leak would mask real bugs.
    beforeEach(() => {
        ThemeManager._resetForTesting();
        Application._resetDefaultThemeForTesting();
        Application.current = null;
    });

    // Tiny test theme — emulates a compiler-emitted theme class
    // shape so the test exercises the same code path Material does
    // without pulling in the visual-engine cycle.
    class TinyLight extends Scheme
    {
        public static readonly instance: TinyLight = new TinyLight();
        private constructor()
        {
            super({ name: 'TinyLight', theme: 'Tiny', tokens: { Token: 'L' } });
        }
    }
    class TinyDark extends Scheme
    {
        public static readonly instance: TinyDark = new TinyDark();
        private constructor()
        {
            super({ name: 'TinyDark', theme: 'Tiny', tokens: { Token: 'D' } });
        }
    }
    class Tiny extends Theme
    {
        public static readonly instance: Tiny = new Tiny();
        private constructor()
        {
            super({
                name:           'Tiny',
                dictionaries:   [new ResourceDictionary()],
                catalog:        new Map([['Token', { type: 'string' }]]),
                schemes:        [TinyLight.instance, TinyDark.instance],
                defaultScheme:  'TinyLight',
            });
        }
        public static override Activate(scheme?: typeof Scheme): void
        {
            const target = scheme ?? TinyLight;
            ThemeManager.ActivateTheme(Tiny.instance.name, { scheme: target.name });
        }
    }

    function registerTiny(): void
    {
        if (ThemeManager.GetTheme('Tiny') === undefined)
        {
            ThemeManager.RegisterTheme(Tiny.instance);
        }
    }

    test('fresh Application is not yet initialized', () => {
        const app = new Application();
        assert.equal(app.IsInitialized, false);
    });

    test('initialize() with no options flips IsInitialized to true and activates the registered default theme', () => {
        registerTiny();
        Application.RegisterDefaultTheme(Tiny);
        const app = new Application();
        app.initialize();
        assert.equal(app.IsInitialized, true);
        assert.equal(ThemeManager.ActiveTheme?.name, 'Tiny',
            'default theme is activated implicitly');
    });

    test('initialize() with no options and no registered default is a quiet no-op', () => {
        const app = new Application();
        app.initialize();
        assert.equal(app.IsInitialized, true);
        assert.equal(ThemeManager.ActiveTheme, undefined);
    });

    test('initialize({ theme }) activates the theme via its static Activate', () => {
        registerTiny();
        const app = new Application();
        app.initialize({ theme: Tiny });
        assert.equal(app.IsInitialized, true);
        assert.equal(ThemeManager.ActiveTheme?.name, 'Tiny');
        assert.equal(ThemeManager.ActiveScheme?.name, 'TinyLight',
            'omitted scheme falls back to the theme DefaultScheme');
        assert.equal(app.Resources.Resolve('Token'), 'L',
            'theme tokens are merged into the application resource chain');
    });

    test('initialize({ theme, scheme }) activates the named scheme', () => {
        registerTiny();
        const app = new Application();
        app.initialize({ theme: Tiny, scheme: TinyDark });
        assert.equal(ThemeManager.ActiveScheme?.name, 'TinyDark');
        assert.equal(app.Resources.Resolve('Token'), 'D');
    });

    test('initialize is idempotent — repeat calls are no-ops', () => {
        registerTiny();
        const app = new Application();
        app.initialize({ theme: Tiny, scheme: TinyDark });
        app.initialize({ theme: Tiny, scheme: TinyLight });
        assert.equal(ThemeManager.ActiveScheme?.name, 'TinyDark',
            'second initialize did not re-activate');
    });

    test('RegisterDefaultTheme is first-wins', () => {
        registerTiny();
        Application.RegisterDefaultTheme(Tiny);
        // Build a second theme; registering it should NOT replace Tiny
        // as the default. The Theme ctor's scheme/theme cross-check
        // requires this theme's scheme to target itself, so build a
        // standalone scheme.
        class OtherLight extends Scheme
        {
            public static readonly instance: OtherLight = new OtherLight();
            private constructor()
            {
                super({ name: 'OtherLight', theme: 'Other', tokens: { Token: '_' } });
            }
        }
        class Other extends Theme
        {
            public static readonly instance: Other = new Other();
            private constructor()
            {
                super({
                    name: 'Other',
                    dictionaries: [],
                    catalog: new Map([['Token', { type: 'string' }]]),
                    schemes: [OtherLight.instance],
                    defaultScheme: 'OtherLight',
                });
            }
            public static override Activate(): void { /* unused */ }
        }
        Application.RegisterDefaultTheme(Other);
        assert.equal(Application.DefaultTheme, Tiny,
            'first registered theme remains the default');
    });
});

describe('Application.initialize — autoScheme (OS prefers-color-scheme)', () => {
    // Tiny test theme — same shape as the Application.initialize
    // describe block above but defined locally so the matchMedia
    // mocking stays scoped.
    class AutoSchemeLight extends Scheme
    {
        public static readonly instance: AutoSchemeLight = new AutoSchemeLight();
        private constructor()
        {
            super({ name: 'AutoSchemeLight', theme: 'AutoSchemeTheme', tokens: { Token: 'L' } });
        }
    }
    class AutoSchemeDark extends Scheme
    {
        public static readonly instance: AutoSchemeDark = new AutoSchemeDark();
        private constructor()
        {
            super({ name: 'AutoSchemeDark', theme: 'AutoSchemeTheme', tokens: { Token: 'D' } });
        }
    }
    class AutoSchemeTheme extends Theme
    {
        public static readonly instance: AutoSchemeTheme = new AutoSchemeTheme();
        private constructor()
        {
            super({
                name:          'AutoSchemeTheme',
                dictionaries:  [new ResourceDictionary()],
                catalog:       new Map([['Token', { type: 'string' }]]),
                schemes:       [AutoSchemeLight.instance, AutoSchemeDark.instance],
                defaultScheme: 'AutoSchemeLight',
            });
        }
        public static override Activate(scheme?: typeof Scheme): void
        {
            const target = scheme ?? AutoSchemeLight;
            ThemeManager.ActivateTheme(AutoSchemeTheme.instance.name, { scheme: target.name });
        }
    }

    // Mock MediaQueryList — supports a controllable .matches plus a
    // single 'change' listener (matches Application's usage).
    class MockMql
    {
        public matches:    boolean;
        private listener:  ((e: { matches: boolean }) => void) | undefined;
        constructor(initial: boolean) { this.matches = initial; }
        public addEventListener(_: 'change', l: (e: { matches: boolean }) => void): void
        {
            this.listener = l;
        }
        public fire(matches: boolean): void
        {
            this.matches = matches;
            this.listener?.({ matches });
        }
    }

    let installedMql: MockMql | undefined;
    let originalMatchMedia: ((q: string) => MediaQueryList) | undefined;

    function installMatchMedia(initialDark: boolean): MockMql
    {
        installedMql = new MockMql(initialDark);
        // Cast to escape TS's strict MediaQueryList shape — our mock
        // only needs the matches + addEventListener surface that
        // Application's autoScheme path actually touches.
        (globalThis as unknown as { matchMedia: (q: string) => MediaQueryList })
            .matchMedia = (_q: string) => installedMql as unknown as MediaQueryList;
        return installedMql;
    }

    function uninstallMatchMedia(): void
    {
        const g = globalThis as unknown as { matchMedia?: (q: string) => MediaQueryList };
        if (originalMatchMedia !== undefined) g.matchMedia = originalMatchMedia;
        else delete g.matchMedia;
        installedMql = undefined;
    }

    beforeEach(() => {
        ThemeManager._resetForTesting();
        Application._resetDefaultThemeForTesting();
        Application.current = null;
        const g = globalThis as unknown as { matchMedia?: (q: string) => MediaQueryList };
        originalMatchMedia = g.matchMedia;
        if (ThemeManager.GetTheme('AutoSchemeTheme') === undefined)
        {
            ThemeManager.RegisterTheme(AutoSchemeTheme.instance);
        }
    });

    test('autoScheme picks the dark scheme when OS prefers dark', () => {
        installMatchMedia(/* dark */ true);
        try
        {
            const app = new Application();
            app.initialize({
                theme:      AutoSchemeTheme,
                autoScheme: { light: AutoSchemeLight, dark: AutoSchemeDark },
            });
            assert.equal(ThemeManager.ActiveScheme?.name, 'AutoSchemeDark');
        }
        finally { uninstallMatchMedia(); }
    });

    test('autoScheme picks the light scheme when OS prefers light', () => {
        installMatchMedia(/* dark */ false);
        try
        {
            const app = new Application();
            app.initialize({
                theme:      AutoSchemeTheme,
                autoScheme: { light: AutoSchemeLight, dark: AutoSchemeDark },
            });
            assert.equal(ThemeManager.ActiveScheme?.name, 'AutoSchemeLight');
        }
        finally { uninstallMatchMedia(); }
    });

    test('autoScheme takes precedence over scheme when both are supplied', () => {
        installMatchMedia(/* dark */ true);
        try
        {
            const app = new Application();
            app.initialize({
                theme:      AutoSchemeTheme,
                scheme:     AutoSchemeLight,
                autoScheme: { light: AutoSchemeLight, dark: AutoSchemeDark },
            });
            assert.equal(ThemeManager.ActiveScheme?.name, 'AutoSchemeDark',
                'autoScheme overrides the explicit scheme');
        }
        finally { uninstallMatchMedia(); }
    });

    test('listen defaults to true — OS preference flips re-activate the scheme', () => {
        const mql = installMatchMedia(/* dark */ false);
        try
        {
            const app = new Application();
            app.initialize({
                theme:      AutoSchemeTheme,
                autoScheme: { light: AutoSchemeLight, dark: AutoSchemeDark },
            });
            assert.equal(ThemeManager.ActiveScheme?.name, 'AutoSchemeLight');
            mql.fire(true);
            assert.equal(ThemeManager.ActiveScheme?.name, 'AutoSchemeDark');
            mql.fire(false);
            assert.equal(ThemeManager.ActiveScheme?.name, 'AutoSchemeLight');
        }
        finally { uninstallMatchMedia(); }
    });

    test('listen: false — initial pick honoured, later OS flips ignored', () => {
        const mql = installMatchMedia(/* dark */ true);
        try
        {
            const app = new Application();
            app.initialize({
                theme:      AutoSchemeTheme,
                autoScheme: { light: AutoSchemeLight, dark: AutoSchemeDark, listen: false },
            });
            assert.equal(ThemeManager.ActiveScheme?.name, 'AutoSchemeDark');
            mql.fire(false);
            assert.equal(ThemeManager.ActiveScheme?.name, 'AutoSchemeDark',
                'no listener attached → ActiveScheme unchanged');
        }
        finally { uninstallMatchMedia(); }
    });

    test('multiple initialize calls with autoScheme do not stack listeners', () => {
        // A simple stacking detector: each `addEventListener` call would
        // bump the listener count; we keep a single listener slot in
        // MockMql, but track addEventListener invocations.
        let registered = 0;
        const original = MockMql.prototype.addEventListener;
        MockMql.prototype.addEventListener = function patched(
            this: MockMql, t: 'change', l: (e: { matches: boolean }) => void,
        ): void
        {
            registered++;
            original.call(this, t, l);
        };
        installMatchMedia(/* dark */ false);
        try
        {
            const app = new Application();
            app.initialize({
                theme:      AutoSchemeTheme,
                autoScheme: { light: AutoSchemeLight, dark: AutoSchemeDark },
            });
            // Second initialize on the same Application with autoScheme
            // should NOT attach a second listener.
            app.initialize({
                theme:      AutoSchemeTheme,
                autoScheme: { light: AutoSchemeLight, dark: AutoSchemeDark },
            });
            assert.equal(registered, 1,
                'listener attached exactly once per Application');
        }
        finally
        {
            MockMql.prototype.addEventListener = original;
            uninstallMatchMedia();
        }
    });

    test('later autoScheme call overrides an earlier scheme pick (the .mu IIFE case)', () => {
        // The platform host pattern: the compiled `.mu` IIFE runs
        // initialize first with the file's defaultScheme (e.g. Light),
        // then the host script calls initialize again with autoScheme
        // wired to MaterialLight/MaterialDark. The autoScheme call must
        // re-pick the scheme even though _initialized is already true —
        // otherwise the .mu default sticks and the OS preference is
        // never honoured at startup.
        installMatchMedia(/* dark */ true);
        try
        {
            const app = new Application();
            app.initialize({ theme: AutoSchemeTheme, scheme: AutoSchemeLight });
            assert.equal(ThemeManager.ActiveScheme?.name, 'AutoSchemeLight',
                'first call activates the explicit Light scheme');
            app.initialize({
                theme:      AutoSchemeTheme,
                autoScheme: { light: AutoSchemeLight, dark: AutoSchemeDark },
            });
            assert.equal(ThemeManager.ActiveScheme?.name, 'AutoSchemeDark',
                'second call with autoScheme re-activates to match OS preference');
        }
        finally { uninstallMatchMedia(); }
    });

    test('no matchMedia available — falls back to the light scheme', () => {
        // No installMatchMedia call — matchMedia is undefined on
        // globalThis. autoScheme should still pick light.
        const g = globalThis as unknown as { matchMedia?: (q: string) => MediaQueryList };
        const prior = g.matchMedia;
        delete g.matchMedia;
        try
        {
            const app = new Application();
            app.initialize({
                theme:      AutoSchemeTheme,
                autoScheme: { light: AutoSchemeLight, dark: AutoSchemeDark },
            });
            assert.equal(ThemeManager.ActiveScheme?.name, 'AutoSchemeLight');
        }
        finally
        {
            if (prior !== undefined) g.matchMedia = prior;
        }
    });
});

describe('Application.Services', () => {

    test('exposes a lazily-created ServiceProvider, stable across reads', () => {
        const app = new Application();
        assert.equal(app.Services, app.Services, 'same provider instance on repeat reads');
    });

    test('services registered on the ambient provider resolve from Application.current', () => {
        const app = new Application();
        const Key = new ServiceKey<{ id: string }>('Probe');
        app.Services.registerInstance(Key, { id: 'wired' });
        assert.equal(Application.current!.Services.getRequired(Key).id, 'wired');
    });

    test('each Application owns an independent provider', () => {
        const Key = new ServiceKey<number>('N');
        const a = new Application();
        a.Services.registerInstance(Key, 1);
        const b = new Application();
        assert.equal(a.Services.get(Key), 1);
        assert.equal(b.Services.get(Key), undefined, 'b has its own empty provider');
    });
});
