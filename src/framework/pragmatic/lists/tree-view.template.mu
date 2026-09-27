// Pragmatic theme — TreeView chrome (Wave 2).
//
// Copies the ListBox row pattern (see list-box.template.mu) onto the
// tree row: rest transparent, hover @Bg2 on PART_Row, a dedicated opaque
// PART_Selected layer filled with @SurfaceSelected on selection (wins
// over hover by z-order), and @RowH* density via MinHeight. Focus paints
// a @BorderFocus stroke on PART_Row itself — the row's Stroke is
// otherwise unused, so it doesn't collide with the hover/selected fills.
//
// The tree-specific anatomy is preserved verbatim so TreeViewItem's
// class-side wiring keeps working: PART_OuterStack (row over child host),
// ClickableRow PART_Row (sources the row's own hover/focus so a parent
// doesn't light up when a child is hovered), PART_RowInner DockPanel with
// PART_Spacer (depth indent, Width set from depth in code), ChevronTarget
// PART_Chevron + Shape PART_ChevronGlyph (@ChevronRight, rotated in code
// on expand), PART_LeadingSlot / PART_TrailingSlot / PART_HeaderHost
// (class-managed Borders), PART_Label (string-header path), and
// PART_ChildHost (the ItemsPresenter that slots the CollapsibleStack of
// sub-rows — keeping it and the panel type intact is what preserves
// nested virtualization, ItemsControl.rebuildContainers /
// VirtualizingPanel.ResetRealization).
//
// Chevron/indent widths (20 / 12 / 0) stay inline hierarchy constants,
// as in Material — not spacing tokens. Multi-line rows grow by content
// (MinHeight floor) rather than a fixed two/three-line height token,
// which Pragmatic's catalog does not define.
//
// Only Pragmatic tokens — no M3 (@OnSurface / @OnSurfaceVariant /
// @SecondaryContainer / @State*Overlay / @Body*) token.

resources PragmaticTreeView
{
    Template x:key="DefaultTreeView" [TargetType = TreeView]
    {
        ScrollViewer x:name="PART_Scroll"
        {
            ItemsPresenter
        }
    }
    Style [TargetType = TreeView]
    {
        Template = @DefaultTreeView;
    }

    Template x:key="DefaultTreeViewItem" [TargetType = TreeViewItem]
    {
        StackPanel x:name="PART_OuterStack" [ Orientation = Vertical ]
        {
            ClickableRow x:name="PART_Row"
                [ Padding = (@Space2,@Space1,@Space2,@Space1),
                  MinHeight = @RowHDefault ]
            {
                Border x:name="PART_Selected"
                    [ Fill = #00000000,
                      CornerRadius = @RadiusMd ]
                {
                    DockPanel x:name="PART_RowInner" [ LastChildFill = true ]
                    {
                        Border x:name="PART_Spacer"
                            [ DockPanel.Dock = Left,
                              Width = 0 ]
                        ChevronTarget x:name="PART_Chevron"
                            [ DockPanel.Dock = Left,
                              Width = 20 ]
                        {
                            Shape x:name="PART_ChevronGlyph"
                                [ Geometry = @ChevronRight,
                                  Fill = @Fg2,
                                  Width = 12,
                                  Height = 12,
                                  VerticalAlignment = Center ]
                        }
                        Border x:name="PART_LeadingSlot"
                            [ DockPanel.Dock = Left,
                              VerticalAlignment = Center ]
                        Border x:name="PART_TrailingSlot"
                            [ DockPanel.Dock = Right,
                              VerticalAlignment = Center ]
                        StackPanel [ Orientation = Vertical, VerticalAlignment = Center ]
                        {
                            Border x:name="PART_HeaderHost"
                            TextBlock x:name="PART_Label" [ Foreground = @Fg1 ]
                            TextBlock x:name="PART_SupportingText" [ Foreground = @Fg2 ]
                        }
                    }
                }
            }
            ItemsPresenter x:name="PART_ChildHost"
        }
        when ( IsSelected ) { PART_Selected.Fill = @SurfaceSelected; }
        when ( PART_Row.IsMouseOver ) { PART_Row.Fill = @Bg2; }
        when ( PART_Row.IsFocused ) { PART_Row.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
        when ( IsEnabled = false ) { PART_Row.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Density = Compact ) { PART_Row.MinHeight = @RowHCompact; }
        when ( ThemeManager.Pointer = Coarse ) { PART_Row.MinHeight = @RowHTouch; }
    }
    Style [TargetType = TreeViewItem]
    {
        Template = @DefaultTreeViewItem;
        // Reactive header ink for author data-template headers (cascades
        // into a bare TextBlock); PART_Label carries its own @Fg1 (Local)
        // on the string-header path. Selected author headers flip to
        // @BrandGreenInk.
        TextBlock.Foreground = @Fg1;
        when ( IsSelected ) { TextBlock.Foreground = @BrandGreenInk; }
    }
}
