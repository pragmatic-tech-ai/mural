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

resources IconButtons
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
        when ( IsFocused ) { PART_FocusRing.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
        when ( IsEnabled = false ) { PART_Root.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Pointer = Coarse )
        {
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
    // Same ghost chrome, but checked and hover/press CANNOT share one
    // Fill trigger the way a plain (non-checked) control can. Reordering
    // the `when` clauses does not help — a ControlTemplate trigger stack
    // resolves ties by which condition's SetTriggerValue call happens
    // LAST AT RUNTIME (a real PointerEnter / a real IsChecked flip),
    // never by which `when` clause is declared last in this file. An
    // already-checked, later-hovered toggle enters IsMouseOver's trigger
    // chronologically AFTER IsChecked's, so a shared-property trigger
    // always loses the checked cue to hover no matter how the two `when`
    // clauses are ordered here (verified empirically before writing this
    // structure — see task-2-report.md's fix entry).
    //
    // The robust fix is Material's own answer to this exact combinatorial
    // problem (buttons.template.mu ~342-360: PART_Border + PART_StateLayer),
    // adapted to Pragmatic's OPAQUE surface-step rule instead of M3's
    // translucent state layer:
    //   * PART_Root — the ghost hover/press surface, exactly like
    //     IconButton (transparent rest, @Bg2 hover, @Bg3 press).
    //   * PART_Selected — a second, opaque Border NESTED INSIDE
    //     PART_Root, transparent unless checked. When IsChecked sets it
    //     to @SurfaceSelected, it opaquely PAINTS OVER whatever PART_Root
    //     is currently showing (hover or press included) — a z-order
    //     compositing guarantee, not a trigger-priority one, so it holds
    //     regardless of event chronology. When unchecked, PART_Selected
    //     stays transparent and PART_Root's hover/press shows through
    //     normally.
    // Content padding (8dp) and the @Fg1 ink move to PART_Selected — it's
    // now the innermost painted layer around the glyph slot.
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
                  Height = 40 ]
            {
                Border x:name="PART_Selected"
                    [ Fill = #00000000,
                      CornerRadius = $$CornerRadius,
                      Padding = (8,8,8,8),
                      TextBlock.Foreground = @Fg1 ]
                {
                    ContentPresenter x:name="PART_Content" [ HorizontalAlignment = Center, VerticalAlignment = Center ]
                }
            }
        }
        when ( IsMouseOver ) { PART_Root.Fill = @Bg2; }
        when ( IsPressed ) { PART_Root.Fill = @Bg3; }
        when ( IsChecked ) { PART_Selected.Fill = @SurfaceSelected; }
        when ( IsFocused ) { PART_FocusRing.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
        when ( IsEnabled = false ) { PART_Root.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Pointer = Coarse )
        {
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
        when ( IsFocused ) { PART_FocusRing.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
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
        when ( IsFocused ) { PART_FocusRing.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
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
        when ( IsFocused ) { PART_FocusRing.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
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
        when ( IsFocused ) { PART_FocusRing.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
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
