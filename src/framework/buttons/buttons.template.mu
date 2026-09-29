// Pragmatic theme — Button chrome (Wave 1 exemplar).
//
// This is the FIRST forked control and the pattern every later Pragmatic
// control copies. It replaces Material's state-layer / elevation model
// with the Pragmatic mechanics:
//
//   * PART_FocusRing — a transparent outer Border whose Stroke only
//     appears on `when (IsFocused)`, giving a 2dp offset focus ring
//     (@BorderFocus) instead of an overlay tint.
//   * PART_Root — the painted surface. Rest / hover / press are distinct
//     token FILLS (not translucent overlays): @ActionPrimary →
//     @ActionPrimaryHover → @ActionPrimaryPress.
//   * Density / pointer adapt the control HEIGHT via @ControlH* tokens
//     rather than re-padding a state layer.
//   * Disabled dims the surface to @OpacityDisabled.
//
// Only Pragmatic tokens are used — no raw hex, no M3 (@Primary /
// @OnSurface / @Shape* / @Elevation* / @*Layer) token. The focus-ring
// offset binds to @FocusRingOffset via a single-cell tuple
// (`Padding = (@FocusRingOffset)` → a uniform Thickness). The content
// inset stays an inline (16,8,16,8) layout tuple, matching every Material
// button template (Material never tokenises its content paddings).
//
// This key-less Style[TargetType=Button] IS the framework's default
// template, composed into MuralFramework via framework.resources.mu —
// there is no override layer and no Material to shadow.

resources Buttons
{
    // ── Primary — the baseline. High-emphasis CTA: @ActionPrimary fill,
    // @FgOnAccent ink. Also the target of the legacy `Filled` variant.
    Template x:key="DefaultPrimaryButton" [TargetType = Button]
    {
        Border x:name="PART_FocusRing"
            [ Fill = #00000000,
              Padding = (@FocusRingOffset),
              CornerRadius = $$CornerRadius ]
        {
            Border x:name="PART_Root"
                [ Fill = @ActionPrimary,
                  CornerRadius = $$CornerRadius,
                  MinHeight = @ControlHDefault,
                  Padding = (16,8,16,8),
                  TextBlock.Foreground = @FgOnAccent ]
            {
                ContentPresenter x:name="PART_Content" [ HorizontalAlignment = Center, VerticalAlignment = Center ]
            }
        }
        when ( IsMouseOver ) { PART_Root.Fill = @ActionPrimaryHover; }
        when ( IsPressed ) { PART_Root.Fill = @ActionPrimaryPress; }
        when ( IsFocused ) { PART_FocusRing.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
        when ( IsEnabled = false ) { PART_Root.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Density = Compact ) { PART_Root.MinHeight = @ControlHCompact; }
        when ( ThemeManager.Pointer = Coarse ) { PART_Root.MinHeight = @ControlHTouch; }
    }

    // ── Secondary — medium emphasis: @Bg1 surface, @BorderStrong outline,
    // @Fg1 ink. Hover steps the surface to @Bg2. Target of the legacy
    // `Tonal` / `Outlined` variants.
    Template x:key="DefaultSecondaryButton" [TargetType = Button]
    {
        Border x:name="PART_FocusRing"
            [ Fill = #00000000,
              Padding = (@FocusRingOffset),
              CornerRadius = $$CornerRadius ]
        {
            Border x:name="PART_Root"
                [ Fill = @Bg1,
                  Stroke = Pen [ Brush = @BorderStrong ],
                  CornerRadius = $$CornerRadius,
                  MinHeight = @ControlHDefault,
                  Padding = (16,8,16,8),
                  TextBlock.Foreground = @Fg1 ]
            {
                ContentPresenter x:name="PART_Content" [ HorizontalAlignment = Center, VerticalAlignment = Center ]
            }
        }
        when ( IsMouseOver ) { PART_Root.Fill = @Bg2; }
        when ( IsPressed ) { PART_Root.Fill = @Bg3; }
        when ( IsFocused ) { PART_FocusRing.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
        when ( IsEnabled = false ) { PART_Root.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Density = Compact ) { PART_Root.MinHeight = @ControlHCompact; }
        when ( ThemeManager.Pointer = Coarse ) { PART_Root.MinHeight = @ControlHTouch; }
    }

    // ── Ghost — low emphasis: no chrome at rest, @Fg1 ink. Hover reveals
    // an @Bg2 surface. Target of the legacy `Text` / `Standard` variants.
    Template x:key="DefaultGhostButton" [TargetType = Button]
    {
        Border x:name="PART_FocusRing"
            [ Fill = #00000000,
              Padding = (@FocusRingOffset),
              CornerRadius = $$CornerRadius ]
        {
            Border x:name="PART_Root"
                [ Fill = #00000000,
                  CornerRadius = $$CornerRadius,
                  MinHeight = @ControlHDefault,
                  Padding = (16,8,16,8),
                  TextBlock.Foreground = @Fg1 ]
            {
                ContentPresenter x:name="PART_Content" [ HorizontalAlignment = Center, VerticalAlignment = Center ]
            }
        }
        when ( IsMouseOver ) { PART_Root.Fill = @Bg2; }
        when ( IsPressed ) { PART_Root.Fill = @Bg3; }
        when ( IsFocused ) { PART_FocusRing.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
        when ( IsEnabled = false ) { PART_Root.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Density = Compact ) { PART_Root.MinHeight = @ControlHCompact; }
        when ( ThemeManager.Pointer = Coarse ) { PART_Root.MinHeight = @ControlHTouch; }
    }

    // ── Danger — destructive action: @StateDanger fill, @FgOnAccent ink.
    // Hover / press darken via Opacity (there is no danger-hover token;
    // dimming the rest fill keeps the hue and reads as a press).
    Template x:key="DefaultDangerButton" [TargetType = Button]
    {
        Border x:name="PART_FocusRing"
            [ Fill = #00000000,
              Padding = (@FocusRingOffset),
              CornerRadius = $$CornerRadius ]
        {
            Border x:name="PART_Root"
                [ Fill = @StateDanger,
                  CornerRadius = $$CornerRadius,
                  MinHeight = @ControlHDefault,
                  Padding = (16,8,16,8),
                  TextBlock.Foreground = @FgOnAccent ]
            {
                ContentPresenter x:name="PART_Content" [ HorizontalAlignment = Center, VerticalAlignment = Center ]
            }
        }
        when ( IsMouseOver ) { PART_Root.Opacity = 0.92; }
        when ( IsPressed ) { PART_Root.Opacity = 0.85; }
        when ( IsFocused ) { PART_FocusRing.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
        when ( IsEnabled = false ) { PART_Root.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Density = Compact ) { PART_Root.MinHeight = @ControlHCompact; }
        when ( ThemeManager.Pointer = Coarse ) { PART_Root.MinHeight = @ControlHTouch; }
    }

    // Default Style — key-less so it resolves implicitly on the Button
    // runtime class. @RadiusMd corners (TemplateBound into each template
    // via $$CornerRadius). Primary is the baseline template; every other
    // variant — new Pragmatic names AND the M3 legacy names — rides a
    // trigger to its Pragmatic template (decision 2: additive mapping,
    // no app/demo call-site changes). Filled / Primary / Elevated fall
    // through to the baseline Primary template.
    Style [TargetType = Button]
    {
        CornerRadius = @RadiusMd;
        Template = @DefaultPrimaryButton;
        when ( Variant = Secondary ) { Template = @DefaultSecondaryButton; }
        when ( Variant = Tonal ) { Template = @DefaultSecondaryButton; }
        when ( Variant = Outlined ) { Template = @DefaultSecondaryButton; }
        when ( Variant = Ghost ) { Template = @DefaultGhostButton; }
        when ( Variant = Text ) { Template = @DefaultGhostButton; }
        when ( Variant = Standard ) { Template = @DefaultGhostButton; }
        when ( Variant = Danger ) { Template = @DefaultDangerButton; }
    }
}
