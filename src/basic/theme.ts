import { Application, Color } from '../runtime/index.js';
import { SolidColorBrush } from '../visual-engine/index.js';

// Theme-agnostic semantic-token proxy.
//
// Background: this file used to hold a hard-coded MUI palette read by
// imperative refresh closures in controls (Slider thumb tinting,
// ScrollBar thumb hover, ComboBox border focus, Menu item hover, …).
// Templates now read theme tokens via `@Primary` / `@Surface` / etc.
// (DynamicResource bindings), but the imperative paths haven't been
// migrated yet — each touches a Visual property directly and needs a
// Brush right now, not a Binding.
//
// To keep both worlds running we expose `Theme.<name>` as getters that
// resolve a shared semantic key (`@Ink`, `@AccentInk`, …) from
// Application.Resources each time they're read. Every registered
// theme's scheme files (`light.mu`/`dark.mu`) define these keys as a
// literal copy of that theme's own backing colour, so `theme.ts` never
// hardcodes a Material-specific — or any other theme-specific — token
// name; it just resolves the same key every theme provides. Theme swap
// (light → dark) reflects in the next imperative refresh, which is
// good enough until those paths migrate to template triggers or
// per-control DynamicResource bindings.
//
// Fallback: when no Application or no matching palette has been
// registered (test harness, unmounted control), each getter returns a
// neutral grey so the control draws *something* instead of crashing
// on `.Background = undefined`. A theme's own default hex values would
// have been a defensible fallback too — but neutrals make a
// missing-theme bug visually obvious, which is what we want from a
// fallback.

// Single neutral brush returned when a token can't be resolved. Cached
// so consumers don't pay per-access allocations during fallback.
const NEUTRAL = new SolidColorBrush(Color.FromHex('#808080'));

function brush(key: string): SolidColorBrush
{
    const app = Application.current;
    if (app === null) return NEUTRAL;
    const v = app.Resources.Resolve(key);
    if (v instanceof SolidColorBrush) return v;
    return NEUTRAL;
}

// Default font family — owned by the theme module so the framework's
// typography defaults live in one place. M3 baseline is Roboto but
// the value here is the OS-system stack so the framework doesn't ship
// a web-font dependency. Material's `@FontFamily` token starts at the
// same value; a host overriding it in Application.Resources reaches
// every TextBlock via `Theme.fontFamily` below.
export const DEFAULT_FONT_FAMILY = 'system-ui, sans-serif';

function fontFamilyToken(): string
{
    const app = Application.current;
    if (app === null) return DEFAULT_FONT_FAMILY;
    const v = app.Resources.Resolve('FontFamily');
    return typeof v === 'string' && v.length > 0 ? v : DEFAULT_FONT_FAMILY;
}

// Compile-time string-typed mapping from the historical Theme.<name>
// keys to Material 3 token names. Adding a new entry: pick the
// closest M3 token (see light.mu / dark.mu for the catalogue) rather
// than adding a new token — the imperative paths need to converge on
// the same tokens the templates use.
export const Theme = {
    // ── Surfaces ────────────────────────────────────────────────────
    get paper()            { return brush('Surface'); },
    get hairline()         { return brush('OutlineVariant'); },
    get nav()              { return brush('SurfaceContainerLow'); },
    get navHover()         { return brush('SurfaceContainer'); },

    // ── Ink (foreground colours on surfaces) ────────────────────────
    // Resolves the shared `@Ink` semantic key — every registered
    // theme's scheme files define it as a literal copy of that theme's
    // own body-ink token (Material's `@OnSurface`, Pragmatic's
    // `@Fg1`), so no per-theme fallback chain is needed here.
    get ink()              { return brush('Ink'); },
    get hint()             { return brush('OnSurfaceVariant'); },
    get placeholder()      { return brush('OnSurfaceVariant'); },
    get fieldText()        { return brush('OnSurface'); },

    // ── Primary tier ────────────────────────────────────────────────
    get primary()          { return brush('AccentInk'); },
    get primaryHover()     { return brush('PrimaryHover'); },
    get primaryPress()     { return brush('PrimaryPress'); },
    get primaryInk()       { return brush('OnPrimary'); },

    // ── Form-field outlined chrome ──────────────────────────────────
    get fieldBg()          { return brush('Surface'); },
    get fieldBorder()      { return brush('Outline'); },
    get fieldBorderOpen()  { return brush('Primary'); },

    // ── Popup / dropdown ────────────────────────────────────────────
    get popupBg()          { return brush('SurfaceContainerHigh'); },
    get popupBorder()      { return brush('OutlineVariant'); },
    get itemHoverBg()      { return brush('SurfaceContainerHigh'); },
    get itemSelectedBg()   { return brush('SecondaryContainer'); },

    // ── Scrollbar ───────────────────────────────────────────────────
    get scrollTrack()      { return brush('SurfaceContainerLow'); },
    get scrollThumb()      { return brush('OutlineVariant'); },
    get scrollThumbHover() { return brush('Outline'); },
    get scrollThumbDrag()  { return brush('OnSurfaceVariant'); },

    // ── Validation / status ─────────────────────────────────────────
    // M3 semantic error colour. Used by ValidationErrorAdorner's
    // default fallback when no explicit Pen / Brush has been set.
    get error()            { return brush('Error'); },

    // ── Scrim (semi-transparent dim over content) ───────────────────
    // Material's scrim is Scrim-tinted black at ~40% — preallocated
    // here since the token dictionaries register it as fully opaque
    // black, which would defeat the dim effect.
    scrim: new SolidColorBrush(new Color(0, 0, 0, 102)),

    // ── Typography ──────────────────────────────────────────────────
    // Active font-family stack. Resolves the Material `@FontFamily`
    // token if the palette is registered; falls back to the OS-system
    // default constant otherwise. TextBlock keeps `DEFAULT_FONT_FAMILY`
    // as the DP-registration default (a constant must be known at
    // static init) and consults `Theme.fontFamily` at render time only
    // when consumers want the active theme value explicitly.
    get fontFamily()       { return fontFamilyToken(); },
} as const;
