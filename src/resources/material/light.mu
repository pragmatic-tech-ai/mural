// Material 3 light-mode token palette.
//
// Reference values derived from the M3 "baseline" scheme (purple seed
// at tone 40). Token names mirror the M3 spec verbatim
// (https://m3.material.io/styles/color/the-color-system/tokens) so a
// reader who knows M3 can map straight across without translation.
//
// Templates consume these via `@Primary`, `@Surface`, etc. — `@key` is
// dynamic (see compiler.ts static-resource emit), so swapping this
// dictionary out for `dark.mu` at runtime re-paints every dependent
// property without rebuilding any visual.
//
// Brush identity: each `#hex = SolidColorBrush` allocation is paid
// once at theme registration. Templates that need the brush at
// runtime (e.g. trigger-driven Background swaps) read it back through
// the same dictionary lookup, so identity is preserved across uses.

scheme MaterialLight against Material {
    // ── Primary tier ────────────────────────────────────────────────
    @Primary = #6750A4
    @OnPrimary = #FFFFFF
    @PrimaryContainer = #EADDFF
    @OnPrimaryContainer = #21005D
    // Precomputed Primary + OnPrimary state layers at 8% / 12% —
    // M3 Filled Button hover / pressed colours. Used until the
    // dedicated state-layer overlay infrastructure lands; once it
    // does, these tokens move to template-side overlays driven
    // by hover/press triggers.
    @PrimaryHover = #735EAB
    @PrimaryPress = #7A65AF

    // ── Secondary tier ──────────────────────────────────────────────
    @Secondary = #625B71
    @OnSecondary = #FFFFFF
    @SecondaryContainer = #E8DEF8
    @OnSecondaryContainer = #1D192B

    // ── Tertiary tier ───────────────────────────────────────────────
    @Tertiary = #7D5260
    @OnTertiary = #FFFFFF
    @TertiaryContainer = #FFD8E4
    @OnTertiaryContainer = #31111D

    // ── Error tier ──────────────────────────────────────────────────
    @Error = #B3261E
    @OnError = #FFFFFF
    @ErrorContainer = #F9DEDC
    @OnErrorContainer = #410E0B

    // ── Background / Surface ────────────────────────────────────────
    @Background = #FFFBFE
    @OnBackground = #1C1B1F
    @Surface = #FFFBFE
    @OnSurface = #1C1B1F
    @SurfaceVariant = #E7E0EC
    @OnSurfaceVariant = #49454F
    // Diagram drawing surface — a hair off pure white so the ruler strips
    // (@Surface #FFFBFE) read as a distinct frame around the canvas.
    @DiagramCanvas = #FDFDFD

    // ── M3 Surface containers (elevation tinting) ───────────────────
    @SurfaceContainerLowest = #FFFFFF
    @SurfaceContainerLow = #F7F2FA
    @SurfaceContainer = #F3EDF7
    @SurfaceContainerHigh = #ECE6F0
    @SurfaceContainerHighest = #E6E0E9

    // ── Outline / dividers ──────────────────────────────────────────
    @Outline = #79747E
    @OutlineVariant = #CAC4D0

    // ── Inverse / dark-on-light overlays ────────────────────────────
    @InverseSurface = #313033
    @InverseOnSurface = #F4EFF4
    @InversePrimary = #D0BCFF

    // ── Surface tint (M3 elevation tinting) ─────────────────────────
    // M3 spec ties SurfaceTint to Primary so elevated surfaces read as
    // brand-tinted. Pre-composed @SurfaceContainer ladder above bakes
    // this in for typical chrome; the raw token here lets consumers
    // composite the tint at custom opacities.
    @SurfaceTint = #6750A4

    // ── Scrim / shadow tint ─────────────────────────────────────────
    // Scrim is the modal-overlay tint behind drawers, dialogs, and
    // bottom sheets. Consumed by Drawer (and others) at render time as
    // a finished Brush — alpha is baked in, not separately applied.
    // M3 spec is 32% black; mural's historical default was 50% to read
    // through theme-tinted surfaces. Keeping 50% (#80) for parity until
    // we adopt the M3 32% (#52) deliberately.
    @Scrim = #00000080
    @Shadow = #000000

    // ── State-layer overlay colours ─────────────────────────────────
    // Material 3 state layers tint the parent at low opacity. The
    // alpha-encoded hex values let templates reference one token per
    // state and skip the per-overlay alpha math.
    @StateHoverOverlay = #1C1B1F14 // OnSurface @ 8%
    @StateFocusOverlay = #1C1B1F1F // OnSurface @ 12%
    @StatePressOverlay = #1C1B1F1F // OnSurface @ 12%

    // ── State-layer raw opacities (scheme-agnostic; see material.mu) ─
    @StateHoverOpacity = 0.08
    @StateFocusOpacity = 0.12
    @StatePressOpacity = 0.12
    @StateDragOpacity = 0.16

    // ── Per-ink-role state-layer brushes (M3 strict overlay path) ───
    // Alpha-encoded hex: #14 ≈ 0.08, #1F ≈ 0.12. The colour matches
    // the variant's foreground (ink) so the overlay reads as a tinted
    // version of the painted text/icon over the resting container.
    @OnPrimaryHoverLayer = #FFFFFF14 // OnPrimary  @ 8%
    @OnPrimaryPressLayer = #FFFFFF1F // OnPrimary  @ 12%
    @PrimaryHoverLayer = #6750A414 // Primary    @ 8%
    @PrimaryPressLayer = #6750A41F // Primary    @ 12%
    @OnSecondaryContainerHoverLayer = #1D192B14 // OnSecondaryContainer @ 8%
    @OnSecondaryContainerPressLayer = #1D192B1F // OnSecondaryContainer @ 12%
    @OnSurfaceVariantHoverLayer = #49454F14 // OnSurfaceVariant @ 8%
    @OnSurfaceVariantPressLayer = #49454F1F // OnSurfaceVariant @ 12%
    @OnPrimaryContainerHoverLayer = #21005D14 // OnPrimaryContainer @ 8%
    @OnPrimaryContainerPressLayer = #21005D1F // OnPrimaryContainer @ 12%

    // ── Spacing scale (M3 4dp grid) ─────────────────────────────────
    @Spacing0 = 0
    @Spacing1 = 4
    @Spacing2 = 8
    @Spacing3 = 12
    @Spacing4 = 16
    @Spacing5 = 20
    @Spacing6 = 24
    @Spacing7 = 28
    @Spacing8 = 32

    // ── List row heights (M3 list spec) ─────────────────────────────
    @ListRowHeightCompact = 28
    @ListRowHeightRegular = 32
    @ListRowHeightComfortable = 40
    @ListRowHeightTouch = 48
    @ListRowHeightTwoLine = 64
    @ListRowHeightThreeLine = 88

    // ── Disabled state opacities (M3 spec) ──────────────────────────
    @DisabledContainerOpacity = 0.12
    @DisabledContentOpacity = 0.38

    // ── Shape (corner radii — M3 shape scale) ───────────────────────
    // Numeric tokens consumed via Border.CornerRadius = @ShapeMedium etc.
    // `Full` is the M3 "fully rounded" shape family — Border's render
    // path recognises CornerRadius.Full (Number.POSITIVE_INFINITY) and
    // clamps to min(width, height)/2, so a square button becomes a
    // circle and a wide one becomes a stadium / pill.
    @ShapeNone = 0
    @ShapeExtraSmall = 4
    @ShapeSmall = 8
    @ShapeMedium = 12
    @ShapeLarge = 16
    @ShapeExtraLarge = 28
    @ShapeFull = CornerRadius.Full

    // ── Typography family ───────────────────────────────────────────
    // Material 3 baseline is Roboto, but loading a web-font ships a
    // network request + a layout-stability hazard, so the token ships
    // the OS-system stack. Hosts that want Roboto override these tokens
    // at Application.Resources level (or merge a custom dict) and the
    // change reaches every TextBlock via inheritance.
    @FontFamily = "system-ui, sans-serif"
    @TypefaceBrand = "system-ui, sans-serif"
    @TypefacePlain = "system-ui, sans-serif"
    @TypefaceWeightRegular = FontWeight.Normal
    @TypefaceWeightMedium = FontWeight.Medium
    @TypefaceWeightBold = FontWeight.Bold

    // ── Typography type-scale atoms (M3 type-scale spec values) ─────
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
    // Consumed by MarqueeSelectionBehavior at adorner-render time via
    // TryFindResource — swapping the active scheme re-paints the
    // marquee rectangle live. Light-mode uses the same M3 cyan accent
    // as the historical hardcoded constants.
    @MarqueeFill = #3699cc33
    @MarqueeStroke = #3699cc
    // Text-input selection highlight — the same M3 cyan accent as the
    // marquee, at a stronger alpha so a selected run reads clearly under
    // dark-mode-independent foreground text (default TextBox selection was
    // near-invisible). Consumed via `SelectionBrush = @TextSelectionBrush`.
    @TextSelectionBrush = #3699cc66

    // ── Elevation (M3 dual-shadow ramp) ─────────────────────────────
    // Each token is a MaterialElevationEffect at the named level. The
    // element-node value form (`Ident [Prop = val]`) drops the effect
    // through the scheme straight into the resource chain — no
    // imperative TS sidecar required. Level 0 returns the empty filter
    // string at render time (a "resting / flat" sentinel a consumer
    // can set without conditional logic).
    @ElevationLevel0 = MaterialElevationEffect [Level = 0]
    @ElevationLevel1 = MaterialElevationEffect [Level = 1]
    @ElevationLevel2 = MaterialElevationEffect [Level = 2]
    @ElevationLevel3 = MaterialElevationEffect [Level = 3]
    @ElevationLevel4 = MaterialElevationEffect [Level = 4]
    @ElevationLevel5 = MaterialElevationEffect [Level = 5]
    // Legacy aliases — keep one milestone for the @Elevation1-5
    // consumers; new code should use @ElevationLevel*. Re-materialised
    // here (not bound to the new tokens) because scheme value position
    // doesn't support @-lookup; the duplicate construction cost is
    // a once-per-scheme-registration allocation.
    @Elevation1 = MaterialElevationEffect [Level = 1]
    @Elevation2 = MaterialElevationEffect [Level = 2]
    @Elevation3 = MaterialElevationEffect [Level = 3]
    @Elevation4 = MaterialElevationEffect [Level = 4]
    @Elevation5 = MaterialElevationEffect [Level = 5]

    // ── Motion durations (in ms) ────────────────────────────────────
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

    // ── Motion easings ──────────────────────────────────────────────
    // Materialised from the Easings palette in runtime/animation/easing.ts.
    // The cubic-bezier closures are precomputed and shared across the
    // theme — referencing them here costs one identity comparison.
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
    @Ink = #1C1B1F        // = @OnSurface
    @AccentInk = #6750A4  // = @Primary
    // Scroll/splitter chrome bridge (see thumb.ts / splitter.ts): the
    // Thumb-derived primitives resolve these theme-agnostic keys instead
    // of hardcoded M3 names. Material aliases its own values so it stays
    // byte-identical.
    @ControlTrack = #CAC4D0   // = @OutlineVariant (Thumb/Splitter/GridSplitter rest)
    @ControlActive = #6750A4  // = @Primary (Splitter hover/drag + drag-preview)
    // Wave 5: theme-agnostic aliases (literal copies of the M3 backing
    // tokens — same value, so Material output is unchanged).
    @RowHoverFill = #1C1B1F14 // = @StateHoverOverlay
    @InkVariant = #49454F     // = @OnSurfaceVariant
    @SurfaceBg = #FFFBFE      // = @Surface
}
