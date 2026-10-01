# Command Machinery — A2 (Menu Rendering + Main Menu) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a `CommandViewModel` tree as a live menu — the Menu family (`MenuItem`/`ContextMenu`/`MenuStrip`) consumes a `HierarchicalDataTemplate` for `CommandViewModel` (`Header=$Title, Icon=$Icon, Command=$Command, ItemsSource=$Children`), built per open and disposed on close, with `ChildrenContributor` submenus populating lazily on submenu open — plus a command-driven main menu and the `menu`/`commands`/`context-menu` demos migrated to the command-driven path (incl. a dynamic "Recent" submenu).

**Architecture:** The hierarchical-rendering piece TreeView already has (`tree-view.ts` `bindTreeItem`/`wrapTreeItem`, the only generalized `HierarchicalDataTemplate` recursion) is extracted into a shared `HierarchicalItemsBinder` and TreeView is refactored onto it (tests stay green); the Menu family then reuses it. The `CommandViewModel` tree is built from `CommandDefinition` roots by a `CommandMenuBuilder` (resolving each command via the active `ICommandDispatcher`, resolving `ChildrenContributor` via `IServiceProvider.getRequired`), lazily on submenu open via an `ExpandableMenuData` callback mirroring TreeView's `ExpandableTreeData`. Built on the A1 branch `milestone-a-command-machinery`; a single mural publish happens at the END of Milestone A (this plan's final task), removing `ICommandTarget`.

**Tech Stack:** TypeScript (ESM), `tsx --test` (node:test), `tsc` build + typecheck, `.mu` markup + demo `.mu`→`.mu.js` compile. Package `@pragmatic-tech-ai/mural`; depends on `@pragmatic-tech-ai/todl-runtime@^0.6.0`.

**Spec:** `docs/superpowers/specs/2026-10-01-command-machinery-unification-design.md` (sections A6, A8, A9 + Testing/Review-focus)

## Global Constraints

- **Allman braces** on every block; `else`/`catch`/`finally` on their own line. Object literals, inline arrows, one-liners stay inline.
- **OOP, no module-level free functions or mutable state** beyond compile-time `const`/enum/type. The sanctioned exceptions already in the codebase are type-guard functions (`isCheckableCommand`, `isCommandDispatcher`, `isCommandContextSource`) and the existing `tree-view.ts` module helpers being extracted — the extraction MOVES them onto a class, it does not add new free functions.
- **No seam lambdas** (`feedback_no_seam_bags`): a child-realization strategy is a real interface implemented by a class, ctor-injected — never a bare `() => void`. Teardown handles are `IDisposable`; aggregate with `CompositeDisposable`; wrap cleanup via `new Disposable(() => …)`.
- **No inline string literals** for reused/user-facing text — hoist to `private static readonly` PascalCase constants. Property-name strings passed to `RaisePropertyChanged`/`RegisterProperty` follow the file's existing precedent.
- **PascalCase** for all interfaces and public methods. `dispose()` stays lowercase (the `IDisposable` contract).
- **View-models extend `Observable`, not `MuralBase`** (`CommandViewModel` already does, from A1).
- **Enums over string-literal unions.**
- **`Observable.RaisePropertyChanged(name, oldValue, newValue)` takes THREE args** (confirmed signature; mirror `HierarchyItemVM`).
- **`ObservableCollection` accessor is `.Count`**, it is iterable, has `.Add`/`.Clear`/`.Insert`/`.Remove` — never `.length`.
- **Tests** live in a `tests/` subfolder beside source; framework tests run under `npm test` (`src/**/*.test.ts`), demo composition tests under `npm run test:demo` (`demo/platform/**/*.test.mts`).
- **Additive / behavior-preserving for TreeView and the existing toolbar:** extracting the shared binder must not change TreeView's rendered behavior (its tests stay green); the toolbar's flat `CommandMenuRowTemplate`/split-button path keeps working.
- **Fix ALL review findings including Minors in this milestone** — no deferral. This includes wiring the two A1 forward-seams (`CommandViewModel.IsToggle`, the VM's `CompositeDisposable subscriptions`) that A1 left inert for A2.
- **Dependency:** `@pragmatic-tech-ai/todl-runtime` at `^0.6.0`.
- Git commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Mural scripts: `npm run build` (templates + demos + tsc), `npm run typecheck`, `npm run typecheck:demos`, `npm test`, `npm run test:demo`. The full `npm test` is FLAKY under concurrent load on this Windows box (the controller verifies it out of band; per-task gate = single-file + targeted + typecheck).

## Review Focus

- **`dispose()` leak-freedom on repeated menu open/close:** after N open→close cycles, `Signal.subscriberCount` on the command/VM signals returns to its pre-open baseline (Task 1 pins the VM-level assertion; Task 4 pins the open/close-cycle assertion).
- **A command with BOTH static `Children` and a `ChildrenContributor`:** children compose declared-first, contributed-after, with no duplication, and the contributor is resolved only once per expand (Task 1 pins it).
- **A self-referential / deep `ChildrenContributor` terminates:** lazy-on-expand means each submenu level resolves only when opened, so a contributor that yields children carrying the same contributor does not infinite-loop at build time (Task 1 pins it).
- **A toggle command whose `IsChecked` changes while its menu item is live:** the menu `MenuItem`'s checked state tracks the VM's `IsChecked` across a change (Task 3 pins it via the VM→`MenuItem.IsChecked` binding; `IsToggle` drives `IsCheckable`).
- **`CanExecute` change after the source document's selection/state changes mid-session** propagates to the live menu item's enablement (Task 4 pins it — the resolved command's `RaiseCanExecuteChanged` reaches the rendered `MenuItem`).

---

### Task 1: CommandMenuBuilder + CommandViewModel lazy children (VM layer, no rendering)

**Files:**
- Modify: `src/framework/shell/commands/command-view-model.ts` (lazy-expand hook; wire `IsToggle` + `subscriptions`)
- Create: `src/framework/shell/commands/command-menu-builder.ts`
- Create: `src/framework/shell/commands/command-child-realizer.ts` (the realizer interface)
- Test: `src/framework/shell/tests/command-menu-builder.test.ts` (create)

**Interfaces:**
- Consumes: `ICommandDispatcher` + `CommandContext` (A1), `IServiceProvider` (`getRequired`), `ICommandContributor` (A1), `CommandDefinition.Children`/`.ChildrenContributor`, `CommandViewModel` (A1).
- Produces:
  - `interface ICommandChildRealizer { RealizeChildren(parent: CommandViewModel): void; }` (a real interface — no lambda seam).
  - `CommandViewModel.SetChildRealizer(realizer: ICommandChildRealizer): void` and `CommandViewModel.EnsureExpanded(): void` (realizes children at most once, delegating to the realizer).
  - `class CommandMenuBuilder implements ICommandChildRealizer` with ctor `(dispatcher: ICommandDispatcher, provider: IServiceProvider, context: CommandContext)` and `Build(definition: CommandDefinition): CommandViewModel` (resolves the command, wraps, registers itself as the VM's realizer; static children are realized lazily alongside any `ChildrenContributor` on first `EnsureExpanded`).

- [ ] **Step 1: Write the failing test** — `src/framework/shell/tests/command-menu-builder.test.ts`

Mirror the fake-dispatcher/provider style of `toolbar-service.test.ts` and the `command(...)` helper of `command-registry.test.ts`. Build a fake `ICommandDispatcher` whose `Resolve(id, ctx)` returns a `new RelayCommand(() => {}, () => true, { Text: id })`, and a fake `IServiceProvider` whose `getRequired(token)` returns a stub `ICommandContributor` for the ChildrenContributor token.

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommandDefinition } from '../commands/command-definition.js';
import { CommandMenuBuilder } from '../commands/command-menu-builder.js';
import { CommandContext } from '../commands/command-context.js';
import { RelayCommand, ServiceKey, Signal } from '../../../runtime/index.js';
import type { ICommandDispatcher } from '../commands/command-dispatcher.js';
import type { ICommandContributor } from '../commands/command-contributor.js';
import type { CommandContext as Ctx } from '../commands/command-context.js';

function def(id: string): CommandDefinition { const d = new CommandDefinition(); d.Id = id; d.Title = id; return d; }

const dispatcher: ICommandDispatcher =
{
    Resolve(id: string): RelayCommand | undefined { return new RelayCommand(() => {}, () => true, { Text: id }); },
};

test('Build resolves the command and wraps the definition', () =>
{
    const builder = new CommandMenuBuilder(dispatcher, { get: () => undefined, getRequired: () => { throw new Error('none'); } } as never, new CommandContext());
    const vm = builder.Build(def('file'));
    assert.equal(vm.Definition.Id, 'file');
    assert.notEqual(vm.Command, undefined);
});

test('EnsureExpanded merges declared children first, then contributor children, once', () =>
{
    const parent = def('file');
    parent.AddChild(def('file.new'));
    parent.AddChild(def('file.open'));
    const token = new ServiceKey<ICommandContributor>('recent.contributor');
    parent.ChildrenContributor = token;
    let calls = 0;
    const contributor: ICommandContributor =
    {
        Contribute(_p: CommandDefinition, _c: Ctx): readonly CommandDefinition[] { calls++; return [def('file.recent.a'), def('file.recent.b')]; },
    };
    const provider = { get: () => undefined, getRequired: (_t: unknown) => contributor } as never;
    const builder = new CommandMenuBuilder(dispatcher, provider, new CommandContext());
    const vm = builder.Build(parent);
    vm.EnsureExpanded();
    vm.EnsureExpanded(); // idempotent — contributor resolved once
    assert.deepEqual([...vm.Children].map(c => c.Definition.Id), ['file.new', 'file.open', 'file.recent.a', 'file.recent.b']);
    assert.equal(calls, 1);
});

test('a self-referential contributor terminates (expansion is per-level, lazy)', () =>
{
    const root = def('r');
    const token = new ServiceKey<ICommandContributor>('self');
    root.ChildrenContributor = token;
    const selfish: ICommandContributor =
    {
        Contribute(_p: CommandDefinition, _c: Ctx): readonly CommandDefinition[] { const c = def('r.child'); c.ChildrenContributor = token; return [c]; },
    };
    const builder = new CommandMenuBuilder(dispatcher, { get: () => undefined, getRequired: () => selfish } as never, new CommandContext());
    const vm = builder.Build(root);
    vm.EnsureExpanded();                       // realizes one level only
    assert.equal([...vm.Children].length, 1);
    assert.equal([...vm.Children][0].HasChildren, true); // child is expandable but NOT yet expanded
    assert.equal([...vm.Children][0].Children.Count, 0);
});

test('dispose releases children + command subscriptions idempotently (no signal leak)', () =>
{
    const base = Signal.prototype; void base;
    const parent = def('p'); parent.AddChild(def('p.a'));
    const builder = new CommandMenuBuilder(dispatcher, { get: () => undefined, getRequired: () => { throw new Error(); } } as never, new CommandContext());
    const vm = builder.Build(parent);
    vm.EnsureExpanded();
    vm.dispose();
    vm.dispose(); // idempotent
    assert.equal(vm.Children.Count, 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test src/framework/shell/tests/command-menu-builder.test.ts`
Expected: FAIL — `CommandMenuBuilder`, `EnsureExpanded`, `SetChildRealizer` do not exist.

- [ ] **Step 3: Add the realizer interface** — `src/framework/shell/commands/command-child-realizer.ts`

```ts
import type { CommandViewModel } from './command-view-model.js';

// Strategy that populates a CommandViewModel's Children on first expand. A real
// interface (not a lambda seam): CommandMenuBuilder implements it so the VM can
// stay a dumb view-model while deferring child construction to the builder that
// owns the dispatcher + provider. Resolved at most once per VM (see
// CommandViewModel.EnsureExpanded).
export interface ICommandChildRealizer
{
    RealizeChildren(parent: CommandViewModel): void;
}
```

- [ ] **Step 4: Add the lazy-expand hook to `CommandViewModel`**

In `src/framework/shell/commands/command-view-model.ts`, add a private realizer + realized flag and the two methods, and WIRE the A1 forward-seams: `IsToggle` is now read by `EnsureCheckable`-style consumers (keep the ctor arg; expose it — it drives `MenuItem.IsCheckable` in Task 3), and the `subscriptions` `CompositeDisposable` now actually receives the resolved command's change subscription if the VM subscribes (leave the field; Task 4 adds subscriptions through it — here just confirm `dispose()` disposes it, which it already does).

```ts
import type { ICommandChildRealizer } from './command-child-realizer.js';
// … existing imports …

// (inside the class)
private realizer: ICommandChildRealizer | undefined;
private realized = false;

public SetChildRealizer(realizer: ICommandChildRealizer): void
{
    this.realizer = realizer;
}

// Populate Children on first call (menu submenu-open). Idempotent — a second
// call is a no-op, which is why a self-referential ChildrenContributor cannot
// loop (each level expands only when its own submenu opens). No realizer, or
// already realized, → nothing to do.
public EnsureExpanded(): void
{
    if (this.realized)
    {
        return;
    }
    this.realized = true;
    this.realizer?.RealizeChildren(this);
}
```

- [ ] **Step 5: Add `CommandMenuBuilder`** — `src/framework/shell/commands/command-menu-builder.ts`

```ts
import type { IServiceProvider, ICommand } from '../../../runtime/index.js';
import type { ICommandDispatcher } from './command-dispatcher.js';
import type { CommandContext } from './command-context.js';
import type { ICommandContributor } from './command-contributor.js';
import type { ICommandChildRealizer } from './command-child-realizer.js';
import { CommandDefinition } from './command-definition.js';
import { CommandViewModel, CommandToggleViewModel } from './command-view-model.js';

// Builds a CommandViewModel tree from CommandDefinition roots for a menu surface:
// resolves each command through the active ICommandDispatcher (so the rendered
// item dispatches + gates exactly like the toolbar), and realizes a node's
// children lazily on submenu-open — declared CommandDefinition.Children first,
// then any ChildrenContributor's output (resolved via the provider). One builder
// instance per menu-open; disposing the root VM tears the whole tree down.
export class CommandMenuBuilder implements ICommandChildRealizer
{
    constructor(
        private readonly dispatcher: ICommandDispatcher,
        private readonly provider:   IServiceProvider,
        private readonly context:    CommandContext,
    )
    {
    }

    // Wrap one definition (command resolved now; children deferred to EnsureExpanded).
    public Build(definition: CommandDefinition): CommandViewModel
    {
        const command: ICommand | undefined = this.dispatcher.Resolve(definition.Id, this.context);
        const isToggle = /* read the group presentation the same way the toolbar does, OR false for a plain menu node */ false;
        const vm = isToggle
            ? new CommandToggleViewModel(definition, command as ICommand, true)
            : new CommandViewModel(definition, command as ICommand, false);
        if (definition.Children.Count > 0 || definition.ChildrenContributor !== undefined)
        {
            vm.SetChildRealizer(this);
        }
        return vm;
    }

    // ICommandChildRealizer — declared children first, contributed after.
    public RealizeChildren(parent: CommandViewModel): void
    {
        for (const childDef of parent.Definition.Children)
        {
            parent.Children.Add(this.Build(childDef));
        }
        const token = parent.Definition.ChildrenContributor;
        if (token !== undefined)
        {
            const contributor = this.provider.getRequired(token) as ICommandContributor;
            for (const childDef of contributor.Contribute(parent.Definition, this.context))
            {
                parent.Children.Add(this.Build(childDef));
            }
        }
    }
}
```
(Resolve the `isToggle` question concretely: a plain menu node is never a toggle — pass `false`. Toggle *state* still rides `CommandViewModel.IsChecked`; `IsToggle=true` is only for the toolbar's Toggles presentation and the menu's checkable rows. If the def's group presentation is `Toggles`, pass `true` so Task 3's `IsCheckable` binding lights up; read presentation off `definition` the way `toolbar-service.ts` already does. If unsure at implementation time, default `false` and note it — Task 3's checkable test will force the right answer.)

- [ ] **Step 6: Run to verify it passes**

Run: `npx tsx --conditions=development --test src/framework/shell/tests/command-menu-builder.test.ts`
Expected: PASS (all cases, incl. merge order, lazy-once, self-referential termination, dispose idempotency).

- [ ] **Step 7: Gate + commit**

Run: `npm run typecheck` → 0; targeted `npx tsx --conditions=development --test src/framework/shell/tests/command-menu-builder.test.ts src/framework/shell/tests/command-view-model.test.ts src/framework/shell/tests/toolbar-service.test.ts` → green.
```bash
git add src/framework/shell/commands/command-menu-builder.ts src/framework/shell/commands/command-child-realizer.ts src/framework/shell/commands/command-view-model.ts src/framework/shell/tests/command-menu-builder.test.ts
git commit -m "feat(mural): CommandMenuBuilder + CommandViewModel lazy children (EnsureExpanded)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Extract a shared HierarchicalItemsBinder from TreeView

**Files:**
- Create: `src/basic/templates/hierarchical-items-binder.ts`
- Modify: `src/framework/list/tree-view.ts` (`bindTreeItem` delegates the hierarchical part)
- Test: `src/basic/templates/tests/hierarchical-items-binder.test.ts` (create)

**Interfaces:**
- Consumes: `HierarchicalDataTemplate` (`itemsSelector`, `itemTemplate`) at `src/basic/templates/data-template.ts:402`, `ItemsControl` (`ItemTemplate`/`ItemTemplateSelector`/`ItemsSource`), `DataTemplateSelector.resolve`.
- Produces: `class HierarchicalItemsBinder` with a static method `BindChildItems(owner: ItemsControl, item: unknown, child: ItemsControl): boolean` — resolves `item`'s template in `owner`'s scope; if it is a `HierarchicalDataTemplate`, sets `child.ItemTemplate = tmpl.itemTemplate ?? tmpl`, `child.ItemTemplateSelector = owner.ItemTemplateSelector`, `child.ItemsSource = tmpl.itemsSelector(item)` and returns `true`; otherwise returns `false` (flat item).

- [ ] **Step 1: Write the failing test** — `src/basic/templates/tests/hierarchical-items-binder.test.ts`

Construct an `ItemsControl` owner with a resource `HierarchicalDataTemplate(DataType = <a test VM class>, itemsSelector = d => d.Kids)` in its resource chain (mirror how `tree-view.test.ts` sets up a `HierarchicalDataTemplate` — find and copy that setup), a parent data object with `Kids`, and a fresh child `ItemsControl`. Assert `BindChildItems(owner, parent, child)` returns `true`, sets `child.ItemsSource` to the parent's `Kids`, and propagates `ItemTemplate`. Assert it returns `false` for an owner whose resolved template is a plain `DataTemplate`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test src/basic/templates/tests/hierarchical-items-binder.test.ts`
Expected: FAIL — `HierarchicalItemsBinder` does not exist.

- [ ] **Step 3: Implement the binder** — lift the hierarchical branch of `tree-view.ts` `bindTreeItem` (`src/framework/list/tree-view.ts:1084-1108`) and `resolveItemTemplate` (`:1113`) into the class.

```ts
import { ItemsControl } from '../../framework/base/items-control.js';
import { DataTemplate, HierarchicalDataTemplate } from './data-template.js';
import { DataTemplateSelector } from './data-template-selector.js';

// The one place that turns a resolved HierarchicalDataTemplate into a child
// container's item-binding — shared by TreeView and the Menu family (both bind a
// hierarchical VM tree). Extracted verbatim from TreeView's private bindTreeItem
// recursion so both surfaces recurse identically.
export class HierarchicalItemsBinder
{
    // Resolve item's template in owner's scope. If hierarchical, point child at
    // the item's children + propagate the template downward (so the nested
    // ItemsControl re-resolves and recurses), and return true. Otherwise false.
    public static BindChildItems(owner: ItemsControl, item: unknown, child: ItemsControl): boolean
    {
        const tmpl = HierarchicalItemsBinder.ResolveItemTemplate(owner, item);
        if (!(tmpl instanceof HierarchicalDataTemplate))
        {
            return false;
        }
        child.ItemTemplate = (tmpl.itemTemplate ?? tmpl) as never;
        child.ItemTemplateSelector = owner.ItemTemplateSelector;
        child.ItemsSource = tmpl.itemsSelector(item);
        return true;
    }

    private static ResolveItemTemplate(owner: ItemsControl, item: unknown): DataTemplate | undefined
    {
        // mirror tree-view.ts:1113 resolveItemTemplate — selector wins over ItemTemplate;
        // a Visual item → undefined.
        return DataTemplateSelector.resolve(owner.ItemTemplateSelector, item, owner) ?? owner.ItemTemplate;
    }
}
```
(Check the real `resolveItemTemplate` body at `tree-view.ts:1113` and reproduce its exact behavior, including the `instanceof Visual → undefined` guard.)

- [ ] **Step 4: Refactor `bindTreeItem` to delegate**

In `tree-view.ts`, change the hierarchical branch of `bindTreeItem` (`:1095-1103`) to call `HierarchicalItemsBinder.BindChildItems(owner, item, tvi)` instead of inlining the three assignments. Keep `tvi.Header = headerFor(...)` and `tvi.RefreshBranchAffordance()` exactly as they are — only the three hierarchical assignments move behind the binder. This is behavior-preserving.

- [ ] **Step 5: Run to verify RED→GREEN + TreeView unchanged**

Run: `npx tsx --conditions=development --test src/basic/templates/tests/hierarchical-items-binder.test.ts` → PASS.
Run the TreeView suite: `npx tsx --conditions=development --test src/framework/list/tests/tree-view.test.ts` (and any sibling tree tests) → all green, unchanged.

- [ ] **Step 6: Gate + commit**

Run: `npm run typecheck` → 0.
```bash
git add src/basic/templates/hierarchical-items-binder.ts src/framework/list/tree-view.ts src/basic/templates/tests/
git commit -m "refactor(mural): extract HierarchicalItemsBinder shared by TreeView + menus

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Menu family consumes HierarchicalDataTemplate (recursive command menus)

**Files:**
- Modify: `src/framework/menu/menu-strip.ts` (`MenuItem` container overrides + `ExpandableMenuData` submenu hook)
- Modify: `src/framework/menu/context-menu.ts` + `src/framework/menu/menu-strip.ts` `MenuStrip` (shared container overrides)
- Create: `src/framework/menu/expandable-menu-data.ts` (the submenu-open data callback interface)
- Modify: `src/framework/shell/shell.template.mu` (register a `CommandViewModel` `HierarchicalDataTemplate`)
- Test: `src/framework/menu/tests/command-menu-rendering.test.ts` (create)

**Interfaces:**
- Consumes: `HierarchicalItemsBinder` (Task 2), `CommandViewModel` (`Title`/`Icon`/`Command`/`IsChecked`/`IsToggle`/`Children`/`HasChildren`), `MenuItem` (`Header`/`Icon`/`Command`/`IsCheckable`/`IsChecked`/`IsSubmenuOpen`/`ItemsSource`), `EnsureExpanded` (Task 1).
- Produces:
  - `interface ExpandableMenuData { OnSubmenuOpen?(): void; }` (mirrors `ExpandableTreeData` at `tree-view.ts:1138`).
  - `MenuItem`/`ContextMenu`/`MenuStrip` `GetContainerForItemOverride`/`RebindContainerForItemOverride`/`IsItemItsOwnContainerOverride` that build a `MenuItem` container for a hierarchical data item via `HierarchicalItemsBinder` and, on `IsSubmenuOpen → true`, call the bound data's `OnSubmenuOpen?.()`.
  - A `HierarchicalDataTemplate [DataType = CommandViewModel]` resource whose item is `MenuItem [ Header=$Title, Icon=$Icon, Command=$Command, IsCheckable=$IsToggle, IsChecked=$IsChecked ]` and whose `itemsSelector` yields `$Children`.

- [ ] **Step 1: Write the failing test** — `src/framework/menu/tests/command-menu-rendering.test.ts`

Use the `context-menu.test.ts` harness (`initTestApp()`, `HeadlessTarget`, `findMenuItems` recursion — copy those helpers). Build a two-level `CommandViewModel` tree with `CommandMenuBuilder` over a fake dispatcher (as in Task 1), set it as a `ContextMenu`/`MenuStrip`'s `ItemsSource` with the `CommandViewModel` `HierarchicalDataTemplate` in scope, open it, and assert: a top `MenuItem` renders with `Header` = the VM `Title`; opening its submenu (`IsSubmenuOpen = true`) realizes the child `MenuItem`s (so `EnsureExpanded` fired via `OnSubmenuOpen`); a toggle VM (`IsToggle=true`, `IsChecked=true`) renders a checkable, checked `MenuItem`; flipping the VM's `IsChecked` updates the `MenuItem.IsChecked`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test src/framework/menu/tests/command-menu-rendering.test.ts`
Expected: FAIL — the menu renders one flat level (no `HierarchicalDataTemplate` consumption); submenu children never appear.

- [ ] **Step 3: Add `ExpandableMenuData`** — `src/framework/menu/expandable-menu-data.ts`

```ts
// A menu data item that wants a callback when its submenu first opens — the menu
// analogue of TreeView's ExpandableTreeData (tree-view.ts:1138). CommandViewModel
// satisfies it structurally via EnsureExpanded, so a ChildrenContributor submenu
// populates lazily on open.
export interface ExpandableMenuData
{
    OnSubmenuOpen?(): void;
}
```

- [ ] **Step 4: Menu container overrides + submenu hook**

In `menu-strip.ts` `MenuItem`: override `IsItemItsOwnContainerOverride(item)` (`item instanceof MenuItem`), `GetContainerForItemOverride(item)` and `RebindContainerForItemOverride(container, item)` to, for a non-Visual data item, create/rebind a `MenuItem` whose `Header`/`Icon`/`Command`/`IsCheckable`/`IsChecked` come from the resolved `HierarchicalDataTemplate`'s item template (apply the template the way the base does) and then call `HierarchicalItemsBinder.BindChildItems(this, item, childMenuItem)` to wire the child's `ItemsSource` to the item's children (so a nested `MenuItem` re-enters and recurses). Apply the SAME overrides to `MenuStrip` and `ContextMenu` (factor the shared body into a small helper class `MenuContainerFactory` to honor OOP/no-duplication — one class both call). In `MenuItem.OnPropertyChanged`, where `name === 'IsSubmenuOpen'` and `newValue === true` (`menu-strip.ts:444`), additionally call `(this.boundData as ExpandableMenuData | undefined)?.OnSubmenuOpen?.()` BEFORE `mountSubmenu()` — the bound data is the `CommandViewModel`; `EnsureExpanded` populates `Children` so the submenu realizes the freshly-added items. (Determine how a container reaches its bound data: `Generator.ItemFromContainer(container)` / the `_itemsControlData` stamp set in `PrepareContainerForItemOverride` at `items-control.ts:606` — use the existing accessor, do not invent one.)

Reconcile with the EXISTING flat `CommandMenuRowTemplate` path (toolbar split-button, `shell.template.mu:291`): that template is a plain `DataTemplate` and must keep rendering one level as today. The new overrides must only engage the hierarchical branch when the resolved template `instanceof HierarchicalDataTemplate` (via `BindChildItems` returning `false` for the flat case) — so the toolbar split-button is unaffected.

- [ ] **Step 5: Register the `CommandViewModel` HierarchicalDataTemplate** — `shell.template.mu`

Add (near the existing command templates ~`:291`) a hierarchical template. In `.mu`, a `HierarchicalDataTemplate` declares its child selector; use the markup form the codebase already uses for TreeView's hierarchical templates (find a `HierarchicalDataTemplate` in an existing `.mu` and mirror its `ItemsSource`/`itemsSelector` syntax):
```
HierarchicalDataTemplate [DataType = CommandViewModel, ItemsSource = $Children] {
    MenuItem [ Header = $Title, Icon = Shape [ Geometry = $Icon, Width = 16, Height = 16 ], Command = $Command, IsCheckable = $IsToggle, IsChecked = $IsChecked ]
}
```
(Match the real attribute name the compiler expects for the child selector — confirm against an existing hierarchical template in the repo; it may be `ItemsSource` or a dedicated `ItemsSelector`. Keep `$Title`/`$Icon`/`$Command`/`$IsChecked`/`$IsToggle` — all exist on `CommandViewModel`.)

- [ ] **Step 6: Run RED→GREEN + menu regression**

Run: `npx tsx --conditions=development --test src/framework/menu/tests/command-menu-rendering.test.ts` → PASS.
Run: `npx tsx --conditions=development --test src/framework/menu/tests/context-menu.test.ts src/framework/menu/tests/menu.test.ts src/framework/menu/tests/menu-button-template-swap.test.ts` → all green (existing menu behavior unchanged).
Run: `npm run build:templates` (the `shell.template.mu` edit must compile).

- [ ] **Step 7: Gate + commit**

Run: `npm run typecheck` → 0; `npm run typecheck:demos` → 0.
```bash
git add src/framework/menu/ src/framework/shell/shell.template.mu
git commit -m "feat(mural): Menu family renders a CommandViewModel tree via HierarchicalDataTemplate

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Per-open build / dispose-on-close + CanExecute propagation

**Files:**
- Create: `src/framework/menu/command-context-menu.ts` (a `ContextMenu` that builds its VM tree on open, disposes on close)
- Modify: `src/framework/menu/menu-strip.ts` if a `MenuButton`/dropdown needs the same per-open build (only if the main menu in Task 5 needs it — otherwise leave)
- Test: `src/framework/menu/tests/command-context-menu-lifecycle.test.ts` (create)

**Interfaces:**
- Consumes: `CommandMenuBuilder` (Task 1), the hierarchical menu rendering (Task 3), `ContextMenu.IsOpen` (`context-menu.ts:173`), `Signal.subscriberCount`.
- Produces: `class CommandContextMenu extends ContextMenu` that is given the root `CommandDefinition`s + an `ICommandDispatcher` + `IServiceProvider`; on `IsOpen → true` it builds the root `CommandViewModel` list via a fresh `CommandMenuBuilder` and sets it as `ItemsSource`; on `IsOpen → false` it disposes every built VM (`CompositeDisposable`) and clears `ItemsSource`.

- [ ] **Step 1: Write the failing test** — lifecycle + leak + CanExecute

```
- open → ItemsSource is a non-empty CommandViewModel list; the rendered MenuItems match the roots.
- close → every built VM disposed (spy dispose), ItemsSource cleared.
- repeat open/close N times → Signal.subscriberCount on the dispatcher/command signals returns to the pre-first-open baseline (leak-free).
- a resolved command whose CanExecute flips (RaiseCanExecuteChanged) updates the live MenuItem's enablement while the menu is open.
```
Use the `context-menu.test.ts` harness + Task 1's fake dispatcher; capture `Signal.subscriberCount` baseline before the first open.

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test src/framework/menu/tests/command-context-menu-lifecycle.test.ts`
Expected: FAIL — `CommandContextMenu` does not exist.

- [ ] **Step 3: Implement `CommandContextMenu`** — build on open, dispose on close.

```ts
import { ContextMenu } from './context-menu.js';
import { ObservableCollection, type IServiceProvider, CompositeDisposable } from '../../runtime/index.js';
import { CommandMenuBuilder } from '../shell/commands/command-menu-builder.js';
import { CommandContext } from '../shell/commands/command-context.js';
import type { ICommandDispatcher } from '../shell/commands/command-dispatcher.js';
import type { CommandViewModel } from '../shell/commands/command-view-model.js';
import { CommandDefinition } from '../shell/commands/command-definition.js';

// A ContextMenu whose content is a command tree built FRESH on each open and
// disposed on close — so dynamic ChildrenContributor submenus re-evaluate every
// time and nothing leaks across opens. Roots + the ambient dispatcher/provider
// are supplied by the host (the shell passes the active ICommandDispatcher).
export class CommandContextMenu extends ContextMenu
{
    private readonly roots: readonly CommandDefinition[];
    private readonly dispatcher: ICommandDispatcher;
    private readonly provider: IServiceProvider;
    private built: CommandViewModel[] = [];

    constructor(roots: readonly CommandDefinition[], dispatcher: ICommandDispatcher, provider: IServiceProvider)
    {
        super();
        this.roots = roots;
        this.dispatcher = dispatcher;
        this.provider = provider;
    }

    protected override OnPropertyChanged(/* match the base signature */): void
    {
        // call super first; then on IsOpen true → BuildTree(); false → TearDown()
    }

    private BuildTree(): void
    {
        const builder = new CommandMenuBuilder(this.dispatcher, this.provider, new CommandContext());
        this.built = this.roots.map(def => builder.Build(def));
        const items = new ObservableCollection<CommandViewModel>();
        for (const vm of this.built) items.Add(vm);
        this.ItemsSource = items;
    }

    private TearDown(): void
    {
        for (const vm of this.built) vm.dispose();
        this.built = [];
        this.ItemsSource = undefined;
    }
}
```
(Match the base `OnPropertyChanged` override signature exactly — read `context-menu.ts:173`. Call `super.OnPropertyChanged(...)` so the base open/close overlay logic still runs, then branch on the `IsOpen` descriptor.)

- [ ] **Step 4: Run RED→GREEN**

Run: `npx tsx --conditions=development --test src/framework/menu/tests/command-context-menu-lifecycle.test.ts` → PASS (incl. the `subscriberCount` baseline-return and the CanExecute-propagation case).

- [ ] **Step 5: Gate + commit**

Run: `npm run typecheck` → 0; `npx tsx --conditions=development --test src/framework/menu/tests/` (all menu tests) → green.
```bash
git add src/framework/menu/command-context-menu.ts src/framework/menu/tests/command-context-menu-lifecycle.test.ts
git commit -m "feat(mural): CommandContextMenu builds command tree per open, disposes on close

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Command-driven main menu (MenuStrip over CommandDefinition roots)

**Files:**
- Create: `src/framework/shell/commands/main-menu-service.ts` (builds the `MenuStrip` bar roots from `CommandRegistry`, filtered to a main-menu region)
- Modify: `src/framework/shell/commands/shell-control-definition.ts` or the `ShellRegion` enum if a `MainMenu` region is needed (check what exists; reuse `Region` on `CommandDefinition`)
- Modify: `src/framework/shell/shell.template.mu` (a `MenuStrip` bound to the main-menu roots, per-open dropdown trees)
- Test: `src/framework/shell/tests/main-menu-service.test.ts` (create)

**Interfaces:**
- Consumes: `CommandRegistry` (A1; roots + nested), `CommandMenuBuilder`, `MenuStrip`, the hierarchical rendering (Task 3).
- Produces: `class MainMenuService` that exposes the persistent top-level menu-bar roots (as `CommandViewModel`s or `CommandDefinition`s bound into a `MenuStrip`), each opening a per-open dropdown tree (reuse the Task 4 build-per-open pattern for each top menu's dropdown, or a `MenuButton`-per-root).

- [ ] **Step 1: Write the failing test** — a `MainMenuService` over a registry with a nested command tree exposes the expected top-level roots in order; opening a root yields its child tree via the dispatcher. Mirror `toolbar-service.test.ts`'s app/registry harness.

- [ ] **Step 2: Run to verify it fails** — `MainMenuService` does not exist.

- [ ] **Step 3: Implement `MainMenuService`** — resolve the active dispatcher the way `ToolbarService` does (`ActiveDispatcher()`), filter the registry's roots to the main-menu set (by `Region` — reuse the existing `ShellRegion`; add a `MainMenu` member ONLY if none fits, following the enum's existing style), and expose the bar roots. Persistent roots, per-open dropdown trees (each dropdown builds via `CommandMenuBuilder` on open and disposes on close — reuse Task 4's mechanism; if a `MenuButton` dropdown needs the same per-open hook, add it there mirroring `CommandContextMenu`).

- [ ] **Step 4: Register the main menu in `shell.template.mu`** — a `MenuStrip` bound to the service's roots, using the `CommandViewModel` `HierarchicalDataTemplate` from Task 3. Keep it behind the existing shell layout; do not disturb the toolbar.

- [ ] **Step 5: Run RED→GREEN + build:templates + shell regression**

Run the new test → PASS; `npm run build:templates` → OK; `npx tsx --conditions=development --test src/framework/shell/tests/` → green.

- [ ] **Step 6: Gate + commit**

Run: `npm run typecheck` → 0; `npm run typecheck:demos` → 0.
```bash
git add src/framework/shell/commands/main-menu-service.ts src/framework/shell/shell.template.mu src/framework/shell/tests/main-menu-service.test.ts
git commit -m "feat(mural): command-driven main menu (MenuStrip over CommandDefinition roots)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Migrate the menu / commands / context-menu demos + "Recent" dynamic submenu; publish Milestone A

**Files:**
- Modify: `demo/demos/menu/menu.mu` + `menu-vm.mts`, `demo/demos/commands/commands.mu` + `commands-vm.mjs`, `demo/demos/context-menu/context-menu.mu` + `context-menu-vm.mjs` (command-driven path)
- Create: a demo `ICommandContributor` for a "Recent" submenu (in the relevant demo VM module)
- Modify: the group barrels / `*-service.test.mts` demo-count assertions IF a demo's id/count changes (`demo/platform/groups/.../controls-service.test.mts` asserts `32`; `demos-service.test.mts` asserts `15` — update only if counts actually change)
- Modify: `package.json` version bump + publish (human-gated)

**Interfaces:**
- Consumes: everything above (`CommandMenuBuilder`, hierarchical menu rendering, `CommandContextMenu`, main menu, `.commands:` nesting from A1).
- Produces: the three demos render command-driven menus; a dynamic "Recent" submenu populates on open via a demo `ICommandContributor`.

- [ ] **Step 1: Migrate the `context-menu` demo to a `CommandContextMenu`** — replace the hand-authored nested `MenuItem` blocks (`context-menu.mu:30-156`) with `CommandDefinition` trees (authored in a `.commands:` block or constructed in the VM) rendered through `CommandContextMenu`. Keep the demo's visible behavior (the two-level Share ▸ Export submenu becomes a nested `CommandDefinition` tree). Add a dynamic "Recent" submenu backed by a demo `ICommandContributor` that returns a few `CommandDefinition`s on `Contribute`, so opening "Recent" shows them (and re-evaluates each open).

- [ ] **Step 2: Migrate the `menu` demo** — the `MenuButton` fly-out becomes command-driven (a `CommandDefinition` tree + the hierarchical template), preserving the `IsCheckable`/`IsChecked` items (now via `IsToggle`/`IsChecked` on the VM).

- [ ] **Step 3: Migrate the `commands` demo** — point its `MenuButton`/`ContextMenu` at the command-driven path over its existing `ICommand` catalog; the `ToolBar`/`Ribbon` already go through the command machinery.

- [ ] **Step 4: Build + demo tests** — `npm run build` (templates + demos + tsc); fix any demo group-count assertion that changed; `npm run test:demo` → green; `npm run typecheck:demos` → 0.

- [ ] **Step 5: Full verification (Milestone A exit)** — `npm test` (full), `npm run typecheck`, `npm run typecheck:demos`, `npm run test:demo` all green/0; the controller verifies the full suite out of band if it flakes.

- [ ] **Step 6: Commit the demos**

```bash
git add demo/
git commit -m "feat(mural): migrate menu/commands/context-menu demos to command-driven menus + Recent contributor

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 7: Publish Milestone A (HUMAN-GATED STOP)** — bump `package.json` (minor; this release removes `ICommandTarget` and adds the menu machinery), publish `@pragmatic-tech-ai/mural` to GitHub Packages, push `main` first. **Do NOT publish autonomously** — this is a human-gated release boundary; stop and hand off for the publish decision (merge/push/publish per finishing-a-development-branch).

---

## Self-Review notes (controller)

- **Spec coverage:** A6 lazy children → Task 1; A8 menu render path (recursive `MenuItem … ItemsSource=$Children`) → Tasks 2+3; A8 per-open build/dispose → Task 4; A8 main menu → Task 5; A8 demos + "Recent" contributor → Task 6; A9 (`.commands:` nesting + `ChildrenContributor` DP) already shipped in A1 — Task 6 validates it via the demos. Toggle→`IsChecked` on menu items → Task 3. Leak-freedom → Tasks 1+4. CanExecute propagation → Task 4.
- **Review Focus:** leak-freedom (Tasks 1,4), both static+contributor children (Task 1), self-referential contributor termination (Task 1), toggle-while-live (Task 3), CanExecute-after-selection-change (Task 4) — each has an owning test.
- **Open design points flagged for the implementer (rulings to settle at build time, not blockers):** (a) the exact `.mu` child-selector attribute for a `HierarchicalDataTemplate` (confirm against an existing one in the repo); (b) how a menu container reaches its bound data for the `OnSubmenuOpen` hook (`Generator.ItemFromContainer` / the `_itemsControlData` stamp — use the existing accessor); (c) whether the main-menu dropdowns need the same per-open build as `CommandContextMenu` or a lighter `MenuButton` binding; (d) the `isToggle` source in `CommandMenuBuilder.Build` (group presentation vs always-false) — Task 3's checkable test forces the answer.
- **A1 inert seams wired here:** `CommandViewModel.IsToggle` (now drives `MenuItem.IsCheckable`, Task 3) and the VM's `CompositeDisposable subscriptions` (receives the live command subscription in Task 4). The A1 partial-capability-document Minor is NOT revisited here (no new document types in A2).
- **Single publish:** only Task 6 Step 7 publishes; all earlier tasks keep the branch green but unpublished.
