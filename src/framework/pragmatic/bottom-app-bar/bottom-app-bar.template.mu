// Pragmatic theme — BottomAppBar.
// @Bg2 chrome; @ShadowMd resting elevation. PART_Border/PART_ActionsStack/
// PART_FabSlot + density/coarse-pointer triggers preserved verbatim from
// the Material fork. Pragmatic tokens only. Merged via PragmaticControls
// (after MuralFramework).
resources PragmaticBottomAppBar
{
    Template x:key="DefaultBottomAppBar" [TargetType = BottomAppBar]
    {
        Border x:name="PART_Border" [ Fill = @Bg2, Height = 80, Effect = @ShadowMd ]
        {
            Grid
            {
                ColumnDefinitions
                {
                    ColumnDefinition [ Width = GridLength.Star ]
                    ColumnDefinition [ Width = GridLength.Auto ]
                }
                StackPanel x:name="PART_ActionsStack"
                    [ Grid.Column = 0, Orientation = Horizontal, VerticalAlignment = Center, HorizontalAlignment = Left, Margin = (4,0,4,0) ]
                Border x:name="PART_FabSlot"
                    [ Grid.Column = 1, VerticalAlignment = Center, HorizontalAlignment = Right, Margin = (8,0,16,0) ]
            }
        }
        when ( ThemeManager.Density = Compact ) { PART_ActionsStack.Margin = (0,0,0,0); }
        when ( ThemeManager.Density = Comfortable ) { PART_ActionsStack.Margin = (8,0,8,0); }
        when ( ThemeManager.Pointer = Coarse ) { PART_ActionsStack.Margin = (8,0,8,0); }
    }
    Style [TargetType = BottomAppBar]
    {
        Template = @DefaultBottomAppBar;
    }
}
