# Pragmatic Phase 3 — Sub-project 1: Mural-side finalization & delivery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Pragmatic theme consumable by downstream apps through a published Mural package, and retire the Material-3 dynamic-scheme feature.

**Architecture:** Add a `./resources/pragmatic` subpath export so a consumer's `import ".../resources/pragmatic"` fires `ThemeManager.RegisterTheme` and `Application [Theme = Pragmatic]` resolves; delete the seed-driven `makeDynamicScheme` generator and strip the ThemeSelector "Custom…" flow that was its only consumer; bump + build + (gated) publish/push.

**Tech Stack:** TypeScript, Mural `.mu` compiler, Node's built-in test runner (`node:test`) run via `tsx --conditions=development`.

**Spec:** [`docs/superpowers/specs/2026-09-28-pragmatic-phase3-mural-delivery-design.md`](../specs/2026-09-28-pragmatic-phase3-mural-delivery-design.md)

## Global Constraints

- **House style (binding):** Allman braces in `.ts`; OOP only (no module-level free functions/data — test tables are `static readonly` members of a class); no reused/user-facing inline string literals (hoist to `private static readonly` PascalCase constants; genuinely single-use structural/resource keys may stay inline); real enums, never string-literal unions; PascalCase for interfaces and public methods; VMs extend `Observable`; every test file in a `tests/` subfolder next to its source.
- **Material stays the default and fully usable** through all of Phase 3. This sub-project does not change any app default and does not delete `src/resources/material/`.
- **Test command:** single file — `npx tsx --conditions=development --test --test-force-exit <file>`; full suite — `npm test`; types — `npm run typecheck`.
- **Templates:** `npm run build:templates` regenerates `build/**` from `.mu` (gitignored, not committed). Run it if a `.mu`/bundle changed before running tests.
- **Registered names (exact, for downstream sub-projects):** theme `Pragmatic`; schemes `PragmaticLight`, `PragmaticDark`; import specifier `@pragmatic-tech-ai/mural/resources/pragmatic`.
- **Attribution:** commit messages end `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Review Focus

Input classes / failure modes the spec implies that the ordinary suite would miss — each pinned by a test in the owning task:

1. **Cross-package resolution of the published artifact.** Mural's own tests use the `development` export condition (source); consumers use `default` (dist). A source-only test can pass while the shipped `dist` entry is missing. → Task 1 pins the source wiring + registration + exports-map shape; **Task 4** pins that the built `dist/resources/pragmatic/index.js` exists and registers `Pragmatic` when imported from the built artifact.
2. **ThemeSelector after Custom removal.** The scheme combo must still offer the active theme's built-in schemes and never a "Custom…"/"Custom" row; a stale persisted `theme.customSeed` must not crash restore. → Task 2.
3. **Material subpath intact.** Dropping the dynamic-scheme re-exports must not break the `resources/material` barrel: `Material`/`MaterialLight`/`MaterialDark`/`SetTheme` still import and register. → Task 3.
4. **No dangling references to the deleted module + clean types.** No source/test imports `./dynamic-scheme.js` after removal; `npm run typecheck` clean. → Task 3 (grep + typecheck) and every task's suite run.

---

## File Structure

- `package.json` — add `./resources/pragmatic` to `exports` (Task 1); bump `version` to `0.56.0` (Task 4).
- `src/resources/pragmatic/tests/pragmatic-delivery.test.ts` — **create** (Task 1): registration + exports-map contract.
- `src/framework/theme-selector/theme-selector.ts` — **modify** (Task 2): strip the Custom flow and now-unused imports.
- `src/framework/theme-selector/tests/theme-selector.test.ts` — **create** (Task 2): scheme-combo offers built-ins only, no Custom row, stale seed inert.
- `src/resources/material/dynamic-scheme.ts` — **delete** (Task 3).
- `src/resources/material/index.ts` — **modify** (Task 3): remove the four `./dynamic-scheme.js` re-exports.
- `src/resources/material/tests/material-barrel.test.ts` — **create** (Task 3): barrel still registers Material; dynamic-scheme exports gone.
- `src/runtime/tests/typography-and-dynamic-scheme.test.ts` → **rename** to `src/runtime/tests/typography.test.ts` (Task 3): drop the `makeDynamicScheme` describe and now-unused imports.
- `src/resources/pragmatic/tests/controls-themeselector.test.ts` — **modify** (Task 3): update the deferral comment to reflect the completed retirement.

---

## Task 1: Expose Pragmatic as a subpath export

**Files:**
- Modify: `package.json` (the `exports` object)
- Create: `src/resources/pragmatic/tests/pragmatic-delivery.test.ts`

**Interfaces:**
- Consumes: `src/resources/pragmatic/index.ts` (already `export * from './pragmatic.js'`); `ThemeManager` from `../../../runtime/index.js`.
- Produces: importable `@pragmatic-tech-ai/mural/resources/pragmatic`; the `exports['./resources/pragmatic']` entry that sub-projects 2–3 rely on.

- [ ] **Step 1: Write the failing test**

Create `src/resources/pragmatic/tests/pragmatic-delivery.test.ts`:

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ThemeManager } from '../../../runtime/index.js';
// Importing the barrel is exactly the registration side-effect a consumer gets.
import '../index.js';

describe('Pragmatic delivery — subpath export + registration', () =>
{
    test('importing the Pragmatic barrel registers the theme and its schemes', () =>
    {
        const theme = ThemeManager.GetTheme('Pragmatic');
        assert.ok(theme !== undefined, 'theme "Pragmatic" is registered');
        assert.ok(theme.schemes.has('PragmaticLight'), 'PragmaticLight scheme present');
        assert.ok(theme.schemes.has('PragmaticDark'), 'PragmaticDark scheme present');
    });

    test('package.json exposes ./resources/pragmatic mirroring ./resources/material', () =>
    {
        type ExportEntry = { types: string; import: { development: string; default: string } };
        const pkgPath = fileURLToPath(new URL('../../../../package.json', import.meta.url));
        const exports = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { exports: Record<string, ExportEntry> }).exports;
        const pragmatic = exports['./resources/pragmatic'];
        const material  = exports['./resources/material'];
        assert.ok(pragmatic !== undefined, './resources/pragmatic export entry exists');
        assert.equal(pragmatic.types, './dist/resources/pragmatic/index.d.ts');
        assert.equal(pragmatic.import.development, './src/resources/pragmatic/index.ts');
        assert.equal(pragmatic.import.default, './dist/resources/pragmatic/index.js');
        assert.deepEqual(Object.keys(pragmatic), Object.keys(material), 'same keys as material entry');
        assert.deepEqual(Object.keys(pragmatic.import), Object.keys(material.import), 'same import conditions');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit src/resources/pragmatic/tests/pragmatic-delivery.test.ts`
Expected: the registration test PASSES (barrel already registers), the exports-map test FAILS on `./resources/pragmatic export entry exists` (entry missing).

- [ ] **Step 3: Add the export entry**

In `package.json`, inside `exports`, immediately after the `"./resources/material": { ... }` block, add:

```jsonc
"./resources/pragmatic": {
    "types": "./dist/resources/pragmatic/index.d.ts",
    "import": {
        "development": "./src/resources/pragmatic/index.ts",
        "default": "./dist/resources/pragmatic/index.js"
    }
},
```

Match the existing indentation exactly and keep JSON valid (comma placement).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --conditions=development --test --test-force-exit src/resources/pragmatic/tests/pragmatic-delivery.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add package.json src/resources/pragmatic/tests/pragmatic-delivery.test.ts
git commit -m "feat(theme): expose ./resources/pragmatic subpath export

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Strip the ThemeSelector "Custom…" flow

**Files:**
- Modify: `src/framework/theme-selector/theme-selector.ts`
- Create: `src/framework/theme-selector/tests/theme-selector.test.ts`

**Interfaces:**
- Consumes: `ControlHarness` from `../../../resources/pragmatic/tests/control-harness.js`; `ComboBox` from `../../list/combo-box.js`; `PragmaticLight` from `../../../resources/pragmatic/index.js`.
- Produces: a ThemeSelector whose scheme combo lists only the active theme's registered schemes; no `makeDynamicScheme` import remains anywhere.

- [ ] **Step 1: Write the failing test**

Create `src/framework/theme-selector/tests/theme-selector.test.ts`:

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ThemeSelector } from '../theme-selector.js';
import { ComboBox } from '../../list/combo-box.js';
import { PragmaticLight } from '../../../resources/pragmatic/index.js';
import { ControlHarness } from '../../../resources/pragmatic/tests/control-harness.js';

// Wave-5 headless-render caveats apply: the scheme combo is populated in the
// constructor's syncFromThemeManager against the active theme, so activating a
// theme before construction is enough to inspect PART_SchemeCombo.Items.
describe('ThemeSelector — scheme combo after Custom retirement', () =>
{
    test('offers the active theme’s built-in schemes and no Custom row', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const selector = new ThemeSelector();
        const combo = selector.GetTemplateChild('PART_SchemeCombo') as ComboBox;
        const items = (combo.Items ?? []) as readonly unknown[];
        assert.ok(items.includes('PragmaticLight'), 'offers PragmaticLight');
        assert.ok(items.includes('PragmaticDark'), 'offers PragmaticDark');
        assert.ok(!items.includes('Custom…'), 'no "Custom…" action row');
        assert.ok(!items.includes('Custom'), 'no live "Custom" row');
        ControlHarness.Reset();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/theme-selector/tests/theme-selector.test.ts`
Expected: FAIL on `no "Custom…" action row` — `syncFromThemeManager` currently pushes `CUSTOM_ACTION` into the combo.

- [ ] **Step 3: Strip the Custom flow from `theme-selector.ts`**

Make exactly these edits:

1. Remove the import on line 22: `import { makeDynamicScheme } from '../../resources/material/dynamic-scheme.js';` and its 5-line explanatory comment (lines 16–21).
2. Remove the now-unused imports: `ColorPicker` (line 14), and from the `runtime` import block drop `Color` and `defineScheme` (they are used only by `applyCustom`).
3. Remove the constants `CUSTOM_ACTION`, `CUSTOM_ACTIVE`, `CUSTOM_SCHEME_NAME` (lines 29–31) and `SEED_SETTING` (line 37). Keep `SCHEME_SETTING`.
4. In `onSchemeSelected`, delete the `value === CUSTOM_ACTION` and `value === CUSTOM_ACTIVE` branches, leaving only:

```ts
private onSchemeSelected(value: unknown): void
{
    if (typeof value === 'string')
    {
        this.SelectScheme(value);
        this.persistScheme(value);
    }
}
```

5. Delete the methods `pickCustom` and `applyCustom` in full.
6. In `syncFromThemeManager`, drop the `activeIsCustom` computation and the `CUSTOM_ACTIVE`/`CUSTOM_ACTION` pushes so the combo lists only built-ins:

```ts
const builtinSchemes = theme !== undefined ? [...theme.schemes.keys()] : [];
const schemeNames = [...builtinSchemes];
// (selected item resolves to the active scheme name when it is a built-in)
```

Update the selected-item expression in the same method to drop the `activeIsCustom ? CUSTOM_ACTIVE : ...` ternary, selecting `activeName` when it is a built-in and `undefined` otherwise.
7. Delete `persistCustom` (lines 342–348).
8. In `restorePersistedOnce`, delete the `saved === CUSTOM_ACTIVE` branch (which called `applyCustom`); keep the built-in restore path.
9. Remove `SEED_SETTING` from the settings contribution in `settings()`/the setting-definition list (the `settingDef(SEED_SETTING, 'Custom base colour')` entry).
10. Update the class-header comment paragraph (lines 57–63) that describes the "Custom…" flow to describe the built-ins-only behavior.

- [ ] **Step 4: Rebuild templates (theme-selector template unchanged, but keep bundles fresh) and run the test**

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/theme-selector/tests/theme-selector.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck (proves the dropped imports were the only uses)**

Run: `npm run typecheck`
Expected: 0 errors. If `Color`, `defineScheme`, or `ColorPicker` is reported unused elsewhere or still referenced, reconcile per the error.

- [ ] **Step 6: Commit**

```bash
git add src/framework/theme-selector/theme-selector.ts src/framework/theme-selector/tests/theme-selector.test.ts
git commit -m "feat(theme): retire ThemeSelector Custom-seed flow

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Delete the dynamic-scheme generator and clean up its tests

**Files:**
- Delete: `src/resources/material/dynamic-scheme.ts`
- Modify: `src/resources/material/index.ts`
- Create: `src/resources/material/tests/material-barrel.test.ts`
- Rename + modify: `src/runtime/tests/typography-and-dynamic-scheme.test.ts` → `src/runtime/tests/typography.test.ts`
- Modify: `src/resources/pragmatic/tests/controls-themeselector.test.ts`

**Interfaces:**
- Consumes: nothing new. Task 2 already removed the only source consumer of `makeDynamicScheme`.
- Produces: a `resources/material` barrel with no dynamic-scheme exports; Material registration unchanged.

- [ ] **Step 1: Write the failing barrel test**

Create `src/resources/material/tests/material-barrel.test.ts`:

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ThemeManager } from '../../../runtime/index.js';
import * as MaterialBarrel from '../index.js';

describe('resources/material barrel — intact after dynamic-scheme removal', () =>
{
    test('still registers Material and exports its theme/scheme classes', () =>
    {
        assert.ok(ThemeManager.GetTheme('Material') !== undefined, 'Material registered');
        assert.ok('Material' in MaterialBarrel, 'exports Material');
        assert.ok('MaterialLight' in MaterialBarrel, 'exports MaterialLight');
        assert.ok('MaterialDark' in MaterialBarrel, 'exports MaterialDark');
        assert.ok('SetTheme' in MaterialBarrel, 'exports SetTheme');
    });

    test('no longer exports the retired dynamic-scheme API', () =>
    {
        assert.ok(!('makeDynamicScheme' in MaterialBarrel), 'makeDynamicScheme gone');
        assert.ok(!('makeDynamicLightDarkPair' in MaterialBarrel), 'makeDynamicLightDarkPair gone');
        assert.ok(!('DynamicSchemeVariant' in MaterialBarrel), 'DynamicSchemeVariant gone');
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit src/resources/material/tests/material-barrel.test.ts`
Expected: the first test PASSES; the second FAILS (`makeDynamicScheme gone` — it is still exported).

- [ ] **Step 3: Remove the dynamic-scheme re-exports from the material barrel**

In `src/resources/material/index.ts`, delete the entire re-export block:

```ts
export {
    DynamicSchemeVariant,
    makeDynamicScheme,
    makeDynamicLightDarkPair,
    type DynamicSchemeOptions,
} from './dynamic-scheme.js';
```

Leave the `Material`/`MaterialLight`/`MaterialDark`/`SetTheme`/`CurrentTheme`/`ToggleTheme`/`MaterialThemeName` export intact.

- [ ] **Step 4: Rewrite the runtime test to typography-only**

Rename `src/runtime/tests/typography-and-dynamic-scheme.test.ts` to `src/runtime/tests/typography.test.ts` (`git mv`), then edit it to:
- delete the `import { DynamicSchemeVariant, makeDynamicScheme, makeDynamicLightDarkPair } from '../../resources/material/dynamic-scheme.js';` block,
- delete the whole `describe('§ 17.13 — makeDynamicScheme', …)` block,
- change the top import to `import { Typography } from '../index.js';` (drop the now-unused `Color`),
- delete the `import { SolidColorBrush } from '../../visual-engine/index.js';` line (now unused).

Only the `describe('§ 17.10 — Typography', …)` block remains.

- [ ] **Step 5: Delete the module**

```bash
git rm src/resources/material/dynamic-scheme.ts
```

- [ ] **Step 6: Update the stale deferral comment**

In `src/resources/pragmatic/tests/controls-themeselector.test.ts`, update the header comment that says the "Custom-seed / makeDynamicScheme retirement … is deferred as a user-facing decision" to note the retirement is complete (dynamic-scheme removed; ThemeSelector offers built-ins only). Adjust any assertion that referenced a deferred Custom flow if present.

- [ ] **Step 7: Verify no dangling references, then run the affected tests + typecheck**

```bash
grep -rn "dynamic-scheme\|makeDynamicScheme\|makeDynamicLightDarkPair\|DynamicSchemeVariant\|DynamicSchemeOptions" src --include='*.ts'
```
Expected: no matches.

Run:
`npx tsx --conditions=development --test --test-force-exit src/resources/material/tests/material-barrel.test.ts src/runtime/tests/typography.test.ts`
Expected: PASS.
`npm run typecheck`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(theme): delete dynamic-scheme generator; typography test split

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Version bump, clean build, and built-artifact delivery verification

**Files:**
- Modify: `package.json` (`version`)

**Interfaces:**
- Consumes: the whole tree from Tasks 1–3.
- Produces: `mural@0.56.0` source ready to publish; proof that the built `dist` artifact ships and registers Pragmatic (Review Focus 1 / 4).

- [ ] **Step 1: Run the full suite (pre-release gate)**

Run: `npm test`
Expected: green — no failures introduced by Tasks 1–3 (baseline was 5508/5505/0/3; this sub-project adds tests and removes the 5 dynamic-scheme cases).

- [ ] **Step 2: Bump the version**

In `package.json`, change `"version": "0.55.18"` to `"version": "0.56.0"`.

- [ ] **Step 3: Clean build**

Run: `npm run build`
Expected: completes; `build:templates` reports the compiled `.mu` files and `tsc` exits 0.

- [ ] **Step 4: Verify the built artifact ships and registers Pragmatic**

Run (from the Mural repo root):

```bash
node --input-type=module -e "import('./dist/resources/pragmatic/index.js').then(async () => { const { ThemeManager } = await import('./dist/runtime/index.js'); const t = ThemeManager.GetTheme('Pragmatic'); if (!t) { console.error('FAIL: Pragmatic not registered from dist'); process.exit(1); } if (!t.schemes.has('PragmaticLight') || !t.schemes.has('PragmaticDark')) { console.error('FAIL: dist schemes missing'); process.exit(1); } console.log('OK: dist artifact registers Pragmatic + schemes'); })"
```

Expected: `OK: dist artifact registers Pragmatic + schemes`, exit 0. Also confirm the files exist:

```bash
ls dist/resources/pragmatic/index.js dist/resources/pragmatic/index.d.ts
```
Expected: both listed. (This is the Review Focus 1/4 gate — it exercises the `default`/dist path a real consumer uses.)

- [ ] **Step 5: Commit the release**

```bash
git add package.json
git commit -m "release: mural 0.56.0

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 6: STOP — the push and publish are human-gated**

Do **not** push or `npm publish` from within task execution. After the final whole-branch review, the finish flow presents the integration menu; the push (delivering the local commits to origin) and the subsequent `npm publish` to the `@pragmatic-tech-ai` registry each require explicit human confirmation at that point. Leave the branch ready and report that D4's push/publish awaits the gate.

---

## Notes for the executor

- After the last task, run the whole-branch review (most capable available model) against the spec's Review Focus, then use superpowers:finishing-a-development-branch. Base branch is `main`.
- The publish/push (spec D4) is deliberately **not** an auto-run step. Surface it at the finish gate: merging or pushing this branch, then publishing `mural@0.56.0`, is what actually delivers Pragmatic to Plexus/TODL (sub-projects 2–3), and both actions are the human's explicit call.
