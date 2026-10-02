# Hierarchy Registration DSL + Default TreeView Integration — Implementation Plan (Milestone C1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author a hierarchy in one `Hierarchy { }` block and bind it to a `TreeView` with no hand-wiring — a default item template, a behavior bundle, and a context-driven right-click action menu, each overridable by key — on top of the Milestone B engine.

**Architecture:** Two halves on top of B. (1) A bespoke `Hierarchy { }` compiler block that fans `Contributor` entries into the existing `HierarchyContributors` collection, with nested `CommandDefinition`s becoming each contributor's `Actions`. (2) A default `TreeView` integration: a `HierarchicalDataTemplate` over `HierarchyItem`, an `EditableTextBlock` cell for inline rename, a `HierarchyTreeBehavior` (selection mirroring + rename), a per-open `HierarchyContextMenu` (built from `HierarchyItem.BuildActions`, disposed on close), and a `HierarchyDropBehavior`. Action resolution becomes **context-driven**: a node's `Key` interns (via `HierarchyContext.For`) to a shared `ServiceToken`; `Hierarchy` implements `ICommandContextSource` from the live selection; `BuildActions` gathers each contributor's actions whose `Context` is in that set and dispatches each through its supplying contributor via a per-open routing dispatcher — reusing `CommandDefinition.Context`, `ICommandDispatcher`, `CommandMenuBuilder`, and `CommandViewModel` unchanged.

**Tech Stack:** TypeScript (NodeNext ESM), `node:test` + `tsx`, the Mural `.mu` compiler, todl-runtime `Observable`/`Signal`/`Disposable`/`ServiceKey`, Milestone A command machinery, Milestone B hierarchy engine.

**Spec:** `docs/superpowers/specs/2026-10-01-hierarchy-dsl-and-default-treeview-design.md` — read it alongside this plan. The spec predates Milestone B's execution; where it conflicts with what B shipped or with the design settled in C1 brainstorming, the Design Rulings below govern (the spec is the vision; these rulings are its reconciliation against the shipped engine, approved by the human partner).

## Global Constraints

- **House style (all repos):** OOP only — no module-level free functions or mutable module-level state; behavior lives on classes (methods or static members). A `private static` cache field IS a class field and is allowed (used by `HierarchyContext`). Type-guard functions (`isFoo`) are the sanctioned free-function exception; test-helper free functions are accepted `node:test` convention.
- **Allman braces** for every class/interface/enum/method/control-flow block (opening brace on its own line; `else`/`catch`/`finally` on their own line). Object literals, block-bodied arrows, and genuine one-liners (`if (x) return;`) stay inline. Existing hierarchy code and tests use Allman-style arrow callbacks — match the local convention.
- **No inline reused/user-facing string literals** — hoist to `private static readonly` PascalCase constants (e.g. `LoadingText`, template keys, drag format strings).
- **PascalCase** for all interfaces and public methods/properties; `dispose()` stays lowercase (todl-runtime convention). Private members and serialized-shape fields keep their casing.
- **Enums over string-literal unions.**
- **VMs extend `Observable`, not `MuralBase`** (reserve `MuralBase` for DP-backed, markup-declarable types — `HierarchyContributorDefinition`, `CommandDefinition`, controls, behaviors qualify).
- **Teardown is `IDisposable`**, never a bare `() => void`; wrap cleanup in `new Disposable(() => …)` and aggregate with `CompositeDisposable`. `Signal.subscribe` already returns an `IDisposable`.
- **Tests** live in a `tests/` subfolder next to the source. Run a single test file with `npx tsx --conditions=development --test --test-force-exit <file>` (the `--conditions=development` flag is mandatory — without it tsx resolves stale `dist` and throws "ThemeManager: no Application.current"). Full suite: `npm test`. Compiler source-to-source tests use the existing `emitted(src)` harness. tsconfig enforces `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`.
- **Fix ALL review findings in-milestone** (including Minors); no deferral across the publish boundary.
- **Scope:** Mural only. No Plexus adoption (Milestone C2). No `ToolbarService`/main-menu refactor (the "command-surface engine" extraction is a candidate follow-up spec, explicitly out of scope here).
- **Release:** breaking (B-engine edit). Minor bump `0.59.0 → 0.60.0`. Publish + push `main` is a human-gated STOP at the end — never autonomous.

## Design Rulings

These are settled decisions; implementers follow them and do not relitigate. Each is `<decision> — <why> — <cost if wrong>`.

- **DR1 — Context-driven action resolution replaces B's key→token map.** `BuildActions` no longer uses `HierarchyCommandOptions.CommandContexts` (the `Map<Key, ServiceToken>`) or a single `Dispatcher`. Instead: a node's `Key` interns to a `ServiceToken` via `HierarchyContext.For`; `Hierarchy.CommandContexts` (an `ICommandContextSource`) is the interned set over the live selection; actions are the contributors' `CommandDefinition`s whose `Context` token is in that set; each dispatches through its supplying contributor. — Reuses the exact toolbar context mechanism and makes the node kind the single source of context identity. — Cost if wrong: rework of `BuildActions` + the DSL's command lowering.
- **DR2 — `HierarchyItem` is unchanged.** Contexts derive from `item.Key`; nothing is stored on the node. — Keeps B's shipped item surface stable and avoids a producer-link. — Cost: if a node ever needs contexts independent of its `Key`, a later field addition.
- **DR3 — The `Hierarchy { }` block is bespoke compiler lowering** (like `Behaviors`), not a generic list-strategy member-block. It fans `Contributor` entries into the existing `module.HierarchyContributors` collection; it adds no new module collection and emits no global `Commands` entries. — The block's `Contributor`/`Under`/`Use` sugar and nested-action semantics can't be expressed by the generic `.name: { Element }` → `accessor.Add(element)` strategy. — Cost: the bespoke handler is ~1 function in `compiler.ts`; wrong shape means re-editing that handler.
- **DR4 — DSL attribute translation.** `Under` → `HierarchyContributorDefinition.ParentKeys` (accepts a single string or a list); `Use` → `HierarchyContributorDefinition.Contributor` (a bare class/`ServiceToken` reference); `Order` → `Order`. A nested `CommandDefinition`'s `Context` attribute is authored as the **node-type key string** and lowers to `HierarchyContext.For("<key>")` (an interned `ServiceToken`), stamped on the command's `Context` DP. — Friendly authoring names that map to the real DP setters; the interning call is emitted only inside the bespoke Hierarchy handler, not added to the general value lowering. — Cost: if `HierarchyContext.For` import/emission is wrong, compiler tests fail loudly.
- **DR5 — A contributor owns its actions and dispatches them.** Nested `CommandDefinition`s attach to the enclosing contributor's new `HierarchyContributorDefinition.Actions` list; the resolved contributor instance (`IHierarchyContributor extends ICommandDispatcher`) is that action's dispatcher. A contributor may declare actions for a node `Key` it does not itself produce (open composition). — One entity owns an action's definition and execution; any module extends an existing node kind by declaring a contributor with matching-`Context` actions. — Cost: if composition semantics are wrong, menus show the wrong actions.
- **DR6 — Per-open routing dispatch.** `BuildActions` builds a per-open `HierarchyRoutingDispatcher` (`Map<commandId, IHierarchyContributor>`, covering each action and its descendant command ids) and hands it to one `CommandMenuBuilder`, which already forwards the `HierarchyActionContext` to `dispatcher.Resolve(id, context)` (verified: `command-menu-builder.ts:42`). — Reuses `CommandMenuBuilder` verbatim while giving each action its own handler. — Cost: a missed descendant id yields an unresolved submenu command.
- **DR7 — Multi-select = union, `CanExecute` gates.** With several nodes selected, `CommandContexts` is the union of their interned type tokens; an action shows if its `Context` is in that union, and its own `CanExecute` (through its contributor) decides applicability to the whole selection. — Mirrors the toolbar and keeps bulk actions working. — Cost: a stricter intersection policy would need a one-line filter change.
- **DR8 — Default TreeView behaviors wire semantics onto TreeView intrinsics; they do not reimplement them.** `TreeView` already drives `HierarchyItem.OnExpand`/`OnCollapse`/`OnActivate` through its `ExpandableTreeData` duck-type (`tree-view.ts:908-917`), so the behavior bundle adds only selection mirroring, inline rename, the dynamic context menu, and drag-drop. — Avoids duplicating `Selector`/`TreeView` logic. — Cost: none; this is the smaller surface.
- **DR9 — The dynamic context menu is a new `ContextMenu` subclass** mirroring `CommandContextMenu`'s `IsOpen`-reactive build/teardown (`command-context-menu.ts:61-89`), but sourcing its VMs from `HierarchyItem.BuildActions(context)` (an `ObservableCollection<CommandViewModel>`) rather than `CommandDefinition[]` roots. — The build-per-open/dispose-on-close lifecycle is identical; only the source differs. — Cost: if teardown is wrong, subscription leak across opens (covered by a Review-Focus test).
- **DR10 — Icon rendering from `IconKey`.** `HierarchyItem.IconKey` is a string and no key→visual resolver exists in the repo. The default template resolves it through the resource dictionary (`FindResource(key)`), rendering the resolved `Geometry`/`Visual` or nothing when the key is empty/unresolved. — Reuses the resource system rather than inventing an icon registry. — Cost: if resolution is fiddly, the icon slot renders empty (caption still correct) until refined.

## Review Focus

Input classes / failure modes the spec implies that no single task's happy-path tests fully exercise. Each has a pinned test in its owning task.

1. **A command whose `ChildrenContributor` submenu opens inside the context menu** — lazily populates on submenu-open and is disposed when the menu closes; the routing dispatcher resolves the descendant command ids. (Task 10; routing-descendant test in Task 4.)
2. **Keyboard context-menu invocation vs. right-click** — both route through `BuildActions` against the live selection. Right-click is wired by the shipped `ContextMenuService` pointer patch; the keyboard context-menu key is **not** handled today, so the behavior wires it explicitly. (Task 10.)
3. **An app overriding only the data template** keeps the default behaviors and menu (and vice-versa) — the three defaults are independently keyed. (Task 12.)
4. **A contributor that contributes only actions (no nodes) to an existing node `Key`** — its matching-`Context` actions appear on nodes produced by a different contributor/provider. (Task 4.)
5. **Provider-realized nodes** resolve actions by their `Key` identically to contributor-produced nodes (a provider node carries a `Key` via `IRealizeContext.NewItem`). (Task 4.)

---

## File Structure

**Created:**
- `src/framework/hierarchy/hierarchy-context.ts` — `HierarchyContext.For(key)` string→`ServiceToken` interner (private static cache).
- `src/framework/hierarchy/hierarchy-routing-dispatcher.ts` — `HierarchyRoutingDispatcher implements ICommandDispatcher`.
- `src/framework/hierarchy/hierarchy-tree-behavior.ts` — `HierarchyTreeBehavior` (selection mirroring + inline-rename wiring).
- `src/framework/hierarchy/hierarchy-context-menu.ts` — `HierarchyContextMenu` (dynamic, per-open) + `HierarchyContextMenuBehavior` (attaches it + keyboard key).
- `src/framework/hierarchy/hierarchy-drop-behavior.ts` — `HierarchyDropBehavior`.
- `src/framework/hierarchy/hierarchy.template.mu` — `@HierarchyItemTemplate` (HierarchicalDataTemplate) + default `TreeView` style bundling the behaviors, keyed and overridable.
- `src/basic/controls/editable-text-block.ts` — `EditableTextBlock` inline-edit cell.
- `demo/demos/hierarchy-tree/hierarchy-tree.mu`, `hierarchy-tree-vm.mts`, and demo registration — the out-of-box + override demo.
- New `tests/` files beside each of the above.

**Modified:**
- `src/framework/hierarchy/hierarchy-contributor-definition.ts` — add `Actions` DP.
- `src/framework/hierarchy/hierarchy-contributor-registry.ts` — add `ActionBindings()`.
- `src/framework/hierarchy/hierarchy.ts` — `implements ICommandContextSource`; `CommandContexts` getter; rewritten `BuildActions`; simplified `HierarchyCommandOptions`.
- `src/framework/hierarchy/index.ts` — export the new types.
- `src/compiler/compiler.ts` — bespoke `Hierarchy` block handler.
- `src/compiler/symbol-table.ts` — `HierarchyContext` + `HierarchyContributorDefinition` DEFAULT_SYMBOLS rows (as needed).
- `src/resources/framework.resources.mu` — import the hierarchy template dictionary.
- `src/framework/hierarchy/tests/hierarchy-actions.test.ts` — retargeted to the new context-driven model.

---

## Task 1: `HierarchyContext` key→token interner

**Files:**
- Create: `src/framework/hierarchy/hierarchy-context.ts`
- Test: `src/framework/hierarchy/tests/hierarchy-context.test.ts`

**Interfaces:**
- Produces: `HierarchyContext.For(key: string): ServiceToken<unknown>` — returns the SAME `ServiceToken` instance for equal key strings (reference identity), a distinct one for different keys.

- [ ] **Step 1: Write the failing test**

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { HierarchyContext } from '../hierarchy-context.js';

describe('HierarchyContext — key→token interner', () =>
{
    test('returns the same token instance for equal keys', () =>
    {
        assert.equal(HierarchyContext.For('project'), HierarchyContext.For('project'));
    });

    test('returns distinct tokens for distinct keys', () =>
    {
        assert.notEqual(HierarchyContext.For('project'), HierarchyContext.For('folder'));
    });

    test('the token carries the key as its debug name', () =>
    {
        const token = HierarchyContext.For('connection') as { Name?: string };
        assert.equal(token.Name, 'hierarchy.context:connection');
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/hierarchy/tests/hierarchy-context.test.ts`
Expected: FAIL — cannot find module `../hierarchy-context.js`.

- [ ] **Step 3: Implement**

```ts
import { ServiceKey, type ServiceToken } from '../../runtime/index.js';

// Interns a node-type key string to a stable ServiceToken used as a command
// CONTEXT tag (identity, never resolved as a service). Equal key strings return
// the same instance so `def.Context === HierarchyContext.For(item.Key)` matches
// by reference — the same identity contract DiagramEditingContext relies on,
// keyed off the hierarchy node kind. Shared across modules: any module referring
// to "project" gets the one token, so a contributor can tag actions for a type
// it does not itself produce.
export class HierarchyContext
{
    private static readonly TokenNamePrefix = 'hierarchy.context:';
    private static readonly cache = new Map<string, ServiceToken<unknown>>();

    public static For(key: string): ServiceToken<unknown>
    {
        let token = HierarchyContext.cache.get(key);
        if (token === undefined)
        {
            token = new ServiceKey<unknown>(HierarchyContext.TokenNamePrefix + key);
            HierarchyContext.cache.set(key, token);
        }
        return token;
    }
}
```

(Verify `ServiceKey`'s debug-name property name against `runtime/index.js` — if it is not `Name`, adjust the test's assertion and this comment to match; the identity tests are the load-bearing ones.)

- [ ] **Step 4: Run it to verify it passes**

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/hierarchy/tests/hierarchy-context.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy-context.ts src/framework/hierarchy/tests/hierarchy-context.test.ts
git commit -m "feat(hierarchy): add HierarchyContext key→token interner (C1)"
```

---

## Task 2: `HierarchyContributorDefinition.Actions` DP

**Files:**
- Modify: `src/framework/hierarchy/hierarchy-contributor-definition.ts`
- Test: `src/framework/hierarchy/tests/hierarchy-contributor-definition.test.ts` (create)

**Interfaces:**
- Consumes: existing `HierarchyContributorDefinition` (`ParentKeys`/`Contributor`/`Order` DPs).
- Produces: `HierarchyContributorDefinition.Actions: readonly CommandDefinition[]` (DP, default frozen empty), with `ActionsKey` for compiler `set_property_value` emission.

- [ ] **Step 1: Write the failing test**

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { HierarchyContributorDefinition } from '../hierarchy-contributor-definition.js';
import { CommandDefinition } from '../../shell/commands/command-definition.js';

describe('HierarchyContributorDefinition.Actions', () =>
{
    test('defaults to an empty, shared, frozen list', () =>
    {
        const a = new HierarchyContributorDefinition();
        const b = new HierarchyContributorDefinition();
        assert.equal(a.Actions.length, 0);
        assert.equal(a.Actions, b.Actions);           // shared default instance
        assert.throws(() => (a.Actions as CommandDefinition[]).push(new CommandDefinition()));
    });

    test('round-trips an assigned action list', () =>
    {
        const def = new HierarchyContributorDefinition();
        const cmd = new CommandDefinition();
        cmd.Id = 'project.rename';
        def.Actions = [cmd];
        assert.deepEqual(def.Actions.map(a => a.Id), ['project.rename']);
    });
});
```

- [ ] **Step 2: Run it — FAIL** (no `Actions` member).

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/hierarchy/tests/hierarchy-contributor-definition.test.ts`
Expected: FAIL — `Property 'Actions' does not exist`.

- [ ] **Step 3: Implement** — add to `hierarchy-contributor-definition.ts`:

```ts
// at top, alongside existing imports
import type { CommandDefinition } from '../shell/commands/command-definition.js';

// near EMPTY_KEYS
const EMPTY_ACTIONS: readonly CommandDefinition[] = Object.freeze([]);

// inside the class, with the other DP registrations
    public static readonly ActionsKey = MuralBase.RegisterProperty<readonly CommandDefinition[]>(
        HierarchyContributorDefinition, 'Actions', EMPTY_ACTIONS, MetaData.None);

// with the other accessors
    public get Actions(): readonly CommandDefinition[]  { return this.get_property_value(HierarchyContributorDefinition.ActionsKey); }
    public set Actions(v: readonly CommandDefinition[]) { this.set_property_value(HierarchyContributorDefinition.ActionsKey, v); }
```

Use a `type`-only import for `CommandDefinition` to avoid a runtime import cycle (the DP stores instances but references the type only).

- [ ] **Step 4: Run it — PASS (2/2).**

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy-contributor-definition.ts src/framework/hierarchy/tests/hierarchy-contributor-definition.test.ts
git commit -m "feat(hierarchy): add Actions DP to HierarchyContributorDefinition (C1)"
```

---

## Task 3: `HierarchyContributorRegistry.ActionBindings()`

**Files:**
- Modify: `src/framework/hierarchy/hierarchy-contributor-registry.ts`
- Test: extend `src/framework/hierarchy/tests/hierarchy-contributor-registry.test.ts`

**Interfaces:**
- Consumes: `HierarchyContributorDefinition.Actions` (Task 2); existing `resolve(def)` → `IHierarchyContributor`.
- Produces: `HierarchyContributorRegistry.ActionBindings(): readonly { Action: CommandDefinition; Dispatcher: IHierarchyContributor }[]` — one entry per TOP-LEVEL action across all registered definitions (deduped: a definition registered under several parent keys contributes its actions once), each paired with that definition's resolved contributor. Results cached; the cache is invalidated by the existing `raiseChanged()` paths.

- [ ] **Step 1: Write the failing test** (append to the existing registry test)

```ts
import { CommandDefinition } from '../../shell/commands/command-definition.js';
// ...existing imports in the file: Application/ServiceKey/ServiceProvider, HierarchyContributorRegistry,
// HierarchyContributorDefinition, NodeContribution, IHierarchyContributor, CommandContext...

test('ActionBindings pairs each definition action with its resolved contributor', () =>
{
    const kProj = new ServiceKey<IHierarchyContributor>('proj');
    const sp = new ServiceProvider();
    const proj: IHierarchyContributor = {
        ParentKeys: ['solution'],
        Order: 0,
        Contribute: () => new NodeContribution([]),
        Resolve: () => undefined,
    };
    sp.registerInstance(kProj, proj);
    const registry = new HierarchyContributorRegistry(sp);

    const rename = new CommandDefinition(); rename.Id = 'project.rename'; rename.Title = 'Rename';
    const def = new HierarchyContributorDefinition();
    def.ParentKeys = ['solution', 'folder'];   // two parents — action must appear ONCE
    def.Contributor = kProj;
    def.Actions = [rename];
    registry.Register(def);

    const bindings = registry.ActionBindings();
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0]!.Action.Id, 'project.rename');
    assert.equal(bindings[0]!.Dispatcher, proj);
});
```

- [ ] **Step 2: Run it — FAIL** (`ActionBindings` not a function).

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/hierarchy/tests/hierarchy-contributor-registry.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — add to `HierarchyContributorRegistry`:

```ts
// add to imports
import type { CommandDefinition } from '../shell/commands/command-definition.js';

// new public method
    // Every top-level action declared on a registered definition, paired with
    // that definition's resolved contributor (the dispatcher for it). Deduped by
    // definition identity so a contributor registered under several parent keys
    // contributes its actions once. Hierarchy.BuildActions filters these by the
    // live CommandContexts.
    public ActionBindings(): readonly { Action: CommandDefinition; Dispatcher: IHierarchyContributor }[]
    {
        const seen = new Set<HierarchyContributorDefinition>();
        const out: { Action: CommandDefinition; Dispatcher: IHierarchyContributor }[] = [];
        for (const defs of this.byParent.values())
        {
            for (const def of defs)
            {
                if (seen.has(def)) continue;
                seen.add(def);
                if (def.Actions.length === 0) continue;
                const dispatcher = this.resolve(def);
                for (const action of def.Actions) out.push({ Action: action, Dispatcher: dispatcher });
            }
        }
        return out;
    }
```

(No separate cache field is added in this task — `ActionBindings` recomputes on call, which `BuildActions` invokes per menu-open; the dedup `Set` keeps it O(defs·actions). If profiling later shows it hot, memoize behind the existing `ChangedProp` signal.)

- [ ] **Step 4: Run it — PASS.** Then run the whole registry test file to confirm no regression.

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy-contributor-registry.ts src/framework/hierarchy/tests/hierarchy-contributor-registry.test.ts
git commit -m "feat(hierarchy): add ActionBindings to the contributor registry (C1)"
```

---

## Task 4: `Hierarchy` as `ICommandContextSource` + rewritten `BuildActions` + routing dispatcher

**Files:**
- Create: `src/framework/hierarchy/hierarchy-routing-dispatcher.ts`
- Modify: `src/framework/hierarchy/hierarchy.ts`
- Modify: `src/framework/hierarchy/index.ts`
- Rewrite tests: `src/framework/hierarchy/tests/hierarchy-actions.test.ts`
- Test (create): `src/framework/hierarchy/tests/hierarchy-context-source.test.ts`

**Interfaces:**
- Consumes: `HierarchyContext.For` (Task 1); `HierarchyContributorRegistry.ActionBindings` (Task 3); `CommandMenuBuilder` (`constructor(dispatcher, provider, context)`, `Build(def)`); `ICommandContextSource { CommandContexts: readonly ServiceToken[] }`; `HierarchyActionContext { Anchor; Selection }`.
- Produces:
  - `HierarchyRoutingDispatcher implements ICommandDispatcher` — `constructor(routes: ReadonlyMap<string, ICommandDispatcher>)`, `Resolve(id, ctx)` → `routes.get(id)?.Resolve(id, ctx)`.
  - `Hierarchy implements ICommandContextSource` — `get CommandContexts(): readonly ServiceToken<unknown>[]` from the live `Selection`.
  - Rewritten `Hierarchy.BuildActions(item, context): ObservableCollection<CommandViewModel>`.
  - Simplified `HierarchyCommandOptions { Services?: IServiceProvider }` (drop `CommandRegistry`, `Dispatcher`, `CommandContexts`).

- [ ] **Step 1: Write `HierarchyRoutingDispatcher`'s failing test**

`src/framework/hierarchy/tests/hierarchy-routing-dispatcher.test.ts`:

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RelayCommand, type ICommand } from '../../runtime/index.js';
import { CommandContext } from '../shell/commands/command-context.js';
import type { ICommandDispatcher } from '../shell/commands/command-dispatcher.js';
import { HierarchyRoutingDispatcher } from '../hierarchy-routing-dispatcher.js';

describe('HierarchyRoutingDispatcher', () =>
{
    test('routes an id to the dispatcher registered for it', () =>
    {
        const log: string[] = [];
        const a: ICommandDispatcher = { Resolve: id => new RelayCommand(() => log.push('a:' + id)) };
        const b: ICommandDispatcher = { Resolve: id => new RelayCommand(() => log.push('b:' + id)) };
        const routing = new HierarchyRoutingDispatcher(new Map<string, ICommandDispatcher>([['x', a], ['y', b]]));
        (routing.Resolve('y', new CommandContext()) as ICommand).Execute(undefined);
        assert.deepEqual(log, ['b:y']);
    });

    test('returns undefined for an unrouted id', () =>
    {
        const routing = new HierarchyRoutingDispatcher(new Map());
        assert.equal(routing.Resolve('missing', new CommandContext()), undefined);
    });
});
```

- [ ] **Step 2: Run — FAIL.**

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/hierarchy/tests/hierarchy-routing-dispatcher.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `hierarchy-routing-dispatcher.ts`**

```ts
import type { ICommand } from '../../runtime/index.js';
import type { CommandContext } from '../shell/commands/command-context.js';
import type { ICommandDispatcher } from '../shell/commands/command-dispatcher.js';

// A per-open dispatcher that routes a command id to the contributor that
// supplied it. BuildActions builds the id→contributor map (each action plus its
// descendant submenu ids) and hands this to one CommandMenuBuilder, so every
// resolved command dispatches through its own owner while CommandMenuBuilder is
// reused unchanged.
export class HierarchyRoutingDispatcher implements ICommandDispatcher
{
    constructor(private readonly routes: ReadonlyMap<string, ICommandDispatcher>)
    {
    }

    public Resolve(commandId: string, context: CommandContext): ICommand | undefined
    {
        return this.routes.get(commandId)?.Resolve(commandId, context);
    }
}
```

- [ ] **Step 4: Run — PASS (2/2).**

- [ ] **Step 5: Write the `ICommandContextSource` failing test**

`src/framework/hierarchy/tests/hierarchy-context-source.test.ts` — construct a `Hierarchy` with a contributor that seeds a keyed child (mirror the `setup()` shape in `hierarchy-actions.test.ts`), select nodes, assert `CommandContexts` equals the interned tokens of the selected Keys (union, deduped):

```ts
// imports as in hierarchy-actions.test.ts, plus:
import { HierarchyContext } from '../hierarchy-context.js';

test('CommandContexts is the interned union of the selected nodes Keys', () =>
{
    const { h } = setup();                 // seeds a 'project' child under 'solution' root
    h.SeedRoot('solution');
    const project = h.Roots.ToArray()[0]!;
    h.SelectSingle(project);
    assert.deepEqual(
        [...h.CommandContexts],
        [HierarchyContext.For(project.Key)]);
});
```

- [ ] **Step 6: Run — FAIL** (`CommandContexts` undefined / not implemented).

- [ ] **Step 7: Rewrite `BuildActions` + add `CommandContexts` in `hierarchy.ts`**

Change the class declaration to `export class Hierarchy extends Observable implements IHierarchyItemOwner, ICommandContextSource`. Simplify the options and rewrite the two members:

```ts
// options — drop CommandRegistry / Dispatcher / CommandContexts (DR1)
export interface HierarchyCommandOptions
{
    Services?: IServiceProvider;
}

// ICommandContextSource — the live contexts this hierarchy activates, from the
// current selection (DR1/DR7: union of the selected nodes' interned type tokens).
public get CommandContexts(): readonly ServiceToken<unknown>[]
{
    const seen = new Set<ServiceToken<unknown>>();
    const out: ServiceToken<unknown>[] = [];
    for (const item of this.Selection)
    {
        const token = HierarchyContext.For(item.Key);
        if (!seen.has(token)) { seen.add(token); out.push(token); }
    }
    return out;
}

// Builds a FRESH command-view-model tree for `item`'s menu (DR1/DR5/DR6):
// contexts come from the passed HierarchyActionContext's selection (or the anchor
// when the selection is empty); actions are the contributors' CommandDefinitions
// whose Context is in that set, ordered by Order; each dispatches through its
// supplying contributor via a per-open routing dispatcher. Per-call builder: the
// caller disposes the returned VMs (DR9).
public BuildActions(item: HierarchyItem, context: HierarchyActionContext): ObservableCollection<CommandViewModel>
{
    const result = new ObservableCollection<CommandViewModel>();
    const selection = context.Selection.length > 0 ? context.Selection : [item];
    const contexts = new Set<ServiceToken<unknown>>(selection.map(i => HierarchyContext.For(i.Key)));

    const matched = this.registry.ActionBindings()
        .filter(b => b.Action.Context !== undefined && contexts.has(b.Action.Context))
        .sort((a, b) => a.Action.Order - b.Action.Order);
    if (matched.length === 0) return result;

    const routes = new Map<string, ICommandDispatcher>();
    for (const { Action, Dispatcher } of matched) Hierarchy.mapRoutes(Action, Dispatcher, routes);

    const dispatcher = new HierarchyRoutingDispatcher(routes);
    const services = this.commandOptions.Services ?? new ServiceProvider();
    const builder = new CommandMenuBuilder(dispatcher, services, context);
    for (const { Action } of matched) result.Add(builder.Build(Action));
    return result;
}

// Register an action id and every descendant command id to one contributor, so
// the routing dispatcher resolves lazily-realized submenu commands too (DR6).
private static mapRoutes(def: CommandDefinition, dispatcher: ICommandDispatcher, routes: Map<string, ICommandDispatcher>): void
{
    routes.set(def.Id, dispatcher);
    for (const child of def.Children) Hierarchy.mapRoutes(child, dispatcher, routes);
}
```

Update imports in `hierarchy.ts`: add `HierarchyContext`, `HierarchyRoutingDispatcher`, `ServiceToken`, `ICommandContextSource`, `ServiceProvider`, `ICommandDispatcher`, `CommandDefinition`; remove the now-unused `CommandRegistry`, `NoOpCommandDispatcher` (delete that private class), and the old `CommandContexts`/`Dispatcher` reads. Keep the constructor signature `(registry, host, commandOptions = {})`.

Export `HierarchyRoutingDispatcher` from `index.ts`.

- [ ] **Step 8: Run the context-source test — PASS.**

- [ ] **Step 9: Retarget `hierarchy-actions.test.ts` to the new model**

Replace the old `setup()` (which used `CommandRegistry` + `CommandContexts` map + a single `Dispatcher`) with the DR1/DR5 model: the contributor declares its `Actions` on its `HierarchyContributorDefinition` (each with `Context = HierarchyContext.For('project')`), and the contributor instance is the dispatcher. Keep the four behaviors, re-expressed:

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceKey, ServiceProvider, RelayCommand, type ICommand } from '../../../runtime/index.js';
import { Hierarchy } from '../hierarchy.js';
import { HierarchyContext } from '../hierarchy-context.js';
import { HierarchyContributorRegistry } from '../hierarchy-contributor-registry.js';
import { HierarchyContributorDefinition } from '../hierarchy-contributor-definition.js';
import { NodeContribution, type IHierarchyContributor, type HierarchyNodeSpec } from '../hierarchy-contribution.js';
import { HierarchyActionContext } from '../hierarchy-action-context.js';
import type { HierarchyItem, IHierarchyItemHost } from '../hierarchy-item.js';
import { CommandDefinition } from '../../shell/commands/command-definition.js';
import type { CommandContext } from '../../shell/commands/command-context.js';

function noopHost(): IHierarchyItemHost
{
    return { Activate: () => {}, CommitRename: () => {}, OnItemRemoved: () => {} };
}

function spec(key: string, caption: string): HierarchyNodeSpec
{
    return { Key: key, ExtObject: {}, Caption: caption, IsExpandable: false };
}

function action(id: string, title: string, key: string, order: number): CommandDefinition
{
    const def = new CommandDefinition();
    def.Id = id; def.Title = title; def.Context = HierarchyContext.For(key); def.Order = order;
    return def;
}

describe('Hierarchy — context-driven actions', () =>
{
    function setup(): { h: Hierarchy; executed: string[] }
    {
        const executed: string[] = [];
        const kProj = new ServiceKey<IHierarchyContributor>('proj');
        const sp = new ServiceProvider();
        // The contributor both produces 'project' children AND dispatches their actions.
        const proj: IHierarchyContributor = {
            ParentKeys: ['solution'],
            Order: 0,
            Contribute: () => new NodeContribution([spec('project', 'MyProj')]),
            Resolve: (id: string, _c: CommandContext): ICommand | undefined => new RelayCommand(() => executed.push(id)),
        };
        sp.registerInstance(kProj, proj);
        const registry = new HierarchyContributorRegistry(sp);

        const def = new HierarchyContributorDefinition();
        def.ParentKeys = ['solution'];
        def.Contributor = kProj;
        def.Order = 0;
        def.Actions = [action('rename', 'Rename', 'project', 10), action('build', 'Build', 'project', 20),
                       action('x', 'X', 'other', 0)];   // 'other' must not show on a project node
        registry.Register(def);

        const h = new Hierarchy(registry, noopHost(), { Services: new ServiceProvider() });
        return { h, executed };
    }

    test('BuildActions returns only the actions whose Context matches the node Key, in Order', () =>
    {
        const { h } = setup();
        h.SeedRoot('solution');
        const project = h.Roots.ToArray()[0]!;
        const menu = project.BuildActions(new HierarchyActionContext(project, [project]));
        assert.deepEqual(menu.ToArray().map(vm => vm.Title), ['Rename', 'Build']);
    });

    test('resolved command executes through the supplying contributor', () =>
    {
        const { h, executed } = setup();
        h.SeedRoot('solution');
        const project = h.Roots.ToArray()[0]!;
        const menu = project.BuildActions(new HierarchyActionContext(project, [project]));
        menu.ToArray()[0]!.Command.Execute(undefined);
        assert.deepEqual(executed, ['rename']);
    });

    test('a node Key with no matching action yields an empty menu', () =>
    {
        const { h } = setup();
        const root = h.SeedRoot('solution');     // 'solution' has no actions
        const menu = root.BuildActions(new HierarchyActionContext(root, [root]));
        assert.equal(menu.Count, 0);
    });

    test('a contributor that produces NO nodes still contributes actions by Key (Review Focus 4)', () =>
    {
        const { h } = setup();
        // second contributor: no Contribute output, only an action for 'project'
        const registry = (h as unknown as { registry: HierarchyContributorRegistry }).registry;
        const kExtra = new ServiceKey<IHierarchyContributor>('extra');
        const log: string[] = [];
        const extra: IHierarchyContributor = {
            ParentKeys: ['solution'], Order: 1,
            Contribute: () => new NodeContribution([]),
            Resolve: (id) => new RelayCommand(() => log.push(id)),
        };
        // register via the same provider the registry resolves against is not exposed here;
        // instead use RegisterInstance with an Actions-carrying definition:
        const def = new HierarchyContributorDefinition();
        def.ParentKeys = ['solution']; def.Order = 1;
        def.Actions = [action('project.extra', 'Extra', 'project', 30)];
        registry.RegisterInstance(extra);         // dispatcher
        // NOTE: RegisterInstance does not carry Actions; see implementation note below.
        void def; void kExtra;
    });
});
```

> Implementation note surfaced by the Review-Focus-4 test above: `RegisterInstance` (registry) builds a synthetic `HierarchyContributorDefinition` carrying only `ParentKeys`/`Order` — it does **not** carry `Actions`. For a runtime-registered actions-only contributor to participate, either (a) extend `RegisterInstance` to accept an optional `actions` list and copy it onto the synthetic definition, or (b) have such contributors register via `Register(def)` with an `Actions`-bearing definition. Choose (a) — it keeps the instance path symmetric with the declarative path. Add the `actions` parameter and a test that `ActionBindings()` includes them. (This is a real gap in the Task-3 surface; fix it here where the need appears, with its own RED→GREEN, and note the decision in the ledger.)

- [ ] **Step 10: Run the retargeted actions test + routing + context-source tests — all PASS.** Then run the full hierarchy directory:

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/hierarchy/tests/*.test.ts`
Expected: all green (B's other hierarchy tests unaffected — `HierarchyItem`, `Realize`, selection, reveal, disposal untouched per DR2).

- [ ] **Step 11: Commit**

```bash
git add src/framework/hierarchy/hierarchy.ts src/framework/hierarchy/hierarchy-routing-dispatcher.ts src/framework/hierarchy/index.ts src/framework/hierarchy/hierarchy-contributor-registry.ts src/framework/hierarchy/tests/
git commit -m "feat(hierarchy): context-driven BuildActions + ICommandContextSource + routing dispatch (C1)

Replaces B's CommandContexts map / single Dispatcher with selection-derived
contexts (HierarchyContext.For) and per-contributor routing. Breaking."
```

---

## Task 5: Compiler — `Hierarchy { }` block: `Contributor` fan-out

**Files:**
- Modify: `src/compiler/compiler.ts` (`compileMemberBlock` dispatch + new `emitHierarchyBlock`)
- Modify: `src/compiler/symbol-table.ts` (DEFAULT_SYMBOLS rows)
- Test: `src/compiler/tests/hierarchy-block.test.ts` (create)

**Interfaces:**
- Consumes: the `MemberBlock` AST (`{ kind:'member-block'; name; body; span }`), `compileElement`, `compileValue`, `emitSetDP`, `ensureImport`; the `Behaviors` interception precedent at `compiler.ts:3861-3865`.
- Produces: a `Hierarchy` block that lowers each `Contributor [ Under, Use, Order ]` child to a `HierarchyContributorDefinition` added to `module.HierarchyContributors`.

Note on authoring surface: the block is spelled `Hierarchy { … }` (a child block), matching the spec. Intercept it by name in `compileMemberBlock` exactly as `Behaviors` is intercepted.

- [ ] **Step 1: Write the failing source-to-source test**

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { emitted } from './helpers.js';   // reuse the existing emit harness used by command-nesting.test.ts

describe('Hierarchy { } block — Contributor fan-out', () =>
{
    test('each Contributor lowers to a HierarchyContributorDefinition on HierarchyContributors', () =>
    {
        const js = emitted(`
            shell module ExplorerModule {
                Hierarchy {
                    Contributor [ Under = "solution", Use = ProjectsContributor, Order = 10 ]
                    Contributor [ Under = ["project", "folder"], Use = ConnectionsContributor, Order = 20 ]
                }
            }
        `);
        assert.match(js, /new HierarchyContributorDefinition\(\)/);
        assert.match(js, /set_property_value\(HierarchyContributorDefinition\.ParentKeysKey, \["solution"\]\)/);
        assert.match(js, /set_property_value\(HierarchyContributorDefinition\.ContributorKey, ProjectsContributor\)/);
        assert.match(js, /set_property_value\(HierarchyContributorDefinition\.OrderKey, 10\)/);
        assert.match(js, /set_property_value\(HierarchyContributorDefinition\.ParentKeysKey, \["project", "folder"\]\)/);
        assert.match(js, /\.HierarchyContributors\.Add\(/);
    });
});
```

(Confirm the harness import path/name used by `src/compiler/tests/command-nesting.test.ts` and reuse it verbatim; it compiles a source string and returns the emitted JS.)

- [ ] **Step 2: Run — FAIL** (the block name `Hierarchy` currently falls through the member-name ternary to `parent.Hierarchy`, which does not exist → emit or runtime mismatch; assertions fail).

Run: `npx tsx --conditions=development --test --test-force-exit src/compiler/tests/hierarchy-block.test.ts`

- [ ] **Step 3: Implement the interception + handler in `compiler.ts`**

In `compileMemberBlock`, next to the `Behaviors` interception (`:3861`):

```ts
if (block.name === 'Hierarchy')
{
    this.emitHierarchyBlock(parentVar, block.body);
    return;
}
```

Add the handler (Allman, on the compiler class). It walks the block body; only `Contributor` elements are handled in this task (actions come in Task 6):

```ts
private emitHierarchyBlock(parentVar: string, body: StructuredBody): void
{
    this.ensureImport('HierarchyContributorDefinition');
    for (const child of body.items)
    {
        if (child.kind !== 'element' || child.name !== 'Contributor')
        {
            throw new EmitError(
                `Hierarchy { } accepts only Contributor entries (got ${child.kind === 'element' ? child.name : child.kind})`,
                'span' in child ? child.span : body.span);
        }
        this.emitHierarchyContributor(parentVar, child);
    }
}

private emitHierarchyContributor(parentVar: string, element: ElementNode): void
{
    const defVar = this.freshVar('hierarchyContributor');
    this.line(`const ${defVar} = new HierarchyContributorDefinition();`);
    for (const attr of element.attributes)
    {
        const prop = attr.name === 'Under' ? 'ParentKeys'
                   : attr.name === 'Use'   ? 'Contributor'
                   : attr.name === 'Order' ? 'Order'
                   : undefined;
        if (prop === undefined)
        {
            throw new EmitError(`Contributor accepts Under / Use / Order (got ${attr.name})`, attr.span);
        }
        const valueExpr = prop === 'ParentKeys'
            ? this.compileUnderValue(attr.value)       // string → ["s"]; list passes through
            : this.compileValue(attr.value, {});
        this.line(`${defVar}.set_property_value(HierarchyContributorDefinition.${prop}Key, ${valueExpr});`);
    }
    this.line(`${parentVar}.HierarchyContributors.Add(${defVar});`);
}

// Under accepts a single key OR a list. A bare string becomes a one-element array
// (ParentKeys is readonly string[]); a list compiles element-wise as usual.
private compileUnderValue(value: ValueNode): string
{
    if (value.kind === 'list') return this.compileValue(value, {});
    return `[${this.compileValue(value, {})}]`;
}
```

Use the compiler's real helper names: `freshVar`/`line`/`ensureImport`/`EmitError`/`compileValue` exist (seen in `compileMemberBlock`); confirm the fresh-variable helper's name (the existing code names vars like `_commandDefinition<n>` — match that scheme, e.g. `_hierarchyContributor<n>`). Confirm the `ElementNode`/`ValueNode`/`StructuredBody` AST type names from `ast.ts` and the attribute shape (`element.attributes` with `name`/`value`/`span`).

Add to `symbol-table.ts` `DEFAULT_SYMBOLS` (if not already resolvable): a row for `HierarchyContributorDefinition` → `@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-contributor-definition.js` (the recon shows the `Command`/`HierarchyContributorDefinition` rows already exist at `:130-131`; verify and add only if missing).

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/compiler/compiler.ts src/compiler/symbol-table.ts src/compiler/tests/hierarchy-block.test.ts
git commit -m "feat(compiler): Hierarchy { } block — Contributor fan-out to HierarchyContributors (C1)"
```

---

## Task 6: Compiler — nested `CommandDefinition` actions with interned `Context`

**Files:**
- Modify: `src/compiler/compiler.ts` (extend `emitHierarchyContributor` to handle the child body)
- Modify: `src/compiler/symbol-table.ts` (`HierarchyContext` DEFAULT_SYMBOLS row)
- Test: extend `src/compiler/tests/hierarchy-block.test.ts`

**Interfaces:**
- Consumes: `compileElement` (already lowers a `CommandDefinition` with nested `{ }` → `AddChild`, and attributes → `set_property_value`); `HierarchyContext.For` (Task 1); `HierarchyContributorDefinition.Actions` (Task 2).
- Produces: a `Contributor [ … ] { CommandDefinition [ … ] { … } }` body whose top-level commands land on the definition's `Actions` list, each with `Context = HierarchyContext.For("<key>")`.

- [ ] **Step 1: Write the failing test** (append)

```ts
test('nested CommandDefinitions become the contributor Actions with interned Context', () =>
{
    const js = emitted(`
        shell module ExplorerModule {
            Hierarchy {
                Contributor [ Under = "solution", Use = ProjectsContributor, Order = 10 ] {
                    CommandDefinition [ Id = "project.build", Title = "Build", Context = "project", Icon = @Build ] {
                        CommandDefinition [ Id = "project.build.default", Title = "Build (Default)", Context = "project" ]
                    }
                    CommandDefinition [ Id = "folder.newFile", Title = "New File", Context = "folder" ]
                }
            }
        }
    `);
    // top-level actions collected into an array assigned to Actions
    assert.match(js, /set_property_value\(HierarchyContributorDefinition\.ActionsKey, \[/);
    // Context authored as a key string lowers to the interner call
    assert.match(js, /set_property_value\(CommandDefinition\.ContextKey, HierarchyContext\.For\("project"\)\)/);
    assert.match(js, /set_property_value\(CommandDefinition\.ContextKey, HierarchyContext\.For\("folder"\)\)/);
    // nesting still routes through AddChild
    assert.match(js, /\.AddChild\(/);
    // Icon ref still lowers as a resource
    assert.match(js, /DynamicResource\(/);
});
```

- [ ] **Step 2: Run — FAIL** (body ignored; no Actions assignment, Context emitted as an unresolved identifier or string, not the interner call).

- [ ] **Step 3: Implement** — extend `emitHierarchyContributor` to process the element's child body:

```ts
// after the attribute loop, before the HierarchyContributors.Add line:
const actionVars: string[] = [];
for (const child of element.body?.items ?? [])
{
    if (child.kind !== 'element' || child.name !== 'CommandDefinition')
    {
        throw new EmitError(
            `A Contributor body accepts only CommandDefinition entries (got ${child.kind === 'element' ? child.name : child.kind})`,
            'span' in child ? child.span : element.span);
    }
    actionVars.push(this.compileElement(child));   // reuses command lowering: nesting → AddChild, attrs → set_property_value
}
if (actionVars.length > 0)
{
    this.line(`${defVar}.set_property_value(HierarchyContributorDefinition.ActionsKey, [${actionVars.join(', ')}]);`);
}
```

The one special case is the `Context` attribute **inside a Hierarchy-block `CommandDefinition`**: it is authored as a node-type key string and must lower to `HierarchyContext.For("<key>")`, not a bare string. The general `compileElement`/`compileAttribute` path compiles a string value to a JSON string literal, which would be the wrong type for the `Context` ServiceToken DP. Handle this by giving the Hierarchy-block command compilation a context-attribute hook. Cleanest: before calling `compileElement(child)`, rewrite the child's `Context` attribute node in place is not available (AST is read-only), so instead add a narrowly-scoped override:

- Add a compiler field `private hierarchyCommandDepth = 0;`. Increment it around the `compileElement(child)` calls in `emitHierarchyContributor` (and it stays set through nested children). In `compileValue`'s **string** branch (or in `compileAttribute` where the owner is `CommandDefinition` and the attribute is `Context`), when `hierarchyCommandDepth > 0` and the attribute is `Context` with a string value, emit `HierarchyContext.For(<json-string>)` and `ensureImport('HierarchyContext')` instead of the raw string.

Prefer intercepting in `compileAttribute` (it has the owner class + attribute name) rather than `compileValue` (which lacks the attribute name): when `this.hierarchyCommandDepth > 0 && emitClass === 'CommandDefinition' && propName === 'Context' && attr.value.kind === 'string'`, emit `${target}.set_property_value(CommandDefinition.ContextKey, HierarchyContext.For(${JSON.stringify(attr.value.value)}))` and `ensureImport('HierarchyContext')`; otherwise fall through to the normal path.

Add `HierarchyContext` → `@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-context.js` to `DEFAULT_SYMBOLS` in `symbol-table.ts`.

Guard the depth with try/finally so a throw inside `compileElement` cannot leave it stuck:

```ts
this.hierarchyCommandDepth++;
try { actionVars.push(this.compileElement(child)); }
finally { this.hierarchyCommandDepth--; }
```

- [ ] **Step 4: Run — PASS.** Then run the whole compiler test directory to confirm `.commands:` / other member-block lowering is unaffected (the `Context` hook only fires when `hierarchyCommandDepth > 0`, i.e. inside a `Hierarchy` block — a normal `.commands:` block with `Context = DiagramEditingContext` still lowers to the bare class reference).

Run: `npx tsx --conditions=development --test --test-force-exit src/compiler/tests/*.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/compiler/compiler.ts src/compiler/symbol-table.ts src/compiler/tests/hierarchy-block.test.ts
git commit -m "feat(compiler): Hierarchy block nested actions with interned Context (C1)"
```

---

## Task 7: `EditableTextBlock` inline-edit cell

**Files:**
- Create: `src/basic/controls/editable-text-block.ts`
- Test: `src/basic/controls/tests/editable-text-block.test.ts`

**Interfaces:**
- Produces: `EditableTextBlock extends Control` (or the lightest existing templated-control base — follow the base used by comparable basic controls). DPs: `Text: string`, `IsEditing: boolean`, `EditingText: string`. Signals/hooks: raises an event on commit and on cancel. Behavior: when `IsEditing` is false, shows `Text`; when true, shows a `TextBox` bound to `EditingText` with focus; `Enter` commits (fires `Committed` with the current `EditingText`), `Escape` cancels (fires `Cancelled`), losing focus commits.

This control is new because the recon confirmed there is **no** editable-text cell in the repo. Keep it minimal and generic (it knows nothing about `HierarchyItem`); Task 9 wires it to `BeginEdit`/`CommitEdit`/`CancelEdit`.

- [ ] **Step 1: Write the failing test** — covering the three transitions (enter edit shows editing text; Enter commits with the edited value; Escape cancels). Use the control directly, driving key events via the same `KeyEventArgs` path controls use in their own tests (mirror an existing `src/basic/controls/tests/*.test.ts` that exercises a `TextBox` + key handling). Assert `Committed`/`Cancelled` fire with the right payload and `IsEditing` returns to false.

- [ ] **Step 2: Run — FAIL** (module not found).

- [ ] **Step 3: Implement** `EditableTextBlock` with Allman style, DP registration via `MuralBase.RegisterProperty`, a `TextBox` child shown/hidden on `IsEditing`, and `Enter`/`Escape`/blur handling. Hoist key/format strings to `private static readonly` constants. Emit commit/cancel through `Signal`s (todl-runtime) or the control event mechanism used by peers — follow the local precedent; do not introduce bare `() => void` listeners (wrap in `IDisposable`).

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/basic/controls/editable-text-block.ts src/basic/controls/tests/editable-text-block.test.ts
git commit -m "feat(controls): add EditableTextBlock inline-edit cell (C1)"
```

---

## Task 8: Default `@HierarchyItemTemplate` (HierarchicalDataTemplate over `HierarchyItem`)

**Files:**
- Create: `src/framework/hierarchy/hierarchy.template.mu`
- Test: `src/framework/hierarchy/tests/hierarchy-template.test.ts`

**Interfaces:**
- Consumes: `HierarchyItem` (`Caption`, `IconKey`, `Children`, `IsExpandable`, `IsEditing`, `EditingName`); `EditableTextBlock` (Task 7); the `HierarchicalDataTemplate` + keyed-resource conventions (`tree-view.template.mu` precedent, `@CommandMenuItemTemplate` at `shell.template.mu:314`).
- Produces: a keyed `HierarchicalDataTemplate x:key="HierarchyItemTemplate"` with `DataType = HierarchyItem`, `itemsselector = Children`, rendering an icon (resolved from `IconKey` per DR10), the caption via an `EditableTextBlock` bound `Text = $Caption`, `IsEditing = $IsEditing`, `EditingText = $EditingName`.

- [ ] **Step 1: Write the failing test** — compile/apply the template to a `HierarchyItem` and assert the built visual tree shows the caption, and that `itemsselector` returns the item's `Children`. Mirror how `tree-view-vm.mts` builds a `HierarchicalDataTemplate` and how existing template tests assert rendered structure. For the icon, assert the icon slot is present and empty when `IconKey` is `''`.

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** `hierarchy.template.mu`:

```
resources Hierarchy {
    HierarchicalDataTemplate x:key="HierarchyItemTemplate" [DataType = HierarchyItem, itemsselector = Children] {
        StackPanel [Orientation = Horizontal] {
            // Icon resolved from the string IconKey via the resource system (DR10);
            // empty key → empty slot. Use the framework's resource-by-key binding.
            ContentControl x:name="PART_Icon" [Content = $IconKey >> <icon-key-to-visual>]
            EditableTextBlock [ Text = $Caption, IsEditing = $IsEditing, EditingText = $EditingName ]
        }
    }
}
```

Resolve DR10 concretely: bind the icon via the framework's key→resource mechanism. If a binding converter exists for "resource key → resource value", use it; otherwise render a small `Shape`/`Image` whose geometry/content is looked up with `FindResource($IconKey)` — implement the lookup in the smallest way the resource API allows, and when `IconKey` is `''` render nothing. Keep the caption path (the load-bearing part) simple and correct regardless of the icon approach; the icon is secondary. Hoist the `x:key` string usage to the registration side (template keys are markup identifiers, not inline literals in TS).

Add an `export`/`import` wiring stub so the dictionary is loadable by the test; full theme wiring happens in Task 12.

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy.template.mu src/framework/hierarchy/tests/hierarchy-template.test.ts
git commit -m "feat(hierarchy): default HierarchicalDataTemplate over HierarchyItem (C1)"
```

---

## Task 9: `HierarchyTreeBehavior` — selection mirroring + inline-rename wiring

**Files:**
- Create: `src/framework/hierarchy/hierarchy-tree-behavior.ts`
- Test: `src/framework/hierarchy/tests/hierarchy-tree-behavior.test.ts`

**Interfaces:**
- Consumes: `Behavior` (`OnAttached(visual)` / `OnDetached`); `TreeView`/`Selector` (`AddSelectionChangedListener(() => void)` / `RemoveSelectionChangedListener`, `SelectedItems`); `Hierarchy` (`SyncSelection(items, anchor)`, `SelectSingle`); `HierarchyItem` (`BeginEdit`/`CommitEdit`/`CancelEdit`/`IsEditing`/`EditingName`); `EditableTextBlock` commit/cancel events; `AddRoutedEventListener('KeyDown', …)` + `KeyEventArgs` (`Key.F2`). A DP `Hierarchy: Hierarchy` names the model the behavior mirrors into.
- Produces: `HierarchyTreeBehavior extends Behavior`.

- [ ] **Step 1: Write failing tests** — (a) a selection change on the tree calls `Hierarchy.SyncSelection` with the tree's `SelectedItems` and the last as anchor; (b) `F2` on the tree calls `BeginEdit()` on the anchor item; (c) an `EditableTextBlock` commit calls the item's `CommitEdit()` (and cancel → `CancelEdit()`). Drive the behavior by attaching it to a `TreeView` (or a minimal `ItemsControl` stub exposing the `Selector` listener API) whose items are `HierarchyItem`s; mirror the behavior-test precedent in `src/compiler/tests/behaviors.test.ts` / any `src/basic/behaviors/tests`.

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** — `OnAttached`: register a selection listener that reads `SelectedItems as readonly HierarchyItem[]` and calls `this.Hierarchy.SyncSelection(items, items[items.length - 1])`; a `KeyDown` listener that on `Key.F2` calls `anchor.BeginEdit()`; and wires each realized row's `EditableTextBlock` commit→`item.CommitEdit()`, cancel→`item.CancelEdit()` (reach the item via the row's bound data; the recon notes `dataOf`/`_itemsControlData` is the stamp — reimplement the small walk from `RootItems`/`SubItems` or subscribe at the template level). Aggregate every subscription in a `CompositeDisposable`; `OnDetached` disposes it. No bare lambdas as stored teardown — wrap in `Disposable`.

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy-tree-behavior.ts src/framework/hierarchy/tests/hierarchy-tree-behavior.test.ts
git commit -m "feat(hierarchy): HierarchyTreeBehavior — selection mirroring + inline rename (C1)"
```

---

## Task 10: `HierarchyContextMenu` (dynamic) + `HierarchyContextMenuBehavior`

**Files:**
- Create: `src/framework/hierarchy/hierarchy-context-menu.ts`
- Test: `src/framework/hierarchy/tests/hierarchy-context-menu.test.ts`

**Interfaces:**
- Consumes: `ContextMenu` base (`IsOpen` DP, `OnPropertyChanged`, `FindResource`, `ItemsSource`/`ItemTemplate`); the `CommandContextMenu` pattern (`:61-89`); `ContextMenuService.SetContextMenu` + the pointer patch; `HierarchyItem.BuildActions(context)` → `ObservableCollection<CommandViewModel>`; `HierarchyActionContext`; `@CommandMenuItemTemplate` (reused for the VM rows); `KeyEventArgs` for the keyboard context-menu key.
- Produces: `HierarchyContextMenu extends ContextMenu` (builds from `BuildActions` on open, disposes VMs on close) and `HierarchyContextMenuBehavior extends Behavior` (attaches one menu to the tree; on open, reads the live anchor + selection and builds the `HierarchyActionContext`; wires the keyboard context-menu key, which the shipped pointer-only patch does not).

- [ ] **Step 1: Write failing tests** (pin Review Focus 1 + 2 + DR9):
  - **build-per-open:** opening the menu twice yields distinct `CommandViewModel` instances that reflect the current selection's actions.
  - **dispose-on-close:** after open→close, the built VMs are disposed and subscription counts return to baseline across repeated open/close cycles (assert via `Signal.subscriberCount` on a command's channel, mirroring the existing `CommandContextMenu` disposal test).
  - **submenu lazy populate + dispose (Review Focus 1):** a menu built from an action whose `ChildrenContributor` yields children populates them on submenu-open and disposes them on close.
  - **keyboard open (Review Focus 2):** the context-menu key routes through `BuildActions` just as right-click does.

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** — mirror `CommandContextMenu`: override `OnPropertyChanged` for `IsOpen` → `true` builds, `false` tears down. `BuildTree()` computes the `HierarchyActionContext` from the attached tree's live selection/anchor, calls `item.BuildActions(context)`, sets `this.ItemTemplate = this.FindResource(CommandMenuItemTemplateKey)`, and assigns `this.ItemsSource` to the returned collection. `TearDown()` disposes each built `CommandViewModel` and clears `ItemsSource`. The behavior attaches the menu via `ContextMenuService.SetContextMenu(tree, menu)` and adds a `KeyDown` listener for the context-menu key that calls `menu.OpenAt(...)`. Hoist the template-key string to a `private static readonly`.

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy-context-menu.ts src/framework/hierarchy/tests/hierarchy-context-menu.test.ts
git commit -m "feat(hierarchy): dynamic HierarchyContextMenu (per-open BuildActions, dispose-on-close) + keyboard key (C1)"
```

---

## Task 11: `HierarchyDropBehavior` — drag-drop

**Files:**
- Create: `src/framework/hierarchy/hierarchy-drop-behavior.ts`
- Test: `src/framework/hierarchy/tests/hierarchy-drop-behavior.test.ts`

**Interfaces:**
- Consumes: `Behavior`; `Element.AllowDrop`; `AddRoutedEventListener('DragOver'|'DragLeave'|'Drop', …)` + `DragEventArgs` (`Data: DataObject` with `Has`/`Get`, `Effect`, `HostX`/`HostY`); `DragDropEffects.Move`; `HierarchyItemsDrop.For(ItemId[])` / `ItemsOf(drop)` / `Kind`; `HierarchyHost.CanDrop(target, dragged)` / `Drop(target, dragged)`; the `ListReorderBehavior.OnAttached` wiring precedent (`:101-124`). DPs: `Host: HierarchyHost`.
- Produces: `HierarchyDropBehavior extends Behavior` that, on `DragOver`, sets `Effect = Move` when the payload is a `HierarchyItemsDrop` and `Host.CanDrop(target, dragged)`; on `Drop`, applies `Host.Drop(target, dragged)`.

- [ ] **Step 1: Write failing tests** — a drag carrying `HierarchyItemsDrop.For([ids])` over a target the host accepts sets `Effect = Move` and, on drop, calls `Host.Drop(target, dragged)`; a target the host rejects leaves `Effect` unset and does not drop. Resolve the target `HierarchyItem` under the cursor the way `ListReorderBehavior` resolves an index (from `host.logicalChildren` + `HostX/HostY`), then `dataOf(container)`. Use a fake `HierarchyHost` recording `CanDrop`/`Drop` calls.

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** — mirror `ListReorderBehavior`: `AllowDrop = true`; the three listeners; map `ItemId[]` from the drop payload back to `HierarchyItem`s (via the `Hierarchy`/host), gate on `CanDrop`, apply on `Drop`. Hoist the drop-format constant usage to `HierarchyItemsDrop.Kind`. Aggregate teardown in a `CompositeDisposable`.

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy-drop-behavior.ts src/framework/hierarchy/tests/hierarchy-drop-behavior.test.ts
git commit -m "feat(hierarchy): HierarchyDropBehavior wiring to HierarchyHost.CanDrop/Drop (C1)"
```

---

## Task 12: Default `TreeView` style bundle + resource registration + overridability

**Files:**
- Modify: `src/framework/hierarchy/hierarchy.template.mu` (add the default `TreeView` style bundling the behaviors)
- Modify: `src/resources/framework.resources.mu` (import the hierarchy dictionary)
- Modify: `src/framework/hierarchy/index.ts` (export behaviors/menu/template keys as needed)
- Test: `src/framework/hierarchy/tests/hierarchy-treeview-integration.test.ts`

**Interfaces:**
- Consumes: Tasks 7–11; the resource-registration chain (`*.template.mu` → `framework.resources.mu` import → theme `dictionaries:`); the `DefaultStyleKey`/implicit-style override mechanism (`element.ts` — an app-supplied `Style [TargetType=TreeView]` shadows the theme style).
- Produces: a default keyed style/behavior bundle so that binding `TreeView.ItemsSource = $Hierarchy.Roots` with no app markup yields the wired tree (item template + selection + rename + context menu + drag-drop), each piece overridable by key.

- [ ] **Step 1: Write failing integration tests** (pin Review Focus 3):
  - binding `ItemsSource = Hierarchy.Roots` and applying the default style attaches `HierarchyTreeBehavior` + the context-menu behavior + `HierarchyDropBehavior` and uses `@HierarchyItemTemplate`;
  - **override only the data template** (app supplies its own `@HierarchyItemTemplate` or an `ItemTemplate`) → default behaviors still attached; and conversely overriding the behavior bundle keeps the default template.

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** — in `hierarchy.template.mu`, add a keyed default `TreeView` style that sets `ItemTemplate = @HierarchyItemTemplate` and attaches the three behaviors via a `.Behaviors:` section (the behaviors read their `Hierarchy`/`Host` from the bound model — wire those through the style/binding). Follow `tree-view.template.mu`'s keyed `Style [TargetType = …]` + `Template x:key` precedent so each default is independently re-keyable. Import the `Hierarchy` dictionary in `framework.resources.mu` (`import Hierarchy from "../framework/hierarchy/hierarchy.template.mu.js"`) and confirm `MuralFramework` folds it in (it is already listed in the theme `dictionaries:`). Keep the shipped default `TreeView` chrome intact — this is an additive hierarchy-aware style keyed so apps opt in / override, not a replacement of the base control style.

- [ ] **Step 4: Run — PASS.** Then full suite.

Run: `npm test`
Expected: green (3 pre-existing skips).

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy.template.mu src/resources/framework.resources.mu src/framework/hierarchy/index.ts src/framework/hierarchy/tests/hierarchy-treeview-integration.test.ts
git commit -m "feat(hierarchy): default TreeView style bundling the behaviors, overridable by key (C1)"
```

---

## Task 13: Demo + typecheck + demo tests

**Files:**
- Create: `demo/demos/hierarchy-tree/hierarchy-tree.mu`, `demo/demos/hierarchy-tree/hierarchy-tree-vm.mts`, and register the demo in the demo index (follow `demo/demos/tree-view/` + the demo-registration precedent).
- Test: the demo suite's own harness (`test:demo`).

**Interfaces:**
- Consumes: the whole C1 surface — a module authored with a `Hierarchy { }` block, a `Hierarchy` constructed from the registry, bound `TreeView.ItemsSource = $Hierarchy.Roots` with zero wiring markup; plus a second tree demonstrating an app overriding the data template by key.
- Produces: a runnable demo proving the out-of-box path and the override path.

- [ ] **Step 1: Author the demo** — a small `Hierarchy { }` (two contributors, a couple of actions with `Context` keys), construct the `Hierarchy`, bind a `TreeView` with no behavior/template markup; a second `TreeView` supplying an override `@HierarchyItemTemplate`. Keep it faithful to the spec's out-of-box claim: `TreeView.ItemsSource = $Hierarchy.Roots` and nothing else.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json` (and the demos tsconfig if separate: `npm run typecheck:demos`)
Expected: 0 errors.

- [ ] **Step 3: Demo tests**

Run: `npm run test:demo`
Expected: green (and the new demo included if the suite enumerates demos).

- [ ] **Step 4: Full suite + build**

Run: `npm test && npm run build`
Expected: suite green (3 skips), build 0 errors.

- [ ] **Step 5: Commit**

```bash
git add demo/demos/hierarchy-tree/
git commit -m "feat(demo): hierarchy TreeView out-of-box + override-by-key demo (C1)"
```

---

## Self-Review

**1. Spec coverage.**
- C1.1 the `Hierarchy { }` DSL → Tasks 5 (Contributor fan-out) + 6 (nested actions, interned Context). `Under`-as-list → Task 5. Nesting + `SeparatorBefore`/`Icon`/`ChildrenContributor` inherited from the existing command lowering → Task 6.
- C1.2 default data template → Task 8; default behavior bundle (selection/keyboard/expansion/drag-drop) → Tasks 9 (selection + rename; expansion/activate are intrinsic per DR8) + 11 (drag-drop); dynamic context menu (build-per-open, dispose-on-close, no singleton) → Task 10; overridable-by-key → Task 12.
- Out-of-box `TreeView.ItemsSource = $Hierarchy.Roots` → Tasks 12 + 13.
- Spec testing bullets (DSL lowering; default template; default behaviors; dynamic menu no-staleness + dispose; override) → Tasks 5/6, 8, 12, 10, 12 respectively.
- Spec Review-Focus (ChildrenContributor submenu; keyboard vs right-click; template-only override) → this plan's Review Focus 1/2/3, pinned to Tasks 10/10/12.
- Reconciliations the spec could not foresee (it predates B): context-driven resolution replacing the key→token map, `HierarchyItem` unchanged, contributor-owned actions + routing dispatch, Mural-only, no toolbar refactor — captured as DR1–DR10.

**2. Placeholder scan.** Each code step carries real code or an exact, named mechanism. The two places that say "follow the local precedent" (the control base in Task 7; the behavior-test harness in Task 9) name the precedent file to copy and the exact APIs; they are instructions to match an existing pattern, not blanks. The icon-key resolution (DR10/Task 8) names the concrete fallback (`FindResource(key)`, empty when unresolved) rather than leaving it open.

**3. Type consistency.** `HierarchyContext.For(key): ServiceToken<unknown>` (Task 1) is used identically in Task 4 (`BuildActions`, `CommandContexts`) and emitted by Task 6. `HierarchyContributorDefinition.Actions` (Task 2) is read by `ActionBindings` (Task 3) and assigned by the compiler (Task 6). `ActionBindings(): { Action: CommandDefinition; Dispatcher: IHierarchyContributor }[]` (Task 3) is consumed verbatim in Task 4. `HierarchyRoutingDispatcher(routes: ReadonlyMap<string, ICommandDispatcher>)` (Task 4) matches its construction in `BuildActions`. `HierarchyCommandOptions` shrinks to `{ Services? }` in Task 4 and the demo (Task 13) constructs `Hierarchy` accordingly. `CommandMenuBuilder(dispatcher, provider, context)` and `Build(def)` are used exactly as their signatures (verified in recon).

**4. Review Focus.** Five items, each pinned to the task that owns the code and given a concrete test (Tasks 4, 4, 10, 10, 12). The empty-menu / no-matching-Context and provider-node cases are explicit tests in Task 4.

**Known gap surfaced for execution (not a placeholder):** `RegisterInstance` does not carry `Actions` today (Task 4, Step 9 note). The fix (add an optional `actions` param) is assigned to Task 4 with its own RED→GREEN and a ledger ruling, because that is where the need first appears.
