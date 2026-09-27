// Pragmatic theme — Slider / SpinEdit chrome (Wave 1).
//
// Forked from Material's basic.resources.mu (DefaultSpinEdit ~345-461,
// DefaultSlider ~462-506 — DefaultSliderSpinEdit stays OUT of scope for
// this fork), re-expressed with the same Pragmatic mechanics the
// Button / Toggle forks established
// (framework/pragmatic/buttons/buttons.template.mu,
// framework/pragmatic/toggles/toggles.template.mu):
//
//   * EVERY stroke uses the Pen form — `Stroke = Pen [ Brush = @Token,
//     Thickness = n ]`. A `(brush, width)` tuple assigned to a
//     Pen-typed property silently compiles to a Thickness instead
//     (the TextBox fork's GOTCHA) — Material's own SpinEdit divider
//     (`Stroke = (@OutlineVariant, 1)`) has this exact bug baked in;
//     every stroke below uses the working Pen form instead.
//   * The Slider thumb's focus ring rides a DEDICATED PART_FocusRing
//     element (the Button / Toggle pattern), not a re-stroke of the
//     thumb's own state fill — Material's own template re-tints
//     PART_Thumb.Fill on `when(IsFocused)`, which is exactly the
//     shared-property hazard the Toggle fork's header comment warns
//     against (a focus cue and a hover/drag cue racing on the SAME
//     property).
//        GOTCHA (layout): Border reserves CONTENT-INSET space equal to
//     its own Stroke thickness on every side (border.ts: `insetH =
//     2*t + Padding.Horizontal`) — not just Padding. The thumb is a
//     fixed 4x16dp pill arranged by Slider.ArrangeSliderParts via an
//     explicit Rect (never re-measured against its own DesiredSize),
//     so a naive zero-Padding ring whose Stroke activates on focus
//     would reserve 2x2dp off the thumb's entire 4dp width the instant
//     the control is focused — collapsing it to zero and erasing the
//     hover/drag fill entirely (confirmed empirically: pressing the
//     thumb always calls `args.SetFocus(this)` in Slider.OnPointerDown,
//     so a drag ALSO focuses the control, and the thumb vanished from
//     the very drag-vs-hover render test this fork's design demands).
//     The fix: give PART_FocusRing AND PART_Thumb explicit fixed
//     Width/Height — the ring sized to the thumb PLUS
//     2x@FocusRingOffset on each axis (8x20 for a horizontal 4x16
//     thumb, swapped for Vertical below), the thumb kept at its own
//     true 4x16. Visual.Arrange lets an explicit Width/Height win over
//     the offered slot outright (visual.ts ~1381: "Explicit Width /
//     Height — always wins"), so both overflow their arranged 4x16
//     slot symmetrically via the default Stretch-alignment-with-
//     explicit-size centering rule, with no clipping ancestor in the
//     way. At rest (Stroke undefined, 0dp reserve) the ring's own
//     interior is the full 8x20 box and the 4x16 thumb sits centred
//     inside it — visually identical to an unwrapped thumb, just with
//     2dp of invisible transparent margin. Once focused, the ring's
//     Stroke reserves exactly 2x2dp per axis, shrinking its interior
//     back down to precisely 4x16 — exactly the thumb's own fixed
//     size, so the thumb still renders at full size, flush against the
//     inside of the now-visible ring. Verified against the render test
//     (dragging — which also focuses — still paints the thumb's
//     @BrandGreenPress fill at full size). GetTemplateChild('PART_Thumb')
//     still resolves through the wrapper by name (FindName walks the
//     whole template subtree, same as the Toggle fork's nested
//     PART_Box / PART_Ring / PART_Track inside their own PART_FocusRing).
//   * The value fill (@ControlAccent, from Min to Value) is a progress
//     fill, not a toggle selected-state — it doesn't share PART_Fill's
//     Fill property with any hover/press trigger on the SAME element,
//     so a plain assignment is fine; no PART_Selected layer needed.
//   * The thumb's hover (@BrandGreenHover) and drag (@BrandGreenPress)
//     DO share PART_Thumb's Fill. A ControlTemplate trigger stack
//     resolves a shared-property tie by whichever condition's
//     SetTriggerValue call happens LAST AT RUNTIME (the Toggle fork's
//     empirically-verified rule) — but unlike a pre-existing checked
//     state racing a later hover, a drag can only begin from an
//     ALREADY-hovered thumb (the pointer must be over it to press it),
//     so IsDragging's trigger always activates chronologically after
//     IsMouseOver's in any real gesture. Drag wins outright with plain
//     triggers; no opaque overlay layer required (verified by this
//     fork's own render test — see controls-slider.test.ts).
//   * SpinEdit reuses the Pragmatic Outlined TextBox chrome (@Bg1 +
//     @BorderStrong + @RadiusMd) on its OWN outer PART_Border — the
//     composed inner TextBox (PART_TextBox) already resolves the
//     Pragmatic TextBox Style on its own (same runtime class, same
//     theme dictionary), so no separate token wiring is needed there;
//     SpinEdit's ctor hides that inner border's Stroke unconditionally
//     (spin-edit.ts), leaving the outer border as the only visible
//     outline either way.
//
// Only Pragmatic tokens are used — no raw hex (except the `#00000000`
// transparent convention), no M3 tokens (@Surface / @Outline /
// @OnSurfaceVariant / @Shape* / @State*Overlay). Radii stay at
// @RadiusMd / @RadiusPill, both well under the @RadiusXl cap. The
// track/fill CornerRadius=2, the focus-ring/thumb pixel geometry, and
// the button-column geometry all stay as inline literals, matching
// Material's own rationale — these are structural parts of the M3
// slider shape / mural-specific spinner geometry, not general spacing
// tokens.
//
// Merged into the theme via PragmaticControls (controls.resources.mu),
// listed AFTER MuralFramework so these key-less
// Style[TargetType=Slider|SpinEdit] entries shadow Material's
// (last-merged-wins on the runtime class key).

resources PragmaticSliders
{
    // ── Slider ──────────────────────────────────────────────────────
    Template x:key="DefaultSlider" [TargetType = Slider]
    {
        SliderLayout x:name="PART_Layout"
        {
            Border x:name="PART_Track"
                [ Fill = @Bg3,
                  CornerRadius = 2 ]
            Border x:name="PART_Fill"
                [ Fill = @ControlAccent,
                  CornerRadius = 2 ]
            // PART_FocusRing — fixed 8x20 box (thumb's own 4x16 plus
            // 2x@FocusRingOffset per axis), overflowing its 4x16
            // arranged slot via Visual.Arrange's explicit-size-wins
            // rule. See the header GOTCHA for why this can't be a
            // zero-Padding wrapper the way Button / Toggle's ring is.
            //   GOTCHA (offset, not just size): Visual.Arrange's
            // computeOffsetX/Y treat overflow (renderSize >= slot) as a
            // FLUSH fit — `extra = slotWidth - renderWidth; if (extra
            // <= 0) return 0` (visual.ts ~1486) — Stretch/Center never
            // centre an overflowing box; it anchors flush at the slot's
            // own origin. An 8-wide ring given a 4-wide slot at
            // thumbOffset therefore renders at exactly thumbOffset (not
            // thumbOffset-2), pushing its centre — and the nested
            // thumb's centre — 2dp past the true value position (caught
            // by this fork's own geometry render test: thumb centre
            // landed at thumbOffset+4 instead of thumbOffset+2).
            //   Fix: a uniform NEGATIVE Margin equal to -@FocusRingOffset
            // on every side EXPANDS the marginedRect the ring is offered
            // to exactly the ring's own size before the offset calc
            // runs (visual.ts ~1361: `marginedRect.Width = finalRect.
            // Width - margin.Horizontal`, and margin.Horizontal is
            // negative here, so it ADDS) — so extra lands at exactly 0
            // for an EXACT fit at the shifted origin (thumbOffset-2),
            // not an overflowing one, re-centring the ring (and the
            // thumb nested inside it) back on the true thumbOffset+2
            // value position. Works unchanged for both orientations —
            // the overflow is 2dp per side on both axes either way.
            Border x:name="PART_FocusRing"
                [ Fill = #00000000,
                  CornerRadius = @RadiusPill,
                  Width = 8,
                  Height = 20,
                  Margin = (-2,-2,-2,-2) ]
            {
                Border x:name="PART_Thumb"
                    [ Fill = @ControlAccent,
                      CornerRadius = @RadiusPill,
                      Width = 4,
                      Height = 16 ]
            }
        }
        // Vertical orientation swaps the pill's axes — see
        // Slider.ArrangeSliderParts (vertical arranges the thumb as
        // 16 wide x 4 tall, the horizontal shape rotated 90deg).
        when ( Orientation = Vertical )
        {
            PART_FocusRing.Width = 20;
            PART_FocusRing.Height = 8;
            PART_Thumb.Width = 16;
            PART_Thumb.Height = 4;
        }
        // Hover declared before drag — a drag can't begin without first
        // hovering the thumb, so IsDragging's trigger always activates
        // after IsMouseOver's at runtime and wins the shared Fill (see
        // header comment).
        when ( PART_Thumb.IsMouseOver ) { PART_Thumb.Fill = @BrandGreenHover; }
        when ( IsDragging ) { PART_Thumb.Fill = @BrandGreenPress; }
        when ( IsFocused ) { PART_FocusRing.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
        when ( IsEnabled = false ) { PART_Layout.Opacity = @OpacityDisabled; }
    }
    Style [TargetType = Slider]
    {
        Template = @DefaultSlider;
    }

    // ── SpinEdit ────────────────────────────────────────────────────
    Template x:key="DefaultSpinEdit" [TargetType = SpinEdit]
    {
        Border x:name="PART_Border"
            [ Fill = @Bg1,
              Stroke = Pen [ Brush = @BorderStrong ],
              CornerRadius = @RadiusMd ]
        {
            DockPanel
            {
                // Button column geometry: 18dp wide, 14dp tall per arrow —
                // mural-specific tight geometry with no design-system
                // spacing token to anchor to (carried over from Material's
                // own template unchanged).
                Border x:name="PART_ButtonColumn"
                    [ DockPanel.Dock = Right,
                      Width           = 18 ]
                {
                    StackPanel [ Orientation = Vertical ]
                    {
                        RepeatButton x:name="PART_Up"
                            [ Fill    = #00000000,
                              Padding = (0,2,0,2),
                              Height  = 14 ]
                        {
                            Shape x:name="PART_UpGlyph"
                                [ Geometry            = @ChevronUp,
                                  Fill                = @Fg2,
                                  Width               = 10,
                                  Height              = 10,
                                  HorizontalAlignment = Center,
                                  VerticalAlignment   = Center ]
                        }
                        RepeatButton x:name="PART_Down"
                            [ Fill    = #00000000,
                              Padding = (0,2,0,2),
                              Height  = 14 ]
                        {
                            Shape x:name="PART_DownGlyph"
                                [ Geometry            = @ChevronDown,
                                  Fill                = @Fg2,
                                  Width               = 10,
                                  Height              = 10,
                                  HorizontalAlignment = Center,
                                  VerticalAlignment   = Center ]
                        }
                    }
                }
                // Left-edge divider between the value field and the
                // button column. Docked Right AFTER the column so it
                // lands on the column's left edge.
                Line x:name="PART_ColumnDivider"
                    [ DockPanel.Dock = Right,
                      Orientation    = Vertical,
                      Stroke         = Pen [ Brush = @Border ] ]
                TextBox x:name="PART_TextBox"
            }
        }
        // Outer-border focus cue — IsEditFocused mirrors the composed
        // TextBox's own IsFocused (spin-edit.ts forwards it). No hover
        // restyle here, matching the reused Outlined TextBox chrome's
        // own rule (rest and hover read the same; only focus / disabled
        // are distinct states for an input surface).
        when ( IsEditFocused ) { PART_Border.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
        when ( IsEnabled = false ) { PART_Border.Opacity = @OpacityDisabled; }

        // Stepper buttons — ghost-style: transparent at rest, @Bg2 on
        // hover. Each button's IsMouseOver sources its own row so a
        // hover on PART_Up doesn't light PART_Down.
        when ( PART_Up.IsMouseOver ) { PART_Up.Fill = @Bg2; }
        when ( PART_Down.IsMouseOver ) { PART_Down.Fill = @Bg2; }

        // Spinner geometry tracks density: Compact narrows the button
        // column and shrinks the arrows 40%; Comfortable widens it and
        // grows them 20%. Declared BEFORE the Coarse trigger so a touch
        // pointer still wins the column width when both apply.
        when ( ThemeManager.Density = Compact )
        {
            PART_ButtonColumn.Width = 12;
            PART_UpGlyph.Width = 6;
            PART_UpGlyph.Height = 6;
            PART_DownGlyph.Width = 6;
            PART_DownGlyph.Height = 6;
        }
        when ( ThemeManager.Density = Comfortable )
        {
            PART_ButtonColumn.Width = 22;
            PART_UpGlyph.Width = 12;
            PART_UpGlyph.Height = 12;
            PART_DownGlyph.Width = 12;
            PART_DownGlyph.Height = 12;
        }
        // Coarse pointer (touch) — widen the button column. Last so it
        // outranks the density width above.
        when ( ThemeManager.Pointer = Coarse ) { PART_ButtonColumn.Width = 28; }
    }
    Style [TargetType = SpinEdit]
    {
        Template = @DefaultSpinEdit;
    }
}
