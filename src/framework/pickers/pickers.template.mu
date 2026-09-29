// Default theme entries for the pickers family — DatePicker (§18.9).
// TimePicker joins this file as it lands.
//
// Merged into the root MuralFramework dictionary via an `import` clause
// in src/resources/framework.resources.mu.

resources Pickers {
    // ── DatePicker: M3 Docked calendar ─────────────────────────────
    // Header (prev | Month Year | next) over a weekday row and the day
    // grid the control (date-picker.ts) fills programmatically. The root
    // is a fixed 306dp so the 280dp content area divides into 7 × 40dp
    // columns — both the weekday header and PART_DayGrid stretch to that
    // width, keeping their columns aligned.
    Template x:key="DefaultDatePicker" [TargetType = DatePicker] {
        Border x:name="PART_Root"
            [ Fill      = @Bg1,
              Stroke     = Pen [ Brush = @Border ],
              CornerRadius    = @RadiusLg,
              Padding         = (@Space3,@Space3,@Space3,@Space3),
              Width           = 306 ] {
            StackPanel [ Orientation = Vertical ] {
                // Header — month navigation.
                DockPanel [ LastChildFill = true, Margin = (0,0,0,@Space2) ] {
                    IconButton x:name="PART_PrevButton" [ Variant = Standard, DockPanel.Dock = Left ] {
                        Shape [ Geometry = @ChevronLeft, Fill = @Fg2, Width = 18, Height = 18 ]
                    }
                    IconButton x:name="PART_NextButton" [ Variant = Standard, DockPanel.Dock = Right ] {
                        Shape [ Geometry = @ChevronRight, Fill = @Fg2, Width = 18, Height = 18 ]
                    }
                    TextBlock x:name="PART_MonthLabel"
                        [ Text                = "",
                          Style               = @UiLabel,
                          Foreground          = @Fg1,
                          HorizontalAlignment = Center,
                          VerticalAlignment   = Center ]
                }
                // Weekday initials, Sunday-first (matches the grid's
                // FirstColumn = 1st-of-month weekday).
                UniformGrid [ Columns = 7 ] {
                    TextBlock [ Text = "S", Style = @UiCaption, Foreground = @Fg2, HorizontalAlignment = Center ]
                    TextBlock [ Text = "M", Style = @UiCaption, Foreground = @Fg2, HorizontalAlignment = Center ]
                    TextBlock [ Text = "T", Style = @UiCaption, Foreground = @Fg2, HorizontalAlignment = Center ]
                    TextBlock [ Text = "W", Style = @UiCaption, Foreground = @Fg2, HorizontalAlignment = Center ]
                    TextBlock [ Text = "T", Style = @UiCaption, Foreground = @Fg2, HorizontalAlignment = Center ]
                    TextBlock [ Text = "F", Style = @UiCaption, Foreground = @Fg2, HorizontalAlignment = Center ]
                    TextBlock [ Text = "S", Style = @UiCaption, Foreground = @Fg2, HorizontalAlignment = Center ]
                }
                // Day cells — built by the control.
                UniformGrid x:name="PART_DayGrid" [ Columns = 7 ]
            }
        }
    }
    Style [TargetType = DatePicker] {
        Template = @DefaultDatePicker;
    }

    // ── TimePicker: M3 analog clock dial ───────────────────────────
    // Digital HH:MM readout (each half a clickable ring-switch) + AM/PM,
    // over a 256dp clock face. The control (time-picker.ts) fills
    // PART_ClockFace with the 12 numbers of the active ring, a hand line,
    // and the centre pivot; the template supplies the surrounding chrome
    // and the readout/AM-PM parts.
    Template x:key="DefaultTimePicker" [TargetType = TimePicker] {
        Border x:name="PART_Root"
            [ Fill      = @Bg1,
              Stroke     = Pen [ Brush = @Border ],
              CornerRadius    = @RadiusLg,
              Padding         = (@Space4,@Space4,@Space4,@Space4) ] {
            StackPanel [ Orientation = Vertical, HorizontalAlignment = Center ] {
                // Digital readout — hour : minute (each a ring-switch) + AM/PM.
                StackPanel [ Orientation = Horizontal, HorizontalAlignment = Center, Margin = (0,0,0,@Space4) ] {
                    ClickableBorder x:name="PART_HourHit"
                        [ Fill = @Bg2, CornerRadius = @RadiusMd, Padding = (@Space3,@Space1,@Space3,@Space1) ] {
                        TextBlock x:name="PART_HourLabel" [ Text = "9", FontSize = 36, Foreground = @Fg1 ]
                    }
                    TextBlock [ Text = ":", FontSize = 36, Foreground = @Fg1, VerticalAlignment = Center, Margin = (@Space1,0,@Space1,0) ]
                    ClickableBorder x:name="PART_MinuteHit"
                        [ Fill = @Bg2, CornerRadius = @RadiusMd, Padding = (@Space3,@Space1,@Space3,@Space1) ] {
                        TextBlock x:name="PART_MinuteLabel" [ Text = "00", FontSize = 36, Foreground = @Fg1 ]
                    }
                    StackPanel [ Orientation = Vertical, Margin = (@Space3,0,0,0), VerticalAlignment = Center ] {
                        ClickableBorder x:name="PART_AmButton"
                            [ CornerRadius = @RadiusMd, Padding = (@Space2,@Space1,@Space2,@Space1) ] {
                            TextBlock [ Text = "AM", Style = @UiLabel, Foreground = @Fg1 ]
                        }
                        ClickableBorder x:name="PART_PmButton"
                            [ CornerRadius = @RadiusMd, Padding = (@Space2,@Space1,@Space2,@Space1) ] {
                            TextBlock [ Text = "PM", Style = @UiLabel, Foreground = @Fg1 ]
                        }
                    }
                }
                // Clock face — a filled circle hosting the Canvas the control
                // paints numbers / hand / pivot onto.
                Border [ Width = 256, Height = 256, CornerRadius = @RadiusPill, Fill = @Bg2 ] {
                    Canvas x:name="PART_ClockFace" [ Width = 256, Height = 256 ]
                }
            }
        }
    }
    Style [TargetType = TimePicker] {
        Template = @DefaultTimePicker;
    }
}
