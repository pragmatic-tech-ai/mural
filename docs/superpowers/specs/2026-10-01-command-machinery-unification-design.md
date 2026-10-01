# Command Machinery Unification — hierarchical CommandDefinition + ICommandDispatcher / ICommandContributor + one Observable command VM

**Status:** design draft 2026-10-01
**Part of:** Mural hierarchy/command roadmap, **Milestone A** of Phase 0 → A → B.
**Depends on:** Phase 0 (todl-runtime `IDisposable` / `Disposable` / `CompositeDisposable`).
**Consumed by:** Milestone B (hierarchy consolidation). Milestone C (Plexus project-explorer migration) is deferred.
**Repo:** Mural

## Goal

Turn Mural's command subsystem into a single hierarchical, surface-agnostic stack:

- a **tree-shaped `CommandDefinition`** (gains `Children` + a `ChildrenContributor`),
- one **`ICommandDispatcher`** that resolves a command id + context to an executor `ICommand` — **replacing `ICommandTarget`**,
- one **`ICommandContributor`** that supplies a command's dynamic children,
- one **`Observable` command view-model** used by every surface (toolbar, main menu, and — in Milestone B — hierarchy node menus).

Ship a new mural release. No hierarchy changes here. No forced consumer changes — existing `.commands:` declarations keep working (the change is additive on the declaration side; breaking only in that `ICommandTarget` is removed, which only Mural-internal code implements).

## Background (current state)

- `CommandDefinition` (`src/framework/shell/commands/command-definition.ts`) is flat chrome + identity: `Id`/`Title`/`Icon`/`Context`/`Group`/`Order`/`Region` + a responsive group-presentation set (`Presentation` = Flat/SplitMenu/SplitGrid/Toggles, `GroupIcon`/`GroupTitle`/`Columns`/`SeparatorBefore`). It has **no handler**.
- `CommandRegistry` aggregates definitions across modules, keyed by string `Id`, deduped (first module wins).
- `ICommandTarget` (`command-target.ts`): `CommandContexts` + `Execute(def)` + `CanExecute(def)` + optional `IsActive(def)`, duck-typed. The **active document** implements it; `ToolbarService` filters the registry by the active document's live contexts, and for each visible def builds a `CommandViewModel` (`MuralBase`) wrapping `new RelayCommand(() => Invoke(def), () => CanInvoke(def))`, where `Invoke` → `ActiveTarget().Execute(def)`.
- `DiagramDocument` (`src/framework/diagram/diagram-document.ts`) holds `DIAGRAM_COMMAND_GETTERS` (a `Map<id, (v) => ICommand>`) and `DIAGRAM_COMMAND_ACTIVE`; `Execute(def)` forwards to the resolved command on the active view.
- The main menu is hand-wired `MenuItem` markup in the `@WindowMenuItems` `ControlTemplate` (Plexus window-chrome), **not** command-driven.

Weaknesses this milestone removes: `CanExecute` is a pull query plus a manual `RaiseCanExecuteChanged()` pulse; only one active context exists at a time; there is no dynamic-children concept; menus are hand-authored.

## Design

### A1. Adopt the Disposable foundation

Bump todl-runtime to the Phase 0 release. Migrate Mural's `Disposable`-typed references to `IDisposable`; where Mural returns or stores a teardown handle, use `new Disposable(() => …)` or `CompositeDisposable`. The per-open menus built below dispose through these.

### A2. `CommandDefinition` becomes hierarchical (additive)

- Add `Children: ObservableCollection<CommandDefinition>` as the **markup content collection** — a `.commands:` entry's `{ }` body lowers into its `Children`.
- Add `ChildrenContributor: ServiceToken<ICommandContributor> | undefined` (a DP, following the `Contributor = X` / `Context = X` precedent). It names a contributor that supplies this command's children at build time, **merged after** any static `Children`. Resolution is lazy (on expand) and recursive (a produced child may set its own `ChildrenContributor`, including back to the same token).
- `CommandRegistry` indexes **every node by `Id`** at any depth (so an `Id` reference resolves whether the command is a root or nested), deduped by `Id` as today.
- `Group` / `Presentation` / `GroupIcon` / `GroupTitle` / `Columns` / `SeparatorBefore` are **untouched**. Responsive toolbar grouping (collapse to a split-button when space is tight; force it with `Presentation = SplitMenu`) and structural nesting (`Children`) are orthogonal axes. `SeparatorBefore` doubles as the menu divider marker — no separate separator element.

### A3. `ICommandDispatcher` replaces `ICommandTarget`

- `CommandContext` — the dispatch-context base. It carries the active document + selection for the toolbar/main menu; Milestone B adds `HierarchyActionContext extends CommandContext` (anchor + selection).
- The interface:

```ts
export interface ICommandDispatcher
{
    Resolve(commandId: string, context: CommandContext): ICommand | undefined;
}
```

`Resolve` returns the executor already **bound to the context** (closure), so `Execute` + `CanExecute` + change-notification travel together on the returned `ICommand` (a `RelayCommand`). There is no separate `CanExecute(def)` pull.

- **Delete `ICommandTarget`.** `DiagramDocument` implements `Resolve` by surfacing its existing `DIAGRAM_COMMAND_GETTERS` map (id → the `ICommand` on the active view) instead of `Execute(def)` / `CanExecute(def)`.
- The shell tracks the active dispatcher exactly as it tracked the active target (the active document is the ambient `ICommandDispatcher` for the toolbar / main menu).

### A4. `ICommandContributor` (dynamic children)

```ts
export interface ICommandContributor
{
    Contribute(parent: CommandDefinition, context: CommandContext): readonly CommandDefinition[];
}
```

Resolved from a definition's `ChildrenContributor`. **Origin-agnostic**: declared children and contributed children merge (declared first), and the dispatcher never distinguishes them — it is only ever handed an `Id`. This replaces any parent-id-keyed contributor registry (none is introduced).

### A5. Toggle state onto the command

`IsActive(def)` leaves with `ICommandTarget`. A toggle command is an `ICommand` exposing an observable `IsChecked`; the command VM binds it. `DiagramDocument`'s active-state map (`DIAGRAM_COMMAND_ACTIVE`) feeds the resolved command's `IsChecked`. Toggle state now travels with the executor rather than being a side method on a target.

### A6. One `Observable` command VM

A single `CommandViewModel extends Observable` (**not** `MuralBase`) used by every surface:

- `Definition: CommandDefinition`, resolved `Command: ICommand | undefined`, `Children: ObservableCollection<CommandViewModel>`.
- Read-through getters: `Title` / `Icon` / `SeparatorBefore` / `IsChecked` / `HasChildren` over `Definition` / `Command`.
- `implements IDisposable`: `dispose()` disposes its children and releases the resolved command's subscriptions (via `CompositeDisposable`).
- Lazy children: expandable when it has static `Children` or a `ChildrenContributor`; populates `Children` on first expand (resolve the contributor, merge after static children, wrap each child).
- Flat surfaces (toolbar) leave `Children` empty; tree surfaces (menus) populate it. The responsive `Group`/`Presentation` grouping stays a template concern read off `Definition`, not VM state.

**Delete `CommandToggleViewModel`** — its toggle role folds into `IsChecked`. The old `MuralBase`/DP `CommandViewModel` is replaced by this `Observable` one.

### A7. Toolbar migration

`ToolbarService` stops wrapping `Invoke(def)` / `CanInvoke(def)`. For each visible def it **resolves** `ICommand` via the active `ICommandDispatcher` and binds it on a `CommandViewModel`. Responsive `Group`/`Presentation` grouping is unchanged. This removes the `CanExecute` pull-and-pulse weak spot — the resolved `RelayCommand` owns its notification.

### A8. Menu rendering machinery + main menu

- Provide the menu render path: the unified `CommandViewModel` **tree** plus a menu template/control that binds it recursively — `MenuItem [ Header = $Title, Icon = $Icon, Command = $Command, ItemsSource = $Children ]` — **built per open and disposed on close**.
- Main menu: Mural's menu machinery renders a `CommandDefinition` tree as a drop-down menu via the unified VM (persistent bar roots, per-open dropdown trees). Validate with Mural's `menu` / `commands` / `context-menu` demos migrated to the command-driven path, including a dynamic `ChildrenContributor` submenu (e.g. a demo "Recent") that populates on open.
- The Plexus `@WindowMenuItems` File-menu swap is a **consumer** change, deferred with Milestone C — A delivers and demonstrates the machinery, not the Plexus adoption.

### A9. Compiler / DSL

- `.commands:` entries nest: a `CommandDefinition { … }` body lowers into its `Children` (designate `Children` as the content collection for `CommandDefinition`).
- `ChildrenContributor = X` lowers to a `ServiceToken` DP (the `Contributor = X` precedent).
- The `Hierarchy { }` block is **Milestone B**; A adds only command-tree nesting and the new DPs.

## Testing / verification

- `CommandDefinition`: nested children author and lower into `Children`; registry indexes nested ids and dedupes collisions; `ChildrenContributor` DP resolves.
- `ICommandDispatcher`: `Resolve` returns a context-bound command; `CanExecute` rides it; `DiagramDocument` resolves its ids via the existing getter map.
- `ICommandContributor`: declared + contributed children merge (declared first); lazy on expand; a self-referential contributor terminates.
- `CommandViewModel`: `Observable` (no `MuralBase`); `dispose()` releases children + subscriptions, idempotently; flat vs tree; `IsChecked` toggle reflects active state.
- Toolbar: the existing diagram toolbar still renders and invokes through the dispatcher; responsive groups intact; `CanExecute` updates when document state changes (no manual pulse).
- Main menu: the Mural menu demo renders a `CommandDefinition` tree and invokes through the dispatcher; a `ChildrenContributor` submenu populates on open and its contributed child dispatches like a declared one.

**Review focus** (inputs the spec implies but no single test above targets):
- `CanExecute` change propagation after the source document's selection/state changes mid-session.
- `dispose()` idempotency and leak-freedom on repeated menu open/close (assert `Signal.subscriberCount` returns to baseline).
- Nested-`Id` dedupe when two modules declare the same nested id.
- A command carrying **both** static `Children` and a `ChildrenContributor` (order + no duplication).
- A toggle command whose active state changes while its menu/toolbar item is live.

Full Mural suite + `typecheck` + `typecheck:demos` + `test:demo` green. Publish mural (minor; removes `ICommandTarget`). Push `main` first.

## Scope / non-goals

- No hierarchy types or node menus (Milestone B).
- No Plexus changes: diagram `.commands:` stay valid (additive); the Plexus File-menu swap defers to Milestone C.
- `IsActive` → `IsChecked` is limited to the diagram's existing toggle commands.
