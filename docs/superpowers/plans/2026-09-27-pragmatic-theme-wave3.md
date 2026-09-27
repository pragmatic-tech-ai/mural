# Pragmatic Theme — Wave 3 (Overlays & Surfaces) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork the Overlays & Surfaces control families onto the Pragmatic theme so every surface, popover, feedback and menu control paints in Pragmatic tokens (never Material M3) when Pragmatic is active, while Material stays byte-identical.

**Architecture:** Each family gets a `src/framework/pragmatic/<family>/<name>.template.mu` override dictionary imported into `PragmaticControls` (`src/resources/pragmatic/controls.resources.mu`), which the Pragmatic theme lists AFTER `MuralFramework`, so each key-less `Style[TargetType=X]` shadows Material's on the runtime class key (last-merged-wins). Un-forked controls fall back to Material. This is the identical mechanism proven in Waves 1–2; Wave 3 adds surface/popover/menu families. FAB is already forked (Wave 1) — skip it.

**Tech Stack:** Mural (`.mu` markup → `.mu.js` via `npm run build:templates`); TypeScript; `node:test` via `npx tsx --conditions=development --test --test-force-exit`.

**Spec:** The Pragmatic Design System ([[reference_pragmatic_design_system]], Claude Artifact `XkyJGVRjDhwq8rKh52Pz7R`; `dev-kit/design/design-systems/pragmatic/tokens.json` is the normative token contract) plus the Wave 1 design spec `docs/superpowers/specs/2026-09-27-pragmatic-theme-design.md`. This plan is the wave-scoped argument from that spec; the Wave 2 plan `docs/superpowers/plans/2026-09-27-pragmatic-theme-wave2.md` is the precedent for structure, patterns and test idioms.

## Global Constraints

- **House style (CLAUDE.md), verbatim intent:** Allman braces in all `.ts` (opening brace on its own line for class/interface/enum/method/ctor/control-flow; `else`/`catch`/`finally` on their own line; object literals, block-arrows and one-line blocks stay inline). `.mu` markup and generated `*.mu.js` keep their own style. OOP only — no module-level free functions or variables in `.ts` (test helpers are static methods on a class; module-`const` compile-time constants and `enum`/type declarations are fine). No inline reused/user-facing string literals in `.ts` — hoist to `private static readonly` PascalCase constants (structural single-use tokens like `typeof` guards exempt). Real `enum`s, never string-literal unions. PascalCase for all interfaces and all public methods.
- **Tests live in a `tests/` subfolder next to source.** Wave-3 control tests go in `src/resources/pragmatic/tests/` beside the Wave-1/2 `controls-*.test.ts`, using the existing `ControlHarness`.
- **Pragmatic tokens ONLY in Pragmatic forks.** No raw hex, and no M3 token: none of `@Surface` / `@SurfaceContainer*` / `@On*` / `@Outline*` / `@Shape*` / `@Elevation*` / `@ElevationLevel*` / `@State*Overlay` / `@SecondaryContainer` / `@Primary` / `@OnPrimary` / `@PrimaryContainer` / `@DisabledContentOpacity` / `@Spacing*` / `@*Font` / `@*Size` (M3 typography atoms) may appear in a Wave-3 fork. Use the token map below. Shared theme-independent geometry tokens (`@ChevronDown`, `@ChevronRight`, `@IconClose` — `include`d in `src/resources/basic.resources.mu`) ARE allowed; they resolve under both themes.
- **Material stays byte-identical.** Wave 3 adds files and import lines only; it never edits a Material template, a scheme file, or a control `.ts`. (If a control genuinely cannot be reached by a `.mu` fork — e.g. imperative TS chrome — STOP and raise it as a ruling; no such control is expected in this wave.)
- **Build before test.** `npm run build:templates` (or `npm test`, whose `pretest` runs it) regenerates `build/**.mu.js` from every `.mu` under `src/`. New `.mu` files are picked up automatically; they are NOT committed (build output is gitignored).
- **Stroke is Pen-form:** `Stroke = Pen [ Brush = @Token, Thickness = N ]`. Selected/checked-over-hover uses a dedicated opaque `PART_Selected` layer that carries the content Padding (so its fill spans the full rect); focus uses a dedicated cue — both are the Wave-1/2 patterns, because ControlTemplate triggers are chronological/last-event-wins.

## M3 → Pragmatic token map (LOCKED)

Every Wave-3 fork translates Material tokens through this table. Where one M3 token maps to two Pragmatic tokens, the row says which context takes which.

| Material (M3) | Pragmatic | Notes |
|---|---|---|
| `@Surface` | `@Bg1` | resting page/surface |
| `@SurfaceContainerLow` (in-flow raised: Drawer, SideSheet, MenuStrip) | `@Bg2` | a subtly raised in-flow container |
| `@SurfaceContainerLow` (Card **Elevated** fill) | `@Bg1` | elevated card floats on `@Bg1` + shadow |
| `@SurfaceContainerHigh` (popup chrome) | `@Bg1` + `Stroke = Pen [ Brush = @Border, Thickness = 1 ]` + `Effect = @ShadowMd` | **canonical Pragmatic popover** (matches ComboBox popup) |
| `@SurfaceContainerHighest` (Card **Filled** fill, Progress track, LoadingIndicator Contained) | `@Bg2` | |
| `@InverseSurface` | `@BgInverse` | tooltip/snackbar backdrop |
| `@InverseOnSurface` | `@FgInverse` | ink on inverse backdrop |
| `@Scrim` | `@Scrim` | exists 1:1 (`#0A0A0B66`) |
| `@OnSurface` | `@Fg1` | primary ink |
| `@OnSurfaceVariant` | `@Fg2` | secondary ink (icons, gesture text, chevrons) |
| `@Outline` | `@BorderStrong` | group outlines |
| `@OutlineVariant` | `@Border` | dividers, hairlines, popover outline |
| `@Primary` (interactive fill: SplitButton) | `@ActionPrimary` (+ `@ActionPrimaryHover` / `@ActionPrimaryPress` ramp) | FAB precedent — shadow constant, fill steps |
| `@Primary` (non-interactive accent: Progress fill, Loading arc) | `@ControlAccent` | |
| `@OnPrimary` | `@FgOnAccent` | ink on accent fill |
| `@PrimaryContainer` (SplitButton seam) | `@ActionPrimaryPress` | darker-accent hairline reads as a seam |
| `@SecondaryContainer` (menu checked / submenu-open) | `@SurfaceSelected` | same token list/tree selection uses |
| `@ShapeExtraLarge` (Dialog, BottomSheet) | `@RadiusXl` | 14 — top of the Pragmatic radius scale |
| `@ShapeMedium` (Card) | `@RadiusLg` | 10 |
| `@ShapeSmall` (SplitButton) | `@RadiusMd` | 6 |
| `@ShapeExtraSmall` (menu/split popovers) | `@RadiusLg` | matches ComboBox popover |
| `@ShapeExtraSmall` (Tooltip, Snackbar chips) | `@RadiusMd` | small transient chip |
| `@ShapeFull` | `@RadiusPill` | `CornerRadius.Full` |
| `@Elevation3` (Dialog, Snackbar) | `@ShadowLg` | |
| `@Elevation2` (Tooltip, popovers) | `@ShadowMd` | |
| `@Elevation1` (BottomSheet, Drawer Temporary) | `@ShadowSm` | |
| `@ElevationLevel1` (Card Elevated resting) | `@ShadowSm` | Pragmatic has NO hover-elevation bump — shadow stays constant (FAB precedent); hover steps the surface instead |
| `@StateHoverOverlay` | opaque surface step: `@Bg2` (or `@Bg3` when the base is already `@Bg2`) | no translucent overlays in Pragmatic |
| `@StateFocusOverlay` | menu rows: `@Bg2` (surface) — interactive controls elsewhere use a dedicated `@BorderFocus` ring | |
| `@StatePressOverlay` | **deferred wave-wide** (subsumed by hover + selection), matching the Wave-2 minor deferral | do NOT invent a press surface unless a task says so |
| `@DisabledContentOpacity` | `@OpacityDisabled` | 0.5 |
| `@Spacing0..7` | choose the Pragmatic 4dp grid: `0`, `@Space1`=4, `@Space2`=8, `@Space3`=12, `@Space4`=16, `@Space5`=24, `@Space6`=32, `@Space7`=48 (Pragmatic jumps 16→24→32; pick the nearest sensible Pragmatic step, not a literal 20/28) | |
| `@HeadlineSmall` (keyed style) | `@H3` | via `Style = @H3` |
| `@TitleSmall`, `@LabelLarge` (keyed) | `@UiLabel` | |
| `@LabelMedium`, `@LabelSmall` (keyed) | `@UiCaption` | |
| `@BodyMedium` (keyed) | `@Body` | |
| `@BodySmall` (keyed) | `@BodySm` | |
| M3 typography ATOM sets (`@<Role>Font/Weight/Size/LineHeight/Tracking` on a control `Style`) | `FontFamily = @FontSans` + `@<Role>Weight/@<Role>Size/@<Role>LineHeight/@<Role>Tracking` (BodyMedium→`@Body*`, BodySmall→`@BodySm*`, LabelLarge→`@UiLabel*`) + `MeasurementFidelity = Exact` | matches the Wave-2 SegmentedItem fork |

**Wave-wide decisions (LOCKED):**
- Drop every `when ( ThemeManager.PrefersContrast = More )` trigger (consistent with the Wave-2 deferral; a11y contrast is a later pass). Keep `ThemeManager.Density` / `ThemeManager.Pointer` triggers.
- The Dialog/Drawer/SideSheet/BottomSheet modal scrim + focus-trap live in the services (`dialog-service.ts`, `overlay-helpers.ts`) and are theme-agnostic; `@Scrim` exists, so they work unchanged. Wave 3 forks only the floating surface chrome, never the scrim/mount machinery.
- Include `LoadingIndicator` in the ProgressIndicator task so an unforked spinner does not render grey under Pragmatic.
- Preserve EVERY `PART_*` name and every element TYPE (Arc, Border, Line, ContentPresenter, ItemsPresenter, MenuPopupHost, ClickAwayScrim, ScrollViewer) verbatim — controls fish these out by name/type in `.ts`, and the Progress/Loading animations depend on Arc/Border PART types.
- Keep all data-binding structural tokens as-is: `$Content`, `$$Title`, `$$Actions`, `$Leading`, `$Actions`, `$Label`, `$Variant`, `$Command`, `$Text`, `$Description`, `$Shortcut` are bindings, not theme values — copy them verbatim.

## Review Focus

Input classes/failure modes the spec implies that these tasks' happy-path tests do not otherwise force; each has its test pinned to the owning task below.

- **Dialog opened over content (scrim backdrop).** A user opening a modal expects a dimmed backdrop and an opaque, readable dialog surface. Test that `@Scrim` resolves under Pragmatic and the dialog surface is opaque `@Bg1` (not transparent). → Task 6.
- **Circular progress / loading spinner mid-animation.** The TS animation drives `PART_Fill` (Arc `EndAngle`) and, for Loading, a `RotateTransform` on `PART_Fill`; a fork that renames a PART or changes its type silently freezes the spinner. Test that `PART_Track`/`PART_Fill`/`PART_OuterFrame` (Circular) and `PART_Container`/`PART_Fill` (Loading) survive as Arc/Border. → Task 7.
- **Checked/current menu item while hovered.** The Wave-2 regression class: a shared-element selected fill is erased by a later hover event. Test a checked item that is also hovered still shows `@SurfaceSelected` (dedicated `PART_Selected` layer, z-order over `@Bg2`). → Task 10.
- **String tooltip / snackbar legibility on the inverse backdrop.** A bare-string tooltip inherits ink from the control `Style`; if that is `@Fg1` it vanishes on `@BgInverse`. Test the `Style` sets `Foreground = @FgInverse` and the surface renders no grey. → Tasks 6-context (Tooltip is Task 6? no) → Task 4 (Tooltip) and Task 9 (Snackbar).
- **Disabled SplitButton.** Disabling a split action should grey the WHOLE capsule, not one half. Test `IsEnabled = false` dims both `PART_PrimaryButton` and `PART_TriggerButton` to `@OpacityDisabled`. → Task 11.

*(Task numbers above refer to the task list below; the Tooltip legibility test is pinned to Task 4, Snackbar to Task 9.)*

## File Structure

Five new template files (mirroring Material's family layout), each with one import line added to `src/resources/pragmatic/controls.resources.mu`, and one test file per control/family in `src/resources/pragmatic/tests/`:

- `src/framework/pragmatic/surfaces/surfaces.template.mu` — Card (3 variants), Dialog (+ DialogAction template/panel), Drawer, BottomSheet, SideSheet. (NOT ScrollViewer — structural, no colour; NOT GroupItem — no default Style.) Created in Task 1, appended in Tasks 2–5.
- `src/framework/pragmatic/tooltips/tooltips.template.mu` — Tooltip (+ `[DataType=CommandBase]` template). Task 4.
- `src/framework/pragmatic/notifications/notifications.template.mu` — ProgressIndicator (Linear + Circular + Pens), LoadingIndicator (+ Pen), Banner, Snackbar. Created Task 7, appended Tasks 8–9.
- `src/framework/pragmatic/menu/menu.template.mu` — MenuButton (trigger + popup), ContextMenu, MenuItem (row + submenu), MenuStripItem, MenuSeparator, MenuStrip, shared items panels. Task 10.
- `src/framework/pragmatic/button-groups/split-button.template.mu` — SplitButton (+ popup). Task 11. (SegmentedButton already forked in `button-groups/segmented-button.template.mu`.)

Import block additions to `controls.resources.mu` (add each in its task):
```
import PragmaticSurfaces from "../../framework/pragmatic/surfaces/surfaces.template.mu.js"
import PragmaticTooltips from "../../framework/pragmatic/tooltips/tooltips.template.mu.js"
import PragmaticNotifications from "../../framework/pragmatic/notifications/notifications.template.mu.js"
import PragmaticMenus from "../../framework/pragmatic/menu/menu.template.mu.js"
import PragmaticSplitButton from "../../framework/pragmatic/button-groups/split-button.template.mu.js"
```

---

## Task 1: Card (surface exemplar)

The Wave-3 surface exemplar. Establishes the `surfaces.template.mu` file, the `PragmaticSurfaces` import, and the surface idiom every later surface task copies: a `PART_Border` chrome carrying fill/stroke/shadow, an inner `PART_StateLayer` that steps the surface on hover (never a translucent overlay), constant shadow (no elevation bump), `@OpacityDisabled` disable, density on the content padding.

**Files:**
- Create: `src/framework/pragmatic/surfaces/surfaces.template.mu`
- Modify: `src/resources/pragmatic/controls.resources.mu` (add the `PragmaticSurfaces` import)
- Test: `src/resources/pragmatic/tests/controls-card.test.ts`

**Interfaces:**
- Consumes: `ControlHarness` (`Activate`/`Render`/`IsPragmaticStyle`/`TokenCss`/`Reset`/`NeutralFallbackCss`); `Card` + `CardVariant` (`Filled`/`Elevated`/`Outlined`) from `../../../framework/surfaces/card.js`; `PragmaticLight`/`PragmaticDark`/`MaterialLight`.
- Produces: the `PragmaticSurfaces` dictionary (`resources PragmaticSurfaces { … }`) that Tasks 2–5 append their surface Styles into; the import line other surface tasks rely on already existing.

- [ ] **Step 1: Write the failing test** — `src/resources/pragmatic/tests/controls-card.test.ts`

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { Card, CardVariant } from '../../../framework/surfaces/card.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic Card', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const c = new Card();
        assert.ok(ControlHarness.IsPragmaticStyle(c), 'Card uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('Material is unaffected', () =>
    {
        ControlHarness.Activate(MaterialLight);
        const c = new Card();
        assert.ok(!ControlHarness.IsPragmaticStyle(c), 'Material Card keeps the Material style');
        ControlHarness.Reset();
    });

    test('Filled card fills @Bg2 with no border', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const c = new Card();
        const border = c.GetTemplateChild('PART_Border') as Border;
        assert.equal((border.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg2'), 'Filled card fills @Bg2');
        ControlHarness.Reset();
    });

    test('Elevated card fills @Bg1 and carries a resting shadow', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const c = new Card();
        c.Variant = CardVariant.Elevated;
        const border = c.GetTemplateChild('PART_Border') as Border;
        assert.equal((border.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg1'), 'Elevated card fills @Bg1');
        assert.notEqual(border.Effect, undefined, 'Elevated card carries a resting shadow Effect');
        ControlHarness.Reset();
    });

    test('Outlined card strokes @BorderStrong', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const c = new Card();
            c.Variant = CardVariant.Outlined;
            return c;
        }, { scheme: PragmaticLight });
        const strong = ControlHarness.TokenCss('BorderStrong');
        assert.ok(svg.includes(`stroke="${strong}"`), 'Outlined card strokes @BorderStrong');
        ControlHarness.Reset();
    });

    test('hover steps the state layer surface', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const c = new Card();
        const layer = c.GetTemplateChild('PART_StateLayer') as Border;
        c._setIsMouseOver(true);
        assert.equal((layer.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg3'), 'hovered Filled card steps @Bg3');
        ControlHarness.Reset();
    });

    test('no grey fallback under Pragmatic, and renders under dark', () =>
    {
        const { svg } = ControlHarness.Render(() => new Card(), { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080 — every token resolves');
        const dark = ControlHarness.Render(() => new Card(), { scheme: PragmaticDark });
        assert.ok(!dark.svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080 under PragmaticDark');
        ControlHarness.Reset();
    });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx tsx --conditions=development --test --test-force-exit src/resources/pragmatic/tests/controls-card.test.ts` — Expected: FAIL (`IsPragmaticStyle` false / `PART_Border` fill is the Material `@SurfaceContainerHighest` value, not `@Bg2`), because no Pragmatic Card fork exists yet. (Run `npm run build:templates` first if the harness needs the current build.)

- [ ] **Step 3: Create the fork** — `src/framework/pragmatic/surfaces/surfaces.template.mu`

```
// Pragmatic theme — surfaces family (Wave 3 surface exemplar + siblings).
//
// Card is the exemplar: PART_Border chrome (fill/stroke/shadow) wrapping
// PART_StateLayer (the hover surface step — Pragmatic has no translucent
// overlay, so hover STEPS the surface one tone) wrapping the ContentPresenter.
// Shadow is constant (Pragmatic has no elevation-level ladder — FAB
// precedent); hover steps the surface, not the shadow. Disabled dims to
// @OpacityDisabled. Density retunes the content padding only.
//
// Dialog / Drawer / BottomSheet / SideSheet (added in later Wave-3 tasks)
// share this file: each is a floating/in-flow shaped surface. The modal
// scrim + focus-trap are service-owned (theme-agnostic); these templates
// paint only the surface chrome.
//
// Pragmatic tokens only — no M3 (@Surface* / @On* / @Outline* / @Shape* /
// @Elevation* / @State*Overlay / @Spacing* / @DisabledContentOpacity) token.
// Merged via PragmaticControls (controls.resources.mu), after MuralFramework.

resources PragmaticSurfaces
{
    // ── Card: Filled — @Bg2, no border, no resting shadow ────────────
    Template x:key="DefaultFilledCard" [TargetType = Card]
    {
        Border x:name="PART_Border"
            [ Fill = @Bg2,
              CornerRadius = @RadiusLg ]
        {
            Border x:name="PART_StateLayer"
                [ Fill = #00000000,
                  CornerRadius = @RadiusLg,
                  Padding = (@Space4,@Space4,@Space4,@Space4) ]
            {
                ContentPresenter
            }
        }
        when ( IsMouseOver ) { PART_StateLayer.Fill = @Bg3; }
        when ( IsEnabled = false ) { PART_Border.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Density = Compact ) { PART_StateLayer.Padding = (@Space3,@Space3,@Space3,@Space3); }
        when ( ThemeManager.Density = Comfortable ) { PART_StateLayer.Padding = (@Space5,@Space5,@Space5,@Space5); }
    }

    // ── Card: Elevated — @Bg1, resting @ShadowSm (constant) ──────────
    Template x:key="DefaultElevatedCard" [TargetType = Card]
    {
        Border x:name="PART_Border"
            [ Fill = @Bg1,
              CornerRadius = @RadiusLg,
              Effect = @ShadowSm ]
        {
            Border x:name="PART_StateLayer"
                [ Fill = #00000000,
                  CornerRadius = @RadiusLg,
                  Padding = (@Space4,@Space4,@Space4,@Space4) ]
            {
                ContentPresenter
            }
        }
        when ( IsMouseOver ) { PART_StateLayer.Fill = @Bg2; }
        when ( IsEnabled = false ) { PART_Border.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Density = Compact ) { PART_StateLayer.Padding = (@Space3,@Space3,@Space3,@Space3); }
        when ( ThemeManager.Density = Comfortable ) { PART_StateLayer.Padding = (@Space5,@Space5,@Space5,@Space5); }
    }

    // ── Card: Outlined — @Bg1, 1dp @BorderStrong, no resting shadow ──
    Template x:key="DefaultOutlinedCard" [TargetType = Card]
    {
        Border x:name="PART_Border"
            [ Fill = @Bg1,
              Stroke = Pen [ Brush = @BorderStrong, Thickness = 1 ],
              CornerRadius = @RadiusLg ]
        {
            Border x:name="PART_StateLayer"
                [ Fill = #00000000,
                  CornerRadius = @RadiusLg,
                  Padding = (@Space4,@Space4,@Space4,@Space4) ]
            {
                ContentPresenter
            }
        }
        when ( IsMouseOver ) { PART_StateLayer.Fill = @Bg2; }
        when ( IsEnabled = false ) { PART_Border.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Density = Compact ) { PART_StateLayer.Padding = (@Space3,@Space3,@Space3,@Space3); }
        when ( ThemeManager.Density = Comfortable ) { PART_StateLayer.Padding = (@Space5,@Space5,@Space5,@Space5); }
    }

    Style [TargetType = Card]
    {
        Template = @DefaultFilledCard;
        when ( Variant = Elevated ) { Template = @DefaultElevatedCard; }
        when ( Variant = Outlined ) { Template = @DefaultOutlinedCard; }
    }
}
```

- [ ] **Step 4: Wire the import** — add to `src/resources/pragmatic/controls.resources.mu`, after the `PragmaticTabs` line:

```
    import PragmaticSurfaces from "../../framework/pragmatic/surfaces/surfaces.template.mu.js"
```

- [ ] **Step 5: Build + run, verify pass** — `npm run build:templates` then `npx tsx --conditions=development --test --test-force-exit src/resources/pragmatic/tests/controls-card.test.ts` — Expected: PASS (all Card tests green).

- [ ] **Step 6: Commit**

```bash
git add src/framework/pragmatic/surfaces/surfaces.template.mu src/resources/pragmatic/controls.resources.mu src/resources/pragmatic/tests/controls-card.test.ts
git commit -m "feat(pragmatic): fork Card (3 variants) onto Pragmatic — Wave 3 surface exemplar (Task 1)"
```

---

## Task 2: Dialog

Appends the Dialog surface + its action-row templates to `surfaces.template.mu`. Floating opaque surface; the scrim is service-owned.

**Files:**
- Modify: `src/framework/pragmatic/surfaces/surfaces.template.mu` (append inside `resources PragmaticSurfaces`)
- Test: `src/resources/pragmatic/tests/controls-dialog.test.ts`

**Interfaces:**
- Consumes: `Dialog` from `../../../framework/surfaces/dialog.js`; `ControlHarness`; schemes. Appends into the `PragmaticSurfaces` dict from Task 1.
- Produces: nothing later tasks consume.

- [ ] **Step 1: Write the failing test** — `src/resources/pragmatic/tests/controls-dialog.test.ts`

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { Dialog } from '../../../framework/surfaces/dialog.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic Dialog', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const d = new Dialog();
        assert.ok(ControlHarness.IsPragmaticStyle(d), 'Dialog uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('Material is unaffected', () =>
    {
        ControlHarness.Activate(MaterialLight);
        const d = new Dialog();
        assert.ok(!ControlHarness.IsPragmaticStyle(d), 'Material Dialog keeps the Material style');
        ControlHarness.Reset();
    });

    test('dialog surface is opaque @Bg1 with a large radius + shadow (Review Focus: scrim backdrop legibility)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const d = new Dialog();
        const surface = d.GetTemplateChild('PART_Dialog') as Border;
        assert.equal((surface.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg1'), 'dialog surface is opaque @Bg1');
        assert.notEqual(surface.Effect, undefined, 'dialog carries a shadow so it reads above the scrim');
        // The scrim is service-owned but must resolve under Pragmatic.
        assert.equal(ControlHarness.TokenCss('Scrim'), 'rgba(10,10,11,0.4)', '@Scrim resolves under Pragmatic');
        ControlHarness.Reset();
    });

    test('no grey fallback under Pragmatic and dark', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const d = new Dialog();
        const surface = d.GetTemplateChild('PART_Dialog') as Border;
        assert.notEqual(surface, undefined, 'PART_Dialog present');
        ControlHarness.Reset();
        ControlHarness.Activate(PragmaticDark);
        const dd = new Dialog();
        assert.ok(ControlHarness.IsPragmaticStyle(dd), 'Dialog resolves the Pragmatic style under dark');
        ControlHarness.Reset();
    });
});
```

Note: the exact `@Scrim` CSS string (`rgba(10,10,11,0.4)` for `#0A0A0B66`) is the expected value; if the harness's `TokenCss` renders `#0A0A0B66` in another equivalent form, adjust the literal to what the RED run prints (record a `Ruling:` if you change it) — the point of the assertion is that `@Scrim` resolves to a semi-opaque dark, not grey/undefined.

- [ ] **Step 2: Run it, verify it fails** — same runner on `controls-dialog.test.ts`. Expected: FAIL (`IsPragmaticStyle` false; `PART_Dialog` fill is Material `@Surface`).

- [ ] **Step 3: Append the fork** to `surfaces.template.mu` (inside `resources PragmaticSurfaces`, after the Card Style):

```
    // ── Dialog: floating modal surface (scrim is service-owned) ──────
    DataTemplate x:key="DialogActionTemplate" [DataType = DialogAction]
    {
        Button [ Variant = $Variant, Command = $Command, Margin = (@Space2,0,0,0) ]
        {
            TextBlock [ Text = $Label ]
        }
    }
    ItemsPanelTemplate x:key="DialogActionsPanel"
    {
        StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right ]
    }

    Template x:key="DefaultDialog" [TargetType = Dialog]
    {
        Border x:name="PART_Dialog"
            [ Fill = @Bg1,
              Stroke = Pen [ Brush = @Border, Thickness = 1 ],
              CornerRadius = @RadiusXl,
              Effect = @ShadowLg,
              Padding = (@Space5,@Space5,@Space5,@Space5) ]
        {
            DockPanel [ LastChildFill = true ]
            {
                TextBlock x:name="PART_Title"
                    [ DockPanel.Dock = Top,
                      Text = $$Title,
                      Foreground = @Fg1,
                      Style = @H3,
                      Margin = (0,0,0,@Space4) ]
                ItemsControl x:name="PART_Actions"
                    [ DockPanel.Dock = Bottom,
                      ItemsSource = $$Actions,
                      ItemTemplate = @DialogActionTemplate,
                      ItemsPanel = @DialogActionsPanel,
                      HorizontalAlignment = Right,
                      Margin = (0,@Space4,0,0) ]
                ContentPresenter
            }
        }
        when ( ThemeManager.Density = Compact ) { PART_Dialog.Padding = (@Space4,@Space4,@Space4,@Space4); }
        when ( ThemeManager.Density = Comfortable ) { PART_Dialog.Padding = (@Space6,@Space6,@Space6,@Space6); }
    }
    Style [TargetType = Dialog]
    {
        Template = @DefaultDialog;
    }
```

- [ ] **Step 4: Build + run, verify pass** — `npm run build:templates` then run `controls-dialog.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/framework/pragmatic/surfaces/surfaces.template.mu src/resources/pragmatic/tests/controls-dialog.test.ts
git commit -m "feat(pragmatic): fork Dialog onto Pragmatic (Wave 3 Task 2)"
```

---

## Task 3: Drawer

**Files:**
- Modify: `src/framework/pragmatic/surfaces/surfaces.template.mu`
- Test: `src/resources/pragmatic/tests/controls-drawer.test.ts`

**Interfaces:** Consumes `Drawer`, `DrawerVariant` from `../../../framework/surfaces/drawer.js`; `ControlHarness`; schemes.

- [ ] **Step 1: Write the failing test** — `controls-drawer.test.ts`

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { Drawer } from '../../../framework/surfaces/drawer.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic Drawer', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const d = new Drawer();
        assert.ok(ControlHarness.IsPragmaticStyle(d), 'Drawer uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('Material is unaffected', () =>
    {
        ControlHarness.Activate(MaterialLight);
        const d = new Drawer();
        assert.ok(!ControlHarness.IsPragmaticStyle(d), 'Material Drawer keeps the Material style');
        ControlHarness.Reset();
    });

    test('pane fills @Bg2 with a @Border edge', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const d = new Drawer();
        const pane = d.GetTemplateChild('PART_Pane') as Border;
        assert.equal((pane.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg2'), 'drawer pane fills @Bg2');
        ControlHarness.Reset();
    });

    test('resolves the Pragmatic style under dark', () =>
    {
        ControlHarness.Activate(PragmaticDark);
        const d = new Drawer();
        assert.ok(ControlHarness.IsPragmaticStyle(d), 'Drawer resolves the Pragmatic style under dark');
        ControlHarness.Reset();
    });
});
```

- [ ] **Step 2: Run it, verify it fails** — Expected: FAIL (Material style / `@SurfaceContainerLow` fill).

- [ ] **Step 3: Append the fork** to `surfaces.template.mu`:

```
    // ── Drawer (pane) ────────────────────────────────────────────────
    Template x:key="DefaultDrawerPane" [TargetType = Drawer]
    {
        Border x:name="PART_Pane"
            [ Fill = @Bg2,
              Stroke = Pen [ Brush = @Border, Thickness = 1 ],
              Padding = (0,@Space3,0,0) ]
        {
            ContentPresenter
        }
        when ( Variant = Temporary ) { PART_Pane.Effect = @ShadowSm; }
        when ( IsEnabled = false ) { PART_Pane.Opacity = @OpacityDisabled; }
    }
    Style [TargetType = Drawer]
    {
        Template = @DefaultDrawerPane;
    }
```

- [ ] **Step 4: Build + run, verify pass.**
- [ ] **Step 5: Commit**

```bash
git add src/framework/pragmatic/surfaces/surfaces.template.mu src/resources/pragmatic/tests/controls-drawer.test.ts
git commit -m "feat(pragmatic): fork Drawer onto Pragmatic (Wave 3 Task 3)"
```

---

## Task 4: Tooltip

New `tooltips.template.mu` + import. **Review Focus (inverse legibility):** the control `Style` must set `Foreground = @FgInverse` so a bare-string tooltip is legible on `@BgInverse`.

**Files:**
- Create: `src/framework/pragmatic/tooltips/tooltips.template.mu`
- Modify: `src/resources/pragmatic/controls.resources.mu` (add `PragmaticTooltips` import)
- Test: `src/resources/pragmatic/tests/controls-tooltip.test.ts`

**Interfaces:** Consumes `Tooltip` from `../../../framework/tooltips/tooltip.js`; `ControlHarness`; schemes.

- [ ] **Step 1: Write the failing test** — `controls-tooltip.test.ts`

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { Tooltip } from '../../../framework/tooltips/tooltip.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic Tooltip', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const t = new Tooltip();
        assert.ok(ControlHarness.IsPragmaticStyle(t), 'Tooltip uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('Material is unaffected', () =>
    {
        ControlHarness.Activate(MaterialLight);
        const t = new Tooltip();
        assert.ok(!ControlHarness.IsPragmaticStyle(t), 'Material Tooltip keeps the Material style');
        ControlHarness.Reset();
    });

    test('inverse surface: @BgInverse backdrop + @FgInverse ink (Review Focus: string legibility)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const t = new Tooltip();
        const border = t.GetTemplateChild('PART_Border') as Border | undefined;
        // The chrome root may be unnamed; assert the ink via the style-set Foreground,
        // and the backdrop token via the proxy (both are what make a string tooltip legible).
        assert.equal(ControlHarness.TokenCss('BgInverse'), 'rgb(10,10,11)', '@BgInverse backdrop');
        assert.equal(ControlHarness.TokenCss('FgInverse'), 'rgb(250,250,249)', '@FgInverse ink');
        assert.ok((t.Foreground as SolidColorBrush).Color.ToCss() === ControlHarness.TokenCss('FgInverse'), 'Tooltip ink is @FgInverse so a string tooltip is legible on the inverse backdrop');
        ControlHarness.Reset();
    });

    test('resolves under dark with no undefined ink', () =>
    {
        ControlHarness.Activate(PragmaticDark);
        const t = new Tooltip();
        assert.ok(ControlHarness.IsPragmaticStyle(t), 'Tooltip resolves the Pragmatic style under dark');
        assert.notEqual(t.Foreground, undefined, 'Tooltip ink resolves under dark');
        ControlHarness.Reset();
    });
});
```

Note: if `Tooltip.Foreground` is not directly readable off a headless instance, fall back to asserting via `GetTemplateChild('PART_Shortcut')` ink or the `TokenCss` proxies + `IsPragmaticStyle` (Wave-2 idiom) and record a `Ruling:`. The load-bearing assertion is that the Pragmatic Tooltip `Style` sets `Foreground = @FgInverse`.

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Create the fork** — `src/framework/pragmatic/tooltips/tooltips.template.mu`

```
// Pragmatic theme — Tooltip (Wave 3).
//
// Inverse surface: @BgInverse backdrop with @FgInverse ink so it stays
// legible over any host surface (the M3 inverse-tooltip convention, kept).
// @RadiusMd chip, @ShadowMd float. The control Style pins Foreground =
// @FgInverse + the @BodySm type atoms so a bare-string Content (wrapped in
// an unstyled TextBlock by ContentPresenter) renders legibly at tooltip
// metrics. A CommandBase Content resolves the rich template below.
//
// Pragmatic tokens only. Merged via PragmaticControls (after MuralFramework).

resources PragmaticTooltips
{
    Template x:key="DefaultTooltip" [TargetType = Tooltip]
    {
        Border
            [ Fill = @BgInverse,
              CornerRadius = @RadiusMd,
              Padding = (@Space2,@Space1,@Space2,@Space1),
              MinHeight = 24,
              MaxWidth = 320,
              Effect = @ShadowMd ]
        {
            StackPanel [ Orientation = Vertical ]
            {
                ContentPresenter
                TextBlock x:name="PART_Shortcut"
                    [ Style = @UiCaption,
                      Text = $Shortcut,
                      Foreground = @FgInverse,
                      Opacity = 0.7,
                      Margin = (0,2,0,0) ]
            }
        }
        when ( Shortcut = "" ) { PART_Shortcut.Visibility = Collapsed; }
    }

    Style [TargetType = Tooltip]
    {
        Template = @DefaultTooltip;
        Visibility = Collapsed;
        Foreground = @FgInverse;
        FontFamily = @FontSans;
        FontWeight = @BodySmWeight;
        FontSize = @BodySmSize;
        LineHeight = @BodySmLineHeight;
        LetterSpacing = @BodySmTracking;
        MeasurementFidelity = Exact;
    }

    // Rich CommandBase content — @UiLabel subhead over @BodySm paragraph.
    DataTemplate [DataType = CommandBase]
    {
        StackPanel [ Orientation = Vertical ]
        {
            TextBlock
                [ Style = @UiLabel,
                  Text = $Text,
                  Foreground = @FgInverse,
                  TextWrapping = Wrap ]
            TextBlock
                [ Style = @BodySm,
                  Text = $Description,
                  Foreground = @FgInverse,
                  TextWrapping = Wrap,
                  Opacity = 0.7,
                  Margin = (0,2,0,0) ]
        }
    }
}
```

- [ ] **Step 4: Wire the import** — add after `PragmaticSurfaces` in `controls.resources.mu`:

```
    import PragmaticTooltips from "../../framework/pragmatic/tooltips/tooltips.template.mu.js"
```

- [ ] **Step 5: Build + run, verify pass.**
- [ ] **Step 6: Commit**

```bash
git add src/framework/pragmatic/tooltips/tooltips.template.mu src/resources/pragmatic/controls.resources.mu src/resources/pragmatic/tests/controls-tooltip.test.ts
git commit -m "feat(pragmatic): fork Tooltip onto Pragmatic (Wave 3 Task 4)"
```

---

## Task 5: BottomSheet + SideSheet

Two surface siblings appended to `surfaces.template.mu`. BottomSheet keeps the asymmetric top-only radius; SideSheet keeps the `PART_CloseButton`/`@IconClose`/divider-lines/`PART_Title` anatomy.

**Files:**
- Modify: `src/framework/pragmatic/surfaces/surfaces.template.mu`
- Test: `src/resources/pragmatic/tests/controls-sheets.test.ts`

**Interfaces:** Consumes `BottomSheet` from `../../../framework/surfaces/bottom-sheet.js`; `SideSheet` from `../../../framework/surfaces/side-sheet.js`; `Dock` (for `Anchor`) from wherever `SideSheet` re-exports it (`../../../framework/surfaces/side-sheet.js` exports `SideSheet`; `Dock` is in the layout core — import from `../../../framework/index.js` or the path the class uses; the executor confirms the export path by reading `side-sheet.ts` line 93). `ControlHarness`; schemes.

- [ ] **Step 1: Write the failing test** — `controls-sheets.test.ts`

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { BottomSheet } from '../../../framework/surfaces/bottom-sheet.js';
import { SideSheet } from '../../../framework/surfaces/side-sheet.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic BottomSheet', () =>
{
    test('resolves the Pragmatic style under Pragmatic; Material unaffected', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.ok(ControlHarness.IsPragmaticStyle(new BottomSheet()), 'BottomSheet uses the Pragmatic style');
        ControlHarness.Reset();
        ControlHarness.Activate(MaterialLight);
        assert.ok(!ControlHarness.IsPragmaticStyle(new BottomSheet()), 'Material BottomSheet keeps the Material style');
        ControlHarness.Reset();
    });

    test('sheet fills @Bg1 (top-rounded surface) and carries a shadow', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const s = new BottomSheet();
        const sheet = s.GetTemplateChild('PART_Sheet') as Border;
        assert.equal((sheet.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg1'), 'bottom sheet fills @Bg1');
        assert.notEqual(sheet.Effect, undefined, 'bottom sheet carries a shadow');
        ControlHarness.Reset();
    });
});

describe('Pragmatic SideSheet', () =>
{
    test('resolves the Pragmatic style under Pragmatic; Material unaffected', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.ok(ControlHarness.IsPragmaticStyle(new SideSheet()), 'SideSheet uses the Pragmatic style');
        ControlHarness.Reset();
        ControlHarness.Activate(MaterialLight);
        assert.ok(!ControlHarness.IsPragmaticStyle(new SideSheet()), 'Material SideSheet keeps the Material style');
        ControlHarness.Reset();
    });

    test('sheet fills @Bg2 and keeps the close button + title anatomy', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const s = new SideSheet();
        const sheet = s.GetTemplateChild('PART_Sheet') as Border;
        assert.equal((sheet.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg2'), 'side sheet fills @Bg2');
        assert.notEqual(s.GetTemplateChild('PART_CloseButton'), undefined, 'PART_CloseButton preserved');
        assert.notEqual(s.GetTemplateChild('PART_Title'), undefined, 'PART_Title preserved');
        ControlHarness.Reset();
    });

    test('both sheets resolve the Pragmatic style under dark', () =>
    {
        ControlHarness.Activate(PragmaticDark);
        assert.ok(ControlHarness.IsPragmaticStyle(new BottomSheet()), 'BottomSheet dark');
        assert.ok(ControlHarness.IsPragmaticStyle(new SideSheet()), 'SideSheet dark');
        ControlHarness.Reset();
    });
});
```

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Append the forks** to `surfaces.template.mu`:

```
    // ── BottomSheet: top-rounded surface (bottom edges square) ────────
    Template x:key="DefaultBottomSheet" [TargetType = BottomSheet]
    {
        Border x:name="PART_Sheet"
            [ Fill = @Bg1,
              Stroke = Pen [ Brush = @Border, Thickness = 1 ],
              CornerRadius = (@RadiusXl,@RadiusXl,0,0),
              Effect = @ShadowSm,
              Padding = (@Space4,@Space4,@Space4,@Space4) ]
        {
            ContentPresenter
        }
        when ( ThemeManager.Density = Compact ) { PART_Sheet.Padding = (@Space3,@Space3,@Space3,@Space3); }
        when ( ThemeManager.Density = Comfortable ) { PART_Sheet.Padding = (@Space5,@Space5,@Space5,@Space5); }
    }
    Style [TargetType = BottomSheet]
    {
        Template = @DefaultBottomSheet;
    }

    // ── SideSheet: lateral sheet (Standard + Modal) ──────────────────
    // Body ContentPresenter declared FIRST so ContentControl's depth-first
    // slot walk binds Content to it (not the header's close button), then
    // positioned into row 1 by Grid.Row.
    Template x:key="DefaultSideSheet" [TargetType = SideSheet]
    {
        Border x:name="PART_Sheet" [ Fill = @Bg2 ]
        {
            DockPanel [ LastChildFill = true ]
            {
                Line x:name="PART_DividerLeft"
                    [ DockPanel.Dock = Left, Orientation = Vertical, Stroke = Pen [ Brush = @Border, Thickness = 1 ] ]
                Line x:name="PART_DividerRight"
                    [ DockPanel.Dock = Right, Orientation = Vertical, Stroke = Pen [ Brush = @Border, Thickness = 1 ], Visibility = Collapsed ]
                Grid
                {
                    RowDefinitions
                    {
                        RowDefinition [ Height = GridLength.Auto ]
                        RowDefinition [ Height = GridLength.Star ]
                    }
                    ContentPresenter
                        [ Grid.Row = 1,
                          Margin = (@Space4,@Space2,@Space4,@Space4) ]
                    Border [ Grid.Row = 0, Padding = (@Space4,@Space3,@Space2,@Space3) ]
                    {
                        DockPanel [ LastChildFill = true ]
                        {
                            IconButton x:name="PART_CloseButton"
                                [ Variant = Standard, DockPanel.Dock = Right ]
                            {
                                Shape [ Geometry = @IconClose, Fill = @Fg2, Width = 18, Height = 18 ]
                            }
                            TextBlock x:name="PART_Title"
                                [ Text = $$Title,
                                  Style = @UiLabel,
                                  Foreground = @Fg1,
                                  VerticalAlignment = Center ]
                        }
                    }
                }
            }
        }
        when ( Anchor = Left )
        {
            PART_DividerLeft.Visibility = Collapsed;
            PART_DividerRight.Visibility = Visible;
        }
    }
    Style [TargetType = SideSheet]
    {
        Template = @DefaultSideSheet;
    }
```

- [ ] **Step 4: Build + run, verify pass.**
- [ ] **Step 5: Commit**

```bash
git add src/framework/pragmatic/surfaces/surfaces.template.mu src/resources/pragmatic/tests/controls-sheets.test.ts
git commit -m "feat(pragmatic): fork BottomSheet + SideSheet onto Pragmatic (Wave 3 Task 5)"
```

---

## Task 6: ProgressIndicator + LoadingIndicator

New `notifications.template.mu` + import. **Review Focus (animation preservation):** keep `PART_Track`/`PART_Fill`/`PART_OuterFrame` (Circular) and `PART_Container`/`PART_Fill` (Loading) as Arc/Border; keep the Pen resources; the TS handlers drive `EndAngle` + a `RotateTransform` on these exact parts.

**Files:**
- Create: `src/framework/pragmatic/notifications/notifications.template.mu`
- Modify: `src/resources/pragmatic/controls.resources.mu` (add `PragmaticNotifications` import)
- Test: `src/resources/pragmatic/tests/controls-progress.test.ts`

**Interfaces:** Consumes `ProgressIndicator`, `ProgressIndicatorVariant` from `../../../framework/notifications/progress-indicator.js`; `LoadingIndicator`, `LoadingIndicatorVariant` from `../../../framework/notifications/loading-indicator.js`; `Border` from `../../../basic/border.js`; `Arc` from its module (executor confirms the `Arc` import path from `progress-indicator.ts`); `ControlHarness`; schemes. Produces the `PragmaticNotifications` dict that Tasks 8–9 append into.

- [ ] **Step 1: Write the failing test** — `controls-progress.test.ts`

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { ProgressIndicator, ProgressIndicatorVariant } from '../../../framework/notifications/progress-indicator.js';
import { LoadingIndicator } from '../../../framework/notifications/loading-indicator.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic ProgressIndicator', () =>
{
    test('resolves the Pragmatic style; Material unaffected', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.ok(ControlHarness.IsPragmaticStyle(new ProgressIndicator()), 'ProgressIndicator uses the Pragmatic style');
        ControlHarness.Reset();
        ControlHarness.Activate(MaterialLight);
        assert.ok(!ControlHarness.IsPragmaticStyle(new ProgressIndicator()), 'Material ProgressIndicator keeps the Material style');
        ControlHarness.Reset();
    });

    test('linear: track @Bg2, fill @ControlAccent', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const p = new ProgressIndicator();
        const track = p.GetTemplateChild('PART_Track') as Border;
        const fill = p.GetTemplateChild('PART_Fill') as Border;
        assert.equal((track.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg2'), 'linear track @Bg2');
        assert.equal((fill.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('ControlAccent'), 'linear fill @ControlAccent');
        ControlHarness.Reset();
    });

    test('circular: PART_Track/PART_Fill/PART_OuterFrame preserved (Review Focus: animation intact)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const p = new ProgressIndicator();
        p.Variant = ProgressIndicatorVariant.Circular;
        assert.notEqual(p.GetTemplateChild('PART_OuterFrame'), undefined, 'PART_OuterFrame preserved');
        assert.notEqual(p.GetTemplateChild('PART_Track'), undefined, 'PART_Track preserved (Arc)');
        assert.notEqual(p.GetTemplateChild('PART_Fill'), undefined, 'PART_Fill preserved (Arc, EndAngle-driven)');
        ControlHarness.Reset();
    });
});

describe('Pragmatic LoadingIndicator', () =>
{
    test('resolves the Pragmatic style; PART_Container/PART_Fill preserved', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const l = new LoadingIndicator();
        assert.ok(ControlHarness.IsPragmaticStyle(l), 'LoadingIndicator uses the Pragmatic style');
        assert.notEqual(l.GetTemplateChild('PART_Container'), undefined, 'PART_Container preserved');
        assert.notEqual(l.GetTemplateChild('PART_Fill'), undefined, 'PART_Fill preserved (rotating Arc)');
        ControlHarness.Reset();
    });

    test('resolves under dark with no undefined chrome', () =>
    {
        ControlHarness.Activate(PragmaticDark);
        assert.ok(ControlHarness.IsPragmaticStyle(new ProgressIndicator()), 'ProgressIndicator dark');
        assert.ok(ControlHarness.IsPragmaticStyle(new LoadingIndicator()), 'LoadingIndicator dark');
        ControlHarness.Reset();
    });
});
```

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Create the fork** — `src/framework/pragmatic/notifications/notifications.template.mu`

```
// Pragmatic theme — notifications family (Wave 3).
//
// ProgressIndicator (Linear + Circular) + LoadingIndicator: @Bg2 track,
// @ControlAccent fill/arc. The Circular + Loading animations are TS-driven
// (progress-indicator.ts sweeps PART_Fill's EndAngle; loading-indicator.ts
// spins a RotateTransform onto PART_Fill), so PART names + Arc/Border types
// are preserved verbatim. Banner + Snackbar are appended in later Wave-3
// tasks. Pragmatic tokens only. Merged via PragmaticControls.

resources PragmaticNotifications
{
    // ── ProgressIndicator: Linear ────────────────────────────────────
    Template x:key="DefaultLinearProgressIndicator" [TargetType = ProgressIndicator]
    {
        Border x:name="PART_Track"
            [ Fill = @Bg2,
              CornerRadius = 2,
              ClipToBounds = true,
              Height = 4 ]
        {
            Border x:name="PART_Fill"
                [ Fill = @ControlAccent,
                  CornerRadius = 2,
                  HorizontalAlignment = Left,
                  Height = 4 ]
        }
        when ( IsEnabled = false ) { PART_Track.Opacity = @OpacityDisabled; }
    }

    // Circular Arc pens — Brush resolves through DynamicResource so a theme
    // switch re-tints the pens.
    Pen x:key="ProgressTrackPen" [ Brush = @Bg2, Thickness = 4 ]
    Pen x:key="ProgressFillPen" [ Brush = @ControlAccent, Thickness = 4 ]

    Template x:key="DefaultCircularProgressIndicator" [TargetType = ProgressIndicator]
    {
        Border x:name="PART_OuterFrame"
            [ Fill = #00000000,
              Width = 40,
              Height = 40 ]
        {
            Arc x:name="PART_Track"
                [ StartAngle = -90,
                  EndAngle = 270,
                  Stroke = @ProgressTrackPen,
                  Width = 40,
                  Height = 40 ]
            Arc x:name="PART_Fill"
                [ StartAngle = -90,
                  EndAngle = 270,
                  Stroke = @ProgressFillPen,
                  Width = 40,
                  Height = 40 ]
        }
        when ( IsEnabled = false ) { PART_OuterFrame.Opacity = @OpacityDisabled; }
    }
    Style [TargetType = ProgressIndicator]
    {
        Template = @DefaultLinearProgressIndicator;
        when ( Variant = Circular ) { Template = @DefaultCircularProgressIndicator; }
    }

    // ── LoadingIndicator: indeterminate spinner ──────────────────────
    Pen x:key="LoadingActivePen" [ Brush = @ControlAccent, Thickness = 4 ]

    Template x:key="DefaultLoadingIndicator" [TargetType = LoadingIndicator]
    {
        Border x:name="PART_Container"
            [ Width = 48,
              Height = 48,
              Fill = #00000000,
              CornerRadius = @RadiusPill,
              HorizontalAlignment = Center,
              VerticalAlignment = Center ]
        {
            Arc x:name="PART_Fill"
                [ StartAngle = -90,
                  EndAngle = -50,
                  Stroke = @LoadingActivePen,
                  Width = 40,
                  Height = 40,
                  HorizontalAlignment = Center,
                  VerticalAlignment = Center ]
        }
        when ( Variant = Contained ) { PART_Container.Fill = @Bg2; }
        when ( IsEnabled = false ) { PART_Container.Opacity = @OpacityDisabled; }
    }
    Style [TargetType = LoadingIndicator]
    {
        Template = @DefaultLoadingIndicator;
    }
}
```

- [ ] **Step 4: Wire the import** — add after `PragmaticTooltips`:

```
    import PragmaticNotifications from "../../framework/pragmatic/notifications/notifications.template.mu.js"
```

- [ ] **Step 5: Build + run, verify pass.**
- [ ] **Step 6: Commit**

```bash
git add src/framework/pragmatic/notifications/notifications.template.mu src/resources/pragmatic/controls.resources.mu src/resources/pragmatic/tests/controls-progress.test.ts
git commit -m "feat(pragmatic): fork ProgressIndicator + LoadingIndicator onto Pragmatic (Wave 3 Task 6)"
```

---

## Task 7: Banner

Appends the in-flow alert strip to `notifications.template.mu`.

**Files:**
- Modify: `src/framework/pragmatic/notifications/notifications.template.mu`
- Test: `src/resources/pragmatic/tests/controls-banner.test.ts`

**Interfaces:** Consumes `Banner` from `../../../framework/notifications/banner.js`; `Border`; `ControlHarness`; schemes.

- [ ] **Step 1: Write the failing test** — `controls-banner.test.ts`

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { Banner } from '../../../framework/notifications/banner.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic Banner', () =>
{
    test('resolves the Pragmatic style; Material unaffected', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.ok(ControlHarness.IsPragmaticStyle(new Banner()), 'Banner uses the Pragmatic style');
        ControlHarness.Reset();
        ControlHarness.Activate(MaterialLight);
        assert.ok(!ControlHarness.IsPragmaticStyle(new Banner()), 'Material Banner keeps the Material style');
        ControlHarness.Reset();
    });

    test('strip fills @Bg1 with a @Border hairline foot', () =>
    {
        const { svg } = ControlHarness.Render(() => new Banner(), { scheme: PragmaticLight });
        const border = ControlHarness.TokenCss('Border');
        assert.ok(svg.includes(`stroke="${border}"`), 'banner foot strokes @Border');
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080');
        ControlHarness.Reset();
    });

    test('PART_Banner fills @Bg1', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const b = new Banner();
        const strip = b.GetTemplateChild('PART_Banner') as Border;
        assert.equal((strip.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg1'), 'banner strip fills @Bg1');
        ControlHarness.Reset();
    });

    test('renders with no grey under dark', () =>
    {
        const { svg } = ControlHarness.Render(() => new Banner(), { scheme: PragmaticDark });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080 under PragmaticDark');
        ControlHarness.Reset();
    });
});
```

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Append the fork** to `notifications.template.mu`:

```
    // ── Banner: in-flow alert / message strip ────────────────────────
    Template x:key="DefaultBanner" [TargetType = Banner]
    {
        StackPanel [ Orientation = Vertical ]
        {
            Border x:name="PART_Banner"
                [ Fill = @Bg1,
                  Padding = (@Space4,@Space3,@Space4,@Space3) ]
            {
                DockPanel [ LastChildFill = true ]
                {
                    ContentPresenter
                        [ DockPanel.Dock = Left,
                          Content = $Leading,
                          VerticalAlignment = Center,
                          Margin = (0,0,@Space3,0) ]
                    ContentPresenter
                        [ DockPanel.Dock = Right,
                          Content = $Actions,
                          VerticalAlignment = Center,
                          Margin = (@Space3,0,0,0) ]
                    ContentPresenter [ VerticalAlignment = Center ]
                }
            }
            Line [ Orientation = Horizontal, Stroke = Pen [ Brush = @Border, Thickness = 1 ] ]
        }
        when ( ThemeManager.Density = Compact ) { PART_Banner.Padding = (@Space3,@Space2,@Space3,@Space2); }
        when ( ThemeManager.Density = Comfortable ) { PART_Banner.Padding = (@Space5,@Space4,@Space5,@Space4); }
    }
    Style [TargetType = Banner]
    {
        Template = @DefaultBanner;
        Foreground = @Fg1;
        FontFamily = @FontSans;
        FontWeight = @BodyWeight;
        FontSize = @BodySize;
        LineHeight = @BodyLineHeight;
        LetterSpacing = @BodyTracking;
        MeasurementFidelity = Exact;
    }
```

- [ ] **Step 4: Build + run, verify pass.**
- [ ] **Step 5: Commit**

```bash
git add src/framework/pragmatic/notifications/notifications.template.mu src/resources/pragmatic/tests/controls-banner.test.ts
git commit -m "feat(pragmatic): fork Banner onto Pragmatic (Wave 3 Task 7)"
```

---

## Task 8: Snackbar

Appends the transient inverse message to `notifications.template.mu`. **Review Focus (inverse legibility):** `Style` sets `Foreground = @FgInverse`.

**Files:**
- Modify: `src/framework/pragmatic/notifications/notifications.template.mu`
- Test: `src/resources/pragmatic/tests/controls-snackbar.test.ts`

**Interfaces:** Consumes `Snackbar` from `../../../framework/notifications/snackbar.js`; `Border`; `ControlHarness`; schemes.

- [ ] **Step 1: Write the failing test** — `controls-snackbar.test.ts`

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { Snackbar } from '../../../framework/notifications/snackbar.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic Snackbar', () =>
{
    test('resolves the Pragmatic style; Material unaffected', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.ok(ControlHarness.IsPragmaticStyle(new Snackbar()), 'Snackbar uses the Pragmatic style');
        ControlHarness.Reset();
        ControlHarness.Activate(MaterialLight);
        assert.ok(!ControlHarness.IsPragmaticStyle(new Snackbar()), 'Material Snackbar keeps the Material style');
        ControlHarness.Reset();
    });

    test('inverse surface @BgInverse + @FgInverse ink (Review Focus: legibility)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const s = new Snackbar();
        const bar = s.GetTemplateChild('PART_Snackbar') as Border;
        assert.equal((bar.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('BgInverse'), 'snackbar fills @BgInverse');
        assert.equal((s.Foreground as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('FgInverse'), 'snackbar ink is @FgInverse');
        ControlHarness.Reset();
    });

    test('carries a shadow and resolves under dark', () =>
    {
        ControlHarness.Activate(PragmaticDark);
        const s = new Snackbar();
        const bar = s.GetTemplateChild('PART_Snackbar') as Border;
        assert.notEqual(bar.Effect, undefined, 'snackbar carries a shadow');
        assert.ok(ControlHarness.IsPragmaticStyle(s), 'Snackbar resolves the Pragmatic style under dark');
        ControlHarness.Reset();
    });
});
```

Note: if `Snackbar.Foreground` is not readable off a headless instance, fall back to the `TokenCss('FgInverse')` proxy + the `PART_Snackbar` fill assertion (record a `Ruling:`). The load-bearing check is `Style` `Foreground = @FgInverse` + `@BgInverse` fill.

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Append the fork** to `notifications.template.mu`:

```
    // ── Snackbar: transient inverse message ──────────────────────────
    Template x:key="DefaultSnackbar" [TargetType = Snackbar]
    {
        Border x:name="PART_Snackbar"
            [ Fill = @BgInverse,
              CornerRadius = @RadiusMd,
              Effect = @ShadowLg,
              Padding = (@Space4,@Space3,@Space2,@Space3) ]
        {
            DockPanel [ LastChildFill = true ]
            {
                ContentPresenter
                    [ DockPanel.Dock = Right,
                      Content = $Actions,
                      VerticalAlignment = Center,
                      Margin = (@Space4,0,0,0) ]
                ContentPresenter [ VerticalAlignment = Center ]
            }
        }
        when ( ThemeManager.Density = Compact ) { PART_Snackbar.Padding = (@Space3,@Space2,@Space1,@Space2); }
        when ( ThemeManager.Density = Comfortable ) { PART_Snackbar.Padding = (@Space5,@Space4,@Space3,@Space4); }
    }
    Style [TargetType = Snackbar]
    {
        Template = @DefaultSnackbar;
        Foreground = @FgInverse;
        FontFamily = @FontSans;
        FontWeight = @BodyWeight;
        FontSize = @BodySize;
        LineHeight = @BodyLineHeight;
        LetterSpacing = @BodyTracking;
        MeasurementFidelity = Exact;
    }
```

- [ ] **Step 4: Build + run, verify pass.**
- [ ] **Step 5: Commit**

```bash
git add src/framework/pragmatic/notifications/notifications.template.mu src/resources/pragmatic/tests/controls-snackbar.test.ts
git commit -m "feat(pragmatic): fork Snackbar onto Pragmatic (Wave 3 Task 8)"
```

---

## Task 9: Menu family

New `menu.template.mu` + import. Covers MenuButton (trigger + popup), ContextMenu, MenuItem (row + submenu), MenuStripItem, MenuSeparator, MenuStrip, and the shared items panels. **Review Focus (checked-over-hover):** the menu row gets a dedicated opaque `PART_Selected` layer (carrying the row padding) so a checked/submenu-open item survives a concurrent hover — the Wave-2 pattern applied to menus. Popups use the canonical Pragmatic popover.

**Files:**
- Create: `src/framework/pragmatic/menu/menu.template.mu`
- Modify: `src/resources/pragmatic/controls.resources.mu` (add `PragmaticMenus` import)
- Test: `src/resources/pragmatic/tests/controls-menu.test.ts`

**Interfaces:** Consumes `MenuItem`, `MenuStrip`, `MenuSeparator`, `MenuButton` from `../../../framework/menu/menu-strip.js`; `ContextMenu` from `../../../framework/menu/context-menu.js`; `Border`; `ControlHarness`; schemes. (Executor confirms exact exports by reading `menu-strip.ts`.)

- [ ] **Step 1: Write the failing test** — `controls-menu.test.ts`

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { MenuItem, MenuStrip, MenuButton } from '../../../framework/menu/menu-strip.js';
import { ContextMenu } from '../../../framework/menu/context-menu.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic menu family', () =>
{
    test('MenuItem/MenuStrip/MenuButton/ContextMenu resolve the Pragmatic style; Material unaffected', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.ok(ControlHarness.IsPragmaticStyle(new MenuItem()), 'MenuItem Pragmatic');
        assert.ok(ControlHarness.IsPragmaticStyle(new MenuStrip()), 'MenuStrip Pragmatic');
        assert.ok(ControlHarness.IsPragmaticStyle(new MenuButton()), 'MenuButton Pragmatic');
        assert.ok(ControlHarness.IsPragmaticStyle(new ContextMenu()), 'ContextMenu Pragmatic');
        ControlHarness.Reset();
        ControlHarness.Activate(MaterialLight);
        assert.ok(!ControlHarness.IsPragmaticStyle(new MenuItem()), 'Material MenuItem unchanged');
        ControlHarness.Reset();
    });

    test('menu row hover steps @Bg2', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const it = new MenuItem();
        it.Header = 'Open';
        const row = it.GetTemplateChild('PART_Row') as Border;
        it._setIsMouseOver(true);
        assert.equal((row.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg2'), 'hovered row steps @Bg2');
        ControlHarness.Reset();
    });

    test('checked item keeps @SurfaceSelected while hovered (Review Focus: checked-over-hover)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const it = new MenuItem();
        it.Header = 'Bold';
        it.IsChecked = true;
        it._setIsMouseOver(true);
        const selected = it.GetTemplateChild('PART_Selected') as Border;
        assert.equal((selected.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('SurfaceSelected'), 'checked+hovered row keeps @SurfaceSelected on the dedicated layer');
        ControlHarness.Reset();
    });

    test('separator + strip resolve tokens under dark', () =>
    {
        ControlHarness.Activate(PragmaticDark);
        assert.ok(ControlHarness.IsPragmaticStyle(new MenuItem()), 'MenuItem dark');
        assert.ok(ControlHarness.IsPragmaticStyle(new MenuStrip()), 'MenuStrip dark');
        ControlHarness.Reset();
    });
});
```

Note: if `MenuItem` bare construction does not apply the row template (the row is applied imperatively via `resolveSurfaceTemplate`), the executor drives it the way the Material menu tests do (read `menu-strip.ts` tests for the construction idiom) or asserts via `IsPragmaticStyle` + `TokenCss` proxy, recording a `Ruling:`. The load-bearing assertions are: hover→`@Bg2` on `PART_Row`; checked→`@SurfaceSelected` on a dedicated `PART_Selected` that survives hover.

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Create the fork** — `src/framework/pragmatic/menu/menu.template.mu`

```
// Pragmatic theme — menu family (Wave 3).
//
// Popups use the canonical Pragmatic popover (@Bg1 + @Border 1dp +
// @RadiusLg + @ShadowMd — same as the ComboBox popup). Menu rows replace
// M3's translucent state overlays with opaque surface steps: hover/focus
// step PART_Row to @Bg2; checked / submenu-open fill a DEDICATED opaque
// PART_Selected layer (@SurfaceSelected) that carries the row padding, so
// the current-item cue survives a concurrent hover (trigger order is
// last-event-wins — the Wave-2 selected-over-hover pattern). Pressed is
// deferred wave-wide. Every PART name is preserved (MenuItem's ctor fishes
// PART_Icon/PART_Label/PART_Gesture/PART_Chevron out by name).
//
// Pragmatic tokens only (+ shared geometry @ChevronRight). Merged via
// PragmaticControls.

resources PragmaticMenus
{
    ItemsPanelTemplate x:key="DefaultMenuItemsPanel"
    {
        StackPanel [ Orientation = Vertical ]
    }
    ItemsPanelTemplate x:key="DefaultMenuStripPanel"
    {
        StackPanel [ Orientation = Horizontal ]
    }

    // ── MenuButton: trigger ──────────────────────────────────────────
    Template x:key="DefaultMenuButtonTrigger" [TargetType = MenuButton]
    {
        Button x:name="PART_Trigger"
        {
            StackPanel x:name="PART_TriggerStack" [ Orientation = Horizontal ]
            {
                TextBlock x:name="PART_HeaderText" [ Foreground = @FgOnAccent, Style = @UiLabel ]
            }
        }
    }
    // ── MenuButton: popup (canonical popover) ────────────────────────
    Template x:key="DefaultMenuButtonPopup" [TargetType = MenuButton]
    {
        MenuPopupHost x:name="PART_PopupHost"
        {
            ClickAwayScrim x:name="PART_Scrim"
            Border x:name="PART_PopupContainer"
                [ Fill = @Bg1,
                  Stroke = Pen [ Brush = @Border, Thickness = 1 ],
                  CornerRadius = @RadiusLg,
                  Effect = @ShadowMd,
                  Padding = (0,@Space1,0,@Space1) ]
            {
                ItemsPresenter
            }
        }
    }
    Style [TargetType = MenuButton]
    {
        HorizontalAlignment = Left;
        VerticalAlignment = Top;
        Template = @DefaultMenuButtonPopup;
        TriggerTemplate = @DefaultMenuButtonTrigger;
        ItemsPanel = @DefaultMenuItemsPanel;
    }

    // ── ContextMenu: popup ───────────────────────────────────────────
    Template x:key="DefaultContextMenuPopup" [TargetType = ContextMenu]
    {
        MenuPopupHost x:name="PART_PopupHost"
        {
            ClickAwayScrim x:name="PART_Scrim"
            Border x:name="PART_PopupContainer"
                [ Fill = @Bg1,
                  Stroke = Pen [ Brush = @Border, Thickness = 1 ],
                  CornerRadius = @RadiusLg,
                  Effect = @ShadowMd,
                  Padding = (0,@Space1,0,@Space1) ]
            {
                ItemsPresenter
            }
        }
    }
    Style [TargetType = ContextMenu]
    {
        Template = @DefaultContextMenuPopup;
        ItemsPanel = @DefaultMenuItemsPanel;
    }

    // ── MenuSeparator ────────────────────────────────────────────────
    Style [TargetType = MenuSeparator]
    {
        Height = 9;
        MinWidth = 16;
        LineBrush = @Border;
    }

    // ── MenuItem: row (hover surface + dedicated selected layer) ──────
    Template x:key="DefaultMenuItemRow" [TargetType = MenuItem]
    {
        Border x:name="PART_Row" [ Fill = #00000000, CornerRadius = @RadiusMd ]
        {
            // PART_Selected carries the row padding so its @SurfaceSelected
            // fill spans the full row and survives a concurrent @Bg2 hover.
            Border x:name="PART_Selected"
                [ Fill = #00000000,
                  CornerRadius = @RadiusMd,
                  Padding = (@Space3,@Space2,@Space3,@Space2) ]
            {
                DockPanel [ LastChildFill = true ]
                {
                    Border x:name="PART_Icon"
                        [ DockPanel.Dock = Left,
                          Width = 24,
                          MinWidth = 24,
                          TextBlock.Foreground = @Fg2 ]
                    Shape x:name="PART_Chevron"
                        [ DockPanel.Dock = Right,
                          Geometry = @ChevronRight,
                          Fill = @Fg2,
                          Width = 5,
                          Height = 10,
                          VerticalAlignment = Center,
                          Visibility = Collapsed ]
                    TextBlock x:name="PART_Gesture"
                        [ DockPanel.Dock = Right,
                          Margin = (@Space4,0,@Space4,0),
                          Foreground = @Fg2,
                          Style = @UiCaption ]
                    TextBlock x:name="PART_Label"
                        [ Margin = (@Space2,0,@Space4,0),
                          MinWidth = 80,
                          Foreground = @Fg1,
                          Style = @UiLabel ]
                }
            }
        }
        when ( IsMouseOver ) { PART_Row.Fill = @Bg2; }
        when ( IsFocused ) { PART_Row.Fill = @Bg2; }
        when ( IsChecked ) { PART_Selected.Fill = @SurfaceSelected; }
        when ( IsSubmenuOpen ) { PART_Selected.Fill = @SurfaceSelected; }
        when ( IsEnabled = false ) { PART_Row.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Density = Compact ) { PART_Selected.Padding = (@Space2,@Space1,@Space2,@Space1); }
        when ( ThemeManager.Density = Comfortable ) { PART_Selected.Padding = (@Space3,@Space3,@Space3,@Space3); }
        when ( ThemeManager.Pointer = Coarse ) { PART_Selected.Padding = (@Space3,@Space3,@Space3,@Space3); }
    }

    // ── MenuItem: submenu popup ──────────────────────────────────────
    Template x:key="DefaultMenuItemSubmenu" [TargetType = MenuItem]
    {
        MenuPopupHost x:name="PART_PopupHost"
        {
            ClickAwayScrim x:name="PART_Scrim"
            Border x:name="PART_PopupContainer"
                [ Fill = @Bg1,
                  Stroke = Pen [ Brush = @Border, Thickness = 1 ],
                  CornerRadius = @RadiusLg,
                  Effect = @ShadowMd,
                  Padding = (0,@Space1,0,@Space1) ]
            {
                ItemsPresenter
            }
        }
    }
    Style [TargetType = MenuItem]
    {
        Template = @DefaultMenuItemSubmenu;
        ItemsPanel = @DefaultMenuItemsPanel;
        RowTemplate = @DefaultMenuItemRow;
    }

    // ── MenuStripItem: top-level stripped row ────────────────────────
    Template x:key="DefaultMenuStripItemRow" [TargetType = MenuItem]
    {
        Border x:name="PART_Row" [ Fill = #00000000, CornerRadius = @RadiusMd ]
        {
            Border x:name="PART_Selected"
                [ Fill = #00000000,
                  CornerRadius = @RadiusMd,
                  Padding = (@Space3,@Space1,@Space3,@Space1) ]
            {
                StackPanel [ Orientation = Horizontal ]
                {
                    Border x:name="PART_Icon" [ Width = 0, MinWidth = 0 ]
                    TextBlock x:name="PART_Label"
                        [ MinWidth = 0,
                          Foreground = @Fg1,
                          Style = @UiLabel ]
                    TextBlock x:name="PART_Gesture" [ Width = 0, Foreground = @Fg2 ]
                    Shape x:name="PART_Chevron" [ Geometry = @ChevronRight, Fill = @Fg2, Width = 0, Height = 10 ]
                }
            }
        }
        when ( IsMouseOver ) { PART_Row.Fill = @Bg2; }
        when ( IsFocused ) { PART_Row.Fill = @Bg2; }
        when ( IsSubmenuOpen ) { PART_Selected.Fill = @SurfaceSelected; }
        when ( IsEnabled = false ) { PART_Row.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Density = Compact ) { PART_Selected.Padding = (@Space3,0,@Space3,0); }
        when ( ThemeManager.Density = Comfortable ) { PART_Selected.Padding = (@Space3,@Space2,@Space3,@Space2); }
        when ( ThemeManager.Pointer = Coarse ) { PART_Selected.Padding = (@Space4,@Space3,@Space4,@Space3); }
    }
    Style x:key="MenuStripItemStyle" [TargetType = MenuItem]
    {
        RowTemplate = @DefaultMenuStripItemRow;
    }

    // ── MenuStrip ────────────────────────────────────────────────────
    Style [TargetType = MenuStrip]
    {
        Fill = @Bg2;
        Padding = (4,2,4,2);
        ItemsPanel = @DefaultMenuStripPanel;
        ItemContainerStyle = @MenuStripItemStyle;
    }
}
```

- [ ] **Step 4: Wire the import** — add after `PragmaticNotifications`:

```
    import PragmaticMenus from "../../framework/pragmatic/menu/menu.template.mu.js"
```

- [ ] **Step 5: Build + run, verify pass.**
- [ ] **Step 6: Commit**

```bash
git add src/framework/pragmatic/menu/menu.template.mu src/resources/pragmatic/controls.resources.mu src/resources/pragmatic/tests/controls-menu.test.ts
git commit -m "feat(pragmatic): fork menu family onto Pragmatic (Wave 3 Task 9)"
```

---

## Task 10: SplitButton

New `split-button.template.mu` + import. **Review Focus (disabled capsule):** `IsEnabled = false` dims BOTH halves. Primary/trigger fills follow the FAB precedent (`@ActionPrimary` + hover/press ramp, constant shadow); popup is the canonical popover.

**Files:**
- Create: `src/framework/pragmatic/button-groups/split-button.template.mu`
- Modify: `src/resources/pragmatic/controls.resources.mu` (add `PragmaticSplitButton` import)
- Test: `src/resources/pragmatic/tests/controls-splitbutton.test.ts`

**Interfaces:** Consumes `SplitButton` from `../../../framework/button-groups/split-button.js`; `Border`; `ControlHarness`; schemes.

- [ ] **Step 1: Write the failing test** — `controls-splitbutton.test.ts`

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { SplitButton } from '../../../framework/button-groups/split-button.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic SplitButton', () =>
{
    test('resolves the Pragmatic style; Material unaffected', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.ok(ControlHarness.IsPragmaticStyle(new SplitButton()), 'SplitButton uses the Pragmatic style');
        ControlHarness.Reset();
        ControlHarness.Activate(MaterialLight);
        assert.ok(!ControlHarness.IsPragmaticStyle(new SplitButton()), 'Material SplitButton keeps the Material style');
        ControlHarness.Reset();
    });

    test('both halves fill @ActionPrimary at rest', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const sb = new SplitButton();
        const primary = sb.GetTemplateChild('PART_PrimaryButton') as Border;
        const trigger = sb.GetTemplateChild('PART_TriggerButton') as Border;
        assert.equal((primary.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('ActionPrimary'), 'primary half fills @ActionPrimary');
        assert.equal((trigger.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('ActionPrimary'), 'trigger half fills @ActionPrimary');
        ControlHarness.Reset();
    });

    test('primary half hover ramps to @ActionPrimaryHover', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const sb = new SplitButton();
        const primary = sb.GetTemplateChild('PART_PrimaryButton') as Border;
        primary._setIsMouseOver(true);
        assert.equal((primary.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('ActionPrimaryHover'), 'hovered primary ramps @ActionPrimaryHover');
        ControlHarness.Reset();
    });

    test('disabled dims BOTH halves (Review Focus: whole capsule greys)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const sb = new SplitButton();
        sb.IsEnabled = false;
        const primary = sb.GetTemplateChild('PART_PrimaryButton') as Border;
        const trigger = sb.GetTemplateChild('PART_TriggerButton') as Border;
        assert.ok(primary.Opacity < 1, 'primary half dims when disabled');
        assert.ok(trigger.Opacity < 1, 'trigger half dims when disabled');
        ControlHarness.Reset();
    });

    test('resolves under dark', () =>
    {
        ControlHarness.Activate(PragmaticDark);
        assert.ok(ControlHarness.IsPragmaticStyle(new SplitButton()), 'SplitButton dark');
        ControlHarness.Reset();
    });
});
```

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Create the fork** — `src/framework/pragmatic/button-groups/split-button.template.mu`

```
// Pragmatic theme — SplitButton (Wave 3).
//
// Primary action + chevron menu trigger sharing one accent capsule. Both
// halves fill @ActionPrimary and ramp @ActionPrimaryHover / @ActionPrimaryPress
// per element-scoped state triggers (FAB precedent — no translucent overlays,
// shadow would be constant if present). The seam between halves is a 1dp
// @ActionPrimaryPress hairline (a darker accent reads as a divider). Chevron
// ink @FgOnAccent. Left half rounds @RadiusMd on the left, right half on the
// right. Popup = canonical Pragmatic popover. Disabled dims BOTH halves.
//
// SegmentedButton is forked separately (segmented-button.template.mu).
// Pragmatic tokens only (+ shared geometry @ChevronDown). Merged via
// PragmaticControls.

resources PragmaticSplitButton
{
    Template x:key="DefaultSplitButton" [TargetType = SplitButton]
    {
        StackPanel [ Orientation = Horizontal ]
        {
            Border x:name="PART_PrimaryButton"
                [ Fill = @ActionPrimary,
                  CornerRadius = (@RadiusMd,0,0,@RadiusMd),
                  Padding = (@Space4,@Space2,@Space4,@Space2) ]
            {
                ContentPresenter [ HorizontalAlignment = Center, VerticalAlignment = Center ]
            }
            Line [ Orientation = Vertical, Stroke = Pen [ Brush = @ActionPrimaryPress, Thickness = 1 ] ]
            Border x:name="PART_TriggerButton"
                [ Fill = @ActionPrimary,
                  CornerRadius = (0,@RadiusMd,@RadiusMd,0),
                  Padding = (@Space2,@Space2,@Space2,@Space2) ]
            {
                Shape
                    [ Geometry = @ChevronDown,
                      Fill = @FgOnAccent,
                      Width = 14,
                      Height = 14,
                      HorizontalAlignment = Center,
                      VerticalAlignment = Center ]
            }
        }
        when ( PART_PrimaryButton.IsMouseOver ) { PART_PrimaryButton.Fill = @ActionPrimaryHover; }
        when ( PART_PrimaryButton.IsPressed ) { PART_PrimaryButton.Fill = @ActionPrimaryPress; }
        when ( PART_TriggerButton.IsMouseOver ) { PART_TriggerButton.Fill = @ActionPrimaryHover; }
        when ( PART_TriggerButton.IsPressed ) { PART_TriggerButton.Fill = @ActionPrimaryPress; }
        when ( IsEnabled = false )
        {
            PART_PrimaryButton.Opacity = @OpacityDisabled;
            PART_TriggerButton.Opacity = @OpacityDisabled;
        }
        when ( ThemeManager.Density = Compact )
        {
            PART_PrimaryButton.Padding = (@Space3,@Space1,@Space3,@Space1);
            PART_TriggerButton.Padding = (@Space1,@Space1,@Space1,@Space1);
        }
        when ( ThemeManager.Density = Comfortable )
        {
            PART_PrimaryButton.Padding = (@Space5,@Space3,@Space5,@Space3);
            PART_TriggerButton.Padding = (@Space3,@Space3,@Space3,@Space3);
        }
        when ( ThemeManager.Pointer = Coarse )
        {
            PART_PrimaryButton.Padding = (@Space4,@Space3,@Space4,@Space3);
            PART_TriggerButton.Padding = (@Space2,@Space3,@Space2,@Space3);
        }
    }
    Template x:key="DefaultSplitButtonPopup" [TargetType = SplitButton]
    {
        MenuPopupHost x:name="PART_PopupHost"
        {
            ClickAwayScrim x:name="PART_Scrim"
            Border x:name="PART_PopupBody"
                [ Fill = @Bg1,
                  Stroke = Pen [ Brush = @Border, Thickness = 1 ],
                  CornerRadius = @RadiusLg,
                  Effect = @ShadowMd,
                  Padding = (@Space1,@Space1,@Space1,@Space1) ]
        }
    }
    Style [TargetType = SplitButton]
    {
        Template = @DefaultSplitButton;
        PopupTemplate = @DefaultSplitButtonPopup;
        Foreground = @FgOnAccent;
        FontFamily = @FontSans;
        FontWeight = @UiLabelWeight;
        FontSize = @UiLabelSize;
        LineHeight = @UiLabelLineHeight;
        LetterSpacing = @UiLabelTracking;
        MeasurementFidelity = Exact;
    }
}
```

- [ ] **Step 4: Wire the import** — add after `PragmaticMenus`:

```
    import PragmaticSplitButton from "../../framework/pragmatic/button-groups/split-button.template.mu.js"
```

- [ ] **Step 5: Build + run, verify pass.**
- [ ] **Step 6: Commit**

```bash
git add src/framework/pragmatic/button-groups/split-button.template.mu src/resources/pragmatic/controls.resources.mu src/resources/pragmatic/tests/controls-splitbutton.test.ts
git commit -m "feat(pragmatic): fork SplitButton onto Pragmatic (Wave 3 Task 10)"
```

---

## Task 11: Wave-3 integration sweep

A verification-only task (no new fork) that proves the whole wave composes and Material stays byte-identical.

**Files:**
- Test: `src/resources/pragmatic/tests/controls-wave3-integration.test.ts`

**Interfaces:** Consumes every Wave-3 control class + `ControlHarness` + schemes.

- [ ] **Step 1: Write the test** — `controls-wave3-integration.test.ts`: for each forked control (`Card`, `Dialog`, `Drawer`, `BottomSheet`, `SideSheet`, `Tooltip`, `ProgressIndicator`, `LoadingIndicator`, `Banner`, `Snackbar`, `MenuItem`, `MenuStrip`, `MenuButton`, `ContextMenu`, `SplitButton`), assert `IsPragmaticStyle(new X())` is true under `PragmaticLight` AND `PragmaticDark`, and false under `MaterialLight`. One `describe`, table-driven via a `static readonly` array of `{ make, name }` on a small `Wave3Controls` helper class in the test file (OOP house rule — no module-level array of free constructors; wrap the factories as static members). Example shape:

```ts
class Wave3Controls
{
    public static readonly All: ReadonlyArray<{ readonly Name: string; readonly Make: () => object }> =
    [
        { Name: 'Card', Make: () => new Card() },
        // …one entry per forked control…
    ];
}
```

- [ ] **Step 2: Run it, verify it passes** (all forks already landed in Tasks 1–10). Expected: PASS. If any control is false-under-Pragmatic or true-under-Material, that is a real defect in the owning task — fix there via TDD, do not paper over it here.

- [ ] **Step 3: Run the full suite + typecheck** — `npm test` then `npm run typecheck`. Expected: green suite (no regressions vs. the Wave-2 baseline of 5283 tests) and 0 typecheck errors.

- [ ] **Step 4: Commit**

```bash
git add src/resources/pragmatic/tests/controls-wave3-integration.test.ts
git commit -m "test(pragmatic): Wave 3 integration sweep — all overlay/surface forks resolve, Material byte-identical (Task 11)"
```

---

## Self-review checklist (run before handoff)

1. **Spec coverage:** every Wave-3 family in the recon (Card, Dialog, Drawer, BottomSheet, SideSheet, Tooltip, ProgressIndicator, LoadingIndicator, Banner, Snackbar, Menu family, SplitButton) has an owning task; FAB is explicitly skipped (Wave 1). ✎ Confirmed.
2. **No placeholders:** every implementation step carries the actual `.mu` fork; every test step the actual test. ✎ Confirmed.
3. **Type consistency:** import lines added in Tasks 1/4/6/9/10 match the file paths in File Structure; `PragmaticSurfaces`/`PragmaticNotifications` dicts created before they are appended; PART names copied from the Material sources verbatim. ✎ Confirmed.
4. **Review Focus:** scrim backdrop (T2), animation preservation (T6), checked-over-hover (T9), inverse legibility (T4/T8), disabled capsule (T10) — each has a pinned test. ✎ Confirmed.

## Open questions / rulings for the executor

- **Overlay-control headless construction.** Dialog/Drawer/SideSheet/Snackbar/MenuButton/ContextMenu/SplitButton may not fully apply their template on a bare `new X()` if they defer chrome to an overlay mount. Each task's test note gives the fallback (IsPragmaticStyle + `TokenCss` proxy, or the control's own test-construction idiom); the executor picks whichever the RED run shows works and records a `Ruling:`. The load-bearing assertion per task is called out in its note.
- **`@Scrim` CSS form.** The Task-2 test hard-codes `rgba(10,10,11,0.4)` for `#0A0A0B66`; if `TokenCss` emits an equivalent form, adjust to the RED output and ledger the `Ruling:`.
- **Density literal near 20/28dp.** Pragmatic's `@Space` scale jumps 16→24→32, so Material's 20/28dp density steps map to the nearest Pragmatic step (`@Space4`/`@Space5`/`@Space6`), not a literal. This is intentional (Pragmatic grid, not Material parity).
- **Deferred wave-wide (carry to memory, do not implement here):** pressed-state surface cue for surfaces/menu rows; `PrefersContrast` popover outlines (a11y pass); any hover-elevation bump (Pragmatic keeps shadow constant by design).
