// Pragmatic theme — menu family (Wave 3).
//
// Popups use the canonical Pragmatic popover (@Bg1 + @Border 1dp +
// @RadiusLg + @ShadowMd — same as the ComboBox popup). Menu rows replace
// M3's translucent state overlays with opaque surface steps: hover/focus
// step PART_Row to @Bg2; checked / submenu-open fill a DEDICATED opaque
// PART_Selected layer (@SurfaceSelected) that carries the row padding, so
// the current-item cue survives a concurrent hover (trigger order is
// last-event-wins — the Wave-2 selected-over-hover pattern). Pressed is
// deferred wave-wide. Every PART name is preserved (MenuItem's ctor fishes
// PART_Icon/PART_Label/PART_Gesture/PART_Chevron out by name).
//
// Pragmatic tokens only (+ shared geometry @ChevronRight). This IS the
// framework's default template, composed into MuralFramework via
// framework.resources.mu.

resources Menus
{
    ItemsPanelTemplate x:key="DefaultMenuItemsPanel"
    {
        StackPanel [ Orientation = Vertical ]
    }
    ItemsPanelTemplate x:key="DefaultMenuStripPanel"
    {
        StackPanel [ Orientation = Horizontal ]
    }

    // ── MenuButton: trigger ──────────────────────────────────────────
    Template x:key="DefaultMenuButtonTrigger" [TargetType = MenuButton]
    {
        Button x:name="PART_Trigger"
        {
            StackPanel x:name="PART_TriggerStack" [ Orientation = Horizontal ]
            {
                TextBlock x:name="PART_HeaderText" [ Foreground = @FgOnAccent, Style = @UiLabel ]
            }
        }
    }
    // ── MenuButton: popup (canonical popover) ────────────────────────
    Template x:key="DefaultMenuButtonPopup" [TargetType = MenuButton]
    {
        MenuPopupHost x:name="PART_PopupHost"
        {
            ClickAwayScrim x:name="PART_Scrim"
            Border x:name="PART_PopupContainer"
                [ Fill = @Bg1,
                  Stroke = Pen [ Brush = @Border, Thickness = 1 ],
                  CornerRadius = @RadiusLg,
                  Effect = @ShadowMd,
                  Padding = (0,@Space1,0,@Space1) ]
            {
                ItemsPresenter
            }
        }
    }
    Style [TargetType = MenuButton]
    {
        HorizontalAlignment = Left;
        VerticalAlignment = Top;
        Template = @DefaultMenuButtonPopup;
        TriggerTemplate = @DefaultMenuButtonTrigger;
        ItemsPanel = @DefaultMenuItemsPanel;
    }

    // ── ContextMenu: popup ───────────────────────────────────────────
    Template x:key="DefaultContextMenuPopup" [TargetType = ContextMenu]
    {
        MenuPopupHost x:name="PART_PopupHost"
        {
            ClickAwayScrim x:name="PART_Scrim"
            Border x:name="PART_PopupContainer"
                [ Fill = @Bg1,
                  Stroke = Pen [ Brush = @Border, Thickness = 1 ],
                  CornerRadius = @RadiusLg,
                  Effect = @ShadowMd,
                  Padding = (0,@Space1,0,@Space1) ]
            {
                ItemsPresenter
            }
        }
    }
    Style [TargetType = ContextMenu]
    {
        Template = @DefaultContextMenuPopup;
        ItemsPanel = @DefaultMenuItemsPanel;
    }

    // ── MenuSeparator ────────────────────────────────────────────────
    Style [TargetType = MenuSeparator]
    {
        Height = 9;
        MinWidth = 16;
        LineBrush = @Border;
    }

    // ── MenuItem: row (hover surface + dedicated selected layer) ──────
    // Wrapped in a vertical StackPanel so a leading divider (PART_
    // SeparatorBefore, default Collapsed — MenuItem.SeparatorBefore's
    // intrinsic equivalent of a declarative sibling MenuSeparator) can sit
    // ABOVE the row without changing what the row's own Border/DockPanel
    // chrome looks like. This exists because a HierarchicalDataTemplate's
    // generated container must stay a single MenuItem (MenuContainerFactory.
    // GetContainer only recurses a submenu when `tmpl.Apply(item) instanceof
    // MenuItem`), so a data-bound row has no way to place a sibling
    // MenuSeparator the way declaratively-nested `MenuItem { MenuSeparator;
    // MenuItem }` markup can — the divider has to be INTRINSIC to the row.
    Template x:key="DefaultMenuItemRow" [TargetType = MenuItem]
    {
        StackPanel [ Orientation = Vertical ]
        {
        MenuSeparator x:name="PART_SeparatorBefore" [ Visibility = Collapsed ]
        Border x:name="PART_Row" [ Fill = #00000000, CornerRadius = @RadiusMd ]
        {
            // PART_Selected carries the row padding so its @SurfaceSelected
            // fill spans the full row and survives a concurrent @Bg2 hover.
            Border x:name="PART_Selected"
                [ Fill = #00000000,
                  CornerRadius = @RadiusMd,
                  Padding = (@Space3,@Space2,@Space3,@Space2) ]
            {
                DockPanel [ LastChildFill = true ]
                {
                    Border x:name="PART_Icon"
                        [ DockPanel.Dock = Left,
                          Width = 24,
                          MinWidth = 24,
                          TextBlock.Foreground = @Fg2 ]
                    Shape x:name="PART_Chevron"
                        [ DockPanel.Dock = Right,
                          Geometry = @ChevronRight,
                          Fill = @Fg2,
                          Width = 5,
                          Height = 10,
                          VerticalAlignment = Center,
                          Visibility = Collapsed ]
                    TextBlock x:name="PART_Gesture"
                        [ DockPanel.Dock = Right,
                          Margin = (@Space4,0,@Space4,0),
                          Foreground = @Fg2,
                          Style = @UiCaption ]
                    TextBlock x:name="PART_Label"
                        [ Margin = (@Space2,0,@Space4,0),
                          MinWidth = 80,
                          Foreground = @Fg1,
                          Style = @UiLabel ]
                }
            }
        }
        }
        when ( IsMouseOver ) { PART_Row.Fill = @Bg2; }
        when ( IsFocused ) { PART_Row.Fill = @Bg2; }
        when ( IsChecked ) { PART_Selected.Fill = @SurfaceSelected; }
        when ( IsSubmenuOpen ) { PART_Selected.Fill = @SurfaceSelected; }
        when ( IsEnabled = false ) { PART_Row.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Density = Compact ) { PART_Selected.Padding = (@Space2,@Space1,@Space2,@Space1); }
        when ( ThemeManager.Density = Comfortable ) { PART_Selected.Padding = (@Space3,@Space3,@Space3,@Space3); }
        when ( ThemeManager.Pointer = Coarse ) { PART_Selected.Padding = (@Space3,@Space3,@Space3,@Space3); }
    }

    // ── MenuItem: submenu popup ──────────────────────────────────────
    Template x:key="DefaultMenuItemSubmenu" [TargetType = MenuItem]
    {
        MenuPopupHost x:name="PART_PopupHost"
        {
            ClickAwayScrim x:name="PART_Scrim"
            Border x:name="PART_PopupContainer"
                [ Fill = @Bg1,
                  Stroke = Pen [ Brush = @Border, Thickness = 1 ],
                  CornerRadius = @RadiusLg,
                  Effect = @ShadowMd,
                  Padding = (0,@Space1,0,@Space1) ]
            {
                ItemsPresenter
            }
        }
    }
    Style [TargetType = MenuItem]
    {
        Template = @DefaultMenuItemSubmenu;
        ItemsPanel = @DefaultMenuItemsPanel;
        RowTemplate = @DefaultMenuItemRow;
    }

    // ── MenuStripItem: top-level stripped row ────────────────────────
    Template x:key="DefaultMenuStripItemRow" [TargetType = MenuItem]
    {
        Border x:name="PART_Row" [ Fill = #00000000, CornerRadius = @RadiusMd ]
        {
            Border x:name="PART_Selected"
                [ Fill = #00000000,
                  CornerRadius = @RadiusMd,
                  Padding = (@Space3,@Space1,@Space3,@Space1) ]
            {
                StackPanel [ Orientation = Horizontal ]
                {
                    Border x:name="PART_Icon" [ Width = 0, MinWidth = 0 ]
                    TextBlock x:name="PART_Label"
                        [ MinWidth = 0,
                          Foreground = @Fg1,
                          Style = @UiLabel ]
                    TextBlock x:name="PART_Gesture" [ Width = 0, Foreground = @Fg2 ]
                    Shape x:name="PART_Chevron" [ Geometry = @ChevronRight, Fill = @Fg2, Width = 0, Height = 10 ]
                }
            }
        }
        when ( IsMouseOver ) { PART_Row.Fill = @Bg2; }
        when ( IsFocused ) { PART_Row.Fill = @Bg2; }
        when ( IsSubmenuOpen ) { PART_Selected.Fill = @SurfaceSelected; }
        when ( IsEnabled = false ) { PART_Row.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Density = Compact ) { PART_Selected.Padding = (@Space3,0,@Space3,0); }
        when ( ThemeManager.Density = Comfortable ) { PART_Selected.Padding = (@Space3,@Space2,@Space3,@Space2); }
        when ( ThemeManager.Pointer = Coarse ) { PART_Selected.Padding = (@Space4,@Space3,@Space4,@Space3); }
    }
    Style x:key="MenuStripItemStyle" [TargetType = MenuItem]
    {
        RowTemplate = @DefaultMenuStripItemRow;
    }

    // ── MenuStrip ────────────────────────────────────────────────────
    Style [TargetType = MenuStrip]
    {
        Fill = @Bg2;
        Padding = (4,2,4,2);
        ItemsPanel = @DefaultMenuStripPanel;
        ItemContainerStyle = @MenuStripItemStyle;
    }
}
