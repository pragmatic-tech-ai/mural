# Phase 4 SP2 — Collapse Pragmatic into the framework base — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native). Steps use checkbox syntax.

**Goal:** Make the Pragmatic design the framework base — no `framework/pragmatic/*` override layer, no `PragmaticControls` dictionary — with the shared base templates referencing only Pragmatic tokens, proven by a scheme-membership scan returning zero Material tokens.

**Architecture:** Relocate the already-correct Pragmatic fork files into the base (MuralBasic/MuralFramework), delete the shadowed Material chrome, retire the override barrel, fork the two un-forked templates, add the toggle Comfortable-density trigger, and un-skip the three SP1-skipped tests.

**Tech Stack:** Mural `.mu`→`.mu.js` (compile via `npm run build:templates`); tests node:test via `npx tsx --conditions=development --test <file>`; full suite `npm test`; type-check `npm run typecheck`.

**Spec:** docs/superpowers/specs/2026-09-29-pragmatic-phase4-sp2-collapse-base-design.md

## Global Constraints

- House rules (BINDING): Allman braces in `.ts`; OOP only (no module-level free functions/data); no reused/user-facing inline string literals (→ `private static readonly` PascalCase); real enums; PascalCase interfaces + public methods; VMs extend `Observable`; tests in a `tests/` subfolder next to source. Generated `.mu.js` keep generator style.
- The `Pragmatic` theme keeps its name. `ThemeManager.ActiveTheme?.name === 'Pragmatic'` must still hold.
- The Material theme *package* (`src/resources/material/**`) and the `./resources/material` export STAY (deleted in SP3). Material must still register.
- Commit `.mu.js` only for the `.mu` files this SP changed; revert incidental `build:templates` regenerations (pre-existing compiler drift).
- Pragmatic light tokens: `@Bg1`#FFFFFF, `@Fg1`#22211E, `@Fg2`#5F5C56, `@BrandGreenInk`#1B6B3D, `@ControlAccent`#22824D, `@Space*`, `@RadiusSm`=4/`@RadiusMd`=6. Transparent = `rgba(0,0,0,0)`.

## Review Focus

- Merge-order regressions once `PragmaticControls` is gone: a control whose Pragmatic look relied on last-wins shadowing (not on being the sole definition) reverts silently — check the split bundles (Button vs IconButton; ComboBox/TreeView/ListBox).
- Duplicate `x:key` at compile time when a fork lands on a base path before the Material definition is removed — each relocation removes the Material def in the same step.
- `basic.resources.mu` block deletions leaving a `Style[TargetType]` pointing at a deleted `@Default*` key.
- `@FilledArrowCap` (diagram → neutral caps survivor) still resolves after the diagram fork lands at base.
- Density precedence: Coarse-pointer still wins over the new Comfortable trigger on toggles.
- Material still registers (`ThemeManager.GetTheme('Material')` defined) after the collapse.

---

## Task 0: Baseline + Material-subject-test safety check

**Files:** none modified.

- [ ] **Step 1:** Record BASE = `git rev-parse HEAD`.
- [ ] **Step 2:** Confirm the deferred Material-subject tests assert theme metadata/exports, not control rendering: read `src/basic/tests/theme.test.ts` (Material half), `src/resources/material/tests/material-barrel.test.ts`, `src/resources/material/tests/material.test.ts`, `src/resources/pragmatic/tests/pragmatic-delivery.test.ts`. Ledger a ruling if any renders a control under Material (it would break at collapse and must be migrated/deferred in SP2).
- [ ] **Step 3:** Grep for external references to Material-only base keys that the collapse removes: `@DefaultFilledIconButton`, `@DefaultTonalIconButton`, `@DefaultOutlinedIconButton`, `@DefaultStandardIconButton`, `@DefaultFab*`, base `@DefaultComboBox*`/`@DefaultTreeView*`/`@DefaultListBox*`, base `@DefaultOutlinedTextBox`/`@DefaultFilledTextBox`/`@DefaultPlainTextBox`, `@DefaultSlider`/`@DefaultSpinEdit`/`@DefaultScrollBar`/`@DefaultSplitter`/`@DefaultGridSplitter`. Any live reference outside the file being replaced is a dependency to preserve — ledger it.

## Task 1: The completeness-gate test (RED until the collapse finishes)

**Files:** Create `src/resources/pragmatic/tests/base-has-no-m3-tokens.test.ts`.

**Interfaces:** Consumes `ThemeManager` (from runtime) to derive the forbidden vocabulary (Material catalog ∪ each scheme's tokens, minus Pragmatic's). Reuses the `SchemeMembershipScan` design from the consumer guards, scanning `src/framework/**` (excluding `tests/`, `dist`, `node_modules`) and `src/resources/basic.resources.mu`.

- [ ] **Step 1:** Write the scan test as a class `BaseSchemeMembershipScan` (node:test, direct import of both bundles under tsx dev condition, as `src/tests/no-m3-tokens.test.ts` does in TODL). Forbidden = Material vocab − Pragmatic vocab. Assert: (a) forbidden derivation non-empty and contains `OnSurface`; (b) scanning the shared base returns `[]`.
- [ ] **Step 2:** Run it. Expected: FAIL — base files still carry Material tokens (this is the RED that goes GREEN only when the collapse is complete).

## Task 2: Relocate the 1:1 framework families

The families whose base is a single `src/framework/<family>/<family>.template.mu` and whose Pragmatic fork is a single file at `src/framework/pragmatic/<family>/<family>.template.mu`. For each: `git rm` the base `.template.mu` and its `.mu.js`; `git mv` the fork `.template.mu` to the base path; the `framework.resources.mu` import is unchanged (same landing path).

Families: `bottom-app-bar`, `carousel`, `diagram`, `formatting`, `markers`, `menu`, `navigation`, `notifications`, `pickers`, `ribbon`, `search-bar`, `shell`, `status-bar`, `surfaces`, `tabs`, `theme-selector`, `tool-bar`, `tooltips`, `top-app-bar`. (`button-groups` handled here too: base `button-groups.template.mu` is replaced by the two fork files `segmented-button` + `split-button` merged into `src/framework/button-groups/button-groups.template.mu`, since the barrel imports one file for that family.)

- [ ] **Step 1:** For each family, `git rm` base `.mu`+`.mu.js`, `git mv` fork `.mu` into place.
- [ ] **Step 2:** `npm run build:templates`; keep only the `.mu.js` for the moved families.
- [ ] **Step 3:** Run the affected families' tests (e.g. `npx tsx --conditions=development --test src/framework/diagram/tests/*.test.ts …`). Expected: PASS (content unchanged from the shadowing layer).
- [ ] **Step 4:** Commit.

## Task 3: Split bundles — buttons/icon-buttons and list/lists

**Files:** `src/framework/buttons/buttons.template.mu`, new `src/framework/icon-buttons/icon-buttons.template.mu`, `src/framework/list/list.template.mu` → `src/framework/lists/{combo-box,list-box,tree-view}.template.mu`, `src/resources/framework.resources.mu`.

- [ ] **Step 1:** buttons: `git rm` base `buttons.template.mu`(+`.mu.js`); `git mv` fork `pragmatic/buttons/buttons.template.mu` → `framework/buttons/buttons.template.mu`. `git mv` fork `pragmatic/icon-buttons/icon-buttons.template.mu` → `framework/icon-buttons/icon-buttons.template.mu`; add `import IconButtons from "../framework/icon-buttons/icon-buttons.template.mu.js"` to `framework.resources.mu`.
- [ ] **Step 2:** list: `git rm` base `list/list.template.mu`(+`.mu.js`); `git mv` the three fork files `pragmatic/lists/{combo-box,list-box,tree-view}.template.mu` → `framework/lists/`; replace the `import Lists from "../framework/list/list.template.mu.js"` line with three imports.
- [ ] **Step 3:** `npm run build:templates`; run `src/framework/tests/button*.test.ts`, `src/framework/tests/fab.test.ts`, `src/framework/list/tests/*` (relocate those test dirs if needed), `src/framework/lists`/relevant. Expected: PASS.
- [ ] **Step 4:** Commit.

## Task 4: basic.resources.mu families — inputs, sliders, scroll

**Files:** `src/resources/basic.resources.mu`, new `src/framework/{inputs,sliders,scroll}/*.template.mu`, `src/resources/framework.resources.mu`.

- [ ] **Step 1:** `git mv` forks: `pragmatic/inputs/textbox.template.mu` → `framework/inputs/textbox.template.mu`; `pragmatic/sliders/sliders.template.mu` → `framework/sliders/sliders.template.mu`; `pragmatic/scroll/scroll-bar.template.mu` and `pragmatic/scroll/splitter.template.mu` → `framework/scroll/`.
- [ ] **Step 2:** Add imports to `framework.resources.mu`: `Inputs`, `Sliders`, `ScrollBars`, `Splitters`.
- [ ] **Step 3:** Delete from `basic.resources.mu` the now-superseded Material blocks and their `Style[TargetType]`: `DefaultOutlinedTextBox`, `DefaultFilledTextBox`, `DefaultPlainTextBox`, `DefaultSpinEdit`, `DefaultSlider`, `DefaultScrollBar`, `DefaultSplitter`, `DefaultGridSplitter`. Leave `DefaultSliderSpinEdit` for Task 6, and any non-control primitives (`DefaultPageView`, `DefaultThumb`).
- [ ] **Step 4:** `npm run build:templates`; run the textbox/slider/scrollbar/splitter suites. Expected: PASS.
- [ ] **Step 5:** Commit.

## Task 5: Toggles — merge fork + fork DefaultRadioButtonItem + Comfortable density

**Files:** `src/framework/toggles/toggles.template.mu` (replace with a merge), `src/framework/tests/toggles-adaptive.test.ts`, `src/framework/tests/radio-button-group.test.ts`.

- [ ] **Step 1 (RED):** Un-skip `toggles-adaptive.test.ts:70` ("comfortable density grows to 40") and `radio-button-group.test.ts:88` ("long row content wraps"). Run both. Expected: FAIL (no Comfortable trigger yet; DefaultRadioButtonItem still Material-tokenized on the old base — but the base is about to be replaced).
- [ ] **Step 2:** Build the merged base `toggles.template.mu` = the Pragmatic fork content (`Switch`/`Checkbox`/`RadioButton`) + a retokenized `DefaultRadioButtonItem` (Pragmatic tokens: `@Fg1` foreground, `@Fg2` ring rest, `@BrandGreenInk`/`@ControlAccent` selected dot, `@Space*` padding, `@RadiusSm`/`@RadiusMd`/pill radius, `@Fg2`/state overlays as the other Pragmatic forks use, `@LabelLarge*`→Pragmatic type tokens the fork uses), keeping Compact + Comfortable density triggers. `git rm` base `toggles.template.mu.js`; `git rm` the fork `pragmatic/toggles/toggles.template.mu`.
- [ ] **Step 3:** Add to `Switch`/`Checkbox`/`RadioButton` styles a `when (ThemeManager.Density = Comfortable)` growth so Checkbox → 40×40 and Switch height → 40 (verify Coarse still overrides via the existing "coarse wins" test).
- [ ] **Step 4 (GREEN):** `npm run build:templates`; run `toggles*.test.ts`, `radio-button-group.test.ts`, `checkbox`/`switch` suites. Expected: PASS incl. the two un-skipped tests.
- [ ] **Step 5:** Commit.

## Task 6: Fork DefaultSliderSpinEdit + un-skip shape-format-layout

**Files:** `src/resources/basic.resources.mu` (or `src/framework/sliders/sliders.template.mu`), `src/framework/formatting/tests/shape-format-layout.test.ts`.

- [ ] **Step 1 (RED):** Un-skip `shape-format-layout.test.ts:72`. Run. Expected: FAIL (Material `@Spacing*`/`@OnSurfaceVariant` → NaN).
- [ ] **Step 2:** Retokenize `DefaultSliderSpinEdit` to Pragmatic (`@Fg2` unit text, `@Space1`/`@Space3` margins). Keep it wherever `SliderSpinEdit` composes cleanly (prefer moving it into the relocated `framework/sliders/sliders.template.mu` for cohesion; otherwise retokenize in place in `basic.resources.mu`).
- [ ] **Step 3 (GREEN):** `npm run build:templates`; run `shape-format-layout.test.ts` and the slider-spin-edit suite. Expected: PASS.
- [ ] **Step 4:** Commit.

## Task 7: Retire the override layer + mop up residual Material tokens

**Files:** delete `src/resources/pragmatic/controls.resources.mu`(+`.mu.js`) and the `src/framework/pragmatic/` tree; edit `src/resources/pragmatic/pragmatic.mu`; retokenize any residual Material tokens in `basic.resources.mu` (`DefaultThumb`/`DefaultPageView` if flagged).

- [ ] **Step 1:** Edit `pragmatic.mu` `dictionaries:` → `[MuralBasic, MuralFramework, PragmaticTypography]` (drop `PragmaticControls`); remove the `PragmaticControls` import.
- [ ] **Step 2:** `git rm` `src/resources/pragmatic/controls.resources.mu`(+`.mu.js`) and the entire `src/framework/pragmatic/` tree (all forks now relocated; confirm empty of un-moved files first).
- [ ] **Step 3:** Run the Task 1 membership scan. For every remaining offender (e.g. `DefaultThumb`/`DefaultPageView`), retokenize that base template to the Pragmatic equivalent.
- [ ] **Step 4:** `npm run build:templates` (recompile `pragmatic.mu` + any retokenized base); the scan → `[]`.
- [ ] **Step 5:** Commit.

## Task 8: Whole-suite acceptance

**Files:** none new.

- [ ] **Step 1:** `npm run typecheck` → 0.
- [ ] **Step 2:** `npm test` full suite → 0 failures; the three previously-skipped tests now pass; skip count drops by 3.
- [ ] **Step 3:** `npm run typecheck:demos` → 0; `npm run test:demo` green.
- [ ] **Step 4:** Smoke: a test (or the membership test) asserts `ThemeManager.GetTheme('Material')` is still defined after importing the Material bundle.
- [ ] **Step 5:** Confirm `src/framework/pragmatic/` no longer exists and `git status` shows only intended `.mu.js` regenerations. Commit any final `.mu.js`.
