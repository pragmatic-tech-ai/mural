// Pragmatic theme — TextBlock / RichTextBlock / RichTextBox defaults
// (Wave 1, final family).
//
// Forked from basic.resources.mu:109-132 (the key-less
// `Style[TargetType=TextBlock|RichTextBlock|RichTextBox]` that seeds the
// ambient Body Medium baseline for Material). This fork swaps the M3
// `@BodyMedium*` atoms for the Pragmatic type scale's `@Body*` atoms
// (declared in pragmatic.mu, valued in light.mu/dark.mu — @BodySize=15
// at the time of writing) and `@FontSans` for the family, matching
// PragmaticTypography's own `Style x:key="Body"` role
// (typography.mu) — this file's the key-LESS twin of that keyed style,
// same five atoms, same source tokens.
//
// No chrome here — style-only, no ControlTemplate. Only Pragmatic tokens
// (@FontSans, @Body*) are used, no M3 tokens (@BodyMedium*).
//
// Foreground is DELIBERATELY NOT set — same rationale as the Material
// fork source (basic.resources.mu:76-101): a Style-tier Foreground would
// outrank the Inherited tier and punch through template boundaries onto
// slotted content, defeating a control template's own ink (e.g. Button's
// `TextBlock.Foreground = @Fg1` on its root Border). Left unset, plain
// text falls through to TextBlock.RenderOverride's `?? Theme.ink`
// render-time fallback for the active theme.
//
// Reconciliation with PragmaticTypography (task-7-report.md has the
// full finding): typography.mu declares ONLY keyed styles
// (`Style x:key="Body"` etc, applied via `TextBlock[Style=@Body]`) — no
// key-less `Style[TargetType=TextBlock]`. So this file's key-less style
// and PragmaticTypography's keyed roles target different resolution
// slots (implicit vs. explicit `Style=`) and never compete for the same
// TargetType; merge order (PragmaticControls before PragmaticTypography)
// is therefore inert for TextBlock defaults specifically — no double
// registration.
//
// Merged into the theme via PragmaticControls (controls.resources.mu),
// listed AFTER MuralFramework so these key-less
// Style[TargetType=TextBlock|RichTextBlock|RichTextBox] entries shadow
// MuralBasic's M3-token-bound defaults (last-merged-wins on the runtime
// class key) — MuralBasic's own copy binds `@BodyMedium*` tokens that
// Pragmatic's schemes never define, so an un-forked TextBlock under
// Pragmatic resolves MuralBasic's style but every DynamicResource lookup
// inside it comes back empty (undefined FontFamily/FontSize/…).

resources PragmaticText
{
    Style [TargetType = TextBlock]
    {
        FontFamily = @FontSans;
        FontWeight = @BodyWeight;
        FontSize = @BodySize;
        LineHeight = @BodyLineHeight;
        LetterSpacing = @BodyTracking;
    }

    // Rich flow-content hosts share TextBlock's Body baseline; the
    // per-paragraph LineHeight lives on each Block, not the host
    // (mirrors the Material fork source's own comment).
    Style [TargetType = RichTextBlock]
    {
        FontFamily = @FontSans;
        FontWeight = @BodyWeight;
        FontSize = @BodySize;
        LineHeight = @BodyLineHeight;
        LetterSpacing = @BodyTracking;
    }
    Style [TargetType = RichTextBox]
    {
        FontFamily = @FontSans;
        FontWeight = @BodyWeight;
        FontSize = @BodySize;
        LineHeight = @BodyLineHeight;
        LetterSpacing = @BodyTracking;
    }
}
