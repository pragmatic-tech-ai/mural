import HierarchyTreeVM from "./hierarchy-tree-vm.mjs"
import HierarchyItem from "@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-item.js"
import HierarchyTreeBehavior from "@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-tree-behavior.js"
import HierarchyContextMenuBehavior from "@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-context-menu.js"
import EditableTextBlock from "@pragmatic-tech-ai/mural/basic/editable-text-block.js"

// hierarchy-tree.mu — end-to-end Hierarchy {} DSL + default-TreeView demo
// (Milestone C1, Task 13). Two panes, both bound to the SAME Hierarchy
// (HierarchyTreeVM, constructed from the Hierarchy {} block declared in
// hierarchy-tree.module.mu — see that file for the Contributor fan-out):
//
//   * Left:  fully out-of-box — Style = @HierarchyTreeView (resolving the
//            default @HierarchyItemTemplate) plus the sanctioned default
//            .Behaviors: bundle (HierarchyTreeBehavior +
//            HierarchyContextMenuBehavior) plus ItemsSource =
//            $Hierarchy.Roots. No app-authored template, no app-authored
//            behavior code: a plain Style can't attach a Behavior
//            unconditionally (hierarchy.template.mu ruling 2), so this
//            three-line .Behaviors: bundle IS the out-of-box path, not
//            bespoke per-app wiring.
//   * Right: the SAME default .Behaviors: bundle, but ItemTemplate is
//            overridden BY KEY (@HierarchyTreeDemoItemTemplate below) —
//            proving the template and the behavior bundle are independently
//            overridable (Task 12 Review Focus 3).
//
// Both TreeViews set DataContext directly (via $service(HierarchyTreeVM),
// not inherited) because a Behavior's OnAttached runs the instant
// `.Behaviors:` is compiled — before its host TreeView is attached to ITS
// OWN parent — so DataContext inheritance from an ancestor is not live yet
// at that point. See hierarchy-tree-vm.mts's class doc comment (and
// src/framework/hierarchy/tests/hierarchy-treeview-integration.test.ts's
// own comment #2) for the full mechanics; $service(...) resolves through
// the service container instead, with no attach-order dependency.
//
// Drag-and-drop is deliberately NOT part of this demo: HierarchyDropBehavior
// is receiver-only today (hierarchy.template.mu ruling 6) — nothing in the
// framework stamps a row's drag payload yet, so wiring a drag gesture here
// would only fake the feature. That gap is parked for Milestone C2.
resources HierarchyTreeDemo {
    // Override-by-key item template for the right-hand tree: the same
    // shape as the default @HierarchyItemTemplate (hierarchy.template.mu) —
    // an EditableTextBlock caption, so F2 inline-rename keeps working — but
    // with a plain text marker instead of the default's icon-converter
    // Shape, so the override is visually obvious against the left pane.
    HierarchicalDataTemplate x:key="HierarchyTreeDemoItemTemplate" [DataType = HierarchyItem, itemsselector = Children] {
        StackPanel [ Orientation = Horizontal ] {
            TextBlock [ Text = ">", FontWeight = Bold, Foreground = @Primary, Margin = (0,0,6,0) ]
            EditableTextBlock [ Text = $Caption, IsEditing = $IsEditing, EditingText = $EditingName ]
        }
    }

    DataTemplate [DataType = HierarchyTreeVM] {
        Border x:root
            [ Fill   = @Surface,
              Stroke = Pen [ Brush = @OutlineVariant ] ] {
            // x:root owns the NameScope; neither pane needs FindName here
            // (no OnViewMounted at all — this demo's whole point is that
            // nothing is wired imperatively).

            DockPanel {
                Border [ DockPanel.Dock = Top, Fill = @Primary, Padding = (16,12,16,12) ] {
                    TextBlock
                        [ Text       = "Hierarchy — Hierarchy{} DSL + default TreeView (left) vs. item-template override by key (right)",
                          FontSize   = 15,
                          FontWeight = Bold,
                          Foreground = @OnPrimary ]
                }

                StackPanel [ Orientation = Horizontal ] {
                    // ── Left: fully out-of-box ──────────────────────────
                    StackPanel [ Orientation = Vertical, Width = 320, Margin = (12,12,6,12) ] {
                        TextBlock
                            [ Text       = "Out-of-box — Style + default .Behaviors: bundle only",
                              FontSize   = 12,
                              FontWeight = Bold,
                              Foreground = @OnSurfaceVariant,
                              Margin     = (0,0,0,8) ]
                        TreeView [ DataContext = $service(HierarchyTreeVM), Style = @HierarchyTreeView ] {
                            .Behaviors: {
                                HierarchyTreeBehavior        [ Hierarchy = $Hierarchy ]
                                HierarchyContextMenuBehavior [ Hierarchy = $Hierarchy ]
                            }
                            ItemsSource: $Hierarchy.Roots
                        }
                    }

                    // Divider
                    Border [ Width = 1, Fill = @OutlineVariant, Margin = (0,12,0,12) ]

                    // ── Right: override-by-key — ONLY the item template
                    // swaps; the same default .Behaviors: bundle still
                    // attaches, proving template + behaviors are
                    // independently overridable.
                    StackPanel [ Orientation = Vertical, Width = 320, Margin = (6,12,12,12) ] {
                        TextBlock
                            [ Text       = "Override by key — custom ItemTemplate, same default behaviors",
                              FontSize   = 12,
                              FontWeight = Bold,
                              Foreground = @OnSurfaceVariant,
                              Margin     = (0,0,0,8) ]
                        TreeView [ DataContext = $service(HierarchyTreeVM), Style = @HierarchyTreeView ] {
                            .Behaviors: {
                                HierarchyTreeBehavior        [ Hierarchy = $Hierarchy ]
                                HierarchyContextMenuBehavior [ Hierarchy = $Hierarchy ]
                            }
                            ItemTemplate: @HierarchyTreeDemoItemTemplate
                            ItemsSource: $Hierarchy.Roots
                        }
                    }
                }
            }
        }
    }
}
