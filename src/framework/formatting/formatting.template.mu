// Default theme entries for the formatting family — the
// shape/color/brush/pen editor stack used by chart authoring panes.
//
// Merged into the root MuralFramework dictionary via an `import`
// clause in src/resources/framework.resources.mu.

resources Formatting {
    // ── ColorPicker: closed chrome ─────────────────────────────────
    // A ComboBox-style trigger: rounded outlined border housing a small
    // swatch (Fill bound to the templated parent's SwatchBrush) and
    // a chevron. ColorPicker.ctor wires the
    // PointerDown / PointerUp / PointerLeave gesture on
    // PART_SelectionTrigger; on release the picker flips IsDropDownOpen
    // and mountPopup spins up the overlay popup chrome below.
    Template x:key="DefaultColorPicker" [TargetType = ColorPicker] {
        // HorizontalAlignment=Left shrink-wraps the whole trigger to its
        // content even when the control sits in a Star/Stretch grid cell
        // (the editor-body grids place ColorPickers in a Star column).
        // Without it the outlined border stretched full-width while the
        // swatch/label/chevron clustered on the left.
        ClickableBorder x:name="PART_SelectionTrigger"
            [ Fill          = @Bg1,
              Stroke         = Pen [ Brush = @BorderStrong ],
              CornerRadius        = @RadiusSm,
              HorizontalAlignment = Left,
              Padding             = (@Space3,@Space2,@Space3,@Space2) ] {
            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Left ] {
                Border
                    [ Width           = 22,
                      Height          = 18,
                      CornerRadius    = 3,
                      Stroke     = Pen [ Brush = @Border ],
                      Margin          = (0,0,@Space3,0),
                      Fill      = $$SwatchBrush ]
                Shape x:name="PART_Chevron"
                    [ Geometry          = @ChevronDown,
                      Fill              = @Fg2,
                      Width             = 10,
                      Height            = 10,
                      VerticalAlignment = Center ]
            }
        }

        when ( PART_SelectionTrigger.IsMouseOver ) {
            PART_SelectionTrigger.Fill = @Bg2;
        }
        when ( PART_SelectionTrigger.IsPressed ) {
            PART_SelectionTrigger.Fill = @Bg3;
        }
        when ( IsDropDownOpen ) { PART_SelectionTrigger.Stroke = Pen [ Brush = @ControlAccent ]; }

        // Density ladder — same Padding shape the TextBox / SpinEdit use,
        // so the closed colour dropdown tracks the height of the numeric
        // fields it sits beside. The chevron scales too: Compact = 40%
        // smaller, Comfortable = 20% bigger than the 10dp regular glyph.
        when ( ThemeManager.Density = Compact ) {
            PART_SelectionTrigger.Padding = (@Space3,@Space1,@Space3,@Space1);
            PART_Chevron.Width = 6;
            PART_Chevron.Height = 6;
        }
        when ( ThemeManager.Density = Comfortable ) {
            PART_SelectionTrigger.Padding = (@Space3,@Space3,@Space3,@Space3);
            PART_Chevron.Width = 12;
            PART_Chevron.Height = 12;
        }
        // Coarse pointer — enlarge the closed trigger's tap target to the
        // Comfortable footprint regardless of density. Declared AFTER the
        // density triggers so a coarse pointer coinciding with Compact
        // density lands on top of the trigger stack and wins (the
        // a11y-favouring outcome).
        when ( ThemeManager.Pointer = Coarse ) {
            PART_SelectionTrigger.Padding = (@Space3,@Space3,@Space3,@Space3);
            PART_Chevron.Width = 12;
            PART_Chevron.Height = 12;
        }
    }

    // ── ColorPicker: Office-style dropdown ──────────────────────────
    // Mounted on the PresentationTarget's OverlayLayer when
    // IsDropDownOpen flips true. Four sections mirror Microsoft Office's
    // colour menu: a No-Color entry, a Theme-Colors grid (base row + five
    // `<< Lighten/Darken` tint/shade rows over `@token` bases, so it
    // tracks the active scheme), a fixed Standard-Colors row, and a
    // session Recent-Colors row (collapsed until populated). A
    // "More Colors…" entry opens the advanced editor dialog
    // (DefaultColorPickerMoreColors). ColorPicker scans PART_ThemeGrid /
    // PART_StandardRow / PART_RecentRow and wires each swatch to commit
    // its own resolved Fill colour.
    Template x:key="DefaultColorPickerPopup" [TargetType = ColorPicker] {
        MenuPopupHost x:name="PART_PopupHost" {
            ClickAwayScrim x:name="PART_Scrim"
            Border x:name="PART_PopupBody"
                [ Fill      = @Bg1,
                  Stroke     = Pen [ Brush = @Border ],
                  CornerRadius    = @RadiusLg,
                  Effect          = @ShadowMd,
                  Padding         = (0),
                  Width           = 268 ] {
                StackPanel [ Orientation = Vertical ] {
                    // ── Swatch section ─────────────────────────────
                    // The palette grids keep their own inset. The popup
                    // body itself is now padding-free so the command rows
                    // and separators below can span edge-to-edge like a
                    // popup menu. buildThemeGrid still sees a 242dp content
                    // width: 268 − 2 (body border) − 24 (this margin).
                    StackPanel [ Orientation = Vertical, Margin = (@Space3,@Space3,@Space3,@Space3) ] {
                    // ── Theme Colors ───────────────────────────────
                    // One column per ColorScheme base colour: a base row
                    // plus a tint row per scheme.tints and a shade row per
                    // scheme.shades. Built in TS (ColorPicker.buildThemeGrid)
                    // from the ColorScheme DP — predefined colours, set per
                    // picker or shared via `[ColorScheme=@key]`.
                    TextBlock
                        [ Text       = "Theme Colors",
                          Foreground = @Fg2,
                          FontSize   = @BodySmSize,
                          Margin     = (0,0,0,@Space1) ]
                    StackPanel x:name="PART_ThemeGrid" [ Orientation = Vertical ]

                    // ── Standard Colors ────────────────────────────
                    // Office's fixed standard-colour row. Static #hex
                    // literals; ColorPicker wires each like a theme swatch.
                    TextBlock
                        [ Text       = "Standard Colors",
                          Foreground = @Fg2,
                          FontSize   = @BodySmSize,
                          Margin     = (0,@Space2,0,@Space1) ]
                    StackPanel x:name="PART_StandardRow" [ Orientation = Horizontal ] {
                        ClickableBorder
                            [ Width           = 22,
                              Height          = 16,
                              CornerRadius    = 2,
                              Stroke     = Pen [ Brush = @Border ],
                              Margin          = (0,0,2,0),
                              Fill      = #C00000 ]
                        ClickableBorder
                            [ Width           = 22,
                              Height          = 16,
                              CornerRadius    = 2,
                              Stroke     = Pen [ Brush = @Border ],
                              Margin          = (0,0,2,0),
                              Fill      = #FF0000 ]
                        ClickableBorder
                            [ Width           = 22,
                              Height          = 16,
                              CornerRadius    = 2,
                              Stroke     = Pen [ Brush = @Border ],
                              Margin          = (0,0,2,0),
                              Fill      = #FFC000 ]
                        ClickableBorder
                            [ Width           = 22,
                              Height          = 16,
                              CornerRadius    = 2,
                              Stroke     = Pen [ Brush = @Border ],
                              Margin          = (0,0,2,0),
                              Fill      = #FFFF00 ]
                        ClickableBorder
                            [ Width           = 22,
                              Height          = 16,
                              CornerRadius    = 2,
                              Stroke     = Pen [ Brush = @Border ],
                              Margin          = (0,0,2,0),
                              Fill      = #92D050 ]
                        ClickableBorder
                            [ Width           = 22,
                              Height          = 16,
                              CornerRadius    = 2,
                              Stroke     = Pen [ Brush = @Border ],
                              Margin          = (0,0,2,0),
                              Fill      = #00B050 ]
                        ClickableBorder
                            [ Width           = 22,
                              Height          = 16,
                              CornerRadius    = 2,
                              Stroke     = Pen [ Brush = @Border ],
                              Margin          = (0,0,2,0),
                              Fill      = #00B0F0 ]
                        ClickableBorder
                            [ Width           = 22,
                              Height          = 16,
                              CornerRadius    = 2,
                              Stroke     = Pen [ Brush = @Border ],
                              Margin          = (0,0,2,0),
                              Fill      = #0070C0 ]
                        ClickableBorder
                            [ Width           = 22,
                              Height          = 16,
                              CornerRadius    = 2,
                              Stroke     = Pen [ Brush = @Border ],
                              Margin          = (0,0,2,0),
                              Fill      = #002060 ]
                        ClickableBorder
                            [ Width           = 22,
                              Height          = 16,
                              CornerRadius    = 2,
                              Stroke     = Pen [ Brush = @Border ],
                              Margin          = (0,0,0,0),
                              Fill      = #7030A0 ]
                    }

                    // ── Recent Colors ──────────────────────────────
                    // Collapsed until ColorPicker populates PART_RecentRow
                    // from the session-shared recents list on open.
                    StackPanel x:name="PART_RecentSection"
                        [ Orientation = Vertical,
                          Visibility  = Collapsed ] {
                        TextBlock
                            [ Text       = "Recent Colors",
                              Foreground = @Fg2,
                              FontSize   = @BodySmSize,
                              Margin     = (0,@Space2,0,@Space1) ]
                        WrapPanel x:name="PART_RecentRow" [ Orientation = Horizontal ]
                    }
                    }

                    // ── Command menu ───────────────────────────────
                    // Below the swatch grids sits a popup-menu-style block:
                    // full-width rows with a hover state-layer, delimited by
                    // thin separators. Order (top→bottom): More Colors…,
                    // No Color, then Color Scheme ▸ (a side-flyout submenu).
                    // Rows + separators span edge-to-edge because the body
                    // has no padding. Built inline — deliberately NOT reusing
                    // the MenuItem / MenuSeparator templates.
                    Border [ Height = 1, Fill = @Border ]

                    // More Colors… — opens the advanced editor dialog
                    // (HS box + sliders + hex) as a secondary overlay.
                    ClickableBorder x:name="PART_MoreColors"
                        [ Padding = (@Space3,@Space2,@Space3,@Space2) ] {
                        TextBlock
                            [ Text       = "More Colors…",
                              Foreground = @Fg1,
                              Style      = @UiLabel ]
                    }

                    Border [ Height = 1, Fill = @Border ]

                    // No Color — clears the selection to a transparent
                    // sentinel. Plain text row, matching More Colors.
                    ClickableBorder x:name="PART_NoColor"
                        [ Padding = (@Space3,@Space2,@Space3,@Space2) ] {
                        TextBlock
                            [ Text       = "No Color",
                              Foreground = @Fg1,
                              Style      = @UiLabel ]
                    }

                    Border [ Height = 1, Fill = @Border ]

                    // Color Scheme — side-flyout submenu. The chevron marks
                    // it expandable; ColorPicker anchors the scheme gallery
                    // to this row (MenuAnchorSide.Right) so it opens to the
                    // right like a nested menu. PART_SchemeName shows the
                    // active scheme; ColorPicker keeps it in sync.
                    ClickableBorder x:name="PART_SchemeButton"
                        [ Padding = (@Space3,@Space2,@Space3,@Space2) ] {
                        DockPanel {
                            Shape
                                [ DockPanel.Dock    = Right,
                                  Geometry          = @ChevronRight,
                                  Fill              = @Fg2,
                                  Width             = 12,
                                  Height            = 12,
                                  VerticalAlignment = Center ]
                            StackPanel [ Orientation = Horizontal ] {
                                TextBlock
                                    [ Text              = "Color Scheme",
                                      Foreground        = @Fg1,
                                      Style             = @UiLabel,
                                      VerticalAlignment = Center ]
                                TextBlock x:name="PART_SchemeName"
                                    [ Text              = "Office",
                                      Foreground        = @Fg2,
                                      Style             = @UiCaption,
                                      VerticalAlignment = Center,
                                      Margin            = (@Space2,0,0,0) ]
                            }
                        }
                    }
                }
            }
        }

        when ( PART_NoColor.IsMouseOver ) { PART_NoColor.Fill = @Bg2; }
        when ( PART_SchemeButton.IsMouseOver ) {
            PART_SchemeButton.Fill = @Bg2;
        }
        when ( PART_MoreColors.IsMouseOver ) { PART_MoreColors.Fill = @Bg2; }
    }

    // ── ColorPicker: More Colors… dialog ───────────────────────────
    // The advanced custom-colour editor, opened from the dropdown's
    // "More Colors…" entry (IsMoreColorsOpen). Office-classic 2D
    // hue/saturation gradient box + brightness rail, R/G/B/A sliders and
    // a hex field, capped with Cancel / OK. ColorPicker snapshots the
    // colour on open so Cancel can restore it; OK commits + records a
    // recent. PART names match the dropdown editor wiring in
    // color-picker.ts (PART_HsBox / PART_VRail / PART_RSlider / …).
    Template x:key="DefaultColorPickerMoreColors" [TargetType = ColorPicker] {
        MenuPopupHost x:name="PART_PopupHost" {
            ClickAwayScrim x:name="PART_Scrim"
            Border x:name="PART_PopupBody"
                [ Fill      = @Bg1,
                  Stroke     = Pen [ Brush = @Border ],
                  CornerRadius    = @RadiusLg,
                  Effect          = @ShadowMd,
                  Padding         = (10),
                  Width           = 280 ] {
                StackPanel [ Orientation = Vertical ] {
                    TextBlock
                        [ Text       = "More Colors",
                          Foreground = @Fg1,
                          Style      = @UiLabel,
                          Margin     = (0,0,0,@Space3) ]

                    StackPanel [ Orientation = Horizontal, Margin = (0,0,0,8) ] {
                        Border
                            [ Width           = 36,
                              Height          = 36,
                              CornerRadius    = 4,
                              Stroke     = Pen [ Brush = @Border ],
                              Margin          = (0,0,8,0),
                              Fill      = $$SwatchBrush ]
                        TextBox x:name="PART_HexInput" [ Width = 220, VerticalAlignment = Center ]
                    }

                    StackPanel [ Orientation = Horizontal, Margin = (0,0,0,12) ] {
                        Canvas x:name="PART_HsBox" [ Width = 220, Height = 140 ] {
                            Border x:name="PART_HsBoxHue" [ Width = 220, Height = 140 ]
                            Border x:name="PART_HsBoxOverlay" [ Width = 220, Height = 140 ]
                            Border x:name="PART_HsBoxCursor"
                                [ Width           = 12,
                                  Height          = 12,
                                  CornerRadius    = 6,
                                  Stroke     = (#ffffff, 2) ]
                        }
                        Canvas x:name="PART_VRail" [ Width = 20, Height = 140, Margin = (12,0,0,0) ] {
                            Border x:name="PART_VRailFill"
                                [ Width           = 20,
                                  Height          = 140,
                                  Stroke     = Pen [ Brush = @Border ] ]
                            Border x:name="PART_VRailCursor"
                                [ Width      = 26,
                                  Height     = 4,
                                  Fill = #1f2937 ]
                        }
                    }

                    StackPanel [ Orientation = Horizontal, Margin = (0,4,0,0) ] {
                        TextBlock
                            [ Text              = "R",
                              Width             = 14,
                              Foreground        = @Fg2,
                              VerticalAlignment = Center,
                              Margin            = (0,0,6,0) ]
                        Slider x:name="PART_RSlider"
                            [ Width       = 240,
                              Minimum     = 0,
                              Maximum     = 255,
                              SmallChange = 1,
                              LargeChange = 16 ]
                    }
                    StackPanel [ Orientation = Horizontal, Margin = (0,4,0,0) ] {
                        TextBlock
                            [ Text              = "G",
                              Width             = 14,
                              Foreground        = @Fg2,
                              VerticalAlignment = Center,
                              Margin            = (0,0,6,0) ]
                        Slider x:name="PART_GSlider"
                            [ Width       = 240,
                              Minimum     = 0,
                              Maximum     = 255,
                              SmallChange = 1,
                              LargeChange = 16 ]
                    }
                    StackPanel [ Orientation = Horizontal, Margin = (0,4,0,0) ] {
                        TextBlock
                            [ Text              = "B",
                              Width             = 14,
                              Foreground        = @Fg2,
                              VerticalAlignment = Center,
                              Margin            = (0,0,6,0) ]
                        Slider x:name="PART_BSlider"
                            [ Width       = 240,
                              Minimum     = 0,
                              Maximum     = 255,
                              SmallChange = 1,
                              LargeChange = 16 ]
                    }
                    StackPanel [ Orientation = Horizontal, Margin = (0,4,0,0) ] {
                        TextBlock
                            [ Text              = "A",
                              Width             = 14,
                              Foreground        = @Fg2,
                              VerticalAlignment = Center,
                              Margin            = (0,0,6,0) ]
                        Slider x:name="PART_ASlider"
                            [ Width       = 240,
                              Minimum     = 0,
                              Maximum     = 255,
                              SmallChange = 1,
                              LargeChange = 16 ]
                    }

                    StackPanel
                        [ Orientation         = Horizontal,
                          HorizontalAlignment = Right,
                          Margin              = (0,@Space4,0,0) ] {
                        ClickableBorder x:name="PART_MoreCancel"
                            [ CornerRadius = @RadiusSm,
                              Padding      = (@Space4,@Space2,@Space4,@Space2),
                              Margin       = (0,0,@Space2,0) ] {
                            TextBlock
                                [ Text       = "Cancel",
                                  Foreground = @ControlAccent,
                                  FontSize   = @UiLabelSize ]
                        }
                        ClickableBorder x:name="PART_MoreOk"
                            [ CornerRadius = @RadiusSm,
                              Fill   = @ControlAccent,
                              Padding      = (@Space4,@Space2,@Space4,@Space2) ] {
                            TextBlock
                                [ Text       = "OK",
                                  Foreground = @BrandGreenInk,
                                  FontSize   = @UiLabelSize ]
                        }
                    }
                }
            }
        }

        when ( PART_MoreCancel.IsMouseOver ) { PART_MoreCancel.Fill = @Bg2; }
    }

    // ── ColorPicker: scheme gallery (Office "Colors") ──────────────
    // Opened from the dropdown's "Colors:" button. A scrollable list of
    // the built-in ColorSchemes; ColorPicker.buildSchemeList fills
    // PART_SchemeList with a preview-strip + name row per scheme, and
    // selecting one sets the ColorScheme and returns to the dropdown.
    Template x:key="DefaultColorPickerSchemeGallery" [TargetType = ColorPicker] {
        MenuPopupHost x:name="PART_PopupHost" {
            ClickAwayScrim x:name="PART_Scrim"
            Border x:name="PART_PopupBody"
                [ Fill      = @Bg1,
                  Stroke     = Pen [ Brush = @Border ],
                  CornerRadius    = @RadiusLg,
                  Effect          = @ShadowMd,
                  Padding         = (@Space2),
                  Width           = 288 ] {
                // Width sized to the widest scheme row (preview strip + full
                // name like "Office 2013 - 2022", ~247dp measured) plus the
                // vertical-scrollbar gutter, so names fit without clipping —
                // horizontal scroll is off (vertical only), so anything that
                // overflows would otherwise be cut flush against the bar.
                ScrollViewer [ Height = 360, HorizontalScrollEnabled = false ] {
                    StackPanel x:name="PART_SchemeList" [ Orientation = Vertical ]
                }
            }
        }

    }

    Style [TargetType = ColorPicker] {
        Template = @DefaultColorPicker;
        PopupTemplate = @DefaultColorPickerPopup;
        MoreColorsTemplate = @DefaultColorPickerMoreColors;
        SchemeGalleryTemplate = @DefaultColorPickerSchemeGallery;
    }

    // ── BrushPicker: closed chrome ─────────────────────────────────
    // ComboBox-style trigger like ColorPicker, but the swatch shows
    // the current Brush (not just a colour), so it previews gradients
    // and patterns alongside solid fills. The label reads the variant
    // name — "Solid", "Linear", "Radial", "Pattern" — so the closed
    // chrome conveys which brush flavour is bound without making the
    // user open the popup. BrushPicker.ctor wires PointerDown / Up /
    // Leave on PART_SelectionTrigger.
    Template x:key="DefaultBrushPicker" [TargetType = BrushPicker] {
        ClickableBorder x:name="PART_SelectionTrigger"
            [ Fill      = @Bg1,
              Stroke     = Pen [ Brush = @BorderStrong ],
              CornerRadius    = @RadiusSm,
              Padding         = (@Space3,@Space2,@Space3,@Space2) ] {
            StackPanel [ Orientation = Horizontal ] {
                Border
                    [ Width           = 36,
                      Height          = 18,
                      CornerRadius    = 3,
                      Stroke     = Pen [ Brush = @Border ],
                      Margin          = (0,0,@Space3,0),
                      Fill      = $$PreviewBrush ]
                TextBlock x:name="PART_VariantLabel"
                    [ Text              = "Solid",
                      Foreground        = @Fg1,
                      Style             = @Body,
                      VerticalAlignment = Center,
                      Margin            = (0,0,@Space3,0) ]
                Shape x:name="PART_Chevron"
                    [ Geometry          = @ChevronDown,
                      Fill              = @Fg2,
                      Width             = 10,
                      Height            = 10,
                      VerticalAlignment = Center ]
            }
        }

        when ( PART_SelectionTrigger.IsMouseOver ) {
            PART_SelectionTrigger.Fill = @Bg2;
        }
        when ( PART_SelectionTrigger.IsPressed ) {
            PART_SelectionTrigger.Fill = @Bg3;
        }
        when ( IsDropDownOpen ) { PART_SelectionTrigger.Stroke = Pen [ Brush = @ControlAccent ]; }
        when ( Variant = Linear ) { PART_VariantLabel.Text = "Linear gradient"; }
        when ( Variant = Radial ) { PART_VariantLabel.Text = "Radial gradient"; }
        when ( Variant = Pattern ) { PART_VariantLabel.Text = "Pattern"; }

        // Density ladder — mirror the TextBox / SpinEdit / ColorPicker
        // padding shape so the closed brush dropdown matches sibling
        // field heights, and scale the chevron the same way (Compact 40%
        // smaller, Comfortable 20% bigger than the 10dp regular glyph).
        when ( ThemeManager.Density = Compact ) {
            PART_SelectionTrigger.Padding = (@Space3,@Space1,@Space3,@Space1);
            PART_Chevron.Width = 6;
            PART_Chevron.Height = 6;
        }
        when ( ThemeManager.Density = Comfortable ) {
            PART_SelectionTrigger.Padding = (@Space3,@Space3,@Space3,@Space3);
            PART_Chevron.Width = 12;
            PART_Chevron.Height = 12;
        }
        // Coarse pointer — enlarge the closed trigger to the Comfortable
        // footprint regardless of density; declared last so it wins over a
        // coincident Compact density trigger. Mirrors ColorPicker.
        when ( ThemeManager.Pointer = Coarse ) {
            PART_SelectionTrigger.Padding = (@Space3,@Space3,@Space3,@Space3);
            PART_Chevron.Width = 12;
            PART_Chevron.Height = 12;
        }
    }

    // ── BrushPicker: shared popup chrome helper ────────────────────
    // Every variant popup shares the same outer shell (host / scrim /
    // body) and the same four-tab row at top — the only thing that
    // differs is the variant-specific sub-editor block in the middle.
    // Tabs use ClickableBorder + state triggers; BrushPicker.mountPopup
    // wires PointerUp on each to write Variant.

    // Solid variant popup — embeds a ColorPicker for the colour body.
    Template x:key="DefaultBrushPickerSolid" [TargetType = BrushPicker] {
        MenuPopupHost x:name="PART_PopupHost" {
            ClickAwayScrim x:name="PART_Scrim"
            Border x:name="PART_PopupBody"
                [ Fill      = @Bg1,
                  Stroke     = Pen [ Brush = @Border ],
                  CornerRadius    = @RadiusLg,
                  Effect          = @ShadowMd,
                  Padding         = (10),
                  Width           = 320 ] {
                StackPanel [ Orientation = Vertical ] {
                    // ── Variant tabs ─────────────────────────────
                    StackPanel [ Orientation = Horizontal, Margin = (0,0,0,10) ] {
                        ClickableBorder x:name="PART_TabSolid"
                            [ Fill   = @SurfaceSelected,
                              CornerRadius = @RadiusSm,
                              Padding      = (10,4,10,4),
                              Margin       = (0,0,4,0) ] {
                            TextBlock
                                [ Text       = "Solid",
                                  Foreground = @BrandGreenInk,
                                  Style      = @UiCaption ]
                        }
                        ClickableBorder x:name="PART_TabLinear"
                            [ Fill   = @Bg1,
                              CornerRadius = @RadiusSm,
                              Padding      = (10,4,10,4),
                              Margin       = (0,0,4,0) ] {
                            TextBlock
                                [ Text       = "Linear",
                                  Foreground = @Fg1,
                                  Style      = @UiCaption ]
                        }
                        ClickableBorder x:name="PART_TabRadial"
                            [ Fill   = @Bg1,
                              CornerRadius = @RadiusSm,
                              Padding      = (10,4,10,4),
                              Margin       = (0,0,4,0) ] {
                            TextBlock
                                [ Text       = "Radial",
                                  Foreground = @Fg1,
                                  Style      = @UiCaption ]
                        }
                        ClickableBorder x:name="PART_TabPattern"
                            [ Fill   = @Bg1,
                              CornerRadius = @RadiusSm,
                              Padding      = (10,4,10,4) ] {
                            TextBlock
                                [ Text       = "Pattern",
                                  Foreground = @Fg1,
                                  Style      = @UiCaption ]
                        }
                    }
                    // ── Solid body ───────────────────────────────
                    ColorPicker x:name="PART_SolidColor" [ Variant = RGB ]
                }
            }
        }
    }

    // Linear gradient variant popup. Two embedded ColorPickers + an
    // angle slider. Renders a 2-stop linear brush; BrushPicker maps
    // angle (degrees) onto StartPoint/EndPoint in [0,1] bbox coords.
    Template x:key="DefaultBrushPickerLinear" [TargetType = BrushPicker] {
        MenuPopupHost x:name="PART_PopupHost" {
            ClickAwayScrim x:name="PART_Scrim"
            Border x:name="PART_PopupBody"
                [ Fill      = @Bg1,
                  Stroke     = Pen [ Brush = @Border ],
                  CornerRadius    = @RadiusLg,
                  Effect          = @ShadowMd,
                  Padding         = (10),
                  Width           = 320 ] {
                StackPanel [ Orientation = Vertical ] {
                    StackPanel [ Orientation = Horizontal, Margin = (0,0,0,10) ] {
                        ClickableBorder x:name="PART_TabSolid"
                            [ Fill   = @Bg1,
                              CornerRadius = @RadiusSm,
                              Padding      = (10,4,10,4),
                              Margin       = (0,0,4,0) ] {
                            TextBlock
                                [ Text       = "Solid",
                                  Foreground = @Fg1,
                                  Style      = @UiCaption ]
                        }
                        ClickableBorder x:name="PART_TabLinear"
                            [ Fill   = @SurfaceSelected,
                              CornerRadius = @RadiusSm,
                              Padding      = (10,4,10,4),
                              Margin       = (0,0,4,0) ] {
                            TextBlock
                                [ Text       = "Linear",
                                  Foreground = @BrandGreenInk,
                                  Style      = @UiCaption ]
                        }
                        ClickableBorder x:name="PART_TabRadial"
                            [ Fill   = @Bg1,
                              CornerRadius = @RadiusSm,
                              Padding      = (10,4,10,4),
                              Margin       = (0,0,4,0) ] {
                            TextBlock
                                [ Text       = "Radial",
                                  Foreground = @Fg1,
                                  Style      = @UiCaption ]
                        }
                        ClickableBorder x:name="PART_TabPattern"
                            [ Fill   = @Bg1,
                              CornerRadius = @RadiusSm,
                              Padding      = (10,4,10,4) ] {
                            TextBlock
                                [ Text       = "Pattern",
                                  Foreground = @Fg1,
                                  Style      = @UiCaption ]
                        }
                    }
                    StackPanel [ Orientation = Vertical, Margin = (0,4,0,0) ] {
                        TextBlock
                            [ Text       = "Start colour",
                              Style      = @UiCaption,
                              Foreground = @Fg2,
                              Margin     = (0,0,0,2) ]
                        ColorPicker x:name="PART_LinearStart"
                        TextBlock
                            [ Text       = "End colour",
                              Style      = @UiCaption,
                              Foreground = @Fg2,
                              Margin     = (0,8,0,2) ]
                        ColorPicker x:name="PART_LinearEnd"
                        StackPanel [ Orientation = Horizontal, Margin = (0,10,0,0) ] {
                            TextBlock
                                [ Text              = "Angle",
                                  Width             = 48,
                                  Style             = @UiCaption,
                                  Foreground        = @Fg2,
                                  VerticalAlignment = Center ]
                            Slider x:name="PART_LinearAngle"
                                [ Width       = 240,
                                  Minimum     = -180,
                                  Maximum     = 180,
                                  SmallChange = 1,
                                  LargeChange = 15 ]
                        }
                    }
                }
            }
        }
    }

    // Radial gradient variant popup. Two colour stops (inner/outer) +
    // CenterX/CenterY in [0..100] (mapped to 0..1 by BrushPicker) +
    // Radius in [0..100].
    Template x:key="DefaultBrushPickerRadial" [TargetType = BrushPicker] {
        MenuPopupHost x:name="PART_PopupHost" {
            ClickAwayScrim x:name="PART_Scrim"
            Border x:name="PART_PopupBody"
                [ Fill      = @Bg1,
                  Stroke     = Pen [ Brush = @Border ],
                  CornerRadius    = @RadiusLg,
                  Effect          = @ShadowMd,
                  Padding         = (10),
                  Width           = 320 ] {
                StackPanel [ Orientation = Vertical ] {
                    StackPanel [ Orientation = Horizontal, Margin = (0,0,0,10) ] {
                        ClickableBorder x:name="PART_TabSolid"
                            [ Fill   = @Bg1,
                              CornerRadius = @RadiusSm,
                              Padding      = (10,4,10,4),
                              Margin       = (0,0,4,0) ] {
                            TextBlock
                                [ Text       = "Solid",
                                  Foreground = @Fg1,
                                  Style      = @UiCaption ]
                        }
                        ClickableBorder x:name="PART_TabLinear"
                            [ Fill   = @Bg1,
                              CornerRadius = @RadiusSm,
                              Padding      = (10,4,10,4),
                              Margin       = (0,0,4,0) ] {
                            TextBlock
                                [ Text       = "Linear",
                                  Foreground = @Fg1,
                                  Style      = @UiCaption ]
                        }
                        ClickableBorder x:name="PART_TabRadial"
                            [ Fill   = @SurfaceSelected,
                              CornerRadius = @RadiusSm,
                              Padding      = (10,4,10,4),
                              Margin       = (0,0,4,0) ] {
                            TextBlock
                                [ Text       = "Radial",
                                  Foreground = @BrandGreenInk,
                                  Style      = @UiCaption ]
                        }
                        ClickableBorder x:name="PART_TabPattern"
                            [ Fill   = @Bg1,
                              CornerRadius = @RadiusSm,
                              Padding      = (10,4,10,4) ] {
                            TextBlock
                                [ Text       = "Pattern",
                                  Foreground = @Fg1,
                                  Style      = @UiCaption ]
                        }
                    }
                    StackPanel [ Orientation = Vertical, Margin = (0,4,0,0) ] {
                        TextBlock
                            [ Text       = "Inner colour",
                              Style      = @UiCaption,
                              Foreground = @Fg2,
                              Margin     = (0,0,0,2) ]
                        ColorPicker x:name="PART_RadialInner"
                        TextBlock
                            [ Text       = "Outer colour",
                              Style      = @UiCaption,
                              Foreground = @Fg2,
                              Margin     = (0,8,0,2) ]
                        ColorPicker x:name="PART_RadialOuter"
                        StackPanel [ Orientation = Horizontal, Margin = (0,10,0,0) ] {
                            TextBlock
                                [ Text              = "Cx %",
                                  Width             = 48,
                                  Style             = @UiCaption,
                                  Foreground        = @Fg2,
                                  VerticalAlignment = Center ]
                            Slider x:name="PART_RadialCenterX"
                                [ Width       = 240,
                                  Minimum     = 0,
                                  Maximum     = 100,
                                  SmallChange = 1,
                                  LargeChange = 10 ]
                        }
                        StackPanel [ Orientation = Horizontal, Margin = (0,4,0,0) ] {
                            TextBlock
                                [ Text              = "Cy %",
                                  Width             = 48,
                                  Style             = @UiCaption,
                                  Foreground        = @Fg2,
                                  VerticalAlignment = Center ]
                            Slider x:name="PART_RadialCenterY"
                                [ Width       = 240,
                                  Minimum     = 0,
                                  Maximum     = 100,
                                  SmallChange = 1,
                                  LargeChange = 10 ]
                        }
                        StackPanel [ Orientation = Horizontal, Margin = (0,4,0,0) ] {
                            TextBlock
                                [ Text              = "Radius %",
                                  Width             = 48,
                                  Style             = @UiCaption,
                                  Foreground        = @Fg2,
                                  VerticalAlignment = Center ]
                            Slider x:name="PART_RadialRadius"
                                [ Width       = 240,
                                  Minimum     = 1,
                                  Maximum     = 100,
                                  SmallChange = 1,
                                  LargeChange = 10 ]
                        }
                    }
                }
            }
        }
    }

    // Pattern variant popup. ComboBox to choose PatternKind, two
    // ColorPickers (fg + bg) and three sliders (Size / Angle /
    // StrokeThickness). PART_PatternKind's Items + SelectedItem are
    // populated by BrushPicker.adoptPopupParts — string-enum values
    // map straight through onto PatternBrush.Kind.
    Template x:key="DefaultBrushPickerPattern" [TargetType = BrushPicker] {
        MenuPopupHost x:name="PART_PopupHost" {
            ClickAwayScrim x:name="PART_Scrim"
            Border x:name="PART_PopupBody"
                [ Fill      = @Bg1,
                  Stroke     = Pen [ Brush = @Border ],
                  CornerRadius    = @RadiusLg,
                  Effect          = @ShadowMd,
                  Padding         = (10),
                  Width           = 320 ] {
                StackPanel [ Orientation = Vertical ] {
                    StackPanel [ Orientation = Horizontal, Margin = (0,0,0,10) ] {
                        ClickableBorder x:name="PART_TabSolid"
                            [ Fill   = @Bg1,
                              CornerRadius = @RadiusSm,
                              Padding      = (10,4,10,4),
                              Margin       = (0,0,4,0) ] {
                            TextBlock
                                [ Text       = "Solid",
                                  Foreground = @Fg1,
                                  Style      = @UiCaption ]
                        }
                        ClickableBorder x:name="PART_TabLinear"
                            [ Fill   = @Bg1,
                              CornerRadius = @RadiusSm,
                              Padding      = (10,4,10,4),
                              Margin       = (0,0,4,0) ] {
                            TextBlock
                                [ Text       = "Linear",
                                  Foreground = @Fg1,
                                  Style      = @UiCaption ]
                        }
                        ClickableBorder x:name="PART_TabRadial"
                            [ Fill   = @Bg1,
                              CornerRadius = @RadiusSm,
                              Padding      = (10,4,10,4),
                              Margin       = (0,0,4,0) ] {
                            TextBlock
                                [ Text       = "Radial",
                                  Foreground = @Fg1,
                                  Style      = @UiCaption ]
                        }
                        ClickableBorder x:name="PART_TabPattern"
                            [ Fill   = @SurfaceSelected,
                              CornerRadius = @RadiusSm,
                              Padding      = (10,4,10,4) ] {
                            TextBlock
                                [ Text       = "Pattern",
                                  Foreground = @BrandGreenInk,
                                  Style      = @UiCaption ]
                        }
                    }
                    StackPanel [ Orientation = Vertical, Margin = (0,4,0,0) ] {
                        StackPanel [ Orientation = Horizontal, Margin = (0,0,0,8) ] {
                            TextBlock
                                [ Text              = "Kind",
                                  Width             = 64,
                                  Style             = @UiCaption,
                                  Foreground        = @Fg2,
                                  VerticalAlignment = Center ]
                            ComboBox x:name="PART_PatternKind" [ Width = 232 ]
                        }
                        TextBlock
                            [ Text       = "Foreground",
                              Style      = @UiCaption,
                              Foreground = @Fg2,
                              Margin     = (0,0,0,2) ]
                        ColorPicker x:name="PART_PatternForeground"
                        TextBlock
                            [ Text       = "Background",
                              Style      = @UiCaption,
                              Foreground = @Fg2,
                              Margin     = (0,8,0,2) ]
                        ColorPicker x:name="PART_PatternBackground"
                        StackPanel [ Orientation = Horizontal, Margin = (0,10,0,0) ] {
                            TextBlock
                                [ Text              = "Size",
                                  Width             = 64,
                                  Style             = @UiCaption,
                                  Foreground        = @Fg2,
                                  VerticalAlignment = Center ]
                            Slider x:name="PART_PatternSize"
                                [ Width       = 232,
                                  Minimum     = 2,
                                  Maximum     = 64,
                                  SmallChange = 1,
                                  LargeChange = 4 ]
                        }
                        StackPanel [ Orientation = Horizontal, Margin = (0,4,0,0) ] {
                            TextBlock
                                [ Text              = "Angle",
                                  Width             = 64,
                                  Style             = @UiCaption,
                                  Foreground        = @Fg2,
                                  VerticalAlignment = Center ]
                            Slider x:name="PART_PatternAngle"
                                [ Width       = 232,
                                  Minimum     = 0,
                                  Maximum     = 180,
                                  SmallChange = 1,
                                  LargeChange = 15 ]
                        }
                        StackPanel [ Orientation = Horizontal, Margin = (0,4,0,0) ] {
                            TextBlock
                                [ Text              = "Stroke",
                                  Width             = 64,
                                  Style             = @UiCaption,
                                  Foreground        = @Fg2,
                                  VerticalAlignment = Center ]
                            Slider x:name="PART_PatternStroke"
                                [ Width       = 232,
                                  Minimum     = 0.5,
                                  Maximum     = 8,
                                  SmallChange = 0.5,
                                  LargeChange = 1 ]
                        }
                    }
                }
            }
        }
    }

    Style [TargetType = BrushPicker] {
        Template = @DefaultBrushPicker;
        PopupTemplate = @DefaultBrushPickerSolid;
        when ( Variant = Linear ) { PopupTemplate = @DefaultBrushPickerLinear; }
        when ( Variant = Radial ) { PopupTemplate = @DefaultBrushPickerRadial; }
        when ( Variant = Pattern ) { PopupTemplate = @DefaultBrushPickerPattern; }
    }

    // ── PenEditor: inline expanded panel ───────────────────────────
    // PowerPoint-style: one column of labelled rows. BrushPicker on
    // the Brush row uses TemplateBinding for Brush; sliders /
    // comboboxes for the simpler DPs. PenEditor.OnPropertyChanged
    // pushes each row's value onto its bound Pen so the consumer's
    // Stroke updates as the user drags.
    //
    // The MiterLimit row is the only visibility-gated row — the
    // theme has no `Visibility` enum yet, so we fake the toggle by
    // collapsing the row's MaxHeight (and clearing its padding) when
    // LineJoin ≠ Miter. The PART_MiterRow.Padding setter on the
    // default branch carries the resting layout; the trigger zeroes
    // it out when the editor's Join isn't Miter.
    Template x:key="DefaultPenEditor" [TargetType = PenEditor] {
        Grid [ MaxWidth = 300 ] {
            // One 2-column section grid: title / rule / stroke-brush span
            // both columns; the property rows below are label (col0) |
            // editor (col1). The label column shares "ShapeFormatLabels"
            // so it aligns with the Fill section and the cap section.
            ColumnDefinitions {
                ColumnDefinition [ Width = GridLength.Auto, SharedSizeGroup = "ShapeFormatLabels" ]
                ColumnDefinition [ Width = GridLength.Star ]
            }
            RowDefinitions {
                RowDefinition [ Height = GridLength.Auto ]
                RowDefinition [ Height = GridLength.Auto ]
                RowDefinition [ Height = GridLength.Auto ]
                RowDefinition [ Height = GridLength.Auto ]
            }
            // Section header + rule span both columns; Fill/Line read with
            // identical chrome.
            TextBlock
                [ Grid.Row        = 0,
                  Grid.ColumnSpan = 2,
                  Style           = @UiLabel,
                  Text            = "Line",
                  Foreground      = @Fg1,
                  Margin          = (0,0,0,@Space2) ]
            Divider [ Grid.Row = 1, Grid.ColumnSpan = 2, Margin = (0,0,0,@Space3) ]
            // Stroke brush — the SAME tabbed variant editor the Fill section
            // uses, inline. Spans both columns; Header="" suppresses its own
            // title since the "Line" header names the section. Its internal
            // label columns join the shared group, so the brush's
            // "Colour"/"Transparency" labels align with the rows below.
            FillEditor x:name="PART_BrushEditor"
                [ Grid.Row        = 2,
                  Grid.ColumnSpan = 2,
                  Header          = "",
                  Margin          = (0,0,0,@Space4) ]
            // Two-column property grid — left column Auto-sized to the
            // widest label, right column takes the rest. Each editor row
            // is its own RowDefinition. The Miter limit row's label +
            // editor are separately named so PenEditor.ts can flip both
            // to Visibility=Collapsed when LineJoin ≠ Miter; with both
            // cells in the row Collapsed, the Auto-sized row height
            // contracts to 0 and the row visually disappears.
            //
            // MaxWidth caps the Star column when the host is unbounded
            // (e.g., inside a ScrollViewer that measures with Infinity).
            // Without it the Star track inflates to Infinity and child
            // rects emit NaN/Infinity into the SVG output.
            Grid [ Grid.Row = 3, Grid.ColumnSpan = 2 ] {
                ColumnDefinitions {
                    ColumnDefinition [ Width = GridLength.Auto, SharedSizeGroup = "ShapeFormatLabels" ]
                    ColumnDefinition [ Width = GridLength.Star ]
                }
                RowDefinitions {
                    RowDefinition [ Height = GridLength.Auto ]
                    RowDefinition [ Height = GridLength.Auto ]
                    RowDefinition [ Height = GridLength.Auto ]
                    RowDefinition [ Height = GridLength.Auto ]
                    RowDefinition [ Height = GridLength.Auto ]
                }
                // Thickness — narrow numeric SpinEdit, kept compact
                // (MaxWidth=120) so the editor cell stays consistent
                // with the Fill section's transparency input. (The stroke
                // brush moved out of this grid into PART_BrushEditor above.)
                TextBlock
                    [ Grid.Row          = 0,
                      Grid.Column       = 0,
                      Style             = @UiCaption,
                      Text              = "Thickness",
                      Foreground        = @Fg1,
                      VerticalAlignment = Center,
                      Margin            = (0,0,@Space3,@Space3) ]
                SpinEdit x:name="PART_Thickness"
                    [ Grid.Row            = 0,
                      Grid.Column         = 1,
                      TextBlock.FontSize  = @BodySmSize,
                      HorizontalAlignment = Right,
                      MaxWidth            = 120,
                      Width               = 120,
                      Minimum             = 0,
                      Maximum             = 24,
                      SmallChange         = 0.5,
                      LargeChange         = 2,
                      DecimalPlaces       = 1,
                      Margin              = (0,0,0,@Space3) ]
                // DashStyle — Items + SelectedItem populated by
                // PenEditor.adoptTemplateParts (see DASH_OPTIONS there).
                // DisplayMemberPath = "Label" so the dropdown shows the
                // human strings; the editor reads .Value back.
                TextBlock
                    [ Grid.Row          = 1,
                      Grid.Column       = 0,
                      Style             = @UiCaption,
                      Text              = "Dash",
                      Foreground        = @Fg1,
                      VerticalAlignment = Center,
                      Margin            = (0,0,@Space3,@Space3) ]
                ComboBox x:name="PART_Dash"
                    [ Grid.Row            = 1,
                      Grid.Column         = 1,
                      TextBlock.FontSize  = @BodySmSize,
                      DisplayMemberPath   = "Label",
                      HorizontalAlignment = Right,
                      MaxWidth            = 120,
                      Width               = 120,
                      Margin              = (0,0,0,@Space3) ]
                // Cap
                TextBlock
                    [ Grid.Row          = 2,
                      Grid.Column       = 0,
                      Style             = @UiCaption,
                      Text              = "Cap",
                      Foreground        = @Fg1,
                      VerticalAlignment = Center,
                      Margin            = (0,0,@Space3,@Space3) ]
                ComboBox x:name="PART_Cap"
                    [ Grid.Row            = 2,
                      Grid.Column         = 1,
                      TextBlock.FontSize  = @BodySmSize,
                      DisplayMemberPath   = "Label",
                      HorizontalAlignment = Right,
                      MaxWidth            = 120,
                      Width               = 120,
                      Margin              = (0,0,0,@Space3) ]
                // Join
                TextBlock
                    [ Grid.Row          = 3,
                      Grid.Column       = 0,
                      Style             = @UiCaption,
                      Text              = "Join",
                      Foreground        = @Fg1,
                      VerticalAlignment = Center,
                      Margin            = (0,0,@Space3,@Space3) ]
                ComboBox x:name="PART_Join"
                    [ Grid.Row            = 3,
                      Grid.Column         = 1,
                      TextBlock.FontSize  = @BodySmSize,
                      DisplayMemberPath   = "Label",
                      HorizontalAlignment = Right,
                      MaxWidth            = 120,
                      Width               = 120,
                      Margin              = (0,0,0,@Space3) ]
                // Miter limit — only meaningful when LineJoin=Miter.
                // PenEditor.refreshMiterRowVisibility toggles
                // PART_MiterLabel + PART_MiterLimit in lock-step;
                // when both children of an Auto-sized row are Collapsed
                // the row's DesiredSize collapses to zero.
                TextBlock x:name="PART_MiterLabel"
                    [ Grid.Row          = 4,
                      Grid.Column       = 0,
                      Style             = @UiCaption,
                      Text              = "Miter limit",
                      Foreground        = @Fg1,
                      VerticalAlignment = Center,
                      Margin            = (0,0,@Space3,0) ]
                SpinEdit x:name="PART_MiterLimit"
                    [ Grid.Row            = 4,
                      Grid.Column         = 1,
                      TextBlock.FontSize  = @BodySmSize,
                      HorizontalAlignment = Right,
                      MaxWidth            = 120,
                      Width               = 120,
                      Minimum             = 1,
                      Maximum             = 20,
                      SmallChange         = 0.5,
                      LargeChange         = 2,
                      DecimalPlaces       = 1 ]
            }
        }
    }

    Style [TargetType = PenEditor] {
        Template = @DefaultPenEditor;
    }

    // ── FillEditor: PowerPoint-style inline fill panel ─────────────
    // One column: variant tab row → body slot → opacity slider. The
    // body slot's child is materialised by the FillEditor from the
    // Style-supplied BodyTemplate (swapped on Variant change). Tabs
    // are ClickableBorders the FillEditor wires in adoptTemplateParts;
    // the active-tab highlight rides through Style triggers below.

    Template x:key="DefaultFillEditor" [TargetType = FillEditor] {
        Grid x:name="PART_FillSection" [ MaxWidth = 300 ] {
            // One 2-column section grid: header / rule / variant-tab row
            // span both columns; the body slot and transparency row (each a
            // nested 2-column grid) share "ShapeFormatLabels", so their
            // labels align with the Line section and the cap section.
            ColumnDefinitions {
                ColumnDefinition [ Width = GridLength.Auto, SharedSizeGroup = "ShapeFormatLabels" ]
                ColumnDefinition [ Width = GridLength.Star ]
            }
            RowDefinitions {
                RowDefinition [ Height = GridLength.Auto ]
                RowDefinition [ Height = GridLength.Auto ]
                RowDefinition [ Height = GridLength.Auto ]
                RowDefinition [ Height = GridLength.Auto ]
                RowDefinition [ Height = GridLength.Auto ]
            }
            // Section header — ALWAYS visible (so the user can switch back
            // to a brush after picking No fill); only the body slot +
            // transparency row collapse on Variant=None. Whole-section
            // collapse for the "no shape selected" state lives on
            // PART_Editors in ShapeFormatControl, one level up.
            TextBlock x:name="PART_Header"
                [ Grid.Row        = 0,
                  Grid.ColumnSpan = 2,
                  Style           = @UiLabel,
                  Text            = "Fill",
                  Foreground      = @Fg1,
                  Margin          = (0,0,0,@Space2) ]
            // Header divider — FillEditor.ts collapses this in lock-step
            // with PART_Header (so the embedded Header="" brush editor in
            // the Line section shows neither title nor rule).
            Divider x:name="PART_HeaderRule" [ Grid.Row = 1, Grid.ColumnSpan = 2, Margin = (0,0,0,@Space3) ]
            // ── Variant tabs ────────────────────────────────────
            // ClickableBorder for each of the six variants. Default
            // background is @Bg1; the Style triggers below flip
            // the active one to @SurfaceSelected. UniformGrid 3×2
            // lays them in two rows regardless of pane width.
            UniformGrid [ Grid.Row = 2, Grid.ColumnSpan = 2, Columns = 3, Margin = (0,0,0,@Space4) ] {
                ClickableBorder x:name="PART_TabNone"
                    [ Fill          = @Bg1,
                      Stroke         = Pen [ Brush = @Border ],
                      CornerRadius        = @RadiusSm,
                      Padding             = (12,6,12,6),
                      Margin              = (0,0,4,4),
                      HorizontalAlignment = Stretch ] {
                    TextBlock
                        [ Text                = "No fill",
                          Foreground          = @Fg1,
                          Style               = @UiCaption,
                          HorizontalAlignment = Center ]
                }
                ClickableBorder x:name="PART_TabSolid"
                    [ Fill          = @Bg1,
                      Stroke         = Pen [ Brush = @Border ],
                      CornerRadius        = @RadiusSm,
                      Padding             = (12,6,12,6),
                      Margin              = (0,0,4,4),
                      HorizontalAlignment = Stretch ] {
                    TextBlock
                        [ Text                = "Solid",
                          Foreground          = @Fg1,
                          Style               = @UiCaption,
                          HorizontalAlignment = Center ]
                }
                ClickableBorder x:name="PART_TabLinear"
                    [ Fill          = @Bg1,
                      Stroke         = Pen [ Brush = @Border ],
                      CornerRadius        = @RadiusSm,
                      Padding             = (12,6,12,6),
                      Margin              = (0,0,4,4),
                      HorizontalAlignment = Stretch ] {
                    TextBlock
                        [ Text                = "Linear",
                          Foreground          = @Fg1,
                          Style               = @UiCaption,
                          HorizontalAlignment = Center ]
                }
                ClickableBorder x:name="PART_TabRadial"
                    [ Fill          = @Bg1,
                      Stroke         = Pen [ Brush = @Border ],
                      CornerRadius        = @RadiusSm,
                      Padding             = (12,6,12,6),
                      Margin              = (0,0,4,4),
                      HorizontalAlignment = Stretch ] {
                    TextBlock
                        [ Text                = "Radial",
                          Foreground          = @Fg1,
                          Style               = @UiCaption,
                          HorizontalAlignment = Center ]
                }
                ClickableBorder x:name="PART_TabPattern"
                    [ Fill          = @Bg1,
                      Stroke         = Pen [ Brush = @Border ],
                      CornerRadius        = @RadiusSm,
                      Padding             = (12,6,12,6),
                      Margin              = (0,0,4,4),
                      HorizontalAlignment = Stretch ] {
                    TextBlock
                        [ Text                = "Pattern",
                          Foreground          = @Fg1,
                          Style               = @UiCaption,
                          HorizontalAlignment = Center ]
                }
                ClickableBorder x:name="PART_TabPicture"
                    [ Fill          = @Bg1,
                      Stroke         = Pen [ Brush = @Border ],
                      CornerRadius        = @RadiusSm,
                      Padding             = (12,6,12,6),
                      Margin              = (0,0,4,4),
                      HorizontalAlignment = Stretch ] {
                    TextBlock
                        [ Text                = "Picture",
                          Foreground          = @Fg1,
                          Style               = @UiCaption,
                          HorizontalAlignment = Center ]
                }
            }

            // ── Body slot ───────────────────────────────────────
            // FillEditor.applyBodyTemplate() materialises the Style-
            // picked BodyTemplate here. Border gives a stable single-
            // child container without any visible chrome of its own.
            // MaxWidth caps the slot so the per-variant 2-column Grids
            // below don't inflate their Star tracks to Infinity when
            // the editor lives inside an unbounded host (ScrollViewer).
            Border x:name="PART_BodyHost" [ Grid.Row = 3, Grid.ColumnSpan = 2, Margin = (0,0,0,@Space4) ]

            // ── Opacity row ─────────────────────────────────────
            // Visible for every non-None variant; collapsed by
            // FillEditor.refreshOpacityRowVisibility when Variant=None
            // (alongside PART_BodyHost — the tabs above stay visible
            // so the user can switch back to a brush).
            // SliderSpinEdit = drag slider + typeable %-field (MS-Office
            // Transparency shape). Wrapped in its own 2-column Grid so the
            // Transparency label aligns with the labels in the body grid above.
            Grid x:name="PART_OpacityRow" [ Grid.Row = 4, Grid.ColumnSpan = 2 ] {
                ColumnDefinitions {
                    ColumnDefinition [ Width = GridLength.Auto, SharedSizeGroup = "ShapeFormatLabels" ]
                    ColumnDefinition [ Width = GridLength.Star ]
                }
                // Explicit Auto row — without it the Grid defaults to a
                // 1* row that absorbs the unbounded available height
                // from the surrounding vertical StackPanel and yields
                // Infinity rect dimensions.
                RowDefinitions {
                    RowDefinition [ Height = GridLength.Auto ]
                }
                TextBlock
                    [ Grid.Column       = 0,
                      Style             = @UiCaption,
                      Text              = "Transparency",
                      Foreground        = @Fg1,
                      VerticalAlignment = Center,
                      Margin            = (0,0,@Space3,0) ]
                SliderSpinEdit x:name="PART_OpacityEdit"
                    [ Grid.Column        = 1,
                      TextBlock.FontSize = @BodySmSize,
                      Unit               = "%",
                      Minimum            = 0,
                      Maximum            = 100,
                      SmallChange        = 1,
                      LargeChange        = 10,
                      DecimalPlaces      = 0 ]
            }
        }

        when ( Variant = None ) { PART_TabNone.Fill = @SurfaceSelected; }
        when ( Variant = Solid ) { PART_TabSolid.Fill = @SurfaceSelected; }
        when ( Variant = Linear ) { PART_TabLinear.Fill = @SurfaceSelected; }
        when ( Variant = Radial ) { PART_TabRadial.Fill = @SurfaceSelected; }
        when ( Variant = Pattern ) { PART_TabPattern.Fill = @SurfaceSelected; }
        when ( Variant = Picture ) { PART_TabPicture.Fill = @SurfaceSelected; }
    }

    // ── Body templates ─────────────────────────────────────────────
    // Each is a ControlTemplate against TargetType=FillEditor so $$
    // bindings inside resolve to the FillEditor's mirror DPs. The body
    // template's root visual gets slotted into PART_BodyHost.

    // None body — empty. Variant=None collapses PART_BodyHost via
    // FillEditor.refreshOpacityRowVisibility, so the body content
    // never paints in this state; an empty Border keeps
    // applyBodyTemplate's Apply() path well-formed.
    Template x:key="FillEditorBodyNone" [TargetType = FillEditor] {
        Border [ Height = 0 ]
    }

    // Each body template uses a 2-column Grid — Auto-sized label column
    // on the left, Star-sized editor column on the right. Editor cells
    // inherit Stretch alignment from the Grid cell so ColorPickers /
    // Sliders / ComboBoxes fill the available width.

    Template x:key="FillEditorBodySolid" [TargetType = FillEditor] {
        Grid {
            ColumnDefinitions {
                ColumnDefinition [ Width = GridLength.Auto, SharedSizeGroup = "ShapeFormatLabels" ]
                ColumnDefinition [ Width = GridLength.Star ]
            }
            // Explicit Auto row — without it the Grid defaults to a
            // single 1* row, which absorbs any unbounded available
            // height the host hands in (e.g. ScrollViewer's Infinity
            // measure) and propagates Infinity into child rect heights.
            RowDefinitions {
                RowDefinition [ Height = GridLength.Auto ]
            }
            TextBlock
                [ Grid.Column       = 0,
                  Style             = @UiCaption,
                  Text              = "Colour",
                  Foreground        = @Fg1,
                  VerticalAlignment = Center,
                  Margin            = (0,0,@Space3,0) ]
            ColorPicker x:name="PART_SolidColor" [ Grid.Column = 1, Variant = RGB, HorizontalAlignment = Right ]
        }
    }

    Template x:key="FillEditorBodyLinear" [TargetType = FillEditor] {
        Grid {
            ColumnDefinitions {
                ColumnDefinition [ Width = GridLength.Auto, SharedSizeGroup = "ShapeFormatLabels" ]
                ColumnDefinition [ Width = GridLength.Star ]
            }
            RowDefinitions {
                RowDefinition [ Height = GridLength.Auto ]
                RowDefinition [ Height = GridLength.Auto ]
                RowDefinition [ Height = GridLength.Auto ]
            }
            TextBlock
                [ Grid.Row          = 0,
                  Grid.Column       = 0,
                  Style             = @UiCaption,
                  Text              = "Start colour",
                  Foreground        = @Fg2,
                  VerticalAlignment = Center,
                  Margin            = (0,0,@Space3,@Space2) ]
            ColorPicker x:name="PART_LinearStart"
                [ Grid.Row            = 0,
                  Grid.Column         = 1,
                  HorizontalAlignment = Right,
                  Margin              = (0,0,0,@Space2) ]
            TextBlock
                [ Grid.Row          = 1,
                  Grid.Column       = 0,
                  Style             = @UiCaption,
                  Text              = "End colour",
                  Foreground        = @Fg2,
                  VerticalAlignment = Center,
                  Margin            = (0,0,@Space3,@Space2) ]
            ColorPicker x:name="PART_LinearEnd"
                [ Grid.Row            = 1,
                  Grid.Column         = 1,
                  HorizontalAlignment = Right,
                  Margin              = (0,0,0,@Space2) ]
            TextBlock
                [ Grid.Row          = 2,
                  Grid.Column       = 0,
                  Style             = @UiCaption,
                  Text              = "Angle",
                  Foreground        = @Fg2,
                  VerticalAlignment = Center,
                  Margin            = (0,0,@Space3,0) ]
            Slider x:name="PART_LinearAngle"
                [ Grid.Row    = 2,
                  Grid.Column = 1,
                  Minimum     = -180,
                  Maximum     = 180,
                  SmallChange = 1,
                  LargeChange = 15 ]
        }
    }

    Template x:key="FillEditorBodyRadial" [TargetType = FillEditor] {
        Grid {
            ColumnDefinitions {
                ColumnDefinition [ Width = GridLength.Auto, SharedSizeGroup = "ShapeFormatLabels" ]
                ColumnDefinition [ Width = GridLength.Star ]
            }
            RowDefinitions {
                RowDefinition [ Height = GridLength.Auto ]
                RowDefinition [ Height = GridLength.Auto ]
                RowDefinition [ Height = GridLength.Auto ]
                RowDefinition [ Height = GridLength.Auto ]
                RowDefinition [ Height = GridLength.Auto ]
            }
            TextBlock
                [ Grid.Row          = 0,
                  Grid.Column       = 0,
                  Style             = @UiCaption,
                  Text              = "Inner colour",
                  Foreground        = @Fg2,
                  VerticalAlignment = Center,
                  Margin            = (0,0,@Space3,@Space2) ]
            ColorPicker x:name="PART_RadialInner"
                [ Grid.Row            = 0,
                  Grid.Column         = 1,
                  HorizontalAlignment = Right,
                  Margin              = (0,0,0,@Space2) ]
            TextBlock
                [ Grid.Row          = 1,
                  Grid.Column       = 0,
                  Style             = @UiCaption,
                  Text              = "Outer colour",
                  Foreground        = @Fg2,
                  VerticalAlignment = Center,
                  Margin            = (0,0,@Space3,@Space2) ]
            ColorPicker x:name="PART_RadialOuter"
                [ Grid.Row            = 1,
                  Grid.Column         = 1,
                  HorizontalAlignment = Right,
                  Margin              = (0,0,0,@Space2) ]
            TextBlock
                [ Grid.Row          = 2,
                  Grid.Column       = 0,
                  Style             = @UiCaption,
                  Text              = "Cx %",
                  Foreground        = @Fg2,
                  VerticalAlignment = Center,
                  Margin            = (0,0,@Space3,@Space2) ]
            Slider x:name="PART_RadialCenterX"
                [ Grid.Row    = 2,
                  Grid.Column = 1,
                  Minimum     = 0,
                  Maximum     = 100,
                  SmallChange = 1,
                  LargeChange = 10,
                  Margin      = (0,0,0,@Space2) ]
            TextBlock
                [ Grid.Row          = 3,
                  Grid.Column       = 0,
                  Style             = @UiCaption,
                  Text              = "Cy %",
                  Foreground        = @Fg2,
                  VerticalAlignment = Center,
                  Margin            = (0,0,@Space3,@Space2) ]
            Slider x:name="PART_RadialCenterY"
                [ Grid.Row    = 3,
                  Grid.Column = 1,
                  Minimum     = 0,
                  Maximum     = 100,
                  SmallChange = 1,
                  LargeChange = 10,
                  Margin      = (0,0,0,@Space2) ]
            TextBlock
                [ Grid.Row          = 4,
                  Grid.Column       = 0,
                  Style             = @UiCaption,
                  Text              = "Radius %",
                  Foreground        = @Fg2,
                  VerticalAlignment = Center,
                  Margin            = (0,0,@Space3,0) ]
            Slider x:name="PART_RadialRadius"
                [ Grid.Row    = 4,
                  Grid.Column = 1,
                  Minimum     = 1,
                  Maximum     = 100,
                  SmallChange = 1,
                  LargeChange = 10 ]
        }
    }

    Template x:key="FillEditorBodyPattern" [TargetType = FillEditor] {
        Grid {
            ColumnDefinitions {
                ColumnDefinition [ Width = GridLength.Auto, SharedSizeGroup = "ShapeFormatLabels" ]
                ColumnDefinition [ Width = GridLength.Star ]
            }
            RowDefinitions {
                RowDefinition [ Height = GridLength.Auto ]
                RowDefinition [ Height = GridLength.Auto ]
                RowDefinition [ Height = GridLength.Auto ]
                RowDefinition [ Height = GridLength.Auto ]
                RowDefinition [ Height = GridLength.Auto ]
                RowDefinition [ Height = GridLength.Auto ]
            }
            TextBlock
                [ Grid.Row          = 0,
                  Grid.Column       = 0,
                  Style             = @UiCaption,
                  Text              = "Kind",
                  Foreground        = @Fg2,
                  VerticalAlignment = Center,
                  Margin            = (0,0,@Space3,@Space2) ]
            ComboBox x:name="PART_PatternKind"
                [ Grid.Row            = 0,
                  Grid.Column         = 1,
                  TextBlock.FontSize  = @BodySmSize,
                  HorizontalAlignment = Right,
                  MaxWidth            = 120,
                  Width               = 120,
                  Margin              = (0,0,0,@Space2) ]
            TextBlock
                [ Grid.Row          = 1,
                  Grid.Column       = 0,
                  Style             = @UiCaption,
                  Text              = "Foreground",
                  Foreground        = @Fg2,
                  VerticalAlignment = Center,
                  Margin            = (0,0,@Space3,@Space2) ]
            ColorPicker x:name="PART_PatternForeground"
                [ Grid.Row            = 1,
                  Grid.Column         = 1,
                  HorizontalAlignment = Right,
                  Margin              = (0,0,0,@Space2) ]
            TextBlock
                [ Grid.Row          = 2,
                  Grid.Column       = 0,
                  Style             = @UiCaption,
                  Text              = "Background",
                  Foreground        = @Fg2,
                  VerticalAlignment = Center,
                  Margin            = (0,0,@Space3,@Space2) ]
            ColorPicker x:name="PART_PatternBackground"
                [ Grid.Row            = 2,
                  Grid.Column         = 1,
                  HorizontalAlignment = Right,
                  Margin              = (0,0,0,@Space2) ]
            TextBlock
                [ Grid.Row          = 3,
                  Grid.Column       = 0,
                  Style             = @UiCaption,
                  Text              = "Size",
                  Foreground        = @Fg2,
                  VerticalAlignment = Center,
                  Margin            = (0,0,@Space3,@Space2) ]
            Slider x:name="PART_PatternSize"
                [ Grid.Row    = 3,
                  Grid.Column = 1,
                  Minimum     = 2,
                  Maximum     = 64,
                  SmallChange = 1,
                  LargeChange = 4,
                  Margin      = (0,0,0,@Space2) ]
            TextBlock
                [ Grid.Row          = 4,
                  Grid.Column       = 0,
                  Style             = @UiCaption,
                  Text              = "Angle",
                  Foreground        = @Fg2,
                  VerticalAlignment = Center,
                  Margin            = (0,0,@Space3,@Space2) ]
            Slider x:name="PART_PatternAngle"
                [ Grid.Row    = 4,
                  Grid.Column = 1,
                  Minimum     = 0,
                  Maximum     = 180,
                  SmallChange = 1,
                  LargeChange = 15,
                  Margin      = (0,0,0,@Space2) ]
            TextBlock
                [ Grid.Row          = 5,
                  Grid.Column       = 0,
                  Style             = @UiCaption,
                  Text              = "Stroke",
                  Foreground        = @Fg2,
                  VerticalAlignment = Center,
                  Margin            = (0,0,@Space3,0) ]
            Slider x:name="PART_PatternStroke"
                [ Grid.Row    = 5,
                  Grid.Column = 1,
                  Minimum     = 0.5,
                  Maximum     = 8,
                  SmallChange = 0.5,
                  LargeChange = 1 ]
        }
    }

    Template x:key="FillEditorBodyPicture" [TargetType = FillEditor] {
        StackPanel [ Orientation = Vertical ] {
            // StackPanel wraps the label/editor Grid AND the full-width
            // helper paragraph. The paragraph is NOT inside the Grid: a
            // wrapping TextBlock with Grid.ColumnSpan=2 measures with
            // Infinity in the Auto pass and dumps its unwrapped intrinsic
            // width into the Auto column (Stars aren't pre-resolved at that
            // phase — see grid.ts), which collapses the Star column and
            // hides the TextBox / ComboBox. As an outside sibling the
            // paragraph just inherits the StackPanel's width with no Grid
            // interaction.
            Grid {
                ColumnDefinitions {
                    ColumnDefinition [ Width = GridLength.Auto, SharedSizeGroup = "ShapeFormatLabels" ]
                    ColumnDefinition [ Width = GridLength.Star ]
                }
                RowDefinitions {
                    RowDefinition [ Height = GridLength.Auto ]
                    RowDefinition [ Height = GridLength.Auto ]
                }
                TextBlock
                    [ Grid.Row          = 0,
                      Grid.Column       = 0,
                      Style             = @UiCaption,
                      Text              = "Image URL",
                      Foreground        = @Fg2,
                      VerticalAlignment = Center,
                      Margin            = (0,0,@Space3,@Space2) ]
                TextBox x:name="PART_PictureUri"
                    [ Grid.Row    = 0,
                      Grid.Column = 1,
                      Margin      = (0,0,0,@Space2) ]
                TextBlock
                    [ Grid.Row          = 1,
                      Grid.Column       = 0,
                      Style             = @UiCaption,
                      Text              = "Stretch",
                      Foreground        = @Fg2,
                      VerticalAlignment = Center,
                      Margin            = (0,0,@Space3,0) ]
                ComboBox x:name="PART_PictureStretch"
                    [ Grid.Row            = 1,
                      Grid.Column         = 1,
                      TextBlock.FontSize  = @BodySmSize,
                      HorizontalAlignment = Right,
                      MaxWidth            = 120,
                      Width               = 120 ]
            }
            TextBlock
                [ Style        = @UiCaption,
                  Text         = "Paste an absolute URL or a workspace-relative path. Uniform stretch keeps aspect; Fill stretches independently; UniformToFill crops to bbox.",
                  Foreground   = @Fg2,
                  TextWrapping = Wrap,
                  Margin       = (0,@Space2,0,0) ]
        }
    }

    Style [TargetType = FillEditor] {
        Template = @DefaultFillEditor;
        BodyTemplate = @FillEditorBodySolid;
        when ( Variant = None ) { BodyTemplate = @FillEditorBodyNone; }
        when ( Variant = Linear ) { BodyTemplate = @FillEditorBodyLinear; }
        when ( Variant = Radial ) { BodyTemplate = @FillEditorBodyRadial; }
        when ( Variant = Pattern ) { BodyTemplate = @FillEditorBodyPattern; }
        when ( Variant = Picture ) { BodyTemplate = @FillEditorBodyPicture; }
    }

    // ── ShapeFormatControl: PowerPoint Format-Shape pane ───────────
    // Combines FillEditor + PenEditor into one column. PART_FillEditor
    // and PART_PenEditor are adopted by ShapeFormatControl.ts, which
    // routes its Fill / Stroke DPs through to / from each editor under
    // a _syncing guard. No TemplateBinding here: FillEditor swaps its
    // Fill wholesale on every edit (TemplateBinding is OneWay, so the
    // editor's writes wouldn't surface), and the manual wiring keeps
    // the two editors symmetric.
    // Section headers ("Fill", "Line") moved INTO each editor's template
    // so the Fill section can collapse as a whole when Variant=None.
    // The wrapper stacks the two editors and ALSO carries an empty-state
    // placeholder shown when both Fill and Stroke are undefined (the
    // diagrammer's "no shape selected" signal). ShapeFormatControl.ts
    // toggles PART_Editors / PART_EmptyMessage heights on every Fill or
    // Stroke change.
    // Cap dropdown row: a small glyph silhouette (filled OR stroked per
    // option) + the option label. Generic — renders any CapOption; the
    // diagram layer supplies connector-cap values. The glyph Path is
    // layout-free, so a fixed-size Border reserves the row's icon slot.
    DataTemplate x:key="CapOptionTemplate" [DataType = CapOption] {
        StackPanel [ Orientation = Horizontal ] {
            Border
                [ Width             = 24,
                  Height            = 14,
                  VerticalAlignment = Center,
                  Margin            = (0,0,@Space2,0) ] {
                Path [ Data = $Glyph, Fill = $GlyphFill, Stroke = $GlyphStroke ]
            }
            TextBlock
                [ Text              = $Label,
                  Style             = @BodySm,
                  Foreground        = @Fg1,
                  VerticalAlignment = Center ]
        }
    }

    Template x:key="DefaultShapeFormatControl" [TargetType = ShapeFormatControl] {
        StackPanel [ Orientation = Vertical ] {
            TextBlock x:name="PART_EmptyMessage"
                [ Style               = @BodySm,
                  Text                = "Select a shape to format its fill and outline.",
                  Foreground          = @Fg2,
                  TextWrapping        = Wrap,
                  HorizontalAlignment = Stretch,
                  Margin              = (0,@Space4,0,0) ]
            StackPanel x:name="PART_Editors" [ Orientation = Vertical ] {
                FillEditor x:name="PART_FillEditor"
                PenEditor x:name="PART_PenEditor" [ Margin = (0,@Space4,0,0) ]
            }
            // Connector end-caps — ShapeFormatControl.ts collapses this
            // whole section unless ShowCaps (a connector is selected).
            // Both combos share @CapOptionTemplate for the glyph preview
            // and DisplayMemberPath="Label" for the collapsed selection box.
            Grid x:name="PART_CapSection"
                [ Margin   = (0,@Space4,0,0),
                  MaxWidth = 300 ] {
                ColumnDefinitions {
                    ColumnDefinition [ Width = GridLength.Auto, SharedSizeGroup = "ShapeFormatLabels" ]
                    ColumnDefinition [ Width = GridLength.Star ]
                }
                RowDefinitions {
                    RowDefinition [ Height = GridLength.Auto ]
                    RowDefinition [ Height = GridLength.Auto ]
                    RowDefinition [ Height = GridLength.Auto ]
                    RowDefinition [ Height = GridLength.Auto ]
                    RowDefinition [ Height = GridLength.Auto ]
                    RowDefinition [ Height = GridLength.Auto ]
                }
                TextBlock
                    [ Grid.Row        = 0,
                      Grid.ColumnSpan = 2,
                      Style           = @UiLabel,
                      Text            = "Connector ends",
                      Foreground      = @Fg1,
                      Margin          = (0,0,0,@Space2) ]
                Divider [ Grid.Row = 1, Grid.ColumnSpan = 2, Margin = (0,0,0,@Space3) ]
                TextBlock
                    [ Grid.Row          = 2,
                      Grid.Column       = 0,
                      Style             = @UiCaption,
                      Text              = "Start",
                      Foreground        = @Fg1,
                      VerticalAlignment = Center,
                      Margin            = (0,0,@Space3,@Space3) ]
                ComboBox x:name="PART_SourceCap"
                    [ Grid.Row           = 2,
                      Grid.Column        = 1,
                      ItemTemplate       = @CapOptionTemplate,
                      DisplayMemberPath  = "Label",
                      TextBlock.FontSize = @BodySmSize,
                      Margin             = (0,0,0,@Space3) ]
                TextBlock
                    [ Grid.Row          = 3,
                      Grid.Column       = 0,
                      Style             = @UiCaption,
                      Text              = "Start size",
                      Foreground        = @Fg2,
                      VerticalAlignment = Center,
                      Margin            = (0,0,@Space3,@Space3) ]
                SliderSpinEdit x:name="PART_SourceCapScale"
                    [ Grid.Row           = 3,
                      Grid.Column        = 1,
                      TextBlock.FontSize = @BodySmSize,
                      Minimum            = 0.5,
                      Maximum            = 1.5,
                      SmallChange        = 0.1,
                      LargeChange        = 0.5,
                      DecimalPlaces      = 1,
                      Unit               = "×",
                      Margin             = (0,0,0,@Space3) ]
                TextBlock
                    [ Grid.Row          = 4,
                      Grid.Column       = 0,
                      Style             = @UiCaption,
                      Text              = "End",
                      Foreground        = @Fg1,
                      VerticalAlignment = Center,
                      Margin            = (0,0,@Space3,@Space3) ]
                ComboBox x:name="PART_TargetCap"
                    [ Grid.Row           = 4,
                      Grid.Column        = 1,
                      ItemTemplate       = @CapOptionTemplate,
                      DisplayMemberPath  = "Label",
                      TextBlock.FontSize = @BodySmSize,
                      Margin             = (0,0,0,@Space3) ]
                TextBlock
                    [ Grid.Row          = 5,
                      Grid.Column       = 0,
                      Style             = @UiCaption,
                      Text              = "End size",
                      Foreground        = @Fg2,
                      VerticalAlignment = Center,
                      Margin            = (0,0,@Space3,0) ]
                SliderSpinEdit x:name="PART_TargetCapScale"
                    [ Grid.Row           = 5,
                      Grid.Column        = 1,
                      TextBlock.FontSize = @BodySmSize,
                      Minimum            = 0.5,
                      Maximum            = 1.5,
                      SmallChange        = 0.1,
                      LargeChange        = 0.5,
                      DecimalPlaces      = 1,
                      Unit               = "×" ]
            }
        }
    }

    Style [TargetType = ShapeFormatControl] {
        Template = @DefaultShapeFormatControl;
    }
}
