# Pragmatic theme — Phase 3, Sub-project 1: Mural-side finalization & delivery — design

**Status:** approved design, pre-plan.
**Parent spec:** [`2026-09-27-pragmatic-theme-design.md`](2026-09-27-pragmatic-theme-design.md)
(§ Runtime, § App migration, § Phases — step 3).
**Repo:** Mural (`@pragmatic-tech-ai/mural`).

## Context

Foundation + template Waves 1–5 are complete and merged to Mural's local
`main` (91 commits ahead of origin, **unpushed**). Every control family now has
a Pragmatic template; `PragmaticLight`/`PragmaticDark` schemes, typography, and
the `PragmaticControls` override dictionary all exist in source.

Phase 3 of the parent spec (default switch + app migration) was decomposed by
repo into three sub-projects, executed in order:

1. **This spec** — Mural-side finalization + delivery.
2. Plexus migration (~408 token refs, 2 app defaults, 59 button variants).
3. TODL migration (6 refs).

Delivery to the consumer apps is by **publishing Mural to npm** (a version bump
Plexus/TODL pick up), not by local symlink — decided at brainstorming.

### Why the apps cannot use Pragmatic yet (verified)

- The built `Mural/dist/` ships **`material` resources only**; Pragmatic exists
  only in source on unpushed `main`.
- Themes register by module side-effect: importing a compiled theme bundle runs
  `ThemeManager.RegisterTheme(...)`, after which `Application [Theme = <Name>]`
  resolves that name. Consumers opt in via a **subpath import**, e.g.
  `import Material from "@pragmatic-tech-ai/mural/resources/material"`
  (see `src/runtime/application.ts:299`; used by both Plexus apps, plexus-core's
  vite renderer, and TODL's `mural-host.ts`).
- `package.json` `exports` exposes `./resources/material` but **not**
  `./resources/pragmatic`. `src/resources/pragmatic/index.ts` already exists
  (`export * from './pragmatic.js'`), so the barrel is ready; only the export
  map entry and a published build are missing.
- Plexus consumes a **real published `mural@0.55.18`** (no Pragmatic). TODL
  symlinks local Mural, so it will see Pragmatic after a rebuild — but a normal
  version bump is the uniform delivery path for both.

## Goal

Make the Pragmatic theme importable and name-resolvable by downstream apps
through a published Mural package, and retire the Material-3 dynamic-scheme
feature that a hand-tuned brand palette makes meaningless. These are the last
Mural-side changes before app migration.

## Non-goals

- No app-default switch. `Application [Theme = Material, ...]` lives in the app
  repos and changes in sub-projects 2–3. Mural's own demos keep Material.
- No token-ref rewrites, no button-`Variant` reconciliation (app-side).
- No deletion of `src/resources/material/` and no Mural demo/test migration off
  Material — that is Phase 4.

## Deliverables

### D1 — Expose Pragmatic as a subpath export

Add a `./resources/pragmatic` entry to `package.json` `exports`, mirroring
`./resources/material` exactly:

```jsonc
"./resources/pragmatic": {
  "types": "./dist/resources/pragmatic/index.d.ts",
  "import": {
    "development": "./src/resources/pragmatic/index.ts",
    "default": "./dist/resources/pragmatic/index.js"
  }
}
```

No new barrel is needed — `src/resources/pragmatic/index.ts` already re-exports
`Pragmatic`, `PragmaticLight`, `PragmaticDark`, `PragmaticTypography`,
`PragmaticControls` from the compiled bundle, whose import triggers
`ThemeManager.RegisterTheme`. After this, a consumer can write
`import Pragmatic from "@pragmatic-tech-ai/mural/resources/pragmatic"` and
`Application [Theme = Pragmatic, Scheme = PragmaticDark]`.

### D2 — Retire dynamic-scheme / ThemeSelector "Custom…"

`makeDynamicScheme` has exactly one source consumer: `theme-selector.ts` (the
"Custom…" seed flow). Retire the whole feature:

- **Delete** `src/resources/material/dynamic-scheme.ts` (349 lines; exports
  `DynamicSchemeVariant`, `DynamicSchemeOptions`, `makeDynamicScheme`,
  `makeDynamicLightDarkPair`).
- **Remove** the four `./dynamic-scheme.js` re-exports from
  `src/resources/material/index.ts`. (Technically a breaking change to
  Material's public API; safe — no external consumer imports them. State this in
  the plan.)
- **Strip** from `src/framework/theme-selector/theme-selector.ts`: the
  `makeDynamicScheme` import, the `Custom…`/`Custom` combo rows, `pickCustom`,
  `applyCustom`, `persistCustom`, the `theme.customSeed` setting definition and
  its restore-on-load, and any now-dead constants/fields. The selector keeps the
  built-in theme/scheme combos (Material ▸ Light/Dark, Pragmatic ▸ Light/Dark)
  and OS auto-follow.
- A previously persisted `theme.customSeed` value becomes inert; no migration
  needed (the selector simply no longer reads it).

### D3 — Test surface

- **Registration test (Review Focus).** A new test proving the delivery
  contract: importing the Pragmatic subpath registers `"Pragmatic"` in
  `ThemeManager`, and an `Application` declaring `Theme = Pragmatic,
  Scheme = PragmaticDark` resolves the registered theme/scheme (not a fallback).
  It must exercise the **same module-resolution path a consumer uses**, so that
  a green test means the published artifact resolves — see Review Focus.
- **`src/runtime/tests/typography-and-dynamic-scheme.test.ts`** — drop the
  dynamic-scheme assertions; keep the typography half. Rename if the file's
  remaining scope no longer matches its name.
- **ThemeSelector behavior** — there is no `theme-selector/tests/` dir today;
  the Custom flow is currently uncovered. The plan **adds** a focused test:
  after removal the built-in combos still populate and apply globally, no
  "Custom…" row is offered, and a stale persisted `theme.customSeed` does not
  crash restore-on-load. (Headless-render caveats from Wave 5 apply — gate on
  reachable parts / `IsPragmaticStyle` where a full render is not possible.)
- **`src/resources/pragmatic/tests/controls-themeselector.test.ts`** — its
  comment currently defers the retirement; update the comment and, if it asserts
  anything about a deferred Custom flow, align it.
- `src/runtime/tests/dynamic-resource-first-access.test.ts` mentions
  dynamic-scheme only incidentally; confirm it does not import the deleted
  module (adjust only if it breaks).

### D4 — Build, version, publish, push (gated)

- Bump `version` `0.55.18 → 0.56.0` (new backward-compatible theme; Material
  remains the default). Follow the existing release-commit convention
  (`release: mural 0.56.0`).
- `prepublishOnly` already runs `clean && build` (`build:templates` +
  `build:demos` + `tsc` + demos:ts), so `dist/` and `build/` regenerate with
  Pragmatic included; `files` already lists `dist`, `src`, `build`.
- Publish to the `@pragmatic-tech-ai` registry (GitHub Packages, per `.npmrc`).
- Push local `main` to origin (delivers all 91 Foundation+Wave commits at once).

**Gate:** the push and the publish are outward-facing, irreversible actions.
The executor stops and gets explicit human confirmation immediately before the
push, and again immediately before `npm publish`. Everything in D1–D3 and the
version bump/build is done and verified green first.

## Interfaces / contract

- **Produced for sub-projects 2–3:** the import specifier
  `@pragmatic-tech-ai/mural/resources/pragmatic` exporting `Pragmatic`,
  `PragmaticLight`, `PragmaticDark`, `PragmaticTypography`, `PragmaticControls`;
  registered theme name `"Pragmatic"`; scheme names `"PragmaticLight"` /
  `"PragmaticDark"` (exact strings the apps will write in `Application` blocks).
- **Removed:** `makeDynamicScheme`, `makeDynamicLightDarkPair`,
  `DynamicSchemeVariant`, `DynamicSchemeOptions` from the `resources/material`
  subpath; the ThemeSelector "Custom…" option and `theme.customSeed` setting.

## Review Focus

Input classes/failure modes the spec implies that the ordinary suite would not
catch — each gets a test in its owning task:

1. **Cross-package name resolution of the published artifact.** The delivery's
   whole point: does `Theme = Pragmatic` resolve against what a *consumer*
   loads? Mural's own tests use the `development` export condition (source);
   consumers use `default` (dist). A test that only imports the source barrel
   can pass while the published `dist` entry is missing or unregistered. The
   registration test must resolve via the consumer path (the built subpath /
   the `default` condition), or assert the built `dist/resources/pragmatic/`
   entry exists and registers.
2. **ThemeSelector after Custom removal.** Selecting each remaining combo
   (Material ▸ Light/Dark, Pragmatic ▸ Light/Dark) still applies globally and
   the combo re-syncs; no orphaned "Custom" state re-appears; a stale persisted
   `theme.customSeed` does not crash restore-on-load.
3. **Material subpath still intact.** Removing the dynamic-scheme re-exports
   must not break the `resources/material` barrel for its remaining consumers
   (`Material`/`MaterialLight`/`MaterialDark`/`SetTheme`/… still import and
   register). Material stays the default and fully usable through Phase 3.
4. **Build output completeness.** After a clean `npm run build`,
   `dist/resources/pragmatic/index.js` and the compiled `build/…pragmatic…`
   bundle exist and the subpath's `default` target is present — the artifact
   actually ships Pragmatic.
5. **No dangling references to the deleted module.** No source or non-deleted
   test imports `./dynamic-scheme.js` after removal; `typecheck` is clean.

## Testing

- Full suite green (`npm test`) and `npm run typecheck` clean before the D4 gate.
- The registration test (Review Focus 1) is the acceptance gate for delivery.
- Existing conformance / theme / typography tests stay green.

## Risks & mitigations

- **Delivery proven only in source.** Mitigated by Review Focus 1 — a test on
  the consumer resolution path / built artifact, not just the source barrel.
- **Breaking Material's public API (dynamic-scheme exports).** No external
  consumer; verified by grep. Stated explicitly; Material otherwise unchanged.
- **First push of 91 commits + first publish.** Human-gated (D4); suite green
  and version bumped before either. Reversible up to the push.
- **Version choice.** `0.56.0` (minor) signals the new theme; the internal
  breaking removal is invisible externally. If a stricter reading is preferred,
  the bump is the only knob and is easy to change at plan time.

## Out of scope / follow-ups

App-default switches, token-ref rewrites, button-variant reconciliation
(sub-projects 2–3); deleting `material/` and migrating Mural's own demos/tests
(Phase 4).
