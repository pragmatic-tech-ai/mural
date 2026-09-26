# Pragmatic theme — design

**Date:** 2026-09-27
**Status:** Draft for review
**Scope:** Mural (theme + templates), Plexus (apps), TODL (token refs), dev-kit (token snapshot)

## Context

Mural ships one theme today, **Material**, with two hand-written schemes
(`MaterialLight`, `MaterialDark`) built on Material 3 roles: tonal colour
tiers, state-layer overlays, six elevation levels, and a 15-role type scale.
See `src/resources/material/`.

The **Pragmatic Labs Design System** — a Claude Artifact
(`https://claude.ai/artifact/XkyJGVRjDhwq8rKh52Pz7R`), pointed to from
`dev-kit/design/design-systems/pragmatic/` — is now the source of truth for the
suite's visual language. Its `project/tokens.json` defines a semantic token
system (Signal Green `#2EA862`; Inter Tight / JetBrains Mono / Source Serif 4;
`bg-*`/`fg-*`/`border-*` surfaces; a 4px grid; radii capped at 14px; flat
surfaces with rare, small shadows; a stepped density model). The designer has
extended it to cover Mural's full control surface (canvas, selection, density,
sizing, motion, disabled, UI type styles, focus).

## Goal

Make the Pragmatic Design System the **normative theme contract** for Mural.
Concretely:

1. Introduce a **Pragmatic** theme whose token catalog is derived from
   `tokens.json`, with **Light** and **Dark** schemes carrying the design
   system's values.
2. **Fork every control template** onto the Pragmatic token vocabulary and
   visual model (surface-step interaction, flat surfaces, 1px hairlines, 2px
   focus ring), replacing Material 3 mechanics.
3. **Migrate the apps** (Plexus, devUI, TODL) off Material's M3 token names onto
   the native Pragmatic vocabulary, and default them to Pragmatic.
4. **Remove Material**, migrating Mural's demos and tests.

**Principle — one source of truth.** The token names, values, and usage rules
live in `tokens.json`. Mural's catalog and schemes are a faithful projection of
it, held in sync by a conformance test (below). Any future theme complies with
the **same catalog contract**; it may only re-supply values, never invent a
different token vocabulary. Where a control's look is not expressible in the
catalog, the catalog is extended in the design system first, then projected —
not patched locally in Mural.

## Non-goals

- No change to the design system's content (that is the designer's, in the
  artifact). Mural consumes it.
- No new controls. This re-skins and re-models the existing control set.
- No live/remote build against the artifact. The token values enter the repo as
  a committed snapshot (see Conformance).
- The Material 3 dynamic-scheme generator (`makeDynamicScheme`, HSL tonal
  approximation) and the ThemeSelector "Custom…" seed flow are **retired**, not
  ported (see Runtime).

## The token catalog (the contract)

A Mural theme catalog declares token **names** and **types**; schemes supply
**values**. The Pragmatic catalog is the projection of `tokens.json`. Naming
rule: design-system kebab names become **PascalCase** Mural tokens
(`bg-0` → `Bg0`, `fg-on-accent` → `FgOnAccent`, `radius-md` → `RadiusMd`,
`brand-green-soft` → `BrandGreenSoft`). Raw ramp steps (`neutral-*`) are **not**
catalog tokens — they are inlined as literal values inside the semantic tokens
that reference them, matching the design system's "prefer the semantic tokens"
rule.

### Colour (`Brush`) — ~40 tokens

- Brand: `BrandGreen`, `BrandGreenHover`, `BrandGreenPress`, `BrandGreenSoft`,
  `BrandGreenInk`
- Accents: `AccentCyan`, `AccentCyanSoft`, `AccentCyanInk`, `AccentPlum`,
  `AccentPlumSoft`, `AccentPlumInk`
- State: `StateSuccess`/`Soft`/`Ink`, `StateWarning`/`Soft`/`Ink`,
  `StateDanger`/`Soft`/`Ink`, `StateInfo`, `StateInfoSoft`
- Surfaces: `Bg0`, `Bg1`, `Bg2`, `Bg3`, `BgInverse`
- Text/icon: `Fg0`, `Fg1`, `Fg2`, `Fg3`, `FgDisabled`, `FgOnAccent`, `FgInverse`
- Lines: `Border`, `BorderStrong`, `BorderFocus`
- Selection/canvas: `SurfaceSelected`, `CanvasBg`, `CanvasGridDot`,
  `SelectionMarqueeFill`, `SelectionMarqueeStroke`, `TextSelectionBg`,
  `TextSelectionFg`
- Overlay: `Scrim`

### Numbers

- Spacing (`number`, px): `Space1`…`Space10` = 4, 8, 12, 16, 24, 32, 48, 64, 96,
  128.
- Radius (`number`, px): `RadiusNone` 0, `RadiusXs` 2, `RadiusSm` 4, `RadiusMd`
  6, `RadiusLg` 10, `RadiusXl` 14; `RadiusPill` (`CornerRadius`, full).
- Sizing (`number`, px): `ControlHDense` 28, `ControlHCompact` 32,
  `ControlHDefault` 36, `ControlHTouch` 44; `RowHDense` 24, `RowHCompact` 28,
  `RowHDefault` 32, `RowHTouch` 40.
- Density step (`number`, px offset): `DensityTouch` +8, `DensityComfortable` 0,
  `DensityCompact` −4, `DensityDense` −8. (See Density.)
- Motion (`number`, ms): `DurationFast` 120, `DurationMedium` 200,
  `DurationSlow` 320.
- Opacity (`number`): `OpacityDisabled` 0.5.
- Focus (`number`, px): `FocusRingWidth` 2, `FocusRingOffset` 2.

### Weights, families, easing, effects

- `FontWeight`: `WeightRegular` 400, `WeightMedium` 500, `WeightSemibold` 600,
  `WeightBold` 700.
- `string` (family stacks): `FontSans`, `FontMono`, `FontSerif`.
- `EasingFunction`: `EasingStandard` `cubic(0.2,0,0,1)`, `EasingInout`
  `cubic(0.4,0,0.2,1)`.
- `Effect`: `ShadowSm`, `ShadowMd`, `ShadowLg` (see Shadows).

### Type styles (keyed `Style`s, not catalog tokens)

Provided by a **Typography** resource dictionary (see Typography), keyed:
`Display1`, `Display2`, `H1`, `H2`, `H3`, `H4`, `Body`, `BodySm`, `BodySerif`,
`UiLabel`, `UiLabelSm`, `UiCaption`, `Code`, `Label`. Each composes the
`fontSize`/`lineHeight`/`fontWeight`/`letterSpacing`/`family` from the matching
`tokens.json` type style.

### Tokens intentionally dropped from Material

Not projected, because the Pragmatic visual model replaces them:
state-layer overlays (`StateHoverOverlay`, all `*HoverLayer`/`*PressLayer`),
elevation levels (`ElevationLevel0-5` + legacy `Elevation1-5`), `SurfaceTint`,
`Shadow` (brush), and the secondary/tertiary **container** tiers
(`SecondaryContainer`, `TertiaryContainer`, …). Interaction is expressed by
stepping the surface (`Bg1`→`Bg2`→`Bg3`); depth by the three shadow effects;
accents by plum/cyan.

## Conformance — keeping Mural in sync with the design system

1. **Snapshot.** The design system's `tokens.json` is committed at
   `dev-kit/design/design-systems/pragmatic/tokens.json` (imported from the
   artifact; the existing `design-systems/pragmatic/README.md` already documents
   the artifact as canonical). Refreshing it is a deliberate, reviewed step.
2. **Projection.** `light.mu`/`dark.mu` schemes carry values matching the
   snapshot; `pragmatic.mu` declares the catalog.
3. **Conformance test** (`src/resources/pragmatic/tests/conformance.test.ts`):
   reads the committed `tokens.json` snapshot and asserts, for every design-system
   token, that (a) a corresponding catalog token exists, and (b) the Light and
   Dark scheme values equal the resolved design-system values (aliases resolved,
   light/dark selected). A design-system token with no Mural projection, or a
   value drift, fails the build. This enforces "the design system is the source
   of truth" mechanically without a full code generator.
4. **Future option (out of scope):** replace hand-authored schemes with a
   generator that emits `light.mu`/`dark.mu` from the snapshot. The conformance
   test is the seam that makes that safe to add later.

## Schemes

`scheme PragmaticLight against Pragmatic` and `scheme PragmaticDark against
Pragmatic`, `defaultScheme: PragmaticLight`. Values are the resolved
`tokens.json` values per theme:

- A semantic token that aliases a raw ramp step resolves to that step's hex
  (`Bg0` light = `neutral-50` = `#FAFAF9`; dark = `neutral-1000` = `#0A0A0B`).
- A token with only a `light` value uses it in both schemes (e.g. `BrandGreen`).
- Explicit dark values (`Fg0` dark `#F5F5F2`, `Border` dark `#2A2925`, the
  `*-soft` and `*-ink` dark tints) are carried into `PragmaticDark`.

No `basedOn` between the two (they differ across most tokens); non-colour tokens
(spacing, radius, sizing, motion, weights, families) are identical in both and
are duplicated, as Material's schemes do.

## Fonts (offline)

Inter Tight, JetBrains Mono and Source Serif 4 must load offline (the Electron
CSP blocks Google Fonts). Bundle `.woff2` files under
`src/resources/pragmatic/fonts/` and register them via a `fonts { … }` block in
`pragmatic.mu` (compiled to `FontManager.Register`, injected as `FontFace` by
the HTML target, and available to text measurement). `FontSans`/`FontMono`/
`FontSerif` then reference the bundled families with the design system's fallback
stacks. Weights needed: 400/500/600 (Inter Tight), 400 (JetBrains Mono, +500 for
`Label`), 400 (Source Serif 4). Licence note: all three are OFL; include the
licence files.

## Typography dictionary (and the current bug)

The `Typography` dictionary is **never merged at runtime today** — Material lists
only `[MuralBasic, MuralFramework]` in `dictionaries:`, so `@BodySmall` and the
other role styles resolve to nothing (a latent Material bug; see the Explore
findings). Pragmatic fixes this: `PragmaticTypography` is listed in the theme's
`dictionaries:` so its keyed styles resolve. Styles read the family/size/weight
from `tokens.json` type styles. This also gives the app the `UiLabel`/`Code`/etc.
styles it needs.

## Density

`tokens.json` models density as a stepped system: a `data-density` ancestor
selects a step offset (`DensityTouch/Comfortable/Compact/Dense`) added to a base
`ControlHDefault`/`RowHDefault`. Mural has no HTML `data-*` cascade; instead:

- Expose the four `ControlH*` and four `RowH*` tokens plus the density steps as
  catalog tokens.
- Provide a `Density` attached property (or reuse the existing density concept
  Mural already has — `Density.Compact` etc. appear in button triggers) that
  selects the matching `ControlH*`/`RowH*` per subtree. Templates read the
  selected height token rather than a fixed dp.
- Default is Comfortable (36/32). This replaces Material's flat
  `ListRowHeight{Compact,Regular,…}` tokens.

(Exact binding mechanism is an implementation detail for the plan; the contract
is the eight height tokens + four steps.)

## Shadows

`ShadowSm/Md/Lg` are `Effect` tokens. Mural has `DropShadowEffect`
(WPF-like: direction, depth, blur, colour, opacity). The design system's shadows
are one- or two-layer CSS box-shadows. Represent each as a `DropShadowEffect`
approximating the dominant layer (e.g. `ShadowMd` ≈ `y 4, blur 12, black @6%`
light / `@50%` dark). If a single drop shadow proves visibly insufficient for
the two-layer specs, add a small composite-shadow effect; decide during the
foundation phase. Surfaces are flat by default — shadows appear only on
popovers/menus/palette (`ShadowMd`) and modals (`ShadowLg`), and rarely
`ShadowSm`.

## Template fork

All control families move to `src/resources/pragmatic/` templates, replacing
Material's `basic.resources.mu` + the 26 `framework/*/*.template.mu`. The theme
lists `[PragmaticBasic, PragmaticFramework, PragmaticTypography]`.

**Mechanic mappings** applied throughout:

| Material 3 mechanic | Pragmatic replacement |
| --- | --- |
| `PART_StateLayer` hover/press tint overlays | Step the surface: rest `Bg1`, hover `Bg2`, press/selected `Bg3` (or `SurfaceSelected` for selection). |
| `Effect = @ElevationN` on surfaces | Flat by default; `ShadowMd` for popovers/menus, `ShadowLg` for modals. |
| Button `Variant` = Filled/Elevated/Tonal/Outlined/Text | Button `Variant` = **Primary** (`BrandGreen` fill, `FgOnAccent`), **Secondary** (`Bg1` + `BorderStrong`), **Ghost** (transparent, hover `Bg2`), **Danger** (`StateDanger` fill). Map existing call sites (see App migration). |
| `@ShapeSmall`/`Medium`/`Large`/`ExtraLarge` (8/12/16/28) | `RadiusMd` inputs/buttons/menu items, `RadiusLg` cards/menus/modals/toasts, `RadiusSm`/`Xs` inner/badges, `RadiusPill` pills. Nothing above 14px. |
| Focus via state layer | 2px `BorderFocus` outline, `FocusRingOffset` 2. |
| `ListRowHeight*` | Density-selected `RowH*`. |
| Disabled via container/content opacity | `OpacityDisabled` on the whole control + `FgDisabled` for standalone disabled text. |

**Waves** (each ends green: builds, its controls render in Light+Dark against the
design-system previews, its tests pass):

1. **Primitives & inputs:** TextBlock/RichText, Button, IconButton, TextBox,
   Checkbox, RadioButton, Switch, Slider, SpinEdit, Chip, Badge, Divider.
2. **Lists & selection:** ComboBox, ListBox, TreeView, SegmentedButton, TabControl,
   ScrollBar, ScrollViewer, Splitter, Thumb.
3. **Overlays & surfaces:** Card, Dialog, Drawer, BottomSheet/SideSheet, Tooltip,
   ContextMenu/Menu, MenuButton, SplitButton, Snackbar (Toast), Banner,
   ProgressIndicator, FAB.
4. **Shell & navigation:** EditorShell/ViewerShell, ToolBar, TopAppBar/
   BottomAppBar, NavigationRail/Bar, ActivityBar, StatusBar, SearchBar,
   PanelButton, ShellSideContentPane, ThemeSelector.
5. **Complex & app-specific:** Ribbon (+ parts), PropertyGrid, DatePicker/
   TimePicker, the formatting editors (ColorPicker/BrushPicker/FillEditor/
   PenEditor/ShapeFormatControl), Carousel, and diagram chrome
   (Diagram/Connector/Figure/Group/ToolboxVisualPresenter) — these mostly just
   consume the new tokens.

## Runtime

- Register `Pragmatic` alongside Material during the fork; switch app defaults to
  `PragmaticLight`/`PragmaticDark` in Wave 4–5.
- `ThemeManager.AutoScheme({ light: PragmaticLight, dark: PragmaticDark })`
  continues to follow the OS setting.
- **Retire** `makeDynamicScheme`/`makeDynamicLightDarkPair` and the
  ThemeSelector "Custom…" seed option (Material 3 tonal generation has no
  meaning under a hand-tuned brand palette). The ThemeSelector keeps the
  theme/scheme combos (Pragmatic ▸ Light/Dark).

## App migration

- **Plexus + devUI** (~400 `@Role` refs, 13 files importing Material): rewrite M3
  token refs to native (`@OnSurfaceVariant`→`@Fg2`, `@SurfaceContainerHigh`→
  `@Bg2`, `@Primary`→`@BrandGreen`, `@Outline`/`@OutlineVariant`→
  `@BorderStrong`/`@Border`, state overlays removed, `@Elevation2`→ flat or
  `@ShadowMd`). Change `Application [Theme = Material, Scheme = MaterialDark]` to
  `Pragmatic`/`PragmaticDark`. Reconcile button `Variant` usages (Text→Ghost,
  Filled→Primary, Tonal/Outlined→Secondary, Plain→Ghost) at the ~60 call sites.
- **TODL** (8 files, 6 M3 refs): same rewrite.
- App-local keyed styles that referenced M3 tokens (`ToolMonoBox`, rails, etc.)
  update to native tokens.

## Material removal

After the apps run on Pragmatic and demos/tests are migrated: delete
`src/resources/material/`, remove Material from default-theme registration, and
migrate Mural's demos (8 `.mu` referencing Material) and 13 Material test files
to Pragmatic. `material3-tokens.md`/`m3-modernization-plan.md` are archived.

## Testing

- **Conformance** test (above) — the sync gate.
- **Theme/scheme** tests mirrored from Material's (`theme.test.ts`,
  `visual-scheme-theme.test.ts`, typography, dynamic-resource-first-access) for
  Pragmatic; drop the dynamic-scheme test.
- **Per-wave** render checks: each control renders in Light and Dark with no
  unresolved `@Token`, matched against the design-system component previews.
- **Font** load test: the three families register and measure.
- Existing Plexus/TODL suites must stay green after migration.

## Phases & sequencing

1. **Foundation:** snapshot `tokens.json`; catalog + schemes + fonts +
   Typography (bug fix) + density tokens + shadow effects; conformance test;
   register Pragmatic (non-default). *Material still default; nothing breaks.*
2. **Template waves 1–5** as above, Pragmatic registered, verified against
   previews.
3. **Default switch + app migration:** Plexus, devUI, TODL to native tokens and
   `Pragmatic` default; reconcile button variants; retire dynamic-scheme.
4. **Material removal:** delete `material/`, migrate demos + tests.

Steps 3–4 must not begin until every control family a consumer uses has a
Pragmatic template (end of step 2), or removing Material breaks unstyled
controls.

## Risks & mitigations

- **Scale (~8.6k template lines).** Mitigated by waves that each stay green and
  by the mechanic-mapping table (mechanical, repeatable edits).
- **Two-layer shadows via single DropShadowEffect.** Decided in Foundation; add
  a composite effect only if needed.
- **Density mechanism.** Mural lacks a `data-*` cascade; the attached-property
  approach is the fallback. Prototype in Wave 1 (Button/inputs) before relying on
  it in lists.
- **Button variant reconciliation.** ~60 call sites; a name map plus a codemod
  grep pass, reviewed per file.
- **Snapshot drift.** The conformance test fails the build if Mural and the
  snapshot diverge; refreshing the snapshot is the only sanctioned way to change
  values.

## Out of scope / follow-ups

- Token-value code generator (conformance test is the seam).
- A second theme (the catalog is the reusable contract; a `theme extends`
  compiler feature or shared catalog module can be added when one appears).
- Design-system content changes (the designer's, in the artifact).
