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
    import PragmaticButtons from "../../framework/pragmatic/buttons/buttons.template.mu.js"
    import PragmaticIconButtons from "../../framework/pragmatic/icon-buttons/icon-buttons.template.mu.js"
    import PragmaticInputs from "../../framework/pragmatic/inputs/textbox.template.mu.js"
}
