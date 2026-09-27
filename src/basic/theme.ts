import { Application, Color } from '../runtime/index.js';
import { SolidColorBrush } from '../visual-engine/index.js';

// Theme-agnostic semantic-brush proxy for imperative paths.
//
// Templates read theme colours via DynamicResource bindings
// (`@Primary`, `@Surface`, …). A few imperative, non-templated paths
// can't: they set a Visual property directly and need a concrete Brush
// at the moment they run, not a Binding (TextBlock/RichTextBlock ink,
// RichTextBox caret and link colour). Those are the only consumers, so
// this proxy exposes exactly the two brushes they need — `ink` and
// `primary` — as getters that resolve a shared, theme-agnostic
// semantic key (`@Ink`, `@AccentInk`) from Application.Resources on
// each read. Every registered theme's scheme files (`light.mu` /
// `dark.mu`) define those keys as a literal copy of that theme's own
// backing colour (Material's `@OnSurface` / `@Primary`, Pragmatic's
// `@Fg1` / `@ControlAccent`), so this file never hardcodes a
// theme-specific token name; it resolves the same key every theme
// provides, and a theme swap reflects on the next read.
//
// Fallback: when no Application or no matching palette is registered
// (test harness, unmounted control), each getter returns a neutral
// grey so the control draws *something* instead of crashing on
// `.Background = undefined`. Neutrals make a missing-theme bug
// visually obvious, which is what we want from a fallback.

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
// typography defaults live in one place. M3 baseline is Roboto but the
// value here is the OS-system stack so the framework doesn't ship a
// web-font dependency. Consumed as the static DP-registration default
// by text-block.ts / rich-text-block.ts (a DP default must be known at
// static init, so it's a plain constant, not a resolved token).
export const DEFAULT_FONT_FAMILY = 'system-ui, sans-serif';

export const Theme = {
    // Body-ink foreground. Resolves the shared `@Ink` semantic key.
    get ink()     { return brush('Ink'); },

    // Accent/primary brush. Resolves the shared `@AccentInk` semantic
    // key.
    get primary() { return brush('AccentInk'); },
} as const;
