// Command-surface barrel — ToggleButton (in basic), ToolBar, Menu,
// ContextMenu families. Kept separate from `./index.ts` because these
// controls extend `Button` and would trigger an ES-module TDZ when
// loaded as a side effect of Button's default-style cascade.
// Consumers wanting these types import explicitly from
// `mural/framework/surface.js`.

export { ToggleButton } from './buttons/toggle-button.js';
export {
    ToolBar,
    ToolBarPanel,
    ToolBarPopupHost,
    ToolBarOverflowItemsControl,
} from './tool-bar/tool-bar.js';
export {
    ToolBarButton,
    ToolBarToggleButton,
    ToolBarSeparator,
    ToolBarPosition,
    type ToolBarButtonOptions,
} from './tool-bar/tool-bar-items.js';
// Shell contribution declared by a module's `.ShellControls:` block — an
// arbitrary editor control the shell hosts in a region (command bar or status
// bar), a value editor bound to the active document (font pickers, a mode
// indicator). Exported so the compiler's class registry resolves it for the
// member-block and consumers can author it.
export { ShellControlDefinition } from './shell/commands/shell-control-definition.js';

// Gallery — base concept for a popup-hosted collection; ToolBarSplitButton
// (and future popup hosts) extend it. Menu = its default vertical variant.
export { Gallery } from './gallery/gallery.js';
export { ToolBarSplitButton } from './tool-bar/tool-bar-split-button.js';
export {
    MenuStrip,
    MenuButton,
    MenuItem,
    MenuPopupHost,
    MenuSeparator,
} from './menu/menu-strip.js';
export {
    ContextMenu,
    ContextMenuService,
} from './menu/context-menu.js';
export { CommandContextMenu } from './menu/command-context-menu.js';
export {
    StatusBar,
    StatusBarItem,
    StatusBarSeparator,
} from './status-bar/status-bar.js';
export { ThemeSelector } from './theme-selector/theme-selector.js';

// ── Ribbon family (5.11.3) ──────────────────────────────────────────
export { Ribbon, RibbonTabHeader } from './ribbon/ribbon.js';
export { RibbonTab, RibbonContextualGroup } from './ribbon/ribbon-tab.js';
export { RibbonGroup, RibbonSmallButtonColumn } from './ribbon/ribbon-group.js';
export {
    RibbonButton,
    RibbonToggleButton,
    RibbonButtonSize,
} from './ribbon/ribbon-buttons.js';
export {
    RibbonPopupButton,
    RibbonDropDownButton,
    RibbonSplitButton,
} from './ribbon/ribbon-popup-buttons.js';
export { RibbonGallery, RibbonGalleryPopupList } from './ribbon/ribbon-gallery.js';
