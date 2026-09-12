// demo-platform-icons.mu — the shared icon dictionary for the demo platform.
//
// A standalone `resources` dictionary of vector icons: each `include` splices
// an SVG (under ./icons) into a keyed Geometry resource at compile time (via
// the demo build's SVG→geometry resolver). One geometry per group capability
// shown in the shell's activity-bar rail.
//
// Merged into the app's Resources by platform.mu's `resources: { merge
// DemoPlatformIcons }`, so each capability resolves `Icon = @<Key>` (a
// DynamicResource) against Application.Resources at render time. Painted by the
// activity-bar item's Shape with a theme brush — no colour is baked in.

resources DemoPlatformIcons {
    include "icons/animation.svg" as AnimationIcon
    include "icons/controls.svg"  as ControlsIcon
    include "icons/demos.svg"     as DemosIcon
    include "icons/patterns.svg"  as PatternsIcon
    include "icons/styles.svg"    as StylesIcon
    include "icons/shapes.svg"    as ShapeLibraryIcon
}
