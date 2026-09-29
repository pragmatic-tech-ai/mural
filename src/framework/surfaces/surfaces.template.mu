// Pragmatic theme — surfaces family (Wave 3 surface exemplar + siblings).
//
// Card is the exemplar: PART_Border chrome (fill/stroke/shadow) wrapping
// PART_StateLayer (the hover surface step — Pragmatic has no translucent
// overlay, so hover STEPS the surface one tone) wrapping the ContentPresenter.
// Shadow is constant (Pragmatic has no elevation-level ladder — FAB
// precedent); hover steps the surface, not the shadow. Disabled dims to
// @OpacityDisabled. Density retunes the content padding only.
//
// Dialog / Drawer / BottomSheet / SideSheet (added in later Wave-3 tasks)
// share this file: each is a floating/in-flow shaped surface. The modal
// scrim + focus-trap are service-owned (theme-agnostic); these templates
// paint only the surface chrome.
//
// Pragmatic tokens only — no M3 (@Surface* / @On* / @Outline* / @Shape* /
// @Elevation* / @State*Overlay / @Spacing* / @DisabledContentOpacity) token.
// These ARE the framework's default templates, composed into
// MuralFramework via framework.resources.mu.

resources Surfaces
{
    // ── Card: Filled — @Bg2, no border, no resting shadow ────────────
    Template x:key="DefaultFilledCard" [TargetType = Card]
    {
        Border x:name="PART_Border"
            [ Fill = @Bg2,
              CornerRadius = @RadiusLg ]
        {
            Border x:name="PART_StateLayer"
                [ Fill = #00000000,
                  CornerRadius = @RadiusLg,
                  Padding = (@Space4,@Space4,@Space4,@Space4) ]
            {
                ContentPresenter
            }
        }
        when ( IsMouseOver ) { PART_StateLayer.Fill = @Bg3; }
        when ( IsEnabled = false ) { PART_Border.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Density = Compact ) { PART_StateLayer.Padding = (@Space3,@Space3,@Space3,@Space3); }
        when ( ThemeManager.Density = Comfortable ) { PART_StateLayer.Padding = (@Space5,@Space5,@Space5,@Space5); }
    }

    // ── Card: Elevated — @Bg1, resting @ShadowSm (constant) ──────────
    Template x:key="DefaultElevatedCard" [TargetType = Card]
    {
        Border x:name="PART_Border"
            [ Fill = @Bg1,
              CornerRadius = @RadiusLg,
              Effect = @ShadowSm ]
        {
            Border x:name="PART_StateLayer"
                [ Fill = #00000000,
                  CornerRadius = @RadiusLg,
                  Padding = (@Space4,@Space4,@Space4,@Space4) ]
            {
                ContentPresenter
            }
        }
        when ( IsMouseOver ) { PART_StateLayer.Fill = @Bg2; }
        when ( IsEnabled = false ) { PART_Border.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Density = Compact ) { PART_StateLayer.Padding = (@Space3,@Space3,@Space3,@Space3); }
        when ( ThemeManager.Density = Comfortable ) { PART_StateLayer.Padding = (@Space5,@Space5,@Space5,@Space5); }
    }

    // ── Card: Outlined — @Bg1, 1dp @BorderStrong, no resting shadow ──
    Template x:key="DefaultOutlinedCard" [TargetType = Card]
    {
        Border x:name="PART_Border"
            [ Fill = @Bg1,
              Stroke = Pen [ Brush = @BorderStrong, Thickness = 1 ],
              CornerRadius = @RadiusLg ]
        {
            Border x:name="PART_StateLayer"
                [ Fill = #00000000,
                  CornerRadius = @RadiusLg,
                  Padding = (@Space4,@Space4,@Space4,@Space4) ]
            {
                ContentPresenter
            }
        }
        when ( IsMouseOver ) { PART_StateLayer.Fill = @Bg2; }
        when ( IsEnabled = false ) { PART_Border.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Density = Compact ) { PART_StateLayer.Padding = (@Space3,@Space3,@Space3,@Space3); }
        when ( ThemeManager.Density = Comfortable ) { PART_StateLayer.Padding = (@Space5,@Space5,@Space5,@Space5); }
    }

    Style [TargetType = Card]
    {
        Template = @DefaultFilledCard;
        when ( Variant = Elevated ) { Template = @DefaultElevatedCard; }
        when ( Variant = Outlined ) { Template = @DefaultOutlinedCard; }
    }

    // ── Dialog: floating modal surface (scrim is service-owned) ──────
    DataTemplate x:key="DialogActionTemplate" [DataType = DialogAction]
    {
        Button [ Variant = $Variant, Command = $Command, Margin = (@Space2,0,0,0) ]
        {
            TextBlock [ Text = $Label ]
        }
    }
    ItemsPanelTemplate x:key="DialogActionsPanel"
    {
        StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right ]
    }

    Template x:key="DefaultDialog" [TargetType = Dialog]
    {
        Border x:name="PART_Dialog"
            [ Fill = @Bg1,
              Stroke = Pen [ Brush = @Border, Thickness = 1 ],
              CornerRadius = @RadiusXl,
              Effect = @ShadowLg,
              Padding = (@Space5,@Space5,@Space5,@Space5) ]
        {
            DockPanel [ LastChildFill = true ]
            {
                TextBlock x:name="PART_Title"
                    [ DockPanel.Dock = Top,
                      Text = $$Title,
                      Foreground = @Fg1,
                      Style = @H3,
                      Margin = (0,0,0,@Space4) ]
                ItemsControl x:name="PART_Actions"
                    [ DockPanel.Dock = Bottom,
                      ItemsSource = $$Actions,
                      ItemTemplate = @DialogActionTemplate,
                      ItemsPanel = @DialogActionsPanel,
                      HorizontalAlignment = Right,
                      Margin = (0,@Space4,0,0) ]
                ContentPresenter
            }
        }
        when ( ThemeManager.Density = Compact ) { PART_Dialog.Padding = (@Space4,@Space4,@Space4,@Space4); }
        when ( ThemeManager.Density = Comfortable ) { PART_Dialog.Padding = (@Space6,@Space6,@Space6,@Space6); }
    }
    Style [TargetType = Dialog]
    {
        Template = @DefaultDialog;
    }

    // ── Drawer (pane) ────────────────────────────────────────────────
    Template x:key="DefaultDrawerPane" [TargetType = Drawer]
    {
        Border x:name="PART_Pane"
            [ Fill = @Bg2,
              Stroke = Pen [ Brush = @Border, Thickness = 1 ],
              Padding = (0,@Space3,0,0) ]
        {
            ContentPresenter
        }
        when ( Variant = Temporary ) { PART_Pane.Effect = @ShadowSm; }
        when ( IsEnabled = false ) { PART_Pane.Opacity = @OpacityDisabled; }
    }
    Style [TargetType = Drawer]
    {
        Template = @DefaultDrawerPane;
    }

    // ── BottomSheet: top-rounded surface (bottom edges square) ────────
    Template x:key="DefaultBottomSheet" [TargetType = BottomSheet]
    {
        Border x:name="PART_Sheet"
            [ Fill = @Bg1,
              Stroke = Pen [ Brush = @Border, Thickness = 1 ],
              CornerRadius = (@RadiusXl,@RadiusXl,0,0),
              Effect = @ShadowSm,
              Padding = (@Space4,@Space4,@Space4,@Space4) ]
        {
            ContentPresenter
        }
        when ( ThemeManager.Density = Compact ) { PART_Sheet.Padding = (@Space3,@Space3,@Space3,@Space3); }
        when ( ThemeManager.Density = Comfortable ) { PART_Sheet.Padding = (@Space5,@Space5,@Space5,@Space5); }
    }
    Style [TargetType = BottomSheet]
    {
        Template = @DefaultBottomSheet;
    }

    // ── SideSheet: lateral sheet (Standard + Modal) ──────────────────
    // Body ContentPresenter declared FIRST so ContentControl's depth-first
    // slot walk binds Content to it (not the header's close button), then
    // positioned into row 1 by Grid.Row.
    Template x:key="DefaultSideSheet" [TargetType = SideSheet]
    {
        Border x:name="PART_Sheet" [ Fill = @Bg2 ]
        {
            DockPanel [ LastChildFill = true ]
            {
                Line x:name="PART_DividerLeft"
                    [ DockPanel.Dock = Left, Orientation = Vertical, Stroke = Pen [ Brush = @Border, Thickness = 1 ] ]
                Line x:name="PART_DividerRight"
                    [ DockPanel.Dock = Right, Orientation = Vertical, Stroke = Pen [ Brush = @Border, Thickness = 1 ], Visibility = Collapsed ]
                Grid
                {
                    RowDefinitions
                    {
                        RowDefinition [ Height = GridLength.Auto ]
                        RowDefinition [ Height = GridLength.Star ]
                    }
                    ContentPresenter
                        [ Grid.Row = 1,
                          Margin = (@Space4,@Space2,@Space4,@Space4) ]
                    Border [ Grid.Row = 0, Padding = (@Space4,@Space3,@Space2,@Space3) ]
                    {
                        DockPanel [ LastChildFill = true ]
                        {
                            IconButton x:name="PART_CloseButton"
                                [ Variant = Standard, DockPanel.Dock = Right ]
                            {
                                Shape [ Geometry = @IconClose, Fill = @Fg2, Width = 18, Height = 18 ]
                            }
                            TextBlock x:name="PART_Title"
                                [ Text = $$Title,
                                  Style = @UiLabel,
                                  Foreground = @Fg1,
                                  VerticalAlignment = Center ]
                        }
                    }
                }
            }
        }
        when ( Anchor = Left )
        {
            PART_DividerLeft.Visibility = Collapsed;
            PART_DividerRight.Visibility = Visible;
        }
    }
    Style [TargetType = SideSheet]
    {
        Template = @DefaultSideSheet;
    }

    // ── ScrollViewer: layout host + SCP + two ScrollBars ─────────────
    // Theme-neutral structural template (recovered in the SP2 collapse —
    // it lived in Material's surfaces base, which the Pragmatic surfaces
    // fork did not re-declare). No tokens: chrome comes from the ScrollBar
    // template and the content.
    Template x:key="DefaultScrollViewer" [TargetType = ScrollViewer]
    {
        ScrollViewerLayout x:name="PART_Layout"
        {
            ScrollContentPresenter x:name="PART_ContentSite"
            ScrollBar x:name="PART_VerticalScrollBar"
            ScrollBar x:name="PART_HorizontalScrollBar"
        }
    }
    Style [TargetType = ScrollViewer]
    {
        Template = @DefaultScrollViewer;
    }
}
