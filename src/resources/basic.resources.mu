// Consolidated default theme for the µ-mural Controls library.
//
// Every built-in control's default Style + ControlTemplate lives here.
// Each control gets two top-level entries:
//
//   1. A `Template x:key="DefaultXxx" [TargetType=X] { … }` —
//      the visual tree (PART_* parts, default props, `when()` triggers).
//   2. A `Style [TargetType=X] { Template = @DefaultXxx; }` — the
//      default Style that drives the control's Template DP. Registered
//      under the class Function key; the framework's
//      Application.ResolveDefaultResource(X) returns this Style, which
//      Visual.resolve_theme_style applies on AttachLogical (or eagerly
//      from a control ctor via this.applyDefaultStyle()).
//
// Authoring rules used across the file:
//   * Templates are keyed `DefaultXxx`. Styles target the class. Both
//     forms register in the same merged dictionary; the compiler's
//     local-resource lookup makes `@key` resolve to the JS var
//     directly instead of going through Application.current.Resources
//     (which doesn't see the dict until create() returns).
//   * Sizing constants (paddings, heights, row metrics) live inline in
//     the markup — templates own their look.
//   * Colours used at runtime for state swaps (hover / pressed /
//     selected) ALSO appear in Controls/theme.ts under the same hex
//     literals so the TS side reads the matching brush identity rather
//     than rebuilding one per template apply.
//   * PART_* names are the contract between this file and the
//     constructor-side wiring; renaming a PART here requires the
//     matching change in the control's TS code.
//
// Multi-template controls (ComboBox: Selection + Popup;
// Drawer: Pane + Overlay) keep ONLY keyed Templates — two Templates
// can't both ride a single TargetType-keyed default Style, and the
// control's ctor reads each by string key explicitly.

resources MuralBasic {
    // ── Shared shape geometries ────────────────────────────────────
    // Chevron up / down as reusable Geometry resources (the SVG sources
    // in ./shapes are converted to Geometry at COMPILE TIME by `include`).
    // Filled closed shapes (the Material expand_more / expand_less thick
    // V), so a Shape paints them with a theme brush via Fill — e.g. a
    // dropdown / spinner / expander glyph:
    //
    //   Shape [Geometry=@ChevronDown, Fill=@OnSurfaceVariant,
    //          Width=12, Height=12]
    //
    // The Shape uniform-scales the 24×24 geometry into its slot. Authored
    // once here so every control shares one chevron shape instead of a
    // per-template "▾" / "▴" text glyph (font-dependent, doesn't tint or
    // scale cleanly).
    include "shapes/chevron-down.svg" as ChevronDown
    include "shapes/chevron-up.svg" as ChevronUp
    // Chevron-right (collapsed tree row / forward disclosure), close ✕, and
    // check ✓ — the same Shape-paints-shared-Geometry model as the chevrons
    // (§ 18.13: replaces the font-dependent "✕" / "▸" / "✓" text glyphs, which
    // didn't tint or scale cleanly). Painted via
    // `Shape [Geometry=@IconClose, Fill=@…, Width=.., Height=..]`.
    include "shapes/chevron-right.svg" as ChevronRight
    include "shapes/chevron-left.svg" as ChevronLeft
    include "shapes/close.svg" as IconClose
    // Small filled dot — the unsaved-changes indicator on a document tab
    // (Shape[Geometry=@IconDirtyDot]).
    include "shapes/dot.svg" as IconDirtyDot
    include "shapes/check.svg" as IconCheck
    // Three horizontal dots (Material more_horiz) — the "overflow / more
    // actions" affordance. Three centred <circle>s → a GeometryGroup, so it
    // paints centred in its slot with no per-glyph offset. Used by the
    // no-command dropdown split-button trigger (tool-bar.template.mu).
    include "shapes/more-horiz.svg" as MoreHoriz

    // ── TextBlock: default text contract ───────────────────────────
    // Binds FontFamily / FontSize / FontWeight / LineHeight to the M3
    // BodyMedium baseline (consumers opt into other type-scale tokens via
    // Style=@TitleLarge etc. from the Typography dictionary).
    //
    // Foreground is DELIBERATELY NOT set here. A Style-tier Foreground
    // outranks the Inherited tier (precedence: … > Style > Inherited >
    // Default) AND, because implicit styles punch through template
    // boundaries, it lands on a control's SLOTTED content too — defeating
    // the template's intent to colour that content. A Filled Button sets
    // `TextBlock.Foreground = @OnPrimary` on PART_Border expecting it to
    // inherit into the content TextBlock; a Style-tier @OnSurface on that
    // TextBlock won instead and painted near-white text on the light
    // Primary container in dark mode.
    //
    // Instead, body-text colour is the TextBlock's own DEFAULT: with
    // Foreground left at the inherited/unset tier, a control template's
    // nearer cascade (PART_Border's @OnPrimary, an Inherited value) flows
    // into the slotted content and wins; for plain text with nothing to
    // inherit, TextBlock.Render resolves the active theme's @OnSurface as
    // a render-time fallback (`?? Theme.ink`), so it shows the right
    // colour for the current scheme on every paint. NB: seeding
    // `TextBlock.Foreground` on a logical-ancestor root does NOT work —
    // mural resolves inheritance logical-chain-first, so a root value
    // shadows the template's visual-chain cascade.
    //
    // This default is NOT live-reactive on a scheme switch (it re-resolves
    // only when the TextBlock repaints). Want a plain TextBlock to re-tint
    // the instant the theme changes? Bind it: `[Foreground=@OnSurface]` —
    // a DynamicResource, reactive, and Local-tier so it also wins over any
    // template cascade.
    // The ambient default IS the Body Medium role (§ 18.13). We inline the
    // five @BodyMedium* atoms rather than `BasedOn @BodyMedium` on purpose:
    // every type-scale role (@BodyMedium included) implicitly inherits THIS
    // class-keyed default at Seal, so a `BasedOn @BodyMedium` here would make
    // default ↔ role a cycle and ResolveSetters recurse forever. The root is
    // the one legitimate place the atoms are inlined — it's the source the
    // roles override from.
    Style [TargetType = TextBlock] {
        FontFamily = @BodyMediumFont;
        FontWeight = @BodyMediumWeight;
        FontSize = @BodyMediumSize;
        LineHeight = @BodyMediumLineHeight;
        LetterSpacing = @BodyMediumTracking;
    }

    // Rich flow-content hosts share TextBlock's Body Medium baseline; the
    // per-paragraph LineHeight lives on each Block, not the host.
    Style [TargetType = RichTextBlock] {
        FontFamily = @BodyMediumFont;
        FontWeight = @BodyMediumWeight;
        FontSize = @BodyMediumSize;
        LineHeight = @BodyMediumLineHeight;
        LetterSpacing = @BodyMediumTracking;
    }
    Style [TargetType = RichTextBox] {
        FontFamily = @BodyMediumFont;
        FontWeight = @BodyMediumWeight;
        FontSize = @BodyMediumSize;
        LineHeight = @BodyMediumLineHeight;
        LetterSpacing = @BodyMediumTracking;
    }

    // ── Button ──────────────────────────────────────────────────────
    // Promoted to src/framework/buttons/buttons.template.mu
    // (folded into MuralFramework, which loads alongside MuralBasic).

    // ── List family (ComboBox(+Item) / TreeView(+Item) / ListBox(+Item))
    // Promoted to src/framework/list/list.template.mu
    // (folded into MuralFramework, which loads alongside MuralBasic).

    // ── PageView ────────────────────────────────────────────────────
    // Title strip + divider + Content area, all in a DockPanel so the
    // ContentHost fills the residue. Subtitle is NOT in markup — the
    // PageView TS code adds it to PART_HeaderStack on demand when the
    // Subtitle DP is non-empty (keeps an empty Subtitle from reserving
    // a row).
    Template x:key="DefaultPageView" [TargetType = PageView] {
        DockPanel x:name="PART_Dock" {
            Border x:name="PART_Header" [ DockPanel.Dock = Top, Padding = (20,16,20,12) ] {
                StackPanel x:name="PART_HeaderStack" [ Orientation = Vertical ] {
                    TextBlock x:name="PART_TitleText"
                        [ Foreground = @OnSurface,
                          Style      = @TitleLarge ]
                }
            }
            Border x:name="PART_Divider"
                [ DockPanel.Dock  = Top,
                  Fill      = @OutlineVariant,
                  Height          = 1 ]
            Border x:name="PART_ContentHost" [ Padding = (0) ] {
                ContentPresenter
            }
        }
    }
    Style [TargetType = PageView] {
        Template = @DefaultPageView;
    }

    // ── TextBox ─────────────────────────────────────────────────────
    // M3 Outlined Text Field — 1-DIP outline, ExtraSmall radius, inset
    // content area, focus / hover outline-colour swaps. PART_Editor
    // paints the textual content, selection rectangles, and the
    // blinking caret; the TextBox itself owns the model and writes
    // pointer + keyboard handlers, treating the editor as a passive
    // view. Phase 8.1 added the matching DefaultFilledTextBox below;
    // the default Style picks between the two via a Variant trigger.
    //
    // Press isn't a meaningful state on a focusable input surface — a
    // pointer-down lands focus rather than registering a transient
    // press tint — so the five-state ladder collapses to
    // rest / hover / focused / disabled here.
    Template x:key="DefaultOutlinedTextBox" [TargetType = TextBox] {
        Border x:name="PART_Border"
            [ Fill      = @Surface,
              Stroke     = Pen [ Brush = @Outline ],
              CornerRadius    = @ShapeExtraSmall,
              // Single-line is the default (AcceptsReturn = false). Tight vertical
              // padding keeps the one-line content UNDER the row-height floor, so
              // the floor (MinHeight) sets the field height to EXACTLY the
              // ComboBox's row height — @ListRowHeightRegular here, with the
              // density triggers below tracking the ComboBox's 28 / 40 / 48. This
              // is driven by BASE values (not an AcceptsReturn=false trigger) so
              // the field lands on the row height unconditionally. Multi-line
              // (AcceptsReturn=true) restores comfortable padding + a stretching
              // scroll surface below and grows past the floor — a floor is never a
              // cap, so auto-growing composer / property-grid fields still grow.
              Padding         = (@Spacing3,@Spacing1,@Spacing3,@Spacing1),
              MinHeight       = @ListRowHeightRegular ] {
            ScrollViewer x:name="PART_Scroll" [ VerticalAlignment = Center ] {
                TextEditorSurface x:name="PART_Editor"
            }
        }
        // Border focus / hover chrome. Order matters: hover declared
        // before focused so focused wins the trigger tier when both
        // match. Both ride through DynamicResource so theme switches
        // re-tint live.
        when ( IsMouseOver ) { PART_Border.Stroke = Pen [ Brush = @OnSurface ]; }
        when ( IsFocused ) { PART_Border.Stroke = Pen [ Brush = @Primary ]; }
        when ( IsEnabled = false ) { PART_Border.Opacity = @DisabledContentOpacity; }

        // M3 density row heights — the SAME tokens DefaultComboBoxSelection uses,
        // so a field and a dropdown in the same density-scoped row are the same
        // height. Single-line's tight base padding stays under every floor.
        when ( ThemeManager.Density = Compact ) {
            PART_Border.MinHeight = @ListRowHeightCompact;
        }
        when ( ThemeManager.Density = Comfortable ) {
            PART_Border.MinHeight = @ListRowHeightComfortable;
        }
        when ( ThemeManager.Pointer = Coarse ) {
            PART_Border.MinHeight = @ListRowHeightTouch;
        }

        // Multi-line: comfortable vertical padding + a stretching scroll surface so
        // the editor fills the (grown) box and scrolls.
        when ( AcceptsReturn = true ) {
            PART_Border.Padding = (@Spacing3,@Spacing2,@Spacing3,@Spacing2);
            PART_Scroll.VerticalAlignment = Stretch;
        }
    }

    // ── TextBox: Filled variant (M3 spec default) ──────────────────
    // Filled chrome — @SurfaceContainerHigh fill + a bottom-only
    // underline rule. The underline thickens and re-tints on focus to
    // match the M3 "active" state.
    //
    // CornerRadius rides the (TL, TR, BR, BL) tuple form so the top
    // corners get the @ShapeExtraSmall rounding while the bottom stays
    // square — the M3 Filled spec calls for the field to sit flush
    // against its bottom underline. The compiler routes
    // CornerRadius= tuples to `new CornerRadius(...)`.
    Template x:key="DefaultFilledTextBox" [TargetType = TextBox] {
        // Filled field + bottom active-indicator rule. The underline
        // was a one-sided (0,0,0,1) Border edge; it's now an oriented
        // horizontal Line stacked below the field so it stretches the
        // field width and measures to the pen thickness. The focus
        // trigger swaps the Line's Stroke (tint + thickness), matching
        // the M3 active-indicator pattern.
        StackPanel x:name="PART_Root" [ Orientation = Vertical ] {
            Border x:name="PART_Border"
                [ Fill      = @SurfaceContainerHigh,
                  CornerRadius    = (@ShapeExtraSmall,@ShapeExtraSmall,0,0),
                  // Tight base padding + row-height floor (see DefaultOutlinedTextBox):
                  // single-line lands on the ComboBox's row height; multi-line grows.
                  Padding         = (@Spacing3,@Spacing1,@Spacing3,@Spacing1),
                  MinHeight       = @ListRowHeightRegular ] {
                ScrollViewer x:name="PART_Scroll" [ VerticalAlignment = Center ] {
                    TextEditorSurface x:name="PART_Editor"
                }
            }
            Line x:name="PART_Underline"
                [ Orientation = Horizontal,
                  Stroke      = (@OnSurfaceVariant, 1) ]
        }
        // Hover lifts the fill toward @SurfaceContainerHighest (M3's
        // hover-state container token); focus thickens the bottom rule
        // to 2dp and re-tints to @Primary, matching the M3 active-
        // indicator pattern. Disabled dims the whole row.
        when ( IsMouseOver ) { PART_Border.Fill = @SurfaceContainerHighest; }
        when ( IsFocused ) {
            PART_Underline.Stroke = (@Primary, 2);
        }
        when ( IsEnabled = false ) { PART_Root.Opacity = @DisabledContentOpacity; }

        // Density row heights — same tokens as the ComboBox (see DefaultOutlinedTextBox).
        when ( ThemeManager.Density = Compact ) {
            PART_Border.MinHeight = @ListRowHeightCompact;
        }
        when ( ThemeManager.Density = Comfortable ) {
            PART_Border.MinHeight = @ListRowHeightComfortable;
        }
        when ( ThemeManager.Pointer = Coarse ) {
            PART_Border.MinHeight = @ListRowHeightTouch;
        }

        // Multi-line: comfortable padding + stretching scroll surface. See DefaultOutlinedTextBox.
        when ( AcceptsReturn = true ) {
            PART_Border.Padding = (@Spacing3,@Spacing2,@Spacing3,@Spacing2);
            PART_Scroll.VerticalAlignment = Stretch;
        }
    }

    // ── TextBox: Plain variant (chrome-less inline editor) ─────────
    // No border / background / padding — just the scrolled editor
    // surface. For hosts that supply their own frame (editable
    // ComboBox selection box, SpinEdit value field). The caret,
    // selection highlight and text render exactly as the other
    // variants; only the surrounding chrome is dropped.
    Template x:key="DefaultPlainTextBox" [TargetType = TextBox] {
        Border x:name="PART_Border"
            [ Fill      = #00000000,
              Padding         = (0) ] {
            ScrollViewer x:name="PART_Scroll" {
                TextEditorSurface x:name="PART_Editor"
            }
        }
        when ( IsEnabled = false ) { PART_Border.Opacity = @DisabledContentOpacity; }
    }

    Style [TargetType = TextBox] {
        // Outlined is mural's default (see TextBox.VariantKey comment
        // for why we deviate from M3's Filled default). The trigger
        // below swaps to the Filled template when the consumer sets
        // Variant = Filled — same shape Button / Card / IconButton
        // use to wire their variant ladders.
        Template = @DefaultOutlinedTextBox;
        when ( Variant = Filled ) { Template = @DefaultFilledTextBox; }
        when ( Variant = Plain ) { Template = @DefaultPlainTextBox; }
        // Foreground / SelectionBrush / CaretBrush defaults flow
        // through DynamicResource so theme switches re-tint live.
        // TextEditorSurface picks them up at render time off the
        // owning TextBox (PART_Editor.textBox); consumer overrides at
        // the Local tier still win.
        Foreground = @OnSurface;
        SelectionBrush = @SecondaryContainer;
        CaretBrush = @OnSurface;
        // Centre (not Stretch) so a field sits at its own height inside a taller
        // row/slot rather than stretching to fill it — pairs with the compact
        // row-height floor to keep fields a stable, dense height. Consumers that
        // genuinely want a stretching field override VerticalAlignment locally.
        VerticalAlignment = Center;
        // M3 typography — Body Medium (§ 18.13: input text is unified with
        // label/list text at 14 rather than the 16 of Body Large, so a field
        // and a plain label read at the same size). The atom set rides
        // through inheritance so PART_Editor and any consumer-injected text
        // picks them up.
        FontFamily = @BodyMediumFont;
        FontWeight = @BodyMediumWeight;
        FontSize = @BodyMediumSize;
        LineHeight = @BodyMediumLineHeight;
        LetterSpacing = @BodyMediumTracking;
    }

    // ── SpinEdit ────────────────────────────────────────────────────
    // Numeric up/down: TextBox value display on the left, vertical
    // ▴/▾ button column on the right. The outer PART_Border is the
    // Material Outlined chrome (1-DIP outline, 4-DIP radius); SpinEdit's
    // TS code refreshes its BorderBrush from the INNER TextBox's
    // IsFocused / IsMouseOver so clicking into the value field turns
    // the outline blue. PART_TextBox's own inner border is flipped to
    // zero thickness at construction so only the outer outline shows.
    // PART_ButtonColumn carries a left-edge divider; PART_Up / PART_Down
    // are click targets whose onClick callbacks the TS layer binds to
    // step the value by SmallChange.
    Template x:key="DefaultSpinEdit" [TargetType = SpinEdit] {
        Border x:name="PART_Border"
            [ Fill      = @Surface,
              Stroke     = Pen [ Brush = @Outline ],
              CornerRadius    = @ShapeExtraSmall ] {
            // SpinEdit isn't focusable itself; IsEditFocused /
            // IsEditHovered mirror the INNER TextBox's state via DPs
            // forwarded in SpinEdit's ctor. Hover tints the outline
            // toward OnSurface; focus paints it Primary (the Material
            // Outlined "active field" look). Default falls through to
            // the @Outline already on the Border.
            DockPanel {
                // Button column geometry: 18dp wide and 14dp tall per
                // arrow are mural-specific tight geometry — no M3
                // spec to anchor to (M3 has no spinner control). The
                // numbers stay inline rather than masquerading as a
                // spacing token; the surrounding state-layer chrome and
                // density triggers below carry the M3-relevant work.
                Border x:name="PART_ButtonColumn"
                    [ DockPanel.Dock  = Right,
                      Width           = 18 ] {
                    StackPanel [ Orientation = Vertical ] {
                        RepeatButton x:name="PART_Up"
                            [ Padding         = (0,2,0,2),
                              Height          = 14 ] {
                            Shape x:name="PART_UpGlyph"
                                [ Geometry            = @ChevronUp,
                                  Fill                = @OnSurfaceVariant,
                                  Width               = 10,
                                  Height              = 10,
                                  HorizontalAlignment = Center,
                                  VerticalAlignment   = Center ]
                        }
                        RepeatButton x:name="PART_Down"
                            [ Padding         = (0,2,0,2),
                              Height          = 14 ] {
                            Shape x:name="PART_DownGlyph"
                                [ Geometry            = @ChevronDown,
                                  Fill                = @OnSurfaceVariant,
                                  Width               = 10,
                                  Height              = 10,
                                  HorizontalAlignment = Center,
                                  VerticalAlignment   = Center ]
                        }
                    }
                }
                // Left-edge divider between the value field and the
                // button column. Docked Right AFTER the column so it
                // lands on the column's left edge (was the Border's
                // (1,0,0,0) one-sided border, pre-Stroke-Thickness).
                Line x:name="PART_ColumnDivider"
                    [ DockPanel.Dock = Right,
                      Orientation    = Vertical,
                      Stroke         = (@OutlineVariant, 1) ]
                TextBox x:name="PART_TextBox"
            }
        }
        // Outer-border outline ladder — IsEditFocused outranks
        // IsEditHovered (focus is the dominant state when both match).
        when ( IsEditHovered ) { PART_Border.Stroke = Pen [ Brush = @OnSurface ]; }
        when ( IsEditFocused ) { PART_Border.Stroke = Pen [ Brush = @Primary ]; }
        when ( IsEnabled = false ) { PART_Border.Opacity = @DisabledContentOpacity; }

        // Up / Down state-layer chrome — translucent OnSurface tints
        // over the @Surface backdrop. ClickableBorder writes IsPressed
        // on Down/Up/Leave/Enter (Button parity), so the press overlay
        // fires natively. Each button's IsMouseOver / IsFocused /
        // IsPressed sources its own row so a hover on PART_Up doesn't
        // light PART_Down (and vice versa).
        when ( PART_Up.IsMouseOver ) { PART_Up.Fill = @StateHoverOverlay; }
        when ( PART_Up.IsFocused ) { PART_Up.Fill = @StateFocusOverlay; }
        when ( PART_Up.IsPressed ) { PART_Up.Fill = @StatePressOverlay; }
        when ( PART_Down.IsMouseOver ) { PART_Down.Fill = @StateHoverOverlay; }
        when ( PART_Down.IsFocused ) { PART_Down.Fill = @StateFocusOverlay; }
        when ( PART_Down.IsPressed ) { PART_Down.Fill = @StatePressOverlay; }

        // Spinner geometry tracks density: Compact narrows the button
        // column and shrinks the arrows 40%; Comfortable widens it and
        // grows them 20%. The arrows still span the field height (so no
        // gap), but the whole spinner reads tighter / looser. Declared
        // BEFORE the Coarse trigger so a touch pointer (which wants a
        // bigger hit target) still wins the column width when both apply.
        when ( ThemeManager.Density = Compact ) {
            PART_ButtonColumn.Width = 12;
            PART_UpGlyph.Width = 6;
            PART_UpGlyph.Height = 6;
            PART_DownGlyph.Width = 6;
            PART_DownGlyph.Height = 6;
        }
        when ( ThemeManager.Density = Comfortable ) {
            PART_ButtonColumn.Width = 22;
            PART_UpGlyph.Width = 12;
            PART_UpGlyph.Height = 12;
            PART_DownGlyph.Width = 12;
            PART_DownGlyph.Height = 12;
        }

        // Coarse pointer (touch) — widen the button column so the arrows
        // are easier to hit. The field's padding/height density is left to
        // the inner TextBox. Last so it outranks the density width above.
        when ( ThemeManager.Pointer = Coarse ) { PART_ButtonColumn.Width = 28; }
    }
    Style [TargetType = SpinEdit] {
        Template = @DefaultSpinEdit;
    }

    // ── Slider ──────────────────────────────────────────────────────
    // Material-style single-thumb slider: a thin neutral track, a
    // tinted fill from Min to the current value, and a round-cornered
    // thumb. The Slider's TS code positions each part via the
    // SliderLayout panel — this template just paints. PART_Thumb's
    // Fill is rewritten at runtime on IsMouseOver / drag to
    // match the Theme palette.
    // CornerRadius=2 on PART_Track / PART_Fill stays inline rather
    // than chasing @ShapeExtraSmall (4dp) — the M3 Slider 2024 spec
    // calls out a tight 2dp track radius even now that the track is
    // 16dp tall, so the value is structurally part of the slider
    // shape, not a general "extra small" surface.
    //
    // M3 Slider 2024 thumb-shape redesign landed in Phase 8.6:
    // SliderLayout now sizes the thumb as a 4dp × 16dp vertical pill
    // along the drag axis (was 16 × 16 square). Track grew 4 → 16dp
    // to match. The geometric constants live in src/basic/slider.ts.
    Template x:key="DefaultSlider" [TargetType = Slider] {
        SliderLayout x:name="PART_Layout" {
            Border x:name="PART_Track"
                [ Fill      = @SurfaceContainerHighest,
                  CornerRadius    = 2 ]
            Border x:name="PART_Fill"
                [ Fill      = @Primary,
                  CornerRadius    = 2 ]
            Border x:name="PART_Thumb"
                [ Fill      = @Primary,
                  CornerRadius    = @ShapeFull ]
        }
        // Thumb state chrome. Hover sources from PART_Thumb's
        // IsMouseOver; focus sources from the templated parent's
        // IsFocused so a keyboard-driven focus stays tinted even when
        // the cursor isn't over the thumb; dragging sources from
        // Slider's read-only IsDragging DP. Dragging trigger declared
        // LAST so its setter outranks hover when both match. Disabled
        // dims both track and thumb at the M3 content opacity.
        when ( PART_Thumb.IsMouseOver ) { PART_Thumb.Fill = @PrimaryHover; }
        when ( IsFocused ) { PART_Thumb.Fill = @PrimaryHover; }
        when ( IsDragging ) { PART_Thumb.Fill = @PrimaryPress; }
        when ( IsEnabled = false ) { PART_Layout.Opacity = @DisabledContentOpacity; }
    }
    Style [TargetType = Slider] {
        Template = @DefaultSlider;
    }

    // ── SliderSpinEdit ──────────────────────────────────────────────
    // Slider + numeric-readout combo (the MS-Office "Transparency" shape):
    // a drag Slider fills the row, a fixed-width SpinEdit sits at the right
    // edge, and an optional Unit label ("%") trails it. The control's TS
    // owns the two-way Value sync + range forwarding; this template only
    // lays the three parts out. DockPanel order is Unit → SpinEdit → Slider
    // so the right edge reads "[Slider …][42][%]".
    Template x:key="DefaultSliderSpinEdit" [TargetType = SliderSpinEdit] {
        DockPanel [ LastChildFill = true ] {
            TextBlock x:name="PART_Unit"
                [ DockPanel.Dock    = Right,
                  Foreground        = @OnSurfaceVariant,
                  VerticalAlignment = Center,
                  Margin            = (@Spacing1,0,0,0) ]
            SpinEdit x:name="PART_SpinEdit"
                [ DockPanel.Dock = Right,
                  Width          = 72 ]
            Slider x:name="PART_Slider"
                [ VerticalAlignment = Center,
                  Margin            = (0,0,@Spacing3,0) ]
        }
    }
    Style [TargetType = SliderSpinEdit] {
        Template = @DefaultSliderSpinEdit;
    }

    // ── ScrollViewer ────────────────────────────────────────────────
    // Promoted to src/framework/surfaces/surfaces.template.mu
    // (folded into MuralFramework, which loads alongside MuralBasic).

    // ── ScrollBar ───────────────────────────────────────────────────
    // Material-flavoured flat track with a rounded thumb. The cross-
    // axis size (SCROLLBAR_THICKNESS) is pinned by the ScrollBar's
    // MeasureOverride; this template just paints the parts.
    Template x:key="DefaultScrollBar" [TargetType = ScrollBar] {
        ScrollBarLayout x:name="PART_Layout" {
            Border x:name="PART_Track"
                [ Fill      = @SurfaceContainerLow,
                  CornerRadius    = @ShapeExtraSmall ]
            Border x:name="PART_Thumb"
                [ Fill      = @OutlineVariant,
                  CornerRadius    = @ShapeExtraSmall ]
        }
        // Thumb tint: hover → @Outline (slightly darker), drag →
        // @OnSurfaceVariant (darkest). Drag declared LAST so it wins
        // over hover at the trigger tier when both match.
        when ( PART_Thumb.IsMouseOver ) { PART_Thumb.Fill = @Outline; }
        when ( IsDragging ) { PART_Thumb.Fill = @OnSurfaceVariant; }
        // Auto-hide resting state: fade the template layout root to
        // Opacity=0 so both track and thumb disappear without disturbing
        // layout / hit-test geometry. pulseActivity restores Opacity by
        // flipping IsFaded back to false (default value of 1 takes over
        // again).
        when ( IsFaded ) { PART_Layout.Opacity = 0; }
    }
    Style [TargetType = ScrollBar] {
        Template = @DefaultScrollBar;
    }

    // ── Thumb ──────────────────────────────────────────────────────
    // Templatable drag affordance — the primitive ScrollBar's PART_Thumb
    // and GridSplitter inherit from. Default chrome is a soft neutral
    // bar; consumers re-template for richer affordances. PART_Border is
    // the named handle for runtime tinting.
    //
    // CornerRadius=2 stays inline rather than chasing @ShapeExtraSmall
    // (=4dp) because the Thumb's 2dp radius is intentionally tighter
    // than the M3 shape scale's smallest step — a 4dp radius on a
    // thin scroll bar reads as overly rounded.
    //
    // State-layer ladder — Thumb is a drag affordance so hover and
    // drag are the dominant states; IsDragging declared LAST so it
    // outranks IsMouseOver when both match (the dragged thumb stays
    // tinted with the press-state @OnSurface even while the pointer
    // is over it).
    Template x:key="DefaultThumb" [TargetType = Thumb] {
        Border x:name="PART_Border"
            [ Fill      = @OutlineVariant,
              CornerRadius    = 2 ]
        when ( IsMouseOver ) { PART_Border.Fill = @Outline; }
        when ( IsDragging ) { PART_Border.Fill = @OnSurfaceVariant; }
    }
    Style [TargetType = Thumb] {
        Template = @DefaultThumb;
    }

    // ── GridSplitter ───────────────────────────────────────────────
    // A thin draggable bar that lives in a Grid cell and resizes the
    // adjacent columns/rows on drag. The default chrome is the same
    // soft neutral as Thumb; the GridSplitter sets its own resize
    // Cursor at runtime depending on ResizeDirection so the user gets
    // the right affordance on hover.
    Template x:key="DefaultGridSplitter" [TargetType = GridSplitter] {
        Border x:name="PART_Border"
            [ Fill      = @OutlineVariant,
              CornerRadius    = 0 ]
    }
    Style [TargetType = GridSplitter] {
        Template = @DefaultGridSplitter;
        // PreviewBrush rides the active theme via DynamicResource so a
        // theme switch re-tints the drag-preview adorner live. Consumer
        // overrides at the Local tier still win.
        PreviewBrush = @Primary;
    }

    // ── Splitter ───────────────────────────────────────────────────
    // Standalone orientation-aware splitter for non-Grid containers.
    // VSCode-sash chrome: the splitter's slot (its Width/Height in the
    // host layout) is an INVISIBLE hit area; inside it a thin divider line
    // shows by default and — on hover — tints to the accent and thickens
    // to fill the slot. The line is sized by MaxWidth/MaxHeight (not
    // Width/Height) with default Stretch alignment, so the chrome is
    // orientation-symmetric: the Orientation trigger just swaps which axis
    // is the thin one, and the hover trigger releases both to fill.
    // Chrome (thin-line-default → accent-fill-on-hover, VSCode sash style)
    // is driven imperatively off the Thumb.Border handle in splitter.ts —
    // Thumb renders a hardcoded Border (visualChildren = [_border]) rather
    // than a ControlTemplate, so a markup trigger template wouldn't apply.
    Template x:key="DefaultSplitter" [TargetType = Splitter] {
        Border x:name="PART_Border"
            [ Fill      = @OutlineVariant,
              CornerRadius    = 0 ]
    }
    Style [TargetType = Splitter] {
        Template = @DefaultSplitter;
        // PreviewBrush rides the active theme via DynamicResource so a
        // theme switch re-tints the drag-preview adorner live. Consumer
        // overrides at the Local tier still win (Style setter sits at
        // a lower tier than LocalValue).
        PreviewBrush = @Primary;
    }

    // ── ColorPicker MOVED ──────────────────────────────────────────
    // ColorPicker (and its two popup variants + Style) now live in the
    // sibling `framework.resources.mu` — the control class itself moved
    // to `src/framework/color-picker.ts` since it leans on framework
    // primitives (MenuPopupHost, ClickAwayScrim) for its popup chrome.

    // NOTE: command-surface controls (ToggleButton / ToolBar / Menu /
    // MenuButton / ContextMenu) keep their default Styles in the sibling
    // `framework.resources.mu`. Loading their bundle through THIS file
    // would run their `extends Button` declarations during Button's own
    // static block — see the Controls barrel comment around `surface.js`
    // for the TDZ explanation.
}
