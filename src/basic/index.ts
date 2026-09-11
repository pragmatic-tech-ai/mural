// Barrel re-exports for the basic control library — primitive Visuals
// (Border, Canvas, layout panels, TextBlock, …) and the templating
// primitives that the framework controls build on. Consumers import
// from here rather than the individual control files.
//
// Templated controls (ContentControl, ItemsControl, Button, ToggleButton,
// ScrollViewer, Drawer, GroupItem, ListBox, TreeView, ComboBox, Menu /
// ContextMenu / MenuButton, ToolBar, Diagram, Selector base) live in
// `mural/framework`.

export { Adorner, AdornerLayer, AdornerDecorator } from '../runtime/index.js';
export { ValidationErrorAdorner } from './validation-error-adorner.js';
export {
    SelectionBoundsAdorner,
    type SelectionSource,
    HorizontalAnchor,
    VerticalAnchor,
} from './selection-bounds-adorner.js';
export { Border } from './border.js';
export { DomHost } from './dom-host.js';
export { TextBlock, TextAlignment, TextWrapping, TextTrimming, MeasurementFidelity } from './text-block.js';
// Inline flow-content model (WPF Inlines analog).
export { TextElement, Inline, type ContentHost, type InlineHost, type RunProps, type LinkTarget } from './documents/text-element.js';
export { InlineCollection } from './documents/inline-collection.js';
export { Run, Span, Bold, Italic, Underline, LineBreak, InlineUIContainer } from './documents/inlines.js';
export { Hyperlink } from './documents/hyperlink.js';
// Block flow-content model (WPF FlowDocument analog) — paragraphs + lists.
export { Block, type BlockHost, BlockCollection } from './documents/block.js';
export { FlowDocument } from './documents/flow-document.js';
export { Paragraph } from './documents/paragraph.js';
export { List, ListItem, ListMarkerStyle } from './documents/list.js';
export { Table, TableRow, TableCell } from './documents/table.js';
export { RichTextBlock } from './rich-text-block.js';
export { RichTextBox } from './rich-text-box.js';
// Rich-text editing model — TextPointer + document navigation + edit ops,
// for hosts / behaviours that drive a RichTextBox programmatically.
export { TextPointer } from './documents/text-pointer.js';
export { FormatKind } from './documents/text-editing.js';
export { Canvas } from './panels/canvas.js';
export { PaginatedCanvas } from './panels/paginated-canvas.js';
export { Ellipse } from './shapes/ellipse.js';
export { Shape } from './shapes/shape.js';
export { Path } from './shapes/path.js';
export { Arc } from './shapes/arc.js';
export { Image } from './image.js';
export {
    CURRENT_COLOR,
    Icon,
    IconDefinition,
    buildPathIcon,
    makeIconShape,
    type IconPaint,
    type IconShape,
    type PathIconRecord,
} from './icon.js';
export {
    parseSvgIcon,
    parsePathData,
    ParseError as SvgIconParseError,
    type ParseOptions as SvgIconParseOptions,
} from './svg-icon-parser.js';
export { Line } from './shapes/line.js';
export { Rectangle } from './shapes/rectangle.js';
export { Squircle } from './shapes/squircle.js';
export { Pill } from './shapes/pill.js';
export { Arch } from './shapes/arch.js';
export { Semicircle } from './shapes/semicircle.js';
export { Triangle } from './shapes/triangle.js';
export { Arrow } from './shapes/arrow.js';
export { Fan, FanPivot } from './shapes/fan.js';
export { Clamshell } from './shapes/clamshell.js';
export {
    Cookie,
    Diamond,
    Pentagon,
    Gem,
    FourSidedCookie,
    SixSidedCookie,
    SevenSidedCookie,
    NineSidedCookie,
    TwelveSidedCookie,
} from './shapes/cookie.js';
export { Clover, FourLeafClover, EightLeafClover } from './shapes/clover.js';
export { Slanted } from './shapes/slanted.js';
export { Puffy, PuffyDiamond, PuffyBase } from './shapes/puffy.js';
export { Heart } from './shapes/heart.js';
export { Bun } from './shapes/bun.js';
export { Ghostish } from './shapes/ghostish.js';
export { PixelArt, PixelCircle, PixelTriangle, PixelSource } from './shapes/pixel-shape.js';
export {
    RadialWave,
    Sunny,
    VerySunny,
    Burst,
    SoftBurst,
    Boom,
    SoftBoom,
    Flower,
} from './shapes/radial-wave.js';
export { DockPanel, Dock } from './panels/dock-panel.js';
export {
    TextBox,
    TextBoxVariant,
    TextEditorSurface,
    type ClipboardSink,
} from './text-box.js';
export { SpinEdit } from './spin-edit.js';
export { Slider, SliderLayout } from './slider.js';
export { SliderSpinEdit } from './slider-spin-edit.js';
export { PageView } from './page-view.js';
export { Orientation } from './panels/orientation.js';
export { StackPanel } from './panels/stack-panel.js';
export { WrapPanel } from './panels/wrap-panel.js';
export { UniformGrid } from './panels/uniform-grid.js';
export {
    Grid,
    GridLength,
    ColumnDefinition,
    RowDefinition,
    GridUnitType,
} from './panels/grid.js';
export { ContentPresenter } from './templates/content-presenter.js';
export {
    ControlTemplate,
    TemplateBinding,
    type TemplateFactory,
    type TemplateInstance,
} from './templates/control-template.js';
export {
    DataTemplate,
    HierarchicalDataTemplate,
    TargetedSetter,
    TemplateDataTrigger,
    TemplateMultiDataTrigger,
    TemplatePropertyTrigger,
    type DataTemplateFactory,
    type HierarchicalChildSelector,
    type TemplateDataTriggerCondition,
} from './templates/data-template.js';
export {
    DataTemplateSelector,
    type TemplateSelectorFn,
    type TemplateSelection,
} from './templates/data-template-selector.js';
export {
    StyleSelector,
    type StyleSelectorFn,
    type StyleSelection,
} from './templates/style-selector.js';
export { TypeTemplateSelector } from './templates/type-template-selector.js';
export { ListReorderBehavior } from './behaviors/list-reorder-behavior.js';
export { LogBehavior } from './behaviors/log-behavior.js';
export { FocusOnVisibleBehavior } from './behaviors/focus-on-visible-behavior.js';
export { attachMarqueeSelection } from './behaviors/marquee-selection-behavior.js';
export { AlternationConverter } from './converters/index.js';
export {
    GlyphGeometryConverter,
    fontGlyphSource,
    type GlyphGeometrySource,
    type GlyphGeometryOptions,
} from './converters/index.js';
export {
    ItemsPanelTemplate,
    type ItemsPanelFactory,
} from './panels/items-panel-template.js';
// CollectionView is imported here for its module-load side effect —
// it self-registers with ItemsControl so ItemsSource assignments
// can construct a view. Explicit re-export gives consumers the
// types they need to drive view-state (Filter, SortDescriptions, …).
export {
    CollectionView,
    CollectionViewGroup,
    SortDescription,
    GroupDescription,
    SortDirection,
    type FilterPredicate,
    type CurrentChangedListener,
} from './collections/collection-view.js';
export { GroupStyle } from './collections/group-style.js';
export {
    GenerationSession,
    GeneratorDirection,
    GeneratorPosition,
    GeneratorStatus,
    ItemContainerGenerator,
    ItemsChangedAction,
    type ItemsChangedArgs,
} from './collections/item-container-generator.js';
export { ItemsPresenter } from './templates/items-presenter.js';
export { VirtualizingPanel } from './panels/virtualisation/virtualizing-panel.js';
export { VirtualizingStackPanel } from './panels/virtualisation/virtualizing-stack-panel.js';
export { VirtualizingWrapPanel } from './panels/virtualisation/virtualizing-wrap-panel.js';
export { ScrollContentPresenter } from './scroll/scroll-content-presenter.js';
export { ScrollBar, ScrollBarLayout } from './scroll/scroll-bar.js';
export {
    Thumb,
    type DragStartedEventArgs,
    type DragDeltaEventArgs,
    type DragCompletedEventArgs,
} from './scroll/thumb.js';
export {
    GridSplitter,
    GridResizeDirection,
    type GridResizeBehavior,
} from './grid-splitter.js';
export { Splitter } from './splitter.js';
export { ClickableBorder } from './clickable-border.js';
export { ClickAwayScrim } from './click-away-scrim.js';

// Drawer / Menu / ContextMenu / Surface-control helpers (ScrimSurface,
// TemporaryOverlayHost, …) live in
// `mural/framework` alongside their owning controls.
