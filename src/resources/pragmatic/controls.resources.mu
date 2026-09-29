// Pragmatic theme — control override dictionary.
//
// The single composed handle the Pragmatic theme lists in its
// `dictionaries:` header AFTER MuralFramework, so every key-less
// `Style[TargetType=X]` here shadows Material's for the same runtime
// class (implicit-style resolution is last-merged-wins).
//
// Wave 1 forks controls one family at a time. Each family's Pragmatic
// templates live next to their Material counterparts under
// src/framework/pragmatic/<family>/<family>.template.mu; add one import
// line below per family, mirroring framework.resources.mu.

resources PragmaticControls
{
    import PragmaticInputs from "../../framework/pragmatic/inputs/textbox.template.mu.js"
    import PragmaticToggles from "../../framework/pragmatic/toggles/toggles.template.mu.js"
    import PragmaticSliders from "../../framework/pragmatic/sliders/sliders.template.mu.js"
    import PragmaticText from "../../framework/pragmatic/text/text.template.mu.js"
    import PragmaticScrollBar from "../../framework/pragmatic/scroll/scroll-bar.template.mu.js"
    import PragmaticSplitter from "../../framework/pragmatic/scroll/splitter.template.mu.js"
}
