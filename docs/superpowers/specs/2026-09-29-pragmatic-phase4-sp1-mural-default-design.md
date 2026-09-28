# Phase 4 · SP1 — Make Pragmatic Mural's default; migrate demos/tests off Material

**Status:** design approved 2026-09-29
**Part of:** Phase 4 (remove Material from Mural). Decomposition: **SP1 (this)** → SP2 (collapse Pragmatic into the framework base) → SP3 (delete the Material theme package + `./resources/material` export, publish mural@0.57.0).

## Goal

Mural's own dev/test harness and demo app run on **Pragmatic**, and no test depends on Material *incidentally*. After SP1, the only remaining references to the Material theme package are the tests that validate Material *as their subject* (removed with the package in SP3) and the package itself. This proves the framework works with Pragmatic as the default **before** SP2 moves the templates, so the risky template collapse starts from a green, Pragmatic-default suite.

## Non-goals (explicitly later)

- **SP2:** collapsing `framework/pragmatic/*` into the framework base and deleting the Material-design base templates. SP1 does **not** touch framework templates.
- **SP3:** deleting `src/resources/material/`, removing the `./resources/material` export, the version bump to 0.57.0, and publishing. SP1 leaves the Material theme package present and registered — merely unused by Mural's own default path.

## Background (current state)

- `src/basic/tests/test-app.ts` is a shared, process-wide test harness. Its `initTestApp()` registers **Material** as the default theme (`Application.RegisterDefaultTheme(Material)`) and initializes the shared `Application` with `{ theme: Material, scheme: MaterialLight }`. **188 test files** use it to construct controls (controls read default templates from the active theme's dictionaries).
- Both Material and Pragmatic are opt-in subpath bundles (`@pragmatic-tech-ai/mural/resources/{material,pragmatic}`); neither is in the main barrel. Registration is a module-load side effect (`RegisterTheme` + `RegisterDefaultTheme`, first-import-wins, idempotent). `Pragmatic`/`PragmaticLight`/`PragmaticDark` mirror the Material named exports 1:1.
- All control families are covered by the Pragmatic fork (Waves 1–5), so switching the default to Pragmatic yields fully-themed controls.
- Mural's `demo/` app (electron + vite, many demos, one playwright e2e `demo/e2e/demo-app.spec.ts`) defaults to Material via three source files: `demo/platform/platform.mu` (`Application [ Theme = Material, Scheme = MaterialLight ]` + imports), `demo/src/renderer/main.ts` (`app.initialize({ theme: Material, autoScheme: … })`), `demo/electron.vite.config.ts` (resources/material alias). The demo has **no** golden/snapshot PNGs and **no** hardcoded colors in e2e assertions.
- ~6 test files import `resources/material` directly (not via the harness) to activate a theme and assert control ink: `basic/tests/text-box-foreground-reactive.test.ts`, `basic/tests/text-box-text-reactive.test.ts`, `framework/list/tests/list-box-item-ink.test.ts`, `framework/list/tests/list-box-recycle-selection.test.ts`, `framework/tests/navigation-icon-ink.test.ts`, `framework/diagram/tests/diagram-settings.test.ts`.

## Approach

Big-bang harness switch plus targeted fixes. There is no incremental path for a single shared harness: switch it to Pragmatic, run the full suite, and fix the fallout. Fallout is bounded — only assertions on **theme-derived** colors change; the majority of color assertions in the suite are on **user-picked** colors (diagram/format editors) and are theme-independent.

Pragmatic light token values used when retokenizing assertions: `@Bg1 #FFFFFF` (rgb(255,255,255)), `@Fg1 #22211E` (rgb(34,33,30)), `@Fg2 #5F5C56` (rgb(95,92,86)), `@ControlAccent #22824D`. Dark and other tokens read from `src/resources/pragmatic/{light,dark}.mu` as needed.

## Components / work

### 1. Test harness (`src/basic/tests/test-app.ts`)
Swap the Material import for Pragmatic; `RegisterDefaultTheme(Pragmatic)`; initialize the shared app with `{ theme: Pragmatic, scheme: PragmaticLight }`; update the fixture comment. One file; flips the default for all 188 consumers. (The module-level `let`/free-function style is a pre-existing OOP-house-rule inconsistency; converting to a class static would rename 188 call sites — **out of scope for SP1**, noted for a later standalone pass.)

### 2. Incidental Material tests (~6 files)
Switch each from `resources/material` to `resources/pragmatic` (Pragmatic/PragmaticLight), and retokenize any asserted ink/background colors to the Pragmatic values. Where an assertion only needs *a* resolved color (not a specific Material value), prefer making it theme-agnostic.

### 3. Demo app (`demo/`)
- `demo/platform/platform.mu`: `Application [ Theme = Pragmatic, Scheme = PragmaticLight ]` + Pragmatic imports.
- `demo/src/renderer/main.ts`: `app.initialize({ theme: Pragmatic, autoScheme: { light: PragmaticLight, dark: PragmaticDark } })` + import swap.
- `demo/electron.vite.config.ts`: ensure the `resources/pragmatic` alias resolves (keep/add alongside; the material alias may remain until SP3).
- Recompile the affected demo `.mu.js` (committed artifacts) via the demo's compile step. No goldens to regenerate; the single e2e is functional.

### 4. Fallout triage (explicit task, not pre-enumerated)
Run the full Mural suite after (1)–(3). For each failure caused by a changed theme-derived value, retokenize to the Pragmatic value or make the assertion theme-agnostic. Failures unrelated to the theme switch are out of scope (report, don't mask).

## What stays until SP3

- `src/resources/material/` (the theme package) and the `./resources/material` export.
- Material-subject tests: the Material half of `basic/tests/theme.test.ts` (alias keys bit-identical under Material), and `src/resources/material/tests/material-barrel.test.ts`.
- `src/compiler/tests/compile.test.ts` — its `RegisterDefaultTheme(Material)` assertion compiles a theme block *named* Material (a compiler fixture), independent of the resources package; leave (optional cosmetic rename in SP3).
- `src/resources/pragmatic/tests/pragmatic-delivery.test.ts` — references material for delivery comparison; revisit when the export is removed in SP3.

## Testing / verification

- `npm test` (full Mural suite) green with Pragmatic as the harness default — the acceptance gate. Known env caveat: orphaned test workers can stall a run (`taskkill //F //IM node.exe` + re-run).
- `npm run typecheck` → 0 errors.
- Demo builds; `demo/e2e/demo-app.spec.ts` passes under Pragmatic.

## Review focus (inputs the tests may not cover)

- A test that constructs a control and asserts its **default** foreground/background/stroke will now see Pragmatic values — ensure such assertions are retokenized, not left matching Material by coincidence.
- Dark-scheme assertions: a test that switches to `PragmaticDark`/`MaterialDark` mid-test must use the Pragmatic dark values.
- Tests that call `ThemeManager._resetForTesting()` then rely on the harness re-registering the default must still get Pragmatic.
- Any test asserting a Material-specific token name via `Theme.*` alias resolution (should be none outside the deferred Material-subject tests).

## Risks

- **Unknown fallout size.** The number of the 188 harness tests that assert theme-derived colors is not pre-enumerated; the plan treats "run suite → triage" as an explicit task. Mitigation: the fallout is structurally bounded to theme-color assertions, and the Pragmatic values are known.
