import ContextMenuVM from "./context-menu-vm.mjs"

// context-menu.mu — ContextMenu attached-property showcase, now rendered
// through the COMMAND-DRIVEN menu machinery. Three coloured panels each
// carry their own CommandContextMenu (attached imperatively, in the
// descriptor's OnViewMounted, over the x:name'd panels below) rather than
// a hand-authored `ContextMenu x:key=... { MenuItem ... }` resource — the
// CommandDefinition trees + the "Recent" ChildrenContributor live in
// context-menu-vm.mts; this file only needs to NAME the three panels.
//
// Collectively the three menus still exercise the same capabilities tour
// as before migration:
//   * Leaf commands           — Cut/Copy/Paste, Open/Save, Zoom levels, …
//   * A CanExecute=false leaf — Delete (functionally non-clickable; see
//                                context-menu-vm.mts for the visual-dimming
//                                caveat — @CommandMenuItemTemplate has no
//                                CanExecute→IsEnabled wiring today).
//   * Presentation=Toggles    — Show Grid / Snap to Grid / Show Rulers /
//                                Bookmark, checkable via CommandViewModel.
//                                IsToggle + IsChecked (live-synced, see
//                                CommandMenuBuilder.Build).
//   * Nested submenus         — Red's Transform▸, Green's Zoom▸, Blue's
//                                two-level Share▸Export▸.
//   * A DYNAMIC submenu       — Blue's Recent▸, backed by
//                                RecentCommandContributor (a
//                                ChildrenContributor that re-evaluates
//                                every time the submenu opens).
//
// The status line at the bottom updates as commands fire — each leaf's
// own dedicated RelayCommand (see context-menu-vm.mts) narrates into Status.

resources ContextMenuDemo {
    DataTemplate [DataType = ContextMenuVM] {
        Border [ Fill = @Surface, Stroke = Pen [ Brush = @OutlineVariant ] ] {
            DockPanel {
                // Header
                Border [ DockPanel.Dock = Top, Fill = @Primary, Padding = (16,12,16,12) ] {
                    TextBlock
                        [ Text       = "ContextMenu — right-click a panel to open its menu at the cursor. Each shows different features: icons, shortcuts, submenus, checkables.",
                          FontSize   = 15,
                          FontWeight = Bold,
                          Foreground = @OnPrimary ]
                }

                StackPanel [ Orientation = Vertical, Margin = (16,16,16,16) ] {
                    StackPanel [ Orientation = Horizontal, Margin = (0,0,0,16) ] {
                        Border x:name="redPanel"
                            [ Fill   = #ef4444,
                              Width  = 180,
                              Height = 120,
                              Margin = (0,0,12,0) ] {
                            TextBlock
                                [ Text                = "Edit menu\ncommands · disabled · Transform submenu",
                                  Foreground          = @OnPrimary,
                                  FontSize            = 14,
                                  FontWeight          = Bold,
                                  TextAlignment       = Center,
                                  HorizontalAlignment = Center,
                                  VerticalAlignment   = Center ]
                        }
                        Border x:name="greenPanel"
                            [ Fill   = #22c55e,
                              Width  = 180,
                              Height = 120,
                              Margin = (0,0,12,0) ] {
                            TextBlock
                                [ Text                = "View menu\ncheckables · Zoom submenu",
                                  Foreground          = @OnPrimary,
                                  FontSize            = 14,
                                  FontWeight          = Bold,
                                  TextAlignment       = Center,
                                  HorizontalAlignment = Center,
                                  VerticalAlignment   = Center ]
                        }
                        Border x:name="bluePanel"
                            [ Fill   = #3b82f6,
                              Width  = 180,
                              Height = 120 ] {
                            TextBlock
                                [ Text                = "File menu\ndynamic Recent ▸ + Share ▸ Export ▸ submenu",
                                  Foreground          = @OnPrimary,
                                  FontSize            = 14,
                                  FontWeight          = Bold,
                                  TextAlignment       = Center,
                                  HorizontalAlignment = Center,
                                  VerticalAlignment   = Center ]
                        }
                    }

                    TextBlock [ Text = $Status, FontSize = 13, Foreground = @OnSurface ]
                }
            }
        }
    }
}
