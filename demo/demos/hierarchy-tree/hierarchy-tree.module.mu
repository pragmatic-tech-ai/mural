// hierarchy-tree.module.mu — the `Hierarchy { }` DSL half of the demo
// (Milestone C1, Task 13): two Contributor entries, each with a couple of
// nested CommandDefinition actions, so the default right-click menu
// (HierarchyContextMenuBehavior, wired in hierarchy-tree.mu) has real
// content.
//
// This module carries no Capability — it is not a navigable demo-platform
// group, and never needs to be. It exists purely to feed the Contributor
// fan-out into HierarchyContributorRegistry through the app's `.modules:`
// composition (see ../../platform/platform.mu), exactly the same path a
// real app's solution explorer would be wired into.
//
// `Under = "notebook"` / `Under = "section"` and each action's
// `Context = "..."` stay literal strings — the DSL grammar's own value
// shape, not a shortcut taken here (see hierarchy-tree-keys.mts's doc
// comment for why the TS side still shares one constants class).

import NotebookSectionsContributor from "./hierarchy-tree-contributors.mjs"
import NotebookNotesContributor from "./hierarchy-tree-contributors.mjs"

shell module HierarchyTreeDemoModule [ Name = "HierarchyTreeDemo" ] {
    .services: {
        NotebookSectionsContributor
        NotebookNotesContributor
    }

    Hierarchy {
        Contributor [ Under = "notebook", Use = NotebookSectionsContributor, Order = 0 ] {
            CommandDefinition [ Id = "hierarchy-tree-demo.section.star", Title = "Add Star", Context = "section" ] {
                CommandDefinition [ Id = "hierarchy-tree-demo.section.clearStars", Title = "Clear Stars", Context = "section" ]
            }
        }
        Contributor [ Under = "section", Use = NotebookNotesContributor, Order = 0 ] {
            CommandDefinition [ Id = "hierarchy-tree-demo.note.toggleDone", Title = "Toggle Done", Context = "note" ] {
                CommandDefinition [ Id = "hierarchy-tree-demo.note.logToConsole", Title = "Log to Console", Context = "note" ]
            }
        }
    }
}
