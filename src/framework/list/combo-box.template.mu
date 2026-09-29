// Pragmatic theme — ComboBox chrome (Wave 2).
//
// ComboBox resolves TWO templates by x:key in its ctor (KEY_SELECTION /
// KEY_POPUP, combo-box.ts) — they can't both ride one TargetType Style —
// so this fork registers both keys plus the ComboBoxItem Style. Keys are
// verbatim ("DefaultComboBoxSelection" / "DefaultComboBoxPopup") so the
// class's resolveTemplate() finds these default templates — the
// framework's only ComboBox templates, composed into MuralFramework via
// framework.resources.mu.
//
// Selection box = Pragmatic Outlined-input chrome (mirrors the Wave-1
// TextBox Outlined look): @Bg1 fill, @BorderStrong 1dp outline, @RadiusMd,
// @Fg1 label over @Fg2 placeholder, @Fg2 chevron. Open flips the outline
// to @ControlAccent; keyboard focus paints a 2dp @BorderFocus outline;
// hover steps the fill to @Bg2. Height is FIXED (@ControlH*) — like
// Material — so the box reads as a stable row and does not stretch to fill
// a tall host (e.g. a command bar); density swaps the height token.
//
// Popup = elevated Pragmatic popover: @Bg1 surface, @Border 1dp outline,
// @RadiusLg, @ShadowMd. PART_PopupScroll keeps MaxHeight=320 +
// HorizontalScrollEnabled=false and PART_PopupList (ComboBoxItemList) so
// the class's popup wiring, height cap and scrolling are preserved.
//
// ComboBoxItem is a Border-derived row styled by a Style only (a
// ControlTemplate with Font setters would throw at applyDefaultStyle —
// see Material's note): rest transparent, hover @Bg2, selected
// @SurfaceSelected (ordered LAST). Font/ink reach the label by inheritance.
//
// Only Pragmatic tokens — no M3 (@Surface* / @Outline* / @Primary /
// @OnSurface* / @Shape* / @Elevation* / @State*Overlay / @SecondaryContainer)
// token.

resources ComboBoxes
{
    Template x:key="DefaultComboBoxSelection" [TargetType = ComboBox]
    {
        ClickableBorder x:name="PART_SelectionBox"
            [ Fill = @Bg1,
              Stroke = Pen [ Brush = @BorderStrong, Thickness = 1 ],
              CornerRadius = @RadiusMd,
              Padding = (@Space4,@Space1,@Space4,@Space1),
              Height = @ControlHDefault ]
        {
            SplitRow
            {
                Grid x:name="PART_SelectionSlot" [ VerticalAlignment = Center ]
                {
                    TextBlock x:name="PART_SelectionText"
                        [ Foreground = @Fg2,
                          VerticalAlignment = Center ]
                    TextBox x:name="PART_EditText"
                        [ Variant = Plain,
                          Visibility = Collapsed,
                          AcceptsReturn = false,
                          VerticalAlignment = Center ]
                }
                ClickableBorder x:name="PART_ChevronButton"
                    [ Fill = #00000000,
                      VerticalAlignment = Center ]
                {
                    Shape x:name="PART_Chevron"
                        [ Geometry = @ChevronDown,
                          Fill = @Fg2,
                          Width = 12,
                          Height = 12,
                          VerticalAlignment = Center ]
                }
            }
        }
        when ( IsEditable )
        {
            PART_SelectionText.Visibility = Collapsed;
            PART_EditText.Visibility = Visible;
        }
        when ( HasSelection ) { PART_SelectionText.Foreground = @Fg1; }
        when ( IsDropDownOpen ) { PART_SelectionBox.Stroke = Pen [ Brush = @ControlAccent, Thickness = 1 ]; }
        when ( PART_SelectionBox.IsMouseOver ) { PART_SelectionBox.Fill = @Bg2; }
        when ( PART_SelectionBox.IsFocused ) { PART_SelectionBox.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
        when ( IsEnabled = false ) { PART_SelectionBox.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Density = Compact ) { PART_SelectionBox.Height = @ControlHCompact; }
        when ( ThemeManager.Pointer = Coarse ) { PART_SelectionBox.Height = @ControlHTouch; }
    }

    Template x:key="DefaultComboBoxPopup" [TargetType = ComboBox]
    {
        ComboBoxPopupHost x:name="PART_PopupHost"
        {
            ClickAwayScrim x:name="PART_Scrim"
            Border x:name="PART_Popup"
                [ Fill = @Bg1,
                  Stroke = Pen [ Brush = @Border, Thickness = 1 ],
                  CornerRadius = @RadiusLg,
                  Effect = @ShadowMd,
                  Padding = (0,@Space1,0,@Space1) ]
            {
                ScrollViewer x:name="PART_PopupScroll"
                    [ MaxHeight = 320, HorizontalScrollEnabled = false ]
                {
                    ComboBoxItemList x:name="PART_PopupList"
                }
            }
        }
    }

    // ── ComboBoxItem: popup row (Style only — Border-derived) ────────
    Style [TargetType = ComboBoxItem]
    {
        Fill = #00000000;
        Padding = (@Space4,@Space2,@Space4,@Space2);
        when ( IsMouseOver ) { Fill = @Bg2; }
        when ( IsSelected ) { Fill = @SurfaceSelected; }
        when ( IsEnabled = false ) { Opacity = @OpacityDisabled; }
        when ( ThemeManager.Density = Compact ) { Padding = (@Space3,@Space1,@Space3,@Space1); }
        when ( ThemeManager.Pointer = Coarse ) { Padding = (@Space4,@Space3,@Space4,@Space3); }
    }
}
