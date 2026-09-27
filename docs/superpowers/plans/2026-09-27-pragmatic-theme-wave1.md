# Pragmatic theme — Wave 1 (Primitives & Inputs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork the primitives & input controls onto Pragmatic templates — surface-step interaction, flat surfaces, 1px hairlines, a 2px focus ring — attached to the Pragmatic theme via an override dictionary, while Material and its default status stay untouched.

**Architecture:** A new `PragmaticControls` resource dictionary holds the forked control templates and is appended to the Pragmatic theme's `dictionaries:` list *after* `MuralFramework` (last-merged-wins, so Pragmatic's implicit styles override Material's for the forked controls; un-forked controls fall back to Material). Wave 1 also establishes the reusable patterns every later wave copies: the surface-step interaction, the `PART_FocusRing` wrapper, and density via `when (ThemeManager.Density = …)` triggers binding absolute `@ControlH*`/`@RowH*` tokens.

**Tech Stack:** Mural `.mu` templates (compiled by `build:templates`), `node:test` via `tsx`, the style-resolution + SVG-render test harnesses already in the repo.

**Spec:** `Mural/docs/superpowers/specs/2026-09-27-pragmatic-theme-design.md` (see §Template fork, §Density). Builds on the merged-in-this-branch Foundation phase.

## Locked decisions (from spec + Wave-1 recon)

1. **Fork strategy = override dictionary (B).** `PragmaticControls` is listed *after* `MuralBasic`/`MuralFramework` in `pragmatic.mu`'s `dictionaries:`. Wave-by-wave it holds only forked controls; un-forked ones fall back to Material. Phase 4 removes the Material dicts. Resolution is last-merged-wins on the control's runtime class key (`resource-dictionary.ts:279-287`, `element.ts:388-401`).
2. **Button variants = additive + back-compat mapping.** Add `Primary`/`Secondary`/`Ghost`/`Danger` to `ButtonVariant` (`button.ts:43`) and the two compiler spots (`symbol-table.ts:550, 689`). The Pragmatic `Button` style maps **both** the new names and the legacy Material names to Pragmatic looks: `Primary`+`Filled` → primary (`@ActionPrimary` fill, `@FgOnAccent`); `Secondary`+`Tonal`+`Outlined` → secondary (`@Bg1` + `@BorderStrong`); `Ghost`+`Text`+`Standard` → ghost (transparent, hover `@Bg2`); `Danger` → danger (`@StateDanger` fill). Existing call sites keep working under Pragmatic; app migration to the semantic names is Phase 3. No app/demo churn in Wave 1.
3. **Density = discrete triggers → absolute tokens.** No token arithmetic in `.mu`. Baseline (Regular) → `@ControlHDefault`/`@RowHDefault`; `when (ThemeManager.Density = Compact)` → `@ControlHCompact`/`@RowHCompact`; `when (ThemeManager.Pointer = Coarse)` → `@ControlHTouch`/`@RowHTouch`. `@ControlHDense`/`@RowHDense` are unused this wave (the `Density` enum has no `Dense` member; extending it is a later, separate change).
4. **Focus ring = `PART_FocusRing` wrapper.** A transparent outer `Border` with `Padding = @FocusRingOffset` and `CornerRadius = $$CornerRadius`; `when (IsFocused) { PART_FocusRing.Stroke = (@BorderFocus, 2); }`. (Thickness inlined as `2` if the compiler rejects `@FocusRingWidth` in the pen tuple — confirm in Task 1.)
5. **Interaction = surface-step.** No `PART_StateLayer` overlays, no `@Elevation*`. Rest `@Bg1` (or the variant fill), hover `@Bg2`, press/selected `@Bg3`; disabled via `PART_Root.Opacity = @OpacityDisabled`.

## Global Constraints

- **Allman braces** in `.mu` and TS; object literals / block-bodied arrows / one-line blocks stay inline.
- **No inline string literals** for reused/user-facing strings (private static readonly PascalCase constants); structural `.mu` tokens are exempt.
- **Tests** in a `tests/` subfolder beside source; `node:test` via `tsx --conditions=development`.
- **Pragmatic tokens only** in the forked templates — never a raw hex, never an `@<M3-role>` token (`@Primary`, `@OnSurface`, `@Shape*`, `@Elevation*`, `@*Layer`). Radii ≤ `@RadiusXl` (14) except `@RadiusPill`.
- **Do not change the app default or any app/demo** this wave. Material stays default; only `pragmatic.mu`'s dictionary list and the additive `ButtonVariant` members change outside `src/resources/pragmatic/` and `src/framework/pragmatic/`.
- Every forked template must resolve with **no unresolved `@token`** (which would render as grey `#808080`) — the render test guards this.

## Review Focus

- **A forked control under Pragmatic resolves the Pragmatic style, not Material's** (override dictionary wins). → each control task asserts the resolved implicit style is the Pragmatic one.
- **An un-forked control under Pragmatic still resolves Material's style** (fallback intact). → Task 1 asserts a not-yet-forked control (e.g. `ComboBox`) still resolves a style.
- **A legacy `Variant = Filled` Button renders the primary look under Pragmatic** (back-compat mapping). → Button task.
- **No unresolved token** in any forked template (grey fallback). → each control's render test asserts a Pragmatic token colour appears in the SVG.
- **Material is unaffected** — a Button under Material still resolves the Material style and M3 look. → Task 1 asserts under Material.

---

## File Structure

- `src/framework/pragmatic/<family>/<family>.template.mu` — forked templates, one file per family (buttons, toggles, markers, inputs, text).
- `src/resources/pragmatic/controls.resources.mu` — `resources PragmaticControls { import … }` aggregating the family templates (parallels `framework.resources.mu`).
- `src/resources/pragmatic/pragmatic.mu` — add `import PragmaticControls` and append it to `dictionaries:`.
- `src/framework/buttons/button.ts` — add the four `ButtonVariant` members.
- `src/compiler/symbol-table.ts` — add the four members to the `ButtonVariant` set and `Variant` mapping.
- `src/resources/pragmatic/tests/controls-*.test.ts` — per-family resolution + render tests.
- `src/resources/pragmatic/tests/control-harness.ts` — shared helper: activate Pragmatic, instantiate a control, return it + its rendered SVG.

---

## Task 1: Fork infrastructure + Button (the exemplar)

Establishes the override dictionary, the test harness, the four interaction/focus/density/variant patterns, and the first control. Every later task copies these patterns.

**Files:**
- Create: `src/framework/pragmatic/buttons/buttons.template.mu`
- Create: `src/resources/pragmatic/controls.resources.mu`
- Modify: `src/resources/pragmatic/pragmatic.mu` (import + list `PragmaticControls`)
- Modify: `src/framework/buttons/button.ts:43-55` (enum), `src/compiler/symbol-table.ts:550,689`
- Create: `src/resources/pragmatic/tests/control-harness.ts`
- Test: `src/resources/pragmatic/tests/controls-buttons.test.ts`

**Interfaces:**
- Produces: `PragmaticControls` dictionary; `ControlHarness.Render(makeControl, { scheme })` → `{ control, svg: string }` (activates Pragmatic, attaches control to a rooted Application, renders via the repo's SVG context — confirm the exact API against `src/basic/tests/text-block.test.ts`).
- Produces: `ButtonVariant.Primary|Secondary|Ghost|Danger`.

- [ ] **Step 1: Add the four enum members.** In `button.ts:43-55` extend `ButtonVariant` with `Primary='Primary'`, `Secondary='Secondary'`, `Ghost='Ghost'`, `Danger='Danger'`. In `symbol-table.ts:550` add them to the `ButtonVariant` Set; confirm `:689` `Variant` mapping references that same set (no second edit if it points at the set). Build (`npm run build:templates`) — expect no error.

- [ ] **Step 2: Write the failing harness test.** `controls-buttons.test.ts` first test: activate Pragmatic, create a `Button`, assert its resolved implicit style comes from `PragmaticControls` (distinguish by a Pragmatic-only marker — e.g. the resolved `Template`'s identity equals the `@DefaultPrimaryButton` template, or a probe property). Run: expect FAIL (no Pragmatic button template yet).

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application, ThemeManager } from '../../../runtime/index.js';
import { Button, ButtonVariant } from '../../../framework/buttons/button.js';
import { Pragmatic, PragmaticLight } from '../pragmatic.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic Button', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        const { control } = ControlHarness.Render(() => new Button(), { scheme: PragmaticLight });
        // The Pragmatic primary template fills with @ActionPrimary; assert the
        // resolved style is the Pragmatic one (see harness for the probe).
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'Button uses the Pragmatic override style');
        ThemeManager._resetForTesting();
        Application.current = undefined;
    });
});
```

- [ ] **Step 3: Write `control-harness.ts`.** Activate Pragmatic (register idempotently as the Foundation tests do), create the control, attach to a rooted `Application`, apply default style, render to SVG. Model the render call on `src/basic/tests/text-block.test.ts` (confirm the SVG-context API there). `IsPragmaticStyle` checks the resolved implicit style resolves to a `PragmaticControls` entry (compare against `PragmaticControls`' `Button` value).

- [ ] **Step 4: Write `buttons.template.mu`** — `resources PragmaticButtons { … }` with `Template x:key="DefaultPrimaryButton" [TargetType=Button]` (+ Secondary/Ghost/Danger), and the key-less `Style [TargetType=Button]` mapping every variant (new + legacy) to a template (decision 2). Primary template shape (the exemplar all controls follow):

```
Template x:key="DefaultPrimaryButton" [TargetType = Button]
{
    Border x:name="PART_FocusRing" [ Fill = #00000000, Padding = @FocusRingOffset, CornerRadius = $$CornerRadius ]
    {
        Border x:name="PART_Root" [ Fill = @ActionPrimary, CornerRadius = $$CornerRadius ]
        {
            ContentPresenter x:name="PART_Content" [ Padding = (16,8,16,8), TextBlock.Foreground = @FgOnAccent ]
        }
    }
    when ( IsMouseOver ) { PART_Root.Fill = @ActionPrimaryHover; }
    when ( IsPressed )   { PART_Root.Fill = @ActionPrimaryPress; }
    when ( IsFocused )   { PART_FocusRing.Stroke = (@BorderFocus, 2); }
    when ( IsEnabled = false ) { PART_Root.Opacity = @OpacityDisabled; }
    when ( ThemeManager.Density = Compact )   { PART_Root.MinHeight = @ControlHCompact; }
    when ( ThemeManager.Pointer = Coarse )    { PART_Root.MinHeight = @ControlHTouch; }
}
```
Baseline `PART_Root.MinHeight = @ControlHDefault` set on the Border. Secondary = `@Bg1` fill + `Stroke = (@BorderStrong, 1)` + `@Fg1` content, hover `@Bg2`. Ghost = transparent fill + `@Fg1`, hover `@Bg2`. Danger = `@StateDanger` fill + `@FgOnAccent`, hover a pressed danger (`@StateDanger` on `@StateDangerSoft`? use `@StateDanger` rest / darken via press — use `@StateDangerInk`? decide: rest `@StateDanger`, hover keep `@StateDanger` with `PART_Root.Opacity=0.92`). The Style: `CornerRadius = @RadiusMd`, `Template = @DefaultPrimaryButton`, then `when (Variant = Secondary) { Template = @DefaultSecondaryButton; }` … and the legacy mappings `when (Variant = Tonal) { Template = @DefaultSecondaryButton; }`, `when (Variant = Outlined) { … Secondary }`, `when (Variant = Text) { … Ghost }`, `when (Variant = Standard) { … Ghost }`. (Filled → baseline Primary, no trigger needed.)

- [ ] **Step 5: Aggregate + wire.** Create `controls.resources.mu` = `resources PragmaticControls { import PragmaticButtons from "../../framework/pragmatic/buttons/buttons.template.mu.js" }`. In `pragmatic.mu`, `import PragmaticControls from "./controls.resources.mu.js"` and set `dictionaries: [MuralBasic, MuralFramework, PragmaticControls, PragmaticTypography]`. Build.

- [ ] **Step 6: Run the resolution test — expect pass.** Then add the remaining tests to `controls-buttons.test.ts` and make them pass: (a) legacy `Variant = Filled` renders the primary look — `ControlHarness.Render(() => { const b = new Button(); b.Variant = ButtonVariant.Filled; return b; })` and assert the SVG contains `#22824D` (ActionPrimary); (b) `Variant = Danger` SVG contains `#C24532`; (c) **no grey fallback** — assert the SVG does NOT contain `#808080`; (d) **Material unaffected** — render a Button under `MaterialLight` and assert its SVG contains a Material colour (`#6750A4`) and its style is not the Pragmatic one; (e) **fallback intact** — a `ComboBox` under Pragmatic still resolves a (Material) style.

- [ ] **Step 7: Commit.**

```bash
git add src/framework/pragmatic/buttons src/resources/pragmatic/controls.resources.mu src/resources/pragmatic/pragmatic.mu src/framework/buttons/button.ts src/compiler/symbol-table.ts src/resources/pragmatic/tests/control-harness.ts src/resources/pragmatic/tests/controls-buttons.test.ts
git commit -m "feat(pragmatic): fork Button onto Pragmatic override dictionary (Wave 1)"
```

---

## Tasks 2–7: remaining Wave-1 controls (follow the Task 1 exemplar)

Each task: fork the named Material template(s) into `src/framework/pragmatic/<family>/<family>.template.mu`, applying the mechanic mappings (surface-step, `PART_FocusRing`, density triggers, Pragmatic tokens — no overlays/elevation/M3-tokens); add the family import to `controls.resources.mu`; write `controls-<family>.test.ts` mirroring Task 1's tests (resolves Pragmatic style; renders with the expected Pragmatic token colour; no `#808080`); build; commit. Each ends green.

### Task 2: IconButton + FAB
Fork from `src/framework/buttons/buttons.template.mu:209-638`. IconButton: 40×40 (Coarse 48×48), `CornerRadius = @RadiusPill`, ghost-style surface-step (`@Bg2` hover); IconButtonToggle adds `when (IsChecked) { PART_Root.Fill = @SurfaceSelected; }`. FAB: `@ActionPrimary` fill, `@RadiusLg`, `@ShadowMd` (the one place a raised control keeps a shadow), four sizes by `when (Size = …)`. Test colour: `#22824D` (FAB), no grey.

### Task 3: TextBox (Outlined / Filled / Plain)
Fork from `src/resources/basic.resources.mu:183-343`. Outlined: `@Bg1` fill, `Stroke = (@BorderStrong, 1)`, `@RadiusMd`; `when (IsMouseOver) { … (@Fg2? keep border) }`; `when (IsFocused) { PART_Border.Stroke = (@BorderFocus, 2); }` (inputs show focus on their own border, no offset wrapper needed); `when (IsEnabled = false) { PART_Root.Opacity = @OpacityDisabled; }`. Text selection uses `@TextSelectionBg`. Density → `PART_Border.MinHeight = @ControlH*`. Filled: `@Bg2` fill + bottom `@BorderStrong` underline that flips to `@BorderFocus` on focus. Foreground: input text `@Fg0`, placeholder `@Fg3`. Test colour: `#22824D` on focus, no grey.

### Task 4: Checkbox / RadioButton / Switch
Fork from `src/framework/toggles/toggles.template.mu`. Unchecked: box/ring `Stroke = (@BorderStrong, 2)`, transparent fill. Checked: fill `@ControlAccent`, mark/dot `@FgOnAccent`. Switch track off `@Bg3` (or `@BorderStrong`), on `@ControlAccent`; thumb `@Bg1`. Focus: `when (IsFocused)` re-stroke to `@BorderFocus`. Hover: thumb/box tint one step. Touch-target growth via control Width/Height on `when (ThemeManager.Pointer = Coarse)`. Test colour: `#22824D` when checked, no grey.

### Task 5: Slider / SpinEdit
Fork from `src/resources/basic.resources.mu:356-505`. Slider: track `@Bg3`, fill `@ControlAccent`, thumb `@ControlAccent` (hover `@BrandGreenHover`, drag `@BrandGreenPress` — replacing the legacy `@PrimaryHover/@PrimaryPress`); focus ring on thumb via `@BorderFocus`. SpinEdit: reuse the TextBox Outlined chrome (`@Bg1`+`@BorderStrong`+`@RadiusMd`), stepper buttons ghost-style (`@Bg2` hover), divider `@Border`. Test colour: `#22824D`, no grey.

### Task 6: Chip / Badge / Divider
Fork from `src/framework/markers/markers.template.mu`. Chip: `@Bg1` fill, `Stroke = (@Border, 1)`, `@RadiusPill`; selected → `@SurfaceSelected` fill + `@BrandGreenInk` label; hover `@Bg2`; focus `@BorderFocus`. Badge: dot/numeric use `@StateDanger` fill + `@FgOnAccent` (or tone-driven later). Divider: 1px `@Border` rule, both orientations. Test colour: Chip selected `@SurfaceSelected` (`#E2F3E9`), Divider `@Border` (`#E9E8E4`), no grey.

### Task 7: TextBlock / RichTextBlock / RichTextBox defaults
Fork from `src/resources/basic.resources.mu:109-132`. Key-less `Style [TargetType = TextBlock]` binding the five `@Body*` atoms (Foreground left unset per the existing rationale; render-time fallback resolves `@Fg1`). Mirror for RichTextBlock/RichTextBox. Test: a TextBlock under Pragmatic resolves the Pragmatic style and renders with the Body font size (15) — assert the SVG font-size, no grey.

---

## Done-when

- `npm run build:templates` green; `PragmaticControls` emitted.
- `npm test` green, including the new `controls-*.test.ts`.
- Every Wave-1 control under Pragmatic resolves the Pragmatic style and renders with no `#808080`; un-forked controls and Material are unaffected.
- No app or demo changed; Material still default.

## Next waves (not this plan)
Wave 2 (lists & selection), Wave 3 (overlays & surfaces), Wave 4 (shell & navigation), Wave 5 (complex & app-specific) — each a plan that copies the Wave-1 patterns established here.
