// Default `@HierarchyItemTemplate` — a HierarchicalDataTemplate over
// HierarchyItem, so a HierarchyItem binds into a TreeView out of the box
// (icon + caption + the Task 7 inline-rename affordance).
//
// `HierarchyItem` and `EditableTextBlock` aren't in the compiler's default
// symbol table (DEFAULT_SYMBOLS in src/compiler/symbol-table.ts only knows
// framework/basic built-ins), so both are pulled in via an explicit
// top-level `import … from "…"` clause, resolved through the package's own
// `exports` self-reference (the same path shape the generated `.mu.js`
// resolves at load time — see build-control-templates.ts's header comment).
// `HierarchyIconKeyToGeometry` (DR10's icon-resolution converter) is pulled
// in the same way.
//
// Wiring: this file is NOT imported by framework.resources.mu yet — that's
// Task 12 (full theme wiring: merging `Hierarchy` into the default theme
// dictionary and pointing TreeView's default ItemTemplate at
// `@HierarchyItemTemplate`). Here the `resources Hierarchy { … }` block is
// loadable on its own: `Hierarchy.Clone().HierarchyItemTemplate` resolves
// the HierarchicalDataTemplate directly, which is how the test exercises it.

import HierarchyItem from "@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-item.js"
import EditableTextBlock from "@pragmatic-tech-ai/mural/basic/editable-text-block.js"
import HierarchyIconKeyToGeometry from "@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-icon-converter.js"

resources Hierarchy {
    // PART_Icon resolves IconKey through the resource system (DR10): the
    // converter treats the string as a resource key and resolves it via
    // Application.ResolveDefaultResource, rendering nothing when the key
    // is '' or unresolved (Shape.Geometry = undefined paints nothing).
    // The caption path (EditableTextBlock) doesn't depend on the icon
    // resolving at all.
    HierarchicalDataTemplate x:key="HierarchyItemTemplate" [DataType = HierarchyItem, itemsselector = Children] {
        StackPanel [ Orientation = Horizontal ] {
            Shape x:name="PART_Icon" [ Geometry = $IconKey << HierarchyIconKeyToGeometry, Width = 16, Height = 16 ]
            EditableTextBlock x:name="PART_Caption" [ Text = $Caption, IsEditing = $IsEditing, EditingText = $EditingName ]
        }
    }
}
