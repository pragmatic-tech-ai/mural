import MenuVM from "./menu-vm.mjs"

// menu.mu — MenuButton showcase, now rendered through the COMMAND-DRIVEN
// menu machinery. A single hamburger button opens a vertical column of
// menu rows — New, Open, Save, Save As, Close, Undo, Redo, then the two
// checkable rows (Show Grid, Snap to Grid) — bound as
// `ItemsSource = $Roots, ItemTemplate = @CommandMenuItemTemplate` against
// the CommandViewModel tree MenuVM builds (via CommandMenuBuilder) rather
// than a hand-authored `MenuItem { ... }` body.
//
// What's exercised:
//   * $Title (→ Header)           — row text in the second column.
//   * $Command                    — invoked on click, resolved per-row
//                                    through the VM's DemoCommandDispatcher.
//   * $IsToggle / $IsChecked      — ✓ glyph in the icon column for the two
//                                    Presentation=Toggles rows.
//
// (The old demo also showcased InputGestureText and MenuSeparator — the
// shipped @CommandMenuItemTemplate renders a plain recursive MenuItem row
// with no slot for either, so this migrated demo no longer displays
// shortcut-chord text or group dividers. Functionality — click dispatch,
// checkable state — is unchanged.)

resources MenuDemo {
    DataTemplate [DataType = MenuVM] {
        Border [ Fill = @Surface, Stroke = Pen [ Brush = @OutlineVariant ] ] {
            DockPanel {
                // Header
                Border [ DockPanel.Dock = Top, Fill = @Primary, Padding = (16,12,16,12) ] {
                    TextBlock
                        [ Text       = "MenuButton — hamburger fly-out with checkable items and gesture text.",
                          FontSize   = 15,
                          FontWeight = Bold,
                          Foreground = @OnPrimary ]
                }

                // Body
                StackPanel [ Orientation = Vertical, Margin = (16,16,16,16) ] {
                    TextBlock
                        [ Text       = "Click the button to open the menu:",
                          FontSize   = 12,
                          Foreground = @OnSurfaceVariant,
                          Margin     = (0,0,0,8) ]

                    MenuButton
                        [ Header       = "☰  File",
                          ItemsSource  = $Roots,
                          ItemTemplate = @CommandMenuItemTemplate ]

                    TextBlock
                        [ Text       = $Status,
                          FontSize   = 13,
                          Foreground = @OnSurface,
                          Margin     = (0,16,0,0) ]
                }
            }
        }
    }
}
