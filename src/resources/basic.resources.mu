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
    // Style=@H3 etc. from the Typography dictionary).
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
        FontFamily = @FontSans;
        FontWeight = @BodyWeight;
        FontSize = @BodySize;
        LineHeight = @BodyLineHeight;
        LetterSpacing = @BodyTracking;
    }

    // Rich flow-content hosts share TextBlock's Body Medium baseline; the
    // per-paragraph LineHeight lives on each Block, not the host.
    Style [TargetType = RichTextBlock] {
        FontFamily = @FontSans;
        FontWeight = @BodyWeight;
        FontSize = @BodySize;
        LineHeight = @BodyLineHeight;
        LetterSpacing = @BodyTracking;
    }
    Style [TargetType = RichTextBox] {
        FontFamily = @FontSans;
        FontWeight = @BodyWeight;
        FontSize = @BodySize;
        LineHeight = @BodyLineHeight;
        LetterSpacing = @BodyTracking;
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
                        [ Foreground = @Fg1,
                          Style      = @H3 ]
                }
            }
            Border x:name="PART_Divider"
                [ DockPanel.Dock  = Top,
                  Fill      = @Border,
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
    Template x:key="DefaultSliderSpinEdit" [TargetType = SliderSpinEdit] {
        DockPanel [ LastChildFill = true ] {
            TextBlock x:name="PART_Unit"
                [ DockPanel.Dock    = Right,
                  Foreground        = @Fg2,
                  VerticalAlignment = Center,
                  Margin            = (@Space1,0,0,0) ]
            SpinEdit x:name="PART_SpinEdit"
                [ DockPanel.Dock = Right,
                  Width          = 72 ]
            Slider x:name="PART_Slider"
                [ VerticalAlignment = Center,
                  Margin            = (0,0,@Space3,0) ]
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
    Template x:key="DefaultThumb" [TargetType = Thumb] {
        Border x:name="PART_Border"
            [ Fill      = @ControlTrack,
              CornerRadius    = 2 ]
        when ( IsMouseOver ) { PART_Border.Fill = @Fg3; }
        when ( IsDragging ) { PART_Border.Fill = @Fg2; }
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
}
