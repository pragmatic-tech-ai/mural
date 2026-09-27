// Pragmatic theme — Splitter / GridSplitter chrome (Wave 2).
//
// These extend Thumb, which paints a hardcoded inline Border (not a
// ControlTemplate), so the rest/hover/drag COLOURS come from TS
// (splitter.ts / thumb.ts) resolving the theme-agnostic @ControlTrack /
// @ControlActive alias keys — Material and Pragmatic each define them, so
// Material stays byte-identical. The only thing these Styles must override
// for Pragmatic is PreviewBrush: Material's Style defaults it to @Primary
// (a DynamicResource), which does not exist under Pragmatic, so the
// drag-preview adorner would resolve nothing. Point it at @ControlActive.
//
// The templates are near-inert (Thumb renders its inline _border and
// ignores this PART_Border) — defined only so the Pragmatic Styles are
// self-contained rather than referencing Material's template keys. Thumb
// itself is not forked: its inline border already resolves @ControlTrack
// via TS, and Material's Thumb Style is a harmless no-colour fallback.
//
// Only Pragmatic tokens — no M3 (@OutlineVariant / @Primary) token.

resources PragmaticSplitter
{
    Template x:key="DefaultSplitter" [TargetType = Splitter]
    {
        Border x:name="PART_Border"
            [ Fill = @ControlTrack,
              CornerRadius = @RadiusNone ]
    }
    Style [TargetType = Splitter]
    {
        Template = @DefaultSplitter;
        PreviewBrush = @ControlActive;
    }

    Template x:key="DefaultGridSplitter" [TargetType = GridSplitter]
    {
        Border x:name="PART_Border"
            [ Fill = @ControlTrack,
              CornerRadius = @RadiusNone ]
    }
    Style [TargetType = GridSplitter]
    {
        Template = @DefaultGridSplitter;
        PreviewBrush = @ControlActive;
    }
}
