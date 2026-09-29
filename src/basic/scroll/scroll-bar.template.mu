// Pragmatic theme — ScrollBar chrome (Wave 2).
//
// A flat track with a pill thumb. PART_Track / PART_Thumb are template
// Borders (not the Thumb primitive class), so this template fork restyles
// them directly. The thumb ramps rest @BorderStrong → hover @Fg3 → drag
// @Fg2 (drag declared LAST so it wins over hover). PART_Layout and the
// `when (IsFaded) { PART_Layout.Opacity = 0 }` trigger are preserved
// verbatim so the class-driven auto-hide (ScrollBar.SetRegionActive /
// pulseActivity flipping IsFaded, forwarded by ScrollViewer's region
// hover) keeps working: fade is opacity-only on the layout root, so track
// and thumb vanish without disturbing layout or hit-test geometry.
//
// The cross-axis thickness is pinned by ScrollBar.MeasureOverride
// (SCROLLBAR_THICKNESS), not the template. ScrollViewer is intentionally
// NOT forked — its Material template references no colour tokens; its
// chrome comes entirely from these nested ScrollBars.
//
// Only Pragmatic tokens — no M3 (@SurfaceContainerLow / @OutlineVariant /
// @Outline / @OnSurfaceVariant / @Shape*) token.

resources ScrollBars
{
    Template x:key="DefaultScrollBar" [TargetType = ScrollBar]
    {
        ScrollBarLayout x:name="PART_Layout"
        {
            Border x:name="PART_Track"
                [ Fill = @Bg2,
                  CornerRadius = @RadiusPill ]
            Border x:name="PART_Thumb"
                [ Fill = @BorderStrong,
                  CornerRadius = @RadiusPill ]
        }
        when ( PART_Thumb.IsMouseOver ) { PART_Thumb.Fill = @Fg3; }
        when ( IsDragging ) { PART_Thumb.Fill = @Fg2; }
        when ( IsFaded ) { PART_Layout.Opacity = 0; }
    }
    Style [TargetType = ScrollBar]
    {
        Template = @DefaultScrollBar;
    }
}
