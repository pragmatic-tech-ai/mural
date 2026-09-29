// Pragmatic theme — ListBox chrome (Wave 2 list-selection exemplar).
//
// The FIRST forked list-selection control and the pattern every later
// selectable-row control (TreeViewItem, ComboBoxItem, SegmentedItem)
// copies. It replaces Material's translucent state-layer ladder with the
// Pragmatic row mechanics:
//
//   * PART_FocusRing — a transparent outer Border whose Stroke only
//     appears on `when (IsFocused)` (@BorderFocus, 2dp), offset by
//     @FocusRingOffset — never a re-stroke of a state element.
//   * PART_Border — the hover surface. Rest transparent, hover steps to
//     @Bg2 (no translucent overlay).
//   * PART_Selected — a SEPARATE opaque layer above PART_Border that the
//     `when (IsSelected)` trigger fills with @SurfaceSelected, so the
//     selected cue survives a concurrent hover by z-order compositing
//     (not trigger ordering) — the Wave-1 selected-over-hover pattern.
//   * Density / pointer adapt the row HEIGHT via @RowH* tokens (MinHeight,
//     so supporting text can still grow the row) rather than re-padding a
//     state layer.
//   * Disabled dims the row to @OpacityDisabled.
//
// Row anatomy mirrors Material's: a DockPanel (LastChildFill) with
// PART_LeadingSlot docked Left, PART_TrailingSlot docked Right, and a
// centre StackPanel holding PART_HeadlineSlot (the ContentPresenter the
// ListBoxItem class routes Content through via findFirstContentPresenter)
// over PART_SupportingText. The DockPanel — not a Grid with a Star column
// — keeps DesiredSize.Width finite under the ScrollViewer's natural-width
// measure. PART names are preserved verbatim so ListBoxItem's SetChild /
// SupportingText plumbing keeps working.
//
// Only Pragmatic tokens — no raw hex, no M3 (@OnSurface / @Surface* /
// @Outline* / @Shape* / @State*Overlay / @SecondaryContainer) token.
//
// These key-less Styles ARE the framework's default templates,
// composed into MuralFramework via framework.resources.mu — there is
// no override layer and no Material to shadow.

resources ListBoxes
{
    // ── ListBox shell — structural, matching Material: a ScrollViewer
    // over the ItemsPresenter, no forced surface (the rows carry the
    // interactive chrome; a container fill would double up on whatever
    // surface the ListBox sits on).
    Template x:key="DefaultListBox" [TargetType = ListBox]
    {
        ScrollViewer x:name="PART_Scroll"
        {
            ItemsPresenter
        }
    }
    Style [TargetType = ListBox]
    {
        Template = @DefaultListBox;
    }

    // ── ListBoxItem (one row) ───────────────────────────────────────
    Template x:key="DefaultListBoxItem" [TargetType = ListBoxItem]
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
                // PART_Selected carries the row Padding (NOT PART_Border) so
                // its @SurfaceSelected fill spans the full row rect and covers
                // the @Bg2 hover fill; the Padding insets only the content.
                Border x:name="PART_Selected"
                    [ Fill = #00000000,
                      CornerRadius = @RadiusMd,
                      Padding = (@Space2,@Space1,@Space2,@Space1) ]
                {
                    DockPanel [ LastChildFill = true ]
                    {
                        Border x:name="PART_LeadingSlot"
                            [ DockPanel.Dock = Left,
                              VerticalAlignment = Center ]
                        Border x:name="PART_TrailingSlot"
                            [ DockPanel.Dock = Right,
                              VerticalAlignment = Center ]
                        StackPanel [ Orientation = Vertical, VerticalAlignment = Center ]
                        {
                            ContentPresenter x:name="PART_HeadlineSlot" [ HorizontalAlignment = Stretch ]
                            TextBlock x:name="PART_SupportingText" [ Foreground = @Fg2 ]
                        }
                    }
                }
            }
        }
        // Selection: PART_Selected opaquely covers PART_Border regardless
        // of hover (z-order compositing, not trigger order).
        when ( IsSelected ) { PART_Selected.Fill = @SurfaceSelected; }
        when ( IsMouseOver ) { PART_Border.Fill = @Bg2; }
        when ( IsFocused ) { PART_FocusRing.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
        when ( IsEnabled = false ) { PART_Border.Opacity = @OpacityDisabled; }
        // Density / pointer adjust row height only (MinHeight — content,
        // e.g. supporting text, may still grow the row past the floor).
        when ( ThemeManager.Density = Compact ) { PART_Border.MinHeight = @RowHCompact; }
        when ( ThemeManager.Pointer = Coarse ) { PART_Border.MinHeight = @RowHTouch; }
    }
    Style [TargetType = ListBoxItem]
    {
        Template = @DefaultListBoxItem;
        // Reactive headline ink. A bare string item is wrapped in a
        // Foreground-less TextBlock, so setting the attached
        // TextBlock.Foreground here (DynamicResource, reactive) cascades
        // into PART_HeadlineSlot content and survives a theme switch;
        // it flips to @BrandGreenInk on the @SurfaceSelected selected row.
        TextBlock.Foreground = @Fg1;
        when ( IsSelected ) { TextBlock.Foreground = @BrandGreenInk; }
    }
}
