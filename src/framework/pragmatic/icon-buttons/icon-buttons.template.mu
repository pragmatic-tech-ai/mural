// Pragmatic theme — IconButton / IconButtonToggle / FAB chrome (Wave 1).
//
// Forked from Material's buttons.template.mu (IconButton ~209-320,
// IconButtonToggle ~338-453, FAB ~487-638), re-expressed with the same
// Pragmatic mechanics the Button fork established
// (framework/pragmatic/buttons/buttons.template.mu):
//
//   * PART_FocusRing — a transparent outer Border whose Stroke only
//     appears `when (IsFocused)`, giving a 2dp offset ring
//     (@BorderFocus) instead of a state-layer overlay.
//   * PART_Root — the painted surface. Rest / hover / press are
//     distinct token FILLS (surface steps), never translucent
//     overlays.
//   * Disabled dims the surface to @OpacityDisabled; content padding
//     lives on PART_Root (ContentPresenter has no Padding DP).
//
// IconButton is ghost-only here — the Pragmatic DS treats every icon
// button as a chrome-less glyph target (transparent rest, @Bg2 hover,
// @Bg3 press, @Fg1 ink); Button.VariantKey plays no role, matching the
// Wave 1 plan ("icon buttons are ghost by default"). IconButtonToggle
// layers a checked surface (@SurfaceSelected) on top of the same
// chrome. FAB is the one raised Pragmatic control that keeps a shadow
// (@ShadowMd) — @ActionPrimary fill / @FgOnAccent ink, @RadiusLg
// corners, sized by the inherited FabSize Style trigger
// (Small / Default / Large / Extended), mirroring Material's
// four-template structure.
//
// Only Pragmatic tokens are used — no raw hex, no M3 tokens
// (@Primary / @OnSurface / @Shape* / @Elevation* / @*Layer). Radii
// stay at or below @RadiusXl except the pill corners on the icon
// buttons (@RadiusPill).
//
// Merged into the theme via PragmaticControls (controls.resources.mu),
// listed AFTER MuralFramework so these key-less Style[TargetType=X]
// entries shadow Material's (last-merged-wins on the runtime class
// key).

resources PragmaticIconButtons
{
    // ── IconButton: ghost-style square touch target ─────────────────
    // 40×40 base (48×48 on Coarse pointer), @RadiusPill corners so the
    // chrome reads as a circle. 8dp padding on PART_Root leaves a
    // 24×24 glyph slot.
    Template x:key="DefaultIconButton" [TargetType = IconButton]
    {
        Border x:name="PART_FocusRing"
            [ Fill = #00000000,
              Padding = (@FocusRingOffset),
              CornerRadius = $$CornerRadius ]
        {
            Border x:name="PART_Root"
                [ Fill = #00000000,
                  CornerRadius = $$CornerRadius,
                  Width = 40,
                  Height = 40,
                  Padding = (8,8,8,8),
                  TextBlock.Foreground = @Fg1 ]
            {
                ContentPresenter x:name="PART_Content" [ HorizontalAlignment = Center, VerticalAlignment = Center ]
            }
        }
        when ( IsMouseOver ) { PART_Root.Fill = @Bg2; }
        when ( IsPressed ) { PART_Root.Fill = @Bg3; }
        when ( IsFocused ) { PART_FocusRing.Stroke = (@BorderFocus, 2); }
        when ( IsEnabled = false ) { PART_Root.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Pointer = Coarse ) {
            PART_Root.Width = 48;
            PART_Root.Height = 48;
        }
    }

    Style [TargetType = IconButton]
    {
        CornerRadius = @RadiusPill;
        Template = @DefaultIconButton;
    }

    // ── IconButtonToggle: IconButton + a checked surface ─────────────
    // Same ghost chrome; IsChecked swaps PART_Root's fill to
    // @SurfaceSelected. Ink stays @Fg1 — the selected-surface token is
    // a light tint, so the dark @Fg1 glyph stays legible without a
    // separate checked foreground (matches ListItem's own IsSelected
    // treatment, which keeps its resting ink too).
    Template x:key="DefaultIconButtonToggle" [TargetType = IconButtonToggle]
    {
        Border x:name="PART_FocusRing"
            [ Fill = #00000000,
              Padding = (@FocusRingOffset),
              CornerRadius = $$CornerRadius ]
        {
            Border x:name="PART_Root"
                [ Fill = #00000000,
                  CornerRadius = $$CornerRadius,
                  Width = 40,
                  Height = 40,
                  Padding = (8,8,8,8),
                  TextBlock.Foreground = @Fg1 ]
            {
                ContentPresenter x:name="PART_Content" [ HorizontalAlignment = Center, VerticalAlignment = Center ]
            }
        }
        when ( IsChecked ) { PART_Root.Fill = @SurfaceSelected; }
        when ( IsMouseOver ) { PART_Root.Fill = @Bg2; }
        when ( IsPressed ) { PART_Root.Fill = @Bg3; }
        when ( IsFocused ) { PART_FocusRing.Stroke = (@BorderFocus, 2); }
        when ( IsEnabled = false ) { PART_Root.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Pointer = Coarse ) {
            PART_Root.Width = 48;
            PART_Root.Height = 48;
        }
    }

    Style [TargetType = IconButtonToggle]
    {
        CornerRadius = @RadiusPill;
        Template = @DefaultIconButtonToggle;
    }

    // ── FloatingActionButton: the one raised Pragmatic surface ───────
    // @ActionPrimary fill / @FgOnAccent ink, @RadiusLg corners,
    // @ShadowMd effect kept at rest AND on hover — Pragmatic has no
    // elevation-level ladder to bump the way Material bumps
    // ElevationLevel3 → 4, so the shadow token itself stays constant
    // and only the fill steps. Four sizes mirror Material's
    // Small / Default / Large / Extended structure; the Pragmatic
    // radius scale tops out at @RadiusXl, so every size shares
    // @RadiusLg rather than Material's per-size shape escalation.
    Template x:key="DefaultFab" [TargetType = FloatingActionButton]
    {
        Border x:name="PART_FocusRing"
            [ Fill = #00000000,
              Padding = (@FocusRingOffset),
              CornerRadius = @RadiusLg ]
        {
            Border x:name="PART_Root"
                [ Fill = @ActionPrimary,
                  CornerRadius = @RadiusLg,
                  MinWidth = 56,
                  MinHeight = 56,
                  Effect = @ShadowMd,
                  Padding = (16,16,16,16),
                  TextBlock.Foreground = @FgOnAccent ]
            {
                ContentPresenter x:name="PART_Content"
                    [ Width = 24, Height = 24, HorizontalAlignment = Center, VerticalAlignment = Center ]
            }
        }
        when ( IsMouseOver ) { PART_Root.Fill = @ActionPrimaryHover; }
        when ( IsPressed ) { PART_Root.Fill = @ActionPrimaryPress; }
        when ( IsFocused ) { PART_FocusRing.Stroke = (@BorderFocus, 2); }
        when ( IsEnabled = false ) { PART_Root.Opacity = @OpacityDisabled; }
    }

    // FAB Small — 40dp icon-only.
    Template x:key="DefaultFabSmall" [TargetType = FloatingActionButton]
    {
        Border x:name="PART_FocusRing"
            [ Fill = #00000000,
              Padding = (@FocusRingOffset),
              CornerRadius = @RadiusLg ]
        {
            Border x:name="PART_Root"
                [ Fill = @ActionPrimary,
                  CornerRadius = @RadiusLg,
                  MinWidth = 40,
                  MinHeight = 40,
                  Effect = @ShadowMd,
                  Padding = (8,8,8,8),
                  TextBlock.Foreground = @FgOnAccent ]
            {
                ContentPresenter x:name="PART_Content"
                    [ Width = 24, Height = 24, HorizontalAlignment = Center, VerticalAlignment = Center ]
            }
        }
        when ( IsMouseOver ) { PART_Root.Fill = @ActionPrimaryHover; }
        when ( IsPressed ) { PART_Root.Fill = @ActionPrimaryPress; }
        when ( IsFocused ) { PART_FocusRing.Stroke = (@BorderFocus, 2); }
        when ( IsEnabled = false ) { PART_Root.Opacity = @OpacityDisabled; }
    }

    // FAB Large — 96dp icon-only, 36dp glyph slot.
    Template x:key="DefaultFabLarge" [TargetType = FloatingActionButton]
    {
        Border x:name="PART_FocusRing"
            [ Fill = #00000000,
              Padding = (@FocusRingOffset),
              CornerRadius = @RadiusLg ]
        {
            Border x:name="PART_Root"
                [ Fill = @ActionPrimary,
                  CornerRadius = @RadiusLg,
                  MinWidth = 96,
                  MinHeight = 96,
                  Effect = @ShadowMd,
                  Padding = (30,30,30,30),
                  TextBlock.Foreground = @FgOnAccent ]
            {
                ContentPresenter x:name="PART_Content"
                    [ Width = 36, Height = 36, HorizontalAlignment = Center, VerticalAlignment = Center ]
            }
        }
        when ( IsMouseOver ) { PART_Root.Fill = @ActionPrimaryHover; }
        when ( IsPressed ) { PART_Root.Fill = @ActionPrimaryPress; }
        when ( IsFocused ) { PART_FocusRing.Stroke = (@BorderFocus, 2); }
        when ( IsEnabled = false ) { PART_Root.Opacity = @OpacityDisabled; }
    }

    // FAB Extended — 56dp tall, content-driven width (icon + label).
    Template x:key="DefaultFabExtended" [TargetType = FloatingActionButton]
    {
        Border x:name="PART_FocusRing"
            [ Fill = #00000000,
              Padding = (@FocusRingOffset),
              CornerRadius = @RadiusLg ]
        {
            Border x:name="PART_Root"
                [ Fill = @ActionPrimary,
                  CornerRadius = @RadiusLg,
                  MinHeight = 56,
                  Effect = @ShadowMd,
                  Padding = (16,0,20,0),
                  TextBlock.Foreground = @FgOnAccent ]
            {
                ContentPresenter x:name="PART_Content" [ HorizontalAlignment = Center, VerticalAlignment = Center ]
            }
        }
        when ( IsMouseOver ) { PART_Root.Fill = @ActionPrimaryHover; }
        when ( IsPressed ) { PART_Root.Fill = @ActionPrimaryPress; }
        when ( IsFocused ) { PART_FocusRing.Stroke = (@BorderFocus, 2); }
        when ( IsEnabled = false ) { PART_Root.Opacity = @OpacityDisabled; }
    }

    // Default Style — picks Template by Size. Default (56dp) is the
    // baseline; Small / Large / Extended each ride their own trigger.
    // HorizontalAlignment / VerticalAlignment stay Center so the FAB
    // doesn't inherit Stretch and balloon inside a taller parent slot
    // (same rationale as Material's FAB Style).
    Style [TargetType = FloatingActionButton]
    {
        Template = @DefaultFab;
        HorizontalAlignment = Center;
        VerticalAlignment = Center;
        when ( Size = Small ) { Template = @DefaultFabSmall; }
        when ( Size = Large ) { Template = @DefaultFabLarge; }
        when ( Size = Extended ) { Template = @DefaultFabExtended; }
    }
}
