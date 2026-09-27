import { Application, Scheme, ThemeManager, type Element } from '../../../runtime/index.js';
import { HeadlessTarget, SolidColorBrush, SvgDrawingContext } from '../../../visual-engine/index.js';
import { Material } from '../../material/material.js';
import { Pragmatic, PragmaticControls } from '../pragmatic.js';

// A scheme handle as the compiler emits it — a class carrying a singleton
// `instance` (the runtime Scheme). PragmaticLight / MaterialDark / … all
// match this shape, so the harness stays theme-agnostic: it activates
// whatever scheme it is handed via the scheme's own `theme` name.
export interface SchemeHandle
{
    readonly instance: Scheme;
}

export interface RenderOptions
{
    readonly scheme: SchemeHandle;
}

export interface RenderResult
{
    readonly control: Element;
    readonly svg:     string;
}

// Shared render harness for the Pragmatic control-fork tests (Wave 1).
//
// General by design — Task 1 forks Button, but every later family reuses
// this: pass a control FACTORY and a scheme, get back the control plus
// the SVG it painted under that scheme. The factory runs AFTER the theme
// is active so the control resolves its Pragmatic style at construction.
//
// Render models the headless render pipeline on the repo's own render
// tests (src/basic/tests/text-block.test.ts): a HeadlessTarget rooted on
// the control, painted once through an SvgDrawingContext.
export class ControlHarness
{
    private static readonly PragmaticThemeName = 'Pragmatic';
    private static readonly MaterialThemeName  = 'Material';
    // The "missing theme" fallback ink the renderer paints when no palette
    // resolves a colour (theme.ts NEUTRAL). Its presence in a control's
    // SVG means a token failed to resolve — Wave 1 asserts its ABSENCE.
    public static readonly NeutralFallbackCss = 'rgb(128,128,128)';
    private static readonly SurfaceWidth  = 240;
    private static readonly SurfaceHeight = 96;

    // Register both themes (idempotently), root a fresh Application, and
    // activate `scheme` on it. Returns the Application. Use directly for
    // resolution-only checks that must not paint (e.g. asserting an
    // un-forked control still resolves its Material style); Render builds
    // on it for the paint path.
    public static Activate(scheme: SchemeHandle): Application
    {
        ControlHarness.EnsureThemesRegistered();
        // Every activation owns a fresh Application so state can't leak
        // between calls; the caller resets ThemeManager afterwards.
        const app = new Application();
        Application.current = app;
        ThemeManager.ApplyScheme(scheme.instance);
        return app;
    }

    // Tear down after a Render/Activate: clear the ThemeManager registry
    // and the current Application so the next test starts clean. Every
    // Pragmatic control-fork test calls this at the end of each case.
    public static Reset(): void
    {
        ThemeManager._resetForTesting();
        Application.current = undefined;
    }

    // Activate `scheme`, build the control, and paint it once to SVG.
    public static Render(makeControl: () => Element, opts: RenderOptions): RenderResult
    {
        ControlHarness.Activate(opts.scheme);

        const control = makeControl();
        const target = new HeadlessTarget(
            ControlHarness.SurfaceWidth, ControlHarness.SurfaceHeight, control);
        const dc = new SvgDrawingContext();
        target.Render(dc);
        return { control, svg: dc.ToFragment() };
    }

    // True when `control` resolves its implicit style to the Pragmatic
    // override — i.e. the very Button-keyed Style that PragmaticControls
    // holds inside the active theme (identity comparison, so a Material
    // resolution or a non-wired dictionary reads as false).
    public static IsPragmaticStyle(control: Element): boolean
    {
        const resolved = control.TryFindResource(control.constructor);
        const controlsDict = Pragmatic.instance.dictionaries.find(
            d => d instanceof PragmaticControls);
        const pragmaticStyle = controlsDict?.Resolve(control.constructor);
        return pragmaticStyle !== undefined && resolved === pragmaticStyle;
    }

    // The CSS colour a token resolves to under the active scheme (e.g.
    // ActionPrimary → 'rgb(34,130,77)'). Lets colour assertions read the
    // expected value from the live palette instead of hard-coding it —
    // the SvgDrawingContext serialises brushes as rgb()/rgba(), not hex.
    public static TokenCss(name: string): string | undefined
    {
        const brush = Application.current?.Resources.Resolve(name);
        return brush instanceof SolidColorBrush ? brush.Color.ToCss() : undefined;
    }

    private static EnsureThemesRegistered(): void
    {
        // A prior test's ThemeManager._resetForTesting() drops the
        // module-load registrations, so re-add idempotently.
        if (!ThemeManager.RegisteredThemes.some(t => t.name === ControlHarness.PragmaticThemeName))
        {
            ThemeManager.RegisterTheme(Pragmatic.instance);
        }
        if (!ThemeManager.RegisteredThemes.some(t => t.name === ControlHarness.MaterialThemeName))
        {
            ThemeManager.RegisterTheme(Material.instance);
        }
    }
}
