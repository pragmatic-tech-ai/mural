// Barrel for the framework layer — types that sit between the runtime
// primitives (Visual, MuralBase, Style, Binding, …) and the concrete
// control library. Holds:
//
//   * `Control` — the WPF-parity templated-control base.
//   * `./commands/` — RoutedCommand / CommandBinding / CommandManager /
//     InputBinding / ICommandSource / ApplicationCommands etc.
//   * (Forthcoming as `mv` proceeds) Menu, ToolBar, Board, list
//     controls — promoted from the basic primitives layer.

export { Control } from './base/control.js';

// ── Templated-control bases + standalone controls ───────────────────
export { ContentControl } from './base/content-control.js';
export { HeaderedContentControl } from './base/headered-content-control.js';
export {
    ItemsControl,
    type GroupStyleSelector,
    type ItemContainerStyleSelector,
    type ItemTemplateSelector,
} from './base/items-control.js';
export { HeaderedItemsControl } from './base/headered-items-control.js';
export { Button, ButtonVariant, ClickMode, type ClickHandler } from './buttons/button.js';
export { IconButton } from './buttons/icon-button.js';
export { IconButtonToggle } from './buttons/icon-button-toggle.js';
export { FloatingActionButton, FabSize } from './buttons/fab.js';
export { Card, CardVariant } from './surfaces/card.js';
export {
    ColorPicker,
    ColorPickerVariant,
    MATERIAL_PALETTE,
    hsvToRgb,
    rgbToHsv,
} from './formatting/color-picker.js';
export {
    ColorScheme,
    type ColorSchemeOptions,
    OFFICE_COLOR_SCHEMES,
} from './formatting/color-scheme.js';
export {
    FontFamilyPicker,
    FontSizePicker,
    DEFAULT_FONT_FAMILIES,
    DEFAULT_FONT_SIZES,
} from './formatting/font-pickers.js';
export { BrushPicker, BrushPickerVariant } from './formatting/brush-picker.js';
export { PenEditor } from './formatting/pen-editor.js';
export { FillEditor, FillEditorVariant } from './formatting/fill-editor.js';
export { ShapeFormatControl } from './formatting/shape-format-control.js';
export { CapOption } from './formatting/cap-option.js';
export { TopAppBar, TopAppBarVariant } from './top-app-bar/top-app-bar.js';
export { BottomAppBar } from './bottom-app-bar/bottom-app-bar.js';
export { NavigationItem } from './navigation/navigation-item.js';
export { NavigationRail } from './navigation/navigation-rail.js';
export { NavigationBar } from './navigation/navigation-bar.js';
export { ShellBase } from './shell/shell.js';
export { ShellModule, Capability } from './shell/module.js';
export { EditorShell } from './shell/editor-shell.js';
export { ViewerShell } from './shell/viewer-shell.js';
export { ShellSideContentPane } from './shell/shell-side-content-pane.js';
export { PanelButton } from './shell/panel-button.js';
export { NavigationService, NavigationDestination } from './shell/services/navigation-service.js';
export { RailAction } from './shell/rail-action.js';
export { PanelDockService } from './shell/services/panel-dock-service.js';
export { type IDockPanel } from './shell/services/dock-panel.js';
export {
    DialogService,
    type DialogOptions,
    type ConfirmOptions,
} from './shell/services/dialog-service.js';
export { Inspector, type IInspector } from './shell/services/inspector.js';
export { StatusService } from './shell/services/status-service.js';
export { ClipboardService, type ClipboardWriter } from './shell/services/clipboard-service.js';
export { EditCommandsService } from './shell/commands/edit-commands-service.js';
export { AutosaveService } from './shell/services/autosave-service.js';
export { DocumentShortcutsService, type IDocumentShortcutCommands } from './shell/services/document-shortcuts-service.js';
export { FileBoardStorage } from './board/file-board-storage.js';
export { BoardWorkspaceService } from './board/services/board-workspace-service.js';
export { BoardCanvasService } from './board/services/board-canvas-service.js';
export { BoardCameraService } from './board/services/board-camera-service.js';
export { BoardGuidesService } from './board/services/board-guides-service.js';
export { PanelService, PanelSection } from './shell/services/panel-service.js';
export { CandidateChooserService, ChooserRow } from './pickers/candidate-chooser-service.js';
export {
    type IThemeService,
    ThemeServiceKey,
    ThemeServiceInstance,
} from './shell/services/theme-service.js';
export { ContentHostService } from './shell/services/content-host-service.js';
export {
    DocumentsContentHostService,
    type IDocument,
} from './shell/services/documents-content-host-service.js';
export { DocumentCloseInterceptorKey, type IDocumentCloseInterceptor } from './shell/services/document-close-interceptor.js';
export { SavePromptModel, promptSave, SavePromptResult } from './shell/services/save-prompt.js';
export { SaveOnCloseGuard } from './shell/services/save-on-close-guard.js';
export {
    TabMenuAction,
    TabMenuSeparator,
    TabMenuDocument,
} from './shell/services/tab-menu-item.js';
export { DocumentSelectorService } from './shell/services/document-selector-service.js';
export type { IActivatable } from './shell/services/activatable.js';
export {
    ApplicationSettings,
    SettingsStoreKey,
    type ISettingsStore,
} from './shell/services/application-settings-service.js';
export { SettingDefinition, SettingKind } from '@pragmatic-tech-ai/todl-runtime';
export { DocumentDefinition } from './shell/documents/document-definition.js';
export { DocumentTypeRegistry } from './shell/documents/document-type-registry.js';
export { CommandDefinition, CommandGroupPresentation } from './shell/commands/command-definition.js';
export {
    ShellControlDefinition,
    ShellRegion,
    ShellControlAlignment,
} from './shell/commands/shell-control-definition.js';
export { CommandRegistry } from './shell/commands/command-registry.js';
export { CommandViewModel, CommandToggleViewModel } from './shell/commands/command-view-model.js';
export { ToolbarService } from './shell/commands/toolbar-service.js';
export { CommandContext } from './shell/commands/command-context.js';
export {
    type ICommandDispatcher,
    isCommandDispatcher,
    type ICommandContextSource,
    isCommandContextSource,
} from './shell/commands/command-dispatcher.js';
export { type ICommandContributor } from './shell/commands/command-contributor.js';
export { CommandMenuBuilder } from './shell/commands/command-menu-builder.js';
export {
    SettingsLauncherService,
    SettingsContributionKey,
    type ISettingsContribution,
} from './shell/settings/settings-launcher.js';
export { Setting } from './shell/settings/setting.js';
export { ToggleButton } from './buttons/toggle-button.js';
export { Switch } from './toggles/switch.js';
export { Checkbox } from './toggles/checkbox.js';
export { RadioButton } from './toggles/radio-button.js';
export { RadioButtonGroup, RadioButtonItem } from './toggles/radio-button-group.js';
export { Chip, ChipVariant } from './markers/chip.js';
export {
    SegmentedButton,
    SegmentedItem,
    SegmentedPosition,
} from './button-groups/segmented-button.js';
export { ButtonGroup } from './button-groups/button-group.js';
export { SplitButton } from './button-groups/split-button.js';
export { FabMenu } from './buttons/fab-menu.js';
export { TabControl, TabItem } from './tabs/tabs.js';
export { SearchBar } from './search-bar/search-bar.js';
export { Divider } from './markers/divider.js';
export { Badge, BadgeVariant } from './markers/badge.js';
export { Tooltip } from './tooltips/tooltip.js';
export { PlacementMode, ToolTipService, TooltipPopupHost } from './tooltips/tooltip-service.js';
export { ProgressIndicator, ProgressIndicatorVariant } from './notifications/progress-indicator.js';
export { LoadingIndicator, LoadingIndicatorVariant } from './notifications/loading-indicator.js';
export { DatePicker } from './pickers/date-picker.js';
export { TimePicker } from './pickers/time-picker.js';
export { Carousel } from './carousel/carousel.js';
export { Banner } from './notifications/banner.js';
export { Snackbar } from './notifications/snackbar.js';
export { Dialog } from './surfaces/dialog.js';
export { DialogAction } from './surfaces/dialog-action.js';
export { BottomSheet } from './surfaces/bottom-sheet.js';
export { attachTooltip, showSnackbar, showDialog } from './overlay-helpers.js';
export { Drawer, DrawerVariant, ScrimSurface, TemporaryOverlayHost } from './surfaces/drawer.js';
export { SideSheet, SideSheetVariant, SideSheetOverlayHost } from './surfaces/side-sheet.js';
export { ScrollViewer, ScrollViewerLayout } from './surfaces/scroll-viewer.js';
export { GroupItem } from './surfaces/group-item.js';
export { ThemeSelector } from './theme-selector/theme-selector.js';

// ── Input management ────────────────────────────────────────────────
export { InputManager } from './input-manager.js';

// ── Commands infrastructure ─────────────────────────────────────────
export { RoutedCommand, KeyGesture, type InputGesture } from './commands/routed-command.js';
export {
    CommandBinding,
    ExecutedRoutedEventArgs,
    CanExecuteRoutedEventArgs,
    type CommandBindingOptions,
    type ExecutedRoutedEventHandler,
    type CanExecuteRoutedEventHandler,
} from './commands/command-binding.js';
export { CommandManager } from './commands/command-manager.js';
export { InputBinding, KeyBinding, MouseBinding, MouseAction } from './commands/input-binding.js';
export { CommandSourceHelper, type ICommandSource } from './commands/command-source.js';
export {
    ApplicationCommands,
    EditingCommands,
    NavigationCommands,
    MediaCommands,
} from './commands/command-library.js';

// ── List controls ───────────────────────────────────────────────────
export { Selector, MarqueeBoundsPolicy, type SelectionChangedListener } from './list/selector.js';
export { ComboBox } from './list/combo-box.js';
export { TreeView, TreeViewItem } from './list/tree-view.js';
export { ListBox, ListBoxItem, SelectionMode } from './list/list-box.js';
export { ClickableBorder } from '../basic/clickable-border.js';
export { ClickAwayScrim } from '../basic/click-away-scrim.js';
export { SplitRow, ComboBoxPopupHost, ComboBoxItemList } from './list/combo-box.js';
export { ClickableRow, ChevronTarget, CollapsibleStack } from './list/tree-view.js';

// ── Board ─────────────────────────────────────────────────────────
export {
    Board,
    attachCanvasDropBehavior,
    TOOLBOX_ITEM_FORMAT,
    MuralDataFormat,
    type IBoardViewHost,
    type ItemDroppedArgs,
    type ItemDroppedListener,
    type ExternalDroppedArgs,
    type ExternalDroppedListener,
} from './board/board.js';
export {
    BoardDocument,
    BoardStorageKey,
    type BoardStorage,
} from './board/board-document.js';
export type {
    LayoutPreview,
    LayoutPreviewNode,
    LayoutPreviewEdge,
} from './board/layout-preview.js';
export { LayoutPreviewAdorner } from './board/layout/layout-preview-adorner.js';
export { BoardHistory } from './board/history/board-history.js';
export { HistoryLayerId, type IHistoryLayer } from './board/history/history-layer.js';
export { BoardEditingContext, BoardCommandId } from './board/board-command-contexts.js';
export { BoardInspector } from './board/board-inspector.js';
export { InspectorPage, ShapeStylePage, SizePositionPage } from './board/inspector-pages.js';
export { Figure } from './board/figure.js';
export { PositionAnchor } from './board/position-anchor.js';
export { SizePositionControl } from './board/size-position-control.js';
export { NodeViewModel } from './board/node-view-model.js';
export { NodeVisualStore, type NodeVisual } from './board/serialization/node-visual-store.js';
export { TextNode } from './board/text-node.js';
export { Callout, type ILeaderTarget } from './board/callout.js';
export {
    registerNodeSerializer,
    serializerFor,
    serializerByType,
    type NodeSerializer,
    type NodeBaseRecord,
    type SerializedNodeV2,
} from './board/serialization/node-serialization.js';
export {
    BoardSettings,
    BoardSettingKey,
    SidePortsOptimizer,
} from './board/board-settings.js';
export {
    ShapeText,
    TextPlacement,
    TextAutoFit,
    isOutsideTextPlacement,
    computeTextBlockAnchor,
    type ITextStyleTarget,
} from './board/shape-text.js';
export {
    serializeFlowDocument,
    deserializeFlowDocument,
    cloneFlowDocument,
    flowDocumentToPlainText,
    flowDocumentFromPlainText,
    isEffectivelyPlainDocument,
    type SerializedDoc,
    type SerializedParagraph,
    type SerializedRun,
} from './board/serialization/shape-text-document.js';
export { TextBlockAdorner } from './board/behaviors/text-block-adorner.js';
export {
    pointAlongPolyline,
    nearestTOnPolyline,
    polylineLength,
    type RoutePoint,
} from './board/connector-route.js';
export {
    Field,
    FieldKind,
    isFieldKind,
    resolveFields,
    documentWithFields,
    type FieldResolver,
} from './board/shape-text-field.js';
export { Group } from './board/group.js';
// ── Toolbox repository subsystem ───────────────────────────────────────
export { ToolboxRepository } from './board/toolbox/toolbox-repository.js';
export { ToolboxPage } from './board/toolbox/toolbox-page.js';
export { ToolboxItem } from './board/toolbox/toolbox-item.js';
export { ToolboxVisualDescriptor } from './board/toolbox/toolbox-visual-descriptor.js';
export { ToolboxVisualPresenter } from './board/toolbox/toolbox-visual-presenter.js';
export { reconcile } from './board/toolbox/reconcile.js';
export {
    type IToolboxContextTarget,
    isToolboxContextTarget,
} from './board/toolbox/toolbox-context.js';
export { RulerBar } from './board/guides/ruler-bar.js';
export { PersistentGuidesAdorner } from './board/guides/persistent-guides-adorner.js';
export {
    attachPersistentGuides,
    type PersistentGuidesHandlers,
} from './board/behaviors/persistent-guides-behavior.js';
export {
    VisualContext,
    type IToolboxVisualResolver,
} from './board/toolbox/toolbox-visual-resolver.js';
export { VisualContextScope } from './board/toolbox/visual-context-scope.js';
export {
    type IToolboxDropFactory,
    type ToolboxDropContext,
} from './board/toolbox/toolbox-drop-factory.js';
export { ShapeToolboxItem } from './board/toolbox/shape-toolbox-item.js';
export {
    ShapeVisualResolver,
    ShapeVisualResolverKey,
} from './board/toolbox/shape-visual-resolver.js';
export { ShapeDropFactory, ShapeDropFactoryKey } from './board/toolbox/shape-drop-factory.js';
export {
    FigureKindDropFactory,
    FigureKindDropFactoryKey,
} from './board/toolbox/figure-kind-drop-factory.js';
export { ensureToolboxDefaults } from './board/toolbox/ensure-toolbox-defaults.js';
export {
    SHAPE_CATALOG,
    SHAPE_CATALOG_MAP,
    GeometryCombineMode,
    buildNodeGeometry,
    scaleGeometry,
    translateGeometry,
    normalizeToUnit,
    mergeShapes,
    type ShapeCatalogEntry,
    type NormalizedGeometry,
    type CombinableShape,
} from './board/shape-catalog.js';
export {
    attachStandardBoardMutations,
    type BoardMutator,
} from './board/behaviors/attach-standard-mutations.js';
export { Connector, AnchorClip } from './board/connector.js';
export { connectorCapOptions } from './board/caps/connector-cap-options.js';
export { ConnectorEndpoint, type ConnectorEndpointInit } from './board/connector-endpoint.js';
export { ConnectorRoutingScheduler } from './board/connector-routing-scheduler.js';
export {
    Port,
    PortSide,
    PortCoordSpace,
    PortResolver,
    type PortInit,
    type IPortHost,
} from './board/port.js';
export {
    ConnectorEnd,
    RoutingMode,
    type ResolvedAnchor,
    type RouteSpec,
    type IRouter,
    type ResolvedPortSide,
} from './board/routing/router.js';
export {
    ConnectorCreateBehavior,
    attachConnectorCreate,
    type ConnectorCreatedArgs,
    type ConnectorCreatedListener,
} from './board/behaviors/connector-create-behavior.js';
export {
    ConnectorEditAdorner,
    attachConnectorEditAdorner,
} from './board/behaviors/connector-edit-adorner.js';

// ── Property grid ────────────────────────────────────────────────────
export { PropertyGrid } from './property-grid/property-grid.js';
export {
    GridProperty,
    PropertyKind,
    type GridPropertyOptions,
} from './property-grid/grid-property.js';
export { PropertyItem, PropertyCategory } from './property-grid/property-item.js';
// DpPropertyBag (the DP-reflective bag) stays mural-owned; the DP-free core —
// MapPropertyBag, IPropertyBag, the accessor types — now lives in
// @pragmatic-tech-ai/todl-runtime, imported directly from there.
export { DpPropertyBag } from './property-grid/property-bag.js';

// Solution Hierarchy framework: HierarchyItem/Hierarchy, provider + contributor
// contracts, the contributor registry + .hierarchyContributors: DSL, command-driven
// BuildActions, and NodeKey governance.
export * from './hierarchy/index.js';
