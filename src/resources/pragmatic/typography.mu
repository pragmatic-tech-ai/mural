// Pragmatic Labs type scale.
//
// Each token is a keyed Style[TargetType=TextBlock] applied via
// `TextBlock [Style = @Body]`. FontFamily binds to the family token for
// the role (@FontSans / @FontMono / @FontSerif); the other atoms bind to
// the per-role @<Role>Weight/Size/LineHeight/Tracking tokens declared in
// pragmatic.mu. The theme lists PragmaticTypography in its dictionaries:
// so these styles resolve when Pragmatic is active — the Material bundle
// never merged its Typography, so @BodySmall and friends resolved to
// nothing there; this bundle fixes that.

resources PragmaticTypography
{
    // ── Display ─────────────────────────────────────────────
    Style x:key="Display1" [TargetType = TextBlock]
    {
        FontFamily = @FontSans;
        FontWeight = @Display1Weight;
        FontSize = @Display1Size;
        LineHeight = @Display1LineHeight;
        LetterSpacing = @Display1Tracking;
    }
    Style x:key="Display2" [TargetType = TextBlock]
    {
        FontFamily = @FontSans;
        FontWeight = @Display2Weight;
        FontSize = @Display2Size;
        LineHeight = @Display2LineHeight;
        LetterSpacing = @Display2Tracking;
    }
    // ── Headings ────────────────────────────────────────────
    Style x:key="H1" [TargetType = TextBlock]
    {
        FontFamily = @FontSans;
        FontWeight = @H1Weight;
        FontSize = @H1Size;
        LineHeight = @H1LineHeight;
        LetterSpacing = @H1Tracking;
    }
    Style x:key="H2" [TargetType = TextBlock]
    {
        FontFamily = @FontSans;
        FontWeight = @H2Weight;
        FontSize = @H2Size;
        LineHeight = @H2LineHeight;
        LetterSpacing = @H2Tracking;
    }
    Style x:key="H3" [TargetType = TextBlock]
    {
        FontFamily = @FontSans;
        FontWeight = @H3Weight;
        FontSize = @H3Size;
        LineHeight = @H3LineHeight;
        LetterSpacing = @H3Tracking;
    }
    Style x:key="H4" [TargetType = TextBlock]
    {
        FontFamily = @FontSans;
        FontWeight = @H4Weight;
        FontSize = @H4Size;
        LineHeight = @H4LineHeight;
        LetterSpacing = @H4Tracking;
    }
    // ── Body ────────────────────────────────────────────────
    Style x:key="Body" [TargetType = TextBlock]
    {
        FontFamily = @FontSans;
        FontWeight = @BodyWeight;
        FontSize = @BodySize;
        LineHeight = @BodyLineHeight;
        LetterSpacing = @BodyTracking;
    }
    Style x:key="BodySm" [TargetType = TextBlock]
    {
        FontFamily = @FontSans;
        FontWeight = @BodySmWeight;
        FontSize = @BodySmSize;
        LineHeight = @BodySmLineHeight;
        LetterSpacing = @BodySmTracking;
    }
    Style x:key="BodySerif" [TargetType = TextBlock]
    {
        FontFamily = @FontSerif;
        FontWeight = @BodySerifWeight;
        FontSize = @BodySerifSize;
        LineHeight = @BodySerifLineHeight;
        LetterSpacing = @BodySerifTracking;
    }
    // ── UI ──────────────────────────────────────────────────
    Style x:key="UiLabel" [TargetType = TextBlock]
    {
        FontFamily = @FontSans;
        FontWeight = @UiLabelWeight;
        FontSize = @UiLabelSize;
        LineHeight = @UiLabelLineHeight;
        LetterSpacing = @UiLabelTracking;
    }
    Style x:key="UiLabelSm" [TargetType = TextBlock]
    {
        FontFamily = @FontSans;
        FontWeight = @UiLabelSmWeight;
        FontSize = @UiLabelSmSize;
        LineHeight = @UiLabelSmLineHeight;
        LetterSpacing = @UiLabelSmTracking;
    }
    Style x:key="UiCaption" [TargetType = TextBlock]
    {
        FontFamily = @FontSans;
        FontWeight = @UiCaptionWeight;
        FontSize = @UiCaptionSize;
        LineHeight = @UiCaptionLineHeight;
        LetterSpacing = @UiCaptionTracking;
    }
    // ── Mono ────────────────────────────────────────────────
    Style x:key="Code" [TargetType = TextBlock]
    {
        FontFamily = @FontMono;
        FontWeight = @CodeWeight;
        FontSize = @CodeSize;
        LineHeight = @CodeLineHeight;
        LetterSpacing = @CodeTracking;
    }
    Style x:key="Label" [TargetType = TextBlock]
    {
        FontFamily = @FontMono;
        FontWeight = @LabelWeight;
        FontSize = @LabelSize;
        LineHeight = @LabelLineHeight;
        LetterSpacing = @LabelTracking;
    }
}
