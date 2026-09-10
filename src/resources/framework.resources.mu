// Root composition dictionary for the framework layer.
//
// Every family's Styles + ControlTemplates live next to its
// controls under src/framework/<family>/<family>.template.mu.
// The compiler folds every imported dictionary into this one at
// Clone() time (the existing  clause already merges keyed
// entries — no compiler change was needed), so MuralFramework is
// the single composed handle that material.mu lists in its
// `dictionaries:` header.
//
// New families: drop a `.template.mu` next to the `.ts` files and
// add one import line below.

resources MuralFramework {
    import Bases from "../framework/base/base.template.mu.js"
    import Buttons from "../framework/buttons/buttons.template.mu.js"
    import ButtonGroups from "../framework/button-groups/button-groups.template.mu.js"
    import Carousels from "../framework/carousel/carousel.template.mu.js"
    import Diagrams from "../framework/diagram/diagram.template.mu.js"
    import Caps from "../framework/diagram/caps/caps.template.mu.js"
    import Formatting from "../framework/formatting/formatting.template.mu.js"
    import Lists from "../framework/list/list.template.mu.js"
    import Markers from "../framework/markers/markers.template.mu.js"
    import Menus from "../framework/menu/menu.template.mu.js"
    import Navigation from "../framework/navigation/navigation.template.mu.js"
    import Ribbons from "../framework/ribbon/ribbon.template.mu.js"
    import Notifications from "../framework/notifications/notifications.template.mu.js"
    import Pickers from "../framework/pickers/pickers.template.mu.js"
    import SearchBars from "../framework/search-bar/search-bar.template.mu.js"
    import Shells from "../framework/shell/shell.template.mu.js"
    import StatusBars from "../framework/status-bar/status-bar.template.mu.js"
    import Surfaces from "../framework/surfaces/surfaces.template.mu.js"
    import Tabs from "../framework/tabs/tabs.template.mu.js"
    import ThemeSelectors from "../framework/theme-selector/theme-selector.template.mu.js"
    import Toggles from "../framework/toggles/toggles.template.mu.js"
    import PropertyGrids from "../framework/property-grid/property-grid.template.mu.js"
    import ToolBars from "../framework/tool-bar/tool-bar.template.mu.js"
    import Tooltips from "../framework/tooltips/tooltips.template.mu.js"
    import TopAppBars from "../framework/top-app-bar/top-app-bar.template.mu.js"
    import BottomAppBars from "../framework/bottom-app-bar/bottom-app-bar.template.mu.js"
}
