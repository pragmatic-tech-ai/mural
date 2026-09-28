// Material 3 dark-mode token palette.
//
// Mirror of light.mu — same keys, dark-scheme values. See light.mu for
// the rationale on token names and brush identity. Swapping this
// dictionary in for the light one via Material.SetTheme('dark')
// flips every dependent template through the `@key` DynamicResource
// bindings.

scheme MaterialDark against Material {
    // ── Primary tier ────────────────────────────────────────────────
    @Primary = #D0BCFF
    @OnPrimary = #381E72
    @PrimaryContainer = #4F378B
    @OnPrimaryContainer = #EADDFF
    // Precomputed Primary + OnPrimary state layers (8% / 12%) —
    // see light.mu Primary block for the rationale.
    @PrimaryHover = #C4AFF4
    @PrimaryPress = #BEA9EE

    // ── Secondary tier ──────────────────────────────────────────────
    @Secondary = #CCC2DC
    @OnSecondary = #332D41
    @SecondaryContainer = #4A4458
    @OnSecondaryContainer = #E8DEF8

    // ── Tertiary tier ───────────────────────────────────────────────
    @Tertiary = #EFB8C8
    @OnTertiary = #492532
    @TertiaryContainer = #633B48
    @OnTertiaryContainer = #FFD8E4

    // ── Error tier ──────────────────────────────────────────────────
    @Error = #F2B8B5
    @OnError = #601410
    @ErrorContainer = #8C1D18
    @OnErrorContainer = #F9DEDC

    // ── Background / Surface ────────────────────────────────────────
    @Background = #1C1B1F
    @OnBackground = #E6E1E5
    @Surface = #1C1B1F
    @OnSurface = #E6E1E5
    @SurfaceVariant = #49454F
    @OnSurfaceVariant = #CAC4D0
    // Diagram drawing surface — a soft dark, one step lighter than @Surface
    // (#1C1B1F) so the ruler strips frame the canvas rather than merge with it.
    @DiagramCanvas = #2A2A2E

    // ── M3 Surface containers (elevation tinting) ───────────────────
    @SurfaceContainerLowest = #0F0D13
    @SurfaceContainerLow = #1D1B20
    @SurfaceContainer = #211F26
    @SurfaceContainerHigh = #2B2930
    @SurfaceContainerHighest = #36343B

    // ── Outline / dividers ──────────────────────────────────────────
    @Outline = #938F99
    @OutlineVariant = #49454F

    // ── Inverse / dark-on-light overlays ────────────────────────────
    @InverseSurface = #E6E1E5
    @InverseOnSurface = #313033
    @InversePrimary = #6750A4

    // ── Surface tint (M3 elevation tinting) ─────────────────────────
    // Dark-mode tint is the dark-scheme Primary so elevated surfaces
    // read brand-tinted against the dark surface.
    @SurfaceTint = #D0BCFF

    // ── Scrim / shadow tint ─────────────────────────────────────────
    // See light.mu for the @Scrim contract — 50% black for now.
    @Scrim = #00000080
    @Shadow = #000000

    // ── State-layer overlay colours ─────────────────────────────────
    // Dark scheme uses OnSurface (light ink) over the surface, same
    // opacities as light.
    @StateHoverOverlay = #E6E1E514 // OnSurface @ 8%
    @StateFocusOverlay = #E6E1E51F // OnSurface @ 12%
    @StatePressOverlay = #E6E1E51F // OnSurface @ 12%

    // ── State-layer raw opacities (identical across schemes) ────────
    @StateHoverOpacity = 0.08
    @StateFocusOpacity = 0.12
    @StatePressOpacity = 0.12
    @StateDragOpacity = 0.16

    // ── Per-ink-role state-layer brushes (M3 strict overlay path) ───
    // Dark-scheme ink colours per role; same alpha values as light.
    @OnPrimaryHoverLayer = #381E7214 // OnPrimary  @ 8%
    @OnPrimaryPressLayer = #381E721F // OnPrimary  @ 12%
    @PrimaryHoverLayer = #D0BCFF14 // Primary    @ 8%
    @PrimaryPressLayer = #D0BCFF1F // Primary    @ 12%
    @OnSecondaryContainerHoverLayer = #E8DEF814 // OnSecondaryContainer @ 8%
    @OnSecondaryContainerPressLayer = #E8DEF81F // OnSecondaryContainer @ 12%
    @OnSurfaceVariantHoverLayer = #CAC4D014 // OnSurfaceVariant @ 8%
    @OnSurfaceVariantPressLayer = #CAC4D01F // OnSurfaceVariant @ 12%
    @OnPrimaryContainerHoverLayer = #EADDFF14 // OnPrimaryContainer @ 8%
    @OnPrimaryContainerPressLayer = #EADDFF1F // OnPrimaryContainer @ 12%

    // ── Spacing scale (identical across schemes — see material.mu) ──
    @Spacing0 = 0
    @Spacing1 = 4
    @Spacing2 = 8
    @Spacing3 = 12
    @Spacing4 = 16
    @Spacing5 = 20
    @Spacing6 = 24
    @Spacing7 = 28
    @Spacing8 = 32

    // ── List row heights (identical across schemes) ─────────────────
    @ListRowHeightCompact = 28
    @ListRowHeightRegular = 32
    @ListRowHeightComfortable = 40
    @ListRowHeightTouch = 48
    @ListRowHeightTwoLine = 64
    @ListRowHeightThreeLine = 88

    // ── Disabled state opacities (identical across schemes) ─────────
    @DisabledContainerOpacity = 0.12
    @DisabledContentOpacity = 0.38

    // ── Shape (corner radii — identical across schemes) ─────────────
    // See light.mu for the @ShapeFull contract.
    @ShapeNone = 0
    @ShapeExtraSmall = 4
    @ShapeSmall = 8
    @ShapeMedium = 12
    @ShapeLarge = 16
    @ShapeExtraLarge = 28
    @ShapeFull = CornerRadius.Full

    // ── Typography family (identical across schemes) ────────────────
    @FontFamily = "system-ui, sans-serif"
    @TypefaceBrand = "system-ui, sans-serif"
    @TypefacePlain = "system-ui, sans-serif"
    @TypefaceWeightRegular = FontWeight.Normal
    @TypefaceWeightMedium = FontWeight.Medium
    @TypefaceWeightBold = FontWeight.Bold

    // ── Typography type-scale atoms (identical across schemes) ──────
    @DisplayLargeFont = "system-ui, sans-serif"
    @DisplayLargeWeight = FontWeight.Normal
    @DisplayLargeSize = 57
    @DisplayLargeLineHeight = 64
    @DisplayLargeTracking = -0.25

    @DisplayMediumFont = "system-ui, sans-serif"
    @DisplayMediumWeight = FontWeight.Normal
    @DisplayMediumSize = 45
    @DisplayMediumLineHeight = 52
    @DisplayMediumTracking = 0

    @DisplaySmallFont = "system-ui, sans-serif"
    @DisplaySmallWeight = FontWeight.Normal
    @DisplaySmallSize = 36
    @DisplaySmallLineHeight = 44
    @DisplaySmallTracking = 0

    @HeadlineLargeFont = "system-ui, sans-serif"
    @HeadlineLargeWeight = FontWeight.Normal
    @HeadlineLargeSize = 32
    @HeadlineLargeLineHeight = 40
    @HeadlineLargeTracking = 0

    @HeadlineMediumFont = "system-ui, sans-serif"
    @HeadlineMediumWeight = FontWeight.Normal
    @HeadlineMediumSize = 28
    @HeadlineMediumLineHeight = 36
    @HeadlineMediumTracking = 0

    @HeadlineSmallFont = "system-ui, sans-serif"
    @HeadlineSmallWeight = FontWeight.Normal
    @HeadlineSmallSize = 24
    @HeadlineSmallLineHeight = 32
    @HeadlineSmallTracking = 0

    @TitleLargeFont = "system-ui, sans-serif"
    @TitleLargeWeight = FontWeight.Normal
    @TitleLargeSize = 22
    @TitleLargeLineHeight = 28
    @TitleLargeTracking = 0

    @TitleMediumFont = "system-ui, sans-serif"
    @TitleMediumWeight = FontWeight.Medium
    @TitleMediumSize = 16
    @TitleMediumLineHeight = 24
    @TitleMediumTracking = 0.15

    @TitleSmallFont = "system-ui, sans-serif"
    @TitleSmallWeight = FontWeight.Medium
    @TitleSmallSize = 14
    @TitleSmallLineHeight = 20
    @TitleSmallTracking = 0.1

    @BodyLargeFont = "system-ui, sans-serif"
    @BodyLargeWeight = FontWeight.Normal
    @BodyLargeSize = 16
    @BodyLargeLineHeight = 24
    @BodyLargeTracking = 0.5

    @BodyMediumFont = "system-ui, sans-serif"
    @BodyMediumWeight = FontWeight.Normal
    @BodyMediumSize = 14
    @BodyMediumLineHeight = 20
    @BodyMediumTracking = 0.25

    @BodySmallFont = "system-ui, sans-serif"
    @BodySmallWeight = FontWeight.Normal
    @BodySmallSize = 12
    @BodySmallLineHeight = 16
    @BodySmallTracking = 0.4

    @LabelLargeFont = "system-ui, sans-serif"
    @LabelLargeWeight = FontWeight.Medium
    @LabelLargeSize = 14
    @LabelLargeLineHeight = 20
    @LabelLargeTracking = 0.1

    @LabelMediumFont = "system-ui, sans-serif"
    @LabelMediumWeight = FontWeight.Medium
    @LabelMediumSize = 12
    @LabelMediumLineHeight = 16
    @LabelMediumTracking = 0.5

    @LabelSmallFont = "system-ui, sans-serif"
    @LabelSmallWeight = FontWeight.Medium
    @LabelSmallSize = 11
    @LabelSmallLineHeight = 16
    @LabelSmallTracking = 0.5

    // ── Selection / marquee colors ──────────────────────────────────
    // See light.mu for the consumer wiring. Dark-mode keeps the same
    // M3 cyan accent for now; can specialise later if M3 publishes a
    // dark-specific accent for marquee tooling.
    @MarqueeFill = #3699cc33
    @MarqueeStroke = #3699cc
    // Text-input selection highlight — same cyan accent, stronger alpha in
    // dark mode so light foreground text stays legible over the fill.
    // Consumed via `SelectionBrush = @TextSelectionBrush`.
    @TextSelectionBrush = #3699cc99

    // ── Elevation (M3 dual-shadow ramp) ─────────────────────────────
    // Mirror light.mu — M3 elevation ramps don't vary by scheme.
    @ElevationLevel0 = MaterialElevationEffect [Level = 0]
    @ElevationLevel1 = MaterialElevationEffect [Level = 1]
    @ElevationLevel2 = MaterialElevationEffect [Level = 2]
    @ElevationLevel3 = MaterialElevationEffect [Level = 3]
    @ElevationLevel4 = MaterialElevationEffect [Level = 4]
    @ElevationLevel5 = MaterialElevationEffect [Level = 5]
    // Legacy aliases — see light.mu.
    @Elevation1 = MaterialElevationEffect [Level = 1]
    @Elevation2 = MaterialElevationEffect [Level = 2]
    @Elevation3 = MaterialElevationEffect [Level = 3]
    @Elevation4 = MaterialElevationEffect [Level = 4]
    @Elevation5 = MaterialElevationEffect [Level = 5]

    // ── Motion durations (identical across schemes) ─────────────────
    @MotionDuration50 = 50
    @MotionDuration100 = 100
    @MotionDuration150 = 150
    @MotionDuration200 = 200
    @MotionDuration250 = 250
    @MotionDuration300 = 300
    @MotionDuration350 = 350
    @MotionDuration400 = 400
    @MotionDuration450 = 450
    @MotionDuration500 = 500
    @MotionDuration550 = 550
    @MotionDuration600 = 600
    @MotionDuration700 = 700
    @MotionDuration800 = 800
    @MotionDuration900 = 900
    @MotionDuration1000 = 1000

    // ── Motion easings (identical across schemes) ───────────────────
    @MotionEasingLinear = Easings.Linear
    @MotionEasingStandard = Easings.Standard
    @MotionEasingStandardAccelerate = Easings.StandardAccelerate
    @MotionEasingStandardDecelerate = Easings.StandardDecelerate
    @MotionEasingEmphasized = Easings.Emphasized
    @MotionEasingEmphasizedAccelerate = Easings.EmphasizedAccelerate
    @MotionEasingEmphasizedDecelerate = Easings.EmphasizedDecelerate

    // ── Semantic aliases (Theme.* bridge — see basic/theme.ts) ──────
    // Theme-agnostic keys the imperative Theme.* helper resolves so it
    // doesn't hardcode Material token names. Value is a literal copy of
    // this scheme's own backing token — kept in sync by
    // src/basic/tests/theme.test.ts, not by a live reference (no
    // intra-scheme aliasing syntax exists in this file format).
    @Ink = #E6E1E5        // = @OnSurface
    @AccentInk = #D0BCFF  // = @Primary
    @AccentInkOn = #381E72  // = @OnPrimary
    // Scroll/splitter chrome bridge (see thumb.ts / splitter.ts).
    @ControlTrack = #49454F   // = @OutlineVariant
    @ControlActive = #D0BCFF  // = @Primary
    // Wave 5: theme-agnostic aliases (see material/light.mu).
    @RowHoverFill = #E6E1E514 // = @StateHoverOverlay
    @InkVariant = #CAC4D0     // = @OnSurfaceVariant
    @SurfaceBg = #1C1B1F      // = @Surface
}
