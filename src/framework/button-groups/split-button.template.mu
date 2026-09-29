// Pragmatic theme — SplitButton (Wave 3).
//
// Primary action + chevron menu trigger sharing one accent capsule. Both
// halves fill @ActionPrimary and ramp @ActionPrimaryHover / @ActionPrimaryPress
// per element-scoped state triggers (FAB precedent — no translucent overlays).
// The seam between halves is a 1dp @ActionPrimaryPress hairline (a darker
// accent reads as a divider). Chevron ink @FgOnAccent. Left half rounds
// @RadiusMd on the left, right half on the right. Popup = canonical Pragmatic
// popover. Disabled dims BOTH halves.
//
// SegmentedButton is forked separately (segmented-button.template.mu).
// Pragmatic tokens only (+ shared geometry @ChevronDown). Merged via
// PragmaticControls.

resources SplitButtons
{
    Template x:key="DefaultSplitButton" [TargetType = SplitButton]
    {
        StackPanel [ Orientation = Horizontal ]
        {
            Border x:name="PART_PrimaryButton"
                [ Fill = @ActionPrimary,
                  CornerRadius = (@RadiusMd,0,0,@RadiusMd),
                  Padding = (@Space4,@Space2,@Space4,@Space2) ]
            {
                ContentPresenter [ HorizontalAlignment = Center, VerticalAlignment = Center ]
            }
            Line [ Orientation = Vertical, Stroke = Pen [ Brush = @ActionPrimaryPress, Thickness = 1 ] ]
            Border x:name="PART_TriggerButton"
                [ Fill = @ActionPrimary,
                  CornerRadius = (0,@RadiusMd,@RadiusMd,0),
                  Padding = (@Space2,@Space2,@Space2,@Space2) ]
            {
                Shape
                    [ Geometry = @ChevronDown,
                      Fill = @FgOnAccent,
                      Width = 14,
                      Height = 14,
                      HorizontalAlignment = Center,
                      VerticalAlignment = Center ]
            }
        }
        when ( PART_PrimaryButton.IsMouseOver ) { PART_PrimaryButton.Fill = @ActionPrimaryHover; }
        when ( PART_PrimaryButton.IsPressed ) { PART_PrimaryButton.Fill = @ActionPrimaryPress; }
        when ( PART_TriggerButton.IsMouseOver ) { PART_TriggerButton.Fill = @ActionPrimaryHover; }
        when ( PART_TriggerButton.IsPressed ) { PART_TriggerButton.Fill = @ActionPrimaryPress; }
        when ( IsEnabled = false )
        {
            PART_PrimaryButton.Opacity = @OpacityDisabled;
            PART_TriggerButton.Opacity = @OpacityDisabled;
        }
        when ( ThemeManager.Density = Compact )
        {
            PART_PrimaryButton.Padding = (@Space3,@Space1,@Space3,@Space1);
            PART_TriggerButton.Padding = (@Space1,@Space1,@Space1,@Space1);
        }
        when ( ThemeManager.Density = Comfortable )
        {
            PART_PrimaryButton.Padding = (@Space5,@Space3,@Space5,@Space3);
            PART_TriggerButton.Padding = (@Space3,@Space3,@Space3,@Space3);
        }
        when ( ThemeManager.Pointer = Coarse )
        {
            PART_PrimaryButton.Padding = (@Space4,@Space3,@Space4,@Space3);
            PART_TriggerButton.Padding = (@Space2,@Space3,@Space2,@Space3);
        }
    }
    Template x:key="DefaultSplitButtonPopup" [TargetType = SplitButton]
    {
        MenuPopupHost x:name="PART_PopupHost"
        {
            ClickAwayScrim x:name="PART_Scrim"
            Border x:name="PART_PopupBody"
                [ Fill = @Bg1,
                  Stroke = Pen [ Brush = @Border, Thickness = 1 ],
                  CornerRadius = @RadiusLg,
                  Effect = @ShadowMd,
                  Padding = (@Space1,@Space1,@Space1,@Space1) ]
        }
    }
    Style [TargetType = SplitButton]
    {
        Template = @DefaultSplitButton;
        PopupTemplate = @DefaultSplitButtonPopup;
        Foreground = @FgOnAccent;
        FontFamily = @FontSans;
        FontWeight = @UiLabelWeight;
        FontSize = @UiLabelSize;
        LineHeight = @UiLabelLineHeight;
        LetterSpacing = @UiLabelTracking;
        MeasurementFidelity = Exact;
    }
}
