# Pragmatic theme — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `Pragmatic` theme in Mural — token catalog, Light/Dark schemes, offline fonts, a merged typography dictionary, and a shadow effect — projected from the design system and guarded by a conformance test, without changing the app default (Material stays default; nothing breaks).

**Architecture:** A new `src/resources/pragmatic/` bundle mirrors the shape of `src/resources/material/`: `pragmatic.mu` declares the theme + token catalog, `light.mu`/`dark.mu` are the schemes, `typography.mu` is the keyed type-style dictionary (listed in the theme's `dictionaries:`, fixing the bug where Material never merges its Typography), and `fonts/` holds bundled woff2 faces registered via a `fonts { }` block. Token values are a faithful projection of the design system's `tokens.json`, committed as a snapshot under `dev-kit/design/design-systems/pragmatic/`; a conformance test parses the schemes and asserts they equal the snapshot, so drift fails the build.

**Tech Stack:** TypeScript, Mural `.mu` markup (compiled by `build:templates`), `node:test` via `tsx`, `DropShadowEffect` (`src/visual-engine/drawing/`), `FontManager` (`src/visual-engine/text/`).

**Spec:** `Mural/docs/superpowers/specs/2026-09-27-pragmatic-theme-design.md`

## Global Constraints

- **Source of truth:** all token values come from the committed snapshot `dev-kit/design/design-systems/pragmatic/tokens.json` (imported from artifact `https://claude.ai/artifact/XkyJGVRjDhwq8rKh52Pz7R`). Never hand-invent a value; if a value must change, change the snapshot.
- **Brace style: Allman** — every block's opening brace on its own line (TS and `.mu`). Object literals, arrow bodies and one-line blocks stay inline. No formatter enforces this; write it by hand.
- **OOP, PascalCase** — no module-level free functions or mutable module state; behavior lives in class methods (static where stateless). Public methods and interfaces are PascalCase.
- **No inline string literals** — user-facing or reused literals become `private static readonly` PascalCase constants on the class. Structural tokens (`'.'`, type-guard strings) may stay inline.
- **Tests** live in a `tests/` subfolder next to the source, run with `node:test` (`import { test, describe } from 'node:test'; import assert from 'node:assert/strict';`).
- **Do not change the app default this phase.** Material remains the registered default theme (first-import-wins). Pragmatic is importable and activatable, verified by tests only.
- **Radii cap at 14px**; the catalog carries no radius above `RadiusXl` (14) except `RadiusPill` (999).

## Review Focus

Inputs/failure modes the spec implies that no single task's happy path exercises — each is pinned to a test in the owning task:

- **Design-system token with no Mural catalog projection** (e.g. designer adds a token): conformance test (Task 6) must FAIL, not silently pass. → covered by a negative case in Task 6.
- **Scheme value drift from the snapshot** (a hex edited by hand): conformance test must fail on the exact token. → Task 6.
- **Alias resolution** (`{brand-green}`, `{neutral-500}`) and **rgba()** values resolved to the correct per-theme literal. → Task 6 resolver tests.
- **Typography style resolves after activation** (the Material bug: `@Body` currently resolves to nothing because Typography is never merged). → Task 5 asserts a keyed style resolves once Pragmatic is active.
- **Missing dark value inherits the light value** (tokens with only a `light` entry, e.g. `BrandGreen`): the Dark scheme must carry the light value, not undefined. → Task 4/6.

---

## File Structure

- `dev-kit/design/design-systems/pragmatic/tokens.json` — committed snapshot (source of truth for values).
- `Mural/src/resources/pragmatic/pragmatic.mu` — `theme Pragmatic { … tokens { … } }` (catalog + dictionaries + schemes list).
- `Mural/src/resources/pragmatic/light.mu` — `scheme PragmaticLight against Pragmatic`.
- `Mural/src/resources/pragmatic/dark.mu` — `scheme PragmaticDark against Pragmatic`.
- `Mural/src/resources/pragmatic/typography.mu` — `resources PragmaticTypography` (14 keyed TextBlock styles).
- `Mural/src/resources/pragmatic/fonts/` — woff2 faces + OFL licences.
- `Mural/src/resources/pragmatic/pragmatic.ts` — re-export shim (Pragmatic, PragmaticLight, PragmaticDark, PragmaticTypography).
- `Mural/src/resources/pragmatic/index.ts` — barrel.
- `Mural/src/resources/pragmatic/tests/conformance.test.ts` — snapshot ↔ scheme parity.
- `Mural/src/resources/pragmatic/tests/theme.test.ts` — theme/scheme validation + activation.
- `Mural/src/resources/pragmatic/tests/typography.test.ts` — keyed style resolves after activation.
- `Mural/src/resources/pragmatic/tests/fonts.test.ts` — faces register.
- `Mural/src/visual-engine/drawing/pragmatic-shadow-effect.ts` — `PragmaticShadowEffect` (Sm/Md/Lg).
- `Mural/src/visual-engine/drawing/tests/pragmatic-shadow-effect.test.ts`.

---

## Task 1: Commit the tokens.json snapshot + a snapshot reader

**Files:**
- Create: `dev-kit/design/design-systems/pragmatic/tokens.json`
- Create: `Mural/src/resources/pragmatic/token-snapshot.ts`
- Test: `Mural/src/resources/pragmatic/tests/token-snapshot.test.ts`

**Interfaces:**
- Produces: `class TokenSnapshot { constructor(json: unknown); Resolve(name: string, theme: 'light' | 'dark'): string; ColorNames(): string[]; }` — resolves aliases (`{other}`) recursively and selects the theme value, falling back to `light` when a theme value is absent.

- [ ] **Step 1: Copy the snapshot.** Copy the current design-system `tokens.json` (27,491-byte version, `lastChange` note "Contrast clean-up: fg-3 darkened…") to `dev-kit/design/design-systems/pragmatic/tokens.json` verbatim. Confirm it parses: `node -e "JSON.parse(require('fs').readFileSync('dev-kit/design/design-systems/pragmatic/tokens.json'))"`.

- [ ] **Step 2: Write the failing test** at `Mural/src/resources/pragmatic/tests/token-snapshot.test.ts`:

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TokenSnapshot } from '../token-snapshot.js';

function load(): TokenSnapshot
{
    const path = fileURLToPath(new URL('../../../../../dev-kit/design/design-systems/pragmatic/tokens.json', import.meta.url));
    return new TokenSnapshot(JSON.parse(readFileSync(path, 'utf8')));
}

describe('TokenSnapshot', () =>
{
    test('resolves a direct hex', () =>
    {
        assert.equal(load().Resolve('brand-green', 'light'), '#2EA862');
    });

    test('resolves an alias chain', () =>
    {
        // bg-0 → {neutral-50} → #FAFAF9 (light); → {neutral-1000} → #0A0A0B (dark)
        assert.equal(load().Resolve('bg-0', 'light'), '#FAFAF9');
        assert.equal(load().Resolve('bg-0', 'dark'), '#0A0A0B');
    });

    test('falls back to light when a dark value is absent', () =>
    {
        assert.equal(load().Resolve('brand-green', 'dark'), '#2EA862');
    });

    test('keeps rgba() verbatim', () =>
    {
        assert.equal(load().Resolve('scrim', 'light'), 'rgba(10, 10, 11, 0.40)');
    });
});
```

- [ ] **Step 3: Run it, expect failure.** `cd Mural && npx tsx --conditions=development --test --test-force-exit src/resources/pragmatic/tests/token-snapshot.test.ts` → FAIL (`TokenSnapshot` not found).

- [ ] **Step 4: Implement** `Mural/src/resources/pragmatic/token-snapshot.ts`:

```ts
// Reads the committed design-system tokens.json snapshot and resolves
// a colour token to its literal value for a given theme, following
// {alias} references and falling back to the light value when a theme
// value is missing (matching the design system's own resolution rule).
interface ColorToken
{
    name:  string;
    value: { light?: string; dark?: string };
}

export class TokenSnapshot
{
    private static readonly AliasPattern = /^\{([^}]+)\}$/;

    private readonly colors: Map<string, ColorToken['value']>;

    constructor(json: unknown)
    {
        const root   = json as { color?: { tokens?: ColorToken[] } };
        const tokens = root.color?.tokens ?? [];
        this.colors  = new Map();
        for (const t of tokens)
        {
            this.colors.set(t.name, t.value);
        }
    }

    public ColorNames(): string[]
    {
        return [...this.colors.keys()];
    }

    public Resolve(name: string, theme: 'light' | 'dark'): string
    {
        const value = this.colors.get(name);
        if (value === undefined)
        {
            throw new Error(`Unknown colour token '${name}'.`);
        }
        const raw = value[theme] ?? value.light;
        if (raw === undefined)
        {
            throw new Error(`Token '${name}' has no value for '${theme}' or 'light'.`);
        }
        const alias = TokenSnapshot.AliasPattern.exec(raw.trim());
        if (alias !== null)
        {
            return this.Resolve(alias[1], theme);
        }
        return raw;
    }
}
```

- [ ] **Step 5: Run it, expect pass.** Same command → PASS.

- [ ] **Step 6: Commit.**

```bash
git add dev-kit/design/design-systems/pragmatic/tokens.json Mural/src/resources/pragmatic/token-snapshot.ts Mural/src/resources/pragmatic/tests/token-snapshot.test.ts
git commit -m "feat(pragmatic): commit tokens.json snapshot + TokenSnapshot reader"
```

---

## Task 2: PragmaticShadowEffect

**Files:**
- Create: `Mural/src/visual-engine/drawing/pragmatic-shadow-effect.ts`
- Modify: `Mural/src/visual-engine/drawing/index.ts` (export it)
- Test: `Mural/src/visual-engine/drawing/tests/pragmatic-shadow-effect.test.ts`

**Interfaces:**
- Produces: `class PragmaticShadowEffect extends Effect { constructor(level?: 'sm' | 'md' | 'lg'); Level: 'sm' | 'md' | 'lg'; toCssFilter(): string; }` — emits the design system's two-layer shadow as stacked `drop-shadow()` functions, with per-theme alpha chosen from a `dark` flag defaulting to light.

**Design note:** The design system shadows are box-shadows; Mural composes shadows as concatenated `drop-shadow()` (see `MaterialElevationEffect`). We emit the dominant + ambient layers from the tokens.json values. Alpha differs light vs dark; since an `Effect` is theme-agnostic, the scheme supplies two instances (`ShadowMd` light-tuned in `light.mu`, dark-tuned in `dark.mu`) via a `Dark` constructor flag.

- [ ] **Step 1: Write the failing test:**

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PragmaticShadowEffect } from '../pragmatic-shadow-effect.js';

describe('PragmaticShadowEffect', () =>
{
    test('sm (light) is one soft drop-shadow at 4% black', () =>
    {
        const f = new PragmaticShadowEffect('sm').toCssFilter();
        assert.equal(f, 'drop-shadow(0.0px 1.0px 2.0px rgba(0, 0, 0, 0.040))');
    });

    test('md (light) stacks a 12px ambient over a 2px key shadow', () =>
    {
        const f = new PragmaticShadowEffect('md').toCssFilter();
        assert.equal(f, 'drop-shadow(0.0px 4.0px 12.0px rgba(0, 0, 0, 0.060)) drop-shadow(0.0px 1.0px 2.0px rgba(0, 0, 0, 0.040))');
    });

    test('dark md uses the heavier dark alphas', () =>
    {
        const f = new PragmaticShadowEffect('md', true).toCssFilter();
        assert.equal(f, 'drop-shadow(0.0px 4.0px 12.0px rgba(0, 0, 0, 0.500)) drop-shadow(0.0px 1.0px 2.0px rgba(0, 0, 0, 0.400))');
    });
});
```

- [ ] **Step 2: Run it, expect failure.** `cd Mural && npx tsx --conditions=development --test --test-force-exit src/visual-engine/drawing/tests/pragmatic-shadow-effect.test.ts` → FAIL.

- [ ] **Step 3: Implement** `pragmatic-shadow-effect.ts`. Layer specs (y, blur, lightAlpha, darkAlpha) copied from tokens.json `shadow`:

```ts
import { Effect } from './effect.js';

// The design system's three shadows (tokens.json `shadow`), expressed as
// Mural Effects. Each is one or two stacked drop-shadow() layers; alpha
// differs by theme, so the scheme installs a Dark-tuned instance in
// dark.mu and a light one in light.mu.
type ShadowLevel = 'sm' | 'md' | 'lg';

interface ShadowLayer
{
    Y:          number;
    Blur:       number;
    LightAlpha: number;
    DarkAlpha:  number;
}

export class PragmaticShadowEffect extends Effect
{
    // Ordered outermost (ambient) first, to match CSS box-shadow stacking.
    private static readonly Layers: Readonly<Record<ShadowLevel, ReadonlyArray<ShadowLayer>>> =
    {
        sm: [ { Y: 1,  Blur: 2,  LightAlpha: 0.04, DarkAlpha: 0.40 } ],
        md: [ { Y: 4,  Blur: 12, LightAlpha: 0.06, DarkAlpha: 0.50 },
              { Y: 1,  Blur: 2,  LightAlpha: 0.04, DarkAlpha: 0.40 } ],
        lg: [ { Y: 12, Blur: 32, LightAlpha: 0.10, DarkAlpha: 0.60 },
              { Y: 2,  Blur: 6,  LightAlpha: 0.05, DarkAlpha: 0.40 } ],
    };

    public Level: ShadowLevel;
    public Dark:  boolean;

    constructor(level: ShadowLevel = 'md', dark: boolean = false)
    {
        super();
        this.Level = level;
        this.Dark  = dark;
    }

    public override toCssFilter(): string
    {
        const layers = PragmaticShadowEffect.Layers[this.Level];
        return layers
            .map(l =>
            {
                const a = (this.Dark ? l.DarkAlpha : l.LightAlpha).toFixed(3);
                return `drop-shadow(0.0px ${l.Y.toFixed(1)}px ${l.Blur.toFixed(1)}px rgba(0, 0, 0, ${a}))`;
            })
            .join(' ');
    }
}
```

- [ ] **Step 4: Export** — add to `src/visual-engine/drawing/index.ts` next to the `DropShadowEffect` export:

```ts
export { PragmaticShadowEffect } from './pragmatic-shadow-effect.js';
```

- [ ] **Step 5: Run it, expect pass.** Same command → PASS.

- [ ] **Step 6: Commit.**

```bash
git add Mural/src/visual-engine/drawing/pragmatic-shadow-effect.ts Mural/src/visual-engine/drawing/index.ts Mural/src/visual-engine/drawing/tests/pragmatic-shadow-effect.test.ts
git commit -m "feat(pragmatic): PragmaticShadowEffect (sm/md/lg, light+dark alphas)"
```

---

## Task 3: Theme catalog + schemes (pragmatic.mu, light.mu, dark.mu)

Authoring task. The conformance test (Task 6) is its gate; a quick compile + registration check runs here. Values are the resolved snapshot values (below). PascalCase names; raw `neutral-*` are NOT catalog tokens (their values are inlined into the semantic tokens that alias them).

**Files:**
- Create: `Mural/src/resources/pragmatic/pragmatic.mu`
- Create: `Mural/src/resources/pragmatic/light.mu`
- Create: `Mural/src/resources/pragmatic/dark.mu`

**Interfaces:**
- Produces: compiled `Pragmatic`, `PragmaticLight`, `PragmaticDark` classes (via `build:templates`) under `build/resources/pragmatic/`.
- Consumes: `PragmaticShadowEffect` (Task 2) for the shadow tokens.

- [ ] **Step 1: Write `pragmatic.mu`.** Theme block modeled on `material.mu`. Declares the catalog (types below) and lists schemes + dictionaries (Typography added in Task 5; start with `[MuralBasic, MuralFramework]` and extend in Task 5):

```
theme Pragmatic
{
    import PragmaticLight from "./light.mu.js"
    import PragmaticDark from "./dark.mu.js"
    import MuralBasic from "../basic.resources.mu.js"
    import MuralFramework from "../framework.resources.mu.js"
    schemes: [PragmaticLight, PragmaticDark]
    defaultScheme: PragmaticLight
    dictionaries: [MuralBasic, MuralFramework]

    tokens
    {
        // ── Brand ──────────────────────────────────────────────
        @BrandGreen : Brush "Signal Green. Data-viz + logomark only; use ActionPrimary for CTAs."
        @BrandGreenHover : Brush
        @BrandGreenPress : Brush
        @BrandGreenSoft : Brush "Tinted brand background: badges, focus halo, highlighted nodes."
        @BrandGreenInk : Brush "Brand green as text."
        @ActionPrimary : Brush "Primary button fill (accessible: white text passes 4.5:1)."
        @ActionPrimaryHover : Brush
        @ActionPrimaryPress : Brush
        @ControlAccent : Brush "Accent for focus rings and selected controls; theme-adaptive."
        // ── Accents ────────────────────────────────────────────
        @AccentCyan : Brush
        @AccentCyanSoft : Brush
        @AccentCyanInk : Brush
        @AccentPlum : Brush
        @AccentPlumSoft : Brush
        @AccentPlumInk : Brush
        // ── State ──────────────────────────────────────────────
        @StateSuccess : Brush
        @StateSuccessSoft : Brush
        @StateSuccessInk : Brush
        @StateWarning : Brush
        @StateWarningSoft : Brush
        @StateWarningInk : Brush
        @StateDanger : Brush
        @StateDangerSoft : Brush
        @StateDangerInk : Brush
        @StateInfo : Brush
        @StateInfoSoft : Brush
        // ── Surfaces ───────────────────────────────────────────
        @Bg0 : Brush "Page surface."
        @Bg1 : Brush "Elevated surface: cards, inputs, menus."
        @Bg2 : Brush "Hovered surface."
        @Bg3 : Brush "Pressed/selected surface."
        @BgInverse : Brush
        // ── Text / icon ────────────────────────────────────────
        @Fg0 : Brush "Primary text."
        @Fg1 : Brush "Body text."
        @Fg2 : Brush "Secondary text + default icon."
        @Fg3 : Brush "Tertiary text, placeholders."
        @FgDisabled : Brush
        @FgOnAccent : Brush
        @FgInverse : Brush
        // ── Lines ──────────────────────────────────────────────
        @Border : Brush "Default 1px hairline."
        @BorderStrong : Brush "Input borders, secondary buttons."
        @BorderFocus : Brush "2px focus ring colour."
        // ── Selection / canvas ─────────────────────────────────
        @SurfaceSelected : Brush "Selected row fill."
        @CanvasBg : Brush "Diagram drawing-paper background."
        @CanvasGridDot : Brush "Canvas grid dots."
        @SelectionMarqueeFill : Brush
        @SelectionMarqueeStroke : Brush
        @TextSelectionBg : Brush "Selected-text highlight."
        @TextSelectionFg : Brush
        @Scrim : Brush "Modal overlay."
        // ── Spacing (dp) ───────────────────────────────────────
        @Space1 : number   @Space2 : number   @Space3 : number   @Space4 : number   @Space5 : number
        @Space6 : number   @Space7 : number   @Space8 : number   @Space9 : number   @Space10 : number
        // ── Radius (dp) ────────────────────────────────────────
        @RadiusNone : number   @RadiusXs : number   @RadiusSm : number   @RadiusMd : number
        @RadiusLg : number   @RadiusXl : number   @RadiusPill : CornerRadius
        // ── Sizing (dp) ────────────────────────────────────────
        @ControlHDense : number   @ControlHCompact : number   @ControlHDefault : number   @ControlHTouch : number
        @RowHDense : number   @RowHCompact : number   @RowHDefault : number   @RowHTouch : number
        // ── Density step (dp offset) ───────────────────────────
        @DensityTouch : number   @DensityComfortable : number   @DensityCompact : number   @DensityDense : number
        // ── Motion / opacity / focus ───────────────────────────
        @DurationFast : number   @DurationMedium : number   @DurationSlow : number
        @OpacityDisabled : number
        @FocusRingWidth : number   @FocusRingOffset : number
        @EasingStandard : EasingFunction   @EasingInout : EasingFunction
        // ── Fonts ──────────────────────────────────────────────
        @FontSans : string   @FontMono : string   @FontSerif : string
        @WeightRegular : FontWeight   @WeightMedium : FontWeight   @WeightSemibold : FontWeight   @WeightBold : FontWeight
        // ── Type-scale atoms (per role: Font/Weight/Size/LineHeight/Tracking) ──
        // Display1/Display2/H1/H2/H3/H4/Body/BodySm/BodySerif/UiLabel/UiLabelSm/UiCaption/Code/Label
        // (declared as in material.mu — one @<Role>Font/Weight/Size/LineHeight/Tracking each; see Step 4)
        // ── Shadows ────────────────────────────────────────────
        @ShadowSm : Effect   @ShadowMd : Effect   @ShadowLg : Effect
    }
}
```

- [ ] **Step 2: Write `light.mu`** — `scheme PragmaticLight against Pragmatic { … }` with these resolved values (colours):

```
@BrandGreen = #2EA862        @BrandGreenHover = #258A50    @BrandGreenPress = #1B6B3D
@BrandGreenSoft = #E2F3E9    @BrandGreenInk = #1B6B3D
@ActionPrimary = #22824D     @ActionPrimaryHover = #1B6B3D @ActionPrimaryPress = #155431
@ControlAccent = #22824D
@AccentCyan = #3AA6B9        @AccentCyanSoft = #E2F1F4     @AccentCyanInk = #1D6B79
@AccentPlum = #7C6BAD        @AccentPlumSoft = #EEEAF5     @AccentPlumInk = #5A4A8E
@StateSuccess = #4A8E3A      @StateSuccessSoft = #E8F2E2   @StateSuccessInk = #2F6B22
@StateWarning = #C68A0E      @StateWarningSoft = #FBF1D8   @StateWarningInk = #8B6308
@StateDanger = #C24532       @StateDangerSoft = #FBE4DF    @StateDangerInk = #A63526
@StateInfo = #3AA6B9         @StateInfoSoft = #E2F1F4
@Bg0 = #FAFAF9   @Bg1 = #FFFFFF   @Bg2 = #F4F4F2   @Bg3 = #E9E8E4   @BgInverse = #0A0A0B
@Fg0 = #0A0A0B   @Fg1 = #22211E   @Fg2 = #5F5C56   @Fg3 = #726F68
@FgDisabled = #B5B3AC   @FgOnAccent = #FFFFFF   @FgInverse = #FAFAF9
@Border = #E9E8E4   @BorderStrong = #D6D5D0   @BorderFocus = #22824D
@SurfaceSelected = #E2F3E9   @CanvasBg = #F4F4F1   @CanvasGridDot = #D6D5D0
@SelectionMarqueeFill = rgba(46, 168, 98, 0.08)   @SelectionMarqueeStroke = #258A50
@TextSelectionBg = #C3E6D1   @TextSelectionFg = #0A0A0B   @Scrim = rgba(10, 10, 11, 0.40)
```
Non-colour values (identical in both schemes):
```
@Space1=4 @Space2=8 @Space3=12 @Space4=16 @Space5=24 @Space6=32 @Space7=48 @Space8=64 @Space9=96 @Space10=128
@RadiusNone=0 @RadiusXs=2 @RadiusSm=4 @RadiusMd=6 @RadiusLg=10 @RadiusXl=14 @RadiusPill=CornerRadius.Full
@ControlHDense=28 @ControlHCompact=32 @ControlHDefault=36 @ControlHTouch=44
@RowHDense=24 @RowHCompact=28 @RowHDefault=32 @RowHTouch=40
@DensityTouch=8 @DensityComfortable=0 @DensityCompact=-4 @DensityDense=-8
@DurationFast=120 @DurationMedium=200 @DurationSlow=320
@OpacityDisabled=0.5 @FocusRingWidth=2 @FocusRingOffset=2
@EasingStandard = CubicBezierEasing [X1=0.2, Y1=0, X2=0, Y2=1]
@EasingInout = CubicBezierEasing [X1=0.4, Y1=0, X2=0.2, Y2=1]
@FontSans = "\"Inter Tight\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", Helvetica, Arial, sans-serif"
@FontMono = "\"JetBrains Mono\", ui-monospace, \"SF Mono\", Menlo, Consolas, monospace"
@FontSerif = "\"Source Serif 4\", \"Iowan Old Style\", \"Charter\", Georgia, serif"
@WeightRegular = FontWeight.Normal @WeightMedium = FontWeight.Medium @WeightSemibold = FontWeight.SemiBold @WeightBold = FontWeight.Bold
@ShadowSm = PragmaticShadowEffect [Level = sm]
@ShadowMd = PragmaticShadowEffect [Level = md]
@ShadowLg = PragmaticShadowEffect [Level = lg]
```
Type-scale atoms (from tokens.json type styles; Tracking in em, Size/LineHeight in px — where lineHeight is a ratio, multiply by size and round): `Display1` Font=@FontSans Weight=SemiBold Size=80 LineHeight=92 Tracking=-0.02; `Display2` 60/69/-0.02; `H1` 44/51/-0.02; `H2` 32/42/-0.01; `H3` 24/31/-0.01; `H4` 17/22/0; `Body` 15/23/0; `BodySm` 13/20/0; `BodySerif` Font=@FontSerif 17/29/0; `UiLabel` 14/20/0 Weight=Medium; `UiLabelSm` 13/18/0; `UiCaption` 12/16/0; `Code` Font=@FontMono 13/20/0; `Label` Font=@FontMono 12/16/0.1 Weight=Medium. (Confirm `CubicBezierEasing` / `FontWeight.SemiBold` names against `src/visual-engine` before writing; adjust to the actual exported names.)

- [ ] **Step 3: Write `dark.mu`** — `scheme PragmaticDark against Pragmatic { … }`. Colours use the Dark column; `@ShadowSm/Md/Lg = PragmaticShadowEffect [Level = sm, Dark = true]` etc. Dark colour values:

```
@BrandGreen = #2EA862  @BrandGreenHover = #258A50  @BrandGreenPress = #1B6B3D
@BrandGreenSoft = #0F2A1A  @BrandGreenInk = #2EA862
@ActionPrimary = #22824D  @ActionPrimaryHover = #1B6B3D  @ActionPrimaryPress = #155431
@ControlAccent = #2EA862
@AccentCyan = #3AA6B9  @AccentCyanSoft = #143036  @AccentCyanInk = #6CC7D8
@AccentPlum = #7C6BAD  @AccentPlumSoft = #1F1A2E  @AccentPlumInk = #AC9EDB
@StateSuccess = #4A8E3A  @StateSuccessSoft = #1B2E16  @StateSuccessInk = #7CC46B
@StateWarning = #C68A0E  @StateWarningSoft = #3A2C0A  @StateWarningInk = #E3B04B
@StateDanger = #C24532  @StateDangerSoft = #3A1B14  @StateDangerInk = #F28B78
@StateInfo = #3AA6B9  @StateInfoSoft = #143036
@Bg0 = #0A0A0B  @Bg1 = #141312  @Bg2 = #22211E  @Bg3 = #3D3B36  @BgInverse = #FAFAF9
@Fg0 = #F5F5F2  @Fg1 = #E8E7E2  @Fg2 = #B5B3AC  @Fg3 = #8F8C85
@FgDisabled = #5F5C56  @FgOnAccent = #FFFFFF  @FgInverse = #0A0A0B
@Border = #2A2925  @BorderStrong = #3D3B36  @BorderFocus = #2EA862
@SurfaceSelected = #0F2A1A  @CanvasBg = #111112  @CanvasGridDot = #2E2D29
@SelectionMarqueeFill = rgba(46, 168, 98, 0.14)  @SelectionMarqueeStroke = #2EA862
@TextSelectionBg = #1E5A37  @TextSelectionFg = #F5F5F2  @Scrim = rgba(0, 0, 0, 0.60)
```
(Non-colour values identical to light.mu — copy them.)

- [ ] **Step 4: Build.** `cd Mural && npm run build:templates`. Expect `build/resources/pragmatic/{pragmatic,light,dark}.mu.js` emitted with no compiler error. Fix any type-name mismatches (`CubicBezierEasing`, `FontWeight.SemiBold`, `CornerRadius.Full`, `Effect` token type) surfaced by the compiler.

- [ ] **Step 5: Commit.**

```bash
git add Mural/src/resources/pragmatic/pragmatic.mu Mural/src/resources/pragmatic/light.mu Mural/src/resources/pragmatic/dark.mu
git commit -m "feat(pragmatic): theme catalog + Light/Dark schemes projected from tokens.json"
```

---

## Task 4: Re-export shim + theme validation test

**Files:**
- Create: `Mural/src/resources/pragmatic/pragmatic.ts`
- Create: `Mural/src/resources/pragmatic/index.ts`
- Test: `Mural/src/resources/pragmatic/tests/theme.test.ts`

**Interfaces:**
- Consumes: compiled `Pragmatic`, `PragmaticLight`, `PragmaticDark`.
- Produces: `pragmatic.ts` re-exports the three classes; `index.ts` barrels `./pragmatic.js`.

- [ ] **Step 1: Write `pragmatic.ts`** (mirrors `material.ts` re-export section; NO default-theme registration beyond what the compiled `.mu.js` does — Material imported first stays default):

```ts
// Pragmatic theme bundle — re-export shim. Theme + scheme classes are
// emitted by the .mu compiler; importing the compiled pragmatic.mu.js
// enrols the theme via ThemeManager.RegisterTheme (Material, imported
// first, remains the default this phase).
export { Pragmatic }        from '../../../build/resources/pragmatic/pragmatic.mu.js';
export { PragmaticLight }   from '../../../build/resources/pragmatic/light.mu.js';
export { PragmaticDark }    from '../../../build/resources/pragmatic/dark.mu.js';
```

- [ ] **Step 2: Write `index.ts`:**

```ts
export * from './pragmatic.js';
```

- [ ] **Step 3: Write the test** at `tests/theme.test.ts` (pattern from `src/runtime/tests/theme.test.ts`):

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application, ThemeManager } from '../../../runtime/index.js';
import { Pragmatic, PragmaticLight, PragmaticDark } from '../pragmatic.js';

function reset(): void
{
    ThemeManager._resetForTesting();
    Application.current = undefined;
}

describe('Pragmatic theme', () =>
{
    test('declares both schemes against itself', () =>
    {
        assert.equal(Pragmatic.instance.name, 'Pragmatic');
        assert.ok(Pragmatic.instance.schemes.get('PragmaticLight'));
        assert.ok(Pragmatic.instance.schemes.get('PragmaticDark'));
        assert.equal(Pragmatic.instance.defaultScheme, 'PragmaticLight');
        reset();
    });

    test('every catalog token is supplied by both schemes', () =>
    {
        const app = new Application();
        Application.current = app;
        for (const name of Pragmatic.instance.catalog.keys())
        {
            assert.ok(PragmaticLight.instance.tokens.has(name), `light missing ${name}`);
            assert.ok(PragmaticDark.instance.tokens.has(name),  `dark missing ${name}`);
        }
        reset();
    });

    test('activates without throwing and exposes the active scheme', () =>
    {
        const app = new Application();
        Application.current = app;
        Pragmatic.Activate(PragmaticDark);
        assert.equal(ThemeManager.ActiveScheme?.name, 'PragmaticDark');
        reset();
    });
});
```

(Confirm `Pragmatic.instance` / `PragmaticLight.instance` accessor names against a compiled Material class before finalizing; adjust to the emitted shape.)

- [ ] **Step 4: Run, expect pass** (build first): `cd Mural && npm run build:templates && npx tsx --conditions=development --test --test-force-exit src/resources/pragmatic/tests/theme.test.ts` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add Mural/src/resources/pragmatic/pragmatic.ts Mural/src/resources/pragmatic/index.ts Mural/src/resources/pragmatic/tests/theme.test.ts
git commit -m "feat(pragmatic): re-export shim + theme validation test"
```

---

## Task 5: Typography dictionary (and fix the never-merged bug)

**Files:**
- Create: `Mural/src/resources/pragmatic/typography.mu`
- Modify: `Mural/src/resources/pragmatic/pragmatic.mu` (add `PragmaticTypography` to `dictionaries:`)
- Modify: `Mural/src/resources/pragmatic/pragmatic.ts` (re-export `PragmaticTypography`)
- Test: `Mural/src/resources/pragmatic/tests/typography.test.ts`

**Interfaces:**
- Produces: `PragmaticTypography` resource dictionary with keyed styles `Display1, Display2, H1, H2, H3, H4, Body, BodySm, BodySerif, UiLabel, UiLabelSm, UiCaption, Code, Label`, listed in the theme's `dictionaries:` so they resolve when Pragmatic is active (Material never does this — the bug).

- [ ] **Step 1: Write `typography.mu`** (`resources PragmaticTypography { … }`, pattern from `material/typography.mu`), one keyed `Style [TargetType = TextBlock]` per role binding the atoms, e.g.:

```
resources PragmaticTypography
{
    Style x:key="Body" [TargetType = TextBlock]
    {
        FontFamily = @BodyFont;
        FontWeight = @BodyWeight;
        FontSize = @BodySize;
        LineHeight = @BodyLineHeight;
        LetterSpacing = @BodyTracking;
    }
    // … the other 13 roles, same shape …
}
```

- [ ] **Step 2: Add to theme dictionaries.** In `pragmatic.mu`, `import PragmaticTypography from "./typography.mu.js"` and change `dictionaries: [MuralBasic, MuralFramework]` → `dictionaries: [MuralBasic, MuralFramework, PragmaticTypography]`.

- [ ] **Step 3: Re-export** `PragmaticTypography` from `pragmatic.ts`.

- [ ] **Step 4: Write the failing test** at `tests/typography.test.ts` — asserts a keyed style resolves from `Application.Resources` after activation (this is what Material gets wrong):

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application, ThemeManager } from '../../../runtime/index.js';
import { Pragmatic, PragmaticLight } from '../pragmatic.js';

describe('Pragmatic typography', () =>
{
    test('keyed type styles resolve once the theme is active', () =>
    {
        const app = new Application();
        Application.current = app;
        Pragmatic.Activate(PragmaticLight);
        const body = Application.current.Resources.Resolve('Body');
        assert.ok(body, 'Body style should resolve (Material regression: Typography never merged)');
        ThemeManager._resetForTesting();
        Application.current = undefined;
    });
});
```

(Confirm the resource-lookup method name — `Resolve` / `TryFindResource` — against `src/runtime/resource-dictionary.ts` and `application.ts`; adjust.)

- [ ] **Step 5: Build + run, expect pass.** `cd Mural && npm run build:templates && npx tsx --conditions=development --test --test-force-exit src/resources/pragmatic/tests/typography.test.ts` → PASS.

- [ ] **Step 6: Commit.**

```bash
git add Mural/src/resources/pragmatic/typography.mu Mural/src/resources/pragmatic/pragmatic.mu Mural/src/resources/pragmatic/pragmatic.ts Mural/src/resources/pragmatic/tests/typography.test.ts
git commit -m "feat(pragmatic): typography dictionary merged into theme (fixes never-merged bug)"
```

---

## Task 6: Conformance test (snapshot ↔ schemes)

**Files:**
- Create: `Mural/src/resources/pragmatic/scheme-values.ts` (parse `@Name = value` from a scheme `.mu` source)
- Test: `Mural/src/resources/pragmatic/tests/conformance.test.ts`

**Interfaces:**
- Consumes: `TokenSnapshot` (Task 1).
- Produces: `class SchemeValues { static Parse(muSource: string): Map<string, string>; }` — extracts each `@Name = value` (value trimmed, trailing comment stripped) from a scheme `.mu` file's text.
- Naming bridge: `Kebab(pascal: string): string` maps `Bg0`→`bg-0`, `BrandGreenSoft`→`brand-green-soft`, `Space1`→`space-1` (insert `-` before each capital and before a digit-run, lowercase).

- [ ] **Step 1: Write `scheme-values.ts`:**

```ts
// Parses `@Name = value` assignments out of a scheme .mu source. Used by
// the conformance test to compare authored scheme values against the
// design-system snapshot without depending on the runtime Brush shape.
export class SchemeValues
{
    private static readonly Assignment = /^\s*@([A-Za-z0-9]+)\s*=\s*(.+?)\s*$/;

    public static Parse(muSource: string): Map<string, string>
    {
        const out = new Map<string, string>();
        for (const line of muSource.split('\n'))
        {
            const m = SchemeValues.Assignment.exec(line);
            if (m !== null)
            {
                out.set(m[1], m[2].replace(/\s*\/\/.*$/, '').trim());
            }
        }
        return out;
    }
}
```

- [ ] **Step 2: Write the conformance test.** It asserts: (a) every design-system colour token has a matching catalog/scheme token; (b) light and dark scheme hex match the resolved snapshot; (c) a deliberately-removed token would fail (guard against silent gaps):

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TokenSnapshot } from '../token-snapshot.js';
import { SchemeValues } from '../scheme-values.js';

function read(rel: string): string
{
    return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}
function snapshot(): TokenSnapshot
{
    return new TokenSnapshot(JSON.parse(read('../../../../../dev-kit/design/design-systems/pragmatic/tokens.json')));
}
function kebab(pascal: string): string
{
    return pascal.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/([A-Za-z])(\d)/g, '$1-$2').toLowerCase();
}

describe('Pragmatic conformance', () =>
{
    const snap  = snapshot();
    const light = SchemeValues.Parse(read('../light.mu'));
    const dark  = SchemeValues.Parse(read('../dark.mu'));

    test('every design-system colour token is projected into the schemes', () =>
    {
        for (const ds of snap.ColorNames())
        {
            if (ds.startsWith('neutral-')) continue; // raw ramp, inlined
            const pascal = [...light.keys()].find(k => kebab(k) === ds);
            assert.ok(pascal, `no scheme token for design-system colour '${ds}'`);
        }
    });

    test('light + dark scheme hex equal the resolved snapshot', () =>
    {
        for (const [pascal, value] of light)
        {
            const ds = kebab(pascal);
            if (!snap.ColorNames().includes(ds)) continue; // non-colour token
            assert.equal(value.toUpperCase(), snap.Resolve(ds, 'light').toUpperCase(), `light ${pascal}`);
            assert.equal(dark.get(pascal)?.toUpperCase(), snap.Resolve(ds, 'dark').toUpperCase(), `dark ${pascal}`);
        }
    });

    test('a missing projection is detected (guard)', () =>
    {
        const partial = new Map(light);
        partial.delete('Bg0');
        const found = snap.ColorNames().filter(n => !n.startsWith('neutral-'))
            .every(ds => [...partial.keys()].some(k => kebab(k) === ds));
        assert.equal(found, false, 'removing Bg0 must be detectable');
    });
});
```

- [ ] **Step 3: Run, expect pass.** `cd Mural && npx tsx --conditions=development --test --test-force-exit src/resources/pragmatic/tests/conformance.test.ts`. If a colour mismatches, fix the scheme value in Task 3's files (the snapshot is authoritative), rebuild, rerun.

- [ ] **Step 4: Commit.**

```bash
git add Mural/src/resources/pragmatic/scheme-values.ts Mural/src/resources/pragmatic/tests/conformance.test.ts
git commit -m "feat(pragmatic): conformance test — schemes must match tokens.json snapshot"
```

---

## Task 7: Bundle offline fonts

**Files:**
- Create: `Mural/src/resources/pragmatic/fonts/*.woff2` + `OFL.txt` licences
- Modify: `Mural/src/resources/pragmatic/pragmatic.mu` (add a `fonts { }` block)
- Test: `Mural/src/resources/pragmatic/tests/fonts.test.ts`

**Interfaces:**
- Consumes: `FontManager` (`src/visual-engine/text/font-manager.ts`, `Register`).
- Produces: registered faces for Inter Tight (400/500/600), JetBrains Mono (400/500), Source Serif 4 (400), referenced by the `@FontSans/@FontMono/@FontSerif` stacks.

- [ ] **Step 1: Add the woff2 files.** Download the OFL builds of Inter Tight (weights 400/500/600), JetBrains Mono (400/500) and Source Serif 4 (400) into `fonts/`, plus each project's `OFL.txt`. Verify each file is a valid woff2 (`file fonts/*.woff2` shows "Web Open Font Format").

- [ ] **Step 2: Add the `fonts { }` block** to `pragmatic.mu` (syntax from `demo/demos/text-on-path/text-on-path.mu:26`), local relative paths:

```
fonts
{
    InterTight from "./fonts/InterTight-Regular.woff2"
    InterTight from "./fonts/InterTight-Medium.woff2" [Weight = Medium]
    InterTight from "./fonts/InterTight-SemiBold.woff2" [Weight = SemiBold]
    JetBrainsMono from "./fonts/JetBrainsMono-Regular.woff2"
    JetBrainsMono from "./fonts/JetBrainsMono-Medium.woff2" [Weight = Medium]
    SourceSerif4 from "./fonts/SourceSerif4-Regular.woff2"
}
```

(Confirm the `fonts { }` block is legal inside a `theme` block; if the grammar only allows it inside a `resources`/`DataTemplate` context, place it in `typography.mu`'s `resources` block instead. Verify against `src/compiler/parser.ts:422-470` before writing.)

- [ ] **Step 3: Write the test** at `tests/fonts.test.ts`:

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FontManager } from '../../../visual-engine/text/font-manager.js';
import '../pragmatic.js'; // import registers the theme + its fonts block

describe('Pragmatic fonts', () =>
{
    test('the three families are registered', () =>
    {
        assert.ok(FontManager.instance.Has('InterTight'), 'Inter Tight registered');
        assert.ok(FontManager.instance.Has('JetBrainsMono'), 'JetBrains Mono registered');
        assert.ok(FontManager.instance.Has('SourceSerif4'), 'Source Serif 4 registered');
    });
});
```

(Confirm `FontManager.instance.Has(...)` — or the actual query method — against `font-manager.ts`; adjust to the real API, e.g. a `Faces`/`Get` accessor.)

- [ ] **Step 4: Build + run, expect pass.** `cd Mural && npm run build:templates && npx tsx --conditions=development --test --test-force-exit src/resources/pragmatic/tests/fonts.test.ts` → PASS.

- [ ] **Step 5: Full suite green.** `cd Mural && npm test` → the whole suite passes (Pragmatic tests green, Material untouched).

- [ ] **Step 6: Commit.**

```bash
git add Mural/src/resources/pragmatic/fonts Mural/src/resources/pragmatic/pragmatic.mu Mural/src/resources/pragmatic/tests/fonts.test.ts
git commit -m "feat(pragmatic): bundle offline Inter Tight / JetBrains Mono / Source Serif 4"
```

---

## Done-when

- `npm run build:templates` emits `build/resources/pragmatic/*.mu.js` with no error.
- `npm test` is green, including the new Pragmatic tests.
- The conformance test passes and would fail on a value edit or a missing projection.
- Material is still the default theme; no app or existing test changed behavior.

## Next plans (not this phase)

- **Template waves 1–5** — one plan (or one per wave), authored after the density-binding mechanism and shadow effect are proven here and in Wave 1.
- **Default switch + app migration** — Plexus/devUI/TODL token rewrite, button-variant reconciliation, retire dynamic-scheme.
- **Material removal** — delete `material/`, migrate demos + tests.
