// Pragmatic theme — notifications family (Wave 3).
//
// ProgressIndicator (Linear + Circular) + LoadingIndicator: @Bg2 track,
// @ControlAccent fill/arc. The Circular + Loading animations are TS-driven
// (progress-indicator.ts sweeps PART_Fill's EndAngle; loading-indicator.ts
// spins a RotateTransform onto PART_Fill), so PART names + Arc/Border types
// are preserved verbatim. Banner + Snackbar are appended in later Wave-3
// tasks. Pragmatic tokens only. Merged via PragmaticControls.

resources PragmaticNotifications
{
    // ── ProgressIndicator: Linear ────────────────────────────────────
    Template x:key="DefaultLinearProgressIndicator" [TargetType = ProgressIndicator]
    {
        Border x:name="PART_Track"
            [ Fill = @Bg2,
              CornerRadius = 2,
              ClipToBounds = true,
              Height = 4 ]
        {
            Border x:name="PART_Fill"
                [ Fill = @ControlAccent,
                  CornerRadius = 2,
                  HorizontalAlignment = Left,
                  Height = 4 ]
        }
        when ( IsEnabled = false ) { PART_Track.Opacity = @OpacityDisabled; }
    }

    // Circular Arc pens — Brush resolves through DynamicResource so a theme
    // switch re-tints the pens.
    Pen x:key="ProgressTrackPen" [ Brush = @Bg2, Thickness = 4 ]
    Pen x:key="ProgressFillPen" [ Brush = @ControlAccent, Thickness = 4 ]

    Template x:key="DefaultCircularProgressIndicator" [TargetType = ProgressIndicator]
    {
        Border x:name="PART_OuterFrame"
            [ Fill = #00000000,
              Width = 40,
              Height = 40 ]
        {
            Arc x:name="PART_Track"
                [ StartAngle = -90,
                  EndAngle = 270,
                  Stroke = @ProgressTrackPen,
                  Width = 40,
                  Height = 40 ]
            Arc x:name="PART_Fill"
                [ StartAngle = -90,
                  EndAngle = 270,
                  Stroke = @ProgressFillPen,
                  Width = 40,
                  Height = 40 ]
        }
        when ( IsEnabled = false ) { PART_OuterFrame.Opacity = @OpacityDisabled; }
    }
    Style [TargetType = ProgressIndicator]
    {
        Template = @DefaultLinearProgressIndicator;
        when ( Variant = Circular ) { Template = @DefaultCircularProgressIndicator; }
    }

    // ── LoadingIndicator: indeterminate spinner ──────────────────────
    Pen x:key="LoadingActivePen" [ Brush = @ControlAccent, Thickness = 4 ]

    Template x:key="DefaultLoadingIndicator" [TargetType = LoadingIndicator]
    {
        Border x:name="PART_Container"
            [ Width = 48,
              Height = 48,
              Fill = #00000000,
              CornerRadius = @RadiusPill,
              HorizontalAlignment = Center,
              VerticalAlignment = Center ]
        {
            Arc x:name="PART_Fill"
                [ StartAngle = -90,
                  EndAngle = -50,
                  Stroke = @LoadingActivePen,
                  Width = 40,
                  Height = 40,
                  HorizontalAlignment = Center,
                  VerticalAlignment = Center ]
        }
        when ( Variant = Contained ) { PART_Container.Fill = @Bg2; }
        when ( IsEnabled = false ) { PART_Container.Opacity = @OpacityDisabled; }
    }
    Style [TargetType = LoadingIndicator]
    {
        Template = @DefaultLoadingIndicator;
    }
}
