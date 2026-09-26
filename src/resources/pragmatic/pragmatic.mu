// Pragmatic Labs theme — token catalog.
//
// The catalog declares WHICH tokens exist and their types; the schemes
// (light.mu / dark.mu) supply the values, projected from the design
// system snapshot at dev-kit/design/design-systems/pragmatic/tokens.json
// (the source of truth; a conformance test asserts they match).
//
// Naming: design-system kebab names become PascalCase tokens
// (bg-0 -> @Bg0, brand-green-soft -> @BrandGreenSoft). Raw neutral-*
// ramp steps are NOT catalog tokens — their values are inlined into the
// semantic tokens that alias them, matching the design system's
// "prefer the semantic tokens" rule.

theme Pragmatic
{
    import PragmaticLight from "./light.mu.js"
    import PragmaticDark from "./dark.mu.js"
    import MuralBasic from "../basic.resources.mu.js"
    import MuralFramework from "../framework.resources.mu.js"
    import PragmaticTypography from "./typography.mu.js"
    schemes: [PragmaticLight, PragmaticDark]
    defaultScheme: PragmaticLight
    dictionaries: [MuralBasic, MuralFramework, PragmaticTypography]

    tokens
    {
        // ── Brand ──────────────────────────────────────────────
        @BrandGreen : Brush "Signal Green. Data-viz + logomark only; use ActionPrimary for CTAs."
        @BrandGreenHover : Brush
        @BrandGreenPress : Brush
        @BrandGreenSoft : Brush "Tinted brand background: badges, focus halo, highlighted nodes."
        @BrandGreenInk : Brush "Brand green as text."
        @ActionPrimary : Brush "Primary button fill (accessible: white text passes 4.5:1)."
        @ActionPrimaryHover : Brush
        @ActionPrimaryPress : Brush
        @ControlAccent : Brush "Accent for focus rings and selected controls; theme-adaptive."
        // ── Accents ────────────────────────────────────────────
        @AccentCyan : Brush
        @AccentCyanSoft : Brush
        @AccentCyanInk : Brush
        @AccentPlum : Brush
        @AccentPlumSoft : Brush
        @AccentPlumInk : Brush
        // ── State ──────────────────────────────────────────────
        @StateSuccess : Brush
        @StateSuccessSoft : Brush
        @StateSuccessInk : Brush
        @StateWarning : Brush
        @StateWarningSoft : Brush
        @StateWarningInk : Brush
        @StateDanger : Brush
        @StateDangerSoft : Brush
        @StateDangerInk : Brush
        @StateInfo : Brush
        @StateInfoSoft : Brush
        // ── Surfaces ───────────────────────────────────────────
        @Bg0 : Brush "Page surface."
        @Bg1 : Brush "Elevated surface: cards, inputs, menus."
        @Bg2 : Brush "Hovered surface."
        @Bg3 : Brush "Pressed/selected surface."
        @BgInverse : Brush
        // ── Text / icon ────────────────────────────────────────
        @Fg0 : Brush "Primary text."
        @Fg1 : Brush "Body text."
        @Fg2 : Brush "Secondary text + default icon."
        @Fg3 : Brush "Tertiary text, placeholders."
        @FgDisabled : Brush
        @FgOnAccent : Brush
        @FgInverse : Brush
        // ── Lines ──────────────────────────────────────────────
        @Border : Brush "Default 1px hairline."
        @BorderStrong : Brush "Input borders, secondary buttons."
        @BorderFocus : Brush "2px focus ring colour."
        // ── Selection / canvas ─────────────────────────────────
        @SurfaceSelected : Brush "Selected row fill."
        @CanvasBg : Brush "Diagram drawing-paper background."
        @CanvasGridDot : Brush "Canvas grid dots."
        @SelectionMarqueeFill : Brush
        @SelectionMarqueeStroke : Brush
        @TextSelectionBg : Brush "Selected-text highlight."
        @TextSelectionFg : Brush
        @Scrim : Brush "Modal overlay."
        // ── Spacing (dp) ───────────────────────────────────────
        @Space1 : number
        @Space2 : number
        @Space3 : number
        @Space4 : number
        @Space5 : number
        @Space6 : number
        @Space7 : number
        @Space8 : number
        @Space9 : number
        @Space10 : number
        // ── Radius (dp) ────────────────────────────────────────
        @RadiusNone : number
        @RadiusXs : number
        @RadiusSm : number
        @RadiusMd : number
        @RadiusLg : number
        @RadiusXl : number
        @RadiusPill : CornerRadius
        // ── Sizing (dp) ────────────────────────────────────────
        @ControlHDense : number
        @ControlHCompact : number
        @ControlHDefault : number
        @ControlHTouch : number
        @RowHDense : number
        @RowHCompact : number
        @RowHDefault : number
        @RowHTouch : number
        // ── Density step (dp offset) ───────────────────────────
        @DensityTouch : number
        @DensityComfortable : number
        @DensityCompact : number
        @DensityDense : number
        // ── Motion / opacity / focus ───────────────────────────
        @DurationFast : number
        @DurationMedium : number
        @DurationSlow : number
        @OpacityDisabled : number
        @FocusRingWidth : number
        @FocusRingOffset : number
        @EasingStandard : EasingFunction
        @EasingInout : EasingFunction
        // ── Fonts ──────────────────────────────────────────────
        @FontSans : string
        @FontMono : string
        @FontSerif : string
        @WeightRegular : FontWeight
        @WeightMedium : FontWeight
        @WeightSemibold : FontWeight
        @WeightBold : FontWeight
        // ── Type scale (per role: Weight/Size/LineHeight/Tracking;
        //    FontFamily comes from @FontSans/@FontMono/@FontSerif) ──
        @Display1Weight : FontWeight   @Display1Size : number   @Display1LineHeight : number   @Display1Tracking : number
        @Display2Weight : FontWeight   @Display2Size : number   @Display2LineHeight : number   @Display2Tracking : number
        @H1Weight : FontWeight   @H1Size : number   @H1LineHeight : number   @H1Tracking : number
        @H2Weight : FontWeight   @H2Size : number   @H2LineHeight : number   @H2Tracking : number
        @H3Weight : FontWeight   @H3Size : number   @H3LineHeight : number   @H3Tracking : number
        @H4Weight : FontWeight   @H4Size : number   @H4LineHeight : number   @H4Tracking : number
        @BodyWeight : FontWeight   @BodySize : number   @BodyLineHeight : number   @BodyTracking : number
        @BodySmWeight : FontWeight   @BodySmSize : number   @BodySmLineHeight : number   @BodySmTracking : number
        @BodySerifWeight : FontWeight   @BodySerifSize : number   @BodySerifLineHeight : number   @BodySerifTracking : number
        @UiLabelWeight : FontWeight   @UiLabelSize : number   @UiLabelLineHeight : number   @UiLabelTracking : number
        @UiLabelSmWeight : FontWeight   @UiLabelSmSize : number   @UiLabelSmLineHeight : number   @UiLabelSmTracking : number
        @UiCaptionWeight : FontWeight   @UiCaptionSize : number   @UiCaptionLineHeight : number   @UiCaptionTracking : number
        @CodeWeight : FontWeight   @CodeSize : number   @CodeLineHeight : number   @CodeTracking : number
        @LabelWeight : FontWeight   @LabelSize : number   @LabelLineHeight : number   @LabelTracking : number
        // ── Shadows ────────────────────────────────────────────
        @ShadowSm : Effect
        @ShadowMd : Effect
        @ShadowLg : Effect
    }
}
