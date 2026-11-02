// Default chrome for DataGrid: a ScrollViewer over a vertical DockPanel with an
// (initially empty) header band docked at the top and the rows presenter filling
// the rest. Row and cell chrome follow the ListBoxItem selection/hover shape.

resources DataGrids
{
    Template x:key="DefaultDataGrid" [TargetType = DataGrid]
    {
        ScrollViewer x:name="PART_Scroll" [ HorizontalScrollEnabled = false ]
        {
            DockPanel [ LastChildFill = true ]
            {
                // Header insets mirror the row chrome (focus ring + selected padding) so
                // header and data columns share the same horizontal extent.
                Border [ DockPanel.Dock = Top, Fill = #00000000, Padding = (@FocusRingOffset) ]
                {
                    Border [ Fill = #00000000, Padding = (@Space2,0,@Space2,0) ]
                    {
                        StackPanel x:name="PART_HeaderBand" [ Orientation = Vertical ]
                    }
                }
                ItemsPresenter
            }
        }
    }
    Style [TargetType = DataGrid]
    {
        Template = @DefaultDataGrid;
    }

    Template x:key="DefaultDataGridRow" [TargetType = DataGridRow]
    {
        Border x:name="PART_FocusRing"
            [ Fill = #00000000,
              Padding = (@FocusRingOffset),
              CornerRadius = @RadiusMd ]
        {
            Border x:name="PART_Border"
                [ Fill = #00000000,
                  CornerRadius = @RadiusMd,
                  MinHeight = @RowHDefault ]
            {
                Border x:name="PART_Selected"
                    [ Fill = #00000000,
                      CornerRadius = @RadiusMd,
                      Padding = (@Space2,@Space1,@Space2,@Space1) ]
                {
                    ContentPresenter x:name="PART_RowContent" [ HorizontalAlignment = Stretch ]
                }
            }
        }
        when ( IsSelected ) { PART_Selected.Fill = @SurfaceSelected; }
        when ( IsMouseOver ) { PART_Border.Fill = @RowHoverFill; }
        when ( IsFocused ) { PART_FocusRing.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
        when ( IsEnabled = false ) { PART_Border.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Density = Compact ) { PART_Border.MinHeight = @RowHCompact; }
        when ( ThemeManager.Pointer = Coarse ) { PART_Border.MinHeight = @RowHTouch; }
    }
    Style [TargetType = DataGridRow]
    {
        Template = @DefaultDataGridRow;
        TextBlock.Foreground = @Fg1;
        when ( IsSelected ) { TextBlock.Foreground = @BrandGreenInk; }
    }

    Template x:key="DefaultDataGridCell" [TargetType = DataGridCell]
    {
        Border x:name="PART_CellBorder"
            [ Fill = #00000000,
              Padding = (@Space2,@Space1,@Space2,@Space1) ]
        {
            ContentPresenter x:name="PART_CellContent" [ HorizontalAlignment = Stretch, VerticalAlignment = Center ]
        }
    }
    Style [TargetType = DataGridCell]
    {
        Template = @DefaultDataGridCell;
    }
}
