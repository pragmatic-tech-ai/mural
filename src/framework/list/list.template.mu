// Default theme entries for the list family — ComboBox + its
// ComboBoxItem, TreeView + its TreeViewItem, ListBox + its
// ListBoxItem. All three controls extend Selector (so its
// SelectionMode / SelectedItem / SelectedIndex / Items machinery
// rides through transparently); Selector itself has no chrome.
//
// Merged into the root MuralFramework dictionary via an `import`
// clause in src/resources/framework.resources.mu.

resources Lists {
    // ── ComboBox (in-flow selection box) ────────────────────────────
    // MUI Outlined Select look. PART_SelectionBox receives the open /
    // close toggle click; PART_SelectionText carries the selected item
    // label (or placeholder); PART_Chevron is the right-aligned glyph.
    // ComboBox has TWO templates (selection + popup); they can't both
    // ride one default Style, so each is keyed and ComboBox.ctor reads
    // them by key explicitly.
    Template x:key="DefaultComboBoxSelection" [TargetType = ComboBox] {
        ClickableBorder x:name="PART_SelectionBox"
            [ Fill      = @Surface,
              Stroke     = Pen [ Brush = @Outline ],
              CornerRadius    = @ShapeExtraSmall,
              // Vertical padding is @Spacing1 (4), NOT @Spacing2 (8): a 32-DIP box
              // holding a ~20-DIP Body-Medium line box only has room for 6 DIP of
              // padding per side before the editable PART_EditText clips (its
              // ScrollViewer crops the overflow). @Spacing2 left just 16 DIP inner
              // < 20 → the classic middle-band clip. @Spacing1 → 24 inner, clears
              // the line. (Compact already uses @Spacing1 for the same reason.)
              // Height (fixed, NOT MinHeight): the box must read as a stable row and
              // must NOT grow to fill a tall slot — a MinHeight lets it stretch to
              // the full height of a bar that hosts it (command bar), since the
              // control's vertical alignment through the host chain doesn't pin it.
              Padding         = (@Spacing4,@Spacing1,@Spacing4,@Spacing1),
              Height          = @ListRowHeightRegular ] {
            SplitRow {
                // Left cell — overlay of the read-only label and the
                // editable field. Exactly one is Visible: the label by
                // default, the TextBox when IsEditable (toggled by the
                // trigger below). Both share the same cell so the box
                // width and baseline stay identical across the swap.
                Grid x:name="PART_SelectionSlot" [ VerticalAlignment = Center ] {
                    TextBlock x:name="PART_SelectionText"
                        [ Foreground        = @OnSurfaceVariant,
                          Style             = @BodyMedium,
                          VerticalAlignment = Center ]
                    // No font atoms — the Plain TextBox inherits Body Medium
                    // from the TextBox default Style (§ 18.13), matching the
                    // selection label above so the swap is seamless.
                    TextBox x:name="PART_EditText"
                        [ Variant           = Plain,
                          Visibility        = Collapsed,
                          AcceptsReturn     = false,
                          VerticalAlignment = Center ]
                }
                // Chevron wrapped in a ClickableBorder so it can toggle
                // the dropdown independently of the text area — essential
                // in editable mode, where clicking the text must place a
                // caret rather than open the list. The ComboBox wires the
                // click; see the IsEditable gating in combo-box.ts.
                ClickableBorder x:name="PART_ChevronButton"
                    [ Fill        = #00000000,
                      VerticalAlignment = Center ] {
                    Shape x:name="PART_Chevron"
                        [ Geometry          = @ChevronDown,
                          Fill              = @OnSurface,
                          Width             = 12,
                          Height            = 12,
                          VerticalAlignment = Center ]
                }
            }
        }
        when ( IsEditable ) {
            PART_SelectionText.Visibility = Collapsed;
            PART_EditText.Visibility = Visible;
        }
        // HasSelection swaps PART_SelectionText.Foreground from
        // @OnSurfaceVariant (placeholder tint) to @OnSurface (selected
        // item tint). IsDropDownOpen swaps PART_SelectionBox.BorderBrush
        // from @Outline (resting) to @Primary (open).
        when ( HasSelection ) { PART_SelectionText.Foreground = @OnSurface; }
        when ( IsDropDownOpen ) { PART_SelectionBox.Stroke = Pen [ Brush = @Primary ]; }

        // State-layer ladder — translucent OnSurface tints composite
        // over the @Surface resting background. Hover / focus / press
        // overlays mirror the Button family's transparent-at-rest
        // pattern (the selection box is a clickable surface; it earns
        // the same chrome). Disabled dims the entire selection box.
        when ( PART_SelectionBox.IsMouseOver ) {
            PART_SelectionBox.Fill = @StateHoverOverlay;
        }
        when ( PART_SelectionBox.IsFocused ) { PART_SelectionBox.Fill = @StateFocusOverlay; }
        when ( PART_SelectionBox.IsPressed ) { PART_SelectionBox.Fill = @StatePressOverlay; }
        when ( IsEnabled = false ) { PART_SelectionBox.Opacity = @DisabledContentOpacity; }

        // M3 density variants — tighter cell on Compact, looser on
        // Comfortable. Density is an inherited attached DP, so dropping
        // a ComboBox under a `Density = Compact` ancestor (chrome bars,
        // toolbars, the ThemeSelector pick row) shrinks automatically
        // without touching individual call sites.
        // Chevron tracks density too: Compact = 40% smaller, Comfortable
        // = 20% bigger than the 12dp regular glyph.
        when ( ThemeManager.Density = Compact ) {
            PART_SelectionBox.Padding = (@Spacing3,@Spacing1,@Spacing3,@Spacing1);
            PART_SelectionBox.Height = @ListRowHeightCompact;
            PART_Chevron.Width = 7.2;
            PART_Chevron.Height = 7.2;
        }
        when ( ThemeManager.Density = Comfortable ) {
            // @Spacing2 (8) vertical, not @Spacing3 (12): a 40-DIP box holds a
            // 20-DIP line + 24 padding = clip; @Spacing2 → 24 inner, clears it.
            PART_SelectionBox.Padding = (@Spacing4,@Spacing2,@Spacing4,@Spacing2);
            PART_SelectionBox.Height = @ListRowHeightComfortable;
            PART_Chevron.Width = 14.4;
            PART_Chevron.Height = 14.4;
        }

        // Coarse pointer (touch) — widen vertically for touch. 48-DIP box with
        // @Spacing3 (12) vertical leaves 24 inner, which clears the line.
        when ( ThemeManager.Pointer = Coarse ) {
            PART_SelectionBox.Padding = (@Spacing4,@Spacing3,@Spacing4,@Spacing3);
            PART_SelectionBox.Height = @ListRowHeightTouch;
        }
    }

    // ── ComboBox (overlay popup host) ───────────────────────────────
    // Mounted on PresentationTarget.OverlayLayer when IsDropDownOpen
    // flips true. PART_PopupHost arranges PART_Popup just below the
    // anchoring selection box; PART_Scrim absorbs outside clicks;
    // PART_PopupList is a ComboBoxItemList (internal ItemsControl
    // subclass) that turns the ComboBox.Items array into one
    // ClickableBorder row per item via its own GetContainerForItem /
    // PrepareContainerForItem hooks.
    Template x:key="DefaultComboBoxPopup" [TargetType = ComboBox] {
        ComboBoxPopupHost x:name="PART_PopupHost" {
            ClickAwayScrim x:name="PART_Scrim"
            Border x:name="PART_Popup"
                [ Fill      = @SurfaceContainerHigh,
                  Stroke     = Pen [ Brush = @OutlineVariant ],
                  CornerRadius    = @ShapeExtraSmall,
                  Effect          = @Elevation2,
                  Padding         = (@Spacing0,@Spacing1,@Spacing0,@Spacing1) ] {
                // A default height cap so a long item list scrolls inside the
                // popup instead of growing to fill (and overrunning) the screen.
                // MaxHeight clamps the ScrollViewer's desired height; the SCP
                // measures the item list unbounded, so an overflowing list gets a
                // vertical scrollbar while a short one still sizes to content.
                // Horizontal scroll is off — the popup already matches the
                // selection-box width. Authors can override MaxHeight per instance.
                ScrollViewer x:name="PART_PopupScroll"
                    [ MaxHeight = 320, HorizontalScrollEnabled = false ] {
                    ComboBoxItemList x:name="PART_PopupList"
                }
            }
        }

        // High-contrast popup chrome — M3 accessibility spec calls for
        // thicker outlines on elevated surfaces when the user has opted
        // into a more-contrast environment. Mirrors the menu popup
        // family's PrefersContrast handling.
        when ( ThemeManager.PrefersContrast = More ) { PART_Popup.Stroke = (@OutlineVariant, 2); }
    }

    // ── ComboBoxItem: popup row chrome ──────────────────────────────
    // M3 list-row pattern. Resting background is TRANSPARENT (matching
    // ListBoxItem / TreeViewItem / NavigationItem) so the state-layer
    // overlays composite predictably over whatever surface the popup
    // chrome paints (here, @SurfaceContainerHigh from PART_Popup). The
    // previous opaque-resting + translucent-hover mix produced the right
    // visual by accident — the overlay happened to composite onto the
    // matching opaque background — but the mental model violated the
    // M3 state-layer pattern called out in the audit checklist and
    // would have failed on any future popup that didn't paint
    // @SurfaceContainerHigh underneath.
    //
    // Trigger order: hover → focus → press establish the state-layer
    // ladder; selection ordered LAST so a selected row stays tinted
    // even with the pointer hovering. Disabled dims the row.
    // Typography NB: row-level Font* setters would target TextBlock-owned
    // DPs that aren't registered on ComboBoxItem's class chain (Border-
    // derived), so Setters here would throw at applyDefaultStyle time.
    // Font tokens reach the rendered label through inheritance — the
    // ComboBoxItemList host or any TextBlock authored inside an item's
    // Content carries its own typography role.
    Style [TargetType = ComboBoxItem] {
        Fill = #00000000;
        Padding = (@Spacing4,@Spacing2,@Spacing4,@Spacing2);
        when ( IsMouseOver ) { Fill = @StateHoverOverlay; }
        when ( IsFocused ) { Fill = @StateFocusOverlay; }
        when ( IsPressed ) { Fill = @StatePressOverlay; }
        when ( IsSelected ) { Fill = @SecondaryContainer; }
        when ( IsEnabled = false ) { Opacity = @DisabledContentOpacity; }

        // Density variants — mirror the rest of the list family.
        when ( ThemeManager.Density = Compact ) {
            Padding = (@Spacing3,@Spacing1,@Spacing3,@Spacing1);
        }
        when ( ThemeManager.Density = Comfortable ) {
            Padding = (@Spacing4,@Spacing3,@Spacing4,@Spacing3);
        }
        when ( ThemeManager.Pointer = Coarse ) {
            Padding = (@Spacing4,@Spacing3,@Spacing4,@Spacing3);
        }
    }

    // ── Drawer ──────────────────────────────────────────────────────
    // Promoted to src/framework/surfaces/surfaces.template.mu
    // (folded into MuralFramework, which loads alongside MuralBasic).

    // ── TreeView (chrome) ───────────────────────────────────────────
    // ItemsControl-derived: a ScrollViewer hosting an ItemsPresenter
    // where TreeView.ItemsPanel slots a vertical StackPanel containing
    // the root TreeViewItem rows.
    Template x:key="DefaultTreeView" [TargetType = TreeView] {
        ScrollViewer x:name="PART_Scroll" {
            ItemsPresenter
        }
    }
    Style [TargetType = TreeView] {
        Template = @DefaultTreeView;
    }

    // ── TreeViewItem (one row + sub-rows) ───────────────────────────
    // ItemsControl-derived: row chrome at the top (chevron + label +
    // indent spacer); ItemsPresenter below where the TreeViewItem's
    // ItemsPanel slots a CollapsibleStack containing the sub-rows.
    // The CollapsibleStack is toggled by the IsExpanded DP so closed
    // subtrees clip to zero size (and zero hit-area).
    Template x:key="DefaultTreeViewItem" [TargetType = TreeViewItem] {
        StackPanel x:name="PART_OuterStack" [ Orientation = Vertical ] {
            ClickableRow x:name="PART_Row"
                [ Padding         = (@Spacing2,@Spacing1,@Spacing2,@Spacing1),
                  Height          = @ListRowHeightRegular ] {
                // Anatomy layout: PART_Spacer (depth indent) and the
                // chevron anchor on the left; PART_TrailingSlot anchors
                // on the right; PART_LeadingSlot + the center vertical
                // stack fill in between. DockPanel keeps the trailing
                // slot pinned even when SupportingText adds a second line.
                DockPanel x:name="PART_RowInner" [ LastChildFill = true ] {
                    Border x:name="PART_Spacer"
                        [ DockPanel.Dock  = Left,
                          Width           = 0 ]
                    // Chevron column is intrinsic to the tree-row shape
                    // (no M3 spec equivalent — TreeView isn't an M3
                    // component). Width=20 stays inline as a
                    // hierarchy-specific layout constant rather than
                    // being lifted to a spacing token.
                    ChevronTarget x:name="PART_Chevron"
                        [ DockPanel.Dock  = Left,
                          Width           = 20 ] {
                        Shape x:name="PART_ChevronGlyph"
                            [ Geometry          = @ChevronRight,
                              Fill              = @OnSurfaceVariant,
                              Width             = 12,
                              Height            = 12,
                              VerticalAlignment = Center ]
                    }
                    // Leading slot — class-managed Border (not a
                    // ContentPresenter). Empty Border has Size.Zero, so
                    // the slot collapses when Leading is undefined.
                    Border x:name="PART_LeadingSlot"
                        [ DockPanel.Dock    = Left,
                          VerticalAlignment = Center ]
                    Border x:name="PART_TrailingSlot"
                        [ DockPanel.Dock    = Right,
                          VerticalAlignment = Center ]
                    StackPanel [ Orientation = Vertical, VerticalAlignment = Center ] {
                        // Header host — class-managed Border (like the
                        // leading slot). A data template's produced Visual
                        // lands here via SetChild; empty (Size.Zero) on the
                        // string-header path, where PART_Label carries the
                        // text. Exactly one of the two is ever non-empty.
                        Border x:name="PART_HeaderHost"
                        TextBlock x:name="PART_Label"
                            [ Foreground = @OnSurface,
                              Style      = @BodyMedium ]
                        TextBlock x:name="PART_SupportingText"
                            [ Foreground = @OnSurfaceVariant,
                              Style      = @BodySmall ]
                    }
                }
            }
            ItemsPresenter x:name="PART_ChildHost"
        }
        // State-layer ladder. PART_Row sources the trigger conditions
        // so a parent row doesn't light up when the pointer is over a
        // child row (TreeViewItem.IsMouseOver fires for the whole
        // subtree because IsMouseOver bubbles to ancestors; the
        // ClickableRow's own IsMouseOver does not). Hover / focus / press
        // use translucent OnSurface overlays (M3 state-layer pattern for
        // transparent-at-rest rows); selection swaps to the opaque
        // @SecondaryContainer and is ordered LAST so it outranks any
        // state-layer overlay still matching at the same trigger tier.
        when ( PART_Row.IsMouseOver ) { PART_Row.Fill = @StateHoverOverlay; }
        when ( PART_Row.IsFocused ) { PART_Row.Fill = @StateFocusOverlay; }
        when ( PART_Row.IsPressed ) { PART_Row.Fill = @StatePressOverlay; }
        when ( IsSelected ) { PART_Row.Fill = @SecondaryContainer; }
        when ( IsEnabled = false ) { PART_Row.Opacity = @DisabledContentOpacity; }

        // Density variants — mirror ListBoxItem's ladder so a TreeView
        // and a sibling ListBox under the same Density ancestor read at
        // matching row heights.
        when ( ThemeManager.Density = Compact ) {
            PART_Row.Padding = (@Spacing2,@Spacing0,@Spacing2,@Spacing0);
            PART_Row.Height = @ListRowHeightCompact;
        }
        when ( ThemeManager.Density = Comfortable ) {
            PART_Row.Padding = (@Spacing2,@Spacing2,@Spacing2,@Spacing2);
            PART_Row.Height = @ListRowHeightComfortable;
        }

        // Coarse pointer (touch) — widen to a 48dp touch target per the
        // M3 accessibility guidance. Independent of Density.
        when ( ThemeManager.Pointer = Coarse ) {
            PART_Row.Padding = (@Spacing3,@Spacing3,@Spacing3,@Spacing3);
            PART_Row.Height = @ListRowHeightTouch;
        }

        // Two-line / three-line variants — driven by SupportingText
        // through the derived HasSupportingText / IsThreeLine DPs
        // (TreeViewItem.OnPropertyChanged). Ordered AFTER density so
        // a content-driven line count wins over a density-driven
        // baseline; IsThreeLine ordered LAST so its 88dp height
        // outranks the 64dp 2-line variant when both match.
        when ( HasSupportingText ) { PART_Row.Height = @ListRowHeightTwoLine; }
        when ( IsThreeLine ) { PART_Row.Height = @ListRowHeightThreeLine; }
    }
    Style [TargetType = TreeViewItem] {
        Template = @DefaultTreeViewItem;
        // Reactive header ink for a data-template header that hosts a bare
        // TextBlock with no Foreground of its own (mirrors ListBoxItem): it
        // would otherwise freeze on the scheme active at first paint. The
        // string-path PART_Label sets its own @OnSurface (Local tier), so
        // this only reaches author-supplied header TextBlocks. Selected
        // rows flip to the M3 ink on the @SecondaryContainer pill.
        TextBlock.Foreground = @OnSurface;
        when ( IsSelected ) { TextBlock.Foreground = @OnSecondaryContainer; }
    }

    // ── ListBox (chrome) ────────────────────────────────────────────
    // ItemsControl-derived: the items panel (a vertical StackPanel,
    // built by ListBox.ItemsPanel) is slotted into the ItemsPresenter
    // by the ItemsControl base. Containers come from
    // GetContainerForItemOverride, which wraps each data item in a
    // ListBoxItem (and passes already-ListBoxItem items through
    // unchanged so declarative markup keeps working).
    Template x:key="DefaultListBox" [TargetType = ListBox] {
        ScrollViewer x:name="PART_Scroll" {
            ItemsPresenter
        }
    }
    Style [TargetType = ListBox] {
        Template = @DefaultListBox;
    }

    // ── ListBoxItem (one row) ───────────────────────────────────────
    // M3 list row chrome. PART_Border is transparent at rest; state-layer
    // ladder paints over whatever the host surface shows. M3 spec calls
    // for translucent OnSurface overlays here (rather than the opaque
    // SurfaceContainer-ladder used on solid-background surfaces like
    // ToolBarButton) because the row's resting background is transparent
    // — an opaque hover tint would clash with whatever container the
    // ListBox sits on.
    //
    // Trigger order matters: hover → focus → press establishes the
    // state-layer ladder; selection ordered LAST so a selected row stays
    // tinted with @SecondaryContainer even when the pointer is over it
    // (last-applied-wins inside the trigger priority tier).
    //
    // Density + Pointer triggers ride below the state layer because they
    // target Padding / Height, not Fill — no ordering interaction
    // with the colour ladder above.
    Template x:key="DefaultListBoxItem" [TargetType = ListBoxItem] {
        Border x:name="PART_Border"
            [ Padding         = (@Spacing2,@Spacing1,@Spacing2,@Spacing1),
              Height          = @ListRowHeightRegular ] {
            // M3 list-row anatomy: leading slot | headline+supporting | trailing slot.
            // DockPanel — Leading docks left, Trailing right, the
            // Headline / SupportingText stack fills the centre. Grid
            // with Auto/Star/Auto columns would claim infinite width
            // under ScrollViewer's "natural width" measure pass (Star
            // grabs the unbounded slot), so the DockPanel shape is
            // structurally safer here: each docked slot reports its
            // own DesiredSize, the last-child centre column fills only
            // what's left, and DesiredSize.Width comes out finite.
            //
            // PART_LeadingSlot / PART_TrailingSlot are plain Borders so
            // findFirstContentPresenter walks past them and lands on
            // PART_HeadlineSlot — ContentControl's Content keeps routing
            // through the headline slot, preserving the existing data-
            // driven path where ListBox wraps each row's data in a
            // TextBlock and assigns it to Content. Class-level wiring in
            // ListBoxItem.OnPropertyChanged plumbs the Leading / Trailing
            // Visuals into the Border slots' Child via SetChild; the
            // SupportingText DP flows into PART_SupportingText.Text.
            // Empty slots collapse to zero — Border with no Child has
            // Size.Zero, and an empty TextBlock measures to Size.Zero
            // too — so the 1-line baseline reads identically to the
            // pre-anatomy row.
            DockPanel [ LastChildFill = true ] {
                Border x:name="PART_LeadingSlot"
                    [ DockPanel.Dock    = Left,
                      VerticalAlignment = Center ]
                Border x:name="PART_TrailingSlot"
                    [ DockPanel.Dock    = Right,
                      VerticalAlignment = Center ]
                StackPanel [ Orientation = Vertical, VerticalAlignment = Center ] {
                    ContentPresenter x:name="PART_HeadlineSlot" [ HorizontalAlignment = Stretch ]
                    TextBlock x:name="PART_SupportingText"
                        [ Foreground = @OnSurfaceVariant,
                          Style      = @BodySmall ]
                }
            }
        }
        // State-layer ladder. M3 tokens — translucent OnSurface tints at
        // the 8% / 12% opacities the spec calls out.
        when ( IsMouseOver ) { PART_Border.Fill = @StateHoverOverlay; }
        when ( IsFocused ) { PART_Border.Fill = @StateFocusOverlay; }
        when ( IsPressed ) { PART_Border.Fill = @StatePressOverlay; }
        when ( IsSelected ) { PART_Border.Fill = @SecondaryContainer; }
        // Disabled — dim the entire row at the M3 content-opacity (38%).
        // dispatchPointer / dispatchKey already gate input on a disabled
        // subtree (see visual-engine/routed-event.ts), so the visual
        // dim is the only template-side responsibility. Ordered LAST
        // so the dim wins regardless of which state-layer also matches
        // (a disabled row's residual hover trigger doesn't fire — input
        // is suppressed — so trigger composition stays trivial).
        when ( IsEnabled = false ) { PART_Border.Opacity = @DisabledContentOpacity; }

        // Density variants. M3 list spec: dense=40dp, standard=48dp,
        // comfortable=56dp. mural's existing base sits below all three
        // (32dp at Regular) — a deliberately tight default that stayed
        // conservative for in-flow lists; the comfortable variant climbs
        // to the M3-standard 48dp so a Comfortable ancestor (e.g. a
        // touch-mode chrome bar) doesn't read as cramped.
        when ( ThemeManager.Density = Compact ) {
            PART_Border.Padding = (@Spacing2,@Spacing0,@Spacing2,@Spacing0);
            PART_Border.Height = @ListRowHeightCompact;
        }
        when ( ThemeManager.Density = Comfortable ) {
            PART_Border.Padding = (@Spacing2,@Spacing2,@Spacing2,@Spacing2);
            PART_Border.Height = @ListRowHeightComfortable;
        }

        // Coarse pointer (touch) — widen to a 48dp touch target per the
        // M3 accessibility guidance. Independent of Density; coarse
        // input always upgrades the row regardless of density preference.
        when ( ThemeManager.Pointer = Coarse ) {
            PART_Border.Padding = (@Spacing3,@Spacing3,@Spacing3,@Spacing3);
            PART_Border.Height = @ListRowHeightTouch;
        }

        // Two-line / three-line row variants — derived from the
        // SupportingText DP by ListBoxItem.OnPropertyChanged.
        // Ordered AFTER density / pointer so an explicit supporting-
        // text variant wins over the 1-line density baseline (a
        // supporting caption is a content signal, not a density
        // preference). IsThreeLine triggers when SupportingText
        // contains a newline.
        when ( HasSupportingText ) { PART_Border.Height = @ListRowHeightTwoLine; }
        when ( IsThreeLine ) { PART_Border.Height = @ListRowHeightThreeLine; }
    }
    Style [TargetType = ListBoxItem] {
        Template = @DefaultListBoxItem;
        // Reactive headline ink. A string item is wrapped in a bare
        // TextBlock with no Foreground of its own (ListBox.PrepareContainer),
        // so it would otherwise paint via the non-reactive render-time
        // fallback and freeze on the scheme active at first paint — the
        // list stays the old colour after a theme switch until a re-render
        // (e.g. a selection change) happens to repaint it. Setting
        // TextBlock.Foreground here (DynamicResource, reactive) cascades
        // into PART_HeadlineSlot content; PART_SupportingText keeps its own
        // @OnSurfaceVariant (Local tier). @OnSecondaryContainer on select
        // matches the M3 ink on the @SecondaryContainer selected-row pill.
        TextBlock.Foreground = @OnSurface;
        when ( IsSelected ) { TextBlock.Foreground = @OnSecondaryContainer; }
    }
}
