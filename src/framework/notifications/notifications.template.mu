// Default theme entries for the notifications family — feedback /
// status surfaces (ProgressIndicator / Banner / Snackbar). Mix of
// in-flow (Banner) and transient/overlay (Snackbar) surfaces plus
// the work-in-progress indicator (ProgressIndicator).
//
// Merged into the root MuralFramework dictionary via an `import`
// clause in src/resources/framework.resources.mu.

resources Notifications {
    // ── ProgressIndicator: M3 Linear progress ──────────────────────
    // Determinate Linear progress — 4dp track + fill ride above one
    // another with a CornerRadius=2 ramp (matches Slider track and M3
    // spec). The fill's width is consumer-driven; the simple
    // determinate path uses a Width binding to Value (0..1 expressed
    // as a 0..100% pill width via Margin or an outer scaling layer).
    // Mural's binding DSL doesn't yet emit unit-conversion converters
    // declaratively, so this v0 template ships a fixed-width fill that
    // the consumer scales via a class-level handler; the binding
    // pipeline lands when the converter syntax does.
    Template x:key="DefaultLinearProgressIndicator" [TargetType = ProgressIndicator] {
        Border x:name="PART_Track"
            [ Fill      = @SurfaceContainerHighest,
              CornerRadius    = 2,
              ClipToBounds    = true,
              Height          = 4 ] {
            Border x:name="PART_Fill"
                [ Fill          = @Primary,
                  CornerRadius        = 2,
                  HorizontalAlignment = Left,
                  Height              = 4 ]
        }
        when ( IsEnabled = false ) { PART_Track.Opacity = @DisabledContentOpacity; }
    }
    // Circular variant — 40dp ring (M3 spec) with the active progress
    // sweep traced by PART_Fill (Arc). PART_Track is a full-circle Arc
    // at @SurfaceContainerHighest behind PART_Fill at @Primary; the
    // Fill's EndAngle is bound to the consumer's Value via a class-
    // level handler in ProgressIndicator (Value 0..1 → EndAngle
    // StartAngle..StartAngle+360). The simple v0 template ships a
    // 360° fill so the consumer either sets EndAngle directly or
    // wires up a Value→EndAngle binding-converter in their app code.
    // Stroke pens for the circular ProgressIndicator's Arc track + fill.
    // Pens carry the full SVG-stroke spec now (Brush + Thickness +
    // DashStyle + LineCap + LineJoin + MiterLimit), so shape templates
    // declare reusable Pen resources rather than `Stroke + StrokeThickness`
    // pairs. Brushes resolve through DynamicResource, so theme switches
    // re-tint the Pens automatically.
    Pen x:key="ProgressTrackPen" [ Brush = @SurfaceContainerHighest, Thickness = 4 ]
    Pen x:key="ProgressFillPen" [ Brush = @Primary, Thickness = 4 ]

    Template x:key="DefaultCircularProgressIndicator" [TargetType = ProgressIndicator] {
        Border x:name="PART_OuterFrame"
            [ Fill      = #00000000,
              Width           = 40,
              Height          = 40 ] {
            // Two overlapping Arc Visuals — track underneath, fill on
            // top. Both start at -90° (top of the circle) so any
            // sweep reads "filling clockwise from 12 o'clock", the
            // M3 affordance.
            Arc x:name="PART_Track"
                [ StartAngle = -90,
                  EndAngle   = 270,
                  Stroke     = @ProgressTrackPen,
                  Width      = 40,
                  Height     = 40 ]
            Arc x:name="PART_Fill"
                [ StartAngle = -90,
                  EndAngle   = 270,
                  Stroke     = @ProgressFillPen,
                  Width      = 40,
                  Height     = 40 ]
        }
        when ( IsEnabled = false ) { PART_OuterFrame.Opacity = @DisabledContentOpacity; }
    }
    Style [TargetType = ProgressIndicator] {
        Template = @DefaultLinearProgressIndicator;
        when ( Variant = Circular ) { Template = @DefaultCircularProgressIndicator; }
    }

    // ── Banner: M3 in-flow alert / message strip ───────────────────
    // Leading icon | headline+supporting | trailing actions —
    // same DockPanel shape as ListBoxItem's anatomy. Banner doesn't
    // ship Leading / Actions class-level slot wiring (the consumer
    // sets DP values; the template's PART_LeadingSlot is a
    // ContentPresenter binding directly via $Leading). M3 spec uses
    // @Surface as the resting fill with no border by default; the
    // trailing actions row anchors right.
    Template x:key="DefaultBanner" [TargetType = Banner] {
        StackPanel [ Orientation = Vertical ] {
            Border x:name="PART_Banner"
                [ Fill      = @Surface,
                  Padding         = (@Spacing4,@Spacing3,@Spacing4,@Spacing3) ] {
                DockPanel [ LastChildFill = true ] {
                    ContentPresenter
                        [ DockPanel.Dock    = Left,
                          Content           = $Leading,
                          VerticalAlignment = Center,
                          Margin            = (0,0,@Spacing3,0) ]
                    ContentPresenter
                        [ DockPanel.Dock    = Right,
                          Content           = $Actions,
                          VerticalAlignment = Center,
                          Margin            = (@Spacing3,0,0,0) ]
                    ContentPresenter [ VerticalAlignment = Center ]
                }
            }
            // Bottom hairline — was a one-sided (0,0,0,1) border edge; it
            // is now an oriented Line at the strip's foot.
            Line [ Orientation = Horizontal, Stroke = (@OutlineVariant, 1) ]
        }
        // Density — tighten / loosen the strip's inset on the 4dp grid.
        // Banner is a container; its trailing Actions row is slotted
        // buttons that carry their own coarse-pointer targets, so this is a
        // spacing response only.
        when ( ThemeManager.Density = Compact ) {
            PART_Banner.Padding = (@Spacing3,@Spacing2,@Spacing3,@Spacing2);
        }
        when ( ThemeManager.Density = Comfortable ) {
            PART_Banner.Padding = (@Spacing5,@Spacing4,@Spacing5,@Spacing4);
        }
    }
    Style [TargetType = Banner] {
        Template = @DefaultBanner;
        Foreground = @OnSurface;
        FontFamily = @BodyMediumFont;
        FontWeight = @BodyMediumWeight;
        FontSize = @BodyMediumSize;
        LineHeight = @BodyMediumLineHeight;
        LetterSpacing = @BodyMediumTracking;
    }

    // ── Snackbar: M3 transient message ─────────────────────────────
    // @InverseSurface fill, @InverseOnSurface ink (M3 inverts the
    // snackbar against host theme so it stays legible regardless of
    // backdrop). ExtraSmall corner radius matches the spec.
    Template x:key="DefaultSnackbar" [TargetType = Snackbar] {
        Border x:name="PART_Snackbar"
            [ Fill      = @InverseSurface,
              Stroke     = Pen [ Brush = #00000000 ],
              CornerRadius    = @ShapeExtraSmall,
              Effect          = @Elevation3,
              Padding         = (@Spacing4,@Spacing3,@Spacing2,@Spacing3) ] {
            DockPanel [ LastChildFill = true ] {
                ContentPresenter
                    [ DockPanel.Dock    = Right,
                      Content           = $Actions,
                      VerticalAlignment = Center,
                      Margin            = (@Spacing4,0,0,0) ]
                ContentPresenter [ VerticalAlignment = Center ]
            }
        }
        // Density — tighten / loosen the transient message's inset. The
        // trailing action is a slotted button (self-adapting), so container
        // spacing only. The asymmetric right inset (smaller, for the action)
        // is preserved across the ladder.
        when ( ThemeManager.Density = Compact ) {
            PART_Snackbar.Padding = (@Spacing3,@Spacing2,@Spacing1,@Spacing2);
        }
        when ( ThemeManager.Density = Comfortable ) {
            PART_Snackbar.Padding = (@Spacing5,@Spacing4,@Spacing3,@Spacing4);
        }
    }
    Style [TargetType = Snackbar] {
        Template = @DefaultSnackbar;
        Foreground = @InverseOnSurface;
        FontFamily = @BodyMediumFont;
        FontWeight = @BodyMediumWeight;
        FontSize = @BodyMediumSize;
        LineHeight = @BodyMediumLineHeight;
        LetterSpacing = @BodyMediumTracking;
    }

    // ── LoadingIndicator: M3 2024 indeterminate spinner ─────────────
    // A single @Primary arc that rotates continuously while its sweep
    // grows / shrinks (the "variable-amplitude oscillation" that sets it
    // apart from ProgressIndicator's constant-length ring). The rotation
    // + sweep animation is owned by the control (loading-indicator.ts),
    // which spins a RotateTransform onto PART_Fill and drives PART_Fill's
    // EndAngle — the template just supplies the resting chrome. The
    // Contained variant fills the 48dp circle behind the arc.
    Pen x:key="LoadingActivePen" [ Brush = @Primary, Thickness = 4 ]

    Template x:key="DefaultLoadingIndicator" [TargetType = LoadingIndicator] {
        Border x:name="PART_Container"
            [ Width               = 48,
              Height              = 48,
              Fill          = #00000000,
              CornerRadius        = @ShapeFull,
              HorizontalAlignment = Center,
              VerticalAlignment   = Center ] {
            // 40dp arc centred in the 48dp box, leaving a 4dp ring gutter
            // for the stroke half-width. StartAngle -90 anchors the sweep
            // at 12 o'clock; the resting 40° tail is what shows before the
            // control's animation (or when IsActive=false) takes over.
            Arc x:name="PART_Fill"
                [ StartAngle          = -90,
                  EndAngle            = -50,
                  Stroke              = @LoadingActivePen,
                  Width               = 40,
                  Height              = 40,
                  HorizontalAlignment = Center,
                  VerticalAlignment   = Center ]
        }
        when ( Variant = Contained ) { PART_Container.Fill = @SurfaceContainerHighest; }
        when ( IsEnabled = false ) { PART_Container.Opacity = @DisabledContentOpacity; }
    }
    Style [TargetType = LoadingIndicator] {
        Template = @DefaultLoadingIndicator;
    }
}
