# MenuItem command-source teardown (mural 0.61.4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Detach a `MenuItem`'s `CanExecuteChanged` listener when its container is cleared, so churning data-templated / context command menus stop retaining `MenuItem` subtrees; ship as mural 0.61.4 and adopt it in Plexus.

**Architecture:** mural 0.61.3 made `MenuItem` subscribe to its command via `CommandSourceHelper`, but nothing calls the helper's `dispose()`. The fix adds a dispose on the per-item teardown seam `MenuContainerFactory.ClearContainer` (the shared choke point for `MenuStrip`, `ContextMenu`, and parent `MenuItem` owners), via a small public method on `MenuItem`. The helper is reusable — `dispose()` only removes the listener and nulls `_attachedCommand`, so a recycled container re-attaches when its `Command` is re-set on rebind. This is mural#5.

**Tech Stack:** mural (TS, `node:test` via `tsx --test`), Plexus (vitest), GitHub Packages registry.

**Spec:** mural#5 (`https://github.com/pragmatic-tech-ai/mural/issues/5`) and the final-review finding in `Plexus/.superpowers/sdd/2026-10-04-c2-wave5-finish/progress.md`. User authorized (2026-10-04) fixing it now with a new mural release + Plexus adoption; push + publish authorized.

## Global Constraints

- House style: OOP (no module-level free functions/data); Allman braces (opening brace own line for class/method/getter/setter + every control-flow block; else/catch/finally own line; inline OK only for one-line `if (x) return;`, object literals, block-bodied arrows); PascalCase interfaces + public methods; real enums; disposers typed IDisposable. Match surrounding file style.
- Generated `*.mu.js` are build output — never hand-edit. Tests in `tests/` subfolders.
- mural repo `C:\Users\Eugene\Projects\architecture-agent\Mural`, branch `main` (work directly on main; push + publish authorized). Commands: one file `npm run test:file -- <path>`; full `npm test`; typecheck `npm run typecheck`. Publish: GitHub Packages, `PACKAGES_TOKEN` env (already set); `.npmrc` reads it.
- Plexus repo `C:\Users\Eugene\Projects\architecture-agent\Plexus`, branch `c2-wave5-finish-2` off `main` (currently `90bdf90`), merged to main + pushed in Task 3. Gate: `npm run -w @pragmatic-tech-ai/plexus-core build`; `npm run -w @pragmatic-tech-ai/plexus typecheck:node` + `typecheck:web`; `npm run -w @pragmatic-tech-ai/plexus test`.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Review Focus

- **Recycle re-attach:** after a container is cleared (dispose) and later re-Prepared with a new/other command, `IsEnabled` must again track the new command — the listener must re-attach, not stay dead. Task 1 tests clear-then-rebind.
- **No double-detach / no over-eager dispose:** disposing on container clear must NOT break a MenuItem that is merely having its submenu popup re-mounted (popup mount/unmount is a different path — `ClearContainer` is only the items-removal seam). Task 1 asserts a static item's listener survives a submenu open/close.
- **Authored own-container MenuItems** (`_itemsControlData === container`) are intentionally NOT disposed here (same early-return the factory already uses for DataContext) — they are author-declared/static; note this limitation, don't "fix" it.

---

### Task 1: mural — dispose MenuItem command-source on container clear

**Files:**
- Modify: `Mural/src/framework/menu/menu-strip.ts` — `MenuItem` class (~L171; `_commandSource` at ~L230; `ClearContainerForItemOverride` at ~L461). Add a public `DisposeCommandSource()` method.
- Modify: `Mural/src/framework/menu/menu-container-factory.ts` — `ClearContainer` (L84-100).
- Modify (stale comment): `Mural/src/framework/menu/tests/command-context-menu-lifecycle.test.ts` (~L170-185) — a comment asserts "MenuItem does not itself subscribe to Command.CanExecuteChanged (no CommandSourceHelper wiring exists on MenuItem today)", now wrong. Correct it to reflect that MenuItem subscribes via CommandSourceHelper and is detached on container clear.
- Test: `Mural/src/framework/menu/tests/menu-item-command-teardown.test.ts` (new)

**Interfaces:**
- Consumes: `CommandSourceHelper.dispose()` (removes the CanExecuteChanged listener, nulls `_attachedCommand`; reusable — re-attaches on next `OnCommandChanged`). `CommandBase._listenerCount()` is `protected` (`src/runtime/command.ts:146`) — tests must expose it via a `RelayCommand` subclass.
- Produces: `MenuItem.DisposeCommandSource(): void` (public; detaches the command listener). `MenuContainerFactory.ClearContainer` calls it for generated MenuItem containers.

- [ ] **Step 1: Write the failing tests.** Create `menu-item-command-teardown.test.ts`:

```ts
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Panel, RelayCommand } from '../../../runtime/index.js';
import { MenuItem, MenuStrip } from '../menu-strip.js';

// Exposes the protected listener count so a leak is observable.
class CountingCommand extends RelayCommand
{
    public get ListenerCount(): number { return this._listenerCount(); }
}

class Root extends Panel {}

describe('MenuItem command-source teardown on container clear', () =>
{
    beforeEach(() => { initTestApp(); });

    test('DisposeCommandSource detaches the CanExecuteChanged listener', () =>
    {
        const cmd = new CountingCommand(() => {}, () => true);
        const mi = new MenuItem();
        mi.Command = cmd;
        assert.equal(cmd.ListenerCount, 1);
        mi.DisposeCommandSource();
        assert.equal(cmd.ListenerCount, 0);
    });

    test('ClearContainerForItemOverride disposes a generated container\'s command listener', () =>
    {
        const owner = new MenuStrip();
        const cmd = new CountingCommand(() => {}, () => true);
        const vm = {}; // stand-in item data (not the container itself)
        const child = new MenuItem();
        owner.PrepareContainerForItemOverride(child, vm, 0);
        child.Command = cmd;
        assert.equal(cmd.ListenerCount, 1);
        owner.ClearContainerForItemOverride(child, vm);
        assert.equal(cmd.ListenerCount, 0);
    });

    test('repeated prepare/clear cycles do not accumulate listeners', () =>
    {
        const owner = new MenuStrip();
        const cmd = new CountingCommand(() => {}, () => true);
        for (let i = 0; i < 5; i++)
        {
            const vm = {};
            const child = new MenuItem();
            owner.PrepareContainerForItemOverride(child, vm, i);
            child.Command = cmd;
            owner.ClearContainerForItemOverride(child, vm);
        }
        assert.equal(cmd.ListenerCount, 0);
    });

    test('a recycled container re-attaches when its Command is re-set after clear', () =>
    {
        const owner = new MenuStrip();
        const a = new CountingCommand(() => {}, () => true);
        const b = new CountingCommand(() => {}, () => false);
        const child = new MenuItem();
        const vm1 = {};
        owner.PrepareContainerForItemOverride(child, vm1, 0);
        child.Command = a;
        owner.ClearContainerForItemOverride(child, vm1);
        assert.equal(a.ListenerCount, 0);
        // reuse the same container for a new item + command
        const vm2 = {};
        owner.PrepareContainerForItemOverride(child, vm2, 0);
        child.Command = b;
        assert.equal(b.ListenerCount, 1);
        assert.equal(child.IsEnabled, false); // tracks b.CanExecute
    });

    test('a non-container-cleared item keeps its listener (static menu safety)', () =>
    {
        const root = new Root();
        const cmd = new CountingCommand(() => {}, () => true);
        const mi = new MenuItem();
        root.AddChild(mi);
        mi.Command = cmd;
        // open+close a submenu-style state change must NOT drop the listener
        mi.IsSubmenuOpen = true;
        mi.IsSubmenuOpen = false;
        assert.equal(cmd.ListenerCount, 1);
    });
});
```

*Note:* confirm the `RelayCommand` ctor shape (`new RelayCommand(execute, canExecute?, opts?)`) against `src/runtime/command.ts` and the existing `menu-item-command-enable.test.ts`; adapt the `CountingCommand` ctor/`_listenerCount` access if the protected name differs. If `PrepareContainerForItemOverride`'s signature differs (arg order/count), match the real one.

- [ ] **Step 2: Run to verify failure.** `cd Mural && npm run test:file -- src/framework/menu/tests/menu-item-command-teardown.test.ts`. Expected: `DisposeCommandSource is not a function` (method missing), and the ClearContainer/cycle tests fail because the listener stays at 1.

- [ ] **Step 3: Implement.** In `menu-strip.ts`, add a public method on `MenuItem` (near the command wiring / `syncIsEnabledFromCommand`):

```ts
// Detach the command's CanExecuteChanged listener. Called from the
// container-clear seam (MenuContainerFactory.ClearContainer) so a
// generated MenuItem recycled or removed from a churning data-templated
// menu stops being retained by a long-lived command. The helper is
// reusable — a later Command write re-attaches via OnCommandChanged.
public DisposeCommandSource(): void
{
    this._commandSource.dispose();
}
```

In `menu-container-factory.ts` `ClearContainer`, call it on the generated-container path (where `data` is the item VM, not the container). Add after the existing early-returns, alongside the DataContext/ItemsSource clears:

```ts
        container.DisposeCommandSource();
        container.DataContext = undefined;
        container.ItemsSource = undefined;
```

(`container` is already narrowed to `MenuItem` by the `instanceof` guard above; the `data === container` early-return keeps authored own-containers untouched, which is intended.)

Then fix the stale comment in `command-context-menu-lifecycle.test.ts`.

- [ ] **Step 4: Run tests + typecheck.**
  - `npm run test:file -- src/framework/menu/tests/menu-item-command-teardown.test.ts src/framework/menu/tests/menu-item-command-enable.test.ts src/framework/menu/tests/command-context-menu-lifecycle.test.ts src/framework/menu/tests/command-menu-rendering.test.ts src/framework/menu/tests/menu.test.ts src/framework/menu/tests/context-menu.test.ts src/framework/menu/tests/menu-button-template-swap.test.ts` — all PASS.
  - `npm run typecheck` — 0.
  - `npm test` — full suite green.
  - If the `recycled container re-attaches` test fails because clearing DataContext already nulled Command (so `b` is written while the helper was mid-state), investigate and report whether the DataContext-clear path already detaches — but keep the explicit dispose regardless (belt-and-suspenders; the test must end green).

- [ ] **Step 5: Commit.**

```bash
git add src/framework/menu/menu-strip.ts src/framework/menu/menu-container-factory.ts src/framework/menu/tests/menu-item-command-teardown.test.ts src/framework/menu/tests/command-context-menu-lifecycle.test.ts
git commit -m "fix(menu): detach MenuItem CanExecuteChanged listener on container clear (mural#5)"
```

---

### Task 2: mural — release 0.61.4

**Files:** `Mural/package.json` (0.61.3 → 0.61.4), `Mural/package-lock.json` (root `version` + `packages[""].version` only).

- [ ] **Step 1:** Bump via `npm version 0.61.4 --no-git-tag-version`; confirm the diff is only package.json + the two lock version fields (discard any unrelated lock re-resolution hunks).
- [ ] **Step 2:** GATE (must pass before release): `npm run typecheck` (0) + `npm test` (green). On red, STOP (BLOCKED), do not publish.
- [ ] **Step 3:** `git commit -am "release: mural v0.61.4 (MenuItem command-listener teardown — mural#5)"`. Leave untracked files alone.
- [ ] **Step 4:** `git push origin main`.
- [ ] **Step 5:** `npm publish`; verify `npm view @pragmatic-tech-ai/mural@0.61.4 version --registry https://npm.pkg.github.com` prints `0.61.4`. On publish failure, report the error verbatim and STOP.

---

### Task 3: Plexus — adopt 0.61.4, merge, push

**Files:** `Plexus/apps/plexus/package.json` + `Plexus/packages/plexus-core/package.json` (mural ranges `^0.61.3` → `^0.61.4`), `Plexus/package-lock.json` (via `npm install`).

- [ ] **Step 1:** `cd Plexus && git checkout -b c2-wave5-finish-2` (off `main` @ 90bdf90).
- [ ] **Step 2:** Bump the four mural ranges to `^0.61.4`; `npm install` from the Plexus root. Confirm `apps/plexus/node_modules/@pragmatic-tech-ai/mural/package.json` and `packages/plexus-core/node_modules/.../mural/package.json` report `0.61.4`. If `npm install` broke the workspace symlinks (`node_modules/@pragmatic-tech-ai/plexus-core` etc.), restore them (see memory `project_workspace_symlinks_and_prettier`) and record what you did.
- [ ] **Step 3: GATE:** `npm run -w @pragmatic-tech-ai/plexus-core build` (tsc 0 + compile:mu); `npm run -w @pragmatic-tech-ai/plexus typecheck:node` (0); `typecheck:web` (0); `npm run -w @pragmatic-tech-ai/plexus test` (green — pretest compile:mu runs first). No source change expected; this proves 0.61.4 is drop-in.
- [ ] **Step 4: Commit on branch:**

```bash
git add apps/plexus/package.json packages/plexus-core/package.json package-lock.json
git commit -m "chore(deps): adopt mural 0.61.4 (MenuItem command-listener teardown)"
```

- [ ] **Step 5: Merge + push.** `git checkout main && git merge --no-ff c2-wave5-finish-2 -m "Merge c2-wave5-finish-2: adopt mural 0.61.4 (MenuItem listener teardown)"`; `git push origin main`; `git branch -d c2-wave5-finish-2`. Verify local `main` == `origin/main`.
- [ ] **Step 6:** Comment on mural#5 that it's fixed (mural 0.61.4 + Plexus merge sha) and close it; note on plexus#5 that the follow-up spotted during item 3 is resolved.
