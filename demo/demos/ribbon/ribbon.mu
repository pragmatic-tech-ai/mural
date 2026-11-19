// ribbon.mu — a tabbed Ribbon driven by the framework Board's command
// palette, showcasing every invoker footprint:
//
//   * Large  — the group anchor: a 32px icon over a wrapping label.
//   * Medium — an icon beside a label; three stack in a RibbonSmallButtonColumn.
//   * Small  — icon only (no label); used here for the decoration toggles.
//   * RibbonSplitButton   — a primary action + a ▾ dropdown of variants.
//   * RibbonDropDownButton — the whole button opens a dropdown (no primary).
//
// Every button binds to the Board control's OWN RelayCommand DPs by
// ElementName (`$canvas.…`), so the ribbon drives the same command surface the
// Boardmer demo's toolbars do — no view-model command proxy. The commands
// are selection-gated, so most open disabled and light up once you select
// shapes on the canvas below.

import RibbonDemoDoc from "./ribbon-vm.mjs"

resources RibbonDemo {
    // Command icons baked from the shared Material Symbols font at compile
    // time (one PathGeometry per name); a bare Shape paints each with the
    // inherited ribbon ink.
    glyphs "../../assets/material-symbols-outlined.ttf" {
        format_align_left
        format_align_center
        format_align_right
        format_align_justify
        north
        filter_center_focus
        south
        join
        join_inner
        join_left
        difference
        format_bold
        format_italic
        format_underlined
        format_strikethrough
        text_increase
        text_decrease
    }

    ItemsPanelTemplate x:key="RibbonCanvasPanel" {
        Canvas
    }

    DataTemplate [DataType = RibbonDemoDoc] {
        DockPanel {
            // ── The Ribbon ──────────────────────────────────────────────
            Ribbon [ DockPanel.Dock = Top ] {

                // ── Arrange tab — shape align + boolean combine ──────────
                RibbonTab [ Header = "Arrange" ] {

                    // Align: a Large split button (primary = Align Left, ▾
                    // opens every alignment) beside a Medium column of the
                    // three horizontal alignments.
                    RibbonGroup [ Header = "Align" ] {
                        RibbonSplitButton
                            [ Size      = Large,
                              Text      = "Align",
                              LargeIcon = Shape [ Geometry = @format_align_left, Width = 32, Height = 32 ],
                              Command   = $canvas.AlignLeftCommand ] {
                            MenuItem [ Header = "Align Left",   Command = $canvas.AlignLeftCommand ]
                            MenuItem [ Header = "Align Center", Command = $canvas.AlignCenterCommand ]
                            MenuItem [ Header = "Align Right",  Command = $canvas.AlignRightCommand ]
                            MenuSeparator
                            MenuItem [ Header = "Align Top",    Command = $canvas.AlignTopCommand ]
                            MenuItem [ Header = "Align Middle", Command = $canvas.AlignMiddleCommand ]
                        }
                        RibbonSmallButtonColumn {
                            RibbonButton [ Text = "Left",   SmallIcon = Shape [ Geometry = @format_align_left,   Width = 16, Height = 16 ], Command = $canvas.AlignLeftCommand ]
                            RibbonButton [ Text = "Center", SmallIcon = Shape [ Geometry = @format_align_center, Width = 16, Height = 16 ], Command = $canvas.AlignCenterCommand ]
                            RibbonButton [ Text = "Right",  SmallIcon = Shape [ Geometry = @format_align_right,  Width = 16, Height = 16 ], Command = $canvas.AlignRightCommand ]
                        }
                    }

                    // Combine: a Large dropdown button (the whole button opens
                    // the boolean-combine menu) beside a Medium Group/Ungroup
                    // column.
                    RibbonGroup [ Header = "Combine" ] {
                        RibbonDropDownButton
                            [ Size      = Large,
                              Text      = "Combine",
                              LargeIcon = Shape [ Geometry = @join, Width = 32, Height = 32 ] ] {
                            MenuItem [ Header = "Union",     Command = $canvas.CombineUnionCommand ]
                            MenuItem [ Header = "Intersect", Command = $canvas.CombineIntersectCommand ]
                            MenuItem [ Header = "Subtract",  Command = $canvas.CombineSubtractCommand ]
                            MenuItem [ Header = "Exclude",   Command = $canvas.CombineExcludeCommand ]
                        }
                        RibbonSmallButtonColumn {
                            RibbonButton [ Text = "Group",   SmallIcon = Shape [ Geometry = @join_inner, Width = 16, Height = 16 ], Command = $canvas.GroupCommand ]
                            RibbonButton [ Text = "Ungroup", SmallIcon = Shape [ Geometry = @join_left,  Width = 16, Height = 16 ], Command = $canvas.UngroupCommand ]
                        }
                    }
                }

                // ── Text tab — label formatting ─────────────────────────
                RibbonTab [ Header = "Text" ] {

                    // Font: a Medium Grow/Shrink column, then the four
                    // decoration toggles as Small (icon-only) toggle buttons
                    // bound to the board's live Selection* reflection DPs.
                    RibbonGroup [ Header = "Font" ] {
                        RibbonSmallButtonColumn {
                            RibbonButton [ Text = "Grow",   SmallIcon = Shape [ Geometry = @text_increase, Width = 16, Height = 16 ], Command = $canvas.IncreaseFontSizeCommand ]
                            RibbonButton [ Text = "Shrink", SmallIcon = Shape [ Geometry = @text_decrease, Width = 16, Height = 16 ], Command = $canvas.DecreaseFontSizeCommand ]
                        }
                        RibbonToggleButton [ Size = Small, IsChecked = $canvas.SelectionBold,          SmallIcon = Shape [ Geometry = @format_bold,          Width = 16, Height = 16 ] ]
                        RibbonToggleButton [ Size = Small, IsChecked = $canvas.SelectionItalic,        SmallIcon = Shape [ Geometry = @format_italic,        Width = 16, Height = 16 ] ]
                        RibbonToggleButton [ Size = Small, IsChecked = $canvas.SelectionUnderline,     SmallIcon = Shape [ Geometry = @format_underlined,    Width = 16, Height = 16 ] ]
                        RibbonToggleButton [ Size = Small, IsChecked = $canvas.SelectionStrikethrough, SmallIcon = Shape [ Geometry = @format_strikethrough, Width = 16, Height = 16 ] ]
                    }

                    // Paragraph: a Large dropdown of the label's paragraph
                    // alignment (the SetTextAlign* command family).
                    RibbonGroup [ Header = "Paragraph" ] {
                        RibbonDropDownButton
                            [ Size      = Large,
                              Text      = "Alignment",
                              LargeIcon = Shape [ Geometry = @format_align_left, Width = 32, Height = 32 ] ] {
                            MenuItem [ Header = "Left",    Command = $canvas.SetTextAlignLeftCommand ]
                            MenuItem [ Header = "Center",  Command = $canvas.SetTextAlignCenterCommand ]
                            MenuItem [ Header = "Right",   Command = $canvas.SetTextAlignRightCommand ]
                            MenuItem [ Header = "Justify", Command = $canvas.SetTextAlignJustifyCommand ]
                        }
                    }
                }
            }

            // ── Status line ─────────────────────────────────────────────
            Line
                [ DockPanel.Dock = Bottom,
                  Orientation    = Horizontal,
                  Stroke         = (@OutlineVariant, 1) ]
            Border
                [ DockPanel.Dock  = Bottom,
                  Fill      = @SurfaceContainerLow,
                  Padding         = (12,6,12,6) ] {
                TextBlock [ Text = $Status, Foreground = @OnSurfaceVariant, Style = @LabelMedium ]
            }

            // ── Canvas — a live Board; the ribbon commands act on its
            //    selection. Mutator auto-wires from the DataContext
            //    (RibbonDemoDoc is a BoardMutator). ──
            Board x:name="canvas"
                [ ItemsSource             = $Nodes,
                  ItemsPanel              = @RibbonCanvasPanel,
                  SelectionMode           = Extended,
                  AllowMarqueeSelection   = true,
                  ReflectSelectionToItems = true,
                  Focusable               = true ]
        }
    }
}
