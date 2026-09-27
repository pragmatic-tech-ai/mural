// Pragmatic theme — SegmentedButton chrome (Wave 2).
//
// Shell = one rounded outline (PART_GroupBorder, @BorderStrong 1dp,
// @RadiusMd, ClipToBounds so each square segment fill is clipped to the
// rounded silhouette). Each segment lays out as [ divider | fill ]:
// PART_Divider (a 1dp @Border vertical rule, the shared boundary with the
// previous segment, collapsed on the first segment) and PART_Border (the
// segment fill + content). Selection uses a dedicated opaque PART_Selected
// layer (@SurfaceSelected) that wins over the @Bg2 hover on PART_Border by
// z-order — the Wave-2 selected-over-hover pattern (the trigger system is
// last-event-wins, so a shared-element selected fill would be erased by a
// concurrent hover). Selected ink flips to @BrandGreenInk. Focus strokes
// PART_Border (its Stroke is otherwise free). Density adapts segment
// MinHeight via @ControlH*.
//
// Only Pragmatic tokens — no M3 (@Outline / @Surface / @SecondaryContainer /
// @State*Overlay / @Shape* / @Label*) token.

resources PragmaticSegmentedButton
{
    Template x:key="DefaultSegmentedButton" [TargetType = SegmentedButton]
    {
        Border x:name="PART_GroupBorder"
            [ Fill = #00000000,
              Stroke = Pen [ Brush = @BorderStrong, Thickness = 1 ],
              CornerRadius = @RadiusMd,
              ClipToBounds = true ]
        {
            ItemsPresenter
        }
    }
    ItemsPanelTemplate x:key="DefaultSegmentedButtonPanel"
    {
        StackPanel [ Orientation = Horizontal ]
    }
    Style [TargetType = SegmentedButton]
    {
        Template = @DefaultSegmentedButton;
        ItemsPanel = @DefaultSegmentedButtonPanel;
    }

    Template x:key="DefaultSegmentedItem" [TargetType = SegmentedItem]
    {
        StackPanel [ Orientation = Horizontal ]
        {
            Line x:name="PART_Divider"
                [ Orientation = Vertical,
                  Stroke = Pen [ Brush = @Border, Thickness = 1 ] ]
            Border x:name="PART_Border"
                [ Fill = @Bg1,
                  MinHeight = @ControlHDefault ]
            {
                // PART_Selected carries the segment Padding (NOT PART_Border) so
                // its @SurfaceSelected fill spans the full segment (no gaps to
                // the dividers) and covers the @Bg2 hover fill.
                Border x:name="PART_Selected"
                    [ Fill = #00000000,
                      Padding = (@Space3,@Space1,@Space3,@Space1) ]
                {
                    ContentPresenter [ VerticalAlignment = Center, HorizontalAlignment = Center ]
                }
            }
        }
        when ( Position = Single ) { PART_Divider.Visibility = Collapsed; }
        when ( Position = Start ) { PART_Divider.Visibility = Collapsed; }
        when ( IsSelected ) { PART_Selected.Fill = @SurfaceSelected; }
        when ( IsMouseOver ) { PART_Border.Fill = @Bg2; }
        when ( IsFocused ) { PART_Border.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
        when ( IsEnabled = false ) { PART_Border.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Density = Compact ) { PART_Border.MinHeight = @ControlHCompact; }
        when ( ThemeManager.Pointer = Coarse ) { PART_Border.MinHeight = @ControlHTouch; }
    }
    Style [TargetType = SegmentedItem]
    {
        Template = @DefaultSegmentedItem;
        Foreground = @Fg1;
        FontFamily = @FontSans;
        FontWeight = @UiLabelWeight;
        FontSize = @UiLabelSize;
        LineHeight = @UiLabelLineHeight;
        LetterSpacing = @UiLabelTracking;
        MeasurementFidelity = Exact;
        when ( IsSelected ) { Foreground = @BrandGreenInk; }
    }
}
