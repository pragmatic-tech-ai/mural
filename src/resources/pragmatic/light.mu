// Pragmatic Labs — Light scheme.
//
// Values projected from dev-kit/design/design-systems/pragmatic/tokens.json
// (the "light" column, aliases resolved). Do not hand-edit values here to
// diverge from the snapshot — the conformance test enforces parity.

scheme PragmaticLight against Pragmatic
{
    // ── Brand ──────────────────────────────────────────────
    @BrandGreen = #2EA862
    @BrandGreenHover = #258A50
    @BrandGreenPress = #1B6B3D
    @BrandGreenSoft = #E2F3E9
    @BrandGreenInk = #1B6B3D
    @ActionPrimary = #22824D
    @ActionPrimaryHover = #1B6B3D
    @ActionPrimaryPress = #155431
    @ControlAccent = #22824D
    // ── Accents ────────────────────────────────────────────
    @AccentCyan = #3AA6B9
    @AccentCyanSoft = #E2F1F4
    @AccentCyanInk = #1D6B79
    @AccentPlum = #7C6BAD
    @AccentPlumSoft = #EEEAF5
    @AccentPlumInk = #5A4A8E
    // ── State ──────────────────────────────────────────────
    @StateSuccess = #4A8E3A
    @StateSuccessSoft = #E8F2E2
    @StateSuccessInk = #2F6B22
    @StateWarning = #C68A0E
    @StateWarningSoft = #FBF1D8
    @StateWarningInk = #8B6308
    @StateDanger = #C24532
    @StateDangerSoft = #FBE4DF
    @StateDangerInk = #A63526
    @StateInfo = #3AA6B9
    @StateInfoSoft = #E2F1F4
    // ── Surfaces ───────────────────────────────────────────
    @Bg0 = #FAFAF9
    @Bg1 = #FFFFFF
    @Bg2 = #F4F4F2
    @Bg3 = #E9E8E4
    @BgInverse = #0A0A0B
    // ── Text / icon ────────────────────────────────────────
    @Fg0 = #0A0A0B
    @Fg1 = #22211E
    @Fg2 = #5F5C56
    @Fg3 = #726F68
    @FgDisabled = #B5B3AC
    @FgOnAccent = #FFFFFF
    @FgInverse = #FAFAF9
    // ── Lines ──────────────────────────────────────────────
    @Border = #E9E8E4
    @BorderStrong = #D6D5D0
    @BorderFocus = #22824D
    // ── Selection / canvas ─────────────────────────────────
    @SurfaceSelected = #E2F3E9
    @CanvasBg = #F4F4F1
    @CanvasGridDot = #D6D5D0
    @SelectionMarqueeFill = #2EA86214
    @SelectionMarqueeStroke = #258A50
    @TextSelectionBg = #C3E6D1
    @TextSelectionFg = #0A0A0B
    @Scrim = #0A0A0B66
    // ── Spacing ────────────────────────────────────────────
    @Space1 = 4
    @Space2 = 8
    @Space3 = 12
    @Space4 = 16
    @Space5 = 24
    @Space6 = 32
    @Space7 = 48
    @Space8 = 64
    @Space9 = 96
    @Space10 = 128
    // ── Radius ─────────────────────────────────────────────
    @RadiusNone = 0
    @RadiusXs = 2
    @RadiusSm = 4
    @RadiusMd = 6
    @RadiusLg = 10
    @RadiusXl = 14
    @RadiusPill = CornerRadius.Full
    // ── Sizing ─────────────────────────────────────────────
    @ControlHDense = 28
    @ControlHCompact = 32
    @ControlHDefault = 36
    @ControlHTouch = 44
    @RowHDense = 24
    @RowHCompact = 28
    @RowHDefault = 32
    @RowHTouch = 40
    // ── Density step ───────────────────────────────────────
    @DensityTouch = 8
    @DensityComfortable = 0
    @DensityCompact = -4
    @DensityDense = -8
    // ── Motion / opacity / focus ───────────────────────────
    @DurationFast = 120
    @DurationMedium = 200
    @DurationSlow = 320
    @OpacityDisabled = 0.5
    @FocusRingWidth = 2
    @FocusRingOffset = 2
    @EasingStandard = Easings.Standard
    @EasingInout = Easings.Inout
    // ── Fonts ──────────────────────────────────────────────
    @FontSans = "\"Inter Tight\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", Helvetica, Arial, sans-serif"
    @FontMono = "\"JetBrains Mono\", ui-monospace, \"SF Mono\", Menlo, Consolas, monospace"
    @FontSerif = "\"Source Serif 4\", \"Iowan Old Style\", \"Charter\", Georgia, serif"
    @WeightRegular = FontWeight.Normal
    @WeightMedium = FontWeight.Medium
    @WeightSemibold = FontWeight.SemiBold
    @WeightBold = FontWeight.Bold
    // ── Type scale ─────────────────────────────────────────
    @Display1Weight = FontWeight.SemiBold   @Display1Size = 80   @Display1LineHeight = 92   @Display1Tracking = -1.6
    @Display2Weight = FontWeight.SemiBold   @Display2Size = 60   @Display2LineHeight = 69   @Display2Tracking = -1.2
    @H1Weight = FontWeight.SemiBold   @H1Size = 44   @H1LineHeight = 51   @H1Tracking = -0.88
    @H2Weight = FontWeight.SemiBold   @H2Size = 32   @H2LineHeight = 42   @H2Tracking = -0.32
    @H3Weight = FontWeight.SemiBold   @H3Size = 24   @H3LineHeight = 31   @H3Tracking = -0.24
    @H4Weight = FontWeight.SemiBold   @H4Size = 17   @H4LineHeight = 22   @H4Tracking = 0
    @BodyWeight = FontWeight.Normal   @BodySize = 15   @BodyLineHeight = 23   @BodyTracking = 0
    @BodySmWeight = FontWeight.Normal   @BodySmSize = 13   @BodySmLineHeight = 20   @BodySmTracking = 0
    @BodySerifWeight = FontWeight.Normal   @BodySerifSize = 17   @BodySerifLineHeight = 29   @BodySerifTracking = 0
    @UiLabelWeight = FontWeight.Medium   @UiLabelSize = 14   @UiLabelLineHeight = 20   @UiLabelTracking = 0
    @UiLabelSmWeight = FontWeight.Normal   @UiLabelSmSize = 13   @UiLabelSmLineHeight = 18   @UiLabelSmTracking = 0
    @UiCaptionWeight = FontWeight.Normal   @UiCaptionSize = 12   @UiCaptionLineHeight = 16   @UiCaptionTracking = 0
    @CodeWeight = FontWeight.Normal   @CodeSize = 13   @CodeLineHeight = 20   @CodeTracking = 0
    @LabelWeight = FontWeight.Medium   @LabelSize = 12   @LabelLineHeight = 16   @LabelTracking = 1.2
    // ── Shadows ────────────────────────────────────────────
    @ShadowSm = PragmaticShadowEffect [Level = "sm"]
    @ShadowMd = PragmaticShadowEffect [Level = "md"]
    @ShadowLg = PragmaticShadowEffect [Level = "lg"]
}
