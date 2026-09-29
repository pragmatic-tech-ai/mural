// Pragmatic theme — Tooltip (Wave 3).
//
// Inverse surface: @BgInverse backdrop with @FgInverse ink so it stays
// legible over any host surface (the M3 inverse-tooltip convention, kept).
// @RadiusMd chip, @ShadowMd float. The control Style pins Foreground =
// @FgInverse + the @BodySm type atoms so a bare-string Content (wrapped in
// an unstyled TextBlock by ContentPresenter) renders legibly at tooltip
// metrics. A CommandBase Content resolves the rich template below.
//
// Pragmatic tokens only. This IS the framework's default template,
// composed into MuralFramework via framework.resources.mu.

resources Tooltips
{
    Template x:key="DefaultTooltip" [TargetType = Tooltip]
    {
        Border
            [ Fill = @BgInverse,
              CornerRadius = @RadiusMd,
              Padding = (@Space2,@Space1,@Space2,@Space1),
              MinHeight = 24,
              MaxWidth = 320,
              Effect = @ShadowMd ]
        {
            StackPanel [ Orientation = Vertical ]
            {
                ContentPresenter
                TextBlock x:name="PART_Shortcut"
                    [ Style = @UiCaption,
                      Text = $Shortcut,
                      Foreground = @FgInverse,
                      Opacity = 0.7,
                      Margin = (0,2,0,0) ]
            }
        }
        when ( Shortcut = "" ) { PART_Shortcut.Visibility = Collapsed; }
    }

    Style [TargetType = Tooltip]
    {
        Template = @DefaultTooltip;
        Visibility = Collapsed;
        Foreground = @FgInverse;
        FontFamily = @FontSans;
        FontWeight = @BodySmWeight;
        FontSize = @BodySmSize;
        LineHeight = @BodySmLineHeight;
        LetterSpacing = @BodySmTracking;
        MeasurementFidelity = Exact;
    }

    // Rich CommandBase content — @UiLabel subhead over @BodySm paragraph.
    DataTemplate [DataType = CommandBase]
    {
        StackPanel [ Orientation = Vertical ]
        {
            TextBlock
                [ Style = @UiLabel,
                  Text = $Text,
                  Foreground = @FgInverse,
                  TextWrapping = Wrap ]
            TextBlock
                [ Style = @BodySm,
                  Text = $Description,
                  Foreground = @FgInverse,
                  TextWrapping = Wrap,
                  Opacity = 0.7,
                  Margin = (0,2,0,0) ]
        }
    }
}
