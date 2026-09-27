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
// Merged via PragmaticControls (controls.resources.mu), after MuralFramework.

resources PragmaticSurfaces
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
}
