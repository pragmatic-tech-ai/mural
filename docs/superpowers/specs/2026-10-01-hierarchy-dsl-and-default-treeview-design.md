# Hierarchy Registration DSL + Default TreeView Integration

**Status:** design draft 2026-10-01
**Part of:** Mural hierarchy/command roadmap, **Milestone C1** of Phase 0 → A → B → C1 → C2.
**Depends on:** Milestone A (command machinery) and Milestone B (`HierarchyItem` / `Hierarchy`, command-driven actions, `HierarchyItem.BuildActions`).
**Followed by:** Milestone C2 — the Plexus project-explorer consumer migration (**requires further research**).
**Repo:** Mural

## Goal

Add the two Mural-resident pieces that sit on top of the B engine so a hierarchy is authored in one block and binds to a tree with no hand-wiring:

1. the single **`Hierarchy { }` registration DSL** — compiler sugar lowering to the `HierarchyContributors` and `Commands` module collections (with an implicit `Context`) plus the per-node dispatcher registration;
2. the **default `TreeView` integration** — a `HierarchicalDataTemplate` over `HierarchyItem`, a default `TreeView` style wiring the hierarchy behaviors (selection / keyboard / expansion / drag-drop / dynamic context menu), each overridable by key.

Out-of-the-box path after C1: construct a `Hierarchy`, bind `TreeView.ItemsSource = $Hierarchy.Roots` — template, behaviors, and menu all defaulted. Ship a new mural release.

## Background (state after B)

- Registration is spelled out per surface: structure contributors via the existing `.hierarchyContributors:` member block, actions via `.commands:` with an explicit `Context = <node key>` repeated on each command.
- `HierarchyItem.BuildActions(context)` exists (B5) as the per-open menu VM-tree builder, but nothing wires it into a `TreeView` — a consumer hand-lists the tree behaviors and (today) a singleton context-menu resource.
- The `HierarchicalDataTemplate`, behavior list, and context menu live as hand-written markup in the consumer. C1 moves the generic defaults into Mural.

## Design

### C1.1 The `Hierarchy { }` registration DSL

A single block a module authors, lowering into existing collections plus Milestone A's:

```
Hierarchy
{
    Contributor [ Under = Root,       Use = ProjectsContributor,    Order = 10 ]
    Contributor [ Under = ProjectKey, Use = ConnectionsContributor, Order = 10 ]
    Contributor [ Under = ProjectKey, Use = ReferencesProvider,     Order = 20 ]

    Actions [ For = ProjectKey, Use = ProjectDispatcher ]
    {
        CommandDefinition [ Id = "project.build", Title = "Build", Icon = @Build, ChildrenContributor = BuildTargetsContributor ]
        {
            CommandDefinition [ Id = "project.build.default", Title = "Build (Default)" ]
        }
        CommandDefinition [ Id = "project.rename", Title = "Rename", Icon = @Rename ]
        CommandDefinition [ Id = "project.remove", Title = "Remove from Solution", SeparatorBefore = true ]
    }
}
```

Lowering (compiler + `ShellModule`):
- `Contributor [ Under = K, Use = S, Order = N ]` → `module.HierarchyContributors.Add(HierarchyContributorDefinition{ ParentKeys: [K], Contributor: S, Order: N })`. `Under` accepts a list for a contributor attaching under several parents.
- `Actions [ For = K, Use = R ] { … }` → each top-level `CommandDefinition` → `module.Commands.Add(def)` with `Context = K` **implicit** (never repeated on the child defs); nested definitions become `Children`; `Use = R` registers the dispatcher/contributor for node kind `K`.
- `SeparatorBefore` is the divider marker; nesting + `ChildrenContributor` are inherited from Milestone A's hierarchical `CommandDefinition`.
- The `Hierarchy` block is a composite member-block: it fans out into the two existing collections, so nothing downstream of registration changes — it is pure authoring sugar over what B already consumes.

### C1.2 Default `TreeView` integration

Mural ships three defaults, each overridable by key:

- **Hierarchy data template** — a `HierarchicalDataTemplate` over `HierarchyItem` (itemsselector = `Children`) rendering icon + caption + the inline-rename affordance (`IsEditing` / `EditingName`), bound against `HierarchyItem`'s observable surface.
- **Default `TreeView` style / container** wiring the hierarchy behaviors as a bundle — selection, keyboard, expansion (lazy `OnExpand` / `OnCollapse` with the Loading… sentinel), drag/drop — so a consumer no longer re-declares the behavior list.
- **Dynamic context-menu behavior** — on right-click it calls `HierarchyItem.BuildActions(context)` for the clicked item (with the live selection as context), renders the returned `CommandViewModel` tree as a fresh menu, and **disposes it on close**. No `@HierarchyContextMenu` singleton resource; the app supplies only the action *item* template if it wants a non-default look.

An app overrides any of the three by key (its own template, its own behavior bundle, its own menu-item look) without touching the others.

## Testing / verification

- DSL: a `Hierarchy { }` block lowers to the expected `HierarchyContributors` entries + `Commands` entries with implicit `Context` + dispatcher registration; a nested `CommandDefinition` body lands in `Children`; `Under` as a list fans to multiple `ParentKeys`.
- Default template: a `HierarchyItem` renders icon + caption; inline rename toggles via `IsEditing`.
- Default behaviors: binding `TreeView.ItemsSource = $Hierarchy.Roots` with no app markup yields selection, keyboard nav, lazy expansion (Loading… sentinel), and drag/drop.
- Dynamic menu: right-click builds a fresh menu from `BuildActions`, reflects the current resolution on each open (no staleness), and disposes on close (assert subscription counts return to baseline across repeated opens).
- Override: an app-supplied data template / behavior bundle / menu-item template replaces the default by key while the others stay defaulted.

**Review focus:**
- A command whose `ChildrenContributor` submenu opens inside the context menu (lazy populate on expand, then dispose on menu close).
- Keyboard-driven menu open (context-menu key) vs. right-click — both route through `BuildActions`.
- An app that overrides only the data template keeps the default behaviors and menu.

Full Mural suite + `typecheck` + `typecheck:demos` + `test:demo` green. Publish mural (minor). Push `main` first.

## Scope / non-goals

- Mural only. No Plexus adoption — that is **Milestone C2** (requires further research).
- No engine changes (B owns `HierarchyItem` / `Hierarchy` / composition / `BuildActions`) and no command-machinery changes (A owns `CommandDefinition` / `ICommandDispatcher` / the VM).
- The DSL is sugar over the `HierarchyContributors` + `Commands` collections B already consumes; it adds no new runtime registration path.
