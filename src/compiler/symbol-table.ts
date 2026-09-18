// Symbol-table: maps unqualified PascalCase identifiers used in `.mu`
// source to the module they come from. Used by the emitter to build the
// `import { … } from "…"` header at the top of compiled JS, and to
// recognise legal references during bind.
//
// Pluggable: callers can wrap or replace `DEFAULT_SYMBOLS` to handle
// custom control libraries.

export type SymbolMap = Map<string, string>;

const ENTRIES: ReadonlyArray<readonly [string, string]> = [
    // ── runtime ─────────────────────────────────────────────────────
    ['Application',         '@pragmatic-tech-ai/mural/runtime'],
    ['ServiceProvider',     '@pragmatic-tech-ai/mural/runtime'],
    ['Visual',              '@pragmatic-tech-ai/mural/runtime'],
    ['Single',              '@pragmatic-tech-ai/mural/runtime'],
    ['Panel',               '@pragmatic-tech-ai/mural/runtime'],
    ['ResourceDictionary',  '@pragmatic-tech-ai/mural/runtime'],
    ['Style',               '@pragmatic-tech-ai/mural/runtime'],
    ['Setter',              '@pragmatic-tech-ai/mural/runtime'],
    ['SetterFactory',       '@pragmatic-tech-ai/mural/runtime'],
    ['PropertyTrigger',     '@pragmatic-tech-ai/mural/runtime'],
    ['TriggerUnset',        '@pragmatic-tech-ai/mural/runtime'],
    ['TriggerSet',          '@pragmatic-tech-ai/mural/runtime'],
    ['EventTrigger',           '@pragmatic-tech-ai/mural/runtime'],
    ['BeginStoryboardAction',  '@pragmatic-tech-ai/mural/runtime'],
    ['InvokeCommandAction',    '@pragmatic-tech-ai/mural/runtime'],
    ['StopStoryboardAction',   '@pragmatic-tech-ai/mural/runtime'],
    ['PauseStoryboardAction',  '@pragmatic-tech-ai/mural/runtime'],
    ['ResumeStoryboardAction', '@pragmatic-tech-ai/mural/runtime'],
    ['AttachBehaviorAction',   '@pragmatic-tech-ai/mural/runtime'],
    ['DetachBehaviorAction',   '@pragmatic-tech-ai/mural/runtime'],
    ['Storyboard',             '@pragmatic-tech-ai/mural/runtime'],
    ['DoubleAnimation',        '@pragmatic-tech-ai/mural/runtime'],
    ['ColorAnimation',         '@pragmatic-tech-ai/mural/runtime'],
    ['ThicknessAnimation',     '@pragmatic-tech-ai/mural/runtime'],
    ['Binding',             '@pragmatic-tech-ai/mural/runtime'],
    ['BindingMode',         '@pragmatic-tech-ai/mural/runtime'],
    ['DynamicResource',     '@pragmatic-tech-ai/mural/runtime'],
    ['DataContextBinding',  '@pragmatic-tech-ai/mural/runtime'],
    ['ElementNameBinding',  '@pragmatic-tech-ai/mural/runtime'],
    ['ServiceBinding',      '@pragmatic-tech-ai/mural/runtime'],
    ['SelfBinding',         '@pragmatic-tech-ai/mural/runtime'],
    ['composeConverters',   '@pragmatic-tech-ai/mural/runtime'],
    // Built-in color modifiers — converter factories usable on the `<<`
    // pipe (`#0d47a1 << Lighten(0.5)`). User-defined modifiers follow the
    // same shape and are pulled in with a `.mu` import clause instead.
    ['Lighten',             '@pragmatic-tech-ai/mural/runtime'],
    ['Darken',              '@pragmatic-tech-ai/mural/runtime'],
    ['Mix',                 '@pragmatic-tech-ai/mural/runtime'],
    ['Saturate',            '@pragmatic-tech-ai/mural/runtime'],
    ['Desaturate',          '@pragmatic-tech-ai/mural/runtime'],
    ['Alpha',               '@pragmatic-tech-ai/mural/runtime'],
    // General value-reflection converter factory for `$path << Is(x)`:
    // convert → `value === x`, convertBack → `x`. Drives a ToggleButton's
    // IsChecked from an enum-valued binding (radio-style selection where
    // clicking always selects x, so clicking the active one is a no-op).
    ['Is',                  '@pragmatic-tech-ai/mural/runtime'],
    // Boolean → Visibility converter factory for `Visibility = $path <<
    // ToVisibility()`: truthy → Visible, falsy → Collapsed (or the passed
    // Visibility). Collapses a region reactively off a bool DP.
    ['ToVisibility',        '@pragmatic-tech-ai/mural/runtime'],
    ['MultiBinding',        '@pragmatic-tech-ai/mural/runtime'],
    ['TemplateBinding',     '@pragmatic-tech-ai/mural/runtime'],
    ['MultiTrigger',        '@pragmatic-tech-ai/mural/runtime'],
    ['DataTrigger',         '@pragmatic-tech-ai/mural/runtime'],
    ['MultiDataTrigger',    '@pragmatic-tech-ai/mural/runtime'],
    ['HorizontalAlignment', '@pragmatic-tech-ai/mural/runtime'],
    ['VerticalAlignment',   '@pragmatic-tech-ai/mural/runtime'],
    ['Visibility',          '@pragmatic-tech-ai/mural/runtime'],
    ['Point',               '@pragmatic-tech-ai/mural/runtime'],
    ['Size',                '@pragmatic-tech-ai/mural/runtime'],
    ['Rect',                '@pragmatic-tech-ai/mural/runtime'],
    ['Color',               '@pragmatic-tech-ai/mural/runtime'],
    ['Matrix',              '@pragmatic-tech-ai/mural/runtime'],
    ['Thickness',           '@pragmatic-tech-ai/mural/runtime'],
    ['CornerRadius',        '@pragmatic-tech-ai/mural/runtime'],
    // Theme engine — emitted by `theme` / `scheme` top-level forms.
    ['defineScheme',        '@pragmatic-tech-ai/mural/runtime'],
    ['defineTheme',         '@pragmatic-tech-ai/mural/runtime'],
    ['Scheme',              '@pragmatic-tech-ai/mural/runtime'],
    ['Theme',               '@pragmatic-tech-ai/mural/runtime'],
    ['ThemeManager',        '@pragmatic-tech-ai/mural/runtime'],
    ['Application',         '@pragmatic-tech-ai/mural/runtime'],
    // Adaptive context — inherited DPs on Visual written by ThemeManager
    // / MediaWatcher; templates trigger on these via the standard `when`
    // syntax (`when (Density = Compact) { … }`).
    ['Density',             '@pragmatic-tech-ai/mural/runtime'],
    ['ViewportClass',       '@pragmatic-tech-ai/mural/runtime'],
    ['Pointer',             '@pragmatic-tech-ai/mural/runtime'],
    ['PrefersContrast',     '@pragmatic-tech-ai/mural/runtime'],
    ['PreferredScheme',     '@pragmatic-tech-ai/mural/runtime'],
    ['DataObject',          '@pragmatic-tech-ai/mural/runtime'],
    ['DragDropEffects',     '@pragmatic-tech-ai/mural/runtime'],
    ['DragDrop',            '@pragmatic-tech-ai/mural/runtime'],

    // ── basic controls ──────────────────────────────────────────────
    ['Border',                  '@pragmatic-tech-ai/mural/basic'],
    ['DomHost',                 '@pragmatic-tech-ai/mural/basic'],
    ['Button',                  '@pragmatic-tech-ai/mural/framework/buttons/button.js'],
    ['IconButton',              '@pragmatic-tech-ai/mural/framework/buttons/icon-button.js'],
    ['IconButtonToggle',        '@pragmatic-tech-ai/mural/framework/buttons/icon-button-toggle.js'],
    ['FloatingActionButton',    '@pragmatic-tech-ai/mural/framework/buttons/fab.js'],
    ['FabSize',                 '@pragmatic-tech-ai/mural/framework/buttons/fab.js'],
    ['Card',                    '@pragmatic-tech-ai/mural/framework/surfaces/card.js'],
    ['CardVariant',             '@pragmatic-tech-ai/mural/framework/surfaces/card.js'],
    ['TopAppBar',               '@pragmatic-tech-ai/mural/framework/top-app-bar/top-app-bar.js'],
    ['TopAppBarVariant',        '@pragmatic-tech-ai/mural/framework/top-app-bar/top-app-bar.js'],
    ['BottomAppBar',            '@pragmatic-tech-ai/mural/framework/bottom-app-bar/bottom-app-bar.js'],
    ['NavigationItem',          '@pragmatic-tech-ai/mural/framework/navigation/navigation-item.js'],
    ['NavigationRail',          '@pragmatic-tech-ai/mural/framework/navigation/navigation-rail.js'],
    ['NavigationBar',           '@pragmatic-tech-ai/mural/framework/navigation/navigation-bar.js'],
    ['ShellBase',               '@pragmatic-tech-ai/mural/framework/shell/shell.js'],
    ['EditorShell',             '@pragmatic-tech-ai/mural/framework/shell/editor-shell.js'],
    ['ViewerShell',             '@pragmatic-tech-ai/mural/framework/shell/viewer-shell.js'],
    ['ShellSideContentPane',    '@pragmatic-tech-ai/mural/framework/shell/shell-side-content-pane.js'],
    ['PanelButton',             '@pragmatic-tech-ai/mural/framework/shell/panel-button.js'],
    ['ShellModule',             '@pragmatic-tech-ai/mural/framework/shell/module.js'],
    // The headless module base a plain `module NAME { … }` lowers to — from
    // mural/runtime (re-exported from todl-runtime), so a module with only
    // `.services:` needs no framework import. `shell module NAME { … }` lowers to
    // the ShellModule above instead.
    ['Module',                  '@pragmatic-tech-ai/mural/runtime'],
    ['Capability',              '@pragmatic-tech-ai/mural/framework/shell/module.js'],
    ['RailAction',              '@pragmatic-tech-ai/mural/framework/shell/rail-action.js'],
    ['SettingDefinition',       '@pragmatic-tech-ai/mural/framework/shell/settings/setting-definition.js'],
    ['SettingKind',             '@pragmatic-tech-ai/mural/framework/shell/settings/setting-definition.js'],
    ['DocumentDefinition',      '@pragmatic-tech-ai/mural/framework/shell/documents/document-definition.js'],
    ['DocumentTypeRegistry',    '@pragmatic-tech-ai/mural/framework/shell/documents/document-type-registry.js'],
    ['CommandDefinition',       '@pragmatic-tech-ai/mural/framework/shell/commands/command-definition.js'],
    ['CommandGroupPresentation', '@pragmatic-tech-ai/mural/framework/shell/commands/command-definition.js'],
    ['CommandRegistry',         '@pragmatic-tech-ai/mural/framework/shell/commands/command-registry.js'],
    ['CommandViewModel',        '@pragmatic-tech-ai/mural/framework/shell/commands/command-view-model.js'],
    ['CommandToggleViewModel',  '@pragmatic-tech-ai/mural/framework/shell/commands/command-view-model.js'],
    ['ShellControlDefinition',  '@pragmatic-tech-ai/mural/framework/shell/commands/shell-control-definition.js'],
    ['ShellRegion',             '@pragmatic-tech-ai/mural/framework/shell/commands/shell-control-definition.js'],
    ['ToolbarFlatGroup',        '@pragmatic-tech-ai/mural/framework/shell/commands/toolbar-group-view-model.js'],
    ['ToolbarSeparatorItem',    '@pragmatic-tech-ai/mural/framework/shell/commands/toolbar-group-view-model.js'],
    ['ToolbarSplitMenuGroup',   '@pragmatic-tech-ai/mural/framework/shell/commands/toolbar-group-view-model.js'],
    ['ToolbarSplitGridGroup',   '@pragmatic-tech-ai/mural/framework/shell/commands/toolbar-group-view-model.js'],
    ['ToolbarToggleGroup',      '@pragmatic-tech-ai/mural/framework/shell/commands/toolbar-group-view-model.js'],
    ['ShellControlViewModel',   '@pragmatic-tech-ai/mural/framework/shell/commands/toolbar-group-view-model.js'],
    ['ToolbarService',          '@pragmatic-tech-ai/mural/framework/shell/commands/toolbar-service.js'],
    ['NavigationService',       '@pragmatic-tech-ai/mural/framework/shell/services/navigation-service.js'],
    ['PanelDockService',        '@pragmatic-tech-ai/mural/framework/shell/services/panel-dock-service.js'],
    ['DialogService',           '@pragmatic-tech-ai/mural/framework/shell/services/dialog-service.js'],
    ['StatusService',           '@pragmatic-tech-ai/mural/framework/shell/services/status-service.js'],
    ['ContentHostService',      '@pragmatic-tech-ai/mural/framework/shell/services/content-host-service.js'],
    ['DocumentsContentHostService', '@pragmatic-tech-ai/mural/framework/shell/services/documents-content-host-service.js'],
    ['DocumentSelectorService', '@pragmatic-tech-ai/mural/framework/shell/services/document-selector-service.js'],
    ['ClickMode',               '@pragmatic-tech-ai/mural/framework/buttons/button.js'],
    ['ButtonVariant',           '@pragmatic-tech-ai/mural/framework/buttons/button.js'],
    ['TextBlock',               '@pragmatic-tech-ai/mural/basic'],
    ['Run',                     '@pragmatic-tech-ai/mural/basic'],
    ['Span',                    '@pragmatic-tech-ai/mural/basic'],
    ['Bold',                    '@pragmatic-tech-ai/mural/basic'],
    ['Italic',                  '@pragmatic-tech-ai/mural/basic'],
    ['Underline',               '@pragmatic-tech-ai/mural/basic'],
    ['LineBreak',               '@pragmatic-tech-ai/mural/basic'],
    ['Hyperlink',               '@pragmatic-tech-ai/mural/basic'],
    ['InlineUIContainer',       '@pragmatic-tech-ai/mural/basic'],
    // Block flow-content model (FlowDocument analog) + its hosts.
    ['FlowDocument',            '@pragmatic-tech-ai/mural/basic'],
    ['Paragraph',               '@pragmatic-tech-ai/mural/basic'],
    ['List',                    '@pragmatic-tech-ai/mural/basic'],
    ['ListItem',                '@pragmatic-tech-ai/mural/basic'],
    ['ListMarkerStyle',         '@pragmatic-tech-ai/mural/basic'],
    ['RichTextBlock',           '@pragmatic-tech-ai/mural/basic'],
    ['RichTextBox',             '@pragmatic-tech-ai/mural/basic'],
    ['Canvas',                  '@pragmatic-tech-ai/mural/basic'],
    ['PaginatedCanvas',         '@pragmatic-tech-ai/mural/basic'],
    ['Ellipse',                 '@pragmatic-tech-ai/mural/basic'],
    ['Shape',                   '@pragmatic-tech-ai/mural/basic'],
    ['Path',                    '@pragmatic-tech-ai/mural/basic'],
    ['Image',                   '@pragmatic-tech-ai/mural/basic'],
    ['Icon',                    '@pragmatic-tech-ai/mural/basic'],
    ['Line',                    '@pragmatic-tech-ai/mural/basic'],
    ['Rectangle',               '@pragmatic-tech-ai/mural/basic'],
    ['ComboBox',                '@pragmatic-tech-ai/mural/framework/list/combo-box.js'],
    ['DockPanel',               '@pragmatic-tech-ai/mural/basic'],
    ['Dock',                    '@pragmatic-tech-ai/mural/basic'],
    ['Drawer',                  '@pragmatic-tech-ai/mural/framework/surfaces/drawer.js'],
    ['DrawerVariant',           '@pragmatic-tech-ai/mural/framework/surfaces/drawer.js'],
    ['SideSheet',               '@pragmatic-tech-ai/mural/framework/surfaces/side-sheet.js'],
    ['SideSheetVariant',        '@pragmatic-tech-ai/mural/framework/surfaces/side-sheet.js'],
    ['TreeView',                '@pragmatic-tech-ai/mural/framework/list/tree-view.js'],
    ['TreeViewItem',            '@pragmatic-tech-ai/mural/framework/list/tree-view.js'],
    ['ListBox',                 '@pragmatic-tech-ai/mural/framework/list/list-box.js'],
    ['ListBoxItem',             '@pragmatic-tech-ai/mural/framework/list/list-box.js'],
    ['SelectionMode',           '@pragmatic-tech-ai/mural/framework/list/list-box.js'],
    ['MarqueeBoundsPolicy',     '@pragmatic-tech-ai/mural/framework/list/selector.js'],
    ['TextBox',                 '@pragmatic-tech-ai/mural/basic'],
    ['SpinEdit',                '@pragmatic-tech-ai/mural/basic'],
    ['Slider',                  '@pragmatic-tech-ai/mural/basic'],
    ['SliderSpinEdit',          '@pragmatic-tech-ai/mural/basic'],
    ['ColorPicker',             '@pragmatic-tech-ai/mural/framework'],
    ['ColorPickerVariant',      '@pragmatic-tech-ai/mural/framework'],
    ['FontFamilyPicker',        '@pragmatic-tech-ai/mural/framework'],
    ['FontSizePicker',          '@pragmatic-tech-ai/mural/framework'],
    ['ColorScheme',             '@pragmatic-tech-ai/mural/framework'],
    ['BrushPicker',             '@pragmatic-tech-ai/mural/framework'],
    ['BrushPickerVariant',      '@pragmatic-tech-ai/mural/framework'],
    ['PenEditor',               '@pragmatic-tech-ai/mural/framework'],
    ['FillEditor',              '@pragmatic-tech-ai/mural/framework'],
    ['FillEditorVariant',       '@pragmatic-tech-ai/mural/framework'],
    ['ShapeFormatControl',      '@pragmatic-tech-ai/mural/framework'],
    ['CapOption',               '@pragmatic-tech-ai/mural/framework'],
    ['PageView',                '@pragmatic-tech-ai/mural/basic'],

    // Runtime types that the emitter may reference even when the
    // consumer's source doesn't name them directly — added on demand
    // by the emit pass.
    ['NameScope',               '@pragmatic-tech-ai/mural/runtime'],
    ['PropertyTransition',      '@pragmatic-tech-ai/mural/runtime'],
    ['StackPanel',              '@pragmatic-tech-ai/mural/basic'],
    ['WrapPanel',               '@pragmatic-tech-ai/mural/basic'],
    ['UniformGrid',             '@pragmatic-tech-ai/mural/basic'],
    ['Orientation',             '@pragmatic-tech-ai/mural/basic'],
    ['PositionAnchor',          '@pragmatic-tech-ai/mural/framework/diagram/position-anchor.js'],
    ['SizePositionControl',     '@pragmatic-tech-ai/mural/framework/diagram/size-position-control.js'],
    ['ContentControl',          '@pragmatic-tech-ai/mural/framework/base/content-control.js'],
    ['ContentPresenter',        '@pragmatic-tech-ai/mural/basic'],
    ['Figure',                  '@pragmatic-tech-ai/mural/framework/diagram/figure.js'],
    ['TextNode',                '@pragmatic-tech-ai/mural/framework/diagram/text-node.js'],
    ['ContainerFigure',         '@pragmatic-tech-ai/mural/framework/diagram/container-figure.js'],
    ['ContentContainerFigure',  '@pragmatic-tech-ai/mural/framework/diagram/content-container-figure.js'],
    ['Callout',                 '@pragmatic-tech-ai/mural/framework/diagram/callout.js'],
    ['ShapeText',               '@pragmatic-tech-ai/mural/framework/diagram/shape-text.js'],
    ['Group',                   '@pragmatic-tech-ai/mural/framework/diagram/group.js'],
    ['Diagram',                 '@pragmatic-tech-ai/mural/framework/diagram/diagram.js'],
    // Connector — markup references it for the `Connector.CapInset`
    // attached property on cap templates. ConnectorCapDataContext is the
    // DataType those cap DataTemplates bind against ($Brush / $Pen).
    ['Connector',               '@pragmatic-tech-ai/mural/framework/diagram/connector.js'],
    ['ConnectorCapDataContext', '@pragmatic-tech-ai/mural/framework/diagram/caps/connector-cap-data-context.js'],
    ['RulerBar',                '@pragmatic-tech-ai/mural/framework/diagram/guides/ruler-bar.js'],
    ['ToolboxVisualPresenter',  '@pragmatic-tech-ai/mural/framework/diagram/toolbox/toolbox-visual-presenter.js'],
    ['ToolboxRepository',       '@pragmatic-tech-ai/mural/framework/diagram/toolbox/toolbox-repository.js'],
    ['ToolboxPage',             '@pragmatic-tech-ai/mural/framework/diagram/toolbox/toolbox-page.js'],
    ['ToolboxItem',             '@pragmatic-tech-ai/mural/framework/diagram/toolbox/toolbox-item.js'],
    ['VisualContext',           '@pragmatic-tech-ai/mural/framework/diagram/toolbox/toolbox-visual-resolver.js'],
    ['VisualContextScope',      '@pragmatic-tech-ai/mural/framework/diagram/toolbox/visual-context-scope.js'],
    ['DiagramDocument',         '@pragmatic-tech-ai/mural/framework/diagram/diagram-document.js'],
    ['DiagramStorageKey',       '@pragmatic-tech-ai/mural/framework/diagram/diagram-document.js'],
    ['DiagramEditingContext',   '@pragmatic-tech-ai/mural/framework/diagram/diagram-command-contexts.js'],
    ['DiagramInspector',        '@pragmatic-tech-ai/mural/framework/diagram/diagram-inspector.js'],
    ['ShapeStylePage',          '@pragmatic-tech-ai/mural/framework/diagram/inspector-pages.js'],
    ['SizePositionPage',        '@pragmatic-tech-ai/mural/framework/diagram/inspector-pages.js'],
    ['Grid',                    '@pragmatic-tech-ai/mural/basic'],
    ['GridLength',              '@pragmatic-tech-ai/mural/basic'],
    ['ColumnDefinition',        '@pragmatic-tech-ai/mural/basic'],
    ['RowDefinition',           '@pragmatic-tech-ai/mural/basic'],
    ['ControlTemplate',         '@pragmatic-tech-ai/mural/basic'],
    ['DataTemplate',            '@pragmatic-tech-ai/mural/basic'],
    ['DataTemplateSelector',    '@pragmatic-tech-ai/mural/basic'],
    ['StyleSelector',           '@pragmatic-tech-ai/mural/basic'],
    ['TypeTemplateSelector',    '@pragmatic-tech-ai/mural/basic'],
    ['TargetedSetter',          '@pragmatic-tech-ai/mural/basic'],
    ['TemplatePropertyTrigger',  '@pragmatic-tech-ai/mural/basic'],
    ['TemplateDataTrigger',      '@pragmatic-tech-ai/mural/basic'],
    ['TemplateMultiDataTrigger', '@pragmatic-tech-ai/mural/basic'],
    ['ItemsControl',            '@pragmatic-tech-ai/mural/framework/base/items-control.js'],
    ['ListReorderBehavior',     '@pragmatic-tech-ai/mural/basic'],
    ['LogBehavior',             '@pragmatic-tech-ai/mural/basic'],
    ['FocusOnVisibleBehavior',  '@pragmatic-tech-ai/mural/basic'],
    ['Selector',                '@pragmatic-tech-ai/mural/framework/list/selector.js'],
    ['ItemContainerGenerator',  '@pragmatic-tech-ai/mural/basic'],
    ['ItemsPresenter',          '@pragmatic-tech-ai/mural/basic'],
    ['AdornerDecorator',        '@pragmatic-tech-ai/mural/basic'],
    ['HierarchicalDataTemplate','@pragmatic-tech-ai/mural/basic'],
    ['ItemsPanelTemplate',      '@pragmatic-tech-ai/mural/basic'],
    ['CollectionView',          '@pragmatic-tech-ai/mural/basic'],
    ['SortDescription',         '@pragmatic-tech-ai/mural/basic'],
    ['GroupDescription',        '@pragmatic-tech-ai/mural/basic'],
    ['ScrollViewer',            '@pragmatic-tech-ai/mural/framework/surfaces/scroll-viewer.js'],
    ['ScrollBar',               '@pragmatic-tech-ai/mural/basic'],
    ['Thumb',                   '@pragmatic-tech-ai/mural/basic'],
    ['GridSplitter',            '@pragmatic-tech-ai/mural/basic'],
    ['Splitter',                '@pragmatic-tech-ai/mural/basic'],
    ['VirtualizingPanel',       '@pragmatic-tech-ai/mural/basic'],
    ['VirtualizingStackPanel',  '@pragmatic-tech-ai/mural/basic'],
    ['VirtualizingWrapPanel',   '@pragmatic-tech-ai/mural/basic'],
    ['TextWrapping',            '@pragmatic-tech-ai/mural/basic'],
    ['TextTrimming',            '@pragmatic-tech-ai/mural/basic'],
    ['TextAlignment',           '@pragmatic-tech-ai/mural/basic'],
    ['MeasurementFidelity',     '@pragmatic-tech-ai/mural/basic'],
    ['TextPlacement',           '@pragmatic-tech-ai/mural/framework'],
    ['TextBoxVariant',          '@pragmatic-tech-ai/mural/basic'],
    ['Arc',                     '@pragmatic-tech-ai/mural/basic'],
    ['Squircle',                '@pragmatic-tech-ai/mural/basic'],
    ['Pill',                    '@pragmatic-tech-ai/mural/basic'],
    ['Arch',                    '@pragmatic-tech-ai/mural/basic'],
    ['Semicircle',              '@pragmatic-tech-ai/mural/basic'],
    ['Triangle',                '@pragmatic-tech-ai/mural/basic'],
    ['Arrow',                   '@pragmatic-tech-ai/mural/basic'],
    ['Fan',                     '@pragmatic-tech-ai/mural/basic'],
    ['FanPivot',                '@pragmatic-tech-ai/mural/basic'],
    ['Clamshell',               '@pragmatic-tech-ai/mural/basic'],
    ['Cookie',                  '@pragmatic-tech-ai/mural/basic'],
    ['Diamond',                 '@pragmatic-tech-ai/mural/basic'],
    ['Pentagon',                '@pragmatic-tech-ai/mural/basic'],
    ['Gem',                     '@pragmatic-tech-ai/mural/basic'],
    ['FourSidedCookie',         '@pragmatic-tech-ai/mural/basic'],
    ['SixSidedCookie',          '@pragmatic-tech-ai/mural/basic'],
    ['SevenSidedCookie',        '@pragmatic-tech-ai/mural/basic'],
    ['NineSidedCookie',         '@pragmatic-tech-ai/mural/basic'],
    ['TwelveSidedCookie',       '@pragmatic-tech-ai/mural/basic'],
    ['Clover',                  '@pragmatic-tech-ai/mural/basic'],
    ['FourLeafClover',          '@pragmatic-tech-ai/mural/basic'],
    ['EightLeafClover',         '@pragmatic-tech-ai/mural/basic'],
    ['Slanted',                 '@pragmatic-tech-ai/mural/basic'],
    ['Puffy',                   '@pragmatic-tech-ai/mural/basic'],
    ['PuffyDiamond',            '@pragmatic-tech-ai/mural/basic'],
    ['PuffyBase',               '@pragmatic-tech-ai/mural/basic'],
    ['Heart',                   '@pragmatic-tech-ai/mural/basic'],
    ['Bun',                     '@pragmatic-tech-ai/mural/basic'],
    ['Ghostish',                '@pragmatic-tech-ai/mural/basic'],
    ['PixelArt',                '@pragmatic-tech-ai/mural/basic'],
    ['PixelCircle',             '@pragmatic-tech-ai/mural/basic'],
    ['PixelTriangle',           '@pragmatic-tech-ai/mural/basic'],
    ['PixelSource',             '@pragmatic-tech-ai/mural/basic'],
    ['RadialWave',              '@pragmatic-tech-ai/mural/basic'],
    ['Sunny',                   '@pragmatic-tech-ai/mural/basic'],
    ['VerySunny',               '@pragmatic-tech-ai/mural/basic'],
    ['Burst',                   '@pragmatic-tech-ai/mural/basic'],
    ['SoftBurst',               '@pragmatic-tech-ai/mural/basic'],
    ['Boom',                    '@pragmatic-tech-ai/mural/basic'],
    ['SoftBoom',                '@pragmatic-tech-ai/mural/basic'],
    ['Flower',                  '@pragmatic-tech-ai/mural/basic'],

    // ── Internal helper classes ────────────────────────────────────
    // Layout / behaviour primitives owned by individual controls but
    // exported from their files (and re-exported from the basic
    // barrel) so the controls' bundled `.template.mu` defaults can
    // reference them by name. Registered here as well so the LSP /
    // analyzer accepts them when an in-tree template is opened — the
    // build-control-templates script overrides these entries with
    // direct relative file paths at compile time.
    ['ClickableBorder',         '@pragmatic-tech-ai/mural/basic/clickable-border.js'],
    ['RepeatButton',            '@pragmatic-tech-ai/mural/basic/repeat-button.js'],
    ['ClickAwayScrim',          '@pragmatic-tech-ai/mural/basic/click-away-scrim.js'],
    ['SplitRow',                '@pragmatic-tech-ai/mural/framework/list/combo-box.js'],
    ['ComboBoxPopupHost',       '@pragmatic-tech-ai/mural/framework/list/combo-box.js'],
    ['ComboBoxItem',            '@pragmatic-tech-ai/mural/framework/list/combo-box.js'],
    ['ComboBoxItemList',        '@pragmatic-tech-ai/mural/framework/list/combo-box.js'],
    ['ScrimSurface',            '@pragmatic-tech-ai/mural/framework/surfaces/drawer.js'],
    ['TemporaryOverlayHost',    '@pragmatic-tech-ai/mural/framework/surfaces/drawer.js'],
    ['ClickableRow',            '@pragmatic-tech-ai/mural/framework/list/tree-view.js'],
    ['ChevronTarget',           '@pragmatic-tech-ai/mural/framework/list/tree-view.js'],
    ['CollapsibleStack',        '@pragmatic-tech-ai/mural/framework/list/tree-view.js'],
    ['ScrollBarLayout',         '@pragmatic-tech-ai/mural/basic'],
    ['ScrollViewerLayout',      '@pragmatic-tech-ai/mural/framework/surfaces/scroll-viewer.js'],
    ['ScrollContentPresenter',  '@pragmatic-tech-ai/mural/basic'],
    ['SliderLayout',            '@pragmatic-tech-ai/mural/basic'],
    ['TextEditorSurface',       '@pragmatic-tech-ai/mural/basic'],

    // ── Command-surface controls (5.11) ─────────────────────────────
    // These extend Button / Visual and live in a separate barrel
    // (`./surface.js`) to avoid a TDZ cycle through the main basic
    // barrel during Button's default-style theme cascade.
    ['ToggleButton',            '@pragmatic-tech-ai/mural/framework/buttons/toggle-button.js'],
    // M3 Switch — capitalised `Switch` is fine in JS (only the
    // lowercase `switch` keyword is reserved), so the class and the
    // markup symbol both spell it `Switch`.
    ['Switch',                  '@pragmatic-tech-ai/mural/framework/toggles/switch.js'],
    ['Checkbox',                '@pragmatic-tech-ai/mural/framework/toggles/checkbox.js'],
    ['RadioButton',             '@pragmatic-tech-ai/mural/framework/toggles/radio-button.js'],
    ['RadioButtonGroup',        '@pragmatic-tech-ai/mural/framework/toggles/radio-button-group.js'],
    ['RadioButtonItem',         '@pragmatic-tech-ai/mural/framework/toggles/radio-button-group.js'],
    ['Chip',                    '@pragmatic-tech-ai/mural/framework/markers/chip.js'],
    ['ChipVariant',             '@pragmatic-tech-ai/mural/framework/markers/chip.js'],
    ['SegmentedButton',         '@pragmatic-tech-ai/mural/framework/button-groups/segmented-button.js'],
    ['SegmentedItem',           '@pragmatic-tech-ai/mural/framework/button-groups/segmented-button.js'],
    ['SegmentedPosition',       '@pragmatic-tech-ai/mural/framework/button-groups/segmented-button.js'],
    ['ButtonGroup',             '@pragmatic-tech-ai/mural/framework/button-groups/button-group.js'],
    ['SplitButton',             '@pragmatic-tech-ai/mural/framework/button-groups/split-button.js'],
    ['FabMenu',                 '@pragmatic-tech-ai/mural/framework/buttons/fab-menu.js'],
    ['TabControl',              '@pragmatic-tech-ai/mural/framework/tabs/tabs.js'],
    ['TabItem',                 '@pragmatic-tech-ai/mural/framework/tabs/tabs.js'],
    ['SearchBar',               '@pragmatic-tech-ai/mural/framework/search-bar/search-bar.js'],
    ['Divider',                 '@pragmatic-tech-ai/mural/framework/markers/divider.js'],
    ['Badge',                   '@pragmatic-tech-ai/mural/framework/markers/badge.js'],
    ['BadgeVariant',            '@pragmatic-tech-ai/mural/framework/markers/badge.js'],
    ['Tooltip',                 '@pragmatic-tech-ai/mural/framework/tooltips/tooltip.js'],
    ['TooltipPopupHost',        '@pragmatic-tech-ai/mural/framework/tooltips/tooltip-service.js'],
    ['ToolTipService',          '@pragmatic-tech-ai/mural/framework/tooltips/tooltip-service.js'],
    ['PlacementMode',           '@pragmatic-tech-ai/mural/framework/tooltips/tooltip-service.js'],
    // Commands — referenced in markup as DataTemplate DataType targets
    // (the default rich-tooltip template dispatches on CommandBase).
    ['CommandBase',             '@pragmatic-tech-ai/mural/runtime'],
    ['RelayCommand',            '@pragmatic-tech-ai/mural/runtime'],
    ['RoutedCommand',           '@pragmatic-tech-ai/mural/framework/commands/routed-command.js'],
    // Input bindings — `Visual.InputBindings { KeyBinding[…] }` /
    // `CommandBindings { CommandBinding[…] }` markup authoring.
    ['KeyBinding',              '@pragmatic-tech-ai/mural/framework/commands/input-binding.js'],
    ['MouseBinding',           '@pragmatic-tech-ai/mural/framework/commands/input-binding.js'],
    ['MouseAction',            '@pragmatic-tech-ai/mural/framework/commands/input-binding.js'],
    ['CommandBinding',         '@pragmatic-tech-ai/mural/framework/commands/command-binding.js'],
    // WPF-parity input enums (Key / ModifierKeys / MouseButton) re-exported
    // from the runtime barrel; usable in KeyBinding[Key=…, Modifiers=…]
    // and in `when (…)` triggers.
    ['Key',                    '@pragmatic-tech-ai/mural/runtime'],
    ['ModifierKeys',           '@pragmatic-tech-ai/mural/runtime'],
    ['MouseButton',            '@pragmatic-tech-ai/mural/runtime'],
    // Focus scopes + keyboard navigation — attached properties usable in
    // markup (FocusManager.IsFocusScope=true, KeyboardNavigation.TabNavigation=Cycle).
    ['FocusManager',           '@pragmatic-tech-ai/mural/runtime'],
    ['KeyboardNavigation',     '@pragmatic-tech-ai/mural/runtime'],
    ['KeyboardNavigationMode', '@pragmatic-tech-ai/mural/runtime'],
    ['ProgressIndicator',       '@pragmatic-tech-ai/mural/framework/notifications/progress-indicator.js'],
    ['ProgressIndicatorVariant','@pragmatic-tech-ai/mural/framework/notifications/progress-indicator.js'],
    ['LoadingIndicator',        '@pragmatic-tech-ai/mural/framework/notifications/loading-indicator.js'],
    ['LoadingIndicatorVariant', '@pragmatic-tech-ai/mural/framework/notifications/loading-indicator.js'],
    ['DatePicker',              '@pragmatic-tech-ai/mural/framework/pickers/date-picker.js'],
    ['TimePicker',              '@pragmatic-tech-ai/mural/framework/pickers/time-picker.js'],
    ['Carousel',                '@pragmatic-tech-ai/mural/framework/carousel/carousel.js'],
    ['Banner',                  '@pragmatic-tech-ai/mural/framework/notifications/banner.js'],
    ['Snackbar',                '@pragmatic-tech-ai/mural/framework/notifications/snackbar.js'],
    ['Dialog',                  '@pragmatic-tech-ai/mural/framework/surfaces/dialog.js'],
    ['DialogAction',            '@pragmatic-tech-ai/mural/framework/surfaces/dialog-action.js'],
    ['BottomSheet',             '@pragmatic-tech-ai/mural/framework/surfaces/bottom-sheet.js'],
    ['ToolBar',                 '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['ToolBarButton',           '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['ToolBarToggleButton',     '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['ToolBarSplitButton',      '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['ToolBarSeparator',        '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['ToolBarPosition',         '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['ToolBarPopupHost',        '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['ToolBarOverflowItemsControl', '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['MenuStrip',               '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['MenuButton',              '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['MenuItem',                '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['MenuSeparator',           '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['ContextMenu',             '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['ContextMenuService',      '@pragmatic-tech-ai/mural/framework/surface.js'],
    // Popup host shared by MenuButton + ContextMenu; referenced by the
    // framework.resources.mu default ControlTemplates.
    ['MenuPopupHost',           '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['StatusBar',               '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['StatusBarItem',           '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['StatusBarSeparator',      '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['ThemeSelector',           '@pragmatic-tech-ai/mural/framework/surface.js'],
    // ── Ribbon family (5.11.3) ──────────────────────────────────────
    ['Ribbon',                  '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['RibbonTab',               '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['RibbonTabHeader',         '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['RibbonContextualGroup',   '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['RibbonGroup',             '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['RibbonSmallButtonColumn', '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['RibbonButton',            '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['RibbonToggleButton',      '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['RibbonButtonSize',        '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['RibbonDropDownButton',    '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['RibbonSplitButton',       '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['RibbonGallery',           '@pragmatic-tech-ai/mural/framework/surface.js'],
    ['RibbonGalleryPopupList',  '@pragmatic-tech-ai/mural/framework/surface.js'],

    // ── PropertyGrid family ─────────────────────────────────────────
    // View-model types used as DataTemplate DataType targets in the
    // property-grid default template.
    ['PropertyGrid',         '@pragmatic-tech-ai/mural/framework/property-grid/property-grid.js'],
    ['PropertyItem',         '@pragmatic-tech-ai/mural/framework/property-grid/property-item.js'],
    ['PropertyCategory',     '@pragmatic-tech-ai/mural/framework/property-grid/property-item.js'],

    // ── Framework layer ─────────────────────────────────────────────
    // Templated-control base class. Sits between runtime's `Visual`
    // and the concrete control surface (ContentControl, ItemsControl,
    // MenuButton, ContextMenu, Drawer). `.mu` files reach for it when
    // declaring `[TargetType=Control]` style entries or test fixtures
    // that want to talk about templated controls polymorphically.
    ['Control',                 '@pragmatic-tech-ai/mural/framework'],

    // ── visual-engine ───────────────────────────────────────────────
    ['Help',                '@pragmatic-tech-ai/mural/visual-engine'],
    ['SolidColorBrush',     '@pragmatic-tech-ai/mural/visual-engine'],
    ['LinearGradientBrush', '@pragmatic-tech-ai/mural/visual-engine'],
    ['RadialGradientBrush', '@pragmatic-tech-ai/mural/visual-engine'],
    ['ImageBrush',          '@pragmatic-tech-ai/mural/visual-engine'],
    ['PatternBrush',        '@pragmatic-tech-ai/mural/visual-engine'],
    ['PatternKind',         '@pragmatic-tech-ai/mural/visual-engine'],
    ['GradientStop',        '@pragmatic-tech-ai/mural/visual-engine'],
    ['Brush',               '@pragmatic-tech-ai/mural/visual-engine'],
    ['Pen',                 '@pragmatic-tech-ai/mural/visual-engine'],
    ['FontWeight',          '@pragmatic-tech-ai/mural/visual-engine'],
    ['FontStyle',           '@pragmatic-tech-ai/mural/visual-engine'],
    ['TextDecorations',     '@pragmatic-tech-ai/mural/visual-engine'],
    ['FontFamily',          '@pragmatic-tech-ai/mural/visual-engine'],
    ['FontManager',         '@pragmatic-tech-ai/mural/visual-engine'],
    ['FontSourceKind',      '@pragmatic-tech-ai/mural/visual-engine'],
    ['Stretch',             '@pragmatic-tech-ai/mural/visual-engine'],
    ['AlignmentX',          '@pragmatic-tech-ai/mural/visual-engine'],
    ['AlignmentY',          '@pragmatic-tech-ai/mural/visual-engine'],
    ['GradientSpreadMethod', '@pragmatic-tech-ai/mural/visual-engine'],
    ['LineCap',             '@pragmatic-tech-ai/mural/visual-engine'],
    ['LineJoin',            '@pragmatic-tech-ai/mural/visual-engine'],
    ['FillRule',            '@pragmatic-tech-ai/mural/visual-engine'],
    ['SweepDirection',      '@pragmatic-tech-ai/mural/visual-engine'],
    ['DropShadowEffect',         '@pragmatic-tech-ai/mural/visual-engine'],
    ['MaterialElevationEffect',  '@pragmatic-tech-ai/mural/visual-engine'],

    // ── runtime/animation (motion easing curve palette) ────────────────
    ['Easings',             '@pragmatic-tech-ai/mural/runtime'],
];

export const DEFAULT_SYMBOLS: SymbolMap = new Map(ENTRIES);

// Enum class name → set of valid PascalCase members. Used by the
// emitter to decide whether to emit `Orientation.Vertical` (when the
// property name happens to match an enum class) AND to validate the
// member name. An ident in enum position that isn't in the member set
// is a compile error — silently emitting `Orientation.foo` would
// resolve to `undefined` at runtime and cascade into NaN through any
// layout math that touches the value.
//
// All runtime enums listed here MUST also appear in DEFAULT_SYMBOLS so
// the emitter can pull them in via an import. The member sets MUST
// stay in sync with the runtime declarations (src/runtime/visual.ts,
// src/visual-engine/*, src/basic/*) — there's no compile-time link
// between this table and the actual enum declarations, so adding a
// member to the runtime without updating this table makes the new
// member unusable from markup until the table is updated.
export const ENUM_MEMBERS: ReadonlyMap<string, ReadonlySet<string>> = new Map<string, ReadonlySet<string>>([
    ['HorizontalAlignment',   new Set(['Left', 'Center', 'Right', 'Stretch'])],
    ['VerticalAlignment',     new Set(['Top', 'Center', 'Bottom', 'Stretch'])],
    ['Visibility',            new Set(['Visible', 'Hidden', 'Collapsed'])],
    ['PlacementMode',         new Set(['Bottom', 'Top', 'Left', 'Right', 'Center', 'Mouse'])],
    ['FontWeight',            new Set(['Normal', 'Medium', 'Bold'])],
    ['FontStyle',             new Set(['Normal', 'Italic'])],
    ['TextDecorations',       new Set(['None', 'Underline', 'Strikethrough', 'Overline'])],
    ['Stretch',               new Set(['None', 'Fill', 'Uniform', 'UniformToFill'])],
    ['AlignmentX',            new Set(['Left', 'Center', 'Right'])],
    ['AlignmentY',            new Set(['Top', 'Center', 'Bottom'])],
    ['BindingMode',           new Set(['OneWay', 'TwoWay', 'OneTime', 'OneWayToSource'])],
    ['GradientSpreadMethod',  new Set(['Pad', 'Reflect', 'Repeat'])],
    ['PatternKind',           new Set(['Stripes', 'Dots', 'Checker', 'Grid', 'CrossHatch'])],
    ['LineCap',               new Set(['Flat', 'Round', 'Square'])],
    ['LineJoin',              new Set(['Miter', 'Round', 'Bevel'])],
    ['FillRule',              new Set(['EvenOdd', 'Nonzero'])],
    ['SweepDirection',        new Set(['Counterclockwise', 'Clockwise'])],
    ['FanPivot',              new Set(['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'])],
    ['PuffyBase',             new Set(['Square', 'Diamond'])],
    ['PixelSource',           new Set(['Circle', 'Triangle'])],
    ['TextWrapping',          new Set(['NoWrap', 'Wrap'])],
    ['TextTrimming',          new Set(['None', 'CharacterEllipsis'])],
    ['TextAlignment',         new Set(['Left', 'Center', 'Right', 'Justify'])],
    ['MeasurementFidelity',   new Set(['Fast', 'Exact'])],
    ['ListMarkerStyle',       new Set(['None', 'Disc', 'Circle', 'Square', 'Decimal', 'LowerLatin', 'UpperLatin', 'LowerRoman', 'UpperRoman'])],
    ['ClickMode',             new Set(['Release', 'Press', 'Hover'])],
    ['ButtonVariant',         new Set(['Filled', 'Elevated', 'Tonal', 'Outlined', 'Text', 'Standard'])],
    ['ColorPickerVariant',    new Set(['HSV', 'RGB'])],
    ['BrushPickerVariant',    new Set(['Solid', 'Linear', 'Radial', 'Pattern'])],
    ['FillEditorVariant',     new Set(['None', 'Solid', 'Linear', 'Radial', 'Pattern', 'Picture'])],
    ['TextBoxVariant',        new Set(['Filled', 'Outlined', 'Plain'])],
    ['ChipVariant',           new Set(['Assist', 'Filter', 'Input', 'Suggestion'])],
    ['SegmentedPosition',     new Set(['Single', 'Start', 'Middle', 'End'])],
    ['BadgeVariant',          new Set(['Dot', 'Numeric'])],
    ['ProgressIndicatorVariant', new Set(['Linear', 'Circular'])],
    ['LoadingIndicatorVariant', new Set(['ActiveIndicator', 'Contained'])],
    ['FabSize',               new Set(['Small', 'Default', 'Large', 'Extended'])],
    ['CardVariant',           new Set(['Filled', 'Elevated', 'Outlined'])],
    ['TopAppBarVariant',      new Set(['Small', 'CenterAligned', 'Medium', 'Large'])],
    ['Orientation',           new Set(['Vertical', 'Horizontal'])],
    ['PositionAnchor',        new Set(['TopLeftCorner', 'Center'])],
    ['VisualContext',         new Set(['Tile', 'Figure'])],
    ['SelectionMode',         new Set(['Single', 'Multiple', 'Extended'])],
    ['MarqueeBoundsPolicy',   new Set(['Intersect', 'Contained'])],
    ['Dock',                  new Set(['Left', 'Top', 'Right', 'Bottom'])],
    ['DrawerVariant',         new Set(['Permanent', 'Persistent', 'Temporary'])],
    ['SideSheetVariant',      new Set(['Standard', 'Modal'])],
    ['ToolBarPosition',       new Set(['None', 'Only', 'First', 'Middle', 'Last'])],
    ['RibbonButtonSize',      new Set(['Large', 'Medium', 'Small'])],
    ['Density',               new Set(['Compact', 'Regular', 'Comfortable'])],
    ['ViewportClass',         new Set(['Mobile', 'Tablet', 'Desktop'])],
    ['Pointer',               new Set(['Fine', 'Coarse'])],
    ['PrefersContrast',       new Set(['Normal', 'More'])],
    ['PreferredScheme',       new Set(['NoPreference', 'Light', 'Dark'])],
    // WPF-parity input enums (KeyBinding[Key=…, Modifiers=…],
    // MouseBinding[Gesture=…]). ModifierKeys is a [Flags] enum — markup
    // authors a single member today (`Modifiers=Control`); multi-modifier
    // combination syntax is a separate follow-up.
    ['Key', new Set([
        'None', 'Cancel', 'Back', 'Tab', 'Clear', 'Return', 'Pause',
        'CapsLock', 'Escape', 'Space', 'PageUp', 'PageDown', 'End', 'Home',
        'Left', 'Up', 'Right', 'Down', 'Select', 'Print', 'Execute',
        'PrintScreen', 'Insert', 'Delete', 'Help', 'D0', 'D1', 'D2', 'D3',
        'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'A', 'B', 'C', 'D', 'E', 'F',
        'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T',
        'U', 'V', 'W', 'X', 'Y', 'Z', 'LWin', 'RWin', 'Apps', 'Sleep',
        'NumPad0', 'NumPad1', 'NumPad2', 'NumPad3', 'NumPad4', 'NumPad5',
        'NumPad6', 'NumPad7', 'NumPad8', 'NumPad9', 'Multiply', 'Add',
        'Separator', 'Subtract', 'Decimal', 'Divide', 'F1', 'F2', 'F3', 'F4',
        'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'F13', 'F14',
        'F15', 'F16', 'F17', 'F18', 'F19', 'F20', 'F21', 'F22', 'F23', 'F24',
        'NumLock', 'Scroll', 'LeftShift', 'RightShift', 'LeftCtrl',
        'RightCtrl', 'LeftAlt', 'RightAlt', 'BrowserBack', 'BrowserForward',
        'BrowserRefresh', 'BrowserStop', 'BrowserSearch', 'BrowserFavorites',
        'BrowserHome', 'VolumeMute', 'VolumeDown', 'VolumeUp',
        'MediaNextTrack', 'MediaPreviousTrack', 'MediaStop',
        'MediaPlayPause', 'Oem1', 'OemPlus', 'OemComma', 'OemMinus',
        'OemPeriod', 'Oem2', 'Oem3', 'Oem4', 'Oem5', 'Oem6', 'Oem7',
        'Unknown',
    ])],
    ['ModifierKeys',          new Set(['None', 'Alt', 'Control', 'Shift', 'Windows'])],
    ['MouseAction',           new Set(['LeftClick', 'RightClick', 'MiddleClick', 'LeftDoubleClick', 'RightDoubleClick', 'MiddleDoubleClick'])],
    ['MouseButton',           new Set(['Left', 'Middle', 'Right', 'XButton1', 'XButton2'])],
    ['KeyboardNavigationMode', new Set(['Continue', 'Once', 'Cycle', 'None', 'Contained', 'Local'])],
    // Setting value shapes — a module's `.settings:` block authors
    // `SettingDefinition [ Kind = Boolean … ]`. Resolved via PROPERTY_TO_ENUM
    // under the `Kind` property (below); its members are disjoint from the other
    // `Kind` enums (ChipVariant / PatternKind), so there's no collision.
    ['SettingKind',           new Set(['Boolean', 'Number', 'String', 'Choice', 'Color', 'FilePath'])],
    // Command-group presentation — a module's `.commands:` block authors
    // `CommandDefinition [ Presentation = SplitMenu … ]` on a group's leader.
    // Resolved via PROPERTY_TO_ENUM under the `Presentation` property.
    ['CommandGroupPresentation', new Set(['Flat', 'SplitMenu', 'SplitGrid', 'Toggles'])],
    // Shell-control host region — `ShellControlDefinition [ Region = StatusBar ]`.
    ['ShellRegion', new Set(['Toolbar', 'StatusBar', 'EditorActions'])],
]);

// Type → set of valid static-member names exposed for use in DOTTED
// value position (`CornerRadius.Full`, …). Distinct from ENUM_MEMBERS
// because the lookup trigger is different: enum members resolve from a
// BARE ident inside a property-context match, static members resolve
// from an explicit `Type.Member` dotted ref. Adding a class here lets
// `.mu` authors write the dotted form anywhere a ValueNode is accepted
// — including resource RHS positions (`@ShapeFull = CornerRadius.Full`)
// where no property-name context exists.
//
// The class must also appear in DEFAULT_SYMBOLS so the emitter can pull
// it in via an import. The member set must stay in sync with the
// runtime class's exported statics — there's no compile-time link.
export const STATIC_MEMBERS: ReadonlyMap<string, ReadonlySet<string>> = new Map<string, ReadonlySet<string>>([
    ['CornerRadius', new Set(['Full', 'Zero', 'LeftRounded', 'RightRounded'])],
    ['GridLength',   new Set(['Auto', 'Star'])],
    ['Easings', new Set([
        'Linear', 'QuadIn', 'QuadOut', 'QuadInOut',
        'CubicIn', 'CubicOut', 'CubicInOut',
        // M3 motion easing tokens (https://m3.material.io/styles/motion/easing-and-duration/tokens-specs)
        'Standard', 'StandardAccelerate', 'StandardDecelerate',
        'Emphasized', 'EmphasizedAccelerate', 'EmphasizedDecelerate',
    ])],
    // FontWeight is also in ENUM_MEMBERS so `FontWeight = Normal` works
    // when the LHS property's enum type is FontWeight. STATIC_MEMBERS
    // covers the standalone case — `@SomeToken = FontWeight.Normal` in
    // scheme value position, where there's no LHS property to drive
    // the enum-member resolution.
    ['FontWeight', new Set(['Normal', 'Medium', 'Bold'])],
    // Exposed for the dotted form `TextAlignment.Justify` / `TextPlacement.Center`
    // as `Is(...)` converter-factory arguments in the diagram alignment
    // toolbars (also in ENUM_MEMBERS for TextAlignment so `TextAlignment=Left`
    // property assignment keeps working).
    ['TextAlignment', new Set(['Left', 'Center', 'Right', 'Justify'])],
    ['TextPlacement', new Set([
        'Center', 'Top', 'Bottom', 'Left', 'Right',
        'TopLeft', 'TopRight', 'BottomLeft', 'BottomRight',
        'Above', 'Below', 'LeftOf', 'RightOf',
    ])],
    // ToolboxVisualPresenter.Context = VisualContext.Tile / .Figure. The `Context`
    // property name is overloaded (a class-ref `Context = DiagramEditingContext`
    // also exists), so the bare-member PROPERTY_TO_ENUM path can't be used — author
    // the qualified `VisualContext.Tile` form, resolved here.
    ['VisualContext', new Set(['Tile', 'Figure'])],
]);

// Property-name → enum class candidates. Used when the markup
// property name does not equal the enum class name (`Variant`,
// `Anchor`, …). The compiler consults this map before falling through
// to "unresolved identifier" — that way a markup author writing
// `Variant=Persistent` gets the same strict member-validation a
// `HorizontalAlignment=Center` site does.
//
// Multiple candidate enums per property let the same DP name carry
// different value sets across host classes — e.g. `Variant` is both
// `DrawerVariant` (Permanent/Persistent/Temporary) on Drawer AND
// `ButtonVariant` (Filled/Elevated/Tonal/…) on Button. The compiler
// walks the candidates and picks the first one whose ENUM_MEMBERS set
// contains the literal. When two candidates share a literal (Card and
// Button both define `Filled`/`Elevated`/`Outlined`), the emit picks
// whichever appears first in this list — that's still runtime-correct
// because the shared literals carry identical string values across
// every Variant enum (Filled === 'Filled' in every enum that defines
// it), so the host's setter still receives the same string at the wire.
//
// Entries here MUST point at enum classes that are also in
// ENUM_MEMBERS.
export const PROPERTY_TO_ENUM: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
    ['Variant',  ['ButtonVariant', 'DrawerVariant', 'SideSheetVariant', 'CardVariant', 'TopAppBarVariant', 'TextBoxVariant', 'BadgeVariant', 'ProgressIndicatorVariant', 'LoadingIndicatorVariant', 'ColorPickerVariant', 'BrushPickerVariant', 'FillEditorVariant']],
    ['Kind',     ['ChipVariant', 'PatternKind', 'SettingKind']],
    ['PatternKind', ['PatternKind']],
    ['LineCap',  ['LineCap']],
    ['LineJoin', ['LineJoin']],
    ['EffectiveVariant', ['TopAppBarVariant']],
    ['Size',     ['FabSize', 'RibbonButtonSize']],
    ['Anchor',   ['Dock']],
    ['Position', ['ToolBarPosition', 'SegmentedPosition']],
    ['Pivot',    ['FanPivot']],
    ['Base',     ['PuffyBase']],
    ['Source',   ['PixelSource']],
    // KeyBinding.Modifiers / MouseBinding.Modifiers → ModifierKeys;
    // MouseBinding.Gesture → MouseAction. (KeyBinding.Key resolves via the
    // property-name == enum-class-name path, like HorizontalAlignment.)
    ['Modifiers', ['ModifierKeys']],
    ['Gesture',   ['MouseAction']],
    ['TabNavigation', ['KeyboardNavigationMode']],
    // List.MarkerStyle → ListMarkerStyle (property name ≠ enum class name).
    ['MarkerStyle', ['ListMarkerStyle']],
    // CommandDefinition.Presentation → CommandGroupPresentation.
    ['Presentation', ['CommandGroupPresentation']],
    // ShellControlDefinition.Region → ShellRegion.
    ['Region', ['ShellRegion']],
]);

// Meta-attr names whose RHS is a type reference (compiled as a bare
// class name, not a string). Used by resource forms.
export const TYPE_REF_META_ATTRS: ReadonlySet<string> = new Set([
    'TargetType',
    'DataType',
]);

// Per-control default-slot info. Used by the emitter to translate
// `Border{ TextBlock{…} }` → `_border.Child = _text` vs
// `Canvas{ A B C }` → `_canvas.Children.push(_a/_b/_c)`.
//
// The `kind` controls how body elements are assigned:
//   'single'   — body must have exactly one element; assigned via slot
//   'list'     — body elements appended to a collection
//   'string'   — body parsed as text mode (deferred — not in phase 3)
//   'object'   — body is one element OR a literal (ContentControl-ish)
export interface SlotInfo
{
    name: string;
    kind: 'single' | 'list' | 'string' | 'object';
}

// One entry per known control. Unknown controls fall back to 'single'
// + 'Child' with an emit-time error if the body doesn't match.
export const DEFAULT_SLOT_INFO: ReadonlyMap<string, SlotInfo> = new Map<string, SlotInfo>([
    ['AdornerDecorator',        { name: 'Child',    kind: 'single' }],
    ['Border',                  { name: 'Child',    kind: 'single' }],
    ['Button',                  { name: 'Content',  kind: 'object' }],
    ['IconButton',              { name: 'Content',  kind: 'object' }],
    ['PanelButton',             { name: 'Content',  kind: 'object' }],
    ['IconButtonToggle',        { name: 'Content',  kind: 'object' }],
    ['FloatingActionButton',    { name: 'Content',  kind: 'object' }],
    ['Card',                    { name: 'Content',  kind: 'object' }],
    ['SideSheet',               { name: 'Content',  kind: 'object' }],
    ['TopAppBar',               { name: 'Actions',  kind: 'list'   }],
    ['BottomAppBar',            { name: 'Actions',  kind: 'list'   }],
    ['NavigationItem',          { name: 'Content',  kind: 'object' }],
    ['NavigationRail',          { name: 'Items',    kind: 'list'   }],
    ['NavigationBar',           { name: 'Items',    kind: 'list'   }],
    // EditorShell / ViewerShell take no body children — they are
    // services-driven (content flows through the modules composed on the
    // Application and the shell template's `$service(…)` bindings), so they
    // declare no content slot. Their bodies carry only `.services:` blocks.
    // ShellModule { Capability … } — declarative capabilities route through
    // ShellModule.AddChild → Capabilities.Add (the `list` slot emits AddChild).
    // A Capability takes no content child — it names its content SERVICE via the
    // `ServiceKey` attribute (a service class ref), so it's attribute-only.
    ['ShellModule',             { name: 'Capabilities', kind: 'list'   }],
    ['TabControl',              { name: 'Items',    kind: 'list'   }],
    ['TabItem',                 { name: 'Content',  kind: 'object' }],
    ['Chip',                    { name: 'Content',  kind: 'object' }],
    // TextBlock is an inline flow-content host: its brace body is mixed
    // inline content — quoted strings → Run, bare idents → inline elements
    // (Bold / Italic / …) — lowered to `.Inlines.Add(…)`. Text must be
    // QUOTED (mural's disambiguator in place of XAML `<>` tags). Plain
    // `TextBlock [Text="…"]` (attribute) is unaffected and uses the
    // Text-only fast path.
    ['TextBlock',               { name: 'Inlines',  kind: 'list'   }],
    // Inline flow-content hosts — mixed bodies of text chunks + nested
    // Span/Bold/Italic/Underline/Hyperlink.
    ['Span',                    { name: 'Inlines',  kind: 'list'   }],
    ['Bold',                    { name: 'Inlines',  kind: 'list'   }],
    ['Italic',                  { name: 'Inlines',  kind: 'list'   }],
    ['Underline',               { name: 'Inlines',  kind: 'list'   }],
    ['Hyperlink',               { name: 'Inlines',  kind: 'list'   }],
    // Run is a text leaf; `Run { "text" }` sets Text via the string body.
    ['Run',                     { name: 'Text',     kind: 'string' }],
    // InlineUIContainer embeds one Visual: `InlineUIContainer { Btn[…] }`.
    ['InlineUIContainer',       { name: 'Child',    kind: 'object' }],
    // Block flow-content model. RichText hosts take a single FlowDocument
    // (object slot); FlowDocument / ListItem hold Blocks (list); Paragraph
    // is an inline host (Inlines list — text chunks allowed); List holds
    // ListItems (list). Text directly in a block host (FlowDocument / List /
    // ListItem) is a compile error — text must live inside a Paragraph.
    ['RichTextBlock',           { name: 'Document',  kind: 'object' }],
    ['RichTextBox',             { name: 'Document',  kind: 'object' }],
    ['FlowDocument',            { name: 'Blocks',    kind: 'list'   }],
    ['Paragraph',               { name: 'Inlines',   kind: 'list'   }],
    ['List',                    { name: 'ListItems', kind: 'list'   }],
    ['ListItem',                { name: 'Blocks',    kind: 'list'   }],
    ['Canvas',                  { name: 'Children', kind: 'list'   }],
    ['PaginatedCanvas',         { name: 'Children', kind: 'list'   }],
    ['StackPanel',              { name: 'Children', kind: 'list'   }],
    ['WrapPanel',               { name: 'Children', kind: 'list'   }],
    ['UniformGrid',             { name: 'Children', kind: 'list'   }],
    ['Grid',                    { name: 'Children', kind: 'list'   }],
    ['DockPanel',               { name: 'Children', kind: 'list'   }],
    ['ButtonGroup',             { name: 'Children', kind: 'list'   }],
    ['SegmentedButton',         { name: 'Items',    kind: 'list'   }],
    ['SegmentedItem',           { name: 'Content',  kind: 'object' }],
    ['RadioButtonGroup',        { name: 'Items',    kind: 'list'   }],
    ['RadioButtonItem',         { name: 'Content',  kind: 'object' }],
    ['SplitButton',             { name: 'Content',  kind: 'object' }],
    ['FabMenu',                 { name: 'Content',  kind: 'object' }],
    ['Drawer',                  { name: 'Content',  kind: 'object' }],
    ['TreeView',                { name: 'Items',    kind: 'list'   }],
    ['TreeViewItem',            { name: 'Items',    kind: 'list'   }],
    ['ListBox',                 { name: 'Items',    kind: 'list'   }],
    ['ListBoxItem',             { name: 'Content',  kind: 'object' }],
    ['TextBox',                 { name: 'Text',     kind: 'string' }],
    ['PageView',                { name: 'Content',  kind: 'object' }],
    ['ContentControl',          { name: 'Content',  kind: 'object' }],
    ['ContentPresenter',        { name: 'Content',  kind: 'object' }],
    ['Figure',                  { name: 'Content',  kind: 'object' }],
    ['Group',                   { name: 'Content',  kind: 'object' }],
    ['ItemsControl',            { name: 'Items',    kind: 'list'   }],
    ['Selector',                { name: 'Items',    kind: 'list'   }],
    ['Diagram',                 { name: 'Items',    kind: 'list'   }],
    ['VirtualizingStackPanel',  { name: 'Children', kind: 'list'   }],
    ['VirtualizingWrapPanel',   { name: 'Children', kind: 'list'   }],
    ['ScrollViewer',            { name: 'Content',  kind: 'object' }],

    // ── Surfaces / notifications ContentControls ────────────────────
    // Each is a ContentControl whose brace body fills its Content slot
    // (same shape as Card / Drawer / Dialog). Banner / BottomSheet /
    // Snackbar carry their message / body payload here; the trailing
    // Leading / Actions slots stay attribute-driven (Visual DPs).
    ['Banner',                  { name: 'Content',  kind: 'object' }],
    ['BottomSheet',             { name: 'Content',  kind: 'object' }],
    ['Snackbar',                { name: 'Content',  kind: 'object' }],
    ['Dialog',                  { name: 'Content',  kind: 'object' }],

    // Internal helper classes (see DEFAULT_SYMBOLS comment above).
    ['ClickableBorder',         { name: 'Child',    kind: 'single' }],
    ['RepeatButton',            { name: 'Child',    kind: 'single' }],
    ['ClickAwayScrim',          { name: 'Child',    kind: 'single' }],
    ['SplitRow',                { name: 'Children', kind: 'list'   }],
    ['ComboBoxPopupHost',       { name: 'Children', kind: 'list'   }],
    ['ScrimSurface',            { name: 'Child',    kind: 'single' }],
    ['TemporaryOverlayHost',    { name: 'Children', kind: 'list'   }],
    ['ClickableRow',            { name: 'Child',    kind: 'single' }],
    ['ChevronTarget',           { name: 'Child',    kind: 'single' }],
    ['CollapsibleStack',        { name: 'Children', kind: 'list'   }],
    ['ScrollBarLayout',         { name: 'Children', kind: 'list'   }],
    ['ScrollViewerLayout',      { name: 'Children', kind: 'list'   }],
    ['ScrollContentPresenter',  { name: 'Content',  kind: 'object' }],
    ['SliderLayout',            { name: 'Children', kind: 'list'   }],
    ['TextEditorSurface',       { name: 'Children', kind: 'list'   }],

    // ── Command-surface controls (5.11) ─────────────────────────────
    ['ToggleButton',            { name: 'Content',  kind: 'object' }],
    ['ToolBar',                 { name: 'Items',    kind: 'list'   }],
    ['ToolBarSplitButton',      { name: 'Items',    kind: 'list'   }],
    ['ToolBarPopupHost',        { name: 'Children', kind: 'list'   }],
    ['ToolBarButton',           { name: 'Content',  kind: 'object' }],
    ['ToolBarToggleButton',     { name: 'Content',  kind: 'object' }],
    // ToolBarSeparator has no body; falls back to single/Child error
    // path on accidental nesting — fine.
    ['MenuStrip',               { name: 'Items',    kind: 'list'   }],
    ['MenuButton',              { name: 'Items',    kind: 'list'   }],
    ['MenuItem',                { name: 'Items',    kind: 'list'   }],
    // MenuSeparator: no body
    ['ContextMenu',             { name: 'Items',    kind: 'list'   }],
    // MenuPopupHost: Panel-shaped, takes Scrim + popup-container as
    // children declaratively from the default ControlTemplates in
    // framework.resources.mu.
    ['MenuPopupHost',           { name: 'Children', kind: 'list'   }],
    ['StatusBar',               { name: 'Items',    kind: 'list'   }],
    ['StatusBarItem',           { name: 'Content',  kind: 'object' }],
    // StatusBarSeparator: no body

    // ── Ribbon family (5.11.3) ──────────────────────────────────────
    // Ribbon's default children are stable RibbonTabs (list → AddChild →
    // Tabs); contextual groups + QAT invokers are authored via
    // property-element `ContextualGroups { … }` / `QuickAccessItems { … }`
    // blocks (recognised in compiler.ts). RibbonContextualGroup's default
    // children are its contextual RibbonTabs (list → AddChild → Tabs).
    ['Ribbon',                  { name: 'Tabs',     kind: 'list'   }],
    ['RibbonTab',               { name: 'Items',    kind: 'list'   }],
    ['RibbonContextualGroup',   { name: 'Tabs',     kind: 'list'   }],
    ['RibbonGroup',             { name: 'Items',    kind: 'list'   }],
    ['RibbonSmallButtonColumn', { name: 'Children', kind: 'list'   }],
    ['RibbonButton',            { name: 'Content',  kind: 'object' }],
    ['RibbonToggleButton',      { name: 'Content',  kind: 'object' }],
    ['RibbonDropDownButton',    { name: 'Items',    kind: 'list'   }],
    ['RibbonSplitButton',       { name: 'Items',    kind: 'list'   }],
    ['RibbonGallery',           { name: 'Items',    kind: 'list'   }],
    // RibbonTabHeader: Content set by the Ribbon; RibbonGalleryPopupList:
    // populated via ItemsSource — neither takes a markup body.
]);
