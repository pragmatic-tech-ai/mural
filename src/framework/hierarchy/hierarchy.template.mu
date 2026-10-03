// Default `@HierarchyItemTemplate` — a HierarchicalDataTemplate over
// HierarchyItem, so a HierarchyItem binds into a TreeView out of the box
// (icon + caption + the Task 7 inline-rename affordance) — plus (Task 12)
// a keyed default TreeView STYLE that opts a TreeView into that template.
//
// `HierarchyItem` and `EditableTextBlock` aren't in the compiler's default
// symbol table (DEFAULT_SYMBOLS in src/compiler/symbol-table.ts only knows
// framework/basic built-ins), so both are pulled in via an explicit
// top-level `import … from "…"` clause, resolved through the package's own
// `exports` self-reference (the same path shape the generated `.mu.js`
// resolves at load time — see build-control-templates.ts's header comment).
// `HierarchyIconKeyToGeometry` (DR10's icon-resolution converter) is pulled
// in the same way.
//
// Wiring: this dictionary IS imported by framework.resources.mu (Task 12),
// folded into MuralFramework, which pragmatic.mu's theme already lists in
// its `dictionaries:` header — so `@HierarchyItemTemplate` / `@HierarchyTreeView`
// resolve application-wide with no further wiring.
//
// ── Task 12 design + rulings ───────────────────────────────────────────
//
// 1. WHY THE STYLE IS KEYED, NOT IMPLICIT (an unkeyed `Style [TargetType=
//    TreeView]` applied automatically to every TreeView). tree-view.
//    template.mu ALREADY registers an unkeyed `Style [TargetType=TreeView]`
//    (the shipped chrome: `Template = @DefaultTreeView`). A ResourceDictionary
//    registers an unkeyed `[TargetType=X]` Style under the single Function
//    key `X` (registerResourceFormVar in compiler.ts); merging a SECOND
//    unkeyed TreeView Style from this dictionary into the same merged
//    MuralFramework would silently overwrite/shadow that entry — losing the
//    shipped chrome for every TreeView, hierarchy-bound or not (confirmed by
//    reading registerResourceFormVar + resolve_implicit_style/resolve_theme_
//    style in element.ts: both resolve the SAME Function key via
//    TryFindResource, so there is exactly one slot per type per merged
//    scope). `BasedOn` can't rescue this either — tree-view.template.mu's
//    Style has no `x:key` to base on. So the hierarchy default is a
//    SEPARATE, explicitly-keyed Style (`x:key="HierarchyTreeView"`) an app
//    opts into with `TreeView [ Style = @HierarchyTreeView, … ]` — additive,
//    never replacing the base control style, per the task brief.
//
// 2. WHY THE BEHAVIOR BUNDLE IS NOT INSIDE THAT STYLE. The compiler
//    rejects a `Behaviors { … }` / `.Behaviors:` block at ANY Style body
//    level — keyed or not — unless it's nested inside a `when( … )` trigger
//    (compileStyleForm's EmitError: "Behaviors { … } block is only allowed
//    inside a when(…) trigger body — not at Style body level"). And a
//    `when( … )` trigger's enterActions never replay for an
//    already-true INITIAL condition — only a later false→true EDGE fires
//    them (TriggerHost.applyTransition's `isInitialEvaluation` gate) — so
//    there's no "always-true when()" trick either. A plain `Style` genuinely
//    cannot attach a Behavior unconditionally today. RULING: the four
//    behaviors (HierarchyTreeBehavior / HierarchyContextMenuBehavior /
//    HierarchyDropBehavior / HierarchyDragBehavior, all exported from
//    index.ts) are attached by the APP's own `.Behaviors:` block on its
//    TreeView — four lines, each independently includable/omittable, which is what makes the template
//    and the behavior bundle independently overridable (Review Focus 3):
//
//        TreeView [ Style = @HierarchyTreeView ] {
//            .Behaviors: {
//                HierarchyTreeBehavior        [ Hierarchy = $Hierarchy ]
//                HierarchyContextMenuBehavior [ Hierarchy = $Hierarchy ]
//                HierarchyDropBehavior        [ Hierarchy = $Hierarchy, Host = $Hierarchy.Host ]
//                HierarchyDragBehavior        [ Hierarchy = $Hierarchy ]
//            }
//            .ItemsSource: $Hierarchy.Roots
//        }
//
//    Extending Style/StyleApplicator so a Style CAN carry an unconditional
//    per-target Behaviors list (the AttachBehaviorAction/DetachBehaviorAction
//    machinery already does the per-target factory+WeakMap bookkeeping for
//    the when()-triggered case — only the "always attach on apply" lifecycle
//    hook is missing) would close this gap for real; it touches Style +
//    StyleApplicator (used by every control in the framework), so it's left
//    as a C2 candidate rather than attempted inside this integration task.
//
// 3. `$Hierarchy.Host` — Hierarchy (hierarchy.ts) exposes a `Host` getter
//    (Task 12 addition) widening its constructor's IHierarchyItemHost to the
//    full HierarchyHost surface HierarchyDropBehavior needs, so the SAME
//    DataContext property (`$Hierarchy`) that supplies `ItemsSource =
//    $Hierarchy.Roots` also supplies both behavior DPs — no second
//    DataContext property required.
//
// 4. BEHAVIOR-ATTRIBUTE BINDINGS NOW RESOLVE AGAINST THE HOST (compiler fix).
//    A Behavior has no DataContext of its own (Behavior extends MuralBase
//    directly, not Element — behavior.ts), so `$Hierarchy` written on a
//    Behavior's own attribute used to throw ("Property 'DataContext' not
//    found in model 'HierarchyTreeBehavior'") — confirmed by probe before
//    this task's fix. compiler.ts's `behaviorHostVar` now redirects binding
//    resolution (DataContextBinding / DynamicResource / etc.) inside a
//    `.Behaviors:`/`Behaviors{}` entry to the HOST Visual (the TreeView),
//    matching WPF's own AssociatedObject model. General fix — benefits any
//    future Behavior, not hierarchy-specific.
//
// 5. ORDERING — behaviors must attach BEFORE ItemsSource goes live (Task 9's
//    AddContainerPreparedListener contract: late attach does not replay
//    already-realized rows). `compileElement` compiles ATTRIBUTES before
//    BODY ITEMS, so `TreeView [ ItemsSource = $Hierarchy.Roots ] { .Behaviors:
//    {…} }` gets the WRONG order (ItemsSource set, then behaviors attach).
//    Use the SLOT-ASSIGN form for ItemsSource (`.ItemsSource: $Hierarchy.Roots`)
//    placed AFTER `.Behaviors:` in the body (both are body items, processed
//    in source order) — exactly as shown above. Selection mirroring is
//    unaffected either way (it reads SelectedItems live); only inline-rename
//    wiring on ALREADY-realized rows depends on this order.
//
// 6. RULING — drag-SOURCE wiring (C2 wave 3, Task 3). HierarchyDropBehavior
//    (Task 11) was the receiver side only; HierarchyDragBehavior
//    (hierarchy-drag-behavior.ts) is the sibling source side — it sets
//    IsDraggable=true + an OnDragStart callback on every realized row
//    container (both already-realized ones, walked at OnAttached, and
//    future ones via AddContainerPreparedListener), stamping the live
//    Selection's ItemId[] under HierarchyItemsDrop.Kind exactly as
//    HierarchyDropBehavior.decodeDraggedIds expects. Gated on the pressed
//    row being part of the current Selection (drags the WHOLE selection,
//    not just the pressed row) — an unselected row returns null (no drag).
//    Included in the bundle above as a fourth, independently includable/
//    omittable line, same as the other three.
//
// 7. RULING — deep (nested-descendant) drop targeting is PARKED for C2.
//    HierarchyDropBehavior.resolveTarget (Task 11) only walks the ATTACHED
//    host's own `logicalChildren` (its root rows); dropping over a nested
//    descendant resolves to that row's ROOT ancestor, not the exact nested
//    row under the cursor. C1 ships root-level drop; resolving nested rows
//    needs resolveTarget to recurse into each realized container's own
//    ItemsPresenter, a moderate behavior change better scoped with its own
//    tests.
//
// 8. RULING — the keyboard context-menu position (Task 10's known gap:
//    Key.Apps always opened at host (0,0)) IS fixed here, now that a real
//    TreeView + Generator is wired end-to-end. HierarchyContextMenuBehavior.
//    HandleKeyDown (hierarchy-context-menu.ts) resolves the Hierarchy's
//    current Anchor's realized container via `visual.Generator.
//    ContainerFromItem(anchor)` and opens at that row's bottom-left corner
//    (same host-root-relative coordinate space `args.HostX`/`args.HostY`
//    already use for the pointer path), falling back to (0, 0) when there's
//    no anchor or no realized container — cheap because Generator.
//    ContainerFromItem is a public, already-stable API, not new plumbing.

import HierarchyItem from "@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-item.js"
import EditableTextBlock from "@pragmatic-tech-ai/mural/basic/editable-text-block.js"
import HierarchyIconKeyToGeometry from "@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-icon-converter.js"

resources Hierarchy {
    // PART_Icon resolves IconKey through the resource system (DR10): the
    // converter treats the string as a resource key and resolves it via
    // Application.ResolveDefaultResource, rendering nothing when the key
    // is '' or unresolved (Shape.Geometry = undefined paints nothing).
    // The caption path (EditableTextBlock) doesn't depend on the icon
    // resolving at all.
    HierarchicalDataTemplate x:key="HierarchyItemTemplate" [DataType = HierarchyItem, itemsselector = Children] {
        StackPanel [ Orientation = Horizontal ] {
            Shape x:name="PART_Icon" [ Geometry = $IconKey << HierarchyIconKeyToGeometry, Width = 16, Height = 16 ]
            EditableTextBlock x:name="PART_Caption" [ Text = $Caption, IsEditing = $IsEditing, EditingText = $EditingName ]
        }
    }

    // Keyed, explicit opt-in default — does NOT touch TreeView's own
    // implicit/theme style slot (see ruling 1 above), so the shipped chrome
    // (tree-view.template.mu) is untouched for every TreeView that doesn't
    // ask for this. An app opts in with `TreeView [ Style = @HierarchyTreeView
    // ] { … }`; overriding `ItemTemplate` directly on that same TreeView (a
    // local value) still wins over this Style setter, same DP-tier precedence
    // as any other Style.
    Style x:key="HierarchyTreeView" [TargetType = TreeView] {
        ItemTemplate = @HierarchyItemTemplate;
    }
}
