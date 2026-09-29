// Pragmatic theme — ToolBar family (Wave 4 Task 6).
//
// Flat-toolbar + selected-over-hover delta: Material carries a resting
// @SurfaceContainerHigh base with a translucent OnSurfaceVariant state-layer
// hover on PART_StateLayer. Pragmatic reads flatter: PART_Border is the base
// chip (rest @Bg2), hover steps PART_Border itself to @Bg3 (NOT the state
// layer). PART_StateLayer stays transparent (#00000000) and carries only the
// padding + the Position corner-radius triggers — for ToolBarToggleButton it
// is ALSO the checked cue (`when(IsChecked){ PART_StateLayer.Fill =
// @SurfaceSelected }`), the TOP layer so the checked fill survives a
// concurrent hover by z-order (PART_Border still steps to @Bg3 underneath).
// Split-button halves get the same repoint: hover targets the outer
// PART_Primary / PART_Arrow Border, leaving PART_PrimaryState / PART_ArrowState
// transparent + padding-only. Popups use the canonical Pragmatic popover
// (@Bg1 + @Border 1dp + @RadiusLg + @ShadowMd, same as the menu / ComboBox
// popups) with the PrefersContrast triggers dropped. Press is deferred.
//
// Pragmatic tokens only. This IS the framework's default template,
// composed into MuralFramework via framework.resources.mu.
resources ToolBars
{
    // ── ToolBarButton: flat connected-bar chrome ───────────────────
    Template x:key="DefaultToolBarButton" [TargetType = ToolBarButton]
    {
        StackPanel [ Orientation = Horizontal ]
        {
            Line x:name="PART_Divider"
                [ Orientation = Vertical, Stroke = Pen [ Brush = @Border, Thickness = 1 ], Visibility = Collapsed ]
            Border x:name="PART_Border" [ Fill = @Bg2, CornerRadius = 0 ]
            {
                Border x:name="PART_StateLayer" [ Fill = #00000000, CornerRadius = 0, Padding = (12,8,12,8) ]
                {
                    ContentPresenter
                }
            }
        }
        when ( IsMouseOver ) { PART_Border.Fill = @Bg3; }
        when ( Position = Only ) { PART_Border.CornerRadius = @RadiusMd; PART_StateLayer.CornerRadius = @RadiusMd; }
        when ( Position = First ) { PART_Border.CornerRadius = (@RadiusMd,0,0,@RadiusMd); PART_StateLayer.CornerRadius = (@RadiusMd,0,0,@RadiusMd); }
        when ( Position = Middle ) { PART_Divider.Visibility = Visible; }
        when ( Position = Last ) { PART_Border.CornerRadius = (0,@RadiusMd,@RadiusMd,0); PART_StateLayer.CornerRadius = (0,@RadiusMd,@RadiusMd,0); PART_Divider.Visibility = Visible; }
        when ( ThemeManager.Density = Compact ) { PART_StateLayer.Padding = (8,6,8,6); }
        when ( ThemeManager.Density = Comfortable ) { PART_StateLayer.Padding = (16,10,16,10); }
        when ( ThemeManager.Pointer = Coarse ) { PART_StateLayer.Padding = (16,14,16,14); }
    }
    Style [TargetType = ToolBarButton]
    {
        Template = @DefaultToolBarButton;
        VerticalAlignment = Center;
        TextBlock.Foreground = @Fg2;
    }

    // ── ToolBarToggleButton: same chrome + checked-over-hover cue ──
    // PART_StateLayer is the ONLY carrier of the checked fill; it sits on
    // top of PART_Border so IsChecked survives a concurrent hover.
    Template x:key="DefaultToolBarToggleButton" [TargetType = ToolBarToggleButton]
    {
        StackPanel [ Orientation = Horizontal ]
        {
            Line x:name="PART_Divider"
                [ Orientation = Vertical, Stroke = Pen [ Brush = @Border, Thickness = 1 ], Visibility = Collapsed ]
            Border x:name="PART_Border" [ Fill = @Bg2, CornerRadius = 0 ]
            {
                Border x:name="PART_StateLayer" [ Fill = #00000000, CornerRadius = 0, Padding = (12,8,12,8) ]
                {
                    ContentPresenter
                }
            }
        }
        when ( IsMouseOver ) { PART_Border.Fill = @Bg3; }
        when ( IsChecked ) { PART_StateLayer.Fill = @SurfaceSelected; }
        when ( Position = Only ) { PART_Border.CornerRadius = @RadiusMd; PART_StateLayer.CornerRadius = @RadiusMd; }
        when ( Position = First ) { PART_Border.CornerRadius = (@RadiusMd,0,0,@RadiusMd); PART_StateLayer.CornerRadius = (@RadiusMd,0,0,@RadiusMd); }
        when ( Position = Middle ) { PART_Divider.Visibility = Visible; }
        when ( Position = Last ) { PART_Border.CornerRadius = (0,@RadiusMd,@RadiusMd,0); PART_StateLayer.CornerRadius = (0,@RadiusMd,@RadiusMd,0); PART_Divider.Visibility = Visible; }
        when ( ThemeManager.Density = Compact ) { PART_StateLayer.Padding = (8,6,8,6); }
        when ( ThemeManager.Density = Comfortable ) { PART_StateLayer.Padding = (16,10,16,10); }
        when ( ThemeManager.Pointer = Coarse ) { PART_StateLayer.Padding = (16,14,16,14); }
    }
    Style [TargetType = ToolBarToggleButton]
    {
        Template = @DefaultToolBarToggleButton;
        VerticalAlignment = Center;
        TextBlock.Foreground = @Fg2;
        when ( IsChecked ) { TextBlock.Foreground = @BrandGreenInk; }
    }

    // ── ToolBarSplitButton ───────────────────────────────────────────
    ItemsPanelTemplate x:key="DefaultToolBarMenuPanel"
    {
        StackPanel [ Orientation = Vertical ]
    }
    Template x:key="DefaultToolBarSplitTrigger" [TargetType = ToolBarSplitButton]
    {
        StackPanel [ Orientation = Horizontal ]
        {
            Border x:name="PART_Primary" [ Fill = @Bg2, CornerRadius = (@RadiusMd,0,0,@RadiusMd) ]
            {
                Border x:name="PART_PrimaryState" [ Fill = #00000000, CornerRadius = (@RadiusMd,0,0,@RadiusMd), Padding = (12,8,10,8) ]
                {
                    Border x:name="PART_Content" [ HorizontalAlignment = Center, VerticalAlignment = Center ]
                }
            }
            Border x:name="PART_Arrow" [ Fill = @Bg2, CornerRadius = (0,@RadiusMd,@RadiusMd,0) ]
            {
                DockPanel [ LastChildFill = true ]
                {
                    Line [ DockPanel.Dock = Left, Orientation = Vertical, Stroke = Pen [ Brush = @Border ] ]
                    Border x:name="PART_ArrowState" [ Fill = #00000000, CornerRadius = (0,@RadiusMd,@RadiusMd,0), Padding = (6,8,8,8) ]
                    {
                        Shape [ Geometry = @ChevronDown, Fill = @Fg2, Width = 12, Height = 12, VerticalAlignment = Center ]
                    }
                }
            }
        }
        when ( PART_Primary.IsMouseOver ) { PART_Primary.Fill = @Bg3; }
        when ( PART_Arrow.IsMouseOver ) { PART_Arrow.Fill = @Bg3; }
        when ( IsEnabled = false ) { PART_Primary.Opacity = @OpacityDisabled; PART_Arrow.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Density = Compact )
        {
            PART_PrimaryState.Padding = (8,6,8,6);
            PART_ArrowState.Padding = (6,6,6,6);
        }
        when ( ThemeManager.Density = Comfortable )
        {
            PART_PrimaryState.Padding = (16,10,14,10);
            PART_ArrowState.Padding = (10,10,10,10);
        }
        when ( ThemeManager.Pointer = Coarse )
        {
            PART_PrimaryState.Padding = (16,14,14,14);
            PART_ArrowState.Padding = (10,14,10,14);
        }
    }
    Template x:key="DefaultToolBarDropdownTrigger" [TargetType = ToolBarSplitButton]
    {
        Border x:name="PART_Primary" [ Fill = @Bg2, CornerRadius = @RadiusMd ]
        {
            Border x:name="PART_PrimaryState" [ Fill = #00000000, CornerRadius = @RadiusMd, Padding = (12,8,10,8) ]
            {
                StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ]
                {
                    Border x:name="PART_Content" [ HorizontalAlignment = Center, VerticalAlignment = Center ]
                    Shape [ Geometry = @ChevronDown, Fill = @Fg2, Width = 12, Height = 12, VerticalAlignment = Center, Margin = (6,0,0,0) ]
                }
            }
        }
        when ( PART_Primary.IsMouseOver ) { PART_Primary.Fill = @Bg3; }
        when ( IsEnabled = false ) { PART_Primary.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Density = Compact ) { PART_PrimaryState.Padding = (8,6,8,6); }
        when ( ThemeManager.Density = Comfortable ) { PART_PrimaryState.Padding = (16,10,16,10); }
        when ( ThemeManager.Pointer = Coarse ) { PART_PrimaryState.Padding = (16,14,16,14); }
    }
    Template x:key="DefaultToolBarSplitPopup" [TargetType = ToolBarSplitButton]
    {
        MenuPopupHost x:name="PART_PopupHost"
        {
            ClickAwayScrim x:name="PART_Scrim"
            Border x:name="PART_PopupContainer"
                [ Fill = @Bg1, Stroke = Pen [ Brush = @Border, Thickness = 1 ], CornerRadius = @RadiusLg, Effect = @ShadowMd, Padding = (4) ]
            {
                ItemsPresenter
            }
        }
    }
    Style [TargetType = ToolBarSplitButton]
    {
        Template = @DefaultToolBarSplitPopup;
        TriggerTemplate = @DefaultToolBarSplitTrigger;
        when ( Command is unset ) { TriggerTemplate = @DefaultToolBarDropdownTrigger; }
        ItemsPanel = @DefaultToolBarMenuPanel;
        VerticalAlignment = Center;
        TextBlock.Foreground = @Fg2;
    }

    // ── ToolBarSeparator (vertical divider) ─────────────────────────
    Style [TargetType = ToolBarSeparator]
    {
        Width = 9;
        MinHeight = 16;
        LineBrush = @BorderStrong;
    }

    // ── ToolBar: inline chrome ───────────────────────────────────────
    Template x:key="ToolBarChevronButton" [TargetType = Button]
    {
        Border x:name="PART_Border" [ Fill = @Bg2, CornerRadius = @RadiusMd ]
        {
            Border x:name="PART_State" [ Fill = #00000000, CornerRadius = @RadiusMd, Padding = (12,8,12,8) ]
            {
                ContentPresenter [ HorizontalAlignment = Center, VerticalAlignment = Center ]
            }
        }
        when ( IsMouseOver ) { PART_Border.Fill = @Bg3; }
        when ( ThemeManager.Density = Compact ) { PART_State.Padding = (8,6,8,6); }
        when ( ThemeManager.Density = Comfortable ) { PART_State.Padding = (16,10,16,10); }
        when ( ThemeManager.Pointer = Coarse ) { PART_State.Padding = (16,14,16,14); }
    }

    Template x:key="DefaultToolBar" [TargetType = ToolBar]
    {
        Border x:name="PART_Border" [ Stroke = Pen [ Brush = @BorderStrong, Thickness = 0 ], Padding = (4) ]
        {
            DockPanel x:name="PART_Layout" [ LastChildFill = true ]
            {
                Button x:name="PART_Chevron" [ DockPanel.Dock = Right, Template = @ToolBarChevronButton ]
                {
                    Shape [ Geometry = @MoreHoriz, Fill = @Fg2, Width = 16, Height = 16 ]
                }
                ItemsPresenter x:name="PART_ItemsPresenter"
            }
        }
    }

    // ── ToolBar: overflow popup ──────────────────────────────────────
    Template x:key="DefaultToolBarPopup" [TargetType = ToolBar]
    {
        ToolBarPopupHost x:name="PART_PopupHost"
        {
            ClickAwayScrim x:name="PART_Scrim"
            Border x:name="PART_PopupContainer"
                [ Fill = @Bg1, Stroke = Pen [ Brush = @Border, Thickness = 1 ], CornerRadius = @RadiusLg, Effect = @ShadowMd, Padding = (4) ]
            {
                ToolBarOverflowItemsControl x:name="PART_PopupList"
            }
        }
    }

    Style [TargetType = ToolBar]
    {
        Template = @DefaultToolBar;
        PopupTemplate = @DefaultToolBarPopup;
    }
}
