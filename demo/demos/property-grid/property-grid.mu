import PropertyGridVM from "./property-grid-vm.mjs"

// property-grid.mu — demo for the PropertyGrid control.
//
// Shows two property grids side by side:
//
//   Left  — DpPropertyBag over a three-DP MuralBase subclass.
//            Descriptors are auto-derived + overridden by kind.
//
//   Right — MapPropertyBag over a plain data object with four
//            mixed-kind properties (text, number, boolean, enum).
//
// The VM (PropertyGridVM) exposes DpDescriptors / DpTarget and
// MapDescriptors / MapTarget as reactive DPs; the two PropertyGrids
// bind directly to those pairs.

resources PropertyGridDemo {
    DataTemplate [DataType = PropertyGridVM] {
        Border [ Fill = @Surface ] {
            DockPanel {
                // ── Header ─────────────────────────────────────────
                Border [ DockPanel.Dock = Top, Fill = @Primary, Padding = (20,14,20,14) ] {
                    StackPanel [ Orientation = Vertical ] {
                        TextBlock
                            [ Text       = "PropertyGrid demo",
                              FontSize   = 18,
                              FontWeight = Bold,
                              Foreground = @OnPrimary ]
                        TextBlock
                            [ Text       = "Left: DpPropertyBag over a MuralBase target.  Right: MapPropertyBag over a plain object.",
                              FontSize   = 12,
                              Foreground = @OnPrimary,
                              Margin     = (0,4,0,0) ]
                    }
                }

                // ── Body ───────────────────────────────────────────
                Border [ Fill = @SurfaceContainerLow, Padding = (20,20,20,20) ] {
                    Grid {
                        ColumnDefinitions {
                            ColumnDefinition [ Width = GridLength.Star ]
                            ColumnDefinition [ Width = GridLength.Star ]
                        }

                        // Left pane — DP bag
                        StackPanel [ Orientation = Vertical, Grid.Column = 0, Margin = (0,0,12,0) ] {
                            TextBlock
                                [ Text       = "DpPropertyBag",
                                  FontSize   = 13,
                                  FontWeight = Bold,
                                  Foreground = @OnSurface,
                                  Margin     = (0,0,0,8) ]
                            PropertyGrid
                                [ Descriptors = $DpDescriptors,
                                  Target      = $DpTarget ]
                        }

                        // Right pane — Map bag
                        StackPanel [ Orientation = Vertical, Grid.Column = 1, Margin = (12,0,0,0) ] {
                            TextBlock
                                [ Text       = "MapPropertyBag",
                                  FontSize   = 13,
                                  FontWeight = Bold,
                                  Foreground = @OnSurface,
                                  Margin     = (0,0,0,8) ]
                            PropertyGrid
                                [ Descriptors = $MapDescriptors,
                                  Target      = $MapTarget ]
                        }
                    }
                }
            }
        }
    }
}
