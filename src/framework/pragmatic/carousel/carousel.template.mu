// Default theme entries for the Carousel (§18.9). Merged into the root
// MuralFramework dictionary via an `import` clause in
// src/resources/framework.resources.mu.

resources PragmaticCarousels {
    // Horizontal strip the control translates to page between cards.
    ItemsPanelTemplate x:key="CarouselStrip" {
        StackPanel [ Orientation = Horizontal ]
    }

    // ── Carousel: M3 multi-browse hero-card scroller ───────────────
    // Prev / next flank a clipped viewport (the control sizes + clips
    // PART_Viewport to VisibleCount cards and translates the items panel
    // inside PART_ItemsPresenter). Cards come from the consumer's Items +
    // ItemTemplate; the control fixes each card's width/height.
    Template x:key="DefaultCarousel" [TargetType = Carousel] {
        Border x:name="PART_Root" [ Fill = @Bg1 ] {
            DockPanel [ LastChildFill = true ] {
                IconButton x:name="PART_PrevButton"
                    [ Variant = Standard, DockPanel.Dock = Left, VerticalAlignment = Center ] {
                    Shape [ Geometry = @ChevronLeft, Fill = @Fg2, Width = 20, Height = 20 ]
                }
                IconButton x:name="PART_NextButton"
                    [ Variant = Standard, DockPanel.Dock = Right, VerticalAlignment = Center ] {
                    Shape [ Geometry = @ChevronRight, Fill = @Fg2, Width = 20, Height = 20 ]
                }
                // Viewport — Width / Height / Clip set by the control.
                Border x:name="PART_Viewport" [ VerticalAlignment = Center ] {
                    ItemsPresenter x:name="PART_ItemsPresenter"
                }
            }
        }
    }
    Style [TargetType = Carousel] {
        Template = @DefaultCarousel;
        ItemsPanel = @CarouselStrip;
    }
}
