// Pragmatic theme — navigation family (Wave 4 Task 5): NavigationItem
// (the destination row), NavigationRail (vertical strip), NavigationBar
// (horizontal bottom strip), the ActivityBar rail/item variant, and the
// items panels they all share.
//
// Structural delta from Material — selected-over-hover: Material nests
// PART_IconStateLayer inside PART_IconContainer as a translucent
// hover/press overlay. Here the two Borders split roles by z-order
// (the Wave-1/2/3 selected-over-hover pattern, first seen in ListBoxItem's
// PART_Border/PART_Selected split):
//   * PART_IconContainer — the HOVER surface. Rest transparent, hover
//     steps to @Bg2.
//   * PART_IconStateLayer — its child, painted ON TOP — the SELECTED
//     layer. Rest transparent, selected fills @SurfaceSelected. Because
//     it paints over PART_IconContainer, a selected pill survives a
//     concurrent hover regardless of trigger evaluation order.
// No press cue — the @OnSurfaceVariantHoverLayer / …PressLayer overlay
// tokens are dropped (deferred).
//
// PART_Outer / PART_IconSlot / PART_LabelText names + the density /
// pointer triggers are preserved verbatim — NavigationItem's own class
// (Icon/Label sync) and ThemeManager retuning both depend on them.
//
// Rail / Bar / ActivityBarRail chrome: @Surface → @Bg1; the edge Line's
// (@OutlineVariant,1) tuple stroke → Pen [ Brush = @Border, Thickness = 1 ]
// (the Pragmatic Pen-object stroke convention — see tabs/status-bar
// forks). @ShapeSmall → @RadiusMd, @LabelMedium → @UiCaption.
//
// The items panels (DefaultNavigationRailPanel / DefaultNavigationBarPanel
// / RailActionsPanel) are purely structural (Panel factories) — copied
// verbatim, no tokens to fork.
//
// ActivityBarItem keeps its accent (@ControlAccent) + icon-brighten
// (@Fg2 → @Fg1) approach — two distinct elements, no conflict with the
// NavigationItem selected-layer delta above. Keyed resources
// (ActivityBarRail / ActivityBarItem / RailActionsPanel /
// DefaultNavigationRailPanel / DefaultNavigationBarPanel) keep their
// exact keys — the EditorShell fork (Wave 4 Task 7) references them by
// key. The RailAction DataTemplate lives in that shell fork, NOT here.
//
// Only Pragmatic tokens — no M3 (@Surface / @OutlineVariant /
// @SecondaryContainer / @OnSurface* / @ShapeSmall / @LabelMedium /
// @Primary / @TypefaceWeightMedium) token, no raw hex except #00000000.

resources PragmaticNavigation
{
    // ── NavigationRail / NavigationBar items panels (structural) ────
    ItemsPanelTemplate x:key="DefaultNavigationRailPanel"
    {
        StackPanel [ Orientation = Vertical ]
    }

    ItemsPanelTemplate x:key="DefaultNavigationBarPanel"
    {
        UniformGrid [ Rows = 1 ]
    }

    // ── NavigationItem: a single rail/bar destination row ──────────
    Template x:key="DefaultNavigationItem" [TargetType = NavigationItem]
    {
        Border x:name="PART_Outer"
            [ Fill                = #00000000,
              Padding             = (4,12,4,12),
              HorizontalAlignment = Stretch ]
        {
            StackPanel [ Orientation = Vertical, HorizontalAlignment = Center ]
            {
                Border x:name="PART_IconContainer"
                    [ Fill                = #00000000,
                      CornerRadius        = @RadiusMd,
                      Width               = 56,
                      Height              = 32,
                      HorizontalAlignment = Center ]
                {
                    Border x:name="PART_IconStateLayer"
                        [ Fill        = #00000000,
                          CornerRadius = @RadiusMd ]
                    {
                        ContentPresenter x:name="PART_IconSlot"
                            [ Width               = 24,
                              Height              = 24,
                              HorizontalAlignment = Center,
                              VerticalAlignment   = Center ]
                    }
                }
                TextBlock x:name="PART_LabelText"
                    [ Style               = @UiCaption,
                      Foreground          = @Fg2,
                      HorizontalAlignment = Stretch,
                      TextAlignment       = Center,
                      TextWrapping        = Wrap,
                      Margin              = (0,4,0,0) ]
            }
        }
        when ( IsSelected )
        {
            PART_IconStateLayer.Fill = @SurfaceSelected;
            PART_LabelText.Foreground = @BrandGreenInk;
            PART_LabelText.FontWeight = @WeightMedium;
        }
        when ( IsMouseOver ) { PART_IconContainer.Fill = @Bg2; }
        when ( ThemeManager.Density = Compact ) { PART_Outer.Padding = (4,8,4,8); }
        when ( ThemeManager.Density = Comfortable ) { PART_Outer.Padding = (4,16,4,16); }
        when ( ThemeManager.Pointer = Coarse ) { PART_Outer.Padding = (8,16,8,16); }
    }

    Style [TargetType = NavigationItem]
    {
        Template = @DefaultNavigationItem;
        TextBlock.Foreground = @Fg2;
        when ( IsSelected ) { TextBlock.Foreground = @BrandGreenInk; }
    }

    // ── NavigationRail: vertical destination strip ─────────────────
    Template x:key="DefaultNavigationRail" [TargetType = NavigationRail]
    {
        Border x:name="PART_Border"
            [ Fill  = @Bg1,
              Width = 80 ]
        {
            DockPanel [ LastChildFill = true ]
            {
                Line [ DockPanel.Dock = Right, Orientation = Vertical, Stroke = Pen [ Brush = @Border, Thickness = 1 ] ]
                ContentPresenter x:name="PART_HeaderSlot"
                    [ DockPanel.Dock      = Top,
                      HorizontalAlignment = Center,
                      Margin              = (0,12,0,12) ]
                ContentPresenter x:name="PART_FooterSlot"
                    [ DockPanel.Dock      = Bottom,
                      HorizontalAlignment = Center,
                      Margin              = (0,8,0,8) ]
                ItemsPresenter x:name="PART_ItemsPresenter" [ VerticalAlignment = Top ]
            }
        }
    }

    Style [TargetType = NavigationRail]
    {
        Template = @DefaultNavigationRail;
        ItemsPanel = @DefaultNavigationRailPanel;
    }

    // ── NavigationBar: horizontal bottom tab strip ─────────────────
    Template x:key="DefaultNavigationBar" [TargetType = NavigationBar]
    {
        Border x:name="PART_Border"
            [ Fill   = @Bg1,
              Height = 80 ]
        {
            DockPanel [ LastChildFill = true ]
            {
                Line [ DockPanel.Dock = Top, Orientation = Horizontal, Stroke = Pen [ Brush = @Border, Thickness = 1 ] ]
                ItemsPresenter x:name="PART_ItemsPresenter" [ VerticalAlignment = Center ]
            }
        }
    }

    Style [TargetType = NavigationBar]
    {
        Template = @DefaultNavigationBar;
        ItemsPanel = @DefaultNavigationBarPanel;
    }

    // ── Activity bar — VSCode-style vertical rail variant ──────────
    ItemsPanelTemplate x:key="RailActionsPanel"
    {
        StackPanel [ Orientation = Vertical ]
    }

    Template x:key="ActivityBarRail" [TargetType = NavigationRail]
    {
        Border x:name="PART_Border"
            [ Fill  = @Bg1,
              Width = 48 ]
        {
            DockPanel [ LastChildFill = true ]
            {
                Line [ DockPanel.Dock = Right, Orientation = Vertical, Stroke = Pen [ Brush = @Border, Thickness = 1 ] ]
                ItemsControl x:name="PART_HeaderActions"
                    [ DockPanel.Dock      = Top,
                      HorizontalAlignment = Center,
                      Margin              = (0,8,0,8),
                      ItemsSource         = $HeaderActions,
                      ItemsPanel          = @RailActionsPanel ]
                ItemsControl x:name="PART_FooterActions"
                    [ DockPanel.Dock      = Bottom,
                      HorizontalAlignment = Center,
                      Margin              = (0,8,0,8),
                      ItemsSource         = $FooterActions,
                      ItemsPanel          = @RailActionsPanel ]
                ItemsPresenter x:name="PART_ItemsPresenter" [ VerticalAlignment = Top ]
            }
        }
    }

    Template x:key="ActivityBarItemTemplate" [TargetType = NavigationItem]
    {
        Border x:name="PART_Outer" [ Fill = #00000000, Width = 48, Height = 48 ]
        {
            Grid
            {
                Border x:name="PART_Accent"
                    [ Width               = 2,
                      HorizontalAlignment = Left,
                      VerticalAlignment   = Stretch,
                      Fill                = #00000000 ]
                Shape x:name="PART_Icon"
                    [ Geometry            = $Icon,
                      Fill                = @Fg2,
                      Opacity             = 0.55,
                      Width               = 24,
                      Height              = 24,
                      HorizontalAlignment = Center,
                      VerticalAlignment   = Center ]
            }
        }
        when ( IsSelected )
        {
            PART_Accent.Fill = @ControlAccent;
            PART_Icon.Fill = @Fg1;
            PART_Icon.Opacity = 1;
        }
        when ( IsMouseOver )
        {
            PART_Icon.Fill = @Fg1;
            PART_Icon.Opacity = 1;
        }
        when ( IsPressed ) { PART_Outer.Fill = @Bg2; }
        when ( ThemeManager.Density = Compact )
        {
            PART_Outer.Width = 40;
            PART_Outer.Height = 40;
        }
        when ( ThemeManager.Density = Comfortable )
        {
            PART_Outer.Width = 56;
            PART_Outer.Height = 56;
        }
        when ( ThemeManager.Pointer = Coarse )
        {
            PART_Outer.Width = 56;
            PART_Outer.Height = 56;
        }
    }

    Style x:key="ActivityBarItem" [TargetType = NavigationItem]
    {
        Template = @ActivityBarItemTemplate;
    }
}
