# Pragmatic Theme — Wave 5 (Complex & App-Specific) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native inline — the chosen method) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork the remaining "Complex & app-specific" control families onto the Pragmatic theme so every Mural control resolves Pragmatic chrome — Ribbon, Pickers, Carousel, ThemeSelector, the formatting editors, and diagram chrome — plus verify the token-clean families (PropertyGrid, Gallery).

**Architecture:** Same override-dictionary fork as Waves 1–4: `src/framework/pragmatic/<family>/<file>.template.mu` holds a `resources <Name>` block that is imported into `src/resources/pragmatic/controls.resources.mu` (the `PragmaticControls` dict, merged AFTER Material so last-merged-wins on both key-less `Style[TargetType=X]` and keyed `x:key` resources). Un-forked controls fall back to Material. Two families need code-level work beyond templates: the formatting editors (ColorPicker resolves theme colours by string in `color-picker.ts`) and diagram chrome (the bulk of colour is painted in TS via `DiagramSettings.THEME_LINK`, which resolves M3 token names by string). Both are handled the Wave-2 way — theme-agnostic semantic aliases added to every scheme file, with the `.ts` switched to resolve the agnostic key.

**Tech Stack:** TypeScript, Mural `.mu` templates (compiled via `npm run build:templates`), node:test via `npx tsx --conditions=development --test --test-force-exit <file>`, `npm test` (full suite ~2min), `npm run typecheck`.

**Spec:** `docs/superpowers/specs/2026-09-27-pragmatic-theme-design.md` (section 5 "Complex & app-specific"; Runtime section on ThemeSelector Custom-seed retirement).

**Research inventories (exact per-site detail, produced for this plan):**
- `<scratchpad>/wave5-research-ribbon.md`
- `<scratchpad>/wave5-research-formatting.md`
- `<scratchpad>/wave5-research-pickers-carousel-themesel.md`
- `<scratchpad>/wave5-research-diagram-propgrid-gallery.md`

## Global Constraints

- **House rules (CLAUDE.md):** Allman braces in `.ts`; OOP only (NO module-level free functions/vars — test helpers are static members of a class); NO inline reused/user-facing string literals (→ `private static readonly` PascalCase constants); PascalCase public methods+interfaces; VMs extend Observable; tests in a `tests/` subfolder.
- **Import identity:** each `.mu` import in `controls.resources.mu` MUST exactly equal the fork's `resources <Name>` block name. Append imports in task order.
- **Material stays byte-identical** except where a task explicitly adds a theme-agnostic alias to Material's scheme files (alias value = the existing Material token, so visual output is unchanged) or edits shared TS (`color-picker.ts`, `diagram-settings.ts`) — those are cross-theme changes, not Material re-styling.
- **LOCKED token map (Waves 1–4 + Wave-5 resolutions):**
  - Surfaces: `@Surface`→`@Bg1`; `@SurfaceContainer`/`@SurfaceContainerHigh`→`@Bg2`; `@SurfaceContainerHighest`→`@Bg1`; `@SurfaceContainerLow(est)`→`@Bg2`.
  - Ink: `@OnSurface`→`@Fg1`; `@OnSurfaceVariant`→`@Fg2`.
  - Lines: `@Outline`→`@BorderStrong`; `@OutlineVariant`→`@Border`; every oriented `Line`/stroke uses `Stroke = Pen [ Brush = @Token, Thickness = N ]`.
  - Accent/selection: `@Primary`→`@ControlAccent` (accent line/glyph/ring) or `@SurfaceSelected` (checked/selected FILL — judge by usage); `@OnPrimary`/`@OnSecondaryContainer`→`@BrandGreenInk`; `@SecondaryContainer`/`@PrimaryContainer`→`@SurfaceSelected`.
  - Radius: `@ShapeExtraSmall`→`@RadiusSm` (or `@RadiusLg` for a popover); `@ShapeSmall`→`@RadiusMd`; `@ShapeMedium`→`@RadiusLg`; `@ShapeLarge`→`@RadiusXl`; `@ShapeFull`→`@RadiusPill`.
  - Elevation: `@Elevation2`/`@ElevationLevel2`→`@ShadowMd` (popovers/menus) else flat.
  - **Typography (LOCKED, precedent-consistent — verified against shipped buttons/tabs forks):** `@DisplayLarge`→`@Display1`, `@DisplayMedium`→`@Display2`; `@HeadlineMedium`→`@H2`, `@HeadlineSmall`→`@H3`; `@TitleLarge`/`@TitleMedium`→`@H4`; `@TitleSmall`→`@UiLabel`; `@LabelLarge`→`@UiLabel`; `@LabelMedium`→`@UiCaption`; `@LabelSmall`→`@UiCaption`; `@BodyLarge`/`@BodyMedium`→`@Body`; `@BodySmall`→`@BodySm`. Each maps as BOTH the bundled `Style = @X` and the atom quartet `{Weight,Size,LineHeight,Tracking}` (e.g. `@LabelSmallSize`→`@UiCaptionSize`). `@TypefaceWeightMedium`→`@WeightMedium`.
  - Misc: `@DisabledContentOpacity`→`@OpacityDisabled`; `@Spacing0`→`0`, `@Spacing1..7`→`@Space1..@Space7`; `@DiagramCanvas`→`@CanvasBg`.
  - Popover recipe (canonical): `Fill = @Bg1` + `Stroke = Pen [ Brush = @Border, Thickness = 1 ]` + `CornerRadius = @RadiusLg` + `Effect = @ShadowMd`.
  - Hover/press state layers → step the opaque surface (`@Bg1`→`@Bg2`→`@Bg3`); NO translucent overlay.
- **Wave-wide rulings (carry forward):** PrefersContrast triggers DROPPED; pressed-state cue deferred (except a control whose Material template already has an intrinsic press affordance carried verbatim); selected-over-hover needs a dedicated z-order layer above the hover surface (last-event-wins triggers).
- **Test idiom:** each control gets `IsPragmaticStyle` yes under `PragmaticLight`+`PragmaticDark`, no under `MaterialLight`; a signature token/fill assertion via `GetTemplateChild('PART_x')` where reachable (Wave-5 research confirms nearly every Wave-5 control calls `applyDefaultStyle()` in its ctor and is headless-reachable), else a `TokenCss` proxy with a ledgered Ruling. Assert `!svg.includes(ControlHarness.NeutralFallbackCss)` where a render is available.

## Review Focus

- **Ribbon selected/active tab + hovered.** The active `RibbonTab` header and any checked `RibbonToggleButton` must keep their selected cue under a concurrent hover (dedicated z-order layer, not a shared-element trigger). → Task 2.
- **Picker "today"/selected day/time cell.** The selected calendar day and selected time cell must paint `@SurfaceSelected`/`@ControlAccent` and stay legible; the docked body must resolve with no grey. → Task 3.
- **ColorPicker selected-swatch ring + scheme-row hover (code-level).** The selected swatch ring resolves `AccentInk` (=`@ControlAccent` under Pragmatic, not the Material `Primary`) and the color-scheme row hover resolves `RowHoverFill` (=`@Bg2`), not a missing M3 key that renders transparent/grey. → Tasks 6–7.
- **FillEditor nested-NameScope body.** FillEditor's body-template parts live in a separate NameScope reached via `root.FindName`, not the outer control's `GetTemplateChild` — the test must reach them the same way. → Task 8.
- **Diagram theme-tracking chrome (code-level).** Shape-label ink, connector stroke, ruler fill/tick, container wash and layout-preview colours (painted in TS via `DiagramSettings`) must track the Pragmatic scheme, not fall back to the fixed compiled default — i.e. `THEME_LINK` must resolve theme-agnostic keys both schemes define. → Task 9.

## File Structure

New fork templates (each with one import line added to `controls.resources.mu`) + one test file per family in `src/resources/pragmatic/tests/`:

- `src/framework/pragmatic/ribbon/ribbon.template.mu` → `resources PragmaticRibbon`. **Task 2.**
- `src/framework/pragmatic/pickers/pickers.template.mu` → `resources PragmaticPickers`. **Task 3.**
- `src/framework/pragmatic/carousel/carousel.template.mu` → `resources PragmaticCarousel`. **Task 4.**
- `src/framework/pragmatic/theme-selector/theme-selector.template.mu` → `resources PragmaticThemeSelector`. **Task 5.**
- `src/framework/pragmatic/formatting/formatting.template.mu` → `resources PragmaticFormatting` (all 5 editors in one block, built across Tasks 7–8). **Tasks 7–8.**
- `src/framework/pragmatic/diagram/diagram.template.mu` → `resources PragmaticDiagram` (diagram + caps touch-points). **Task 10.**
- Scheme-file edits (Task 1, Task 9): `src/resources/pragmatic/{light,dark}.mu` and `src/resources/material/{light,dark}.mu` (agnostic aliases) — no new fork.
- Shared TS edits: `src/framework/formatting/color-picker.ts` (Task 6), `src/framework/diagram/diagram-settings.ts` (Task 9).
- Tests: `controls-ribbon.test.ts`, `controls-pickers.test.ts`, `controls-carousel.test.ts`, `controls-themeselector.test.ts`, `controls-formatting.test.ts`, `controls-diagram-chrome.test.ts`, `controls-wave5-integration.test.ts`.

Import block additions (add each in its task, in order): `PragmaticRibbon`, `PragmaticPickers`, `PragmaticCarousel`, `PragmaticThemeSelector`, `PragmaticFormatting`, `PragmaticDiagram`.

---

### Task 1: Shared semantic aliases (scheme files)

**Files:** Modify `src/resources/pragmatic/light.mu`, `src/resources/pragmatic/dark.mu`, `src/resources/material/light.mu`, `src/resources/material/dark.mu`; the conformance/alias sync test (`src/basic/tests/theme.test.ts` or the scheme conformance test). Test: extend the existing alias-sync test.

Add three theme-agnostic aliases to every scheme file, following the existing `@Ink`/`@AccentInk`/`@ControlTrack`/`@ControlActive` alias convention (literal copy of the scheme's own backing token; kept in sync by test, not live reference):
- `@RowHoverFill` — Material = `@StateHoverOverlay`; Pragmatic = `@Bg2`. (Menu/scheme-row hover — used by `color-picker.ts` Task 6.)
- `@InkVariant` — Material = `@OnSurfaceVariant`; Pragmatic = `@Fg2`. (Diagram ruler tick / connector stroke — Task 9.)
- `@SurfaceBg` — Material = `@Surface`; Pragmatic = `@Bg1`. (Diagram ruler/backdrop fill — Task 9.)

`@Ink` (=`@OnSurface`/`@Fg1`) and `@AccentInk` (=`@Primary`/`@ControlAccent`) already exist in every scheme — reuse them, do not redefine.

- [ ] **Step 1:** Failing test — extend the alias-sync test to assert each scheme defines `@RowHoverFill`/`@InkVariant`/`@SurfaceBg` equal to its backing token.
- [ ] **Step 2:** Run, verify RED (keys absent).
- [ ] **Step 3:** Add the three aliases to all four scheme files (Pragmatic values `@Bg2`/`@Fg2`/`@Bg1`; Material values = the M3 tokens).
- [ ] **Step 4:** Build + run GREEN; full conformance test green.
- [ ] **Step 5:** Commit `feat(pragmatic): add RowHoverFill/InkVariant/SurfaceBg semantic aliases (Wave 5 Task 1)`.

---

### Task 2: Ribbon fork

**Files:** Create `src/framework/pragmatic/ribbon/ribbon.template.mu` (`resources PragmaticRibbon`); modify `controls.resources.mu`; test `controls-ribbon.test.ts`. Consumes: Ribbon, RibbonButton, RibbonToggleButton, RibbonDropDownButton, RibbonSplitButton, RibbonGroup, RibbonSmallButtonColumn, RibbonTab, RibbonGallery, RibbonQuickAccessToolBar (exact classes/paths per `wave5-research-ribbon.md`). `RibbonContextualGroup`/`RibbonGalleryPopupList` render nothing → no fork.

Transcribe Material's `src/framework/ribbon/ribbon.template.mu` into `resources PragmaticRibbon`, applying the LOCKED token map at every site (~70). Typography per the locked split (`@LabelSmall*`→`@UiCaption*`, `@TitleSmall*`→`@UiLabel*`). Ribbon dropdown/gallery popups use the canonical popover recipe. **Delta:** the active `RibbonTab` header selected cue and any `RibbonToggleButton` checked cue must sit on a dedicated z-order layer so they survive hover (add a `PART_Selected`-style layer if Material used a shared-element trigger).

- [ ] **Step 1:** Failing test — IsPragmaticStyle (light+dark yes / Material no) for each forkable class; signature-surface assertion for RibbonButton (`PART_Border`/state), RibbonTab header selected+hover keeps `@SurfaceSelected`, and no-grey render.
- [ ] **Step 2:** Run, verify RED.
- [ ] **Step 3:** Create the fork per the substitutions + selected-layer delta.
- [ ] **Step 4:** Wire import `PragmaticRibbon`.
- [ ] **Step 5:** Build + run GREEN.
- [ ] **Step 6:** Commit `feat(pragmatic): fork Ribbon family onto Pragmatic (Wave 5 Task 2)`.

---

### Task 3: Pickers fork (DatePicker, TimePicker)

**Files:** Create `src/framework/pragmatic/pickers/pickers.template.mu` (`resources PragmaticPickers`); modify `controls.resources.mu`; test `controls-pickers.test.ts`. Both call `applyDefaultStyle()` → headless-reachable; both ship only the M3 "Docked" inline body (no popup).

Transcribe Material's `pickers.template.mu`, applying the token map (~32 sites). Resolutions: `@ShapeMedium`→`@RadiusLg` (root), `@ShapeFull`→`@RadiusPill` (TimePicker clock face), `@LabelSmall`→`@UiCaption` (weekday header), `@LabelLarge`→`@UiLabel` (AM/PM). Selected day/time cell fill → `@SurfaceSelected` (or `@ControlAccent` where Material used a filled `@Primary` circle — judge per site); today marker accent → `@ControlAccent`.

- [ ] **Step 1:** Failing test — IsPragmaticStyle both controls; selected-day/selected-time-cell fill assertion; no-grey render of the docked body.
- [ ] **Step 2:** RED.
- [ ] **Step 3:** Create fork.
- [ ] **Step 4:** Wire import `PragmaticPickers`.
- [ ] **Step 5:** Build + GREEN.
- [ ] **Step 6:** Commit `feat(pragmatic): fork DatePicker/TimePicker onto Pragmatic (Wave 5 Task 3)`.

---

### Task 4: Carousel fork

**Files:** Create `src/framework/pragmatic/carousel/carousel.template.mu` (`resources PragmaticCarousel`); modify `controls.resources.mu`; test `controls-carousel.test.ts`. Only ~3 token sites (indicator dots / nav affordances).

Transcribe + map: indicator active dot → `@ControlAccent`, inactive → `@Border`/`@Fg2`; any surface → `@Bg1`.

- [ ] **Step 1:** Failing test — IsPragmaticStyle; active-indicator fill assertion; no-grey.
- [ ] **Step 2:** RED. **Step 3:** Fork. **Step 4:** Wire `PragmaticCarousel`. **Step 5:** GREEN. **Step 6:** Commit `feat(pragmatic): fork Carousel onto Pragmatic (Wave 5 Task 4)`.

---

### Task 5: ThemeSelector fork (retokenize)

**Files:** Create `src/framework/pragmatic/theme-selector/theme-selector.template.mu` (`resources PragmaticThemeSelector`); modify `controls.resources.mu`; test `controls-themeselector.test.ts`. ~8 token sites; calls `applyDefaultStyle()`.

Transcribe + map (icon glyphs `@LabelLarge`→`@UiLabel`; surfaces/ink per map). ThemeSelector's ComboBoxes inherit the Wave-2 ComboBox fork.

**Ruling (record in ledger, do NOT silently delete):** the spec's Runtime section calls to RETIRE the "Custom…" seed option + `makeDynamicScheme`/`makeDynamicLightDarkPair`. That is a `.ts` feature removal (decoupled from the template per research), outward-facing, and belongs to the app-migration phase — this task ONLY retokenizes the template. Flag the retirement as a deferred, user-facing decision in the final handoff.

- [ ] **Step 1:** Failing test — IsPragmaticStyle; icon/surface token assertion; no-grey.
- [ ] **Step 2:** RED. **Step 3:** Fork. **Step 4:** Wire `PragmaticThemeSelector`. **Step 5:** GREEN. **Step 6:** Commit `feat(pragmatic): fork ThemeSelector onto Pragmatic (Wave 5 Task 5)`.

---

### Task 6: Formatting foundation — ColorPicker code-level tokens

**Files:** Modify `src/framework/formatting/color-picker.ts`; test (add to `controls-formatting.test.ts` or a focused test). Depends on Task 1 aliases.

Two string-resolved M3 tokens under Pragmatic resolve nothing today:
- Line ~147: `Resources.Resolve('Primary')` (selected-swatch ring accent) → change to `Resources.Resolve('AccentInk')` (exists in both schemes; =`@ControlAccent` Pragmatic).
- Line ~733: `Resources.Resolve('StateHoverOverlay')` (color-scheme row hover) → change to `Resources.Resolve('RowHoverFill')` (Task 1 alias; =`@Bg2` Pragmatic).
Keep the existing `?? fallback` guards. Hoist the two key strings to `private static readonly` constants (house rule).

- [ ] **Step 1:** Failing test — under PragmaticLight, assert the ColorPicker selected-swatch ring brush resolves to `@ControlAccent` and the scheme-row hover brush resolves to `@Bg2` (drive via the ColorPicker's public open/select path or the resolver helper; if the swatch/row is only reachable when the popup is open, open it in the test — research notes the popup mounts as an overlay child while open).
- [ ] **Step 2:** RED (resolves to fallback, not the Pragmatic token).
- [ ] **Step 3:** Switch the two resolves to the agnostic keys + hoist constants.
- [ ] **Step 4:** Build + GREEN; Material path still resolves its values (AccentInk=@Primary, RowHoverFill=@StateHoverOverlay).
- [ ] **Step 5:** Commit `feat(pragmatic): resolve ColorPicker accent/hover via theme-agnostic keys (Wave 5 Task 6)`.

---

### Task 7: Formatting templates A — ColorPicker + BrushPicker

**Files:** Create `src/framework/pragmatic/formatting/formatting.template.mu` (`resources PragmaticFormatting` — start the block here; Task 8 extends it); modify `controls.resources.mu`; extend `controls-formatting.test.ts`. Both call `applyDefaultStyle()`.

Transcribe the ColorPicker + BrushPicker Styles/keyed templates from Material's `formatting.template.mu` into `PragmaticFormatting`, applying the LOCKED map (typography `@LabelSmall*`→`@UiCaption*`, `@BodySmall*`→`@BodySm*`; state layers → stepped surface; popups → canonical popover). Raw hex palette swatch values are DATA — leave them. ColorPicker/BrushPicker popups mount as overlay children only when open.

- [ ] **Step 1:** Failing test — IsPragmaticStyle both; a signature surface/ink assertion each; no-grey.
- [ ] **Step 2:** RED. **Step 3:** Create the block with the two controls. **Step 4:** Wire import `PragmaticFormatting`. **Step 5:** Build + GREEN. **Step 6:** Commit `feat(pragmatic): fork ColorPicker/BrushPicker onto Pragmatic (Wave 5 Task 7)`.

---

### Task 8: Formatting templates B — FillEditor + PenEditor + ShapeFormatControl

**Files:** Extend `src/framework/pragmatic/formatting/formatting.template.mu` (same `PragmaticFormatting` block); extend `controls-formatting.test.ts`. All call `applyDefaultStyle()`. **FillEditor's body-template parts live in a separate NameScope — reach them via `root.FindName`, not the outer `GetTemplateChild`** (mirror the research note in the test).

Transcribe the three remaining editors, applying the LOCKED map. No new import (same block).

- [ ] **Step 1:** Failing test — IsPragmaticStyle each; FillEditor body-part assertion via `root.FindName`; PenEditor + ShapeFormatControl signature assertions; no-grey.
- [ ] **Step 2:** RED. **Step 3:** Extend the block. **Step 4:** Build + GREEN. **Step 5:** Commit `feat(pragmatic): fork FillEditor/PenEditor/ShapeFormatControl onto Pragmatic (Wave 5 Task 8)`.

---

### Task 9: Diagram TS — THEME_LINK → theme-agnostic keys

**Files:** Modify `src/framework/diagram/diagram-settings.ts` (the `THEME_LINK` map); test `controls-diagram-chrome.test.ts`. Depends on Task 1 (`@InkVariant`, `@SurfaceBg`) + existing `@Ink`/`@AccentInk`.

`THEME_LINK` maps 9 diagram-chrome keys to M3 token strings resolved via `themeBrush(token)` = `Application.current.Resources.Resolve(token)`. Under Pragmatic those M3 names don't exist → fixed fallback. Repoint each to an agnostic key both schemes define:
- `'OnSurface'`→`'Ink'`; `'OnSurfaceVariant'`→`'InkVariant'`; `'Surface'`→`'SurfaceBg'`; `'Primary'`→`'AccentInk'` (alpha values unchanged).

- [ ] **Step 1:** Failing test — under PragmaticLight, assert `DiagramSettings` resolves ShapeLabelInk to `@Fg1`, ConnectorDefaultStroke to `@Fg2`, RulerFill to `@Bg1`, and a `Primary`-linked key (e.g. ChromeLayoutPreviewStroke) to `@ControlAccent` — i.e. theme-tracking, not the compiled fallback. Assert the Material path still resolves the same values it did before (via `Ink`=@OnSurface etc.).
- [ ] **Step 2:** RED (Pragmatic resolves fallback today).
- [ ] **Step 3:** Repoint the four token strings in `THEME_LINK`.
- [ ] **Step 4:** Build + GREEN; confirm no diagram consumer regressed (full suite in Task 12).
- [ ] **Step 5:** Commit `feat(pragmatic): theme-link diagram chrome via agnostic keys (Wave 5 Task 9)`.

---

### Task 10: Diagram template fork (diagram + caps touch-points)

**Files:** Create `src/framework/pragmatic/diagram/diagram.template.mu` (`resources PragmaticDiagram`); modify `controls.resources.mu`; extend `controls-diagram-chrome.test.ts`. Covers the ~10 template touch-points in `diagram.template.mu` + `caps/caps.template.mu`: drop-candidate tint, editing/selection strokes, canvas-bg (`@DiagramCanvas`→`@CanvasBg`), inspector-rail tokens, `@BodySmall`→`@BodySm` (Size/Position inspector page).

Transcribe the token-driven parts of both diagram templates into `PragmaticDiagram`, applying the map. TS-painted colours are handled by Task 9, not here.

- [ ] **Step 1:** Failing test — the diagram control(s) with template chrome resolve IsPragmaticStyle / the forked keyed templates resolve; canvas-bg / editing-stroke token assertion where reachable; no-grey. (Use TokenCss proxy + a ledgered Ruling for any surface not reachable headless.)
- [ ] **Step 2:** RED. **Step 3:** Create the fork. **Step 4:** Wire import `PragmaticDiagram`. **Step 5:** Build + GREEN. **Step 6:** Commit `feat(pragmatic): fork diagram chrome template onto Pragmatic (Wave 5 Task 10)`.

---

### Task 11: PropertyGrid + Gallery resolution verification (no fork)

**Files:** Test only — extend `controls-wave5-integration.test.ts` (or a focused test). Research confirms PropertyGrid's template is token-clean (zero `@` refs) and Gallery has no template (renders via already-forked MenuItem/Button). Neither needs a fork — assert they resolve without grey and (PropertyGrid) IsPragmaticStyle.

- [ ] **Step 1:** Test — PropertyGrid IsPragmaticStyle (light+dark) and no-grey render; Gallery renders with no grey (its item containers resolve Pragmatic). If PropertyGrid genuinely has no `Style[TargetType]` (pure layout), assert it renders no `#808080` and any child control it hosts resolves Pragmatic — ledger a Ruling on the chosen gate.
- [ ] **Step 2:** Run, verify PASS (both already resolve). If RED (an unexpected M3 leak), that is a real finding — fork the minimum needed and ledger it.
- [ ] **Step 3:** Commit `test(pragmatic): verify PropertyGrid/Gallery resolve Pragmatic without a fork (Wave 5 Task 11)`.

---

### Task 12: Wave-5 integration sweep + full suite + typecheck

**Files:** Test `src/resources/pragmatic/tests/controls-wave5-integration.test.ts` (mirror the Wave-4 sweep's `Wave*Controls` static-class table).

- [ ] **Step 1:** Table-driven test (`Wave5Controls` class, `static readonly All` array of `{ Name, Make }`) asserting IsPragmaticStyle true under `PragmaticLight`+`PragmaticDark`, false under `MaterialLight` for every Wave-5 forked control (Ribbon family, DatePicker, TimePicker, Carousel, ThemeSelector, ColorPicker, BrushPicker, FillEditor, PenEditor, ShapeFormatControl, PropertyGrid, and the forked diagram control(s)). Skip (with a documented Ruling) any control whose bare construction throws or that has no `Style[TargetType]`.
- [ ] **Step 2:** Run, verify PASS.
- [ ] **Step 3:** Full suite (`npm test`) + `npm run typecheck`. Expected: green, no regression vs the Wave-4 baseline (5429 tests), 0 typecheck errors.
- [ ] **Step 4:** Commit `test(pragmatic): Wave 5 integration sweep — complex/app-specific forks resolve (Task 12)`.

---

## Self-Review

1. **Spec coverage:** section 5 lists Ribbon (Task 2), PropertyGrid (Task 11), DatePicker/TimePicker (Task 3), the formatting editors ColorPicker/BrushPicker/FillEditor/PenEditor/ShapeFormatControl (Tasks 6–8), Carousel (Task 4), diagram chrome (Tasks 9–10). Gallery + ThemeSelector (Wave-4 straggler) covered (Tasks 11, 5). ✓
2. **Placeholders:** substitution rules are the LOCKED map (fully determines the mechanical swaps); exact per-site detail lives in the four research inventories cited in the header; deltas (selected-layer, code-level tokens, NameScope, THEME_LINK) are spelled out per task. Executor has the research files. ✓
3. **Type consistency:** import identifiers match `resources <Name>` blocks; Task 1 aliases (`@RowHoverFill`/`@InkVariant`/`@SurfaceBg`) are defined before Tasks 6 and 9 consume them; `@AccentInk`/`@Ink` pre-exist. ✓
4. **Review Focus:** ribbon selected+hover (T2), picker selected cell (T3), ColorPicker accent/hover code-level (T6–7), FillEditor NameScope (T8), diagram theme-tracking (T9) — each pinned in its task. ✓

## Open decisions for the executor (rulings, not stalls)

- **ThemeSelector Custom-seed / dynamic-scheme retirement** (spec Runtime section): a `.ts` feature removal, outward-facing, decoupled from the template. Task 5 retokenizes only; surface the retirement as a deferred user-facing decision in the final handoff (belongs to app-migration).
- **Diagram TS reach:** Task 9 fixes theme-linked colour resolution; any diagram colour that is a hardcoded constant (not in `THEME_LINK`, not in the template) is out of scope for a theming pass — ledger any found.
- **Deferred wave-wide (carry to memory):** pressed-state cues; PrefersContrast outlines.
