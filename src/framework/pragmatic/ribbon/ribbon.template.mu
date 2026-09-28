// Default theme entries for the ribbon family — Ribbon (the tabbed
// grouped command shell), RibbonTab / RibbonTabHeader, RibbonGroup /
// RibbonSmallButtonColumn, the invokers (RibbonButton /
// RibbonToggleButton / RibbonDropDownButton / RibbonSplitButton), and
// RibbonGallery.
//
// Merged into the root MuralFramework dictionary via an `import`
// clause in src/resources/framework.resources.mu.

resources PragmaticRibbons {
    // ── Shared items panels ─────────────────────────────────────────
    // Horizontal strip of groups inside a RibbonTab body.
    ItemsPanelTemplate x:key="DefaultRibbonGroupsPanel" {
        StackPanel [ Orientation = Horizontal ]
    }
    // Horizontal row of invokers inside a RibbonGroup.
    ItemsPanelTemplate x:key="DefaultRibbonInvokersPanel" {
        StackPanel [ Orientation = Horizontal ]
    }
    // Vertical stack for a dropdown / split button's popup rows.
    ItemsPanelTemplate x:key="DefaultRibbonMenuPanel" {
        StackPanel [ Orientation = Vertical ]
    }

    // ── RibbonButton ────────────────────────────────────────────────
    // Two footprints driven by the Size DP: Large stacks a 32px icon over
    // a wrapping label (the group anchor); Small is a compact icon+label
    // row (three per RibbonSmallButtonColumn). The icon/label composition
    // is built by the control into Content; this template only supplies
    // the chrome (state layers + per-size sizing).
    Template x:key="DefaultRibbonButton" [TargetType = RibbonButton] {
        Border x:name="PART_Border"
            [ Fill   = #00000000,
              CornerRadius = @RadiusSm,
              Padding      = (@Space2,@Space1,@Space2,@Space1) ] {
            ContentPresenter [ HorizontalAlignment = Center, VerticalAlignment = Center ]
        }
        when ( IsMouseOver ) { PART_Border.Fill = @Bg2; }
        when ( IsPressed ) { PART_Border.Fill = @Bg3; }
        when ( IsEnabled = false ) { PART_Border.Opacity = @OpacityDisabled; }
        when ( Size = Large ) { PART_Border.MinWidth = 56; PART_Border.MinHeight = 68; PART_Border.Padding = (@Space2,@Space2,@Space2,@Space2); }
        // Medium — one icon+label row; three stack to roughly a Large's
        // height inside a RibbonSmallButtonColumn.
        when ( Size = Medium ) { PART_Border.MinHeight = 24; }
        when ( Size = Small ) { PART_Border.MinHeight = 24; }
        // Coarse pointer — the ribbon's density knob is its own Size DP
        // (Large / Medium / Small), so touch-mode adaptation only ENLARGES the tap
        // padding rather than re-running a density ladder. Padding-only
        // (not MinHeight) so it composes with, rather than clobbers, the
        // Size trigger's height; declared last so it wins the padding slot.
        when ( ThemeManager.Pointer = Coarse ) { PART_Border.Padding = (@Space3,@Space3,@Space3,@Space3); }
    }
    Style [TargetType = RibbonButton] {
        Template = @DefaultRibbonButton;
        HorizontalAlignment = Left;
        VerticalAlignment = Top;
        TextBlock.Foreground    = @Fg1;
        TextBlock.FontFamily    = @FontSans;
        TextBlock.FontWeight    = @UiCaptionWeight;
        TextBlock.FontSize      = @UiCaptionSize;
        TextBlock.LineHeight    = @UiCaptionLineHeight;
        TextBlock.LetterSpacing = @UiCaptionTracking;
    }

    // ── RibbonToggleButton ──────────────────────────────────────────
    // Same shape + an IsChecked trigger that swaps to a filled-tonal
    // chrome so a sticky toggle stays visible in a group.
    Template x:key="DefaultRibbonToggleButton" [TargetType = RibbonToggleButton] {
        // PART_Border is the hover/press surface; the checked fill lives on a
        // dedicated opaque PART_Selected layer ABOVE it (carrying the content
        // padding) so a checked toggle that is also hovered keeps its
        // @SurfaceSelected cue — triggers are chronological/last-event-wins,
        // so a shared-element checked fill would be erased by hover.
        Border x:name="PART_Border"
            [ Fill   = #00000000,
              CornerRadius = @RadiusSm ] {
            Border x:name="PART_Selected"
                [ Fill   = #00000000,
                  CornerRadius = @RadiusSm,
                  Padding      = (@Space2,@Space1,@Space2,@Space1) ] {
                ContentPresenter [ HorizontalAlignment = Center, VerticalAlignment = Center ]
            }
        }
        when ( IsMouseOver ) { PART_Border.Fill = @Bg2; }
        when ( IsPressed ) { PART_Border.Fill = @Bg3; }
        when ( IsChecked ) { PART_Selected.Fill = @SurfaceSelected; }
        when ( IsEnabled = false ) { PART_Border.Opacity = @OpacityDisabled; }
        when ( Size = Large ) { PART_Border.MinWidth = 56; PART_Border.MinHeight = 68; PART_Selected.Padding = (@Space2,@Space2,@Space2,@Space2); }
        when ( Size = Medium ) { PART_Border.MinHeight = 24; }
        when ( Size = Small ) { PART_Border.MinHeight = 24; }
        // Coarse pointer — enlarge tap padding only (density = Size DP). See
        // RibbonButton.
        when ( ThemeManager.Pointer = Coarse ) { PART_Selected.Padding = (@Space3,@Space3,@Space3,@Space3); }
    }
    Style [TargetType = RibbonToggleButton] {
        Template = @DefaultRibbonToggleButton;
        HorizontalAlignment = Left;
        VerticalAlignment = Top;
        TextBlock.Foreground    = @Fg1;
        TextBlock.FontFamily    = @FontSans;
        TextBlock.FontWeight    = @UiCaptionWeight;
        TextBlock.FontSize      = @UiCaptionSize;
        TextBlock.LineHeight    = @UiCaptionLineHeight;
        TextBlock.LetterSpacing = @UiCaptionTracking;
    }

    // ── RibbonDropDownButton ────────────────────────────────────────
    // The whole trigger opens a dropdown popup of secondary commands.
    // PART_ContentHost hosts the icon/label composition; a trailing ▾
    // marks the dropdown. The popup chrome (primary Template) mirrors the
    // MenuButton popup.
    Template x:key="DefaultRibbonDropDownTrigger" [TargetType = RibbonDropDownButton] {
        Button x:name="PART_Trigger" {
            StackPanel [ Orientation = Horizontal ] {
                StackPanel x:name="PART_ContentHost" [ Orientation = Vertical ]
                Shape [ Geometry = @ChevronDown, Fill = @Fg1, Width = 12, Height = 12, Margin = (@Space1,0,0,0), VerticalAlignment = Center ]
            }
        }
    }
    Template x:key="DefaultRibbonDropDownPopup" [TargetType = RibbonDropDownButton] {
        MenuPopupHost x:name="PART_PopupHost" {
            ClickAwayScrim x:name="PART_Scrim"
            Border x:name="PART_PopupContainer"
                [ Fill      = @Bg1,
                  Stroke     = Pen [ Brush = @Border ],
                  CornerRadius    = @RadiusLg,
                  Effect          = @ShadowMd,
                  Padding         = (0) ] {
                ItemsPresenter
            }
        }
    }
    Style [TargetType = RibbonDropDownButton] {
        Template = @DefaultRibbonDropDownPopup;
        TriggerTemplate = @DefaultRibbonDropDownTrigger;
        ItemsPanel = @DefaultRibbonMenuPanel;
        HorizontalAlignment = Left;
        VerticalAlignment = Top;
    }

    // ── RibbonSplitButton ───────────────────────────────────────────
    // PART_Primary fires the primary Command; PART_Arrow opens the same
    // dropdown popup. A faint divider between them cues the two halves.
    Template x:key="DefaultRibbonSplitTrigger" [TargetType = RibbonSplitButton] {
        StackPanel [ Orientation = Horizontal ] {
            Button x:name="PART_Primary" {
                StackPanel x:name="PART_ContentHost" [ Orientation = Vertical ]
            }
            Button x:name="PART_Arrow" {
                Shape [ Geometry = @ChevronDown, Fill = @Fg1, Width = 12, Height = 12, VerticalAlignment = Center ]
            }
        }
    }
    Template x:key="DefaultRibbonSplitPopup" [TargetType = RibbonSplitButton] {
        MenuPopupHost x:name="PART_PopupHost" {
            ClickAwayScrim x:name="PART_Scrim"
            Border x:name="PART_PopupContainer"
                [ Fill      = @Bg1,
                  Stroke     = Pen [ Brush = @Border ],
                  CornerRadius    = @RadiusLg,
                  Effect          = @ShadowMd,
                  Padding         = (0) ] {
                ItemsPresenter
            }
        }
    }
    Style [TargetType = RibbonSplitButton] {
        Template = @DefaultRibbonSplitPopup;
        TriggerTemplate = @DefaultRibbonSplitTrigger;
        ItemsPanel = @DefaultRibbonMenuPanel;
        HorizontalAlignment = Left;
        VerticalAlignment = Top;
    }

    // ── RibbonSmallButtonColumn ─────────────────────────────────────
    // A plain vertical stack; the control coerces its children to
    // Size=Small. No chrome of its own.
    Style [TargetType = RibbonSmallButtonColumn] {
        VerticalAlignment = Center;
    }

    // ── RibbonGroup ─────────────────────────────────────────────────
    // Bordered box: invokers row on top, Header centred at the bottom
    // with an optional `↘` launcher in the corner. PART_Launcher's width
    // is toggled by the control based on LaunchCommand presence.
    Template x:key="DefaultRibbonGroup" [TargetType = RibbonGroup] {
        // Group separator — was PART_Border's one-sided right border
        // BorderThickness (0,0,1,0). Now a 1dp vertical oriented Line docked
        // at the group's right edge; the Border keeps only its padding.
        DockPanel [ LastChildFill = true ] {
            Line [ DockPanel.Dock = Right, Orientation = Vertical, Stroke = (@Border, 1) ]
            Border x:name="PART_Border"
                [ Padding         = (@Space2) ] {
            DockPanel [ LastChildFill = true ] {
                Grid [ DockPanel.Dock = Bottom ] {
                    // Content-height row (the header label + corner
                    // launcher) with a default full-width star column so the
                    // header centres under the invokers. Without the Auto row
                    // the implicit star row fills the whole docked height and
                    // the group balloons to the ribbon body's height.
                    RowDefinitions {
                        RowDefinition [ Height = GridLength.Auto ]
                    }
                    TextBlock
                        [ Text                = $$Header,
                          HorizontalAlignment = Center,
                          Foreground          = @Fg2,
                          Style               = @UiCaption ]
                    Button x:name="PART_Launcher" [ HorizontalAlignment = Right, VerticalAlignment = Bottom ] {
                        TextBlock [ Text = "↘" ]
                    }
                }
                StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {
                    ItemsPresenter
                }
            }
            }
        }
    }
    Style [TargetType = RibbonGroup] {
        Template = @DefaultRibbonGroup;
        ItemsPanel = @DefaultRibbonInvokersPanel;
    }

    // ── RibbonTab (body) ────────────────────────────────────────────
    // The selected tab's body — a horizontal strip of its RibbonGroups.
    // The tab HEADER is rendered separately by the Ribbon (RibbonTabHeader).
    Template x:key="DefaultRibbonTab" [TargetType = RibbonTab] {
        Border [ Padding = (@Space1) ] {
            ItemsPresenter
        }
    }
    Style [TargetType = RibbonTab] {
        Template = @DefaultRibbonTab;
        ItemsPanel = @DefaultRibbonGroupsPanel;
    }

    // ── RibbonTabHeader ─────────────────────────────────────────────
    // One clickable tab header in the strip. AccentBrush (bound via
    // TemplateBinding) tints a contextual tab's background — undefined =
    // transparent (stable look). IsCurrent underlines the selected tab
    // with @ControlAccent; hover shows a fainter @BorderStrong underline.
    Template x:key="DefaultRibbonTabHeader" [TargetType = RibbonTabHeader] {
        DockPanel [ LastChildFill = true ] {
            // Selected/hover underline — was PART_Border's one-sided bottom
            // border BorderThickness (0,0,0,2), transparent until IsCurrent /
            // IsMouseOver flipped its stroke. Now a 2dp horizontal oriented
            // Line docked at the header's bottom edge; the triggers below
            // repaint the Line's stroke brush.
            Line x:name="PART_Indicator" [ DockPanel.Dock = Bottom, Orientation = Horizontal, Stroke = (#00000000, 2) ]
            Border x:name="PART_Border"
                [ Fill      = $$AccentBrush,
                  Padding         = (@Space4,@Space2,@Space4,@Space2) ] {
                ContentPresenter [ VerticalAlignment = Center ]
            }
        }
        // The current-tab underline responds to IsCurrent only. Material also
        // previewed a @BorderStrong underline on hover, but that shared the
        // one PART_Indicator element with the current cue — a hovered current
        // tab would lose its accent (chronological triggers). Dropped, matching
        // the Pragmatic TabControl fork (no hover underline).
        when ( IsCurrent ) { PART_Indicator.Stroke = (@ControlAccent, 2); }
        // Adaptive layout — the tab strip has no Size DP (that's the invoker
        // knob), so it carries the full density + coarse-pointer ladder on
        // its header padding, scaled from the resting (16,8) on the 4dp grid.
        when ( ThemeManager.Density = Compact ) { PART_Border.Padding = (@Space3,@Space1,@Space3,@Space1); }
        when ( ThemeManager.Density = Comfortable ) { PART_Border.Padding = (@Space5,@Space3,@Space5,@Space3); }
        when ( ThemeManager.Pointer = Coarse ) { PART_Border.Padding = (@Space4,@Space3,@Space4,@Space3); }
    }
    Style [TargetType = RibbonTabHeader] {
        Template = @DefaultRibbonTabHeader;
        TextBlock.Foreground = @Fg2;
        // Full Title Small atom set (§ 18.13 — was Font/Weight/Size only).
        // Injected into the header text via cross-class TextBlock.* inherited
        // writes, so it can't be a `Style = @UiLabel`.
        TextBlock.FontFamily = @FontSans;
        TextBlock.FontWeight = @UiLabelWeight;
        TextBlock.FontSize   = @UiLabelSize;
        TextBlock.LineHeight = @UiLabelLineHeight;
        TextBlock.LetterSpacing = @UiLabelTracking;
        when ( IsCurrent ) { TextBlock.Foreground = @ControlAccent; }
    }

    // ── RibbonGallery ───────────────────────────────────────────────
    // Inline preview strip (ItemsPresenter over a horizontal WrapPanel set
    // by the control) with a `▾` PART_More button that opens the full set
    // in an overlay dropdown (PopupTemplate).
    Template x:key="DefaultRibbonGallery" [TargetType = RibbonGallery] {
        Border
            [ Stroke     = Pen [ Brush = @Border ],
              CornerRadius    = @RadiusSm,
              Padding         = (@Space1) ] {
            DockPanel [ LastChildFill = true ] {
                Button x:name="PART_More" [ DockPanel.Dock = Right ] {
                    Shape [ Geometry = @ChevronDown, Fill = @Fg1, Width = 12, Height = 12 ]
                }
                ItemsPresenter
            }
        }
    }
    Template x:key="DefaultRibbonGalleryPopup" [TargetType = RibbonGallery] {
        MenuPopupHost x:name="PART_PopupHost" {
            ClickAwayScrim x:name="PART_Scrim"
            Border x:name="PART_PopupContainer"
                [ Fill      = @Bg1,
                  Stroke     = Pen [ Brush = @Border ],
                  CornerRadius    = @RadiusLg,
                  Effect          = @ShadowMd,
                  Padding         = (@Space2) ] {
                RibbonGalleryPopupList x:name="PART_PopupList" [ MaxWidth = 320 ]
            }
        }
    }
    Style [TargetType = RibbonGallery] {
        Template = @DefaultRibbonGallery;
        PopupTemplate = @DefaultRibbonGalleryPopup;
    }

    // ── Ribbon (shell) ──────────────────────────────────────────────
    // Vertical composition: a QAT row, a tab-strip row (with the minimize
    // chevron), and a body area. The control builds the tab-header buttons
    // into PART_TabStrip and slots the selected tab's body into PART_Body;
    // PART_BodyContainer collapses when IsMinimized.
    Template x:key="DefaultRibbon" [TargetType = Ribbon] {
        Border x:name="PART_Root"
            [ Fill      = @Bg1 ] {
            DockPanel [ LastChildFill = true ] {
                StackPanel x:name="PART_Qat"
                    [ DockPanel.Dock = Top,
                      Orientation    = Horizontal,
                      Fill      = @Bg2 ]
                DockPanel [ DockPanel.Dock = Top, LastChildFill = true ] {
                    Button x:name="PART_MinimizeButton" [ DockPanel.Dock = Right ] {
                        TextBlock [ Text = "⌃" ]
                    }
                    StackPanel x:name="PART_TabStrip" [ Orientation = Horizontal ]
                }
                // Bottom edge rule — was PART_Root's one-sided bottom border
                // BorderThickness (0,0,0,1); now a 1dp horizontal oriented Line
                // docked at the ribbon's bottom edge.
                Line [ DockPanel.Dock = Bottom, Orientation = Horizontal, Stroke = (@Border, 1) ]
                Border x:name="PART_BodyContainer"
                    [ DockPanel.Dock = Top,
                      Fill      = @Bg1,
                      Padding         = (@Space2) ] {
                    ContentPresenter x:name="PART_Body"
                }
            }
        }
    }
    Style [TargetType = Ribbon] {
        Template = @DefaultRibbon;
        // A ribbon is a top-docked command bar — it sizes to its content
        // height and never stretches to fill the vertical space a host
        // hands it (otherwise the body area + group dividers run the full
        // window height). Horizontal stretch is kept (default) so the tab
        // strip spans the width.
        VerticalAlignment = Top;
    }
}
