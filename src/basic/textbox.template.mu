// Pragmatic theme — TextBox (Outlined / Filled / Plain) chrome (Wave 1).
//
// Forked from Material's basic.resources.mu (DefaultOutlinedTextBox ~183,
// DefaultFilledTextBox ~243, DefaultPlainTextBox ~300, the key-less
// Style[TargetType=TextBox] ~311), re-expressed with the same Pragmatic
// mechanics the Button / IconButton forks established
// (framework/pragmatic/buttons/buttons.template.mu):
//
//   * TextBox shows focus on its OWN border/underline — unlike Button /
//     IconButton there is no PART_FocusRing wrapper here; a focused input
//     re-tints the chrome it already has (Outlined: PART_Border.Stroke,
//     Filled: PART_Underline.Stroke), never an offset ring.
//   * There is no press state on an input surface — a pointer-down lands
//     focus rather than registering a transient press tint, so the
//     Material five-state ladder collapses to rest / (Filled: hover) /
//     focused / disabled here, matching the M3 fork's own comment.
//   * Density / pointer adapt the control height via the same
//     @ControlH* tokens the Button fork uses (Compact / Coarse), rather
//     than the M3 ComboBox row-height tokens Material borrows.
//   * Disabled dims the root to @OpacityDisabled.
//
// Only Pragmatic tokens are used — no raw hex (except the `#00000000`
// transparent convention), no M3 tokens (@Primary / @OnSurface /
// @Shape* / @Elevation* / @*Layer). Radii stay at @RadiusMd (well under
// the @RadiusXl cap).
//
// Text selection uses @TextSelectionBg (Style-level SelectionBrush).
// TextEditorSurface.RenderOverride only paints a SELECTION BACKGROUND
// rectangle (text-box.ts ~283 `paintSelection(dc, selBrush, …)`) — there
// is no selection-foreground property on TextBox or TextEditorSurface
// (Material's own Style never sets one either), so @TextSelectionFg has
// no attachment point here; selected text keeps the ordinary @Fg0
// Foreground.
//
// This key-less Style[TargetType=TextBox] IS the framework's default
// template, composed into MuralBasic via basic.resources.mu — there is
// no override layer and no Material to shadow.
//
// GOTCHA (compiler): a `(brush, width)` TUPLE assigned to a Pen-typed
// property (Border.Stroke / Line.Stroke, both inherited from
// Visual.StrokeKey) compiles to `new Thickness(brush, width, brush,
// width)` instead of a Pen — confirmed in both this file's own build
// output and Material's PRE-EXISTING compiled basic.resources.mu.js
// (its Filled TextBox's `Line x:name="PART_Underline" [Stroke =
// (@OnSurfaceVariant, 1)]` has the exact same bug, so it silently never
// painted a real Pen either). It also affects the Button /
// IconButton forks' `PART_FocusRing.Stroke = (@BorderFocus, 2)`
// triggers (Tasks 1-2 never asserted a focus-ring colour in SVG, so it
// went unnoticed). Every Stroke assignment in this file uses the
// working form instead: `Pen [ Brush = @Token ]` (default Thickness=1)
// or `Pen [ Brush = @Token, Thickness = 2 ]` — verified against the
// compiled emit (`new Pen()` with a DynamicResource-bound Brush).

resources TextBoxes
{
    // ── Outlined — the baseline. @Bg1 surface, @BorderStrong 1dp
    // outline, @RadiusMd corners. Focus re-tints the SAME border to
    // @BorderFocus at 2dp; there is no hover restyle (an input's rest
    // and hover borders read the same in the Pragmatic DS — only focus
    // and disabled are distinct states here).
    Template x:key="DefaultOutlinedTextBox" [TargetType = TextBox]
    {
        Border x:name="PART_Border"
            [ Fill = @Bg1,
              Stroke = Pen [ Brush = @BorderStrong ],
              CornerRadius = @RadiusMd,
              // Single-line (AcceptsReturn = false, the default) keeps tight
              // vertical padding so the row lands on the @ControlH* floor
              // below; multi-line restores comfortable padding, matching the
              // Material fork's own rationale (a floor is never a cap — an
              // auto-growing composer field still grows past it).
              Padding = (@Space3,@Space1,@Space3,@Space1),
              MinHeight = @ControlHDefault ]
        {
            ScrollViewer x:name="PART_Scroll" [ VerticalAlignment = Center ]
            {
                TextEditorSurface x:name="PART_Editor"
            }
        }
        when ( IsFocused ) { PART_Border.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
        when ( IsEnabled = false ) { PART_Border.Opacity = @OpacityDisabled; }

        when ( ThemeManager.Density = Compact ) { PART_Border.MinHeight = @ControlHCompact; }
        when ( ThemeManager.Pointer = Coarse ) { PART_Border.MinHeight = @ControlHTouch; }

        when ( AcceptsReturn = true )
        {
            PART_Border.Padding = (@Space3,@Space2,@Space3,@Space2);
            PART_Scroll.VerticalAlignment = Stretch;
        }
    }

    // ── Filled — @Bg2 surface, no outline; a bottom-only underline
    // rule carries the border cue instead. CornerRadius rides the
    // (TL,TR,BR,BL) tuple form so only the top corners round — the
    // field sits flush against its own underline, mirroring the
    // Material Filled shape with Pragmatic radii (@RadiusMd, capped
    // well under @RadiusXl).
    Template x:key="DefaultFilledTextBox" [TargetType = TextBox]
    {
        StackPanel x:name="PART_Root" [ Orientation = Vertical ]
        {
            Border x:name="PART_Border"
                [ Fill = @Bg2,
                  CornerRadius = (@RadiusMd,@RadiusMd,0,0),
                  Padding = (@Space3,@Space1,@Space3,@Space1),
                  MinHeight = @ControlHDefault ]
            {
                ScrollViewer x:name="PART_Scroll" [ VerticalAlignment = Center ]
                {
                    TextEditorSurface x:name="PART_Editor"
                }
            }
            Line x:name="PART_Underline"
                [ Orientation = Horizontal,
                  Stroke = Pen [ Brush = @BorderStrong ] ]
        }
        // Focus thickens the underline to 2dp and flips it to
        // @BorderFocus, matching the Outlined variant's own-border
        // focus cue.
        when ( IsFocused ) { PART_Underline.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
        when ( IsEnabled = false ) { PART_Root.Opacity = @OpacityDisabled; }

        when ( ThemeManager.Density = Compact ) { PART_Border.MinHeight = @ControlHCompact; }
        when ( ThemeManager.Pointer = Coarse ) { PART_Border.MinHeight = @ControlHTouch; }

        when ( AcceptsReturn = true )
        {
            PART_Border.Padding = (@Space3,@Space2,@Space3,@Space2);
            PART_Scroll.VerticalAlignment = Stretch;
        }
    }

    // ── Plain — chrome-less inline editor. No border / background /
    // padding of its own; for hosts that supply their own frame (an
    // editable ComboBox's selection box, a SpinEdit value field). Caret,
    // selection and text render exactly as the other variants — only
    // the surrounding chrome is dropped.
    Template x:key="DefaultPlainTextBox" [TargetType = TextBox]
    {
        Border x:name="PART_Border"
            [ Fill = #00000000,
              Padding = (0) ]
        {
            ScrollViewer x:name="PART_Scroll"
            {
                TextEditorSurface x:name="PART_Editor"
            }
        }
        when ( IsEnabled = false ) { PART_Border.Opacity = @OpacityDisabled; }
    }

    // Default Style — key-less so it resolves implicitly on the TextBox
    // runtime class. Outlined is the baseline (matches Pragmatic's own
    // Button ladder defaulting to its highest-emphasis look); Filled /
    // Plain ride a Variant trigger, same shape the Material fork uses.
    // Foreground / PlaceholderBrush / SelectionBrush / CaretBrush flow
    // through DynamicResource so theme switches re-tint live.
    Style [TargetType = TextBox]
    {
        Template = @DefaultOutlinedTextBox;
        when ( Variant = Filled ) { Template = @DefaultFilledTextBox; }
        when ( Variant = Plain ) { Template = @DefaultPlainTextBox; }
        Foreground = @Fg0;
        PlaceholderBrush = @Fg3;
        SelectionBrush = @TextSelectionBg;
        CaretBrush = @Fg0;
        // Centre (not Stretch) so a field sits at its own height inside a
        // taller row/slot rather than stretching to fill it — pairs with
        // the @ControlH* floor to keep fields a stable, dense height.
        VerticalAlignment = Center;
    }
}
