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
//     the TextBox fork's GOTCHA comment); every unchecked box/ring
//     outline, the Switch track outline, and every focus re-stroke below
//     uses the working Pen form.
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
//
// Design (per the Wave 1 task-4 brief):
//   * Unchecked — box / ring: transparent fill, @BorderStrong 2dp Pen
//     stroke. Switch track (off): @Bg3 fill, @BorderStrong 2dp stroke.
//   * Checked — box / ring / track fill @ControlAccent (opaque,
//     PART_Selected); mark / dot ink @FgOnAccent — same solid-fill
//     language as the Checkbox glyph, so unlike Material's outline-ring
//     RadioButton, the Pragmatic RadioButton fills solid like the
//     Checkbox with a contrasting inner dot.
//   * Focus — `when (IsFocused)` re-strokes the outline to @BorderFocus.
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

resources PragmaticToggles
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
            Border x:name="PART_Track"
                [ Fill = @Bg3,
                  Stroke = Pen [ Brush = @BorderStrong, Thickness = 2 ],
                  CornerRadius = @RadiusPill,
                  Width = 36.4,
                  Height = 22.4,
                  HorizontalAlignment = Center,
                  VerticalAlignment = Center ]
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
        when ( IsFocused ) { PART_Track.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
        when ( IsEnabled = false ) { PART_Track.Opacity = @OpacityDisabled; }
    }
    Style [TargetType = Switch]
    {
        Template = @DefaultSwitch;
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
            Border x:name="PART_Box"
                [ Fill = #00000000,
                  Stroke = Pen [ Brush = @BorderStrong, Thickness = 2 ],
                  CornerRadius = @RadiusXs,
                  Width = 18,
                  Height = 18,
                  HorizontalAlignment = Center,
                  VerticalAlignment = Center ]
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
        when ( IsFocused ) { PART_Box.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
        when ( IsEnabled = false ) { PART_Box.Opacity = @OpacityDisabled; }
    }
    Style [TargetType = Checkbox]
    {
        Template = @DefaultCheckbox;
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
            Border x:name="PART_Ring"
                [ Fill = #00000000,
                  Stroke = Pen [ Brush = @BorderStrong, Thickness = 2 ],
                  CornerRadius = @RadiusPill,
                  Width = 20,
                  Height = 20,
                  HorizontalAlignment = Center,
                  VerticalAlignment = Center ]
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
        when ( IsChecked )
        {
            PART_Selected.Fill = @ControlAccent;
            PART_Ring.Stroke = Pen [ Brush = @ControlAccent, Thickness = 2 ];
            PART_Dot.Opacity = 1;
        }
        when ( IsMouseOver ) { PART_Ring.Fill = @Bg2; }
        when ( IsPressed ) { PART_Ring.Fill = @Bg3; }
        when ( IsFocused ) { PART_Ring.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
        when ( IsEnabled = false ) { PART_Ring.Opacity = @OpacityDisabled; }
    }
    Style [TargetType = RadioButton]
    {
        Template = @DefaultRadioButton;
        when ( ThemeManager.Pointer = Coarse ) { Width = 48; Height = 48; }
    }
}
