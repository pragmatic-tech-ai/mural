// Pragmatic theme — SearchBar chrome (Wave 4, Task 4).
//
// Forked from Material's search-bar.template.mu (SearchBars ~
// DefaultSearchBar), re-expressed with Pragmatic tokens. SearchBar
// extends TextBox (see framework/search-bar/search-bar.ts) and shares
// its DockPanel anatomy — PART_LeadingSlot | centre TextEditorSurface |
// PART_TrailingSlot — so the class-managed slots and the ScrollViewer /
// TextEditorSurface parts are preserved verbatim.
//
// Delta beyond a plain token swap: Material's SearchBar has NO focus
// ring — neither its rest Stroke (fully transparent, #00000000) nor
// either `when` clause touches PART_Border.Stroke. The Pragmatic fork
// ADDS one, following the Wave-1 TextBox pattern
// (framework/pragmatic/inputs/textbox.template.mu): a rest
// @BorderStrong 1dp outline that thickens to @BorderFocus 2dp on focus.
// Rest fill is @Bg2 (a search field reads as a step BELOW the elevated
// app-bar chrome it usually sits inside); hover/focus both step to
// @Bg1, matching the Wave-1 input hover convention.
//
// GOTCHA (compiler, see textbox.template.mu's note): a `(brush, width)`
// TUPLE assigned to a Pen-typed property compiles to a Thickness, not a
// Pen. Every Stroke assignment here uses the working
// `Pen [ Brush = @Token, Thickness = N ]` form instead.
//
// Merged into the theme via PragmaticControls (controls.resources.mu),
// listed AFTER MuralFramework so this key-less Style[TargetType=SearchBar]
// shadows Material's (last-merged-wins on the runtime class key).

resources SearchBars
{
    Template x:key="DefaultSearchBar" [TargetType = SearchBar]
    {
        Border x:name="PART_Border"
            [ Fill = @Bg2,
              Stroke = Pen [ Brush = @BorderStrong, Thickness = 1 ],
              CornerRadius = @RadiusMd,
              Padding = (@Space3,@Space2,@Space3,@Space2),
              Height = 56 ]
        {
            DockPanel [ LastChildFill = true ]
            {
                Border x:name="PART_LeadingSlot" [ DockPanel.Dock = Left, VerticalAlignment = Center, Margin = (0,0,@Space2,0) ]
                Border x:name="PART_TrailingSlot" [ DockPanel.Dock = Right, VerticalAlignment = Center, Margin = (@Space2,0,0,0) ]
                ScrollViewer x:name="PART_Scroll"
                {
                    TextEditorSurface x:name="PART_Editor"
                }
            }
        }
        when ( IsMouseOver ) { PART_Border.Fill = @Bg1; }
        when ( IsFocused ) { PART_Border.Fill = @Bg1; PART_Border.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
        when ( IsEnabled = false ) { PART_Border.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Density = Compact ) { PART_Border.Padding = (@Space2,@Space1,@Space2,@Space1); PART_Border.Height = 48; }
        when ( ThemeManager.Density = Comfortable ) { PART_Border.Padding = (@Space4,@Space3,@Space4,@Space3); PART_Border.Height = 64; }
        when ( ThemeManager.Pointer = Coarse ) { PART_Border.Padding = (@Space3,@Space3,@Space3,@Space3); PART_Border.Height = 64; }
    }
    Style [TargetType = SearchBar]
    {
        Template = @DefaultSearchBar;
        Foreground = @Fg1;
        SelectionBrush = @TextSelectionBg;
        CaretBrush = @Fg1;
        FontFamily = @FontSans;
        FontWeight = @BodyWeight;
        FontSize = @BodySize;
        LineHeight = @BodyLineHeight;
        LetterSpacing = @BodyTracking;
        MeasurementFidelity = Exact;
    }
}
