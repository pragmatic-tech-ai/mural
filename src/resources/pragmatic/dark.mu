// Pragmatic Labs — Dark scheme.
//
// Values projected from dev-kit/design/design-systems/pragmatic/tokens.json
// (the "dark" column, aliases resolved; tokens with only a light value
// carry that value here too). Non-colour tokens match the Light scheme.
// The conformance test enforces parity with the snapshot.

scheme PragmaticDark against Pragmatic
{
    // ── Brand ──────────────────────────────────────────────
    @BrandGreen = #2EA862
    @BrandGreenHover = #258A50
    @BrandGreenPress = #1B6B3D
    @BrandGreenSoft = #0F2A1A
    @BrandGreenInk = #2EA862
    @ActionPrimary = #22824D
    @ActionPrimaryHover = #1B6B3D
    @ActionPrimaryPress = #155431
    @ControlAccent = #2EA862
    // ── Accents ────────────────────────────────────────────
    @AccentCyan = #3AA6B9
    @AccentCyanSoft = #143036
    @AccentCyanInk = #6CC7D8
    @AccentPlum = #7C6BAD
    @AccentPlumSoft = #1F1A2E
    @AccentPlumInk = #AC9EDB
    // ── State ──────────────────────────────────────────────
    @StateSuccess = #4A8E3A
    @StateSuccessSoft = #1B2E16
    @StateSuccessInk = #7CC46B
    @StateWarning = #C68A0E
    @StateWarningSoft = #3A2C0A
    @StateWarningInk = #E3B04B
    @StateDanger = #C24532
    @StateDangerSoft = #3A1B14
    @StateDangerInk = #F28B78
    @StateInfo = #3AA6B9
    @StateInfoSoft = #143036
    // ── Surfaces ───────────────────────────────────────────
    @Bg0 = #0A0A0B
    @Bg1 = #141312
    @Bg2 = #22211E
    @Bg3 = #3D3B36
    @BgInverse = #FAFAF9
    // ── Text / icon ────────────────────────────────────────
    @Fg0 = #F5F5F2
    @Fg1 = #E8E7E2
    @Fg2 = #B5B3AC
    @Fg3 = #8F8C85
    @FgDisabled = #5F5C56
    @FgOnAccent = #FFFFFF
    @FgInverse = #0A0A0B
    // ── Lines ──────────────────────────────────────────────
    @Border = #2A2925
    @BorderStrong = #3D3B36
    @BorderFocus = #2EA862
    // ── Selection / canvas ─────────────────────────────────
    @SurfaceSelected = #0F2A1A
    @CanvasBg = #111112
    @CanvasGridDot = #2E2D29
    @SelectionMarqueeFill = #2EA86224
    @SelectionMarqueeStroke = #2EA862
    @TextSelectionBg = #1E5A37
    @TextSelectionFg = #F5F5F2
    @Scrim = #00000099
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
    @ShadowSm = PragmaticShadowEffect [Level = "sm", Dark = true]
    @ShadowMd = PragmaticShadowEffect [Level = "md", Dark = true]
    @ShadowLg = PragmaticShadowEffect [Level = "lg", Dark = true]
    // ── Semantic aliases (Theme.* bridge — see basic/theme.ts) ──────
    // Theme-agnostic keys the imperative Theme.* helper resolves so it
    // doesn't hardcode Material token names. Value is a literal copy of
    // this scheme's own backing token — kept in sync by
    // src/basic/tests/theme.test.ts, not by a live reference (no
    // intra-scheme aliasing syntax exists in this file format).
    @Ink = #E8E7E2        // = @Fg1
    @AccentInk = #2EA862  // = @ControlAccent
    @AccentInkOn = #FFFFFF  // white-on-accent (selected calendar/time cell text)
    // Scroll/splitter chrome bridge (see thumb.ts / splitter.ts).
    @ControlTrack = #3D3B36   // = @BorderStrong
    @ControlActive = #2EA862  // = @ControlAccent
    // Wave 5: theme-agnostic aliases (see light.mu).
    @RowHoverFill = #26382B   // brand-green-tinted row hover (reads on @Bg2 panes)
    @InkVariant = #B5B3AC     // = @Fg2
    @SurfaceBg = #141312      // = @Bg1
}
