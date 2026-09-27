// Default theme entries for the markers family — small visual marks
// (Chip / Divider / Badge) that don't fit any other family.
//
// Merged into the root MuralFramework dictionary via an `import`
// clause in src/resources/framework.resources.mu; the compiler turns
// that import into a Clone()-time fold so every entry below ends up
// in MuralFramework's keyed table.

resources Markers {
    // ── Chip: M3 compact attribute / filter / input / suggestion ───
    // 32dp tall pill chrome with leading + trailing slots and a
    // ContentPresenter for the label. Kind-aware triggers tint the
    // chrome per variant:
    //   * Assist     — outlined surface, neutral OnSurface label.
    //   * Filter     — outlined surface at rest; flips to filled
    //                  @SecondaryContainer when IsChecked (the
    //                  selectable filter affordance).
    //   * Input      — outlined surface; trailing slot conventionally
    //                  carries a remove icon (consumer-supplied).
    //   * Suggestion — outlined surface; same chrome as Assist, the
    //                  semantic difference is consumer-side.
    //
    // The Kind variants all share base chrome — the variant-specific
    // triggers below override only the bits that differ. Filter is the
    // only variant that observes IsChecked at the template level; the
    // other variants ignore it entirely (the consumer can still toggle
    // IsChecked programmatically through ToggleButton, no chrome
    // change).
    Template x:key="DefaultChip" [TargetType = Chip] {
        Border x:name="PART_Chip"
            [ Fill      = @Surface,
              Stroke     = Pen [ Brush = @OutlineVariant ],
              CornerRadius    = @ShapeSmall,
              Padding         = (5,2,5,2) ] {
            DockPanel [ LastChildFill = true ] {
                Border x:name="PART_LeadingSlot"
                    [ DockPanel.Dock    = Left,
                      VerticalAlignment = Center ]
                Border x:name="PART_TrailingSlot"
                    [ DockPanel.Dock    = Right,
                      VerticalAlignment = Center ]
                ContentPresenter [ VerticalAlignment = Center ]
            }
        }
        // Filter — selected fills with @SecondaryContainer; the
        // outline reads as the M3 "input" indicator. The derived
        // IsFilterSelected DP combines Kind=Filter and IsChecked
        // because ControlTemplate triggers don't compose multi-term
        // conjuncts; the class recomputes it on every Kind / IsChecked
        // edge.
        when ( IsFilterSelected ) {
            PART_Chip.Fill = @SecondaryContainer;
            PART_Chip.Stroke = Pen [ Brush = @SecondaryContainer ];
        }

        // State-layer ladder — translucent OnSurface overlays over
        // whatever variant background is currently active. Ordered
        // BEFORE the Filter-selected trigger so a hovered selected
        // filter chip stays in its @SecondaryContainer tint (the
        // state-layer overlay would otherwise wash it back to neutral).
        when ( IsMouseOver ) { PART_Chip.Fill = @StateHoverOverlay; }
        when ( IsFocused ) { PART_Chip.Fill = @StateFocusOverlay; }
        when ( IsPressed ) { PART_Chip.Fill = @StatePressOverlay; }
        when ( IsEnabled = false ) { PART_Chip.Opacity = @DisabledContentOpacity; }

        // Adaptive layout (§ 18.6) — PART_Chip bears the interactive
        // pill chrome, so density / pointer retuning rides here. Resting
        // is Padding (5,2,5,2) with no explicit Height (the label drives
        // it). Compact and Comfortable pin an explicit padding + height;
        // Coarse pointer bumps the pill height for a larger touch target.
        when ( ThemeManager.Density = Compact ) {
            PART_Chip.Padding = (8,4,8,4);
            PART_Chip.Height = 24;
        }
        when ( ThemeManager.Density = Comfortable ) {
            PART_Chip.Padding = (16,6,16,6);
            PART_Chip.Height = 40;
        }
        when ( ThemeManager.Pointer = Coarse ) {
            PART_Chip.Padding = (16,8,16,8);
            PART_Chip.Height = 44;
        }
    }
    Style [TargetType = Chip] {
        Template = @DefaultChip;
        Foreground = @OnSurface;
        // Full Label Large atom set (§ 18.13 — was Font/Weight/Size only,
        // so LineHeight/Tracking silently fell back to the ambient default).
        // Chip is the styled control (not a TextBlock), so these ride into
        // the label via inheritance rather than a `Style = @LabelLarge`.
        FontFamily = @LabelLargeFont;
        FontWeight = @LabelLargeWeight;
        FontSize = @LabelMediumSize;
        LineHeight = @LabelLargeLineHeight;
        LetterSpacing = @LabelLargeTracking;
        // Size the pill to the label with the paint engine's own text layout,
        // so the chip fits its label identically in a standalone browser and
        // in Electron's Chromium (Canvas measureText and SVG <text> disagree
        // by a sub-pixel that differs across builds). Inherits into the label
        // TextBlock the consumer nests as content — see TextBlock.MeasurementFidelity.
        MeasurementFidelity = Exact;
    }

    // ── Divider: M3 1dp rule, horizontal or vertical ───────────────
    // Two templates — one per Orientation — because mural's CornerRadius
    // / BorderThickness DPs are uniform across the control instance, so
    // a single template with a trigger that just flips Orientation
    // would still produce a 1dp box around the rule rather than a 1dp
    // line. The Style picks the matching template based on Orientation.
    Template x:key="DefaultHorizontalDivider" [TargetType = Divider] {
        Border x:name="PART_Rule"
            [ Fill          = @OutlineVariant,
              Height              = 1,
              HorizontalAlignment = Stretch ]
    }
    Template x:key="DefaultVerticalDivider" [TargetType = Divider] {
        Border x:name="PART_Rule"
            [ Fill        = @OutlineVariant,
              Width             = 1,
              VerticalAlignment = Stretch ]
    }
    Style [TargetType = Divider] {
        Template = @DefaultHorizontalDivider;
        when ( Orientation = Vertical ) { Template = @DefaultVerticalDivider; }
    }

    // ── Badge: M3 dot / numeric flag ───────────────────────────────
    // Two templates — one per Variant. Variant=Dot ships a 6×6dp
    // filled circle; Variant=Numeric ships a pill carrying Badge's
    // own Count, relayed as a string via a $$-TemplateBinding to
    // CountText (Badge.ts). Both use @Error / @OnError per the M3
    // spec; consumers wanting a non-error tint re-template.
    //
    // Wave-1 follow-up (B): this used to read `Text = $Count` — a
    // `$`-DataContextBinding, which reads the ambient DataContext's
    // `Count` field rather than the templated Badge's own Count DP,
    // AND handed a raw number into the string-typed Text DP, which
    // crashed SvgDrawingContext.escapeXmlText. $$CountText fixes
    // both: `$$` relays the templated parent's own property, and
    // CountText is Badge's derived STRING mirror of Count.
    Template x:key="DefaultDotBadge" [TargetType = Badge] {
        Border x:name="PART_Dot"
            [ Fill      = @Error,
              CornerRadius    = @ShapeFull,
              Width           = 6,
              Height          = 6 ]
    }
    Template x:key="DefaultNumericBadge" [TargetType = Badge] {
        Border x:name="PART_Pill"
            [ Fill      = @Error,
              CornerRadius    = @ShapeFull,
              Padding         = (@Spacing1,@Spacing0,@Spacing1,@Spacing0),
              MinWidth        = 16,
              Height          = 16 ] {
            TextBlock
                [ Text                = $$CountText,
                  Foreground          = @OnError,
                  Style               = @LabelSmall,
                  HorizontalAlignment = Center,
                  VerticalAlignment   = Center ]
        }
    }
    Style [TargetType = Badge] {
        Template = @DefaultNumericBadge;
        when ( Variant = Dot ) { Template = @DefaultDotBadge; }
    }
}
