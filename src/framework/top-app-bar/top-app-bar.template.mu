// Pragmatic theme — TopAppBar (Wave 4 shell exemplar).
// 4 variants (Small / CenterAligned / Medium / Large). @Bg1 chrome; scroll
// tint steps @Bg1 -> @Bg2 (IsScrolled); title ink @Fg1; per-variant title type
// @H4 / @H3 / @H2. PART names + IsScrolled/EffectiveVariant triggers preserved.
// Pragmatic tokens only. This IS the framework's default template,
// composed into MuralFramework via framework.resources.mu.
resources TopAppBars
{
    Template x:key="DefaultSmallTopAppBar" [TargetType = TopAppBar]
    {
        Border x:name="PART_Border" [ Fill = @Bg1, Height = 64 ]
        {
            Grid
            {
                ColumnDefinitions
                {
                    ColumnDefinition [ Width = GridLength.Auto ]
                    ColumnDefinition [ Width = GridLength.Star ]
                    ColumnDefinition [ Width = GridLength.Auto ]
                }
                Border x:name="PART_NavSlot"
                    [ Grid.Column = 0, Width = 48, Height = 48, Margin = (4,8,4,8), VerticalAlignment = Center, HorizontalAlignment = Center ]
                TextBlock x:name="PART_TitleText"
                    [ Grid.Column = 1, Style = @H4, Foreground = @Fg1, VerticalAlignment = Center, HorizontalAlignment = Left, Margin = (12,0,12,0) ]
                StackPanel x:name="PART_ActionsStack"
                    [ Grid.Column = 2, Orientation = Horizontal, VerticalAlignment = Center, Margin = (4,8,4,8) ]
            }
        }
        when ( IsScrolled ) { PART_Border.Fill = @Bg2; }
        when ( ThemeManager.Density = Compact ) { PART_TitleText.Margin = (8,0,8,0); }
        when ( ThemeManager.Density = Comfortable ) { PART_TitleText.Margin = (16,0,16,0); }
    }
    Template x:key="DefaultCenterAlignedTopAppBar" [TargetType = TopAppBar]
    {
        Border x:name="PART_Border" [ Fill = @Bg1, Height = 64 ]
        {
            Grid
            {
                ColumnDefinitions
                {
                    ColumnDefinition [ Width = GridLength.Star ]
                    ColumnDefinition [ Width = GridLength.Auto ]
                    ColumnDefinition [ Width = GridLength.Star ]
                }
                Border x:name="PART_NavSlot"
                    [ Grid.Column = 0, Width = 48, Height = 48, Margin = (4,8,4,8), VerticalAlignment = Center, HorizontalAlignment = Left ]
                TextBlock x:name="PART_TitleText"
                    [ Grid.Column = 1, Style = @H4, Foreground = @Fg1, VerticalAlignment = Center, HorizontalAlignment = Center, Margin = (12,0,12,0) ]
                StackPanel x:name="PART_ActionsStack"
                    [ Grid.Column = 2, Orientation = Horizontal, VerticalAlignment = Center, HorizontalAlignment = Right, Margin = (4,8,4,8) ]
            }
        }
        when ( IsScrolled ) { PART_Border.Fill = @Bg2; }
        when ( ThemeManager.Density = Compact ) { PART_TitleText.Margin = (8,0,8,0); }
        when ( ThemeManager.Density = Comfortable ) { PART_TitleText.Margin = (16,0,16,0); }
    }
    Template x:key="DefaultMediumTopAppBar" [TargetType = TopAppBar]
    {
        Border x:name="PART_Border" [ Fill = @Bg1, Height = 112 ]
        {
            DockPanel [ LastChildFill = true ]
            {
                DockPanel [ DockPanel.Dock = Top, Height = 64, LastChildFill = true ]
                {
                    Border x:name="PART_NavSlot"
                        [ DockPanel.Dock = Left, Width = 48, Height = 48, Margin = (4,8,4,8), VerticalAlignment = Center, HorizontalAlignment = Center ]
                    StackPanel x:name="PART_ActionsStack"
                        [ DockPanel.Dock = Right, Orientation = Horizontal, VerticalAlignment = Center, Margin = (4,8,4,8) ]
                    Border [ Fill = #00000000 ]
                }
                Border [ Padding = (16,0,16,16) ]
                {
                    TextBlock x:name="PART_TitleText"
                        [ Style = @H3, Foreground = @Fg1, VerticalAlignment = Bottom, HorizontalAlignment = Left ]
                }
            }
        }
        when ( IsScrolled ) { PART_Border.Fill = @Bg2; }
    }
    Template x:key="DefaultLargeTopAppBar" [TargetType = TopAppBar]
    {
        Border x:name="PART_Border" [ Fill = @Bg1, Height = 152 ]
        {
            DockPanel [ LastChildFill = true ]
            {
                DockPanel [ DockPanel.Dock = Top, Height = 64, LastChildFill = true ]
                {
                    Border x:name="PART_NavSlot"
                        [ DockPanel.Dock = Left, Width = 48, Height = 48, Margin = (4,8,4,8), VerticalAlignment = Center, HorizontalAlignment = Center ]
                    StackPanel x:name="PART_ActionsStack"
                        [ DockPanel.Dock = Right, Orientation = Horizontal, VerticalAlignment = Center, Margin = (4,8,4,8) ]
                    Border [ Fill = #00000000 ]
                }
                Border [ Padding = (16,0,16,20) ]
                {
                    TextBlock x:name="PART_TitleText"
                        [ Style = @H2, Foreground = @Fg1, VerticalAlignment = Bottom, HorizontalAlignment = Left ]
                }
            }
        }
        when ( IsScrolled ) { PART_Border.Fill = @Bg2; }
    }
    Style [TargetType = TopAppBar]
    {
        Template = @DefaultSmallTopAppBar;
        when ( EffectiveVariant = CenterAligned ) { Template = @DefaultCenterAlignedTopAppBar; }
        when ( EffectiveVariant = Medium ) { Template = @DefaultMediumTopAppBar; }
        when ( EffectiveVariant = Large ) { Template = @DefaultLargeTopAppBar; }
    }
}
