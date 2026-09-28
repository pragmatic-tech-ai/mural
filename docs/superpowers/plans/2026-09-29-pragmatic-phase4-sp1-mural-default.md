# Phase 4 · SP1 — Pragmatic as Mural's default + demos/tests migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch Mural's shared test harness and demo app to default to the Pragmatic theme, migrate the tests that use Material incidentally, and get the full suite green — leaving the Material theme package and its subject-tests for SP3.

**Architecture:** `test-app.ts` is a process-wide shared `Application` fixture that registers the default theme; flipping it from Material to Pragmatic re-themes all 188 tests that construct controls. The demo app selects its theme in three source files. Material and Pragmatic are opt-in subpath bundles with 1:1 named exports (`Pragmatic`/`PragmaticLight`/`PragmaticDark`).

**Tech Stack:** TypeScript, Mural `.mu`→`.mu.js` compiler, node:test (`npm test`), tsc (`npm run typecheck`), electron-vite + playwright (demo).

**Spec:** `docs/superpowers/specs/2026-09-29-pragmatic-phase4-sp1-mural-default-design.md`

## Global Constraints

- House rules: Allman braces in `.ts`; OOP only (no module-level free functions/data — except that `test-app.ts` already uses a module `let` + free function and is **left as-is this SP**, per spec); no reused/user-facing inline string literals (→ `private static readonly` PascalCase constants); real enums; PascalCase interfaces + public methods; VMs extend `Observable`; tests in a `tests/` subfolder next to source.
- **Do NOT touch `src/framework/**/*.template.mu` or `framework/pragmatic/*`** (that is SP2). **Do NOT delete `src/resources/material/` or the `./resources/material` export** (that is SP3).
- **Leave the Material-subject tests:** the Material half of `src/basic/tests/theme.test.ts`, `src/resources/material/tests/material-barrel.test.ts`, and the `RegisterDefaultTheme(Material)` fixture assertion in `src/compiler/tests/compile.test.ts`.
- Pragmatic light token values for retokenizing assertions: `@Bg1 #FFFFFF` → `rgb(255,255,255)`; `@Fg1 #22211E` → `rgb(34,33,30)`; `@Fg2 #5F5C56` → `rgb(95,92,86)`; `@ControlAccent #22824D` → `rgb(34,130,77)`. Dark-scheme values: read from `src/resources/pragmatic/dark.mu` at the point of use.
- Verification commands: full suite `npm test`; type-check `npm run typecheck`; single file `npx tsx --conditions=development --test <file>`. Env caveat: orphaned node test workers can stall a run → `taskkill //F //IM node.exe` then re-run.

## Review Focus

- A test asserting a control's **default** foreground/background/stroke now sees Pragmatic values — retokenize to the Pragmatic value; never leave an assertion matching Material by coincidence.
- Dark-scheme assertions must use `PragmaticDark` values, not `MaterialDark`.
- Tests that call `ThemeManager._resetForTesting()` and rely on the harness re-registering the default must still receive Pragmatic (covered by Task 1's re-registration guard test).
- No incidental test should keep importing `resources/material` after Task 2.
- Demo e2e is functional (no color goldens) — a pass proves the demo renders under Pragmatic.

---

## Task 1: Switch the test harness to Pragmatic

**Files:**
- Modify: `src/basic/tests/test-app.ts`
- Create: `src/basic/tests/test-app-default.test.ts`

**Interfaces:**
- Consumes: `Pragmatic`, `PragmaticLight` from `../../resources/pragmatic/pragmatic.js`; `ThemeManager.ActiveTheme` (from `../../runtime/index.js`), `Theme.name`.
- Produces: `initTestApp()` now activates Pragmatic as the process-wide default (unchanged signature).

- [ ] **Step 1: Write the failing test**

```ts
// src/basic/tests/test-app-default.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ThemeManager } from '../../runtime/index.js';
import { initTestApp } from './test-app.js';

test('initTestApp activates Pragmatic as the default theme', () =>
{
    initTestApp();
    assert.equal(ThemeManager.ActiveTheme?.name, 'Pragmatic');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --conditions=development --test src/basic/tests/test-app-default.test.ts`
Expected: FAIL — actual `'Material'` ≠ expected `'Pragmatic'`.

- [ ] **Step 3: Switch the harness**

In `src/basic/tests/test-app.ts` replace the Material import and activation with Pragmatic:

```ts
import { Application, ThemeManager } from '../../runtime/index.js';
import { Pragmatic, PragmaticLight } from '../../resources/pragmatic/pragmatic.js';
```

and inside `initTestApp()`:

```ts
        if (ThemeManager.GetTheme(Pragmatic.instance.name) === undefined)
        {
            ThemeManager.RegisterTheme(Pragmatic.instance);
        }
        Application.RegisterDefaultTheme(Pragmatic);
        _sharedApp = new Application();
        _sharedApp.initialize({ theme: Pragmatic, scheme: PragmaticLight });
```

Update the fixture's leading comment from "Material activated" to "Pragmatic activated".

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --conditions=development --test src/basic/tests/test-app-default.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/basic/tests/test-app.ts src/basic/tests/test-app-default.test.ts
git commit -m "test(mural): default the shared test harness to Pragmatic"
```

---

## Task 2: Migrate the incidental Material tests to Pragmatic

**Files:**
- Modify: `src/basic/tests/text-box-foreground-reactive.test.ts`
- Modify: `src/basic/tests/text-box-text-reactive.test.ts`
- Modify: `src/framework/list/tests/list-box-item-ink.test.ts`
- Modify: `src/framework/list/tests/list-box-recycle-selection.test.ts`
- Modify: `src/framework/tests/navigation-icon-ink.test.ts`
- Modify: `src/framework/diagram/tests/diagram-settings.test.ts`

**Interfaces:**
- Consumes: `Pragmatic`, `PragmaticLight`, `PragmaticDark` from `../../resources/pragmatic/pragmatic.js` (adjust relative depth per file), replacing the same-named Material imports.

- [ ] **Step 1: Inventory each file's Material usage**

Run: `grep -nE 'resources/material|Material(Light|Dark)?|rgb\(|#[0-9A-Fa-f]{6}' src/basic/tests/text-box-foreground-reactive.test.ts src/basic/tests/text-box-text-reactive.test.ts src/framework/list/tests/list-box-item-ink.test.ts src/framework/list/tests/list-box-recycle-selection.test.ts src/framework/tests/navigation-icon-ink.test.ts src/framework/diagram/tests/diagram-settings.test.ts`
Expected: each file shows a `resources/material` import + `Material*` activation; the `*-ink` files also show asserted colors.

- [ ] **Step 2: Run the six files to confirm they pass under Material (baseline)**

Run: `npx tsx --conditions=development --test src/basic/tests/text-box-foreground-reactive.test.ts src/basic/tests/text-box-text-reactive.test.ts src/framework/list/tests/list-box-item-ink.test.ts src/framework/list/tests/list-box-recycle-selection.test.ts src/framework/tests/navigation-icon-ink.test.ts src/framework/diagram/tests/diagram-settings.test.ts`
Expected: PASS (green baseline before migration).

- [ ] **Step 3: Migrate each file**

For every file: swap `import { Material, MaterialLight[, MaterialDark] } from ".../resources/material/material.js"` → the Pragmatic equivalents from `.../resources/pragmatic/pragmatic.js`; replace `Material`→`Pragmatic`, `MaterialLight`→`PragmaticLight`, `MaterialDark`→`PragmaticDark` at activation sites. For asserted colors, replace the Material value with the Pragmatic value the same token now resolves to (e.g. an `@OnSurface`/`Fg1` foreground → `rgb(34,33,30)`; an `@OnSurfaceVariant`/`Fg2` → `rgb(95,92,86)`). Where an assertion only needs *a* resolved (non-fallback) color, make it theme-agnostic (assert `!== NeutralFallback` rather than a specific hex).

- [ ] **Step 4: Run the six files to verify they pass under Pragmatic**

Run: (same command as Step 2)
Expected: PASS. If a color assertion fails, read the actual value and confirm it is the correct Pragmatic token value before updating (never edit the assertion to match an unexplained value).

- [ ] **Step 5: Verify no `resources/material` import remains in these files**

Run: `grep -rn 'resources/material' src/basic/tests/text-box-foreground-reactive.test.ts src/basic/tests/text-box-text-reactive.test.ts src/framework/list/tests/list-box-item-ink.test.ts src/framework/list/tests/list-box-recycle-selection.test.ts src/framework/tests/navigation-icon-ink.test.ts src/framework/diagram/tests/diagram-settings.test.ts`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/basic/tests/text-box-foreground-reactive.test.ts src/basic/tests/text-box-text-reactive.test.ts src/framework/list/tests/list-box-item-ink.test.ts src/framework/list/tests/list-box-recycle-selection.test.ts src/framework/tests/navigation-icon-ink.test.ts src/framework/diagram/tests/diagram-settings.test.ts
git commit -m "test(mural): migrate incidental Material tests to Pragmatic"
```

---

## Task 3: Full-suite fallout triage → green under Pragmatic default

**Files:** whichever test files assert theme-derived colors and now fail (discovered by running the suite; likely candidates from the color-assertion survey include `src/basic/tests/inheritance-change-gate.test.ts`, `src/basic/tests/template-part-inheritance.test.ts`, `src/framework/tests/input.test.ts`, and `src/framework/property-grid/tests/property-grid.render.test.ts` — confirm by running).

**Interfaces:**
- Consumes: Task 1's Pragmatic-default harness.

- [ ] **Step 1: Run the full suite and capture failures**

Run: `npm test 2>&1 | tee /tmp/sp1-suite.txt; grep -E '^# (tests|pass|fail)' /tmp/sp1-suite.txt | tail -3`
Expected: some failures, all in tests asserting theme-derived colors/values (record the exact list). If the run stalls, `taskkill //F //IM node.exe` and re-run.

- [ ] **Step 2: Triage — classify each failure**

For each failing test: determine whether the failure is (a) a theme-derived color/value that changed Material→Pragmatic (in scope — fix), or (b) unrelated (out of scope — report, do not mask). A value is theme-derived if it traces to a default control template token, not a user-set property.

- [ ] **Step 3: Fix each in-scope failure**

Retokenize the asserted value to the Pragmatic value the token now resolves to, or make the assertion theme-agnostic where it only needs a resolved color. Read the actual rendered value and confirm it matches a Pragmatic token before updating the expectation.

- [ ] **Step 4: Re-run the full suite until green**

Run: `npm test 2>&1 | tee /tmp/sp1-suite.txt; grep -E '^# (tests|pass|fail)' /tmp/sp1-suite.txt | tail -3`
Expected: `fail 0` (skips unchanged from baseline).

- [ ] **Step 5: Type-check**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test(mural): retokenize theme-color assertions for the Pragmatic default"
```

---

## Task 4: Migrate the demo app to Pragmatic

**Files:**
- Modify: `demo/platform/platform.mu`
- Modify: `demo/src/renderer/main.ts`
- Modify: `demo/electron.vite.config.ts`
- Regenerate: the demo `.mu.js` affected by the `platform.mu` change (via the demo's compile step)

**Interfaces:**
- Consumes: `@pragmatic-tech-ai/mural/resources/pragmatic` (the demo resolves mural via its vite alias).

- [ ] **Step 1: Inventory the demo's Material references**

Run: `grep -rnE 'resources/material|Theme\s*=\s*Material|theme:\s*Material|Material(Light|Dark)?' demo/platform/platform.mu demo/src/renderer/main.ts demo/electron.vite.config.ts`
Expected: `platform.mu` shows `Application [ Theme = Material, Scheme = MaterialLight ]` + Material imports; `main.ts` shows `initialize({ theme: Material, autoScheme: … })` + import; the vite config shows the `resources/material` alias.

- [ ] **Step 2: Migrate the three source files**

- `demo/platform/platform.mu`: change the imports to Pragmatic and `Application [ Theme = Pragmatic, Scheme = PragmaticLight ]`.
- `demo/src/renderer/main.ts`: `import { Pragmatic, PragmaticLight, PragmaticDark } from '@pragmatic-tech-ai/mural/resources/pragmatic'` and `app.initialize({ theme: Pragmatic, autoScheme: { light: PragmaticLight, dark: PragmaticDark } })`.
- `demo/electron.vite.config.ts`: add/ensure the `@pragmatic-tech-ai/mural/resources/pragmatic` → `dist/resources/pragmatic/index.js` alias (leave the material alias until SP3).

- [ ] **Step 3: Recompile the demo markup**

Run the demo's `.mu` compile step (e.g. `cd demo && npm run build` or its compile script — check `demo/package.json` scripts) and confirm `demo/platform/platform.mu.js` now imports Pragmatic.
Expected: build succeeds; `grep -n Pragmatic demo/platform/platform.mu.js` shows the Pragmatic import, no `Material`.

- [ ] **Step 4: Run the demo e2e**

Run: the demo's e2e command (check `demo/package.json`, e.g. `cd demo && npm run test:e2e` / playwright) for `demo/e2e/demo-app.spec.ts`.
Expected: PASS (functional; no color goldens). If the demo e2e requires an environment not available, record that and fall back to a successful `demo` build + a headless render smoke check.

- [ ] **Step 5: Commit**

```bash
git add demo/platform/platform.mu demo/platform/platform.mu.js demo/src/renderer/main.ts demo/electron.vite.config.ts
git commit -m "demo(mural): default the demo app to Pragmatic"
```

---

## Definition of done

- `npm test` green (`fail 0`) with the harness defaulting to Pragmatic.
- `npm run typecheck` → 0 errors.
- No `resources/material` import in `test-app.ts`, the six incidental tests, or the demo source (the Material package itself and its subject-tests remain — SP3).
- Demo builds and defaults to Pragmatic; its e2e passes (or a documented smoke fallback).
