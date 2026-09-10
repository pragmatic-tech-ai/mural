// platform.mu — the µ-mural demo platform, composed as a services-driven shell.
//
//   View    — this .mu file: an EditorShell with NO body children, driven by
//             modules + services. Its activity-bar rail binds to the
//             NavigationService (destinations flattened from the module's group
//             capabilities); the left pane presents the SELECTED group's service
//             (NavigationService.ActiveService) via the DemoGroupService template
//             the module contributes (a demo ListBox).
//   Model   — NavigationService (auto-registered + populated by EditorShell when
//             the app registers none) + one DemoGroupService per group (see
//             demo-group-services.mts). The module's `.services:` block registers
//             them; each capability's `ServiceKey` names the one that backs it.
//   Modules — DemoPlatformModule contributes one capability per demo group, the
//             per-group services, the group-content DataTemplate, and (via
//             DemoPlatformIcons) each capability's rail glyph.
//
// Composition root (backlog § 27): ALL resource + service composition lives in
// this markup. Every demo's view dictionary is `merge`d below (the demo `.mjs`
// factories no longer call `Resources.AddMergedDictionary` — they just return a
// VM), and the persistence backend is registered in `.services:` (the old
// imperative `registerInstance(DiagramStorageKey, …)` in platform.html is gone).
//
// Selection flows: rail → NavigationService.SelectedItem → ActiveService (the
// selected capability's DemoGroupService), which the left pane renders as a demo
// ListBox. Each DemoGroupService snapshots its group's demos from the registry
// and routes late registrations itself, so no bespoke navigation service is
// needed — the base NavigationService is enough.

import DemoVM from "./demo-group-services.mjs"
import DemoPlatformModule from "./demo-platform.module.mu.js"
import DemoPlatformIcons from "./demo-platform-icons.mu.js"
import EditorShell from "@pragmatic-tech-ai/mural/framework/shell/editor-shell.js"
import Material from "@pragmatic-tech-ai/mural/resources/material"
import MaterialLight from "@pragmatic-tech-ai/mural/resources/material"

// Persistence backend for the framework's DiagramStorageKey — resolved by the
// Diagrammer / Commands demos through DI. Composed here in markup, not in the
// HTML bootstrap. (DiagramStorageKey is a default compiler symbol — no import.)
import DemoStorageStore from "./demo-storage-store.mjs"

// Every demo's view dictionary. Merged app-global (below) so the shell's content
// host resolves each demo's `DataTemplate [DataType = <VM>]` when its VM is the
// active content. One import per demo — the composition root lists every
// contribution explicitly, the same shape the Plexus app root uses for its
// service dictionaries.
import AnimationDemo from "../demos/animation/animation.mu.js"
import AnimationDeclarativeDemo from "../demos/animation-declarative/animation-declarative.mu.js"
import AnimationNamedDemo from "../demos/animation-named/animation-named.mu.js"
import AnimationTriggersDemo from "../demos/animation-triggers/animation-triggers.mu.js"
import BadgeDemo from "../demos/badge/badge.mu.js"
import BannerDemo from "../demos/banner/banner.mu.js"
import BottomAppBarDemo from "../demos/bottom-app-bar/bottom-app-bar.mu.js"
import BottomSheetDemo from "../demos/bottom-sheet/bottom-sheet.mu.js"
import BouncingBallDemo from "../demos/bouncing-ball/bouncing-ball.mu.js"
import LoadingIndicatorDemo from "../demos/loading-indicator/loading-indicator.mu.js"
import SideSheetDemo from "../demos/side-sheet/side-sheet.mu.js"
import DatePickerDemo from "../demos/date-picker/date-picker.mu.js"
import TimePickerDemo from "../demos/time-picker/time-picker.mu.js"
import CarouselDemo from "../demos/carousel/carousel.mu.js"
import ButtonGroupDemo from "../demos/button-group/button-group.mu.js"
import CardDemo from "../demos/card/card.mu.js"
import DialogDemo from "../demos/dialog/dialog.mu.js"
import ColorPickerDemo from "../demos/color-picker/color-picker.mu.js"
import CommandsDemo from "../demos/commands/commands.mu.js"
import ContextMenuDemo from "../demos/context-menu/context-menu.mu.js"
import CounterDemo from "../demos/counter/counter.mu.js"
import DashboardDemo from "../demos/dashboard/dashboard.mu.js"
import DiagramDemo from "../demos/diagram/diagram.mu.js"
import Icons from "../assets/icons.mu.js"
import DragDropDemo from "../demos/drag-drop/drag-drop.mu.js"
import DragDropExtendedDemo from "../demos/drag-drop-extended/drag-drop-extended.mu.js"
import DrawerDemo from "../demos/drawer/drawer.mu.js"
import FabDemo from "../demos/fab/fab.mu.js"
import FabMenuDemo from "../demos/fab-menu/fab-menu.mu.js"
import FillEditorDemo from "../demos/fill-editor/fill-editor.mu.js"
import IconButtonDemo from "../demos/icon-button/icon-button.mu.js"
import ListBoxDemo from "../demos/list-box/list-box.mu.js"
import MenuDemo from "../demos/menu/menu.mu.js"
import NavigationRailDemo from "../demos/navigation-rail/navigation-rail.mu.js"
import PenEditorDemo from "../demos/pen-editor/pen-editor.mu.js"
import RibbonDemo from "../demos/ribbon/ribbon.mu.js"
import RichTextEditorDemo from "../demos/rich-text-editor/rich-text-editor.mu.js"
import RichTextBlockDemo from "../demos/rich-text-block/rich-text-block.mu.js"
import HitTestDemo from "../demos/hit-test/hit-test.mu.js"
import SegmentedButtonDemo from "../demos/segmented-button/segmented-button.mu.js"
import ShapesDemo from "../demos/shapes/shapes.mu.js"
import SliderDemo from "../demos/slider/slider.mu.js"
import SpinEditDemo from "../demos/spin-edit/spin-edit.mu.js"
import SplitButtonDemo from "../demos/split-button/split-button.mu.js"
import SplitterDemo from "../demos/splitter/splitter.mu.js"
import StatusBarDemo from "../demos/status-bar/status-bar.mu.js"
import TextBoxDemo from "../demos/text-box/text-box.mu.js"
import TextFormatDemo from "../demos/text-format/text-format.mu.js"
import TextOnPathDemo from "../demos/text-on-path/text-on-path.mu.js"
import ToggleButtonDemo from "../demos/toggle-button/toggle-button.mu.js"
import ToolBarDemo from "../demos/tool-bar/tool-bar.mu.js"
import TopAppBarDemo from "../demos/top-app-bar/top-app-bar.mu.js"
import TreeViewDemo from "../demos/tree-view/tree-view.mu.js"
import WordToolboxDemo from "../demos/word-toolbox/word-toolbox.mu.js"
import PropertyGridDemo from "../demos/property-grid/property-grid.mu.js"

Application [ Theme = Material, Scheme = MaterialLight ] {
    .services: {
        // Persistence backend, bound to the framework's DiagramStorageKey token.
        // Diagrammer / Commands resolve it via DI; demos that don't just run
        // without persistence.
        DemoStorageStore -> DiagramStorageKey
    }

    .modules: {
        DemoPlatformModule
    }

    resources: {
        // Group rail icons, merged app-global so each capability's
        // `Icon = @<Key>` (a DynamicResource) resolves.
        merge DemoPlatformIcons

        // Every demo's view dictionary — merged app-global so the content host
        // finds each demo's DataTemplate[DataType=<VM>]. (Icons is the shared
        // toolbox-glyph dictionary the Diagrammer demo references.)
        merge AnimationDemo
        merge AnimationDeclarativeDemo
        merge AnimationNamedDemo
        merge AnimationTriggersDemo
        merge BadgeDemo
        merge BannerDemo
        merge BottomAppBarDemo
        merge BottomSheetDemo
        merge BouncingBallDemo
        merge LoadingIndicatorDemo
        merge SideSheetDemo
        merge DatePickerDemo
        merge TimePickerDemo
        merge CarouselDemo
        merge ButtonGroupDemo
        merge CardDemo
        merge DialogDemo
        merge ColorPickerDemo
        merge CommandsDemo
        merge ContextMenuDemo
        merge CounterDemo
        merge DashboardDemo
        merge DiagramDemo
        merge Icons
        merge DragDropDemo
        merge DragDropExtendedDemo
        merge DrawerDemo
        merge FabDemo
        merge FabMenuDemo
        merge FillEditorDemo
        merge IconButtonDemo
        merge ListBoxDemo
        merge MenuDemo
        merge NavigationRailDemo
        merge PenEditorDemo
        merge RibbonDemo
        merge RichTextEditorDemo
        merge RichTextBlockDemo
        merge HitTestDemo
        merge SegmentedButtonDemo
        merge ShapesDemo
        merge SliderDemo
        merge SpinEditDemo
        merge SplitButtonDemo
        merge SplitterDemo
        merge StatusBarDemo
        merge TextBoxDemo
        merge TextFormatDemo
        merge TextOnPathDemo
        merge ToggleButtonDemo
        merge ToolBarDemo
        merge TopAppBarDemo
        merge TreeViewDemo
        merge WordToolboxDemo
        merge PropertyGridDemo

        // A demo list row — the group's ListBox renders each DemoVM through this
        // implicit-by-type template. DemoVM is the one DemoGroupService.Demos
        // holds (demo-group-services.mjs), so the DataType matches the items.
        DataTemplate [DataType = DemoVM] {
            TextBlock [ Text = $Label, Margin = (4,3,4,3) ]
        }

        // The application shell. No body children and no nav-service registration:
        // EditorShell auto-registers a base NavigationService and populates it
        // from the composed modules; the rail + left pane bind through `$service`.
        EditorShell x:root { }
    }
}
