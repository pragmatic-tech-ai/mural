import { Application, ThemeManager } from '../../runtime/index.js';
import { Pragmatic, PragmaticLight } from '../../resources/pragmatic/pragmatic.js';

// Test fixture — spins up an Application with Pragmatic activated.
//
// Use this in tests that construct controls. Controls read their
// default templates from the active theme's dictionaries, so a test
// that doesn't activate the theme gets
// `Application.ResolveDefaultResource(MyClass) === undefined` and
// `defaultTemplate(MyClass)` throws.
//
// SHARED Application semantics. The fixture reuses a SINGLE process-
// wide Application across every test that calls it, rather than
// creating a fresh instance per test. Why: ThemeManager.activate
// adds/removes its dictionaries from the *previous* active
// Application's Resources during re-activation. If test 1 holds
// references to Visuals constructed against app1 and test 2
// re-activates against app2, the removal cascade hits the still-live
// app1 Visuals via Resource Subscribe listeners and breaks template
// state — a real test-isolation hazard. Sharing one Application
// across tests sidesteps the cascade entirely; ambient state that
// would leak between tests (resource `Set`s, x:root markers, …) is
// rare in practice and easy to clean up per-test when needed.
//
// Helper file (not a .test.ts) so it isn't picked up by node's test
// runner. Lives under src/basic/tests/ to share its location with the
// suites that need it; framework / list / menu / tool-bar tests
// import via relative path.
let _sharedApp: Application | undefined;

export function initTestApp(): Application
{
    // Idempotent re-registration: after a prior test built a fresh
    // Application via `ThemeManager._resetForTesting()` the theme
    // registry is empty, so re-register before (re)building the app.
    if (ThemeManager.GetTheme(Pragmatic.instance.name) === undefined)
    {
        ThemeManager.RegisterTheme(Pragmatic.instance);
    }
    Application.RegisterDefaultTheme(Pragmatic);

    // Build the shared Application on first use, and rebuild it when a
    // prior test reset the ThemeManager — that leaves the cached app
    // with a dead theme (`_initialized` stays true, so `initialize()`
    // no longer re-activates). On the normal path — app built, Pragmatic
    // active — the single shared instance is reused untouched, so the
    // suites that share it are unaffected.
    if (_sharedApp === undefined || ThemeManager.ActiveTheme === undefined)
    {
        _sharedApp = new Application();
        _sharedApp.initialize({ theme: Pragmatic, scheme: PragmaticLight });
    }
    Application.current = _sharedApp;
    return _sharedApp;
}
