// platform.mu — the µ-mural demo platform, composed as a services-driven shell.
//
//   View    — this .mu file: an EditorShell with NO body children, driven by
//             modules + services. Its activity-bar rail binds to the
//             NavigationService (destinations flattened from the group modules'
//             capabilities); the left pane presents the SELECTED group's service
//             (NavigationService.ActiveService) via the shared DemoGroupService
//             template below (a demo ListBox).
//   Model   — NavigationService (auto-registered + populated by EditorShell when
//             the app registers none) + one DemoGroupService subclass per group
//             (see groups/<group>-service.mts). Each group module's `.services:`
//             block registers its service; each capability's `ServiceKey` names it.
//   Modules — six group modules (Animation / Controls / Demos / Patterns /
//             Styles & Triggers / Shape library), each contributing one capability,
//             its group service, and its demos' view dictionaries. Rail glyphs come
//             from DemoPlatformIcons (merged app-global below).
//
// Composition root: ALL resource + service composition lives in this markup and the
// group modules. Demos are composed STATICALLY (each group service imports its
// demos' descriptors) — the old runtime registry.mts is gone.

import DemoGroupService from "./demo-group-service.mjs"
import DemoVM from "./demo-group-service.mjs"
import DemoPlatformIcons from "./demo-platform-icons.mu.js"
import EditorShell from "@pragmatic-tech-ai/mural/framework/shell/editor-shell.js"
import Material from "@pragmatic-tech-ai/mural/resources/material"
import MaterialLight from "@pragmatic-tech-ai/mural/resources/material"

// Persistence backend for the framework's DiagramStorageKey — resolved by the
// Diagrammer / Commands demos through DI. (DiagramStorageKey is a default compiler
// symbol — no import.)
import DemoStorageStore from "./demo-storage-store.mjs"

// Shared toolbox-glyph dictionary the Diagrammer / Commands demos reference — an
// ASSET dictionary (not a per-demo view dict), so it stays app-global here.
import Icons from "../assets/icons.mu.js"

// The six demo group modules. Each contributes its capability, its group service,
// and merges its demos' view dictionaries.
import AnimationsModule from "./groups/animations.module.mu.js"
import ControlsModule from "./groups/controls.module.mu.js"
import DemosModule from "./groups/demos.module.mu.js"
import PatternsModule from "./groups/patterns.module.mu.js"
import StylesModule from "./groups/styles.module.mu.js"
import ShapeLibraryModule from "./groups/shape-library.module.mu.js"

Application [ Theme = Material, Scheme = MaterialLight ] {
    .services: {
        // Persistence backend, bound to the framework's DiagramStorageKey token.
        DemoStorageStore -> DiagramStorageKey

        // The shared content host, registered at the app root so the group
        // services (root singletons) resolve the SAME instance the shell's
        // PART_ContentHost binds to (`$service(ContentHostService).Content`).
        ContentHostService
    }

    .modules: {
        AnimationsModule
        ControlsModule
        DemosModule
        PatternsModule
        StylesModule
        ShapeLibraryModule
    }

    resources: {
        // Group rail icons, merged app-global so each capability's
        // `Icon = @<Key>` (a DynamicResource) resolves.
        merge DemoPlatformIcons

        // Shared toolbox glyphs (Diagrammer / Commands).
        merge Icons

        // Shared content template: every group service extends DemoGroupService,
        // so one implicit-by-type template renders all six group panes (the
        // group's demo ListBox). SelectedItem is TwoWay, so a row click writes
        // back to DemoGroupService.SelectedItem → OnSelectedItemChanged.
        DataTemplate [ DataType = DemoGroupService ] {
            ListBox [ ItemsSource = $Items, SelectedItem = $SelectedItem ]
        }

        // A demo list row — the group's ListBox renders each DemoVM through this
        // implicit-by-type template.
        DataTemplate [DataType = DemoVM] {
            TextBlock [ Text = $Label, Margin = (4,3,4,3) ]
        }

        // The application shell. No body children and no nav-service registration:
        // EditorShell auto-registers a base NavigationService and populates it
        // from the composed modules; the rail + left pane bind through `$service`.
        EditorShell x:root { }
    }
}
