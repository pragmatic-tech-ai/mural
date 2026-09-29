# Phase 4 · SP2 — Collapse Pragmatic into the framework base; delete the Material-design base templates

**Status:** design approved 2026-09-29 (Phase-4 blanket approval)
**Part of:** Phase 4 (remove Material from Mural). Decomposition: SP1 (Pragmatic default — DONE) → **SP2 (this)** → SP3 (delete the Material theme package + `./resources/material` export, publish mural@0.57.0).

## Goal

Make the Pragmatic design **the** framework base. After SP2 there is no separate `framework/pragmatic/*` override layer and no `PragmaticControls` override dictionary: every shared control template under `src/framework/**` and `src/resources/basic.resources.mu` carries the Pragmatic design and references only tokens Pragmatic defines. The `Pragmatic` theme's dictionary list collapses to the base (`[MuralBasic, MuralFramework, PragmaticTypography]`). The Material theme *package* (`src/resources/material/*`) is left in place, still registering, but its control chrome is now non-functional (the shared base templates it composes reference Pragmatic tokens it does not define) — deletion of the package is SP3's job.

The completeness gate: a scheme-membership scan (the same net used by the consumer guards) over the shared base templates finds **zero** Material tokens Pragmatic does not define.

## Non-goals (explicitly later or out of scope)

- **SP3:** deleting `src/resources/material/`, the `./resources/material` export, the version bump to 0.57.0, and publishing. SP2 leaves the Material package present and registered.
- Renaming the `Pragmatic` theme. It keeps the name `Pragmatic` — the SP1 guard tests, the consumer imports (`resources/pragmatic`), and `ThemeManager.ActiveTheme?.name === 'Pragmatic'` all depend on it. Promoting Pragmatic to base is a structural move, not a rename.
- Redesigning any control. The Pragmatic fork files are already correct and green (SP1); SP2 relocates them, it does not restyle them. The only *new* authoring is the two un-forked templates and the toggle Comfortable-density trigger.

## Background (current state)

Two theme dictionaries compose the base:

- **MuralBasic** (`src/resources/basic.resources.mu`) — imported first by both themes. Holds the base templates for the *basic* controls: `TextBox` (Outlined/Filled/Plain), `SpinEdit`, `Slider`, `SliderSpinEdit`, `ScrollBar`, `Thumb`, `GridSplitter`, `Splitter`, `PageView`. These are Material-tokenized inline blocks.
- **MuralFramework** (`src/resources/framework.resources.mu`) — imported second. A barrel of 26 `import … from "../framework/<family>/<family>.template.mu.js"` lines. Three are theme-neutral survivors (`base`, `diagram/caps`, `property-grid`); the other 23 are Material-design families (`buttons` — which also bundles `IconButton`/`FAB`; `list` — which bundles `ComboBox`/`TreeView`/`ListBox`; `button-groups`, `carousel`, `diagram`, `formatting`, `markers`, `menu`, `navigation`, `ribbon`, `notifications`, `pickers`, `search-bar`, `shell`, `status-bar`, `surfaces`, `tabs`, `theme-selector`, `toggles`, `tool-bar`, `tooltips`, `top-app-bar`, `bottom-app-bar`).

The **Pragmatic** theme (`src/resources/pragmatic/pragmatic.mu`) lists `[MuralBasic, MuralFramework, PragmaticControls, PragmaticTypography]`. `PragmaticControls` (`src/resources/pragmatic/controls.resources.mu`) is a barrel of 32 imports from `src/framework/pragmatic/**`, merged **last-wins** so its key-less `Style[TargetType=X]` entries shadow the Material chrome in both MuralBasic and MuralFramework. Because it is last-wins, the Pragmatic fork files are already the *effective* base under the Pragmatic default (proven green in SP1). The `Material` theme lists `[MuralBasic, MuralFramework]` — its chrome IS the base layer, with no override barrel.

Two base templates were never forked and still use Material tokens undefined in Pragmatic (→ NaN layout), each guarding a currently-skipped test:

- `DefaultRadioButtonItem` — `src/framework/toggles/toggles.template.mu` (`@ShapeSmall`, `@ShapeFull`, `@Spacing1/2/3`, `@OnSurfaceVariant`, `@Primary`, `@State*Overlay`, `@DisabledContentOpacity`, `@OnSurface`, `@LabelLarge*`). Has Compact **and** Comfortable density triggers. Guards `src/framework/tests/radio-button-group.test.ts:88`.
- `DefaultSliderSpinEdit` — `src/resources/basic.resources.mu` (`@OnSurfaceVariant`, `@Spacing1`, `@Spacing3`). Guards `src/framework/formatting/tests/shape-format-layout.test.ts:72`.

The Pragmatic toggle fork (`src/framework/pragmatic/toggles/toggles.template.mu`, covering `Switch`/`Checkbox`/`RadioButton`) has only a `Pointer = Coarse → 48` growth and no Comfortable-density trigger — the outlier: Comfortable-density sizing appears in 20 other Pragmatic fork families. Guards `src/framework/tests/toggles-adaptive.test.ts:70` ("comfortable density grows to 40").

## Approach

A structural collapse, family by family, followed by the two new forks and the toggle density trigger, gated by the membership scan and the full suite. The Pragmatic fork content is moved, not rewritten.

### Relocation rules

1. **Framework family whose base is its own `framework/<family>/<family>.template.mu`** (one fork file ↔ one base file): `git rm` the Material base file and its committed `.mu.js`; `git mv` the fork `src/framework/pragmatic/<family>/<family>.template.mu` into the base path `src/framework/<family>/<family>.template.mu`. The `framework.resources.mu` import path is unchanged (same landing path). Recompile.
2. **A base file that bundles families the fork split** (`buttons.template.mu` bundles Button + IconButton/FAB; `list.template.mu` bundles ComboBox + TreeView + ListBox): the base file is replaced by the fork's Button/list content; the split-out fork families (`icon-buttons`, `lists/combo-box`, `lists/list-box`, `lists/tree-view`) move to their own `src/framework/<family>/` directories and get their own `import` line added to `framework.resources.mu`. The Material IconButton/FAB and ComboBox/TreeView/ListBox blocks in the old bundled base files are dropped with the replacement.
3. **Family whose base is an inline block in `basic.resources.mu`** (`inputs/textbox` ↔ TextBox×3; `sliders` ↔ Slider + SpinEdit + (new) SliderSpinEdit; `scroll/scroll-bar` ↔ ScrollBar; `scroll/splitter` ↔ Splitter/GridSplitter): move the fork file into `src/framework/<family>/`, add an `import` line to `framework.resources.mu`, and **delete the corresponding Material template blocks from `basic.resources.mu`**. MuralFramework merges after MuralBasic, so once the Material block is gone the relocated Pragmatic template is the sole definition.
4. **Theme-neutral survivors** (`base`, `diagram/caps`, `property-grid`): untouched.

### Retire the override layer

After every family is relocated: delete `src/resources/pragmatic/controls.resources.mu` and its compiled `.mu.js`; remove the now-empty `src/framework/pragmatic/` tree; edit `src/resources/pragmatic/pragmatic.mu` to drop `PragmaticControls` from the `dictionaries:` list (leaving `[MuralBasic, MuralFramework, PragmaticTypography]`); recompile `pragmatic.mu`.

### The two new forks + toggle density (the only new authoring)

- **`DefaultRadioButtonItem`** — retokenize in place in `src/framework/toggles/toggles.template.mu` to Pragmatic tokens (focus-ring/selection patterns consistent with the Pragmatic toggle and list-box forks; `@Fg1`/`@Fg2`/`@BrandGreen*`/`@Space*`/`@Radius*`), keeping its Compact + Comfortable density triggers retokenized. Un-skip `radio-button-group.test.ts:88`.
- **`DefaultSliderSpinEdit`** — retokenize in place in `src/resources/basic.resources.mu` to Pragmatic tokens (`@Fg2`, `@Space*`). Un-skip `shape-format-layout.test.ts:72`.
- **Toggle Comfortable density** — add a `when (ThemeManager.Density = Comfortable)` growth to `Switch`/`Checkbox`/`RadioButton` in the (now base) toggle template so Checkbox → 40×40 and Switch height → 40, consistent with the 20 other Pragmatic families that honor Comfortable density. Un-skip `toggles-adaptive.test.ts:70`. This is the resolved design decision: Pragmatic's density model is density-driven, and the toggle omission was an inconsistency, not a design intent.

### Keep Material registerable

`material.mu` still lists `[MuralBasic, MuralFramework]`; both still exist (now Pragmatic-designed). Material's scheme/catalog validation at `RegisterTheme` is against its own token catalog, not template references, so it still registers. No test activates Material and renders a control (SP1 migrated all incidental activators; the deferred Material-subject tests assert theme metadata/exports, not control rendering — verified in SP2 Task 0). The Material chrome being non-functional is acceptable: the package is deleted in SP3.

## Completeness gate

A scheme-membership scan over the shared base — `src/framework/**` (excluding tests) and `src/resources/basic.resources.mu` — using the derived forbidden set (Material vocabulary minus Pragmatic vocabulary, the same net as the consumer guards) must return **zero** offenders. This is authored as a Mural-side test (`src/resources/pragmatic/tests/base-has-no-m3-tokens.test.ts`) so the invariant is permanent: no shared base template may reference a Material token Pragmatic does not define. It also catches any un-forked basic template (e.g. `DefaultThumb`, `DefaultPageView`) that still carries Material tokens — such a template is retokenized to Pragmatic as part of SP2 ("fix all inconsistencies").

## Testing / verification

- `npm test` (full Mural suite) green after the collapse — the acceptance gate. Env caveat: orphaned test workers can stall a run (`taskkill //F //IM node.exe` + re-run).
- `npm run typecheck` → 0.
- `npm run build:templates` recompiles every touched `.mu`; the committed `.mu.js` are regenerated and match.
- The new base-membership scan test → 0 offenders.
- The three previously-skipped tests un-skipped and green.
- `typecheck:demos` 0 and `test:demo` green (demo composes the base; the demo e2e needs an unavailable display env — same documented fallback as SP1).

## Review focus (inputs the tests may not cover)

- **Merge-order regressions.** With `PragmaticControls` gone, a control's default now resolves from MuralBasic/MuralFramework directly. Any control whose Pragmatic look depended on last-wins shadowing (rather than on the fork being the sole definition) would silently revert. Check controls whose base bundled multiple families (Button vs IconButton in `buttons`; ComboBox/TreeView/ListBox in `list`) — the split-out families must each be imported exactly once and not leave a stale Material duplicate key.
- **Duplicate keys after relocation.** Moving a fork to a base path while the Material base still defines the same `x:key` (until removed) is a compile-time duplicate. Each relocation removes the Material definition in the same step.
- **basic.resources.mu block deletions.** Deleting a Material TextBox/Slider/ScrollBar block must remove exactly that block — no stray trailing `Style[TargetType]` left pointing at a deleted `@Default*` key.
- **The `@FilledArrowCap` cross-reference** (Pragmatic diagram → theme-neutral caps survivor) must still resolve after the diagram fork lands at the base path.
- **Density precedence.** With both Compact and Comfortable triggers on the (now base) toggles, confirm Coarse-pointer still wins over Comfortable (existing `toggles-adaptive` "coarse wins" test) after the new Comfortable trigger is added.
- **Material still registers** — a smoke assertion that `ThemeManager.GetTheme('Material')` is defined after importing the Material bundle (proves SP2 didn't break registration ahead of SP3's deletion).

## Risks

- **Large mechanical surface** (~32 fork files, two heavyweights: `diagram` 577 lines, `formatting` 1829 lines; barrel rewiring in two files; `.mu.js` recompilation). Mitigation: relocate family-group by family-group, recompile and run the affected suites after each group, full suite at the end; the fork content is already correct so the risk is wiring, not styling.
- **Hidden last-wins dependency.** A fork that relied on inheriting part of the Material base (rather than fully replacing it) would break when the base is deleted. Mitigation: the mapping found forks essentially self-contained (only `@FilledArrowCap` reaches into a survivor); the membership scan + full suite catch the rest.
- **Compiled-artifact drift.** `build:templates` may regenerate unrelated drifted `.mu.js` (pre-existing compiler drift, per the Phase-3 ruling). Mitigation: commit only the `.mu.js` whose `.mu` this SP changed; revert incidental regenerations.
