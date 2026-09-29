// Pragmatic theme — Chip / Divider / Badge chrome (Wave 1).
//
// Forked from Material's markers.template.mu (DefaultChip, the
// DefaultHorizontalDivider / DefaultVerticalDivider pair, and
// DefaultDotBadge / DefaultNumericBadge), re-expressed with the same
// Pragmatic mechanics the Button / IconButton / Toggle forks established
// (framework/pragmatic/buttons/buttons.template.mu,
// framework/pragmatic/icon-buttons/icon-buttons.template.mu,
// framework/pragmatic/toggles/toggles.template.mu):
//
//   * EVERY stroke uses the Pen form — `Stroke = Pen [ Brush = @Token,
//     Thickness = n ]`. A `(brush, width)` tuple assigned to a Pen-typed
//     property silently compiles to a Thickness instead (confirmed by
//     the TextBox fork's GOTCHA comment) and never paints. The Chip
//     border and the Divider rule (both orientations) both use the Pen
//     form.
//   * Chip's selected fill rides a nested opaque PART_Selected layer,
//     copied from icon-buttons.template.mu:97-134 / toggles.template.mu —
//     a ControlTemplate trigger stack resolves a shared-property tie by
//     whichever condition's SetTriggerValue call happens LAST AT RUNTIME
//     (a real IsChecked flip vs. a real PointerEnter), never by `when`
//     clause declaration order. Chip's selected fill (@SurfaceSelected)
//     and its hover fill (@Bg2) share the chip's own surface, so a plain
//     `when(IsChecked){ PART_Chip.Fill = @SurfaceSelected }` would lose
//     the selected cue to a later hover exactly like the IconButtonToggle
//     bug this pattern already fixed. PART_Selected is a second, opaque
//     Border nested INSIDE PART_Chip, transparent unless checked; when
//     checked it opaquely paints over whatever PART_Chip is currently
//     showing (hover included) — a z-order compositing guarantee, not a
//     trigger-priority one, so it holds regardless of event chronology.
//     The label/leading/trailing content moves to PART_Selected — it's
//     now the innermost painted layer.
//   * Chip focus rides a DEDICATED PART_FocusRing element (never a
//     re-stroke of PART_Chip's own border), matching the Button /
//     IconButton / Toggle exemplars — focus (@BorderFocus) and the chip
//     border (@Border) / selected state write DIFFERENT elements, so
//     they can never collide or overwrite one another.
//   * The Divider rule uses a `Line` shape (Orientation-driven stretch
//     mode — see basic/shapes/line.ts) rather than Material's 1dp-tall
//     filled Border. A Line strokes its geometry (`dc.DrawGeometry(
//     undefined, stroke, geom)`), so it emits the same `stroke="…"` SVG
//     attribute the Chip border / focus ring do — required so the rule
//     renders through the Pen form rather than a Fill (a `(brush,width)`-
//     shaped GOTCHA does not even apply to Fill, but the design intent
//     here is a stroked rule, consistent with every other hairline in
//     this file).
//   * Chip ignores Kind (Assist / Filter / Input / Suggestion) — like
//     IconButton going ghost-only, the Pragmatic Chip is a single
//     chrome driven purely by IsChecked (ToggleButton's own selected
//     state); Kind-specific chrome is out of Wave 1 scope.
//
// Only Pragmatic tokens are used — no raw hex (except the `#00000000`
// transparent convention), no M3 tokens (@Surface / @OnSurface /
// @Error / @OnError / @OutlineVariant / @Shape*). Radii stay at
// @RadiusPill (the Chip / Badge pill shape), the one Pragmatic radius
// above @RadiusXl the brief explicitly calls out as exempt from the cap.
//
// Merged into the theme via PragmaticControls (controls.resources.mu),
// listed AFTER MuralFramework so these key-less
// Style[TargetType=Chip|Divider|Badge] entries shadow Material's
// (last-merged-wins on the runtime class key).

resources Markers
{
    // ── Chip: compact attribute / filter / input / suggestion surface ──
    // Rest — @Bg1 fill, 1dp @Border outline, @RadiusPill corners. Hover
    // steps the outer chip surface to @Bg2. Selected (IsChecked) opaquely
    // paints @SurfaceSelected over PART_Chip via PART_Selected, and the
    // label ink flips to @BrandGreenInk (Style-level trigger — a
    // ControlTemplate trigger can't target the 3-segment
    // PART_Selected.TextBlock.Foreground attached-property path, the
    // same constraint the tool-bar / navigation / list forks work around
    // by setting the control's own inherited Foreground in the Style
    // instead).
    Template x:key="DefaultChip" [TargetType = Chip]
    {
        Border x:name="PART_FocusRing"
            [ Fill = #00000000,
              Padding = (@FocusRingOffset),
              CornerRadius = @RadiusPill ]
        {
            Border x:name="PART_Chip"
                [ Fill      = @Bg1,
                  Stroke     = Pen [ Brush = @Border, Thickness = 1 ],
                  CornerRadius    = @RadiusPill ]
            {
                Border x:name="PART_Selected"
                    [ Fill      = #00000000,
                      CornerRadius    = @RadiusPill,
                      Padding         = (5,2,5,2) ]
                {
                    DockPanel [ LastChildFill = true ]
                    {
                        Border x:name="PART_LeadingSlot"
                            [ DockPanel.Dock    = Left,
                              VerticalAlignment = Center ]
                        Border x:name="PART_TrailingSlot"
                            [ DockPanel.Dock    = Right,
                              VerticalAlignment = Center ]
                        ContentPresenter [ VerticalAlignment = Center ]
                    }
                }
            }
        }
        // Selected — PART_Selected opaquely covers PART_Chip regardless
        // of hover (see header comment). Ordered before the hover /
        // focus triggers below purely for readability; the z-order
        // compositing guarantee (not trigger order) is what makes this
        // survive a later hover.
        when ( IsChecked ) { PART_Selected.Fill = @SurfaceSelected; }
        when ( IsMouseOver ) { PART_Chip.Fill = @Bg2; }
        when ( IsFocused ) { PART_FocusRing.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
        when ( IsEnabled = false ) { PART_Chip.Opacity = @OpacityDisabled; }
    }
    Style [TargetType = Chip]
    {
        Template = @DefaultChip;
        Foreground = @Fg1;
        FontFamily = @FontSans;
        FontWeight = @UiLabelWeight;
        FontSize = @UiLabelSize;
        LineHeight = @UiLabelLineHeight;
        LetterSpacing = @UiLabelTracking;
        // Size the pill to the label with the paint engine's own text
        // layout, so the chip fits its label identically in a standalone
        // browser and in Electron's Chromium (Canvas measureText and SVG
        // <text> disagree by a sub-pixel that differs across builds).
        MeasurementFidelity = Exact;
        // Selected ink — set on the control's own inherited Foreground
        // (2-segment self-property) rather than a ControlTemplate
        // trigger, which can't reach PART_Selected.TextBlock.Foreground
        // (a 3-segment attached-property path).
        when ( IsChecked ) { Foreground = @BrandGreenInk; }
    }

    // ── Divider: 1dp rule, horizontal or vertical ───────────────────
    // Two templates — one per Orientation, matching Material's own
    // rationale (mural's CornerRadius / BorderThickness DPs are uniform
    // across a control instance, so one template with an Orientation
    // trigger would still box the rule rather than draw a 1dp line).
    // Both stroke a `Line` in its oriented stretch-and-fill mode (see
    // basic/shapes/line.ts) with the Pen form, so the rule renders as
    // a `stroke="…"` attribute rather than a Fill rectangle.
    Template x:key="DefaultHorizontalDivider" [TargetType = Divider]
    {
        Line x:name="PART_Rule"
            [ Orientation         = Horizontal,
              Stroke              = Pen [ Brush = @Border, Thickness = 1 ],
              HorizontalAlignment = Stretch ]
    }
    Template x:key="DefaultVerticalDivider" [TargetType = Divider]
    {
        Line x:name="PART_Rule"
            [ Orientation       = Vertical,
              Stroke            = Pen [ Brush = @Border, Thickness = 1 ],
              VerticalAlignment = Stretch ]
    }
    Style [TargetType = Divider]
    {
        Template = @DefaultHorizontalDivider;
        when ( Orientation = Vertical ) { Template = @DefaultVerticalDivider; }
    }

    // ── Badge: dot / numeric flag ────────────────────────────────────
    // Two templates — one per Variant. Both use @StateDanger / @FgOnAccent
    // per the brief (tone-driven variants are a later follow-up).
    Template x:key="DefaultDotBadge" [TargetType = Badge]
    {
        Border x:name="PART_Dot"
            [ Fill      = @StateDanger,
              CornerRadius    = @RadiusPill,
              Width           = 6,
              Height          = 6 ]
    }
    Template x:key="DefaultNumericBadge" [TargetType = Badge]
    {
        Border x:name="PART_Pill"
            [ Fill      = @StateDanger,
              CornerRadius    = @RadiusPill,
              Padding         = (@Space1,0,@Space1,0),
              MinWidth        = 16,
              Height          = 16 ]
        {
            TextBlock
                // $$CountText — a TemplateBinding to the templated
                // PARENT's own CountText DP (compiler: TemplateBinding(
                // _templatedParent, "CountText")), relaying Badge's own
                // Count rather than re-reading the ambient DataContext
                // (Material's own markers.template.mu source used to read
                // `Text = $Count` — a `$`-DataContextBinding pulling a
                // `Count` field off the TextBlock's inherited DataContext
                // instead of the templated Badge's own Count DP; wrong
                // source for a standalone Badge with no bound view-model).
                //
                // CountText (Badge.ts) is a derived STRING mirror of
                // Count, kept in lock-step via OnPropertyChanged — needed
                // because TextBlock.Text is string-typed, Count is a
                // number, and neither `$` nor `$$` supports a converter
                // on a TemplateBinding today (only the `binding` — single
                // `$` — grammar accepts a `<< converter` chain). Binding
                // straight to the numeric Count crashed
                // SvgDrawingContext.escapeXmlText (`s.replace` on a
                // number) — confirmed this reproduced identically against
                // Material's own DefaultNumericBadge under a headless
                // render; Badge had zero test coverage before Wave-1.
                // Fixed for both themes — see Wave-1 follow-up (B).
                [ Text                = $$CountText,
                  Foreground          = @FgOnAccent,
                  Style               = @UiCaption,
                  HorizontalAlignment = Center,
                  VerticalAlignment   = Center ]
        }
    }
    Style [TargetType = Badge]
    {
        Template = @DefaultNumericBadge;
        when ( Variant = Dot ) { Template = @DefaultDotBadge; }
    }
}
