// board.mu — node-only Visio-/drawio-style scene backed by the
// framework's BoardDocument. Items inside the canvas ARE Figure /
// Group instances directly (no data/visual split, no DataTemplate
// dispatch for items). The toolbox rail enumerates the framework
// ToolboxRepository's pages of ToolboxItems; dropping a tile routes
// through its factory (the shape factory calls the Document's CreateNode
// via the Mutator wiring).

import BoardTool from "./board-tools.mjs"

resources BoardDemo {
    // ── Boolean-combine glyphs ──────────────────────────────────────
    //
    // The Group/Combine toolbar's set-operation icons are baked from the
    // Material Symbols font into PathGeometry resources at COMPILE TIME
    // (the `glyphs` keyword → one PathGeometry per entry, keyed by glyph
    // name). The IconButtons paint true vector geometry with a theme
    // brush — `Shape[Geometry=@join, Fill=@OnSurfaceVariant]` — instead
    // of font-dependent TextBlock math symbols (∪ ∩ − ⊕). The Venn-style
    // join glyphs map onto the boolean ops:
    //
    //   union     → @join        (both circles)
    //   intersect → @join_inner  (overlap only)
    //   subtract  → @join_left   (left minus overlap)
    //   exclude   → @difference  (both minus overlap)
    glyphs "../../assets/material-symbols-outlined.ttf" {
        join
        join_inner
        join_left
        difference
        // Input-mode toolbar: Connectors mode (a multi-segment connector line).
        polyline
        // Text-format toolbars (§ board-text): paragraph alignment within
        // the label block …
        format_align_left
        format_align_center
        format_align_right
        format_align_justify
        // … and where the label sits within the shape (3×3 placement grid).
        north_west
        north
        north_east
        west
        filter_center_focus
        east
        south_west
        south
        south_east
        // Character decorations (text-style toolbar): bold / italic / underline
        // / strikethrough. Font family / size / colour use the picker controls,
        // not glyphs.
        format_bold
        format_italic
        format_underlined
        format_strikethrough
        // Grow / shrink font (big-A / small-A glyphs).
        text_increase
        text_decrease
    }

    // ── Shared Canvas ItemsPanel ────────────────────────────────────
    //
    // Canvas.MeasureOverride returns the union bounding box of its
    // children — so the canvas extent grows automatically as nodes
    // are moved / dropped past the previous bounds. The surrounding
    // ScrollViewer's scrollable extent tracks that growth because
    // Canvas.Left / Canvas.Top are flagged Measure | Arrange; a
    // position change cascades the child's InvalidateMeasure up to
    // the Canvas itself, the new DesiredSize bubbles up to the
    // ScrollViewer, and a new scrollbar thumb extent is published in
    // the same layout pass.
    ItemsPanelTemplate x:key="BoardCanvasPanel" {
        PaginatedCanvas [ PageWidth = 800, PageHeight = 600 ]
    }

    // ── Toolbox ItemsPanel — 2-column UniformGrid so 35 tiles fit in
    // a reasonable vertical footprint inside the 200-wide rail.
    ItemsPanelTemplate x:key="BoardToolboxPanel" {
        UniformGrid [ Columns = 2 ]
    }

    // ── Toolbox tile template ───────────────────────────────────────
    //
    // ONE tile template per ToolboxItem — the picture is a
    // ToolboxVisualPresenter that resolves the item's Descriptor to a
    // Visual (Context defaults to Tile) and hosts it. The draggable Border
    // emits the single toolbox-item payload via $BeginDragData.
    DataTemplate [DataType = ToolboxItem] {
        Border x:root
            [ IsDraggable     = true,
              OnDragStart     = $BeginDragData,
              Fill      = @Surface,
              Stroke     = Pen [ Brush = @OutlineVariant ],
              CornerRadius    = 4,
              Padding         = (4,8,4,8),
              Margin          = (2,0,2,4) ] {
            StackPanel [ Orientation = Vertical, HorizontalAlignment = Center ] {
                ToolboxVisualPresenter
                    [ Descriptor          = $Descriptor,
                      Width               = 48,
                      Height              = 48,
                      HorizontalAlignment = Center ]
                TextBlock
                    [ Text                = $Label,
                      FontSize            = 10,
                      Foreground          = @OnSurface,
                      Margin              = (0,4,0,0),
                      HorizontalAlignment = Center ]
            }
        }
    }

    // ── Toolbox page template ───────────────────────────────────────
    // One section per ToolboxRepository page: a bold title over its items
    // laid out by the shared wrap panel.
    DataTemplate [DataType = ToolboxPage] {
        DockPanel [ Margin = (0,0,0,8) ] {
            TextBlock
                [ DockPanel.Dock = Top,
                  Text           = $Title,
                  FontSize       = 11,
                  FontWeight     = Bold,
                  Foreground     = @OnSurfaceVariant,
                  Margin         = (2,0,0,8) ]
            ItemsControl [ ItemsSource = $Items, ItemsPanel = @BoardToolboxPanel ]
        }
    }

    // ── Command-toolbar tile ────────────────────────────────────────
    // One ToolBarButton per BoardTool descriptor. The four header
    // toolbars each bind ItemsSource to an inline BoardTool[] array;
    // this shared template renders every entry — the Shape paints the
    // tool's Icon geometry and the button invokes its Command. The
    // descriptors carry both because they're authored INSIDE this
    // template's scope, where the @icon resources and the
    // $nodes.<X>Command element-source bindings both resolve (the latter
    // lowers to a lexical `_nodes` thunk, so it binds fine onto a
    // non-visual data object).
    DataTemplate x:key="BoardToolTemplate" [DataType = BoardTool] {
        ToolBarButton [ Command = $Command ] {
            Shape [ Geometry = $Icon, Fill = @OnSurfaceVariant, Width = 16, Height = 16, Margin = (2) ]
        }
    }

    // ── Split-button label + gallery layout ─────────────────────────
    //
    // The Align / Placement groups collapse into ToolBarSplitButtons.
    // Align is icon-only (its Content is an inline Shape). Placement
    // shows a glyph + caption; inline attribute values can't host a child
    // block, so that composed label rides a keyed StackPanel referenced
    // once by the button's Content. The Placement popup swaps its
    // ItemsPanel to a 3×3 UniformGrid — that override is what turns the
    // Gallery's default vertical menu into an icon matrix.
    StackPanel x:key="BoardPlacementSplitLabel" [ Orientation = Horizontal, VerticalAlignment = Center ] {
        Shape [ Geometry = @filter_center_focus, Fill = @OnSurfaceVariant, Width = 16, Height = 16, VerticalAlignment = Center ]
        TextBlock [ Text = "Placement", Margin = (6,0,0,0), VerticalAlignment = Center ]
    }
    ItemsPanelTemplate x:key="BoardPlacementGrid" {
        UniformGrid [ Columns = 3 ]
    }

    // ── Board workspace ──────────────────────────────────────────
    DataTemplate [DataType = BoardDocument] {
        Border x:root
            [ Fill      = @Surface,
              Stroke     = Pen [ Brush = @OutlineVariant ] ] {
            DockPanel {
                // Header strip.
                Border [ DockPanel.Dock = Top, Height = 44, Fill = @Primary ] {
                    StackPanel [ Orientation = Horizontal, Margin = (16,0,0,0) ] {
                        Shape
                            [ Geometry          = @home,
                              Fill              = @OnPrimary,
                              Width             = 24,
                              Height            = 24,
                              VerticalAlignment = Center ]
                        TextBlock
                            [ Text              = "Boardmer",
                              FontSize          = 15,
                              FontWeight        = Bold,
                              Foreground        = @OnPrimary,
                              VerticalAlignment = Center,
                              Margin            = (8,0,0,0) ]
                        TextBlock
                            [ Text              = $Status,
                              FontSize          = 12,
                              Foreground        = @OnPrimary,
                              VerticalAlignment = Center,
                              Margin            = (20,0,0,0) ]
                    }
                }

                // Consolidated toolbar — every command / format surface on ONE
                // horizontal line: input modes, shape align / distribute / group
                // / combine, paragraph alignment + label placement, then the
                // character-style pickers + decorations. Each ToolBar is still
                // data-driven where it was (inline BoardTool[] arrays pairing an
                // @icon with a framework Board RelayCommand via the `nodes`
                // x:name). The whole strip rides a horizontal-only ScrollViewer so
                // it scrolls sideways instead of clipping on a narrow window.
                // (Was three stacked Dock=Top rows.)
                Border
                    [ DockPanel.Dock  = Top,
                      Fill      = @SurfaceContainer,
                      Padding         = (8,4,8,4) ] {
                    DockPanel {
                    Line [ DockPanel.Dock = Bottom, Orientation = Horizontal, Stroke = (@OutlineVariant, 1) ]
                    ScrollViewer
                        [ HorizontalScrollEnabled = true,
                          VerticalScrollEnabled   = false,
                          IsAutoHideScrollBars     = true ] {
                    StackPanel [ Orientation = Horizontal ] {
                        // Input modes — a separate toolbar of mode toggles. The
                        // first is Connectors: pin it to make the connector
                        // adorners (port handles, endpoint / waypoint drags)
                        // react to the pointer; holding Ctrl activates it
                        // momentarily. IsChecked two-way binds the framework
                        // Board's ConnectorsModePinned DP (the mode's state).
                        ToolBar {
                            ToolBarToggleButton [ IsChecked = $nodes.ConnectorsModePinned ] {
                                Shape [ Geometry = @polyline, Width = 16, Height = 16, Margin = (2) ]
                            }
                        }
                        // Align + Distribute — one icon-only dropdown split button
                        // (no primary Command → single-chrome; Content is just the
                        // align glyph). Clicking anywhere opens a vertical menu of
                        // every shape-align command plus the two distribute commands
                        // (below a separator). MenuItem children auto-close the popup
                        // on click. Each command is the framework Board's own
                        // RelayCommand, bound through the `nodes` x:name.
                        ToolBar [ Margin = (8,0,0,0) ] {
                            ToolBarSplitButton
                                [ Content = Shape [ Geometry = @alignLeft, Fill = @OnSurfaceVariant, Width = 16, Height = 16, VerticalAlignment = Center ] ] {
                                MenuItem [ Header = "Align Left",   Command = $nodes.AlignLeftCommand,   Icon = Shape [ Geometry = @alignLeft,   Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
                                MenuItem [ Header = "Align Center", Command = $nodes.AlignCenterCommand, Icon = Shape [ Geometry = @alignCenter, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
                                MenuItem [ Header = "Align Right",  Command = $nodes.AlignRightCommand,  Icon = Shape [ Geometry = @alignRight,  Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
                                MenuItem [ Header = "Align Top",    Command = $nodes.AlignTopCommand,    Icon = Shape [ Geometry = @alignTop,    Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
                                MenuItem [ Header = "Align Middle", Command = $nodes.AlignMiddleCommand, Icon = Shape [ Geometry = @alignMiddle, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
                                MenuSeparator
                                MenuItem [ Header = "Distribute Horizontally", Command = $nodes.DistributeHorizontalCommand, Icon = Shape [ Geometry = @distributeHorizontal, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
                                MenuItem [ Header = "Distribute Vertically",   Command = $nodes.DistributeVerticalCommand,   Icon = Shape [ Geometry = @distributeVertical,   Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
                            }
                        }
                        ToolBar
                            [ Margin       = (8,0,0,0),
                              ItemTemplate = @BoardToolTemplate,
                              ItemsSource  = [
                                BoardTool [ Icon = @group,   Command = $nodes.GroupCommand ],
                                BoardTool [ Icon = @ungroup, Command = $nodes.UngroupCommand ] ] ]
                        ToolBar
                            [ Margin       = (8,0,0,0),
                              ItemTemplate = @BoardToolTemplate,
                              ItemsSource  = [
                                BoardTool [ Icon = @join,       Command = $nodes.CombineUnionCommand ],
                                BoardTool [ Icon = @join_inner, Command = $nodes.CombineIntersectCommand ],
                                BoardTool [ Icon = @join_left,  Command = $nodes.CombineSubtractCommand ],
                                BoardTool [ Icon = @difference, Command = $nodes.CombineExcludeCommand ] ] ]
                        // Paragraph alignment within the label block (§ board-
                        // text) — active-state toggles reflecting the SELECTED
                        // shape's label. IsChecked binds through
                        // `<< Is(TextAlignment.X)` (FormatMirror seeds the
                        // SelectionTextAlignment DP so exactly one lights up);
                        // clicking also invokes the matching command. Each toggle
                        // shows the selected shape's current alignment (IsChecked
                        // reflects through `<< Is(...)`) AND invokes the framework
                        // Board's matching command — the same command surface
                        // Plexus binds by id (see board-command-contexts.ts).
                        ToolBar {
                            ToolBarToggleButton [ Command = $nodes.SetTextAlignLeftCommand, IsChecked = $nodes.SelectionTextAlignment << Is(TextAlignment.Left) ] {
                                Shape [ Geometry = @format_align_left, Width = 16, Height = 16, Margin = (2) ]
                            }
                            ToolBarToggleButton [ Command = $nodes.SetTextAlignCenterCommand, IsChecked = $nodes.SelectionTextAlignment << Is(TextAlignment.Center) ] {
                                Shape [ Geometry = @format_align_center, Width = 16, Height = 16, Margin = (2) ]
                            }
                            ToolBarToggleButton [ Command = $nodes.SetTextAlignRightCommand, IsChecked = $nodes.SelectionTextAlignment << Is(TextAlignment.Right) ] {
                                Shape [ Geometry = @format_align_right, Width = 16, Height = 16, Margin = (2) ]
                            }
                            ToolBarToggleButton [ Command = $nodes.SetTextAlignJustifyCommand, IsChecked = $nodes.SelectionTextAlignment << Is(TextAlignment.Justify) ] {
                                Shape [ Geometry = @format_align_justify, Width = 16, Height = 16, Margin = (2) ]
                            }
                        }
                        // Label placement within the shape — a pure-dropdown split
                        // button (no primary Command → single-chrome) whose popup is
                        // the 3×3 icon matrix (ItemsPanel = UniformGrid Columns=3).
                        // The cells stay ToolBarToggleButtons so each still reflects
                        // the SELECTED shape's current placement (IsChecked through
                        // `<< Is(TextPlacement.X)`) AND invokes its command; being
                        // Buttons, they close the popup on release (Gallery wires the
                        // click-to-close, firing after the command so the placement
                        // applies before teardown).
                        ToolBar [ Margin = (8,0,0,0) ] {
                            ToolBarSplitButton
                                [ Content    = @BoardPlacementSplitLabel,
                                  ItemsPanel = @BoardPlacementGrid ] {
                                ToolBarToggleButton [ Command = $nodes.SetTextPlacementTopLeftCommand, IsChecked = $nodes.SelectionTextPlacement << Is(TextPlacement.TopLeft) ] {
                                    Shape [ Geometry = @north_west, Width = 16, Height = 16, Margin = (2) ]
                                }
                                ToolBarToggleButton [ Command = $nodes.SetTextPlacementTopCommand, IsChecked = $nodes.SelectionTextPlacement << Is(TextPlacement.Top) ] {
                                    Shape [ Geometry = @north, Width = 16, Height = 16, Margin = (2) ]
                                }
                                ToolBarToggleButton [ Command = $nodes.SetTextPlacementTopRightCommand, IsChecked = $nodes.SelectionTextPlacement << Is(TextPlacement.TopRight) ] {
                                    Shape [ Geometry = @north_east, Width = 16, Height = 16, Margin = (2) ]
                                }
                                ToolBarToggleButton [ Command = $nodes.SetTextPlacementLeftCommand, IsChecked = $nodes.SelectionTextPlacement << Is(TextPlacement.Left) ] {
                                    Shape [ Geometry = @west, Width = 16, Height = 16, Margin = (2) ]
                                }
                                ToolBarToggleButton [ Command = $nodes.SetTextPlacementCenterCommand, IsChecked = $nodes.SelectionTextPlacement << Is(TextPlacement.Center) ] {
                                    Shape [ Geometry = @filter_center_focus, Width = 16, Height = 16, Margin = (2) ]
                                }
                                ToolBarToggleButton [ Command = $nodes.SetTextPlacementRightCommand, IsChecked = $nodes.SelectionTextPlacement << Is(TextPlacement.Right) ] {
                                    Shape [ Geometry = @east, Width = 16, Height = 16, Margin = (2) ]
                                }
                                ToolBarToggleButton [ Command = $nodes.SetTextPlacementBottomLeftCommand, IsChecked = $nodes.SelectionTextPlacement << Is(TextPlacement.BottomLeft) ] {
                                    Shape [ Geometry = @south_west, Width = 16, Height = 16, Margin = (2) ]
                                }
                                ToolBarToggleButton [ Command = $nodes.SetTextPlacementBottomCommand, IsChecked = $nodes.SelectionTextPlacement << Is(TextPlacement.Bottom) ] {
                                    Shape [ Geometry = @south, Width = 16, Height = 16, Margin = (2) ]
                                }
                                ToolBarToggleButton [ Command = $nodes.SetTextPlacementBottomRightCommand, IsChecked = $nodes.SelectionTextPlacement << Is(TextPlacement.BottomRight) ] {
                                    Shape [ Geometry = @south_east, Width = 16, Height = 16, Margin = (2) ]
                                }
                            }
                        }
                        // Character style (§ board-text) — font family / size /
                        // colour pickers (two-way bound to the Selection* char DPs)
                        // + bold / italic / underline / strikethrough toggles
                        // (IsChecked bound to the reflection booleans; clicking
                        // writes back through the same FormatMirror channel).
                        FontFamilyPicker [ Text = $nodes.SelectionFontFamily, Width = 170, Margin = (8,0,0,0), VerticalAlignment = Center ]
                        FontSizePicker   [ Value = $nodes.SelectionFontSize, IsEditable = true, Width = 80, Margin = (8,0,0,0), VerticalAlignment = Center ]
                        // Grow / shrink font one point — command buttons between
                        // the size field and the colour picker.
                        ToolBar [ Margin = (8,0,0,0) ] {
                            ToolBarButton [ Command = $nodes.IncreaseFontSizeCommand ] {
                                Shape [ Geometry = @text_increase, Fill = @OnSurfaceVariant, Width = 16, Height = 16, Margin = (2) ]
                            }
                            ToolBarButton [ Command = $nodes.DecreaseFontSizeCommand ] {
                                Shape [ Geometry = @text_decrease, Fill = @OnSurfaceVariant, Width = 16, Height = 16, Margin = (2) ]
                            }
                        }
                        ColorPicker      [ ColorHex = $nodes.SelectionFontColorHex, Margin = (8,0,0,0), VerticalAlignment = Center ]
                        ToolBar [ Margin = (8,0,0,0) ] {
                            ToolBarToggleButton [ IsChecked = $nodes.SelectionBold ] {
                                Shape [ Geometry = @format_bold, Width = 16, Height = 16, Margin = (2) ]
                            }
                            ToolBarToggleButton [ IsChecked = $nodes.SelectionItalic ] {
                                Shape [ Geometry = @format_italic, Width = 16, Height = 16, Margin = (2) ]
                            }
                            ToolBarToggleButton [ IsChecked = $nodes.SelectionUnderline ] {
                                Shape [ Geometry = @format_underlined, Width = 16, Height = 16, Margin = (2) ]
                            }
                            ToolBarToggleButton [ IsChecked = $nodes.SelectionStrikethrough ] {
                                Shape [ Geometry = @format_strikethrough, Width = 16, Height = 16, Margin = (2) ]
                            }
                        }
                    }
                    }
                    }
                }

                // Toolbox strip — the framework ToolboxRepository (a Services
                // singleton the Board first-inits with a Shapes page) drives
                // an ItemsControl of pages; each page renders its own title +
                // item tiles.
                Border
                    [ DockPanel.Dock  = Left,
                      Width           = 200,
                      Fill      = @SurfaceContainerLow,
                      Padding         = (8) ] {
                    DockPanel {
                        Line [ DockPanel.Dock = Right, Orientation = Vertical, Stroke = (@OutlineVariant, 1) ]
                        StackPanel [ DockPanel.Dock = Bottom ] {
                            TextBlock
                                [ Text       = "Document",
                                  FontSize   = 11,
                                  FontWeight = Bold,
                                  Foreground = @OnSurfaceVariant,
                                  Margin     = (2,12,0,8) ]
                            StackPanel [ Orientation = Horizontal, Margin = (0,0,0,8) ] {
                                Button [ Command = $SaveCommand, Margin = (0,0,4,0) ] {
                                    TextBlock [ Text = "Save", FontSize = 11 ]
                                }
                                Button [ Command = $LoadCommand ] {
                                    TextBlock [ Text = "Load", FontSize = 11 ]
                                }
                            }
                            TextBlock
                                [ Text         = "Drag a shape onto the canvas to\n                                            place it. Click a node to\n                                            select; Ctrl-click to toggle;\n                                            Shift-click to range-extend.\n                                            Drag-rectangle on empty space\n                                            for marquee. Click empty space\n                                            to clear. Delete removes every\n                                            selected node.",
                                  TextWrapping = Wrap,
                                  FontSize     = 10,
                                  Foreground   = @OnSurfaceVariant,
                                  Margin       = (2,4,2,0) ]
                        }
                        ScrollViewer [ IsAutoHideScrollBars = false ] {
                            ItemsControl [ ItemsSource = $service(ToolboxRepository).Pages ]
                        }
                    }
                }

                // Right-side Format Shape pane — bound to the framework
                // Board's SelectionFormatFill / SelectionFormatStroke
                // (the FormatMirror collaborator seeds these from the
                // first selected leaf and broadcasts edits onto every
                // selected leaf).
                Border
                    [ DockPanel.Dock  = Right,
                      Width           = 320,
                      Fill      = @SurfaceContainerLow,
                      Padding         = (12) ] {
                    DockPanel {
                        Line [ DockPanel.Dock = Left, Orientation = Vertical, Stroke = (@OutlineVariant, 1) ]
                        TextBlock
                            [ DockPanel.Dock = Top,
                              Text           = "Format Shape",
                              FontSize       = 12,
                              FontWeight     = Bold,
                              Foreground     = @OnSurfaceVariant,
                              Margin         = (0,0,0,8) ]
                        // HorizontalScrollEnabled = false so the pane is
                        // width-constrained to the viewport (never measured
                        // with +Infinity width for horizontal scroll). Its
                        // content — the empty-state message and the editor
                        // grid — then wraps / fits the pane width instead of
                        // running off one line. A format pane only ever
                        // scrolls vertically.
                        ScrollViewer [ IsAutoHideScrollBars = false,
                                       HorizontalScrollEnabled = false ] {
                            ShapeFormatControl
                                [ Fill              = $nodes.SelectionFormatFill,
                                  Stroke            = $nodes.SelectionFormatStroke,
                                  SourceCapTemplate = $nodes.SelectionFormatSourceCap,
                                  TargetCapTemplate = $nodes.SelectionFormatTargetCap,
                                  SourceCapScale    = $nodes.SelectionFormatSourceCapScale,
                                  TargetCapScale    = $nodes.SelectionFormatTargetCapScale,
                                  ShowCaps          = $nodes.SelectionIsConnector,
                                  CapOptions        = $nodes.ConnectorCapOptions ]
                        }
                    }
                }
                Splitter
                    [ DockPanel.Dock   = Right,
                      Width            = 6,
                      Orientation      = Vertical,
                      ReverseDirection = true ]

                // Drawing area — the framework Board's default
                // Template already includes a ScrollViewer wrapping the
                // ItemsPresenter, so no enclosing Border / ScrollViewer
                // is needed here. ItemsSource is bound to Document.Nodes
                // (the flat collection of Figure + Group instances);
                // items are Visuals themselves so
                // GetContainerForItemOverride returns each item
                // unchanged.
                //
                //   DropReceiver = $Self   — relative-source-self
                //     binding: resolves to THIS Board (the Visual
                //     where the binding is authored), NOT to
                //     DataContext.Self. The Board-internal
                //     ScrollViewer is on the bubble path of every
                //     canvas drop, so the Board is the right
                //     receiver.
                //   Mutator        — NOT bound in markup. The Board
                //     auto-wires Mutator from DataContext when the DC
                //     structurally implements BoardMutator (Group /
                //     Ungroup / CombineSelection / DeleteNodes /
                //     CreateNode all defined). BoardDocument satisfies
                //     that surface, so the doc becomes the structural
                //     mutator without an extra binding line.
                Board x:name="nodes"
                    [ ItemsSource                  = $Nodes,
                      Connectors                   = $Connectors,
                      ItemsPanel                   = @BoardCanvasPanel,
                      SelectionMode                = Extended,
                      AllowMarqueeSelection        = true,
                      AlignmentGuidesEnabled       = true,
                      SelectionResizeEnabled       = true,
                      TextBlockAdornerEnabled      = true,
                      ConnectorInteractionsEnabled = true,
                      ReflectSelectionToItems      = true,
                      DropReceiver                 = $Self,
                      Focusable                    = true ]
            }
        }
    }
}
