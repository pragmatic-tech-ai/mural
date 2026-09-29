// Pragmatic theme — StatusBar family (StatusBar, StatusBarItem,
// StatusBarSeparator). Transcribed from the Material fork
// (src/framework/status-bar/status-bar.template.mu) with token
// substitutions only: strip Fill @Surface -> @Bg1, top-rule and
// separator @OutlineVariant -> @Border. $$Fill template-binding,
// DockPanel/ItemsPresenter, PART-less item Border, and separator
// Width/MinHeight preserved verbatim. Pragmatic tokens only. This IS
// the framework's default template, composed into MuralFramework via
// framework.resources.mu.
resources StatusBars
{
    Template x:key="DefaultStatusBar" [TargetType = StatusBar]
    {
        Border [ Fill = $$Fill, Padding = (4,2,4,2) ]
        {
            DockPanel [ LastChildFill = true ]
            {
                Line [ DockPanel.Dock = Top, Orientation = Horizontal, Stroke = Pen [ Brush = @Border, Thickness = 1 ] ]
                ItemsPresenter
            }
        }
    }
    ItemsPanelTemplate x:key="DefaultStatusBarPanel"
    {
        DockPanel [ LastChildFill = true ]
    }
    Style [TargetType = StatusBar]
    {
        Template = @DefaultStatusBar;
        ItemsPanel = @DefaultStatusBarPanel;
        Fill = @Bg1;
    }
    Template x:key="DefaultStatusBarItem" [TargetType = StatusBarItem]
    {
        Border [ Padding = (8,2,8,2) ]
        {
            ContentPresenter
        }
    }
    Style [TargetType = StatusBarItem]
    {
        Template = @DefaultStatusBarItem;
    }
    Style [TargetType = StatusBarSeparator]
    {
        Width = 9;
        MinHeight = 16;
        LineBrush = @Border;
    }
}
