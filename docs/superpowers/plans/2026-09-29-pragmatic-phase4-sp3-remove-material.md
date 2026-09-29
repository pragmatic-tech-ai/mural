# Phase 4 SP3 — Remove the Material theme package — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native).

**Goal:** Delete Material from Mural and publish mural@0.57.0 with Pragmatic as the only theme.

**Spec:** docs/superpowers/specs/2026-09-29-pragmatic-phase4-sp3-remove-material-design.md

## Global Constraints
- House rules (Allman, OOP, PascalCase, no reused inline literals, tests in tests/).
- Publishing is irreversible + outward-facing — the one hard stop that needs care: clean `dist/` before the publish build so no stale `resources/material` artifact ships.
- Version `0.56.0` → `0.57.0`.

## Review Focus
- No dangling import of the deleted package (tsc + grep).
- theme.test.ts Pragmatic half still asserts the real alias fix (not trivially passing).
- Published 0.57.0 tarball carries no `resources/material`.
- pragmatic-delivery.test.ts still verifies the Pragmatic export shape.

## Task 1: Update the dependent test/harness sites (before deleting the package, so each step's failure is legible)

**Files:** `src/resources/pragmatic/tests/control-harness.ts`, `src/basic/tests/theme.test.ts`, `src/resources/pragmatic/tests/pragmatic-delivery.test.ts`, delete `src/resources/pragmatic/tests/base-has-no-m3-tokens.test.ts`.

- [ ] **Step 1:** control-harness.ts — remove the `Material` import and the Material branch in `EnsureThemesRegistered` (register only Pragmatic). Run the harness's consumers (a delivery test) → still green.
- [ ] **Step 2:** theme.test.ts — remove the `Material` import, the "Theme.* alias keys — Material" describe, and the Material regression-guard; drop Material from `ThemeAliasFixture`. Keep the Pragmatic half. Run → green, Pragmatic assertions intact.
- [ ] **Step 3:** pragmatic-delivery.test.ts — rewrite the "mirroring ./resources/material" test to assert the `./resources/pragmatic` export shape directly (has `types`; `import` has `development` + `default`). Run → green.
- [ ] **Step 4:** `git rm src/resources/pragmatic/tests/base-has-no-m3-tokens.test.ts` (obsolete — derives from Material; no Material means no tokens to leak).
- [ ] **Step 5:** Commit.

## Task 2: Delete the Material package + export

**Files:** `src/resources/material/**`, `package.json`.

- [ ] **Step 1:** `git rm -r src/resources/material`.
- [ ] **Step 2:** Remove the `./resources/material` block from `package.json` `exports`.
- [ ] **Step 3:** `npm run typecheck` → 0 (no dangling Material import). `grep -rn "resources/material\|material/material\|from .*/material/" src` → nothing but the `compile.test.ts` `theme Material` fixture (not a package import).
- [ ] **Step 4:** Commit.

## Task 3: Build + full acceptance

**Files:** none.

- [ ] **Step 1:** Remove any stale build output: `rm -rf build dist`.
- [ ] **Step 2:** `npm run build` → succeeds (templates + demos + tsc), and `dist/` contains no `resources/material`.
- [ ] **Step 3:** `npm test` → 0 failures; `npm run typecheck` → 0; `npm run typecheck:demos` → 0; `npm run test:demo` green.
- [ ] **Step 4:** Commit any regenerated committed artifacts (demo `.mu.js` only if this SP changed their source — it should not; revert incidental drift).

## Task 4: Version bump + publish

**Files:** `package.json`.

- [ ] **Step 1:** Bump `version` `0.56.0` → `0.57.0`.
- [ ] **Step 2:** Commit `chore(release): mural 0.57.0 — remove Material, Pragmatic is the only theme`.
- [ ] **Step 3:** (Integration — user-approved for this run) push `main` after merge, then `npm publish` to GitHub Packages. Verify the packed tarball (`npm pack --dry-run`) lists no `resources/material` before publishing.
