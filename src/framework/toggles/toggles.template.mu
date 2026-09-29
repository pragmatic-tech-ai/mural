// Pragmatic theme — Checkbox / RadioButton / Switch chrome (Wave 1).
//
// Forked from Material's toggles.template.mu (DefaultSwitch,
// DefaultCheckbox, DefaultRadioButton — the group/item row templates
// for RadioButtonGroup / RadioButtonItem stay OUT of scope for this
// fork; only the three binary-toggle controls named in the Wave 1 plan
// are re-expressed here), using the same Pragmatic mechanics the
// Button / IconButton / TextBox forks established
// (framework/pragmatic/buttons/buttons.template.mu,
// framework/pragmatic/icon-buttons/icon-buttons.template.mu):
//
//   * EVERY stroke uses the Pen form — `Stroke = Pen [ Brush = @Token,
//     Thickness = n ]`. A `(brush, width)` tuple assigned to a Pen-typed
//     property silently compiles to a Thickness instead (confirmed by
//     the TextBox fork's GOTCHA comment); every outline / focus-ring
//     stroke below uses the working Pen form.
//   * Checked/selected fill rides a nested opaque PART_Selected layer,
//     copied from icon-buttons.template.mu:97-134 — a ControlTemplate
//     trigger stack resolves a shared-property tie by whichever
//     condition's SetTriggerValue call happens LAST AT RUNTIME (a real
//     IsChecked flip vs. a real PointerEnter), never by `when` clause
//     declaration order, so a checked-fill and a hover-fill sharing one
//     element's Fill can erase each other depending on event
//     chronology. Checkbox's PART_Box and RadioButton's PART_Ring both
//     hover-tint their OWN Fill, so their checked fill goes on a nested
//     PART_Selected instead (opaque paint wins by z-order, not trigger
//     timing). Switch's track carries the same PART_Selected treatment
//     pre-emptively even though nothing today hover-tints the track
//     Fill, per the Wave 1 controller note — so a later hover-on-track
//     addition can't silently erase the "on" indication.
//   * Focus rides a DEDICATED PART_FocusRing element, never a re-stroke
//     of the checked-state element (PART_Box / PART_Ring / PART_Track).
//     An earlier revision had `when(IsChecked)` and `when(IsFocused)`
//     both write that element's OWN Stroke — the exact shared-property
//     hazard the PART_Selected pattern above exists to avoid, just on
//     Stroke instead of Fill. It only looked correct because
//     @ControlAccent and @BorderFocus happen to share the same rgb()
//     under PragmaticLight: a checked+focused control silently lost
//     whichever cue's trigger fired first (SVG showed exactly ONE
//     stroke, not two), and the two states would visibly diverge the
//     moment either token's value changed. Fixed per the Button /
//     IconButton exemplars' own PART_FocusRing wrapper (buttons.
//     template.mu: a transparent outer Border, `Padding =
//     (@FocusRingOffset)`, whose Stroke ONLY `when(IsFocused)` paints
//     `Pen[Brush=@BorderFocus, Thickness=2]`) — here it wraps the fixed-
//     size box/ring/track (inside PART_HitTarget, outside PART_Box /
//     PART_Ring / PART_Track), so checked and focused now write
//     entirely different elements' Stroke and can never collide.
//
// Design (per the Wave 1 task-4 brief):
//   * Unchecked — box / ring: transparent fill, @BorderStrong 2dp Pen
//     stroke. Switch track (off): @Bg3 fill, @BorderStrong 2dp stroke.
//   * Checked — box / ring / track fill @ControlAccent (opaque,
//     PART_Selected); mark / dot ink @FgOnAccent — same solid-fill
//     language as the Checkbox glyph, so unlike Material's outline-ring
//     RadioButton, the Pragmatic RadioButton fills solid like the
//     Checkbox with a contrasting inner dot.
//   * Focus — `when (IsFocused)` paints PART_FocusRing's own Stroke to
//     @BorderFocus, offset from the box/ring/track by @FocusRingOffset;
//     coexists with the checked state instead of overwriting it.
//   * Hover — box / ring / thumb Fill tints one step (@Bg2); press tints
//     a second step (@Bg3).
//   * Touch target — control Width/Height grow to 48 on
//     `when (ThemeManager.Pointer = Coarse)`, matching the brief (no
//     Comfortable-density growth requested for this fork).
//
// Only Pragmatic tokens are used — no raw hex (except the `#00000000`
// transparent convention), no M3 tokens (@Primary / @OnSurfaceVariant /
// @Shape* / @Elevation* / @*Layer). Radii stay at @RadiusXs / @RadiusPill,
// both well under the @RadiusXl cap.
//
// Merged into the theme via PragmaticControls (controls.resources.mu),
// listed AFTER MuralFramework so these key-less
// Style[TargetType=Checkbox|RadioButton|Switch] entries shadow
// Material's (last-merged-wins on the runtime class key).

resources Toggles
{
    // ── Switch: track + sliding thumb ───────────────────────────────
    // Same 36.4 × 22.4 dp pill track / Margin-based thumb slide as the
    // Material fork (Switch's own Width/Height defaults pin to this
    // size — switch.ts) — only the palette and layering change.
    Template x:key="DefaultSwitch" [TargetType = Switch]
    {
        Border x:name="PART_HitTarget"
            [ Fill = #00000000,
              HorizontalAlignment = Stretch,
              VerticalAlignment = Stretch ]
        {
            // PART_FocusRing — dedicated ring, own Stroke only under
            // IsFocused. Never shares a property with the checked-state
            // trigger below (see header comment).
            Border x:name="PART_FocusRing"
                [ Fill = #00000000,
                  Padding = (@FocusRingOffset),
                  CornerRadius = @RadiusPill,
                  HorizontalAlignment = Center,
                  VerticalAlignment = Center ]
            {
                Border x:name="PART_Track"
                    [ Fill = @Bg3,
                      Stroke = Pen [ Brush = @BorderStrong, Thickness = 2 ],
                      CornerRadius = @RadiusPill,
                      Width = 36.4,
                      Height = 22.4 ]
                {
                    // PART_Selected — opaque "on" layer, transparent at rest so
                    // PART_Track's @Bg3 shows through; IsChecked paints it
                    // @ControlAccent, covering PART_Track regardless of any
                    // hover tint on the track underneath (see header comment).
                    Border x:name="PART_Selected"
                        [ Fill = #00000000,
                          CornerRadius = @RadiusPill ]
                    {
                        Border x:name="PART_Thumb"
                            [ Fill = @Bg1,
                              CornerRadius = @RadiusPill,
                              Width = 11.2,
                              Height = 11.2,
                              VerticalAlignment = Center,
                              HorizontalAlignment = Left,
                              Margin = (5.6,0,0,0) ]
                    }
                }
            }
        }
        // IsChecked — track fills @ControlAccent via PART_Selected; the
        // thumb grows and re-anchors to the right edge.
        when ( IsChecked )
        {
            PART_Selected.Fill = @ControlAccent;
            PART_Track.Stroke = Pen [ Brush = @ControlAccent, Thickness = 2 ];
            PART_Thumb.Width = 16.8;
            PART_Thumb.Height = 16.8;
            PART_Thumb.Margin = (16.8,0,0,0);
        }
        // State-layer ladder — thumb Fill tints one step on hover, a
        // second step on press (mirrors the Checkbox / RadioButton box
        // ladder below).
        when ( IsMouseOver ) { PART_Thumb.Fill = @Bg2; }
        when ( IsPressed ) { PART_Thumb.Fill = @Bg3; }
        when ( IsFocused ) { PART_FocusRing.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
        when ( IsEnabled = false ) { PART_Track.Opacity = @OpacityDisabled; }
    }
    Style [TargetType = Switch]
    {
        Template = @DefaultSwitch;
        when ( ThemeManager.Density = Comfortable ) { Width = 40; Height = 40; }
        when ( ThemeManager.Pointer = Coarse ) { Width = 48; Height = 48; }
    }

    // ── Checkbox: 18 × 18 dp square toggle ──────────────────────────
    // Unchecked — transparent box, @BorderStrong 2dp Pen outline.
    // Checked — PART_Selected opaquely fills @ControlAccent (covering
    // any hover tint on PART_Box beneath it); the checkmark glyph
    // (@IconCheck, ink @FgOnAccent) fades in via its own Opacity trigger
    // — a plain trigger is fine here since the glyph's Opacity doesn't
    // share a property with any hover/press trigger.
    Template x:key="DefaultCheckbox" [TargetType = Checkbox]
    {
        Border x:name="PART_HitTarget"
            [ Fill = #00000000,
              HorizontalAlignment = Stretch,
              VerticalAlignment = Stretch ]
        {
            // PART_FocusRing — dedicated ring, own Stroke only under
            // IsFocused. Never shares a property with the checked-state
            // trigger below (see header comment).
            Border x:name="PART_FocusRing"
                [ Fill = #00000000,
                  Padding = (@FocusRingOffset),
                  CornerRadius = @RadiusXs,
                  HorizontalAlignment = Center,
                  VerticalAlignment = Center ]
            {
                Border x:name="PART_Box"
                    [ Fill = #00000000,
                      Stroke = Pen [ Brush = @BorderStrong, Thickness = 2 ],
                      CornerRadius = @RadiusXs,
                      Width = 18,
                      Height = 18 ]
                {
                    Border x:name="PART_Selected"
                        [ Fill = #00000000,
                          CornerRadius = @RadiusXs ]
                    {
                        Shape x:name="PART_Mark"
                            [ Geometry = @IconCheck,
                              Fill = @FgOnAccent,
                              Width = 16,
                              Height = 16,
                              HorizontalAlignment = Center,
                              VerticalAlignment = Center,
                              Opacity = 0 ]
                    }
                }
            }
        }
        // IsChecked — fill the box (via PART_Selected) and reveal the glyph.
        when ( IsChecked )
        {
            PART_Selected.Fill = @ControlAccent;
            PART_Box.Stroke = Pen [ Brush = @ControlAccent, Thickness = 2 ];
            PART_Mark.Opacity = 1;
        }
        // State-layer ladder — box Fill tints one step on hover, a
        // second step on press; PART_Selected stays opaque over it once
        // checked, regardless of event order (see header comment).
        when ( IsMouseOver ) { PART_Box.Fill = @Bg2; }
        when ( IsPressed ) { PART_Box.Fill = @Bg3; }
        when ( IsFocused ) { PART_FocusRing.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
        when ( IsEnabled = false ) { PART_Box.Opacity = @OpacityDisabled; }
    }
    Style [TargetType = Checkbox]
    {
        Template = @DefaultCheckbox;
        when ( ThemeManager.Density = Comfortable ) { Width = 40; Height = 40; }
        when ( ThemeManager.Pointer = Coarse ) { Width = 48; Height = 48; }
    }

    // ── RadioButton: 20 × 20 dp circular toggle ─────────────────────
    // Same solid-fill language as Checkbox rather than Material's
    // outline-ring-plus-accent-dot look (per the brief: "Checked: fill
    // @ControlAccent, mark/dot @FgOnAccent") — PART_Selected opaquely
    // fills the ring @ControlAccent and the inner dot inks @FgOnAccent
    // so it reads against the filled ring.
    Template x:key="DefaultRadioButton" [TargetType = RadioButton]
    {
        Border x:name="PART_HitTarget"
            [ Fill = #00000000,
              HorizontalAlignment = Stretch,
              VerticalAlignment = Stretch ]
        {
            // PART_FocusRing — dedicated ring, own Stroke only under
            // IsFocused. Never shares a property with the checked-state
            // trigger below (see header comment).
            Border x:name="PART_FocusRing"
                [ Fill = #00000000,
                  Padding = (@FocusRingOffset),
                  CornerRadius = @RadiusPill,
                  HorizontalAlignment = Center,
                  VerticalAlignment = Center ]
            {
                Border x:name="PART_Ring"
                    [ Fill = #00000000,
                      Stroke = Pen [ Brush = @BorderStrong, Thickness = 2 ],
                      CornerRadius = @RadiusPill,
                      Width = 20,
                      Height = 20 ]
                {
                    Border x:name="PART_Selected"
                        [ Fill = #00000000,
                          CornerRadius = @RadiusPill ]
                    {
                        Border x:name="PART_Dot"
                            [ Fill = @FgOnAccent,
                              CornerRadius = @RadiusPill,
                              Width = 8,
                              Height = 8,
                              HorizontalAlignment = Center,
                              VerticalAlignment = Center,
                              Opacity = 0 ]
                    }
                }
            }
        }
        when ( IsChecked )
        {
            PART_Selected.Fill = @ControlAccent;
            PART_Ring.Stroke = Pen [ Brush = @ControlAccent, Thickness = 2 ];
            PART_Dot.Opacity = 1;
        }
        when ( IsMouseOver ) { PART_Ring.Fill = @Bg2; }
        when ( IsPressed ) { PART_Ring.Fill = @Bg3; }
        when ( IsFocused ) { PART_FocusRing.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
        when ( IsEnabled = false ) { PART_Ring.Opacity = @OpacityDisabled; }
    }
    Style [TargetType = RadioButton]
    {
        Template = @DefaultRadioButton;
        when ( ThemeManager.Density = Comfortable ) { Width = 40; Height = 40; }
        when ( ThemeManager.Pointer = Coarse ) { Width = 48; Height = 48; }
    }

    // ── RadioButtonGroup: vertical list of RadioButtonItem rows ──────
    Template x:key="DefaultRadioButtonGroup" [TargetType = RadioButtonGroup]
    {
        ItemsPresenter
    }
    ItemsPanelTemplate x:key="DefaultRadioButtonGroupPanel"
    {
        StackPanel [ Orientation = Vertical ]
    }
    Style [TargetType = RadioButtonGroup]
    {
        Template = @DefaultRadioButtonGroup;
        ItemsPanel = @DefaultRadioButtonGroupPanel;
    }

    // ── RadioButtonItem: selectable radio + label row (RadioButtonGroup) ──
    // Forked into Pragmatic tokens, mirroring the list-box item row
    // (framework/list/list-box.template.mu): transparent rest, @Bg2 hover,
    // @Bg3 press, @ControlAccent selected indicator, @Fg1 label that flips
    // to @BrandGreenInk when selected. DockPanel/LastChildFill so a
    // wrapping label measures against finite width instead of infinite.
    Template x:key="DefaultRadioButtonItem" [TargetType = RadioButtonItem]
    {
        Border x:name="PART_Row"
            [ Fill = #00000000,
              CornerRadius = @RadiusSm,
              Padding = (@Space2,@Space1,@Space3,@Space1) ]
        {
            DockPanel [ LastChildFill = true ]
            {
                Border x:name="PART_Ring"
                    [ DockPanel.Dock = Left,
                      Fill = #00000000,
                      Stroke = Pen [ Brush = @BorderStrong, Thickness = 2 ],
                      CornerRadius = @RadiusPill,
                      Width = 20, Height = 20,
                      VerticalAlignment = Center ]
                {
                    Border x:name="PART_Dot"
                        [ Fill = @ControlAccent,
                          CornerRadius = @RadiusPill,
                          Width = 10, Height = 10,
                          HorizontalAlignment = Center, VerticalAlignment = Center,
                          Opacity = 0 ]
                }
                ContentPresenter
                    [ VerticalAlignment = Center,
                      Margin = (@Space3,0,0,0) ]
            }
        }
        when ( IsSelected )
        {
            PART_Ring.Stroke = Pen [ Brush = @ControlAccent, Thickness = 2 ];
            PART_Dot.Opacity = 1;
        }
        when ( IsMouseOver ) { PART_Row.Fill = @Bg2; }
        when ( IsFocused ) { PART_Row.Fill = @Bg2; }
        when ( IsPressed ) { PART_Row.Fill = @Bg3; }
        when ( IsEnabled = false ) { PART_Row.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Density = Compact ) { PART_Row.Padding = (@Space1,@Space1,@Space2,@Space1); }
        when ( ThemeManager.Density = Comfortable ) { PART_Row.Padding = (@Space2,@Space2,@Space3,@Space2); }
        when ( ThemeManager.Pointer = Coarse ) { PART_Row.Padding = (@Space2,@Space3,@Space3,@Space3); }
    }
    Style [TargetType = RadioButtonItem]
    {
        Template = @DefaultRadioButtonItem;
        Foreground = @Fg1;
        when ( IsSelected ) { Foreground = @BrandGreenInk; }
    }
}
