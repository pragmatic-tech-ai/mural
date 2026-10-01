# Hierarchy Consolidation — HierarchyItem / Hierarchy, integer ids, multi-contribution composition, command-driven actions

**Status:** design draft 2026-10-01
**Part of:** Mural hierarchy/command roadmap, **Milestone B** of Phase 0 → A → B → C1 → C2. Absorbs issue #4 (multi-contribution ownership).
**Depends on:** Phase 0 (`IDisposable` / `Disposable` / `CompositeDisposable`) and Milestone A (command machinery).
**Followed by:** Milestone C1 (Mural `Hierarchy { }` DSL + default `TreeView` integration).
**Deferred:** Milestone C2 — the Plexus project-explorer consumer migration (**requires further research**). B ships a **breaking** mural release; Plexus stays pinned to the prior mural until C2.
**Repo:** Mural

## Goal

Dissolve the four hierarchy types into two observable types, give items plain integer ids, replace the delta / observe-children protocol with providers mutating observable `Children` through an `IDisposable` realize handle, make every parent compose multiple contributions under one owner (absorbing #4, including the provider-integration hook), and move actions onto Milestone A's command machinery. Ship a new mural release.

The single `Hierarchy { }` registration DSL and the default `TreeView` integration are split into **Milestone C1** (Mural). Within B, registration uses the existing `.hierarchyContributors:` member block and `.commands:` (with an explicit `Context = <node key>`); C1 adds the unified `Hierarchy { }` sugar and the out-of-box `TreeView`.

## Background (current state + friction)

Four types carry one concern between them:

- `HierarchyNode` (data), `HierarchyItemVM` (the `Observable` row), `HierarchyModel` (the headless composition engine), `HierarchyTreeVM` (the `Observable` tree). `HierarchyItemId` is an opaque id (Root/Nil/Mint).
- Children flow as `HierarchyChange` deltas (`ChildAdded`/`ChildRemoved`/`ChildUpdated`); a provider enumerates via `ObserveChildren(node, sink): () => void`.
- `HierarchyModel.RealizeChildren` **short-circuits on the first `ProviderContribution`** — one provider per parent. To place Connections + References + files under one project node, Plexus hand-builds a composite `ProjectBranchesProvider` plus a `LeadingBranch` protocol — a mini-provider framework that exists only to work around "one provider per parent."
- Actions ride a parallel stack: `IHierarchyActionContributor` / `HierarchyAction` / `HierarchyActionDefinition` / `HierarchyActionContributorRegistry`, surfaced through a **singleton** `@HierarchyContextMenu` resource that does not reliably refresh its items per open for the same node.

The engine is, in substance, a presentation layer — so this consolidates it fully rather than preserving an internal engine/VM split.

## Design

### B1. Two observable types

- **`HierarchyItem extends Observable`** merges `HierarchyNode` + `HierarchyItemVM`. The instance **is** identity (no separate node/vm pairing). It carries `Key` / `Caption` / `IconKey` / `Severity` / `Error` / `CanonicalSegment` / `IsExpandable`, an observable `Children: ObservableCollection<HierarchyItem>`, `IsEditing` / `EditingName`, lazy `OnExpand` / `OnCollapse` (Loading… sentinel), `OnActivate`, and an integer `Id` (B2). `CanonicalName` (string) remains the durable identity.
- **`Hierarchy extends Observable`** merges `HierarchyModel` + `HierarchyTreeVM`. It owns the realize engine (contributor resolution, keyed interning, provider attachment, composition), `Roots`, `Selection` / `Anchor`, `Reveal`, the command services from Milestone A (dispatcher / contributor / `CommandRegistry` access), and lifecycle/disposal.
- Both extend `Observable` (the lightweight INPC root), never `MuralBase`.

### B2. Integer item ids

`type ItemId = number` (plain — no branding). A per-`Hierarchy` monotonic `ItemIdAllocator` mints ids from 1 (`0 = None`). Ids are **transient** handles identifying an item within a live tree; `CanonicalName` stays the durable, cross-session identity used for reveal/restore.

### B3. Children realization — providers mutate `Children`

- Delete `HierarchyChange` deltas and `IHierarchyProvider.ObserveChildren(node, sink)`.
- New provider contract: `Realize(item: HierarchyItem, context): IDisposable`. The provider populates and maintains `item.Children` **directly** (it is observable) and returns an `IDisposable` that tears down its subscriptions / disk watches. Lazy and disk-watched children keep working through the provider holding its watches until the handle is disposed.
- Keep `GetProperty` / `GetCanonicalName` / `ParseCanonicalName` / `CanAccept`; provider teardown is `dispose()`.

### B4. Multi-contribution composition + ownership (absorbs #4)

- `RealizeChildren` processes **all** contributors for a parent `Key` in `Order` — no first-provider short-circuit. Keyed `NodeContribution`s intern as today; **each** `ProviderContribution` attaches at the parent in its own `Order` slot. A parent entry holds a **list** of provider attachments, aggregated in a `CompositeDisposable`.
- **One owner per subtree:** the model owns the root/keyed regime (root + keyed nodes); each provider owns its own sub-branch (identity, child maintenance, canonical name, disposal). Contributors are extension hooks, never owners — there are no independent provider roots.
- **Provider-integration hook (the #4 fork, built now):** below a provider boundary, the model gathers registry contributions for a node's `Key` and hands them to the owning provider to integrate and own (e.g. an `Integrate(item, contributions)` method on `IHierarchyProvider`), so a contributor can inject nodes into a provider-owned subtree and the provider still owns every node in its subtree.
- **Canonical-name disambiguation:** a per-contribution segment namespace keeps `CanonicalNameOf` deterministic when two sibling providers (or a provider and a keyed sibling) emit colliding relative names.
- **Re-realization** (on a contributor-set change) idempotently prunes/adds keyed children and attaches new / detaches removed providers **without** tearing down surviving providers' subscriptions and subtrees.

### B5. Actions via the command machinery (consumes Milestone A)

- **Delete** `IHierarchyActionContributor`, `HierarchyAction`, `HierarchyActionDefinition`, `HierarchyActionContributorRegistry`, the `.hierarchyActions:` seam, and the action-descriptor concept.
- `IHierarchyContributor extends ICommandDispatcher` — the owner of a node `Key` dispatches that node's commands via `Resolve(id, HierarchyActionContext)`.
- `HierarchyActionContext extends CommandContext` — `Anchor` (the item) + `Selection` (the tree selection).
- A node's menu = `CommandDefinition`s scoped to its `Key` (`CommandRegistry` filtered by `Context = Key`) plus dynamic children via `ICommandContributor` / `ChildrenContributor`. Within B these are authored in `.commands:` with an explicit `Context = <node key>` (the `Hierarchy { Actions … }` sugar that makes `Context` implicit is C1).
- `HierarchyItem.BuildActions(context): ObservableCollection<CommandViewModel>` builds the menu VM tree (Milestone A's unified VM): pull the scoped roots, resolve each via the dispatcher, merge declared + contributed children lazily, wrap each as a `CommandViewModel`.
- `BuildActions` is the **per-open** builder: it is called afresh on each request and its returned collection is disposed when the menu closes — no retained menu, so the per-open staleness is resolved by construction. The default `TreeView` context-menu *behavior* that invokes it on right-click, and the removal of the `@HierarchyContextMenu` singleton resource, land in **Milestone C1**.

### B6. Preservation (carried intact)

Selection (`SelectSingle` / `Toggle` / `Deselect` / `SyncSelection`), canonical-name reveal/restore (`Reveal` + `CanonicalNameOf`), lazy / disk-watched children (via the provider `Realize` handle holding watches), and lifecycle/disposal (a `CompositeDisposable` threading item → provider → hierarchy). Behavior is preserved; the implementation relocates onto the two dissolved types.

## Testing / verification

- Dissolution: a `HierarchyItem` is its own identity; integer ids mint from 1 via the allocator (`0 = None`); `CanonicalName` is the durable key.
- Realize: a provider mutates `item.Children`; `dispose()` tears down its watches; no delta channel remains.
- Composition: multiple providers + keyed leaves under one parent compose in `Order`; one-owner holds; the provider-integration hook owns contributor-injected nodes; canonical-name disambiguation stays deterministic; re-realization does not tear down surviving providers.
- Actions: a node menu builds from scoped `CommandDefinition`s authored in `.commands:` with explicit `Context`; the dispatcher resolves against `HierarchyActionContext`; dynamic `Build ▸ targets` populate via `ChildrenContributor`; `BuildActions` builds a fresh VM tree per call and the returned collection disposes cleanly (no retained state).
- Preservation: selection operations; reveal/restore of a node across a tree rebuild; lazy expand with the Loading… sentinel; full disposal with no leaked subscriptions.

**Review focus** (inputs the spec implies but no single test above targets):
- Async provider arrival inserting late children into the correct `Order` slot (not appended at the end).
- Canonical-name collision across two sibling providers, and between a provider child and a keyed sibling.
- Re-realization churn: a contributor set that adds one provider and removes another leaves surviving providers' subtrees and subscriptions intact.
- `dispose()` idempotency and leak-freedom across collapse/expand/collapse of a provider-owned parent (assert subscription counts return to baseline).
- `Reveal` of a node that lives inside a provider-owned subtree (canonical path crosses the provider boundary).

Full Mural suite + `typecheck` + `typecheck:demos` + `test:demo` green. Publish mural (minor; **breaking** — the dissolved API replaces the four types and the action stack). Push `main` first.

## Scope / non-goals

- The `Hierarchy { }` DSL and the default `TreeView` integration are **Milestone C1** (Mural, active). B registers contributors through the existing `.hierarchyContributors:` member block and actions through `.commands:` (explicit `Context = <node key>`); C1 adds the unified sugar and the out-of-box `TreeView`.
- The **Plexus project-explorer migration is Milestone C2** and **requires further research** (provider-ownership modeling); B does **not** touch Plexus. B is a breaking mural release; Plexus stays pinned to the prior mural until C2.
- Mural's own suite and demos stay green (internal hierarchy usages and tests update with the dissolution).
- No new command machinery (Milestone A owns it); the main-menu Plexus swap also defers.
