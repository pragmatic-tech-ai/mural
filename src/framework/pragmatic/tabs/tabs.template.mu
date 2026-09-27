// Pragmatic theme — TabControl chrome (Wave 2).
//
// Strip = @Bg1 surface with a 1dp @Border rule under the header row. Each
// tab: PART_Tab transparent surface (hover @Bg2), a PART_Indicator
// underline (a 2dp horizontal Line, transparent at rest, painted
// @ControlAccent when selected — the brand-accent current-tab cue), and
// PART_Header (the $$Header / $$HeaderTemplate presenter). Focus strokes
// PART_Tab (its Stroke is otherwise free). Selected header ink flips to
// @ControlAccent to match the underline. Density adapts MinHeight.
//
// PART names + the $$SelectedContent / $$Header / $$HeaderTemplate template
// bindings + ReuseContentViews are preserved verbatim so TabControl's
// content-host normalisation and view reuse keep working.
//
// Only Pragmatic tokens — no M3 (@Surface / @OutlineVariant / @Primary /
// @OnSurfaceVariant / @State*Overlay / @Title*) token.

resources PragmaticTabs
{
    ItemsPanelTemplate x:key="DefaultTabControlPanel"
    {
        StackPanel [ Orientation = Horizontal ]
    }
    Template x:key="DefaultTabControl" [TargetType = TabControl]
    {
        Border x:name="PART_Border" [ Fill = @Bg1 ]
        {
            DockPanel [ LastChildFill = true ]
            {
                ItemsPresenter x:name="PART_ItemsPresenter" [ DockPanel.Dock = Top ]
                Line [ DockPanel.Dock = Top, Orientation = Horizontal, Stroke = Pen [ Brush = @Border, Thickness = 1 ] ]
                ContentPresenter x:name="PART_ContentSlot" [ Content = $$SelectedContent, ReuseContentViews = true ]
            }
        }
    }
    Style [TargetType = TabControl]
    {
        Template = @DefaultTabControl;
        ItemsPanel = @DefaultTabControlPanel;
    }

    Template x:key="DefaultTabItem" [TargetType = TabItem]
    {
        DockPanel [ LastChildFill = true ]
        {
            Line x:name="PART_Indicator"
                [ DockPanel.Dock = Bottom,
                  Orientation = Horizontal,
                  Stroke = Pen [ Brush = #00000000, Thickness = 2 ] ]
            Border x:name="PART_Tab"
                [ Fill = #00000000,
                  Padding = (@Space4,@Space1,@Space4,@Space1),
                  MinHeight = @ControlHDefault ]
            {
                ContentPresenter x:name="PART_Header"
                    [ Content = $$Header,
                      ContentTemplate = $$HeaderTemplate,
                      HorizontalAlignment = Center,
                      VerticalAlignment = Center ]
            }
        }
        when ( IsSelected ) { PART_Indicator.Stroke = Pen [ Brush = @ControlAccent, Thickness = 2 ]; }
        when ( IsMouseOver ) { PART_Tab.Fill = @Bg2; }
        when ( IsFocused ) { PART_Tab.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
        when ( IsEnabled = false ) { PART_Tab.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Density = Compact ) { PART_Tab.MinHeight = @ControlHCompact; }
        when ( ThemeManager.Pointer = Coarse ) { PART_Tab.MinHeight = @ControlHTouch; }
    }
    Style [TargetType = TabItem]
    {
        Template = @DefaultTabItem;
        // Header ink + typography as inherited TextBlock.* writes; the
        // stringified $$Header label (and unset HeaderTemplate labels)
        // inherit them. Selected flips the ink to @ControlAccent to match
        // the underline.
        TextBlock.Foreground = @Fg2;
        TextBlock.FontFamily = @FontSans;
        TextBlock.FontWeight = @UiLabelWeight;
        TextBlock.FontSize = @UiLabelSize;
        TextBlock.LineHeight = @UiLabelLineHeight;
        TextBlock.LetterSpacing = @UiLabelTracking;
        when ( IsSelected ) { TextBlock.Foreground = @ControlAccent; }
    }
}
