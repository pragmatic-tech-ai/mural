import {
    Application,
    DynamicResource,
    Element,
    MetaData,
    MuralBase,
    type ObservableCollection,
    type PersistentGuide,
    type GuidePreview,
    Rect,
    Visibility,
    type KeyEventArgs,
    Key,
    type PointerEventArgs,
    type PropertyDescriptor,
    RelayCommand,
    Visual,
    hasModifier,
    ModifierKeys,
    type WheelEventArgs,
    type Disposable,
} from '../../runtime/index.js';
import { NodeViewModel } from './node-view-model.js';
import type { DataTemplate } from '../../basic/templates/data-template.js';
import { AdornerLayer } from '../../visual-engine/index.js';
import { Figure, resolveEditTarget } from './figure.js';
import { ContainerFigure } from './container-figure.js';
import { ContentContainerFigure } from './content-container-figure.js';
import { PositionAnchor } from './position-anchor.js';
import type { IPortProvider } from './port-providers/port-provider.js';
import { Group } from './group.js';
import { ensureToolboxDefaults } from './toolbox/ensure-toolbox-defaults.js';
import { connectorCapOptions } from './caps/connector-cap-options.js';
import type { CapOption } from '../formatting/cap-option.js';
import { Selector } from '../list/selector.js';
import { DiagramCommands } from './collaborators/diagram-commands.js';
import { DiagramConnectorsMaterializer } from './collaborators/diagram-connectors-materializer.js';
import { SelectionBoundsTracker } from './collaborators/selection-bounds-tracker.js';
import { ContainerPlacement } from './collaborators/container-placement.js';
import { SelectionReflector } from './collaborators/selection-reflector.js';
import {
    type GroupRequestedArgs,
    type UngroupRequestedArgs,
    type GroupRequestedListener,
    type UngroupRequestedListener,
} from './commands/group-ops.js';
import {
    type WrapRequestedArgs,
    type UnwrapRequestedArgs,
    type WrapRequestedListener,
    type UnwrapRequestedListener,
    type NodeReparentedArgs,
    type NodeReparentedListener,
} from './commands/container-ops.js';
import {
    type CombineRequestedArgs,
    type CombineRequestedListener,
} from './commands/combine.js';
import {
    type DeleteRequestedArgs,
    type DeleteRequestedListener,
} from './commands/delete-ops.js';
import {
    type CopyRequestedArgs,
    type CopyRequestedListener,
    type PasteRequestedArgs,
    type PasteRequestedListener,
} from './commands/clipboard-ops.js';
import {
    attachStandardDiagramMutations,
    type DiagramMutator,
} from './behaviors/attach-standard-mutations.js';
import {
    attachAlignmentGuides,
    type AlignmentGuide,
    type AlignmentGuidesHandlers,
} from './behaviors/alignment-guides-behavior.js';
import { attachPersistentGuides, type PersistentGuidesHandlers } from './behaviors/persistent-guides-behavior.js';
import { PersistentGuidesAdorner } from './guides/persistent-guides-adorner.js';
import { LayoutPreviewAdorner } from './layout/layout-preview-adorner.js';
import type { LayoutPreview } from './layout-preview.js';
import { RulerBar } from './guides/ruler-bar.js';
import { AlignmentGuidesAdorner } from './behaviors/alignment-guides-adorner.js';
import { TextBlockAdorner } from './behaviors/text-block-adorner.js';
import { SelectionBoundsAdorner } from '../../basic/index.js';
import { DiagramSelectionSource } from './behaviors/diagram-selection-source.js';
import { Brush, Color, Pen, Point, ScaleTransform, Size, SolidColorBrush, TextAlignment } from '../../visual-engine/index.js';
import { ScrollViewer } from '../surfaces/scroll-viewer.js';
import { type Camera, clampZoom, fitBounds, zoomAtPoint } from './camera.js';
import { attachZoomPan } from './behaviors/zoom-pan-behavior.js';

// Gesture handlers the ZoomPanBehavior installs on a Diagram: Ctrl+wheel zoom is
// delivered via the tunnel OnPreviewPointerWheel override (so it pre-empts the
// ScrollViewer's bubble-phase scroll). Plain/Shift wheel and scrollbars are the
// ScrollViewer's own.
interface CameraGestureHandlers
{
    OnWheel(args: WheelEventArgs): void;
}
import { TextPlacement } from './shape-text.js';
import { FormatMirror } from './collaborators/format-mirror.js';
import { SelectionGeometryMirror } from './collaborators/selection-geometry-mirror.js';
import {
    attachCanvasDropBehavior,
    type ItemDroppedArgs,
    type ItemDroppedListener,
} from './behaviors/canvas-drop-behavior.js';
export { attachCanvasDropBehavior, TOOLBOX_ITEM_FORMAT } from './behaviors/canvas-drop-behavior.js';
export type { ItemDroppedArgs, ItemDroppedListener } from './behaviors/canvas-drop-behavior.js';
import type { ExternalDroppedArgs, ExternalDroppedListener } from './external-drop.js';
export { MuralDataFormat } from './external-drop.js';
export type { ExternalDroppedArgs, ExternalDroppedListener } from './external-drop.js';
import type {
    ConnectorCreatedArgs,
    ConnectorCreatedListener,
} from './behaviors/connector-create-behavior.js';
import {
    attachConnectorInteractions,
    type ConnectorInteractionsHandlers,
} from './behaviors/connector-interactions-behavior.js';
import {
    attachFormatPainter,
    type FormatPainterHandlers,
} from './behaviors/format-painter-behavior.js';
import { Connector } from './connector.js';
import { type RouteWaypoint, waypoint, hasPinned } from './route-waypoint.js';
import type { RigidConnectorDragHost, RigidConnectorDragSession } from './rigid-connector-drag.js';
import { DiagramSettingKey, DiagramSettings } from './diagram-settings.js';

// §19.3 follow-up — position snap callback. Consumers (e.g., the
// diagram demo's align-edges behavior) set this DP to a pure function
// that returns the snapped rect for a given cursor-derived candidate
// rect. Figure.OnPointerMove consults the parent Diagram and
// applies the snap before writing X / Y, so alignment guides
// translate into real snap-on-drag behavior without behaviors having
// to fight the framework's drag positioning.
export type DiagramPositionSnap = (rect: Rect) => Rect;

// A DataContext that wants a back-reference to the Diagram view presenting it.
// When a Diagram's DataContext structurally exposes a writable `ActiveView`,
// the control publishes itself there when the DataContext is set — so shell
// regions OUTSIDE the content template (toolbars, format pane) can bind the
// active document's editing commands + selection-format state THROUGH the VM:
//   `$service(ContentHostService).ActiveDocument.ActiveView.AlignLeftCommand`.
//
// This is the seam that lets the Diagram materialize inside a
// `DataTemplate[DataType=DiagramDocument]` (attached in-tree, adorners live)
// while sibling regions still reach it — replacing the older
// "service holds one code-built control" workaround. Duck-typed like
// DiagramMutator, so the control depends on no concrete document type.
export interface IDiagramViewHost { ActiveView: Diagram | undefined; }

// Selector flavour that materializes each item into a Figure
// container instead of the default ContentPresenter wrap. The Selector
// base supplies the SelectedItem / SelectedIndex / SelectedValue surface
// out of the box, so a Diagram consumer can data-bind selection the
// same way ListBox / ComboBox do; per-container highlight rides on the
// matching DataTemplate trigger (`when($IsSelected)`).
//
// The override below is the entire point of the subclass — a Visio-/
// drawio-style surface needs its containers to own position + drag-to-
// move, and Figure bakes both into a single ContentControl.
// Everything else (ItemsPanel, ItemTemplate, ItemContainerStyle, item
// binding, selection) is inherited unchanged.
//
// Pair with `ItemsPanel = ItemsPanelTemplate { Canvas }` so the
// Figure containers are placed on a Canvas that honours their
// Canvas.Left / Canvas.Top — Figure mirrors its own Left / Top onto
// those attached properties so a parent Canvas places it.
const EMPTY_CAP_OPTIONS: readonly CapOption[] = Object.freeze([]) as readonly CapOption[];

export class Diagram extends Selector implements RigidConnectorDragHost
{
    static
    {
        MuralBase.OverrideMetadata(Diagram, Element.DefaultStyleKeyKey, { default_value: Diagram });
    }

    // Icon-size attached properties — inheritable so every node in the
    // diagram's visual subtree reads the per-Diagram icon size without a
    // direct binding. The setting-bound annotation (8th arg) ties the
    // default to ApplicationSettings so a user override takes effect live.
    // A local set_property_value write on a Diagram instance (or any
    // ancestor) shadows the setting for that diagram's subtree.
    public static readonly DefaultIconWidthKey = MuralBase.RegisterAttachedProperty<number>(
        Diagram, 'DefaultIconWidth', 0, MetaData.Inherits,
        undefined, undefined, undefined,
        { key: DiagramSettingKey.DefaultIconWidth });
    public static readonly DefaultIconHeightKey = MuralBase.RegisterAttachedProperty<number>(
        Diagram, 'DefaultIconHeight', 0, MetaData.Inherits,
        undefined, undefined, undefined,
        { key: DiagramSettingKey.DefaultIconHeight });

    public static GetDefaultIconWidth(target: MuralBase): number
    {
        return target.get_property_value(Diagram.DefaultIconWidthKey);
    }

    public static SetDefaultIconWidth(target: MuralBase, value: number): void
    {
        target.set_property_value(Diagram.DefaultIconWidthKey, value);
    }

    public static GetDefaultIconHeight(target: MuralBase): number
    {
        return target.get_property_value(Diagram.DefaultIconHeightKey);
    }

    public static SetDefaultIconHeight(target: MuralBase, value: number): void
    {
        target.set_property_value(Diagram.DefaultIconHeightKey, value);
    }

    // §19.3 — `PositionSnap` callback. Default `undefined` = no snap,
    // identity behavior. When set, Figure.OnPointerMove calls it
    // with the cursor-derived candidate rect and uses the returned
    // rect's X / Y for its position write.
    public static readonly PositionSnapKey = MuralBase.RegisterProperty<DiagramPositionSnap | undefined>(
        Diagram, 'PositionSnap', undefined, MetaData.None);

    // Camera DP — the infinite-canvas zoom. Applied as PART_Camera's
    // LayoutTransform scale (grows the measured footprint); pan is the
    // ScrollViewer's scroll offset (see ScrollX/ScrollY). Identity default
    // (Zoom 1). The host persists zoom + scroll offset per diagram. See camera.ts.
    public static readonly ZoomKey = MuralBase.RegisterProperty<number>(Diagram, 'Zoom', 1, MetaData.None);

    // Zoom commands — RelayCommand DPs the overlay + host keyboard bind. Seeded in
    // the ctor; behaviour lives in the ZoomIn/Fit/… methods below.
    public static readonly ZoomInCommandKey         = MuralBase.RegisterProperty<RelayCommand | undefined>(Diagram, 'ZoomInCommand', undefined, MetaData.None);
    public static readonly ZoomOutCommandKey        = MuralBase.RegisterProperty<RelayCommand | undefined>(Diagram, 'ZoomOutCommand', undefined, MetaData.None);
    public static readonly ResetZoomCommandKey      = MuralBase.RegisterProperty<RelayCommand | undefined>(Diagram, 'ResetZoomCommand', undefined, MetaData.None);
    public static readonly FitCommandKey            = MuralBase.RegisterProperty<RelayCommand | undefined>(Diagram, 'FitCommand', undefined, MetaData.None);
    public static readonly FitToSelectionCommandKey = MuralBase.RegisterProperty<RelayCommand | undefined>(Diagram, 'FitToSelectionCommand', undefined, MetaData.None);

    // Opt-in gate: when true, the ZoomPanBehavior is attached (Ctrl+wheel
    // zoom-at-cursor). Plain/Shift wheel and scrollbars are the ScrollViewer's.
    // Default false so existing diagrams are unaffected until a host enables it.
    public static readonly CameraEnabledKey = MuralBase.RegisterProperty<boolean>(Diagram, 'CameraEnabled', false, MetaData.None);

    // Selection-bounds DPs — read-only, derived from the union bbox of
    // every IFigure-shaped item in SelectedItems by SelectionBoundsTracker
    // (see collaborators/selection-bounds-tracker.ts). Consumers can bind
    // their resize-adorner / status-bar / inspector chrome to these DPs
    // without subscribing to per-item geometry themselves.
    public static readonly SelectionLeftKey   = MuralBase.RegisterReadOnlyProperty<number>(
        Diagram, 'SelectionLeft',   0, MetaData.None);
    public static readonly SelectionTopKey    = MuralBase.RegisterReadOnlyProperty<number>(
        Diagram, 'SelectionTop',    0, MetaData.None);
    public static readonly SelectionWidthKey  = MuralBase.RegisterReadOnlyProperty<number>(
        Diagram, 'SelectionWidth',  0, MetaData.None);
    public static readonly SelectionHeightKey = MuralBase.RegisterReadOnlyProperty<number>(
        Diagram, 'SelectionHeight', 0, MetaData.None);
    public static readonly SelectionCountKey  = MuralBase.RegisterReadOnlyProperty<number>(
        Diagram, 'SelectionCount',  0, MetaData.None);

    // Single-selected-shape geometry channel — driven by SelectionGeometryMirror.
    // Reflects the one selected Figure's geometry (px) and (for the writable
    // ones) routes edits back to it. HasSelectedShape is false when the selection
    // isn't exactly one Figure, disabling the Size/Position editor. Registered as
    // plain read-write DPs (like SelectionFormat*) so the mirror writes via
    // set_property_value; the writable geometry is BindsTwoWayByDefault for the
    // inspector's two-way bind.
    public static readonly HasSelectedShapeKey = MuralBase.RegisterProperty<boolean>(
        Diagram, 'HasSelectedShape', false, MetaData.None);
    public static readonly SelectedShapeLeftKey = MuralBase.RegisterProperty<number>(
        Diagram, 'SelectedShapeLeft', 0, MetaData.None | MetaData.BindsTwoWayByDefault);
    public static readonly SelectedShapeTopKey = MuralBase.RegisterProperty<number>(
        Diagram, 'SelectedShapeTop', 0, MetaData.None | MetaData.BindsTwoWayByDefault);
    public static readonly SelectedShapeWidthKey = MuralBase.RegisterProperty<number>(
        Diagram, 'SelectedShapeWidth', 0, MetaData.None | MetaData.BindsTwoWayByDefault);
    public static readonly SelectedShapeHeightKey = MuralBase.RegisterProperty<number>(
        Diagram, 'SelectedShapeHeight', 0, MetaData.None | MetaData.BindsTwoWayByDefault);
    public static readonly SelectedShapeRotationKey = MuralBase.RegisterProperty<number>(
        Diagram, 'SelectedShapeRotation', 0, MetaData.None | MetaData.BindsTwoWayByDefault);
    public static readonly SelectedShapeBaseWidthKey = MuralBase.RegisterProperty<number>(
        Diagram, 'SelectedShapeBaseWidth', 0, MetaData.None);
    public static readonly SelectedShapeBaseHeightKey = MuralBase.RegisterProperty<number>(
        Diagram, 'SelectedShapeBaseHeight', 0, MetaData.None);
    // Per-shape editor intents mirrored from the selected Figure (two-way, so
    // the Size & Position inspector reads AND writes them). Unlike the geometry
    // DPs these are seeded/written by SelectionGeometryMirror as figure state.
    public static readonly SelectedShapeLockAspectKey = MuralBase.RegisterProperty<boolean>(
        Diagram, 'SelectedShapeLockAspect', false, MetaData.None | MetaData.BindsTwoWayByDefault);
    public static readonly SelectedShapeAnchorKey = MuralBase.RegisterProperty<PositionAnchor>(
        Diagram, 'SelectedShapeAnchor', PositionAnchor.TopLeftCorner, MetaData.None | MetaData.BindsTwoWayByDefault);

    // Align commands — RelayCommand-typed DPs. DiagramCommands installs
    // default impls at construction; consumers override by writing their
    // own RelayCommand to the DP. Each command's CanExecute returns
    // false for selections < 2 IFigure-shaped items. RaiseCanExecuteChanged
    // is fanned out on every SelectionChanged by DiagramCommands.
    public static readonly AlignLeftCommandKey   = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'AlignLeftCommand',   undefined, MetaData.None);
    public static readonly AlignRightCommandKey  = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'AlignRightCommand',  undefined, MetaData.None);
    public static readonly AlignTopCommandKey    = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'AlignTopCommand',    undefined, MetaData.None);
    public static readonly AlignMiddleCommandKey = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'AlignMiddleCommand', undefined, MetaData.None);
    public static readonly AlignCenterCommandKey = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'AlignCenterCommand', undefined, MetaData.None);
    public static readonly BringToFrontCommandKey = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'BringToFrontCommand', undefined, MetaData.None);
    public static readonly SendToBackCommandKey   = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'SendToBackCommand',   undefined, MetaData.None);
    public static readonly BringForwardCommandKey = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'BringForwardCommand', undefined, MetaData.None);
    public static readonly SendBackwardCommandKey = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'SendBackwardCommand', undefined, MetaData.None);

    // Distribute commands — same shape as the align surface. CanExecute
    // requires ≥ 3 IFigure-shaped selected items (alignment-only fits 2).
    public static readonly DistributeHorizontalCommandKey = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'DistributeHorizontalCommand', undefined, MetaData.None);
    public static readonly DistributeVerticalCommandKey   = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'DistributeVerticalCommand',   undefined, MetaData.None);

    // Group / Ungroup commands — events-based mutation contract. The
    // command itself does not touch the consumer's data collection.
    // Execute fires the corresponding event on Diagram; the consumer's
    // subscriber wraps / dissolves and updates its own VM tree.
    //
    // CanExecute gates:
    //   * GroupCommand   — ≥ 2 top-level entries in SelectedItems
    //   * UngroupCommand — ≥ 1 group-shaped (duck-typed on `Members`)
    //                      top-level entry in SelectedItems
    public static readonly GroupCommandKey   = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'GroupCommand',   undefined, MetaData.None);
    public static readonly UngroupCommandKey = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'UngroupCommand', undefined, MetaData.None);
    // Container commands — same event-based mutation contract as Group / Ungroup.
    //   * WrapInContainerCommand — ≥ 1 top-level Figure in SelectedItems
    //   * UnwrapContainerCommand — ≥ 1 ContainerFigure in SelectedItems
    public static readonly WrapInContainerCommandKey = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'WrapInContainerCommand', undefined, MetaData.None);
    public static readonly UnwrapContainerCommandKey = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'UnwrapContainerCommand', undefined, MetaData.None);

    // Combine commands — one per GeometryCombineMode. Same event-based
    // mutation contract as Group / Ungroup: Execute fires CombineRequested
    // with the corresponding Mode, consumer wraps the merge result + does
    // the collection mutation. The framework's `combine()` helper (from
    // src/visual-engine/geometry/combine.ts) is what consumers typically
    // invoke to fold-merge the input geometries.
    public static readonly CombineUnionCommandKey     = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'CombineUnionCommand',     undefined, MetaData.None);
    public static readonly CombineIntersectCommandKey = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'CombineIntersectCommand', undefined, MetaData.None);
    public static readonly CombineSubtractCommandKey  = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'CombineSubtractCommand',  undefined, MetaData.None);
    public static readonly CombineExcludeCommandKey   = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'CombineExcludeCommand',   undefined, MetaData.None);

    // Text-format commands — the command surface behind the two label toolbars
    // (paragraph alignment WITHIN the label; label placement WITHIN the shape).
    // Same RelayCommand-DP shape as the align/combine commands, so a data-driven
    // toolbar / ICommandTarget consumer (e.g. Plexus) binds them exactly the same
    // way. DiagramCommands installs the defaults; each Execute force-applies its
    // value to every selected shape's label (via ApplySelectionText*), and each
    // CanExecute requires ≥ 1 selected shape that carries a label. The demo's
    // active-state toggles bind BOTH Command (the write) and IsChecked (the
    // reflection through `<< Is(...)`).
    public static readonly SetTextAlignLeftCommandKey    = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'SetTextAlignLeftCommand',    undefined, MetaData.None);
    public static readonly SetTextAlignCenterCommandKey  = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'SetTextAlignCenterCommand',  undefined, MetaData.None);
    public static readonly SetTextAlignRightCommandKey   = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'SetTextAlignRightCommand',   undefined, MetaData.None);
    public static readonly SetTextAlignJustifyCommandKey = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'SetTextAlignJustifyCommand', undefined, MetaData.None);

    public static readonly SetTextPlacementCenterCommandKey      = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'SetTextPlacementCenterCommand',      undefined, MetaData.None);
    public static readonly SetTextPlacementTopCommandKey         = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'SetTextPlacementTopCommand',         undefined, MetaData.None);
    public static readonly SetTextPlacementBottomCommandKey      = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'SetTextPlacementBottomCommand',      undefined, MetaData.None);
    public static readonly SetTextPlacementLeftCommandKey        = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'SetTextPlacementLeftCommand',        undefined, MetaData.None);
    public static readonly SetTextPlacementRightCommandKey       = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'SetTextPlacementRightCommand',       undefined, MetaData.None);
    public static readonly SetTextPlacementTopLeftCommandKey     = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'SetTextPlacementTopLeftCommand',     undefined, MetaData.None);
    public static readonly SetTextPlacementTopRightCommandKey    = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'SetTextPlacementTopRightCommand',    undefined, MetaData.None);
    public static readonly SetTextPlacementBottomLeftCommandKey  = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'SetTextPlacementBottomLeftCommand',  undefined, MetaData.None);
    public static readonly SetTextPlacementBottomRightCommandKey = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'SetTextPlacementBottomRightCommand', undefined, MetaData.None);

    // Character-decoration toggle commands — flip bold / italic / underline /
    // strikethrough on the selection (the selected text run(s) while editing,
    // else the whole label). Toggle semantics: Execute applies the opposite of
    // the current reflected state. Same DP shape so Plexus binds them by id.
    public static readonly SetTextBoldCommandKey          = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'SetTextBoldCommand',          undefined, MetaData.None);
    public static readonly SetTextItalicCommandKey        = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'SetTextItalicCommand',        undefined, MetaData.None);
    public static readonly SetTextUnderlineCommandKey     = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'SetTextUnderlineCommand',     undefined, MetaData.None);
    public static readonly SetTextStrikethroughCommandKey = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'SetTextStrikethroughCommand', undefined, MetaData.None);

    // Grow / shrink the label font one point. Unlike the family/size/colour
    // pickers (which set one shared value), these step EACH selected label's own
    // size (the caret run while editing), so a mixed selection keeps its
    // relative sizing. Same RelayCommand-DP shape for Plexus binding by id.
    public static readonly IncreaseFontSizeCommandKey = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'IncreaseFontSizeCommand', undefined, MetaData.None);
    public static readonly DecreaseFontSizeCommandKey = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'DecreaseFontSizeCommand', undefined, MetaData.None);

    // Copy Format (format painter) — pick up the selected shape's format, then
    // click shapes to stamp it. Toggles the FormatPainterActive DP; the paint
    // gestures + capture live in the format-painter behavior (installed in the
    // ctor). Bound by a ToolBarToggleButton whose IsChecked = $FormatPainterActive.
    public static readonly CopyFormatCommandKey = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'CopyFormatCommand', undefined, MetaData.None);

    // Figure clipboard — Copy / Cut / Paste. Copy + Cut snapshot the selection
    // (Cut also deletes); Paste materializes the clipboard. The commands fire the
    // CopyRequested / PasteRequested events the consumer's mutator handles;
    // Ctrl+C / X / V drive the same paths from OnKeyDown.
    public static readonly CopyCommandKey  = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'CopyCommand', undefined, MetaData.None);
    public static readonly CutCommandKey   = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'CutCommand', undefined, MetaData.None);
    public static readonly PasteCommandKey = MuralBase.RegisterProperty<RelayCommand | undefined>(
        Diagram, 'PasteCommand', undefined, MetaData.None);

    // ── Connectors collection + template ──────────────────────────
    //
    // `Connectors` is a parallel collection to ItemsSource. Items in
    // Connectors aren't list items — they're a second selectable
    // population on the same canvas. The DiagramConnectorsMaterializer
    // collaborator (constructed below) listens to collection events
    // and materializes one Visual per entry via ConnectorTemplate (or
    // the built-in default = `new Connector()`), parenting each onto the
    // diagram canvas (behind the figures by default). See § 3.5 of
    // [docs/connectors.md](../../../docs/connectors.md).
    public static readonly ConnectorsKey = MuralBase.RegisterProperty<ObservableCollection<MuralBase> | undefined>(
        Diagram, 'Connectors', undefined, MetaData.None);
    public static readonly ConnectorTemplateKey = MuralBase.RegisterProperty<DataTemplate | undefined>(
        Diagram, 'ConnectorTemplate', undefined, MetaData.None);

    // Alignment-guides opt-in. Default off; consumers flip true to
    // enable both the behavior (snap-on-drag + guide-list computation)
    // and the adorner (paints dashed guide lines).
    public static readonly AlignmentGuidesEnabledKey = MuralBase.RegisterProperty<boolean>(
        Diagram, 'AlignmentGuidesEnabled', false, MetaData.None);
    // Read-only — driven by AlignmentGuidesBehavior. Adorner subscribes
    // here; consumers can also bind for custom guide visualization.
    public static readonly AlignmentGuidesKey = MuralBase.RegisterReadOnlyProperty<readonly AlignmentGuide[]>(
        Diagram, 'AlignmentGuides', Object.freeze([]) as readonly AlignmentGuide[], MetaData.None);

    // Persistent (Visio-style) ruler guides. Read-write: the app hydrates them
    // from the .diagram metadata and persists changes; the behavior mutates them
    // on placement/reposition/delete/glue; the adorner subscribes to paint them.
    public static readonly GuidesKey = MuralBase.RegisterProperty<readonly PersistentGuide[]>(
        Diagram, 'Guides', Object.freeze([]) as readonly PersistentGuide[], MetaData.None);

    // Feature opt-in: shows the rulers AND attaches the persistent-guides behavior
    // + adorner. Default off — the template is visually identical to today.
    public static readonly RulersVisibleKey = MuralBase.RegisterProperty<boolean>(
        Diagram, 'RulersVisible', false, MetaData.None);

    // Index of the currently-selected persistent guide (into Guides), or -1 for
    // none. Driven by the behavior on click; read by the adorner to highlight it
    // and by the behavior's Delete-key handler.
    public static readonly SelectedGuideKey = MuralBase.RegisterProperty<number>(
        Diagram, 'SelectedGuide', -1, MetaData.None);

    // Transient hover placement hint: where a guide would land if the user dragged
    // out right now, or undefined when not over a drag-out zone. The behavior sets
    // it on idle pointer-move; the adorner subscribes to paint the faint preview
    // line. Never persisted (view-only).
    public static readonly GuidePreviewKey = MuralBase.RegisterProperty<GuidePreview | undefined>(
        Diagram, 'GuidePreview', undefined, MetaData.None);

    // A proposed arrangement to preview before committing (e.g. from a layout
    // inspector), or undefined for none. When set, the LayoutPreviewAdorner paints
    // an opaque preview of it over the live canvas (a faint block per node + a line
    // per edge). View-only, never persisted; the consumer clears it on apply/cancel.
    public static readonly LayoutPreviewKey = MuralBase.RegisterProperty<LayoutPreview | undefined>(
        Diagram, 'LayoutPreview', undefined, MetaData.None);

    // Selection-resize opt-in. Default off. When flipped true, a
    // SelectionBoundsAdorner mounts in the ItemsPanel's AdornerLayer
    // and drives resize gestures through DiagramSelectionSource (which
    // duck-types Width / Height writes through resolveKey).
    public static readonly SelectionResizeEnabledKey = MuralBase.RegisterProperty<boolean>(
        Diagram, 'SelectionResizeEnabled', false, MetaData.None);

    // Text-block adorner opt-in (§ diagram-text Slice 3). Default off. When
    // true, a TextBlockAdorner mounts in the ItemsPanel's AdornerLayer and
    // shows move / rotate handles over the single selected Figure's text
    // block, writing back to its ShapeText.Offset / Angle.
    public static readonly TextBlockAdornerEnabledKey = MuralBase.RegisterProperty<boolean>(
        Diagram, 'TextBlockAdornerEnabled', false, MetaData.None);

    // Connector-interactions opt-in. Default off. When flipped true, the
    // framework mounts a PortHandlesAdorner (port dots on Figure hover)
    // and an EditHandlesAdorner (endpoint + waypoint dots on selected
    // connectors), and wires Diagram-level pointer events into
    // ConnectorCreateBehavior + ConnectorEditAdorner state machines.
    // The DP is the consumer-facing toggle; the framework owns every
    // line of plumbing inside.
    public static readonly ConnectorInteractionsEnabledKey = MuralBase.RegisterProperty<boolean>(
        Diagram, 'ConnectorInteractionsEnabled', false, MetaData.None);

    // ── Input modes (§ diagram input modes) ─────────────────────────
    // Connectors mode gates the connector-interaction adorners: when it is NOT
    // active they don't react to the pointer (no port handles on figure hover,
    // no edit-handle drags), so figures aren't cluttered with every adorner at
    // once. The mode is ACTIVE when this DP is pinned true (a mode toggle button
    // — the consumer binds a ToolBarToggleButton's IsChecked to it) OR while the
    // user holds Ctrl (momentary). Default false — the connector layer is opt-in
    // per interaction, not always-on. The ConnectorInteractionsEnabled DP above
    // still gates whether the behavior is mounted at all; this gates its
    // reactivity within a mounted behavior.
    public static readonly ConnectorsModePinnedKey = MuralBase.RegisterProperty<boolean>(
        Diagram, 'ConnectorsModePinned', false, MetaData.None);

    // Format-painter mode. True while the Copy Format brush is loaded; a
    // ToolBarToggleButton binds its IsChecked here. The format-painter behavior
    // owns the transitions — capturing on true, dropping on false.
    public static readonly FormatPainterActiveKey = MuralBase.RegisterProperty<boolean>(
        Diagram, 'FormatPainterActive', false, MetaData.None);

    // Drop receiver — when set, Diagram attaches its canvas-drop
    // behavior to this Visual (typically the surrounding Border or
    // ScrollViewer). Bound declaratively from markup so the consumer
    // doesn't have to call attachCanvasDropBehavior from a view-mount
    // callback. Setting to undefined detaches.
    //
    // The receiver MUST be on the bubble path of every legitimate drop
    // location — a naive Diagram receiver misses drops on the
    // scrollbar (which lives outside Diagram's visual subtree), so the
    // typical wiring is `DropReceiver = $surface` against an enclosing
    // Border / ScrollViewer.
    public static readonly DropReceiverKey = MuralBase.RegisterProperty<Visual | undefined>(
        Diagram, 'DropReceiver', undefined, MetaData.None);

    // Mutation adapter — when set, Diagram subscribes its gesture
    // events (GroupRequested / UngroupRequested / CombineRequested /
    // DeleteRequested / ItemDropped) to the corresponding methods on
    // the adapter. Internalises the wiring that consumers used to do
    // by hand in their bootstrap. See attach-standard-mutations.ts.
    public static readonly MutatorKey = MuralBase.RegisterProperty<DiagramMutator | undefined>(
        Diagram, 'Mutator', undefined, MetaData.None);

    // Selection-reflection opt-in. When true, SelectionReflector mirrors
    // SelectedItems onto each item's `IsSelected` DP (duck-typed via
    // findDescriptor — items without IsSelected are skipped). Off by
    // default so plain Selector consumers without an IsSelected
    // convention pay nothing.
    public static readonly ReflectSelectionToItemsKey = MuralBase.RegisterProperty<boolean>(
        Diagram, 'ReflectSelectionToItems', false, MetaData.None);

    // Multi-target format mirror DPs — driven by FormatMirror. Seeded
    // from the first leaf in SelectedItems on every SelectionChanged;
    // edits to these DPs broadcast to every leaf in the flattened
    // selection. Duck-types on Fill / Stroke properties; items without
    // those (Groups, text-only labels) skip the broadcast.
    public static readonly SelectionFormatFillKey   = MuralBase.RegisterProperty<Brush | undefined>(
        Diagram, 'SelectionFormatFill',   undefined, MetaData.None);
    public static readonly SelectionFormatStrokeKey = MuralBase.RegisterProperty<Pen   | undefined>(
        Diagram, 'SelectionFormatStroke', undefined, MetaData.None);

    // Connector end-cap format channel. FormatMirror seeds these from the
    // first selected connector and broadcasts edits onto every selected
    // connector's Source/TargetCapTemplate. SelectionIsConnector is the
    // editor's "show the cap section" signal — true when the selection is
    // (entirely) connectors. The VALUE is the cap DataTemplate (undefined
    // = no cap at that end).
    public static readonly SelectionFormatSourceCapKey = MuralBase.RegisterProperty<DataTemplate | undefined>(
        Diagram, 'SelectionFormatSourceCap', undefined, MetaData.None);
    public static readonly SelectionFormatTargetCapKey = MuralBase.RegisterProperty<DataTemplate | undefined>(
        Diagram, 'SelectionFormatTargetCap', undefined, MetaData.None);
    public static readonly SelectionIsConnectorKey = MuralBase.RegisterProperty<boolean>(
        Diagram, 'SelectionIsConnector', false, MetaData.None);
    // Per-end cap size multipliers. FormatMirror seeds these from the first
    // selected connector's Source/TargetCapScale and broadcasts edits onto
    // every selected connector. 1 = the cap template's authored size.
    public static readonly SelectionFormatSourceCapScaleKey = MuralBase.RegisterProperty<number>(
        Diagram, 'SelectionFormatSourceCapScale', 1, MetaData.None);
    public static readonly SelectionFormatTargetCapScaleKey = MuralBase.RegisterProperty<number>(
        Diagram, 'SelectionFormatTargetCapScale', 1, MetaData.None);

    // Text-format channel. FormatMirror seeds these from the first selected
    // shape's Text and broadcasts edits onto every selected shape's Text:
    // TextAlignment is the paragraph alignment WITHIN the label block (the
    // "align text" toolbar), Placement is where the whole label sits WITHIN
    // the shape footprint (the "place label" toolbar). undefined = no shape
    // selected. The toolbars bind a ToolBarToggleButton's IsChecked through
    // `<< Is(TextAlignment.X)` / `<< Is(TextPlacement.X)` so exactly one
    // option shows active and clicking one writes it back here.
    public static readonly SelectionTextAlignmentKey = MuralBase.RegisterProperty<TextAlignment | undefined>(
        Diagram, 'SelectionTextAlignment', undefined, MetaData.None);
    public static readonly SelectionTextPlacementKey = MuralBase.RegisterProperty<TextPlacement | undefined>(
        Diagram, 'SelectionTextPlacement', undefined, MetaData.None);

    // Character-style channel — the text-style toolbar (font family / size /
    // colour + bold / italic / underline / strikethrough). FormatMirror seeds
    // these from the first selected shape's label (querying the caret run while
    // editing) and broadcasts edits onto every selected shape's label. The
    // family/size/colour DPs are plain primitives so the FontFamilyPicker.Text /
    // FontSizePicker.Value / ColorPicker.ColorHex bind directly; colour rides a
    // hex string (converted to/from a Brush at the ShapeText boundary). The four
    // decoration booleans drive ToolBarToggleButton.IsChecked.
    public static readonly SelectionFontFamilyKey   = MuralBase.RegisterProperty<string>(
        Diagram, 'SelectionFontFamily',   '', MetaData.None);
    public static readonly SelectionFontSizeKey     = MuralBase.RegisterProperty<number>(
        Diagram, 'SelectionFontSize',     12, MetaData.None);
    public static readonly SelectionFontColorHexKey = MuralBase.RegisterProperty<string>(
        Diagram, 'SelectionFontColorHex', '#000000', MetaData.None);
    public static readonly SelectionBoldKey          = MuralBase.RegisterProperty<boolean>(
        Diagram, 'SelectionBold',          false, MetaData.None);
    public static readonly SelectionItalicKey        = MuralBase.RegisterProperty<boolean>(
        Diagram, 'SelectionItalic',        false, MetaData.None);
    public static readonly SelectionUnderlineKey     = MuralBase.RegisterProperty<boolean>(
        Diagram, 'SelectionUnderline',     false, MetaData.None);
    public static readonly SelectionStrikethroughKey = MuralBase.RegisterProperty<boolean>(
        Diagram, 'SelectionStrikethrough', false, MetaData.None);

    public get PositionSnap():  DiagramPositionSnap | undefined { return this.get_property_value(Diagram.PositionSnapKey); }
    public set PositionSnap(v: DiagramPositionSnap | undefined) { this.set_property_value(Diagram.PositionSnapKey, v); }

    public get Zoom(): number { return this.get_property_value(Diagram.ZoomKey); }
    public set Zoom(v: number) { this.set_property_value(Diagram.ZoomKey, v); }

    // The camera as a value. SetCamera clamps zoom to the interactive range;
    // Fit uses the wider range via a direct DP write (see _applyFit).
    public get Camera(): Camera { return { zoom: this.Zoom, offsetX: this.ScrollX, offsetY: this.ScrollY }; }
    public SetCamera(c: Camera): void { this.Zoom = clampZoom(c.zoom); this.ScrollX = c.offsetX; this.ScrollY = c.offsetY; }

    // The enclosing ScrollViewer (PART_Scroll); pan lives on its scroll offset.
    public get ScrollHost(): ScrollViewer | undefined
    {
        return this.GetTemplateChild('PART_Scroll') as unknown as ScrollViewer | undefined;
    }
    public get ScrollX(): number { return this.ScrollHost?.HorizontalOffset ?? 0; }
    public set ScrollX(v: number) { const sh = this.ScrollHost; if (sh !== undefined) sh.HorizontalOffset = Math.max(0, v); }
    public get ScrollY(): number { return this.ScrollHost?.VerticalOffset ?? 0; }
    public set ScrollY(v: number) { const sh = this.ScrollHost; if (sh !== undefined) sh.VerticalOffset = Math.max(0, v); }

    // Host (viewport) point -> content (item) point. The ArrangedRect chain from
    // the items panel to the root already equals -offset (the SCP arranges its
    // content at -effectiveOffset), so dividing by Zoom (the LayoutTransform
    // scale) yields the content point. Single source of truth for the drop,
    // connector-hover, and figure-drag coordinate conversions.
    public HostToContent(hostX: number, hostY: number): Point
    {
        let ox = 0, oy = 0;
        let cur: Visual | undefined = this.ItemsPanelInstance;
        while (cur !== undefined) { ox += cur.ArrangedRect.X; oy += cur.ArrangedRect.Y; cur = cur.GetVisualParent(); }
        const z = this.Zoom || 1;
        return new Point((hostX - ox) / z, (hostY - oy) / z);
    }

    // The content coordinate at the viewport's top-left — the EFFECTIVE pan,
    // read from the live arrange rather than ScrollX/ScrollY. When one axis'
    // content fits the viewport, the ScrollViewer offset on that axis can stay
    // non-zero (stale/unclamped) while the content actually sits at 0; mapping
    // the scroll host's own screen origin through HostToContent recovers the true
    // visible edge on both axes. Rulers + the guide create-band use this so they
    // never trust a stale scroll offset.
    public VisibleContentOrigin(): Point
    {
        const sv = this.ScrollHost;
        const z = this.Zoom || 1;
        if (sv === undefined || this.ItemsPanelInstance === undefined)
            return new Point(this.ScrollX / z, this.ScrollY / z);
        let ax = 0, ay = 0;
        let cur: Visual | undefined = sv as unknown as Visual;
        while (cur !== undefined) { ax += cur.ArrangedRect.X; ay += cur.ArrangedRect.Y; cur = cur.GetVisualParent(); }
        return this.HostToContent(ax, ay);
    }

    public get ZoomInCommand():         RelayCommand | undefined { return this.get_property_value(Diagram.ZoomInCommandKey); }
    public get ZoomOutCommand():        RelayCommand | undefined { return this.get_property_value(Diagram.ZoomOutCommandKey); }
    public get ResetZoomCommand():      RelayCommand | undefined { return this.get_property_value(Diagram.ResetZoomCommandKey); }
    public get FitCommand():            RelayCommand | undefined { return this.get_property_value(Diagram.FitCommandKey); }
    public get FitToSelectionCommand(): RelayCommand | undefined { return this.get_property_value(Diagram.FitToSelectionCommandKey); }

    public get CameraEnabled(): boolean { return this.get_property_value(Diagram.CameraEnabledKey); }
    public set CameraEnabled(v: boolean) { this.set_property_value(Diagram.CameraEnabledKey, v); }

    private static readonly ZOOM_STEP = 1.2;
    private static readonly FIT_PADDING = 24;

    // Zoom about the viewport center by one step, clamped.
    public ZoomIn(): void  { this.SetCamera(zoomAtPoint(this.Camera, this._centerPivot(), Diagram.ZOOM_STEP)); }
    public ZoomOut(): void { this.SetCamera(zoomAtPoint(this.Camera, this._centerPivot(), 1 / Diagram.ZOOM_STEP)); }
    public ResetZoom(): void { this.SetCamera({ zoom: 1, offsetX: 0, offsetY: 0 }); }

    // Frame all content; Fit-to-Selection frames the selection (falling back to
    // all content when nothing is selected).
    public Fit(): void
    {
        const b = this.contentBounds();
        if (b !== undefined) this._applyFit(fitBounds(b, this._viewportSize(), Diagram.FIT_PADDING));
    }
    public FitToSelection(): void
    {
        const b = this.selectionBounds() ?? this.contentBounds();
        if (b !== undefined) this._applyFit(fitBounds(b, this._viewportSize(), Diagram.FIT_PADDING));
    }

    // Fit can legitimately produce a zoom below the interactive floor; bypass clampZoom.
    private _applyFit(c: Camera): void { this.Zoom = c.zoom; this.ScrollX = c.offsetX; this.ScrollY = c.offsetY; }
    private _centerPivot(): Point { const v = this._viewportSize(); return new Point(v.Width / 2, v.Height / 2); }

    private _viewportSize(): Size
    {
        if (this._testViewportSize !== undefined) return this._testViewportSize;
        const sv = this.GetTemplateChild('PART_Scroll') as unknown as { ViewportWidth?: number; ViewportHeight?: number } | undefined;
        return new Size(sv?.ViewportWidth ?? this.RenderSize.Width, sv?.ViewportHeight ?? this.RenderSize.Height);
    }

    // The selection's union bbox (content space) from the tracked Selection* DPs;
    // undefined when nothing is selected.
    private selectionBounds(): Rect | undefined
    {
        if (this.SelectionCount <= 0) return undefined;
        return new Rect(this.SelectionLeft, this.SelectionTop, this.SelectionWidth, this.SelectionHeight);
    }

    // Union of item-container ArrangedRects (content space); undefined when empty.
    private contentBounds(): Rect | undefined
    {
        if (this._testContentBounds !== undefined) return this._testContentBounds;
        const panel = this.ItemsPanelInstance;
        if (panel === undefined) return undefined;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const child of panel.visualChildren)
        {
            const r = child.ArrangedRect;
            if (r.Width === 0 && r.Height === 0) continue;
            minX = Math.min(minX, r.X); minY = Math.min(minY, r.Y);
            maxX = Math.max(maxX, r.X + r.Width); maxY = Math.max(maxY, r.Y + r.Height);
        }
        if (!isFinite(minX)) return undefined;
        return new Rect(minX, minY, maxX - minX, maxY - minY);
    }

    // @internal test seams — inject content/viewport where there is no live layout.
    private _testContentBounds?: Rect;
    private _testViewportSize?: Size;
    public _testContent(r: Rect | undefined): void { this._testContentBounds = r; }
    public _testViewport(w: number, h: number): void { this._testViewportSize = new Size(w, h); }

    public get SelectionLeft():   number { return this.get_property_value(Diagram.SelectionLeftKey); }
    public get SelectionTop():    number { return this.get_property_value(Diagram.SelectionTopKey); }
    public get SelectionWidth():  number { return this.get_property_value(Diagram.SelectionWidthKey); }
    public get SelectionHeight(): number { return this.get_property_value(Diagram.SelectionHeightKey); }
    public get SelectionCount():  number { return this.get_property_value(Diagram.SelectionCountKey); }

    public get HasSelectedShape(): boolean { return this.get_property_value(Diagram.HasSelectedShapeKey); }
    public get SelectedShapeLeft(): number { return this.get_property_value(Diagram.SelectedShapeLeftKey); }
    public set SelectedShapeLeft(v: number) { this.set_property_value(Diagram.SelectedShapeLeftKey, v); }
    public get SelectedShapeTop(): number { return this.get_property_value(Diagram.SelectedShapeTopKey); }
    public set SelectedShapeTop(v: number) { this.set_property_value(Diagram.SelectedShapeTopKey, v); }
    public get SelectedShapeWidth(): number { return this.get_property_value(Diagram.SelectedShapeWidthKey); }
    public set SelectedShapeWidth(v: number) { this.set_property_value(Diagram.SelectedShapeWidthKey, v); }
    public get SelectedShapeHeight(): number { return this.get_property_value(Diagram.SelectedShapeHeightKey); }
    public set SelectedShapeHeight(v: number) { this.set_property_value(Diagram.SelectedShapeHeightKey, v); }
    public get SelectedShapeRotation(): number { return this.get_property_value(Diagram.SelectedShapeRotationKey); }
    public set SelectedShapeRotation(v: number) { this.set_property_value(Diagram.SelectedShapeRotationKey, v); }
    public get SelectedShapeBaseWidth(): number { return this.get_property_value(Diagram.SelectedShapeBaseWidthKey); }
    public get SelectedShapeBaseHeight(): number { return this.get_property_value(Diagram.SelectedShapeBaseHeightKey); }
    public get SelectedShapeLockAspect(): boolean { return this.get_property_value(Diagram.SelectedShapeLockAspectKey); }
    public set SelectedShapeLockAspect(v: boolean) { this.set_property_value(Diagram.SelectedShapeLockAspectKey, v); }
    public get SelectedShapeAnchor(): PositionAnchor { return this.get_property_value(Diagram.SelectedShapeAnchorKey); }
    public set SelectedShapeAnchor(v: PositionAnchor) { this.set_property_value(Diagram.SelectedShapeAnchorKey, v); }

    public get AlignLeftCommand():   RelayCommand | undefined { return this.get_property_value(Diagram.AlignLeftCommandKey); }
    public get AlignRightCommand():  RelayCommand | undefined { return this.get_property_value(Diagram.AlignRightCommandKey); }
    public get AlignTopCommand():    RelayCommand | undefined { return this.get_property_value(Diagram.AlignTopCommandKey); }
    public get AlignMiddleCommand(): RelayCommand | undefined { return this.get_property_value(Diagram.AlignMiddleCommandKey); }
    public get AlignCenterCommand(): RelayCommand | undefined { return this.get_property_value(Diagram.AlignCenterCommandKey); }

    public get BringToFrontCommand(): RelayCommand | undefined { return this.get_property_value(Diagram.BringToFrontCommandKey); }
    public get SendToBackCommand():   RelayCommand | undefined { return this.get_property_value(Diagram.SendToBackCommandKey); }
    public get BringForwardCommand(): RelayCommand | undefined { return this.get_property_value(Diagram.BringForwardCommandKey); }
    public get SendBackwardCommand(): RelayCommand | undefined { return this.get_property_value(Diagram.SendBackwardCommandKey); }

    public get DistributeHorizontalCommand(): RelayCommand | undefined { return this.get_property_value(Diagram.DistributeHorizontalCommandKey); }
    public get DistributeVerticalCommand():   RelayCommand | undefined { return this.get_property_value(Diagram.DistributeVerticalCommandKey); }

    public get GroupCommand():   RelayCommand | undefined { return this.get_property_value(Diagram.GroupCommandKey); }
    public get UngroupCommand(): RelayCommand | undefined { return this.get_property_value(Diagram.UngroupCommandKey); }
    public get CopyFormatCommand(): RelayCommand | undefined { return this.get_property_value(Diagram.CopyFormatCommandKey); }
    public get CopyCommand():  RelayCommand | undefined { return this.get_property_value(Diagram.CopyCommandKey); }
    public get CutCommand():   RelayCommand | undefined { return this.get_property_value(Diagram.CutCommandKey); }
    public get PasteCommand(): RelayCommand | undefined { return this.get_property_value(Diagram.PasteCommandKey); }
    public get WrapInContainerCommand(): RelayCommand | undefined { return this.get_property_value(Diagram.WrapInContainerCommandKey); }
    public get UnwrapContainerCommand(): RelayCommand | undefined { return this.get_property_value(Diagram.UnwrapContainerCommandKey); }

    public get CombineUnionCommand():     RelayCommand | undefined { return this.get_property_value(Diagram.CombineUnionCommandKey); }
    public get CombineIntersectCommand(): RelayCommand | undefined { return this.get_property_value(Diagram.CombineIntersectCommandKey); }
    public get CombineSubtractCommand():  RelayCommand | undefined { return this.get_property_value(Diagram.CombineSubtractCommandKey); }
    public get CombineExcludeCommand():   RelayCommand | undefined { return this.get_property_value(Diagram.CombineExcludeCommandKey); }

    public get SetTextAlignLeftCommand():    RelayCommand | undefined { return this.get_property_value(Diagram.SetTextAlignLeftCommandKey); }
    public get SetTextAlignCenterCommand():  RelayCommand | undefined { return this.get_property_value(Diagram.SetTextAlignCenterCommandKey); }
    public get SetTextAlignRightCommand():   RelayCommand | undefined { return this.get_property_value(Diagram.SetTextAlignRightCommandKey); }
    public get SetTextAlignJustifyCommand(): RelayCommand | undefined { return this.get_property_value(Diagram.SetTextAlignJustifyCommandKey); }

    public get SetTextPlacementCenterCommand():      RelayCommand | undefined { return this.get_property_value(Diagram.SetTextPlacementCenterCommandKey); }
    public get SetTextPlacementTopCommand():         RelayCommand | undefined { return this.get_property_value(Diagram.SetTextPlacementTopCommandKey); }
    public get SetTextPlacementBottomCommand():      RelayCommand | undefined { return this.get_property_value(Diagram.SetTextPlacementBottomCommandKey); }
    public get SetTextPlacementLeftCommand():        RelayCommand | undefined { return this.get_property_value(Diagram.SetTextPlacementLeftCommandKey); }
    public get SetTextPlacementRightCommand():       RelayCommand | undefined { return this.get_property_value(Diagram.SetTextPlacementRightCommandKey); }
    public get SetTextPlacementTopLeftCommand():     RelayCommand | undefined { return this.get_property_value(Diagram.SetTextPlacementTopLeftCommandKey); }
    public get SetTextPlacementTopRightCommand():    RelayCommand | undefined { return this.get_property_value(Diagram.SetTextPlacementTopRightCommandKey); }
    public get SetTextPlacementBottomLeftCommand():  RelayCommand | undefined { return this.get_property_value(Diagram.SetTextPlacementBottomLeftCommandKey); }
    public get SetTextPlacementBottomRightCommand(): RelayCommand | undefined { return this.get_property_value(Diagram.SetTextPlacementBottomRightCommandKey); }

    public get SetTextBoldCommand():          RelayCommand | undefined { return this.get_property_value(Diagram.SetTextBoldCommandKey); }
    public get SetTextItalicCommand():        RelayCommand | undefined { return this.get_property_value(Diagram.SetTextItalicCommandKey); }
    public get SetTextUnderlineCommand():     RelayCommand | undefined { return this.get_property_value(Diagram.SetTextUnderlineCommandKey); }
    public get SetTextStrikethroughCommand(): RelayCommand | undefined { return this.get_property_value(Diagram.SetTextStrikethroughCommandKey); }
    public get IncreaseFontSizeCommand(): RelayCommand | undefined { return this.get_property_value(Diagram.IncreaseFontSizeCommandKey); }
    public get DecreaseFontSizeCommand(): RelayCommand | undefined { return this.get_property_value(Diagram.DecreaseFontSizeCommandKey); }

    public get Connectors(): ObservableCollection<MuralBase> | undefined { return this.get_property_value(Diagram.ConnectorsKey); }
    public set Connectors(v: ObservableCollection<MuralBase> | undefined) { this.set_property_value(Diagram.ConnectorsKey, v); }

    /** @see RigidConnectorDragHost — drives the internal-connector rigid
     *  translate for a multi-selection drag. Snapshots every connector
     *  whose BOTH endpoint nodes are in `movingSet` AND that carries user
     *  waypoints; a boundary connector (one end in the set) is left to its
     *  normal per-figure reroute, and a pure auto-routed internal one
     *  already translation-invariantly recomputes, so neither is tracked. */
    public BeginRigidConnectorDrag(movingSet: ReadonlySet<MuralBase>): RigidConnectorDragSession | undefined
    {
        const connectors = this.Connectors;
        if (connectors === undefined) return undefined;
        const tracked: { connector: Connector; snapshot: readonly RouteWaypoint[] }[] = [];
        for (let i = 0; i < connectors.Count; i++)
        {
            const c = connectors.Get(i);
            if (!(c instanceof Connector)) continue;
            const wps = c.Waypoints;
            if (!hasPinned(wps)) continue;   // only pins need rigid carry; auto re-minimises on the per-figure reroute
            const sn = c.Source?.Node;
            const tn = c.Target?.Node;
            if (sn === undefined || tn === undefined) continue;
            if (!movingSet.has(sn) || !movingSet.has(tn)) continue; // internal only
            tracked.push({ connector: c, snapshot: wps!.slice() });
        }
        if (tracked.length === 0) return undefined;

        let totalDx = 0;
        let totalDy = 0;
        return {
            Translate: (dx: number, dy: number): void => {
                totalDx += dx;
                totalDy += dy;
                for (const t of tracked)
                {
                    t.connector.Waypoints = t.snapshot.map(w =>
                        waypoint(new Point(w.point.X + totalDx, w.point.Y + totalDy), w.userAltered));
                }
            },
            End: (): void => { tracked.length = 0; },
        };
    }
    public get ConnectorTemplate(): DataTemplate | undefined { return this.get_property_value(Diagram.ConnectorTemplateKey); }
    public set ConnectorTemplate(v: DataTemplate | undefined) { this.set_property_value(Diagram.ConnectorTemplateKey, v); }

    public get AlignmentGuidesEnabled():  boolean { return this.get_property_value(Diagram.AlignmentGuidesEnabledKey); }
    public set AlignmentGuidesEnabled(v: boolean) { this.set_property_value(Diagram.AlignmentGuidesEnabledKey, v); }

    public get Guides(): readonly PersistentGuide[] { return this.get_property_value(Diagram.GuidesKey); }
    public set Guides(v: readonly PersistentGuide[]) { this.set_property_value(Diagram.GuidesKey, v); }

    public get LayoutPreview(): LayoutPreview | undefined { return this.get_property_value(Diagram.LayoutPreviewKey); }
    public set LayoutPreview(v: LayoutPreview | undefined) { this.set_property_value(Diagram.LayoutPreviewKey, v); }

    public get RulersVisible(): boolean { return this.get_property_value(Diagram.RulersVisibleKey); }
    public set RulersVisible(v: boolean) { this.set_property_value(Diagram.RulersVisibleKey, v); }

    public get SelectedGuide(): number { return this.get_property_value(Diagram.SelectedGuideKey); }
    public set SelectedGuide(v: number) { this.set_property_value(Diagram.SelectedGuideKey, v); }

    public get GuidePreview(): GuidePreview | undefined { return this.get_property_value(Diagram.GuidePreviewKey); }
    public set GuidePreview(v: GuidePreview | undefined) { this.set_property_value(Diagram.GuidePreviewKey, v); }
    public get SelectionResizeEnabled():  boolean { return this.get_property_value(Diagram.SelectionResizeEnabledKey); }
    public set SelectionResizeEnabled(v: boolean) { this.set_property_value(Diagram.SelectionResizeEnabledKey, v); }
    public get TextBlockAdornerEnabled():  boolean { return this.get_property_value(Diagram.TextBlockAdornerEnabledKey); }
    public set TextBlockAdornerEnabled(v: boolean) { this.set_property_value(Diagram.TextBlockAdornerEnabledKey, v); }
    public get ConnectorInteractionsEnabled():  boolean { return this.get_property_value(Diagram.ConnectorInteractionsEnabledKey); }
    public set ConnectorInteractionsEnabled(v: boolean) { this.set_property_value(Diagram.ConnectorInteractionsEnabledKey, v); }
    public get ConnectorsModePinned():  boolean { return this.get_property_value(Diagram.ConnectorsModePinnedKey); }
    public set ConnectorsModePinned(v: boolean) { this.set_property_value(Diagram.ConnectorsModePinnedKey, v); }
    public get FormatPainterActive():  boolean { return this.get_property_value(Diagram.FormatPainterActiveKey); }
    public set FormatPainterActive(v: boolean) { this.set_property_value(Diagram.FormatPainterActiveKey, v); }
    public get ReflectSelectionToItems():  boolean { return this.get_property_value(Diagram.ReflectSelectionToItemsKey); }
    public set ReflectSelectionToItems(v: boolean) { this.set_property_value(Diagram.ReflectSelectionToItemsKey, v); }
    public get DropReceiver():  Visual | undefined { return this.get_property_value(Diagram.DropReceiverKey); }
    public set DropReceiver(v: Visual | undefined) { this.set_property_value(Diagram.DropReceiverKey, v); }
    public get Mutator():  DiagramMutator | undefined { return this.get_property_value(Diagram.MutatorKey); }
    public set Mutator(v: DiagramMutator | undefined) { this.set_property_value(Diagram.MutatorKey, v); }
    public get SelectionFormatFill():    Brush | undefined { return this.get_property_value(Diagram.SelectionFormatFillKey); }
    public set SelectionFormatFill(v:    Brush | undefined) { this.set_property_value(Diagram.SelectionFormatFillKey, v); }
    public get SelectionFormatStroke():  Pen   | undefined { return this.get_property_value(Diagram.SelectionFormatStrokeKey); }
    public set SelectionFormatStroke(v:  Pen   | undefined) { this.set_property_value(Diagram.SelectionFormatStrokeKey, v); }
    public get SelectionFormatSourceCap(): DataTemplate | undefined { return this.get_property_value(Diagram.SelectionFormatSourceCapKey); }
    public set SelectionFormatSourceCap(v: DataTemplate | undefined) { this.set_property_value(Diagram.SelectionFormatSourceCapKey, v); }
    public get SelectionFormatTargetCap(): DataTemplate | undefined { return this.get_property_value(Diagram.SelectionFormatTargetCapKey); }
    public set SelectionFormatTargetCap(v: DataTemplate | undefined) { this.set_property_value(Diagram.SelectionFormatTargetCapKey, v); }
    public get SelectionIsConnector():   boolean { return this.get_property_value(Diagram.SelectionIsConnectorKey); }
    public set SelectionIsConnector(v:   boolean) { this.set_property_value(Diagram.SelectionIsConnectorKey, v); }
    public get SelectionFormatSourceCapScale(): number { return this.get_property_value(Diagram.SelectionFormatSourceCapScaleKey); }
    public set SelectionFormatSourceCapScale(v: number) { this.set_property_value(Diagram.SelectionFormatSourceCapScaleKey, v); }
    public get SelectionFormatTargetCapScale(): number { return this.get_property_value(Diagram.SelectionFormatTargetCapScaleKey); }
    public set SelectionFormatTargetCapScale(v: number) { this.set_property_value(Diagram.SelectionFormatTargetCapScaleKey, v); }
    public get SelectionTextAlignment(): TextAlignment | undefined { return this.get_property_value(Diagram.SelectionTextAlignmentKey); }
    public set SelectionTextAlignment(v: TextAlignment | undefined) { this.set_property_value(Diagram.SelectionTextAlignmentKey, v); }
    public get SelectionTextPlacement(): TextPlacement | undefined { return this.get_property_value(Diagram.SelectionTextPlacementKey); }
    public set SelectionTextPlacement(v: TextPlacement | undefined) { this.set_property_value(Diagram.SelectionTextPlacementKey, v); }

    // Force-apply a paragraph alignment / label placement to every selected
    // shape's label, and reflect it on the Selection* DP. The text-format
    // commands route through here (rather than a bare DP write) so the value is
    // re-applied even when the reflected DP already equals it — a plain
    // SelectionText* set would no-op-broadcast in that case. Public so a
    // consumer can drive the text toolbars programmatically without owning a
    // command; the framework's own commands call the same path.
    public ApplySelectionTextAlignment(align: TextAlignment): void { this._formatMirror.ApplyTextAlignment(align); }
    public ApplySelectionTextPlacement(placement: TextPlacement): void { this._formatMirror.ApplyTextPlacement(placement); }

    public get SelectionFontFamily():   string  { return this.get_property_value(Diagram.SelectionFontFamilyKey); }
    public set SelectionFontFamily(v:   string) { this.set_property_value(Diagram.SelectionFontFamilyKey, v); }
    public get SelectionFontSize():     number  { return this.get_property_value(Diagram.SelectionFontSizeKey); }
    public set SelectionFontSize(v:     number) { this.set_property_value(Diagram.SelectionFontSizeKey, v); }
    public get SelectionFontColorHex(): string  { return this.get_property_value(Diagram.SelectionFontColorHexKey); }
    public set SelectionFontColorHex(v: string) { this.set_property_value(Diagram.SelectionFontColorHexKey, v); }
    public get SelectionBold():          boolean { return this.get_property_value(Diagram.SelectionBoldKey); }
    public set SelectionBold(v:          boolean) { this.set_property_value(Diagram.SelectionBoldKey, v); }
    public get SelectionItalic():        boolean { return this.get_property_value(Diagram.SelectionItalicKey); }
    public set SelectionItalic(v:        boolean) { this.set_property_value(Diagram.SelectionItalicKey, v); }
    public get SelectionUnderline():     boolean { return this.get_property_value(Diagram.SelectionUnderlineKey); }
    public set SelectionUnderline(v:     boolean) { this.set_property_value(Diagram.SelectionUnderlineKey, v); }
    public get SelectionStrikethrough(): boolean { return this.get_property_value(Diagram.SelectionStrikethroughKey); }
    public set SelectionStrikethrough(v: boolean) { this.set_property_value(Diagram.SelectionStrikethroughKey, v); }

    // Force-apply a character format to every selected label (edit mode targets
    // the selected text run(s)), and reflect it on the Selection* DP. The
    // decoration toggle commands route through here. Booleans always change the
    // DP on toggle, but font/size/colour may not — so these bypass the
    // DP-change gate like the alignment/placement force-apply.
    public ApplySelectionBold(on: boolean): void { this._formatMirror.ApplyBold(on); }
    public ApplySelectionItalic(on: boolean): void { this._formatMirror.ApplyItalic(on); }
    public ApplySelectionUnderline(on: boolean): void { this._formatMirror.ApplyUnderline(on); }
    public ApplySelectionStrikethrough(on: boolean): void { this._formatMirror.ApplyStrikethrough(on); }
    public ApplySelectionFontFamily(family: string): void { this._formatMirror.ApplyFontFamily(family); }
    public ApplySelectionFontSize(size: number): void { this._formatMirror.ApplyFontSize(size); }
    public ApplySelectionFontColorHex(hex: string): void { this._formatMirror.ApplyFontColorHex(hex); }

    // Step every selected label's own font size by `delta` points (the caret run
    // while editing), then reflect the first shape's new size on the DP.
    public BumpSelectionFontSize(delta: number): void { this._formatMirror.BumpFontSize(delta); }

    // Standard connector-cap dropdown list for a ShapeFormatControl's
    // CapOptions DP. A real DP (not a plain getter) so a markup binding
    // `CapOptions=$diagram.ConnectorCapOptions` resolves — ElementName /
    // DataContext bindings only walk registered properties. Populated in
    // the ctor; each option resolves its cap template lazily, so building
    // the list before the cap catalog is registered is fine. Convenience
    // only — the editor itself is cap-agnostic.
    public static readonly ConnectorCapOptionsKey = MuralBase.RegisterProperty<readonly CapOption[]>(
        Diagram, 'ConnectorCapOptions', EMPTY_CAP_OPTIONS, MetaData.None);
    public get ConnectorCapOptions(): readonly CapOption[] { return this.get_property_value(Diagram.ConnectorCapOptionsKey); }
    public get AlignmentGuides(): readonly AlignmentGuide[] { return this.get_property_value(Diagram.AlignmentGuidesKey); }
    /** @internal — used by AlignmentGuidesBehavior to drive the read-only DP. */
    public _setAlignmentGuides(guides: readonly AlignmentGuide[]): void
    {
        this.set_property_value_with_key(Diagram.AlignmentGuidesKey, guides);
    }

    // Subscriber-pattern event API for Group / Ungroup requests. Same
    // shape as Selector.AddSelectionChangedListener. The framework's
    // KNOWN_ROUTED_EVENTS Set is reserved for input events that bubble;
    // these are control-specific domain events that don't need the
    // routing pipeline.
    private readonly _groupRequestedListeners:   Set<GroupRequestedListener>   = new Set();
    private readonly _ungroupRequestedListeners: Set<UngroupRequestedListener> = new Set();

    public AddGroupRequestedListener   (listener: GroupRequestedListener):   void { this._groupRequestedListeners.add(listener); }
    public RemoveGroupRequestedListener(listener: GroupRequestedListener):   void { this._groupRequestedListeners.delete(listener); }
    public AddUngroupRequestedListener   (listener: UngroupRequestedListener): void { this._ungroupRequestedListeners.add(listener); }
    public RemoveUngroupRequestedListener(listener: UngroupRequestedListener): void { this._ungroupRequestedListeners.delete(listener); }

    private readonly _wrapRequestedListeners:   Set<WrapRequestedListener>   = new Set();
    private readonly _unwrapRequestedListeners: Set<UnwrapRequestedListener> = new Set();
    public AddWrapRequestedListener   (listener: WrapRequestedListener):   void { this._wrapRequestedListeners.add(listener); }
    public RemoveWrapRequestedListener(listener: WrapRequestedListener):   void { this._wrapRequestedListeners.delete(listener); }
    public AddUnwrapRequestedListener   (listener: UnwrapRequestedListener): void { this._unwrapRequestedListeners.add(listener); }
    public RemoveUnwrapRequestedListener(listener: UnwrapRequestedListener): void { this._unwrapRequestedListeners.delete(listener); }

    private readonly _nodeReparentedListeners: Set<NodeReparentedListener> = new Set();
    public AddNodeReparentedListener   (listener: NodeReparentedListener): void { this._nodeReparentedListeners.add(listener); }
    public RemoveNodeReparentedListener(listener: NodeReparentedListener): void { this._nodeReparentedListeners.delete(listener); }

    private readonly _combineRequestedListeners: Set<CombineRequestedListener> = new Set();
    public AddCombineRequestedListener   (listener: CombineRequestedListener): void { this._combineRequestedListeners.add(listener); }
    public RemoveCombineRequestedListener(listener: CombineRequestedListener): void { this._combineRequestedListeners.delete(listener); }

    private readonly _itemDroppedListeners: Set<ItemDroppedListener> = new Set();
    public AddItemDroppedListener   (listener: ItemDroppedListener): void { this._itemDroppedListeners.add(listener); }
    public RemoveItemDroppedListener(listener: ItemDroppedListener): void { this._itemDroppedListeners.delete(listener); }

    private readonly _externalDroppedListeners: Set<ExternalDroppedListener> = new Set();
    public AddExternalDroppedListener   (listener: ExternalDroppedListener): void { this._externalDroppedListeners.add(listener); }
    public RemoveExternalDroppedListener(listener: ExternalDroppedListener): void { this._externalDroppedListeners.delete(listener); }

    private readonly _deleteRequestedListeners: Set<DeleteRequestedListener> = new Set();
    public AddDeleteRequestedListener   (listener: DeleteRequestedListener): void { this._deleteRequestedListeners.add(listener); }
    public RemoveDeleteRequestedListener(listener: DeleteRequestedListener): void { this._deleteRequestedListeners.delete(listener); }

    private readonly _connectorCreatedListeners: Set<ConnectorCreatedListener> = new Set();
    public AddConnectorCreatedListener   (listener: ConnectorCreatedListener): void { this._connectorCreatedListeners.add(listener); }
    public RemoveConnectorCreatedListener(listener: ConnectorCreatedListener): void { this._connectorCreatedListeners.delete(listener); }

    private readonly _copyRequestedListeners: Set<CopyRequestedListener> = new Set();
    public AddCopyRequestedListener   (listener: CopyRequestedListener): void { this._copyRequestedListeners.add(listener); }
    public RemoveCopyRequestedListener(listener: CopyRequestedListener): void { this._copyRequestedListeners.delete(listener); }

    private readonly _pasteRequestedListeners: Set<PasteRequestedListener> = new Set();
    public AddPasteRequestedListener   (listener: PasteRequestedListener): void { this._pasteRequestedListeners.add(listener); }
    public RemovePasteRequestedListener(listener: PasteRequestedListener): void { this._pasteRequestedListeners.delete(listener); }

    // Undo / Redo intent — the consumer's mutator owns the history stack. Fired by
    // Ctrl+Z / Ctrl+Shift+Z; attach-standard-mutations forwards to mutator.Undo/Redo.
    private readonly _undoRequestedListeners: Set<() => void> = new Set();
    public AddUndoRequestedListener   (listener: () => void): void { this._undoRequestedListeners.add(listener); }
    public RemoveUndoRequestedListener(listener: () => void): void { this._undoRequestedListeners.delete(listener); }

    private readonly _redoRequestedListeners: Set<() => void> = new Set();
    public AddRedoRequestedListener   (listener: () => void): void { this._redoRequestedListeners.add(listener); }
    public RemoveRedoRequestedListener(listener: () => void): void { this._redoRequestedListeners.delete(listener); }

    // Edit bracket — routes to the mutator's undo/redo history (set by
    // attach-standard-mutations). Every MUTATING event dispatch is wrapped so all
    // its listeners (the standard mutator AND, e.g., the Plexus arch binding) land
    // in one history transaction. No-op when no bracket is set (e.g. headless).
    private _editBracket: { begin(label: string): void; end(): void } | undefined;
    /** @internal — set by attach-standard-mutations from the mutator's history. */
    public _setEditBracket(b: { begin(label: string): void; end(): void } | undefined): void { this._editBracket = b; }
    /** @internal — open a history transaction (used by fire helpers + interaction behaviors). */
    public _beginEdit(label: string): void { this._editBracket?.begin(label); }
    /** @internal — close the history transaction. */
    public _endEdit(): void { this._editBracket?.end(); }
    private _bracketed(label: string, fn: () => void): void
    {
        this._beginEdit(label);
        try { fn(); }
        finally { this._endEdit(); }
    }

    // Internal fire helpers — invoked by DiagramCommands when the
    // corresponding RelayCommand's Execute runs. Snapshot-then-iterate
    // so a listener that registers / unregisters mid-fire doesn't
    // mutate the Set under iteration. Mutating dispatches are bracketed
    // into one history transaction; read-only Copy is not.
    /** @internal */
    public _fireGroupRequested(args: GroupRequestedArgs): void
    {
        this._bracketed('Group', () => { for (const l of [...this._groupRequestedListeners]) l(args); });
    }

    /** @internal */
    public _fireUngroupRequested(args: UngroupRequestedArgs): void
    {
        this._bracketed('Ungroup', () => { for (const l of [...this._ungroupRequestedListeners]) l(args); });
    }

    /** @internal */
    public _fireWrapRequested(args: WrapRequestedArgs): void
    {
        this._bracketed('Wrap', () => { for (const l of [...this._wrapRequestedListeners]) l(args); });
    }

    /** @internal */
    public _fireUnwrapRequested(args: UnwrapRequestedArgs): void
    {
        this._bracketed('Unwrap', () => { for (const l of [...this._unwrapRequestedListeners]) l(args); });
    }

    /** @internal */
    public _fireNodeReparented(args: NodeReparentedArgs): void
    {
        this._bracketed('Reparent', () => { for (const l of [...this._nodeReparentedListeners]) l(args); });
    }

    /** @internal */
    public _fireCombineRequested(args: CombineRequestedArgs): void
    {
        this._bracketed('Combine', () => { for (const l of [...this._combineRequestedListeners]) l(args); });
    }

    /** @internal */
    public _fireItemDropped(args: ItemDroppedArgs): void
    {
        this._bracketed('Drop', () => { for (const l of [...this._itemDroppedListeners]) l(args); });
    }

    /** @internal */
    public _fireExternalDropped(args: ExternalDroppedArgs): void
    {
        this._bracketed('Drop', () => { for (const l of [...this._externalDroppedListeners]) l(args); });
    }

    /** @internal */
    public _fireDeleteRequested(args: DeleteRequestedArgs): void
    {
        this._bracketed('Delete', () => { for (const l of [...this._deleteRequestedListeners]) l(args); });
    }

    /** @internal */
    public _fireConnectorCreated(args: ConnectorCreatedArgs): void
    {
        this._bracketed('Connect', () => { for (const l of [...this._connectorCreatedListeners]) l(args); });
    }

    /** @internal */
    public _fireCopyRequested(args: CopyRequestedArgs): void
    {
        for (const l of [...this._copyRequestedListeners]) l(args);
    }

    /** @internal */
    public _firePasteRequested(args: PasteRequestedArgs): void
    {
        this._bracketed('Paste', () => { for (const l of [...this._pasteRequestedListeners]) l(args); });
    }

    // Undo / Redo are NOT bracketed — the history runs them under its own
    // suppression so a restore never records a new transaction.
    /** @internal */
    public _requestUndo(): void { for (const l of [...this._undoRequestedListeners]) l(); }
    /** @internal */
    public _requestRedo(): void { for (const l of [...this._redoRequestedListeners]) l(); }

    // Copy / Cut / Paste intent — invoked by the keyboard shortcuts and the
    // Copy / Cut / Paste commands. Copy + Cut snapshot the current selection;
    // Cut additionally fires Delete (the consumer's mutator removes the
    // originals). Paste asks the consumer to materialize the clipboard.
    /** @internal */
    public _requestCopy(): void
    {
        if (this.SelectedItems.length === 0 && this.SelectedConnectors.length === 0) return;
        this._fireCopyRequested({ Items: [...this.SelectedItems], Connectors: [...this.SelectedConnectors] });
    }

    /** @internal */
    public _requestCut(): void
    {
        if (this.SelectedItems.length === 0 && this.SelectedConnectors.length === 0) return;
        const items = [...this.SelectedItems];
        const connectors = [...this.SelectedConnectors];
        this._fireCopyRequested({ Items: items, Connectors: connectors });
        this._fireDeleteRequested({ Items: items, Connectors: connectors, Shift: false });
    }

    /** @internal */
    public _requestPaste(): void
    {
        this._firePasteRequested({});
    }

    // Alignment-guides attach state. `_alignmentGuidesDetach` holds the
    // behavior's detach thunk when active; undefined when disabled.
    // `_alignmentGuidesAdorner` is the mounted adorner instance when
    // present; undefined when disabled OR when the ItemsPanel doesn't
    // have an AdornerLayer yet (the adorner mount is deferred via
    // queueMicrotask to handle the common case of consumers setting
    // the DP before the layout pass has materialized the ItemsPanel).
    private _alignmentGuidesDetach:  (() => void) | undefined = undefined;
    private _alignmentGuidesAdorner: AlignmentGuidesAdorner | undefined = undefined;

    // Persistent-guides (ruler) state: the behavior's detach thunk, the mounted
    // adorner, and the camera-feed detach that keeps the rulers tracking zoom/pan.
    // All undefined when RulersVisible is false; queueMicrotask-deferred mount
    // handles the DP flipping before ItemsPanel materializes.
    private _persistentGuidesDetach:  (() => void) | undefined = undefined;
    private _persistentGuidesAdorner: PersistentGuidesAdorner | undefined = undefined;
    private _layoutPreviewAdorner: LayoutPreviewAdorner | undefined = undefined;
    private _rulerCameraDetach:       (() => void) | undefined = undefined;

    // Selection-resize state — adorner instance + the source that
    // drives its resize semantics. undefined when SelectionResizeEnabled
    // is false; queueMicrotask-deferred mount handles the case where
    // the DP flips before ItemsPanel materializes.
    private _selectionResizeAdorner: SelectionBoundsAdorner | undefined = undefined;
    private _selectionResizeSource:  DiagramSelectionSource | undefined = undefined;

    // Text-block adorner state — instance when mounted; queueMicrotask-
    // deferred mount handles the DP flipping before ItemsPanel materializes.
    private _textBlockAdorner: TextBlockAdorner | undefined = undefined;

    // Connector-interactions detach thunk — set when the behavior is
    // attached, called + cleared on detach. The behavior owns its own
    // adorner mount / unmount internally; one slot here is enough.
    private _connectorInteractionsDetach: (() => void) | undefined = undefined;

    // Connector-interactions preview-pointer interceptor. Figure's
    // OnPointerDown / Move / Up all set args.Handled = true, which
    // short-circuits the bubble route walk before any Diagram-level
    // routed listener fires. The connector-interactions behavior
    // installs here so its handler runs in the TUNNEL phase (root →
    // target, before the descendant Figure consumes the event). The
    // four methods mirror the framework's pointer virtual conventions.
    private _connectorInteractionsHandlers: ConnectorInteractionsHandlers | undefined = undefined;
    /** @internal — used by attachConnectorInteractions in the framework's
     *  connector-interactions behavior. Not exposed publicly. */
    public _setConnectorInteractionsHandlers(h: ConnectorInteractionsHandlers | undefined): void
    {
        this._connectorInteractionsHandlers = h;
    }

    // Alignment-guides preview-pointer interceptor. Same reason as the
    // connector one above: Figure.OnPointer* set args.Handled, so the
    // alignment behavior must observe drag start / end in the TUNNEL phase.
    // Installed by attachAlignmentGuides, withdrawn on detach.
    private _alignmentGuidesHandlers: AlignmentGuidesHandlers | undefined = undefined;
    /** @internal — used by attachAlignmentGuides. Not exposed publicly. */
    public _setAlignmentGuidesHandlers(h: AlignmentGuidesHandlers | undefined): void
    {
        this._alignmentGuidesHandlers = h;
    }

    // Persistent-guides preview-pointer interceptor — same tunnel-phase reason as
    // the alignment + connector interceptors. Installed by attachPersistentGuides.
    private _persistentGuidesHandlers: PersistentGuidesHandlers | undefined = undefined;
    /** @internal — used by attachPersistentGuides. Not exposed publicly. */
    public _setPersistentGuidesHandlers(h: PersistentGuidesHandlers | undefined): void
    {
        this._persistentGuidesHandlers = h;
    }

    // Format-painter preview-pointer + key interceptor — tunnel phase so a paint
    // click pre-empts the Figure's select-on-click. Installed by attachFormatPainter.
    private _formatPainterHandlers: FormatPainterHandlers | undefined = undefined;
    /** @internal — used by attachFormatPainter. Not exposed publicly. */
    public _setFormatPainterHandlers(h: FormatPainterHandlers | undefined): void
    {
        this._formatPainterHandlers = h;
    }

    // Drop-receiver / Mutator attach state — detach thunks for whichever
    // receiver / mutator is currently wired. Swapped out on DP change so
    // the previous wiring releases its listeners.
    private _dropReceiverDetach:  (() => void) | undefined = undefined;
    private _mutatorDetach:       (() => void) | undefined = undefined;

    // Tracks a Mutator value that THIS Diagram installed via
    // DataContext-auto-wire (see _autoWireMutator). When the consumer
    // overrides Mutator explicitly, this clears so the override stays
    // sticky across DataContext swaps.
    private _autoWiredMutator:    DiagramMutator | undefined = undefined;

    // The DataContext we published ourselves onto (its ActiveView === this).
    // Tracked so a DataContext swap clears the stale back-reference rather than
    // leaving a dead control pinned on a document nobody presents.
    private _publishedViewHost:   IDiagramViewHost | undefined = undefined;

    // Connectors materializer collaborator. Held as a field so the
    // OnPropertyChanged handler for the Connectors / ConnectorTemplate
    // DPs can forward the change.
    private readonly _connectorsMaterializer: DiagramConnectorsMaterializer;

    // Text-format mirror collaborator. Held so the text-format commands can
    // force-apply their value to the whole selection (bypassing the DP-change
    // gate, so a command re-applies even when the reflected DP already equals
    // the target — e.g. a mixed multi-selection, or a standalone Plexus button).
    private readonly _formatMirror: FormatMirror;

    // Container nesting collaborator: re-parents child Figures into their
    // container's ChildHost per ParentId. Held so the drag-in/out path and
    // wrap/unwrap commands can drive reparent() / query containerAt().
    private readonly _containerPlacement: ContainerPlacement;
    public get ContainerPlacement(): ContainerPlacement { return this._containerPlacement; }

    /** @internal — testing hook for the materialized item → Visual map. */
    public _getConnectorsMaterializerForTesting(): DiagramConnectorsMaterializer { return this._connectorsMaterializer; }

    // Connector-selection track (§ 12 of
    // [docs/connectors.md](../../../docs/connectors.md), per
    // the § 7.3 recommendation). Kept separate from the inherited
    // Selector._selectedContainers (which holds Figure containers) so
    // SelectedItem / SelectedItems stay typed as the ItemsSource
    // population — mixed-kind selections instead go through
    // SelectedConnectors + the existing SelectedItems channel.
    private readonly _selectedConnectors: Set<Connector> = new Set();

    // Subscriber list for ConnectorSelectionChanged. Mirrors the figure-
    // side SelectionChanged channel inherited from Selector, but kept as
    // a separate event because Selector's API is typed against the
    // ItemsSource population (figures) and the connector track lives in
    // its own Set above. FormatMirror subscribes here so editing a Pen
    // in the shared editor reaches selected connectors the same way it
    // reaches selected figures.
    private readonly _connectorSelectionChangedListeners: Set<() => void> = new Set();

    public AddConnectorSelectionChangedListener   (listener: () => void): void { this._connectorSelectionChangedListeners.add(listener); }
    public RemoveConnectorSelectionChangedListener(listener: () => void): void { this._connectorSelectionChangedListeners.delete(listener); }

    private _fireConnectorSelectionChanged(): void
    {
        for (const l of [...this._connectorSelectionChangedListeners]) l();
    }

    // ── Container-bound signal ────────────────────────────────────────
    //
    // Raised whenever a Figure container is (re)bound to a data-row item
    // (a NodeViewModel from an ItemsSource collection) in bindContainer —
    // the single choke point for both fresh (GetContainerForItemOverride)
    // and recycled (RebindContainerForItemOverride) containers. The owning
    // DiagramDocument subscribes so it can seed the container's geometry
    // from its NodeVisualStore (the container, not the VM, owns geometry)
    // and re-point connector endpoints that referenced the item by id.
    // Fires only for MuralBase items — a Figure/Group that is its own container
    // is not a wrapped data row and does not fire.
    private readonly _containerBoundListeners: Set<(container: Figure, item: unknown) => void> = new Set();

    public AddContainerBoundListener   (listener: (container: Figure, item: unknown) => void): void { this._containerBoundListeners.add(listener); }
    public RemoveContainerBoundListener(listener: (container: Figure, item: unknown) => void): void { this._containerBoundListeners.delete(listener); }

    private _fireContainerBound(container: Figure, item: unknown): void
    {
        for (const l of [...this._containerBoundListeners]) l(container, item);
    }

    public SelectConnector(c: Connector): void
    {
        if (this._selectedConnectors.has(c)) return;
        this._selectedConnectors.add(c);
        this._fireConnectorSelectionChanged();
    }
    public DeselectConnector(c: Connector): void
    {
        if (!this._selectedConnectors.delete(c)) return;
        this._fireConnectorSelectionChanged();
    }
    public ClearConnectorSelection(): void
    {
        if (this._selectedConnectors.size === 0) return;
        this._selectedConnectors.clear();
        this._fireConnectorSelectionChanged();
    }
    public IsConnectorSelected(c: Connector):  boolean { return this._selectedConnectors.has(c); }
    public get SelectedConnectors():           readonly Connector[] { return [...this._selectedConnectors]; }

    // Live subscription to the Connectors collection that keeps the
    // connector selection honest: a connector removed from Connectors
    // (the consumer's DeleteRequested listener mutating the collection)
    // must not linger in _selectedConnectors, or FormatMirror would keep
    // pushing Pen edits to a dead connector and the edit adorner would
    // keep painting its handles. Re-armed whenever the Connectors DP is
    // swapped (see OnPropertyChanged).
    private _connectorsPruneUnsub: (() => void) | undefined = undefined;

    private _resubscribeConnectorsForSelectionPrune(): void
    {
        this._connectorsPruneUnsub?.();
        this._connectorsPruneUnsub = undefined;
        const collection = this.Connectors;
        // Any change (item removed, collection cleared, or the whole DP
        // swapped) reconciles selection against what's currently present.
        this._pruneSelectionToCurrentConnectors();
        if (collection !== undefined)
        {
            this._connectorsPruneUnsub = collection.Subscribe(() => this._pruneSelectionToCurrentConnectors());
        }
    }

    private _pruneSelectionToCurrentConnectors(): void
    {
        if (this._selectedConnectors.size === 0) return;
        const collection = this.Connectors;
        const present = new Set<MuralBase>();
        if (collection !== undefined)
        {
            for (let i = 0; i < collection.Count; i++) present.add(collection.Get(i)!);
        }
        let changed = false;
        for (const c of [...this._selectedConnectors])
        {
            if (!present.has(c as unknown as MuralBase))
            {
                this._selectedConnectors.delete(c);
                changed = true;
            }
        }
        if (changed) this._fireConnectorSelectionChanged();
    }

    // Range-select the inclusive slice of Connectors between `from` and
    // `to` in Diagram.Connectors index order. Diff-applied so unchanged
    // entries don't churn the ConnectorSelectionChanged event. Mirrors
    // Selector.selectContainerRange (used by Shift+click on figures);
    // shared editor wiring (FormatMirror) reacts to the resulting
    // ConnectorSelectionChanged exactly once at the end of the apply,
    // not per-entry. Either endpoint missing from Connectors → no-op
    // (same forgiving contract as Selector — a stale anchor doesn't
    // throw).
    public SelectConnectorRange(from: Connector, to: Connector): void
    {
        const live = this.Connectors;
        if (live === undefined) return;
        let fromIdx = -1, toIdx = -1;
        const arr: Connector[] = [];
        for (let i = 0; i < live.Count; i++)
        {
            const c = live.Get(i) as Connector | undefined;
            if (c === undefined) continue;
            arr.push(c);
            if (c === from) fromIdx = arr.length - 1;
            if (c === to)   toIdx   = arr.length - 1;
        }
        if (fromIdx < 0 || toIdx < 0) return;
        const lo = Math.min(fromIdx, toIdx);
        const hi = Math.max(fromIdx, toIdx);
        const next = new Set<Connector>();
        for (let i = lo; i <= hi; i++) next.add(arr[i]!);
        let changed = false;
        for (const existing of [...this._selectedConnectors])
        {
            if (!next.has(existing))
            {
                this._selectedConnectors.delete(existing);
                changed = true;
            }
        }
        for (const c of next)
        {
            if (!this._selectedConnectors.has(c))
            {
                this._selectedConnectors.add(c);
                changed = true;
            }
        }
        if (changed) this._fireConnectorSelectionChanged();
    }

    constructor()
    {
        super();
        // Default Template flows from the bundled diagram theme entry
        // under TargetType=Diagram (see diagram.template.mu): a
        // ScrollViewer wrapping an ItemsPresenter. Folding the scroll
        // shell into the template means the Diagram itself is on the
        // bubble path of canvas drops — `DropReceiver = $Self`
        // (relative-source-self, i.e. the Diagram instance) works
        // without an enclosing Border.
        this.applyDefaultStyle();
        // First-init the toolbox repository + built-in Shapes page (idempotent;
        // no-op when there is no Application service provider, e.g. headless).
        ensureToolboxDefaults(Application.current?.Services);
        // Collaborators — internal, no public surface. Eagerly
        // constructed so the Diagram is fully-equipped from the moment
        // the constructor returns.
        new DiagramCommands(this);
        // Zoom commands — bound by the on-canvas overlay and host keyboard.
        this.set_property_value(Diagram.ZoomInCommandKey,         new RelayCommand(() => this.ZoomIn()));
        this.set_property_value(Diagram.ZoomOutCommandKey,        new RelayCommand(() => this.ZoomOut()));
        this.set_property_value(Diagram.ResetZoomCommandKey,      new RelayCommand(() => this.ResetZoom()));
        this.set_property_value(Diagram.FitCommandKey,            new RelayCommand(() => this.Fit()));
        this.set_property_value(Diagram.FitToSelectionCommandKey, new RelayCommand(() => this.FitToSelection()));
        new SelectionBoundsTracker(this);
        this._containerPlacement = new ContainerPlacement(this);
        this._formatMirror = new FormatMirror(this);
        // Format-painter (Copy Format) — installed for the Diagram's lifetime,
        // self-gated by the FormatPainterActive DP (no detach needed here).
        attachFormatPainter(this);
        new SelectionGeometryMirror(this);
        new SelectionReflector(this);
        this._connectorsMaterializer = new DiagramConnectorsMaterializer(this);
        // Seed the cap dropdown catalog. Safe here despite the cap
        // resources not being registered yet — each option resolves its
        // template lazily on read (see connectorCapOptions / CapOption).
        this.set_property_value(Diagram.ConnectorCapOptionsKey, connectorCapOptions());
        // Live-update on a Diagram-settings edit: re-measure (label margin,
        // shape-fit) and re-route every connector (orthogonal stub, lane gap,
        // bezier offset) so a value change in the settings pane is reflected
        // without reopening the document. Chrome sizes (handles, halo) re-read
        // on the next adorner rebuild. Not torn down — same no-teardown
        // convention as the Diagram's collaborators (it lives for the doc).
        DiagramSettings.Subscribe(() => this._onDiagramSettingsChanged());
    }

    // A Diagram-settings value changed — re-layout and re-route so the new value
    // takes effect on already-placed content.
    private _onDiagramSettingsChanged(): void
    {
        this.InvalidateMeasure();
        // The rulers paint their (theme-linked) fill/tick colours straight from
        // DiagramSettings in RenderOverride; a measure invalidation alone need not
        // re-run their paint, so invalidate them directly. This is what repaints
        // them when the light/dark theme swaps (see DiagramSettings' ThemeManager
        // hook) — otherwise a dark @Surface strip stays black in light mode.
        const { top, left } = this._rulerParts();
        top?.InvalidateVisual();
        left?.InvalidateVisual();
        const connectors = this.Connectors;
        if (connectors === undefined) return;
        for (let i = 0; i < connectors.Count; i++)
        {
            const c = connectors.Get(i);
            if (c instanceof Connector) c.RecomputeRoute();
        }
    }

    protected override OnPointerDown(args: PointerEventArgs): void
    {
        super.OnPointerDown(args);
    }

    // Preview-phase pointer overrides delegate to the connector-
    // interactions interceptor when one is installed. Fire BEFORE
    // descendant Figures consume the event by setting args.Handled,
    // which is the only reliable point to intercept gestures that
    // start on a Figure's bounding rect (port-handle clicks that ride
    // above the figure visual; figure-body clicks that pre-handle
    // before a Diagram-level bubble listener could ever run).
    protected override OnPreviewPointerDown(args: PointerEventArgs): void
    {
        super.OnPreviewPointerDown(args);
        // Take keyboard focus on the TUNNEL (preview) phase so it happens for a
        // click ANYWHERE within the diagram — canvas, node, or connector — before a
        // descendant Figure can consume the event by setting args.Handled (a bubble
        // OnPointerDown would miss a node/connector click). Subsequent Delete /
        // Ctrl+Z / arrow-key shortcuts then route to this Diagram. No-op when
        // Focusable=false (the Visual.Focus contract).
        this.Focus();
        // Format-painter first: while the brush is loaded a click stamps + is
        // consumed here, pre-empting select and the connector interceptor.
        this._formatPainterHandlers?.OnPreviewPointerDown(args);
        if (args.Handled) return;
        this._connectorInteractionsHandlers?.OnPreviewPointerDown(args);
        this._alignmentGuidesHandlers?.OnPreviewPointerDown(args);
        this._persistentGuidesHandlers?.OnPreviewPointerDown(args);
    }
    protected override OnPreviewPointerMove(args: PointerEventArgs): void
    {
        super.OnPreviewPointerMove(args);
        this._connectorInteractionsHandlers?.OnPreviewPointerMove(args);
        this._persistentGuidesHandlers?.OnPreviewPointerMove(args);
    }
    protected override OnPreviewPointerUp(args: PointerEventArgs): void
    {
        super.OnPreviewPointerUp(args);
        this._connectorInteractionsHandlers?.OnPreviewPointerUp(args);
        this._alignmentGuidesHandlers?.OnPreviewPointerUp(args);
        this._persistentGuidesHandlers?.OnPreviewPointerUp(args);
    }
    protected override OnPointerLeave(args: PointerEventArgs): void
    {
        super.OnPointerLeave(args);
        this._connectorInteractionsHandlers?.OnPointerLeave(args);
    }

    // ── Camera (LayoutTransform scale on PART_Camera) ──────────────────────
    private _camScale?: ScaleTransform;

    // Lazily set PART_Camera's LayoutTransform (the template is applied in the
    // ctor, so GetTemplateChild resolves once a camera write first arrives).
    // A LayoutTransform grows the measured footprint, so the ScrollViewer sizes
    // its scrollbars to the zoomed content; pan is the scroll offset, not a
    // translate on this transform.
    private _ensureCameraTransform(): void
    {
        if (this._camScale !== undefined) return;
        const host = this.GetTemplateChild('PART_Camera');
        if (host === undefined) return;
        this._camScale = new ScaleTransform(this.Zoom, this.Zoom);
        host.LayoutTransform = this._camScale;
    }

    private _syncCameraTransform(): void
    {
        this._ensureCameraTransform();
        if (this._camScale === undefined) return;
        this._camScale.ScaleX = this.Zoom;
        this._camScale.ScaleY = this.Zoom;
    }

    // Camera gesture handlers (installed by attachZoomPan when CameraEnabled flips).
    private _cameraHandlers?: CameraGestureHandlers;
    private _cameraDetach?: () => void;
    public _setCameraHandlers(h: CameraGestureHandlers | undefined): void { this._cameraHandlers = h; }

    // Ctrl+wheel zoom must pre-empt the ScrollViewer, which scrolls in the
    // bubble phase — so the camera handler runs in the TUNNEL phase and marks
    // the event Handled, suppressing the ScrollViewer's bubble scroll. Plain /
    // Shift wheel is left unhandled and bubbles to the ScrollViewer.
    protected override OnPreviewPointerWheel(args: WheelEventArgs): void
    {
        super.OnPreviewPointerWheel(args);
        this._cameraHandlers?.OnWheel(args);
    }

    // @internal test seam — same path OnPreviewPointerWheel uses, without live routing.
    public _dispatchWheel(args: WheelEventArgs): void { this._cameraHandlers?.OnWheel(args); }

    private _applyCameraToConnectors(): void
    {
        const connectors = this.Connectors;
        if (connectors === undefined) return;
        for (let i = 0; i < connectors.Count; i++)
        {
            const c = connectors.Get(i);
            if (c instanceof Connector) c.applyCameraZoom(this.Zoom);
        }
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue:   unknown,
        newValue:   unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (descriptor.Name === 'Zoom')
        {
            this._syncCameraTransform();
            // Keep connector click-bands a constant on-screen width under zoom.
            this._applyCameraToConnectors();
        }
        if (descriptor.Name === 'CameraEnabled')
        {
            if (newValue === true) { this._cameraDetach ??= attachZoomPan(this); }
            else { this._cameraDetach?.(); this._cameraDetach = undefined; }
        }
        if (descriptor.Name === 'AlignmentGuidesEnabled')
        {
            if (newValue === true) this._attachAlignmentGuides();
            else                   this._detachAlignmentGuides();
        }
        else if (descriptor.Name === 'RulersVisible')
        {
            if (newValue === true) this._enableRulers();
            else                   this._disableRulers();
        }
        else if (descriptor.Name === 'SelectionResizeEnabled')
        {
            if (newValue === true) this._attachSelectionResize();
            else                   this._detachSelectionResize();
        }
        else if (descriptor.Name === 'TextBlockAdornerEnabled')
        {
            if (newValue === true) this._attachTextBlockAdorner();
            else                   this._detachTextBlockAdorner();
        }
        else if (descriptor.Name === 'LayoutPreview')
        {
            // Mount a fresh overlay when a preview is set/changed, unmount when it
            // clears. Deferred so the ItemsPanel's AdornerLayer exists.
            queueMicrotask(() => this._syncLayoutPreviewAdorner());
        }
        else if (descriptor.Name === 'ConnectorInteractionsEnabled')
        {
            if (newValue === true) this._attachConnectorInteractions();
            else                   this._detachConnectorInteractions();
        }
        else if (descriptor.Name === 'DropReceiver')
        {
            this._reattachDropReceiver(newValue as Visual | undefined);
        }
        else if (descriptor.Name === 'Mutator')
        {
            // Consumer-driven Mutator write — if it doesn't match the
            // value we auto-wired, the consumer has taken over and our
            // tracking slot needs to release so a later DataContext swap
            // doesn't clear their explicit pick.
            if (this._autoWiredMutator !== undefined
                && newValue !== this._autoWiredMutator)
            {
                this._autoWiredMutator = undefined;
            }
            this._reattachMutator(newValue as DiagramMutator | undefined);
        }
        else if (descriptor.Name === 'DataContext')
        {
            this._autoWireMutatorFromDataContext(newValue);
            this._publishViewToDataContext(newValue);
        }
        else if (descriptor === Diagram.ConnectorsKey.descriptor)
        {
            // Same-instance re-push (a bound collection pulses the DP on every
            // content mutation — binding.ts fires onValueChanged(coll, coll)).
            // The materializer's own collection subscription already handles the
            // mutation incrementally; a full re-materialize here is the O(M^2)
            // trap. Mirrors the ItemsSource identity guard in ItemsControl.
            if (oldValue === newValue) return;
            this._connectorsMaterializer._onConnectorsCollectionChanged();
            this._resubscribeConnectorsForSelectionPrune();
        }
        else if (descriptor === Diagram.ConnectorTemplateKey.descriptor)
        {
            this._connectorsMaterializer._onTemplateChanged();
        }
    }

    // Auto-wire convenience: when a Diagram receives a DataContext that
    // structurally implements DiagramMutator AND no explicit Mutator
    // has been written, install the DataContext itself as the Mutator.
    // Lets a DiagramDocument-shaped VM serve as both the data root and
    // the mutator without an extra binding in markup. WPF parity with
    // ItemsControl's "Source defaults to DataContext" idiom.
    //
    // Edge cases:
    //   * Consumer set Mutator explicitly → respected (we never clobber
    //     a value we didn't install).
    //   * DataContext swaps to a non-mutator value → withdraw the
    //     auto-wire so the stale instance doesn't keep handling events.
    //   * Both old and new DC are mutators → fresh wire to the new one.
    private _autoWireMutatorFromDataContext(dc: unknown): void
    {
        // Withdraw the previous auto-wire before considering the new
        // DC. If the consumer set Mutator manually in the meantime,
        // _autoWiredMutator was already cleared in the Mutator-DP
        // branch above, so this guard's `=== Mutator` check stays
        // accurate.
        if (this._autoWiredMutator !== undefined
            && this.Mutator === this._autoWiredMutator)
        {
            this._autoWiredMutator = undefined;
            this.Mutator           = undefined;
        }
        if (this.Mutator !== undefined) return;
        if (Diagram._isDiagramMutator(dc))
        {
            this._autoWiredMutator = dc;
            this.Mutator           = dc;
        }
    }

    // Publish this control as the DataContext's ActiveView (see IDiagramViewHost)
    // so sibling regions reach our commands / selection-format through the VM.
    // Clears the previously-published host's back-reference on a DataContext
    // swap — but only if it still points at us, so a view that re-materialized
    // and already re-claimed the slot isn't clobbered.
    private _publishViewToDataContext(dc: unknown): void
    {
        if (this._publishedViewHost !== undefined
            && this._publishedViewHost.ActiveView === this)
        {
            this._publishedViewHost.ActiveView = undefined;
        }
        this._publishedViewHost = undefined;
        if (Diagram._isDiagramViewHost(dc))
        {
            dc.ActiveView = this;
            this._publishedViewHost = dc;
        }
    }

    private static _isDiagramViewHost(value: unknown): value is IDiagramViewHost
    {
        return typeof value === 'object' && value !== null && 'ActiveView' in value;
    }

    private static _isDiagramMutator(value: unknown): value is DiagramMutator
    {
        if (typeof value !== 'object' || value === null) return false;
        const v = value as Record<string, unknown>;
        return typeof v.Group            === 'function'
            && typeof v.Ungroup          === 'function'
            && typeof v.CombineSelection === 'function'
            && typeof v.DeleteNodes      === 'function'
            && typeof v.CreateNode       === 'function';
    }

    private _reattachDropReceiver(receiver: Visual | undefined): void
    {
        if (this._dropReceiverDetach !== undefined)
        {
            this._dropReceiverDetach();
            this._dropReceiverDetach = undefined;
        }
        if (receiver !== undefined)
        {
            this._dropReceiverDetach = attachCanvasDropBehavior(receiver, this);
        }
    }

    private _reattachMutator(mutator: DiagramMutator | undefined): void
    {
        if (this._mutatorDetach !== undefined)
        {
            this._mutatorDetach();
            this._mutatorDetach = undefined;
        }
        if (mutator !== undefined)
        {
            this._mutatorDetach = attachStandardDiagramMutations(this, mutator);
        }
    }

    private _attachAlignmentGuides(): void
    {
        if (this._alignmentGuidesDetach !== undefined) return;
        this._alignmentGuidesDetach = attachAlignmentGuides(this);
        // Adorner mount needs the ItemsPanel's AdornerLayer, which only
        // exists after first layout. Defer to next microtask; if the
        // layer still isn't reachable then, no-op (consumer can re-flip
        // the DP after mount, or set it AFTER initial layout).
        queueMicrotask(() => this._mountAlignmentGuidesAdorner());
    }

    private _detachAlignmentGuides(): void
    {
        if (this._alignmentGuidesDetach !== undefined)
        {
            this._alignmentGuidesDetach();
            this._alignmentGuidesDetach = undefined;
        }
        if (this._alignmentGuidesAdorner !== undefined)
        {
            const layer = AdornerLayer.GetAdornerLayer(this._alignmentGuidesAdorner.AdornedElement);
            layer?.Remove(this._alignmentGuidesAdorner);
            this._alignmentGuidesAdorner.dispose();
            this._alignmentGuidesAdorner = undefined;
        }
    }

    private _mountAlignmentGuidesAdorner(): void
    {
        if (this._alignmentGuidesAdorner !== undefined) return;
        const panel = this.ItemsPanelInstance;
        if (panel === undefined) return;   // layout hasn't materialized yet
        const layer = AdornerLayer.GetAdornerLayer(panel);
        if (layer === undefined) return;   // no AdornerLayer in scope
        const adorner = new AlignmentGuidesAdorner(panel, this);
        layer.Add(adorner);
        this._alignmentGuidesAdorner = adorner;
    }

    // Reconcile the layout-preview overlay with Diagram.LayoutPreview: unmount any
    // existing adorner (a definitive clear + fresh repaint), then mount a new one
    // when a preview is set. A fresh mount is a first-render — the reliable way to
    // (re)paint an adorner, since a mounted adorner's RenderOverride is not re-run
    // by InvalidateVisual/InvalidateArrange. Called deferred so the ItemsPanel's
    // AdornerLayer exists (a consumer sets LayoutPreview after the diagram laid out).
    private _syncLayoutPreviewAdorner(): void
    {
        if (this._layoutPreviewAdorner !== undefined)
        {
            const old = AdornerLayer.GetAdornerLayer(this._layoutPreviewAdorner.AdornedElement);
            old?.Remove(this._layoutPreviewAdorner);
            this._layoutPreviewAdorner = undefined;
        }
        if (this.LayoutPreview === undefined) return;
        const panel = this.ItemsPanelInstance;
        if (panel === undefined) return;
        const layer = AdornerLayer.GetAdornerLayer(panel);
        if (layer === undefined) return;
        const adorner = new LayoutPreviewAdorner(panel, this);
        layer.Add(adorner);
        this._layoutPreviewAdorner = adorner;
    }

    private _enableRulers(): void
    {
        if (this._persistentGuidesDetach === undefined)
            this._persistentGuidesDetach = attachPersistentGuides(this);
        queueMicrotask(() => this._mountPersistentGuidesAdorner());
        this._showRulers(true);
        this._wireRulerCamera();
    }

    private _disableRulers(): void
    {
        this._persistentGuidesDetach?.();
        this._persistentGuidesDetach = undefined;
        if (this._persistentGuidesAdorner !== undefined)
        {
            const layer = AdornerLayer.GetAdornerLayer(this._persistentGuidesAdorner.AdornedElement);
            layer?.Remove(this._persistentGuidesAdorner);
            this._persistentGuidesAdorner.dispose();
            this._persistentGuidesAdorner = undefined;
        }
        this._rulerCameraDetach?.();
        this._rulerCameraDetach = undefined;
        this._showRulers(false);
    }

    private _mountPersistentGuidesAdorner(): void
    {
        if (this._persistentGuidesAdorner !== undefined) return;
        const panel = this.ItemsPanelInstance;
        if (panel === undefined) return;
        const layer = AdornerLayer.GetAdornerLayer(panel);
        if (layer === undefined) return;
        const adorner = new PersistentGuidesAdorner(panel, this);
        layer.Add(adorner);
        this._persistentGuidesAdorner = adorner;
    }

    private _rulerParts(): { top?: RulerBar; left?: RulerBar; corner?: Visual }
    {
        return {
            top:    this.GetTemplateChild('PART_RulerTop')    as unknown as RulerBar | undefined,
            left:   this.GetTemplateChild('PART_RulerLeft')   as unknown as RulerBar | undefined,
            corner: this.GetTemplateChild('PART_RulerCorner') as unknown as Visual  | undefined,
        };
    }

    private _showRulers(show: boolean): void
    {
        const v = show ? Visibility.Visible : Visibility.Collapsed;
        const { top, left, corner } = this._rulerParts();
        if (top    !== undefined) top.Visibility    = v;
        if (left   !== undefined) left.Visibility   = v;
        if (corner !== undefined) corner.Visibility = v;
    }

    // Feed zoom/offset/extent into the rulers whenever the camera changes so their
    // ticks track the panned/zoomed content. The rulers sit outside PART_Camera,
    // so they must be told the transform explicitly (they don't inherit it).
    private _wireRulerCamera(): void
    {
        if (this._rulerCameraDetach !== undefined) return;
        const feed = (): void => {
            const { top, left } = this._rulerParts();
            const vp = this._viewportSize();
            // Offset the rulers by the EFFECTIVE pan (host px) so ticks line up
            // with the content even when an axis' ScrollX/Y is stale (content fits).
            const origin = this.VisibleContentOrigin();
            const z = this.Zoom;
            if (top !== undefined)  { top.Zoom  = z; top.Offset  = origin.X * z; top.Extent  = vp.Width; }
            if (left !== undefined) { left.Zoom = z; left.Offset = origin.Y * z; left.Extent = vp.Height; }
        };
        feed();
        const scroll = this.ScrollHost;
        const zoomSub: Disposable = this.PropertyChanged(Diagram.ZoomKey).subscribe(feed);
        const hOffSub: Disposable | undefined = scroll?.PropertyChanged(ScrollViewer.HorizontalOffsetKey).subscribe(feed);
        const vOffSub: Disposable | undefined = scroll?.PropertyChanged(ScrollViewer.VerticalOffsetKey).subscribe(feed);
        this._rulerCameraDetach = (): void => {
            zoomSub.dispose();
            hOffSub?.dispose();
            vOffSub?.dispose();
        };
    }

    private _attachSelectionResize(): void
    {
        if (this._selectionResizeSource !== undefined) return;
        this._selectionResizeSource = new DiagramSelectionSource(this);
        queueMicrotask(() => this._mountSelectionResizeAdorner());
    }

    private _detachSelectionResize(): void
    {
        if (this._selectionResizeAdorner !== undefined)
        {
            const layer = AdornerLayer.GetAdornerLayer(this._selectionResizeAdorner.AdornedElement);
            layer?.Remove(this._selectionResizeAdorner);
            this._selectionResizeAdorner = undefined;
        }
        this._selectionResizeSource = undefined;
    }

    private _attachConnectorInteractions(): void
    {
        if (this._connectorInteractionsDetach !== undefined) return;
        this._connectorInteractionsDetach = attachConnectorInteractions(this);
    }

    private _detachConnectorInteractions(): void
    {
        if (this._connectorInteractionsDetach !== undefined)
        {
            this._connectorInteractionsDetach();
            this._connectorInteractionsDetach = undefined;
        }
    }

    private _mountSelectionResizeAdorner(): void
    {
        if (this._selectionResizeAdorner !== undefined) return;
        if (this._selectionResizeSource  === undefined) return;
        const panel = this.ItemsPanelInstance;
        if (panel === undefined) return;
        const layer = AdornerLayer.GetAdornerLayer(panel);
        if (layer === undefined) return;
        const adorner = new SelectionBoundsAdorner(panel, this._selectionResizeSource);
        layer.Add(adorner);
        // Selection accent = theme @Primary (live via DynamicResource, adapts
        // light/dark); handle interiors = the HandleFill token. Unifies the bbox
        // with the group outline (already @Primary) and the snap/text-block chrome.
        adorner.set_property_value(
            SelectionBoundsAdorner.ChromeStrokeKey, DynamicResource(adorner, 'Primary') as unknown as Brush);
        adorner.ChromeFill = DiagramSettings.HandleFill();
        this._selectionResizeAdorner = adorner;
    }

    private _attachTextBlockAdorner(): void
    {
        if (this._textBlockAdorner !== undefined) return;
        queueMicrotask(() => this._mountTextBlockAdorner());
    }

    private _detachTextBlockAdorner(): void
    {
        if (this._textBlockAdorner !== undefined)
        {
            const layer = AdornerLayer.GetAdornerLayer(this._textBlockAdorner.AdornedElement);
            layer?.Remove(this._textBlockAdorner);
            this._textBlockAdorner.dispose();
            this._textBlockAdorner = undefined;
        }
    }

    private _mountTextBlockAdorner(): void
    {
        if (this._textBlockAdorner !== undefined) return;
        if (!this.TextBlockAdornerEnabled) return;   // flipped back off before mount
        const panel = this.ItemsPanelInstance;
        if (panel === undefined) return;
        const layer = AdornerLayer.GetAdornerLayer(panel);
        if (layer === undefined) return;
        const adorner = new TextBlockAdorner(panel, this);
        layer.Add(adorner);
        this._textBlockAdorner = adorner;
    }

    public override GetContainerForItemOverride(item: unknown): Visual
    {
        // Items in the framework Diagram ARE Figures / Groups — the data
        // and the visual are the same Visual instance. So the item is
        // its own container; no wrapping needed.
        if (item instanceof Figure || item instanceof Group) return item;
        // Fallback for non-Figure/Group items — wrap in a fresh Figure
        // (preserves the old WPF-style data-container split for consumers
        // that bind a VM collection to ItemsSource). A VM can opt into a
        // container host (duck-typed, like PortProvider): it realizes as a
        // ContentContainerFigure that holds children, its header showing the
        // VM's own content.
        const wantsContainer = (item as { IsContainer?: boolean }).IsContainer === true;
        const node: Figure = wantsContainer ? new ContentContainerFigure() : new Figure();
        this.bindContainer(node, item);
        return node;
    }

    // Arrow keys nudge selected nodes' position rather than navigate
    // selection (Visio / drawio / Figma convention). The Selector base
    // treats ArrowDown / ArrowUp as ListBox-style "move focus to next
    // row" — wrong shape for a free-positioned canvas surface, so the
    // override intercepts arrows BEFORE super.OnKeyDown runs.
    //
    // Step size: 1 dp plain, 10 dp with Shift (matches the canonical
    // "snap-to-grid"-ish increment in every drawing tool). Each
    // selected Figure's Left / Top bumps directly; the BindsTwoWayByDefault
    // contract on Figure.Left / Top back-propagates the new position to
    // the bound item VM through ItemContainerStyle, so the data layer
    // sees the move without the Diagram reaching into item shape.
    //
    // No-op (and falls through to Selector base) when nothing is
    // selected — so arrow keys on an empty selection still drive
    // selection navigation should the consumer rely on it.
    protected override OnKeyDown(args: KeyEventArgs): void
    {
        // Format-painter Esc: drop the brush before any other key handling.
        this._formatPainterHandlers?.OnKeyDown(args);
        if (args.Handled) return;
        // Persistent-guides next: a selected guide consumes Delete/Backspace
        // before the node-deletion path below sees it.
        this._persistentGuidesHandlers?.OnKeyDown?.(args);
        if (args.Handled) return;

        const key = args.Key;
        const isArrow = key === Key.Left || key === Key.Right
                     || key === Key.Up   || key === Key.Down;
        if (isArrow && this._selectedContainers.size > 0)
        {
            const step = hasModifier(args.Modifiers, ModifierKeys.Shift) ? 10 : 1;
            const dx = key === Key.Left ? -step : key === Key.Right ? step : 0;
            const dy = key === Key.Up   ? -step : key === Key.Down  ? step : 0;
            for (const container of this._selectedContainers)
            {
                if (container instanceof Figure)
                {
                    container.Left = container.Left + dx;
                    container.Top  = container.Top  + dy;
                }
            }
            args.Handled = true;
            return;
        }
        // Delete / Backspace — fire DeleteRequested with a snapshot
        // of both the items selection AND the connectors selection.
        // Same event-based mutation contract as Group / Ungroup /
        // Combine: framework knows what the user asked to remove,
        // consumer's listener owns the collection mutation (both
        // ItemsSource and Connectors). Fires when either channel has
        // entries — mixed-kind selections deliver both snapshots.
        if ((key === Key.Delete || key === Key.Back)
            && (this.SelectedItems.length > 0 || this._selectedConnectors.size > 0))
        {
            this._fireDeleteRequested({
                Items:      [...this.SelectedItems],
                Connectors: [...this._selectedConnectors],
                Shift:      hasModifier(args.Modifiers, ModifierKeys.Shift),
            });
            args.Handled = true;
            return;
        }
        // Ctrl+G / Ctrl+Shift+G — fire the framework's Group / Ungroup
        // commands. CanExecute gating naturally guards (the command
        // returns false for empty / under-shaped selections), so a
        // gate-failed press is a silent no-op.
        if (key === Key.G && (hasModifier(args.Modifiers, ModifierKeys.Control) || hasModifier(args.Modifiers, ModifierKeys.Windows)))
        {
            const cmd = hasModifier(args.Modifiers, ModifierKeys.Shift) ? this.UngroupCommand : this.GroupCommand;
            if (cmd !== undefined && cmd.CanExecute(undefined)) cmd.Execute(undefined);
            args.Handled = true;
            return;
        }
        // Ctrl/⌘ + ] / [ — z-order. Shift jumps all the way (front / back); plain
        // steps one (forward / backward). CanExecute gating no-ops an empty selection.
        if ((key === Key.Oem6 || key === Key.Oem4)
            && (hasModifier(args.Modifiers, ModifierKeys.Control) || hasModifier(args.Modifiers, ModifierKeys.Windows)))
        {
            const shift = hasModifier(args.Modifiers, ModifierKeys.Shift);
            const cmd = key === Key.Oem6
                ? (shift ? this.BringToFrontCommand : this.BringForwardCommand)
                : (shift ? this.SendToBackCommand   : this.SendBackwardCommand);
            if (cmd !== undefined && cmd.CanExecute(undefined)) cmd.Execute(undefined);
            args.Handled = true;
            return;
        }
        // Ctrl/⌘ + C / X / V — figure clipboard. Copy / Cut no-op on an empty
        // selection (handled in _requestCopy/_requestCut); Paste always tries
        // (the consumer no-ops on foreign / empty clipboard text).
        if ((key === Key.C || key === Key.X || key === Key.V)
            && (hasModifier(args.Modifiers, ModifierKeys.Control) || hasModifier(args.Modifiers, ModifierKeys.Windows)))
        {
            if (key === Key.C)      this._requestCopy();
            else if (key === Key.X) this._requestCut();
            else                    this._requestPaste();
            args.Handled = true;
            return;
        }
        // Ctrl/⌘ + Z undo, + Shift redo. The consumer's mutator owns the history;
        // a no-op when nothing is recorded (mutator.Undo/Redo self-guard).
        if (key === Key.Z
            && (hasModifier(args.Modifiers, ModifierKeys.Control) || hasModifier(args.Modifiers, ModifierKeys.Windows)))
        {
            if (hasModifier(args.Modifiers, ModifierKeys.Shift)) this._requestRedo();
            else                                                 this._requestUndo();
            args.Handled = true;
            return;
        }
        // F2 — begin in-place editing of the first selected figure's label, or,
        // when only a connector is selected, its label (Visio). Double-click is the
        // pointer equivalent (Figure.OnPointerDown / Connector.OnPointerDown).
        if (key === Key.F2 && (this._selectedContainers.size > 0 || this._selectedConnectors.size > 0))
        {
            let edited = false;
            for (const container of this._selectedContainers)
            {
                if (container instanceof Figure)
                {
                    // Same resolution as double-click (Figure.OnPointerDown):
                    // the content VM's own edit entry, else the Figure's ShapeText.
                    resolveEditTarget(container)?.BeginEdit();
                    edited = true;
                    break;
                }
            }
            // No editable figure selected → edit the first selected connector's
            // label (its ShapeText), matching Connector.OnPointerDown's double-click.
            if (!edited)
            {
                for (const c of this._selectedConnectors)
                {
                    c.Text?.BeginEdit();
                    break;
                }
            }
            args.Handled = true;
            return;
        }
        super.OnKeyDown(args);
    }

    public override RebindContainerForItemOverride(container: Visual, item: unknown): void
    {
        // Symmetric with GetContainerForItemOverride: a recycled
        // Figure re-binds to the new item — DataContext flips so
        // ItemContainerStyle bindings retarget, and Content flips so
        // the DataTemplate dispatch resolves against the new constructor.
        if (container instanceof Figure)
        {
            this.bindContainer(container, item);
            return;
        }
        super.RebindContainerForItemOverride(container, item);
    }

    // Wire a freshly-created OR recycled Figure to its data row.
    // Mirrors ListBox.bindContainer: the container subclass owns the
    // DataContext setup so ItemContainerStyle bindings on the container
    // (`Left = $Left`, `Top = $Top`, …) resolve against the per-item MuralBase
    // rather than against whatever the surrounding inheritance chain exposes.
    // ContentControl's own DataContext is NOT set by Content assignment —
    // that's a WPF parity decision (a ContentControl's outer bindings see
    // the outer scope). For container-shaped subclasses like Figure
    // we want the item exposed; that's this method's job.
    //
    // Tag is set so Selector.exposedValueOf returns the bound item — so
    // SelectedItem / SelectedItems / SelectionChanged surface the
    // NodeVM, not the Figure container. Same pattern as ListBox.
    private bindContainer(node: Figure, item: unknown): void
    {
        if (item instanceof MuralBase)
        {
            node.Tag         = item;
            node.DataContext = item;
            node.Content     = item;
            if (item instanceof NodeViewModel)
            {
                // The container Figure is the geometry owner + side-endpoint host;
                // the VM carries only content + Id. Mirror the Id so connector
                // endpoints (which resolve to the container) serialize by the
                // node's stable id, and mark the container a content tile so it
                // fits its rendered content. Position/size + the UserSized latch
                // are seeded from the document's NodeVisualStore via ContainerBound
                // (fired below), not bound off the VM.
                node.Id            = item.Id;
                // A plain VM container is a content tile (fits its box to the
                // content); a ContentContainerFigure sizes to its box + auto-grow
                // for children, not to its header, so it opts out.
                node.SizeToContent = !(node instanceof ContainerFigure);
                // A content tile styles like a rounded-rect card via its own
                // Fill/Stroke (Format Shape edits the container — see FormatMirror
                // paint targets). A leaf tile defaults both TRANSPARENT so it reads
                // as a bare icon, yet the Style page still engages (its editors only
                // blank when BOTH are undefined; a transparent brush is defined). A
                // CONTAINER holds children, so it instead defaults to a visible box —
                // a faint themed surface wash (the tunable container fill token) plus
                // the SAME default border a geometric shape draws (ShapeDefaultStroke
                // / ShapeStrokeWidth) so a container's outline matches every other
                // shape; a Format-Shape edit overrides these. Per-instance so the
                // mirror's in-place Pen edits don't leak.
                if (node instanceof ContentContainerFigure)
                {
                    node.Fill   = DiagramSettings.ContainerDefaultFill();
                    node.Stroke = new Pen(DiagramSettings.ShapeDefaultStroke(), DiagramSettings.ShapeStrokeWidth());
                }
                else
                {
                    node.Fill   = new SolidColorBrush(Color.FromHex('#00000000'));
                    node.Stroke = new Pen(new SolidColorBrush(Color.FromHex('#00000000')), 1);
                }
                // A per-instance port topology the VM opts into (duck-typed) —
                // else the container keeps its default bbox ports.
                const provider = (item as { PortProvider?: IPortProvider }).PortProvider;
                node.PortProvider = provider;
            }
            // Signal the owning document so it can seed the container's geometry
            // from the visual store and re-point id-referencing connectors — the
            // container, not the VM, is the geometry owner and side-endpoint host.
            this._fireContainerBound(node, item);
        }
        else
        {
            node.Tag         = undefined;
            node.DataContext = undefined;
            node.Content     = undefined;
        }
    }
}
