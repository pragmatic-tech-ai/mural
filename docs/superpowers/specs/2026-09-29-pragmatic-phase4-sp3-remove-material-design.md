# Phase 4 · SP3 — Delete the Material theme package; publish mural@0.57.0

**Status:** design approved 2026-09-29 (Phase-4 blanket approval)
**Part of:** Phase 4 (remove Material from Mural). Decomposition: SP1 (Pragmatic default — DONE) → SP2 (collapse into base — DONE) → **SP3 (this)**.

## Goal

Remove the Material theme package from Mural entirely and ship the clean-break minor release **mural@0.57.0** in which Pragmatic is the only theme. After SP3, `src/resources/material/` is gone, the `./resources/material` subpath export is gone, and nothing in Mural imports or registers a Material theme.

## Background (state after SP2)

The collapse made Pragmatic the framework base. No production code imports the Material package. The only remaining Material references are:

- `src/resources/material/**` — the package itself (`material.mu`, `light.mu`, `dark.mu`, `typography.mu`, `material.ts`, `index.ts`, `tests/material.test.ts`, `tests/material-barrel.test.ts`).
- `package.json` `./resources/material` export.
- `src/basic/tests/theme.test.ts` — a two-part alias test: a **Material** half (asserts `@Ink`/`@AccentInk` alias keys resolve bit-identically to `@OnSurface`/`@Primary` under Material) and a **Pragmatic** half.
- `src/resources/pragmatic/tests/control-harness.ts` — imports `Material` and registers it (idempotently) in `EnsureThemesRegistered`.
- `src/resources/pragmatic/tests/base-has-no-m3-tokens.test.ts` — the SP2 completeness gate; **derives its forbidden set by importing the Material bundle** and reading `ThemeManager.GetTheme('Material')`.
- `src/resources/pragmatic/tests/pragmatic-delivery.test.ts` — asserts `package.json` exposes `./resources/pragmatic` **mirroring** `./resources/material`.
- `src/compiler/tests/compile.test.ts` — compiles a `theme Material { … }` block as a **compiler fixture** (self-contained; independent of the resources package).

## Approach

Delete the package and export, then update the six dependent test/harness sites so the suite stays green, bump the version, build, and publish.

### 1. Delete the package + export
- `git rm -r src/resources/material/`.
- Remove the `./resources/material` block from `package.json` `exports`.

### 2. The completeness gate (base-has-no-m3-tokens.test.ts) — **delete it**
The guard exists to prove the collapsed base references no Material token Pragmatic lacks. It derives the forbidden set from the live Material theme; with Material deleted there is no vocabulary to derive, and — more fundamentally — with Material gone there is no source of Material tokens to leak. Its job was verified at the SP2 merge. Delete the file. (A Material token typed by hand into a base template would now simply be an undefined resource, caught by the control's render/token tests, the same as any other typo.)

### 3. control-harness.ts — Pragmatic-only
Remove the `Material` import and the Material branch of `EnsureThemesRegistered`; the harness registers only Pragmatic.

### 4. theme.test.ts — drop the Material half
Remove the `Material` import and the "Theme.* alias keys — Material" describe block and the Material regression-guard test. Keep the Pragmatic half (the real subject: `@Ink`/`@AccentInk` → `@Fg1`/`@ControlAccent`). If the shared `ThemeAliasFixture` registers Material, drop that too.

### 5. pragmatic-delivery.test.ts — the export no longer mirrors Material
The "mirroring ./resources/material" assertion compared the two export entries. With `./resources/material` removed, rewrite the test to assert the shape of the `./resources/pragmatic` export directly (types + import conditions present), rather than comparing it to a deleted sibling.

### 6. compile.test.ts — leave as-is
Its `theme Material { … }` is a compiler fixture, not a package import; it stays valid. Optional cosmetic rename is out of scope.

### 7. Version + publish
- Bump `package.json` version `0.56.0` → `0.57.0` (clean-break minor).
- `npm run build` (templates + demos + tsc) succeeds.
- Full suite + `typecheck` + `typecheck:demos` + `test:demo` green.
- Publish `@pragmatic-tech-ai/mural@0.57.0` to GitHub Packages (push `main` first).

## Consumer impact (rollout — handled as the Phase-4 deferreds)

`mural@0.57.0` removes the `./resources/material` export. Consumers that import it break at install/build. After Phase 3 every consumer already **defaults** to Pragmatic; the only remaining Material importers downstream are the **consumer M3-token guards** (`TODL/src/tests/no-m3-tokens.test.ts`, `Plexus/**/no-m3-tokens.test.ts`) which import `@pragmatic-tech-ai/mural/resources/material` to derive their forbidden set — the same derivation this SP removes from Mural. The rollout removes those guards (or freezes their vocabulary) and bumps each consumer to `mural@0.57.0`. This is tracked as the post-SP3 deferred work, not part of SP3's own acceptance.

## Testing / verification

- `npm test` green with no Material package present.
- `npm run typecheck` → 0 (no dangling Material import types).
- `npm run build` → succeeds; `typecheck:demos` 0; `test:demo` green.
- `grep -rn "resources/material\|material/material" src` returns nothing (except the `compile.test.ts` fixture's `theme Material` block, which is not a package reference).
- `package.json` has no `./resources/material` export; version is `0.57.0`.

## Review focus

- No dangling import of the deleted package anywhere (tsc catches most; also check `.mu` and dynamic references).
- theme.test.ts's Pragmatic half still asserts the real alias fix after the Material half is removed (not left trivially passing).
- The `dist/` published for 0.57.0 must not carry `resources/material` artifacts (a stale `dist/resources/material` would resurrect the export at the `default` condition).
- pragmatic-delivery.test.ts still verifies the Pragmatic export is well-formed (types + both import conditions), not merely that it exists.

## Risks

- **Publishing is irreversible and outward-facing.** A 0.57.0 that still ships `dist/resources/material` (stale build output) would defeat the removal. Mitigation: clean `dist/` before the publish build; verify the packed tarball contents.
- **Consumer breakage.** 0.57.0 is a breaking change for anything importing `resources/material`. Mitigation: the rollout (deferreds) updates the consumer guards immediately after.
