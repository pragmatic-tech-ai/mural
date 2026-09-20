import {
    type CollectionChange,
    type Disposable,
    type ICommand,
    MetaData,
    MuralBase,
    ObservableCollection,
    type PropertyDescriptor,
    type PropertyKey,
    RelayCommand,
    ServiceKey,
    type ServiceToken,
} from '../../runtime/index.js';
import { resolveKey } from '../../runtime/model-internals.js';
import { Pen, Point, TextAlignment } from '../../visual-engine/index.js';
import { Figure } from './figure.js';
import { Group } from './group.js';
import { NodeViewModel } from './node-view-model.js';
import { Callout } from './callout.js';
import { NodeVisualStore, type NodeVisual } from './serialization/node-visual-store.js';
import { DiagramHistory } from './history/diagram-history.js';
import { HistoryLayerId } from './history/history-layer.js';
import { SHAPE_CATALOG_MAP, mergeShapes } from './shape-catalog.js';
import { serializerFor, serializerByType } from './serialization/node-serialization.js';
import { encodeClipboard, decodeClipboard } from './serialization/clipboard-payload.js';
import { type ClipboardSink } from '../../basic/index.js';
// Importing node-serializers-default.js registers the built-in
// 'shape' / 'text' / 'callout' serializers as a side effect and
// also exports the text helpers used by connector serialization.
import {
    serializeShapeText,
    applySerializedText,
    type SerializedText,
} from './serialization/node-serializers-default.js';
import { GeometryCombineMode } from './commands/combine.js';
import { wrapTargets, selectedContainers, containerGeometryFor } from './commands/container-ops.js';
import { ContainerFigure } from './container-figure.js';
import { diagramSpaceRect, toParentSpace } from './coordinate-space.js';
import type { DiagramMutator } from './behaviors/attach-standard-mutations.js';
import { Connector } from './connector.js';
import { waypoint } from './route-waypoint.js';
import { ConnectorEndpoint } from './connector-endpoint.js';
import { PortSide } from './port.js';
import type { IDocument } from '../shell/services/documents-content-host-service.js';
import type { ICommandTarget } from '../shell/commands/command-target.js';
import type { CommandDefinition } from '../shell/commands/command-definition.js';
import { DiagramEditingContext, DiagramCommandId } from './diagram-command-contexts.js';
import { DiagramInspector } from './diagram-inspector.js';
import type { IFontFormatSink } from './font-format-sink.js';
import { Diagram } from './diagram.js';

// Minimal storage contract Diagram.Save / Load wire against. Subset of
// the Web Storage API (localStorage / sessionStorage). Demos plug in
// whichever backend suits.
export interface DiagramStorage
{
    GetItem(key: string): string | null;
    SetItem(key: string, value: string): void;
}

// Service token for the diagram persistence backend. The composition
// root (the app/platform bootstrap) registers a concrete DiagramStorage
// implementation against this on Application.current.Services; demo
// factories resolve it to inject into a DiagramDocument instead of each
// hand-rolling its own localStorage object. A real exported token, not
// a string.
export const DiagramStorageKey = new ServiceKey<DiagramStorage>('DiagramStorage');

// v3 node record — content only. Geometry lives in the sibling `visuals`
// section keyed by id (see NodeVisual). `type` = serializer tag; `data` =
// type-specific content payload (the callout serializer stashes leaderTargetId
// there).
interface SerializedNode
{
    readonly id:    string;
    readonly type:  string;
    readonly data?: Record<string, unknown>;
}

// (serializeShapeText, applySerializedText are imported from
// node-serializers-default.ts so the built-in NodeSerializer registrations
// can use them without a circular dependency.)

interface SerializedConnectorEndpoint
{
    readonly nodeId?:   string;
    readonly portName?: string;
    // The side of the node the connector attaches to (N/S/E/W), and the slot
    // within that side, when the user pinned them by dragging the endpoint to a
    // side. Without these, a reloaded endpoint is bare and the router re-derives
    // a geometry-optimal side, discarding the user's choice.
    readonly portSide?:  PortSide;
    readonly portIndex?: number;
    readonly freeX?:    number;
    readonly freeY?:    number;
}

interface SerializedConnector
{
    readonly source:      SerializedConnectorEndpoint;
    readonly target:      SerializedConnectorEndpoint;
    readonly waypoints?:  ReadonlyArray<{ readonly x: number; readonly y: number; readonly userAltered?: boolean }>;
    readonly routingMode?: string;
    // Connector label (Slice 5). `text` reuses the node text block form;
    // `labelPos` is the arc-length fraction, omitted when the default 0.5.
    readonly text?:       SerializedText;
    readonly labelPos?:   number;
}

interface SerializedDiagram
{
    readonly version?:    number;
    readonly nodes:       readonly SerializedNode[];
    // Geometry, keyed by node id — the presentation half of the two-section
    // format (see NodeVisual). Applied to nodes on load via NodeVisualStore.
    readonly visuals?:    Record<string, NodeVisual>;
    readonly connectors?: readonly SerializedConnector[];
    readonly nextId:      number;
    // Opaque, app-owned document metadata (mural neither reads nor validates
    // the keys). Omitted when empty so diagrams that don't use it keep their
    // existing on-disk shape. Round-trips through save/load unchanged.
    readonly metadata?:   Record<string, unknown>;
}

const STORAGE_KEY = 'mural-diagram-state-v1';

// The contexts a diagram document activates — just DiagramEditingContext (the
// toolbar shows the align/distribute/group/combine commands while a diagram is
// the active document). Frozen: it is the live CommandContexts a ToolbarService
// reads; a document that varied contexts by mode would return a different array.
const DIAGRAM_COMMAND_CONTEXTS: readonly ServiceToken<unknown>[] = Object.freeze([DiagramEditingContext]);

// Maps each diagram command id → the Diagram control command that performs it.
// DiagramDocument.Execute / CanExecute resolve through this against the currently
// published ActiveView, so the commands stay where they naturally live (the
// control, driven by view selection) while the document is the dispatch target.
const DIAGRAM_COMMAND_GETTERS: ReadonlyMap<string, (v: Diagram) => ICommand | undefined> = new Map<string, (v: Diagram) => ICommand | undefined>([
    [DiagramCommandId.AlignLeft,            (v) => v.AlignLeftCommand],
    [DiagramCommandId.AlignRight,           (v) => v.AlignRightCommand],
    [DiagramCommandId.AlignTop,             (v) => v.AlignTopCommand],
    [DiagramCommandId.AlignMiddle,          (v) => v.AlignMiddleCommand],
    [DiagramCommandId.AlignCenter,          (v) => v.AlignCenterCommand],
    [DiagramCommandId.DistributeHorizontal, (v) => v.DistributeHorizontalCommand],
    [DiagramCommandId.DistributeVertical,   (v) => v.DistributeVerticalCommand],
    [DiagramCommandId.Group,                (v) => v.GroupCommand],
    [DiagramCommandId.Ungroup,              (v) => v.UngroupCommand],
    [DiagramCommandId.CombineUnion,         (v) => v.CombineUnionCommand],
    [DiagramCommandId.CombineIntersect,     (v) => v.CombineIntersectCommand],
    [DiagramCommandId.CombineSubtract,      (v) => v.CombineSubtractCommand],
    [DiagramCommandId.CombineExclude,       (v) => v.CombineExcludeCommand],
    [DiagramCommandId.TextAlignLeft,        (v) => v.SetTextAlignLeftCommand],
    [DiagramCommandId.TextAlignCenter,      (v) => v.SetTextAlignCenterCommand],
    [DiagramCommandId.TextAlignRight,       (v) => v.SetTextAlignRightCommand],
    [DiagramCommandId.TextAlignJustify,     (v) => v.SetTextAlignJustifyCommand],
    [DiagramCommandId.TextPlaceTopLeft,     (v) => v.SetTextPlacementTopLeftCommand],
    [DiagramCommandId.TextPlaceTop,         (v) => v.SetTextPlacementTopCommand],
    [DiagramCommandId.TextPlaceTopRight,    (v) => v.SetTextPlacementTopRightCommand],
    [DiagramCommandId.TextPlaceLeft,        (v) => v.SetTextPlacementLeftCommand],
    [DiagramCommandId.TextPlaceCenter,      (v) => v.SetTextPlacementCenterCommand],
    [DiagramCommandId.TextPlaceRight,       (v) => v.SetTextPlacementRightCommand],
    [DiagramCommandId.TextPlaceBottomLeft,  (v) => v.SetTextPlacementBottomLeftCommand],
    [DiagramCommandId.TextPlaceBottom,      (v) => v.SetTextPlacementBottomCommand],
    [DiagramCommandId.TextPlaceBottomRight, (v) => v.SetTextPlacementBottomRightCommand],
    [DiagramCommandId.TextBold,             (v) => v.SetTextBoldCommand],
    [DiagramCommandId.TextItalic,           (v) => v.SetTextItalicCommand],
    [DiagramCommandId.TextUnderline,        (v) => v.SetTextUnderlineCommand],
    [DiagramCommandId.TextStrikethrough,    (v) => v.SetTextStrikethroughCommand],
    [DiagramCommandId.TextSizeIncrease,     (v) => v.IncreaseFontSizeCommand],
    [DiagramCommandId.TextSizeDecrease,     (v) => v.DecreaseFontSizeCommand],
]);

// Active-state predicates for the Toggles-presentation commands — the paragraph
// alignment and character-decoration toggles. DiagramDocument.IsActive resolves
// through this against the published ActiveView so a toolbar toggle's IsChecked
// reflects the current selection's text state (the same Selection* DPs the
// diagram demo binds directly). Commands absent here are never "active".
const DIAGRAM_COMMAND_ACTIVE: ReadonlyMap<string, (v: Diagram) => boolean> = new Map<string, (v: Diagram) => boolean>([
    [DiagramCommandId.TextAlignLeft,     (v) => v.SelectionTextAlignment === TextAlignment.Left],
    [DiagramCommandId.TextAlignCenter,   (v) => v.SelectionTextAlignment === TextAlignment.Center],
    [DiagramCommandId.TextAlignRight,    (v) => v.SelectionTextAlignment === TextAlignment.Right],
    [DiagramCommandId.TextAlignJustify,  (v) => v.SelectionTextAlignment === TextAlignment.Justify],
    [DiagramCommandId.TextBold,          (v) => v.SelectionBold],
    [DiagramCommandId.TextItalic,        (v) => v.SelectionItalic],
    [DiagramCommandId.TextUnderline,     (v) => v.SelectionUnderline],
    [DiagramCommandId.TextStrikethrough, (v) => v.SelectionStrikethrough],
]);

// Monotonic per-session document id source. Every DiagramDocument gets a
// stable, unique Id so DocumentsContentHostService can dedupe opens and locate
// a document to close (IDocument.Id contract). Not persisted — ids are only
// meaningful within a running session's open-set.
let _diagramDocSeq = 0;

// Top-level Document for a diagrammer-style workspace. Owns the flat
// `Nodes` collection (Figures + Groups),
// status feedback, Save / Load commands, and the structural mutation
// methods (Group / Ungroup / Combine / Delete / Place) the framework
// Diagram routes its gesture events to.
//
// DiagramDocument IS a `DiagramMutator` structurally — set it as the
// Diagram's DataContext and the Diagram auto-wires Mutator off the
// DC (no explicit `Mutator=…` binding needed). GroupRequested /
// UngroupRequested / CombineRequested / DeleteRequested / ItemDropped
// then route directly here.
//
// Customise by subclassing (override CreateNode for custom Figure
// shapes, etc.) or by composing — the Document doesn't lock methods
// down.
export class DiagramDocument extends MuralBase implements DiagramMutator, IDocument, ICommandTarget, IFontFormatSink
{
    // ── IDocument surface — lets a DocumentsContentHostService host this
    // document (open-set dedupe, tab title, dirty indicator, Save). ──
    public static readonly IdKey            = MuralBase.RegisterProperty<string>(
        DiagramDocument, 'Id',            '', MetaData.None);
    public static readonly TitleKey         = MuralBase.RegisterProperty<string>(
        DiagramDocument, 'Title',         'Diagram', MetaData.None);
    public static readonly IsDirtyKey       = MuralBase.RegisterProperty<boolean>(
        DiagramDocument, 'IsDirty',       false, MetaData.None);
    // The Diagram control currently presenting this document. Published by the
    // control itself when this document becomes its DataContext (see
    // Diagram / IDiagramViewHost). Sibling shell regions (toolbars, format
    // pane) bind the active document's editing commands + selection-format
    // state THROUGH this: `$service(ContentHostService).ActiveDocument.ActiveView.<X>`.
    // undefined when no view is materialized (e.g. the document isn't active).
    public static readonly ActiveViewKey    = MuralBase.RegisterProperty<Diagram | undefined>(
        DiagramDocument, 'ActiveView',    undefined, MetaData.None);

    // The inspector VM the shell's inspector region presents for this document
    // (a DataTemplate[DataType=DiagramInspector] renders the Format Shape pane).
    // A stable per-document instance whose `View` this document keeps synced with
    // ActiveView — so the inspector reaches the live control's selection-format
    // state. A DP so `ActiveDocument.Inspector` resolves as a bindable path.
    public static readonly InspectorKey     = MuralBase.RegisterProperty<DiagramInspector>(
        DiagramDocument, 'Inspector',     undefined as unknown as DiagramInspector, MetaData.None);

    public static readonly NodesKey         = MuralBase.RegisterProperty<ObservableCollection<Figure | Group | NodeViewModel>>(
        DiagramDocument, 'Nodes',         undefined as unknown as ObservableCollection<Figure | Group | NodeViewModel>, MetaData.None);
    public static readonly ConnectorsKey    = MuralBase.RegisterProperty<ObservableCollection<Connector>>(
        DiagramDocument, 'Connectors',    undefined as unknown as ObservableCollection<Connector>, MetaData.None);
    public static readonly StatusKey        = MuralBase.RegisterProperty<string>(
        DiagramDocument, 'Status',        '', MetaData.None);
    public static readonly StorageKey       = MuralBase.RegisterProperty<DiagramStorage | undefined>(
        DiagramDocument, 'Storage',       undefined, MetaData.None);
    public static readonly SaveCommandKey   = MuralBase.RegisterProperty<RelayCommand | undefined>(
        DiagramDocument, 'SaveCommand',   undefined, MetaData.None);
    public static readonly LoadCommandKey   = MuralBase.RegisterProperty<RelayCommand | undefined>(
        DiagramDocument, 'LoadCommand',   undefined, MetaData.None);

    // ── IFontFormatSink surface — the font-format editor the shell toolbar hosts
    // binds these two-way. They MIRROR the published ActiveView's Selection* DPs:
    // a picker write flows out to the control (→ FormatMirror → selection), and a
    // selection change flows back here. Defaults match the Diagram control's.
    public static readonly FontFamilyKey   = MuralBase.RegisterProperty<string>(
        DiagramDocument, 'FontFamily',   '', MetaData.None);
    public static readonly FontSizeKey     = MuralBase.RegisterProperty<number>(
        DiagramDocument, 'FontSize',     12, MetaData.None);
    public static readonly FontColorHexKey = MuralBase.RegisterProperty<string>(
        DiagramDocument, 'FontColorHex', '#000000', MetaData.None);
    // The size steppers bind these; sourced from the live view (undefined with no
    // view). Read-only to the world — set only from the mirrored ActiveView.
    public static readonly IncreaseFontSizeCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        DiagramDocument, 'IncreaseFontSizeCommand', undefined, MetaData.None);
    public static readonly DecreaseFontSizeCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        DiagramDocument, 'DecreaseFontSizeCommand', undefined, MetaData.None);

    // Connectors-mode pin — mirrors the live view's ConnectorsModePinned two-way.
    // The shell status bar's connector indicator binds this: writing it toggles
    // the mode on the control, and the control's changes flow back here.
    public static readonly ConnectorsModePinnedKey = MuralBase.RegisterProperty<boolean>(
        DiagramDocument, 'ConnectorsModePinned', false, MetaData.None);

    // Format-painter (Copy Format) mode — mirrors the live view's
    // FormatPainterActive two-way, so a toolbar ToggleButton binds it as a
    // single-segment two-way IsChecked (the proven pattern) instead of firing a
    // canExecute-gated command. Writing it arms/disarms the brush on the control.
    public static readonly FormatPainterActiveKey = MuralBase.RegisterProperty<boolean>(
        DiagramDocument, 'FormatPainterActive', false, MetaData.None);

    private _nextId = 1;

    // The presentation half of the two-section format: an id → geometry map,
    // rebuilt from the Figure nodes at save and applied to them at load. (Slice
    // #3 adds live container write-back; serialize/deserialize stay as-is.)
    private readonly _visuals = new NodeVisualStore();

    // Opaque, app-owned document metadata persisted inside the serialized
    // diagram (see SerializedDiagram.metadata). mural never reads the keys;
    // a consumer stores data that must travel WITH the .diagram file. Get
    // returns a shallow copy; set replaces.
    private _metadata: Record<string, unknown> = {};
    public get Metadata(): Record<string, unknown> { return { ...this._metadata }; }
    public set Metadata(v: Record<string, unknown>) { this._metadata = { ...v }; }

    // Per-item teardown thunks for the dirty-on-edit listeners (see _trackEdits).
    // A route drag, endpoint reconnect, or node move mutates a Connector / node
    // DIRECTLY — not through a mutation method — so without these the document
    // never learns it has unsaved changes and the shell's Save command (gated on
    // IsDirty) stays disabled. Keyed by the node / connector; cleared on removal.
    private readonly _nodeDirtyTeardown      = new Map<object, () => void>();
    private readonly _connectorDirtyTeardown = new Map<object, () => void>();
    // Content VMs carry no geometry, so _wireNodeDirty finds nothing to watch on
    // them; their geometry lives on the container Figure. This tracks the dirty
    // listener wired on that container (in _onContainerBound), keyed by the VM.
    private readonly _containerDirtyTeardown = new Map<NodeViewModel, () => void>();

    // Guards the view→document mirror so a pulled value isn't written straight
    // back out to the view (which would loop).
    private _syncingFromView = false;
    // The view we're currently mirroring state from — kept so we can detach.
    private _mirrorView: Diagram | undefined;
    // Signal subscriptions for the five mirrored view properties — disposed when
    // the view is swapped out in _rebindViewMirror.
    private _mirrorViewSubs: Disposable[] = [];

    // The view whose ContainerBound signal we're subscribed to (kept so we can
    // detach on ActiveView change). When a Figure container binds to a content
    // VM, seed the container's geometry from the visual store — the container,
    // not the VM, owns geometry (slice #3). Connector re-pointing hooks here too.
    private _boundView: Diagram | undefined;
    private readonly _onContainerBound = (container: Figure, item: unknown): void =>
    {
        if (!(item instanceof NodeViewModel)) return;
        const id = item.Id;
        if (id === undefined || id === '') return;
        const v = this._visuals.Get(id);
        if (v !== undefined) this._visuals.Apply(v, container);
        // Wire dirty-on-move/resize on the container (AFTER applying the saved
        // geometry, so the seed itself doesn't self-dirty). Without this a
        // content node's move never marks the document dirty — its geometry
        // lives on the container, which _wireNodeDirty (keyed on the VM) can't see.
        this._wireContainerDirty(item, container);
        this._repointEndpointsToContainer(id, item, container);
    };

    // Mark the document dirty when the user moves / resizes / rotates a content
    // node's container. Rewired if the container is recycled onto the same VM;
    // torn down when the node is removed (_wireNodeDirty's teardown) or the view
    // is swapped (_rebindContainerBound).
    private _wireContainerDirty(item: NodeViewModel, container: Figure): void
    {
        this._containerDirtyTeardown.get(item)?.();
        const onEdited = (): void => this._markDirty();
        // Geometry AND card style live on the container, not the VM — a Format
        // Shape fill/stroke edit on a content node lands here (mirrors the
        // Fill/Stroke tracking _wireNodeDirty does for a geometric Figure).
        const keys = (['Left', 'Top', 'Width', 'Height', 'Rotation', 'Fill', 'Stroke'] as const)
            .map(n => resolveKey(container, undefined, n));
        const keySubs = keys.map(k => container.PropertyChanged(k).subscribe(onEdited));
        // In-place Stroke-pen tracking, rewired on a Stroke reference swap.
        let offPen = this._wirePenDirty(container.Stroke, onEdited);
        const strokeKey = resolveKey(container, undefined, 'Stroke');
        const rewirePen = (): void => { offPen(); offPen = this._wirePenDirty(container.Stroke, onEdited); };
        const strokeSub = container.PropertyChanged(strokeKey).subscribe(rewirePen);
        this._containerDirtyTeardown.set(item, () => {
            for (const sub of keySubs) sub.dispose();
            strokeSub.dispose();
            offPen();
        });
    }

    // Re-point any connector endpoint that references this VM node — by
    // preserved id (rehydrateEndpoint deferred it) or directly by the VM object
    // — at the freshly-bound container Figure, which owns the geometry and side-
    // endpoint host. Setting Node clears the UnresolvedNodeId hold so the
    // connector routes against the container.
    // Re-home a connector endpoint that references a content VM onto the VM's
    // geometry-owning container Figure when that container is already realized.
    // This is the path a caller hits when it creates an edge AFTER the containers
    // bound — e.g. the Plexus arch binding projecting a model edge — where no
    // fresh ContainerBound will fire to re-point it, so it must resolve up front
    // or route against a geometry-less VM and never draw. If the container isn't
    // realized yet, the VM reference is left in place: _repointEndpointsToContainer
    // catches `ep.Node === item` when the container later binds. Endpoints that
    // already reference a Figure (or a free point) pass through untouched.
    private _hostEndpoint(ep: ConnectorEndpoint): ConnectorEndpoint
    {
        const node = ep.Node;
        if (!(node instanceof NodeViewModel)) return ep;
        const container = this.ActiveView?.Generator.ContainerFromItem(node);
        if (container instanceof Figure) ep.Node = container;
        return ep;
    }

    private _repointEndpointsToContainer(id: string, item: NodeViewModel, container: Figure): void
    {
        for (let i = 0; i < this.Connectors.Count; i++)
        {
            const c = this.Connectors.Get(i)!;
            for (const ep of [c.Source, c.Target])
            {
                if (ep === undefined || ep.Node === container) continue;
                if (ep.UnresolvedNodeId === id || ep.Node === item)
                {
                    ep.Node             = container;
                    ep.UnresolvedNodeId = undefined;
                }
            }
        }
    }

    // Per-document undo/redo. Records visual edits (this diagram layer) plus any
    // externally-registered layers (Plexus registers the TODL model layer).
    private readonly _history = new DiagramHistory();

    constructor(storage?: DiagramStorage)
    {
        super();
        this.set_property_value(DiagramDocument.IdKey,            'diagram-' + (++_diagramDocSeq));
        this.set_property_value(DiagramDocument.InspectorKey,     new DiagramInspector());
        this.set_property_value(DiagramDocument.NodesKey,         new ObservableCollection<Figure | Group | NodeViewModel>());
        this.set_property_value(DiagramDocument.ConnectorsKey,    new ObservableCollection<Connector>());
        this.set_property_value(DiagramDocument.StorageKey,       storage);
        this._trackEdits();
        // The palette lives in the framework ToolboxRepository (a Services
        // singleton the Diagram first-inits with a built-in Shapes page); the
        // document no longer owns a ToolboxShapes collection.

        // Save / Load RelayCommands — gated on Storage presence.
        const canPersist = (): boolean => this.Storage !== undefined;
        this.set_property_value(DiagramDocument.SaveCommandKey,
            new RelayCommand(() => this.Save(), canPersist,
                { Text: 'Save',
                  Description: 'Serialize the current canvas to the configured storage.' }));
        this.set_property_value(DiagramDocument.LoadCommandKey,
            new RelayCommand(() => this.Load(), canPersist,
                { Text: 'Load',
                  Description: 'Restore the most recently saved canvas.' }));

        // The native diagram layer: snapshot = the v3 serialization, restore =
        // deserialize. Registered last so every field _serialize reads is set.
        // Capture is resilient: a mid-mutation transient (e.g. a half-set connector
        // endpoint during a cascade delete) can make _serialize throw; falling back
        // to the last good snapshot makes that transaction a no-op instead of
        // crashing, and the next serializable edit records normally.
        let lastGood: SerializedDiagram | undefined;
        this._history.RegisterLayer({
            Id: HistoryLayerId.Diagram,
            Capture: () => { try { lastGood = this._serialize(); }
            catch { /* transient — keep last good */ } return lastGood; },
            Equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
            Restore: (s) => { if (s !== undefined) this._deserialize(s as SerializedDiagram); },
        });
    }

    // The document's undo/redo history. Consumers register additional layers
    // (e.g. a model layer) and the diagram's edit brackets drive its transactions.
    public get History(): DiagramHistory { return this._history; }
    public Undo(): void { this._history.Undo(); }
    public Redo(): void { this._history.Redo(); }

    // IDocument accessors. Id is stable; Title is settable (a tab strip binds
    // it); IsDirty is read-only to the world — flipped internally by mutations
    // and cleared by Save / Load.
    public get Id():            string  { return this.get_property_value(DiagramDocument.IdKey); }
    public get Title():         string  { return this.get_property_value(DiagramDocument.TitleKey); }
    public set Title(v: string)         { this.set_property_value(DiagramDocument.TitleKey, v); }
    public get IsDirty():       boolean { return this.get_property_value(DiagramDocument.IsDirtyKey); }
    public get ActiveView():    Diagram | undefined { return this.get_property_value(DiagramDocument.ActiveViewKey); }
    public set ActiveView(v: Diagram | undefined)   { this.set_property_value(DiagramDocument.ActiveViewKey, v); }
    public get Inspector():     DiagramInspector { return this.get_property_value(DiagramDocument.InspectorKey); }

    // Mark the document as having unsaved edits. Called from every structural
    // mutation; cleared by Save / Load. Private — dirtiness is derived, not set
    // from outside.
    private _markDirty(): void
    {
        this.set_property_value(DiagramDocument.IsDirtyKey, true);
        this._history.NotifyEdited();   // safety net: coalesce any un-bracketed edit
    }

    // Observe the Nodes / Connectors collections so an in-place edit — a route
    // drag (Waypoints), an endpoint reconnect (endpoint.Node / FreePoint), a
    // routing-mode flip, or a node move / resize — flips IsDirty. Structural
    // add / delete already dirty through the mutation methods; this covers the
    // edits that mutate a live node or connector directly. Load / Save clear
    // IsDirty AFTER their work, so the rehydration writes below don't leave a
    // freshly opened or just-saved document falsely dirty.
    private _trackEdits(): void
    {
        this.Nodes.Subscribe(ch => this._reconcileDirtyListeners(
            ch, this._nodeDirtyTeardown, n => this._wireNodeDirty(n)));
        this.Connectors.Subscribe(ch => this._reconcileDirtyListeners(
            ch, this._connectorDirtyTeardown, c => this._wireConnectorDirty(c)));
    }

    private _reconcileDirtyListeners<T extends object>(
        change:   CollectionChange<T>,
        teardowns: Map<object, () => void>,
        wire:     (item: T) => () => void,
    ): void
    {
        const track = (item: T): void => {
            if (teardowns.has(item)) return;
            teardowns.set(item, wire(item));
        };
        const untrack = (item: object): void => {
            const off = teardowns.get(item);
            if (off !== undefined) { off(); teardowns.delete(item); }
        };
        switch (change.kind)
        {
            case 'inserted': for (const it of change.items) track(it); break;
            case 'removed':  for (const it of change.items) untrack(it); break;
            case 'replaced': untrack(change.oldItem); track(change.newItem); break;
            case 'cleared':  for (const off of teardowns.values()) off(); teardowns.clear(); break;
            // 'moved' preserves identity — the listeners already cover it.
        }
    }

    // A move / resize (Left / Top / Width / Height) or a format edit (Fill /
    // Stroke, from the Format Shape pane) is a persisted change. Fill and the
    // Stroke pen reference swap fire the node's own DP; the Stroke pen's paint
    // is ALSO edited in place (FormatMirror mutates Brush / Thickness on the
    // existing Pen), which fires on the Pen, so track the current pen too and
    // rewire it when the Stroke reference swaps. Skip any DP the node lacks
    // (a bare Group has none — nothing to observe).
    private _wireNodeDirty(node: Figure | Group | NodeViewModel): () => void
    {
        const ctor = node.constructor;
        const onEdited = (): void => this._markDirty();
        const names = (['Left', 'Top', 'Width', 'Height', 'Fill', 'Stroke'] as const)
            .filter(n => MuralBase.HasProperty(ctor, n));
        const keys = names.map(n => resolveKey(node, undefined, n));
        const keySubs = keys.map(k => node.PropertyChanged(k).subscribe(onEdited));

        // A content VM (an arch node) carries no Fill/Stroke/geometry of its own —
        // its persisted style lives in its own DPs (e.g. the label text style). The
        // standard keys above find nothing to watch on it, so let a node declare
        // the extra style keys whose edit should dirty the document.
        const extraKeys = (node as { DirtyStyleKeys?: () => PropertyKey<unknown>[] }).DirtyStyleKeys?.() ?? [];
        const extraSubs = extraKeys.map(k => node.PropertyChanged(k).subscribe(onEdited));

        // In-place Stroke-pen tracking, rewired on a Stroke reference swap.
        const strokeHost = node as { Stroke?: Pen };
        let offPen = this._wirePenDirty(strokeHost.Stroke, onEdited);
        const rewirePen = (): void => { offPen(); offPen = this._wirePenDirty(strokeHost.Stroke, onEdited); };
        const hasStroke = MuralBase.HasProperty(ctor, 'Stroke');
        const strokeKey = hasStroke ? resolveKey(node, undefined, 'Stroke') : undefined;
        const strokeSub = strokeKey !== undefined ? node.PropertyChanged(strokeKey).subscribe(rewirePen) : undefined;

        return () => {
            for (const sub of keySubs) sub.dispose();
            for (const sub of extraSubs) sub.dispose();
            strokeSub?.dispose();
            offPen();
            // Content-VM nodes also carry a container-geometry dirty listener
            // (wired in _onContainerBound) — drop it when the node is removed.
            const offContainer = this._containerDirtyTeardown.get(node as NodeViewModel);
            if (offContainer !== undefined) { offContainer(); this._containerDirtyTeardown.delete(node as NodeViewModel); }
        };
    }

    private _wirePenDirty(pen: Pen | undefined, onEdited: () => void): () => void
    {
        if (pen === undefined) return () => {};
        const brushSub     = pen.PropertyChanged(Pen.BrushKey).subscribe(onEdited);
        const thicknessSub = pen.PropertyChanged(Pen.ThicknessKey).subscribe(onEdited);
        return () => {
            brushSub.dispose();
            thicknessSub.dispose();
        };
    }

    // Track the connector's user-editable route inputs, plus each endpoint's
    // connection fields (rewired when Source / Target swap). PortSide / PortIndex
    // are deliberately NOT tracked — those are baked / rebalanced automatically
    // as a route settles, which would falsely dirty a freshly opened document;
    // a genuine endpoint reconnect still dirties through the endpoint's Node.
    private _wireConnectorDirty(conn: Connector): () => void
    {
        const onEdited = (): void => this._markDirty();
        const waypointsSub   = conn.PropertyChanged(Connector.WaypointsKey).subscribe(onEdited);
        const routingModeSub = conn.PropertyChanged(Connector.RoutingModeKey).subscribe(onEdited);
        const sourceSub      = conn.PropertyChanged(Connector.SourceKey).subscribe(onEdited);
        const targetSub      = conn.PropertyChanged(Connector.TargetKey).subscribe(onEdited);

        let offSrc = this._wireEndpointDirty(conn.Source, onEdited);
        let offTgt = this._wireEndpointDirty(conn.Target, onEdited);
        const rewireSrc = (): void => { offSrc(); offSrc = this._wireEndpointDirty(conn.Source, onEdited); };
        const rewireTgt = (): void => { offTgt(); offTgt = this._wireEndpointDirty(conn.Target, onEdited); };
        const rewireSrcSub = conn.PropertyChanged(Connector.SourceKey).subscribe(rewireSrc);
        const rewireTgtSub = conn.PropertyChanged(Connector.TargetKey).subscribe(rewireTgt);

        return () => {
            waypointsSub.dispose();
            routingModeSub.dispose();
            sourceSub.dispose();
            targetSub.dispose();
            rewireSrcSub.dispose();
            rewireTgtSub.dispose();
            offSrc(); offTgt();
        };
    }

    private _wireEndpointDirty(ep: ConnectorEndpoint | undefined, onEdited: () => void): () => void
    {
        if (ep === undefined) return () => {};
        const subs = [
            ep.PropertyChanged(ConnectorEndpoint.NodeKey).subscribe(onEdited),
            ep.PropertyChanged(ConnectorEndpoint.FreePointKey).subscribe(onEdited),
            ep.PropertyChanged(ConnectorEndpoint.PortNameKey).subscribe(onEdited),
        ];
        return () => { for (const sub of subs) sub.dispose(); };
    }

    // ── ICommandTarget surface — the diagram as a command dispatch target ──
    // The ToolbarService reads CommandContexts to decide which commands show,
    // and calls Execute / CanExecute to run / gate them. Each is resolved through
    // DIAGRAM_COMMAND_GETTERS against the published ActiveView (the control that
    // owns the selection-driven commands); an unrecognised id or a document with
    // no live view is a no-op / disabled.
    public get CommandContexts(): readonly ServiceToken<unknown>[] { return DIAGRAM_COMMAND_CONTEXTS; }

    public Execute(definition: CommandDefinition): void
    {
        this._commandFor(definition.Id)?.Execute(undefined);
    }

    public CanExecute(definition: CommandDefinition): boolean
    {
        return this._commandFor(definition.Id)?.CanExecute(undefined) ?? false;
    }

    // Toggle state for the Toggles-presentation commands (text-align / text-style)
    // — read off the live view's Selection* DPs. Non-toggle or unknown ids, or no
    // active view, are never active.
    public IsActive(definition: CommandDefinition): boolean
    {
        const view = this.ActiveView;
        if (view === undefined) return false;
        return DIAGRAM_COMMAND_ACTIVE.get(definition.Id)?.(view) ?? false;
    }

    private _commandFor(id: string): ICommand | undefined
    {
        const view = this.ActiveView;
        if (view === undefined) return undefined;
        return DIAGRAM_COMMAND_GETTERS.get(id)?.(view);
    }

    // ── IFontFormatSink accessors ──────────────────────────────────────────
    public get FontFamily(): string  { return this.get_property_value(DiagramDocument.FontFamilyKey); }
    public set FontFamily(v: string) { this.set_property_value(DiagramDocument.FontFamilyKey, v); }
    public get FontSize(): number  { return this.get_property_value(DiagramDocument.FontSizeKey); }
    public set FontSize(v: number) { this.set_property_value(DiagramDocument.FontSizeKey, v); }
    public get FontColorHex(): string  { return this.get_property_value(DiagramDocument.FontColorHexKey); }
    public set FontColorHex(v: string) { this.set_property_value(DiagramDocument.FontColorHexKey, v); }
    public get IncreaseFontSizeCommand(): ICommand | undefined { return this.get_property_value(DiagramDocument.IncreaseFontSizeCommandKey); }
    public get DecreaseFontSizeCommand(): ICommand | undefined { return this.get_property_value(DiagramDocument.DecreaseFontSizeCommandKey); }

    public get ConnectorsModePinned(): boolean  { return this.get_property_value(DiagramDocument.ConnectorsModePinnedKey); }
    public set ConnectorsModePinned(v: boolean) { this.set_property_value(DiagramDocument.ConnectorsModePinnedKey, v); }
    public get FormatPainterActive(): boolean  { return this.get_property_value(DiagramDocument.FormatPainterActiveKey); }
    public set FormatPainterActive(v: boolean) { this.set_property_value(DiagramDocument.FormatPainterActiveKey, v); }

    // Re-point the view mirror at a new ActiveView: detach the old view's mirrored
    // listeners (font selection + connectors mode), attach the new one's, refresh
    // the step commands, and pull the initial values. With no view the step
    // commands clear.
    private _rebindViewMirror(view: Diagram | undefined): void
    {
        for (const sub of this._mirrorViewSubs) sub.dispose();
        this._mirrorViewSubs = [];
        this._mirrorView = view;
        this.set_property_value(DiagramDocument.IncreaseFontSizeCommandKey, view?.IncreaseFontSizeCommand);
        this.set_property_value(DiagramDocument.DecreaseFontSizeCommandKey, view?.DecreaseFontSizeCommand);
        if (view !== undefined)
        {
            const onChanged = (): void => this._pullFromView();
            this._mirrorViewSubs = [
                view.PropertyChanged(Diagram.SelectionFontFamilyKey).subscribe(onChanged),
                view.PropertyChanged(Diagram.SelectionFontSizeKey).subscribe(onChanged),
                view.PropertyChanged(Diagram.SelectionFontColorHexKey).subscribe(onChanged),
                view.PropertyChanged(Diagram.ConnectorsModePinnedKey).subscribe(onChanged),
                view.PropertyChanged(Diagram.FormatPainterActiveKey).subscribe(onChanged),
            ];
            this._pullFromView();
        }
    }

    // Re-point the ContainerBound subscription at a new ActiveView: detach the
    // old view's listener, attach the new one's, then sweep its already-realized
    // VM containers (a document re-activated onto a view whose containers realized
    // before this subscription existed gets no fresh ContainerBound for them).
    private _rebindContainerBound(view: Diagram | undefined): void
    {
        if (this._boundView !== undefined)
        {
            this._boundView.RemoveContainerBoundListener(this._onContainerBound);
            // The old view's containers are gone — drop their geometry-dirty
            // listeners. The sweep below rewires them against the new view.
            for (const off of this._containerDirtyTeardown.values()) off();
            this._containerDirtyTeardown.clear();
        }
        this._boundView = view;
        if (view === undefined) return;
        view.AddContainerBoundListener(this._onContainerBound);
        for (let i = 0; i < this.Nodes.Count; i++)
        {
            const n = this.Nodes.Get(i)!;
            if (!(n instanceof NodeViewModel)) continue;
            const c = view.Generator.ContainerFromItem(n);
            if (c instanceof Figure) this._onContainerBound(c, n);
        }
    }

    // Mirror the live view's editable state onto our DPs (guarded so the write-
    // through in OnPropertyChanged doesn't echo it straight back).
    private _pullFromView(): void
    {
        const view = this._mirrorView;
        if (view === undefined) return;
        this._syncingFromView = true;
        try
        {
            this.FontFamily           = view.SelectionFontFamily;
            this.FontSize             = view.SelectionFontSize;
            this.FontColorHex         = view.SelectionFontColorHex;
            this.ConnectorsModePinned = view.ConnectorsModePinned;
            this.FormatPainterActive  = view.FormatPainterActive;
        }
        finally { this._syncingFromView = false; }
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor, oldValue: unknown, newValue: unknown): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        // Keep the inspector's View in lock-step with the published control, so
        // the Format Shape pane reaches the live selection-format state.
        if (descriptor.Name === 'ActiveView')
        {
            this.Inspector.View = newValue as Diagram | undefined;
            this._rebindViewMirror(newValue as Diagram | undefined);
            this._rebindContainerBound(newValue as Diagram | undefined);
        }
        // An editor write flows OUT to the view (unless it's the mirror pulling IN).
        else if (!this._syncingFromView && this._mirrorView !== undefined)
        {
            if      (descriptor.Name === 'FontFamily')           this._mirrorView.SelectionFontFamily   = newValue as string;
            else if (descriptor.Name === 'FontSize')             this._mirrorView.SelectionFontSize     = newValue as number;
            else if (descriptor.Name === 'FontColorHex')         this._mirrorView.SelectionFontColorHex = newValue as string;
            else if (descriptor.Name === 'ConnectorsModePinned') this._mirrorView.ConnectorsModePinned  = newValue as boolean;
            else if (descriptor.Name === 'FormatPainterActive')  this._mirrorView.FormatPainterActive   = newValue as boolean;
        }
    }

    public get Nodes():         ObservableCollection<Figure | Group | NodeViewModel> { return this.get_property_value(DiagramDocument.NodesKey); }
    public get Connectors():    ObservableCollection<Connector>      { return this.get_property_value(DiagramDocument.ConnectorsKey); }
    public get Status():        string                               { return this.get_property_value(DiagramDocument.StatusKey); }
    public set Status(v: string)                                     { this.set_property_value(DiagramDocument.StatusKey, v); }
    public get Storage():       DiagramStorage | undefined           { return this.get_property_value(DiagramDocument.StorageKey); }
    public set Storage(v: DiagramStorage | undefined)                { this.set_property_value(DiagramDocument.StorageKey, v); }
    public get SaveCommand():   RelayCommand | undefined             { return this.get_property_value(DiagramDocument.SaveCommandKey); }
    public get LoadCommand():   RelayCommand | undefined             { return this.get_property_value(DiagramDocument.LoadCommandKey); }

    // ── Mutation API (DiagramMutator surface) ──────────────────────

    public CreateNode(kind: string, x: number, y: number): Figure | null
    {
        if (!SHAPE_CATALOG_MAP.has(kind)) return null;
        const node = Figure.fromKind(kind, x, y);
        node.Id = 'n' + this._nextId++;
        this.Nodes.Add(node);
        this.Status = `Placed ${kind}. ${this.Nodes.Count} nodes.`;
        this._markDirty();
        return node;
    }

    public AddNode(node: NodeViewModel): void
    {
        this.Nodes.Add(node);
    }

    // ── Figure clipboard (Phase 1: pure figures) ───────────────────────
    //
    // Injectable clipboard seam — the OS clipboard by default (so copy in one
    // document pastes into another window, and it participates in the real
    // system clipboard). Node-safe: no-ops when navigator.clipboard is absent
    // (headless tests); tests swap a synchronous fake. Mirrors RichTextBox's
    // ClipboardSink pattern.
    public static Clipboard: ClipboardSink = {
        async Read(): Promise<string>
        {
            const nav = (globalThis as { navigator?: { clipboard?: { readText?: () => Promise<string> } } }).navigator;
            return nav?.clipboard?.readText === undefined ? '' : nav.clipboard.readText();
        },
        async Write(text: string): Promise<void>
        {
            const nav = (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } }).navigator;
            if (nav?.clipboard?.writeText !== undefined) await nav.clipboard.writeText(text);
        },
    };

    // Cascade state: repeated pastes of the SAME clipboard text step the offset
    // (+16 each) so duplicates don't stack exactly. A different clipboard text
    // resets the cascade.
    private _pasteCascadeText: string | undefined = undefined;
    private _pasteCascade = 0;

    /**
     * Snapshot the selected figures (plus any nested descendants) and every
     * connector wholly within that set onto the clipboard. Writes the tagged
     * clipboard text via the injectable sink (fire-and-forget). Empty selection
     * is a no-op — it must not clobber the existing clipboard.
     */
    public CopySelection(items: readonly unknown[], _connectors: readonly Connector[]): void
    {
        const copied = this._copiedIdSet(items);
        if (copied.size === 0) return;

        const nodes: SerializedNode[] = [];
        const visuals: Record<string, NodeVisual> = {};
        for (let i = 0; i < this.Nodes.Count; i++)
        {
            const node = this.Nodes.Get(i)!;
            const id = (node as { Id?: string }).Id ?? '';
            if (id === '' || !copied.has(id)) continue;
            const s = serializerFor(node);
            if (s === undefined) continue;
            nodes.push({ id, type: s.type, data: s.serialize(node) });
            if (node instanceof Figure) visuals[id] = this._visuals.Read(node);
        }
        if (nodes.length === 0) return;

        const connectors: SerializedConnector[] = [];
        for (let i = 0; i < this.Connectors.Count; i++)
        {
            const c = this.Connectors.Get(i)!;
            if (c.Source === undefined || c.Target === undefined) continue;
            const sId = endpointNodeId(c.Source), tId = endpointNodeId(c.Target);
            if (sId === undefined || tId === undefined || !copied.has(sId) || !copied.has(tId)) continue;
            connectors.push(serializeConnectorRecord(c));
        }

        void DiagramDocument.Clipboard.Write(encodeClipboard({ nodes, visuals, connectors }));
    }

    /**
     * Read the clipboard and materialize its figures + connectors as a fresh
     * copy: new ids, a cascading offset, ParentId + connector endpoints remapped
     * to the pasted nodes. Foreign / empty clipboard text is a no-op. Async — it
     * awaits the clipboard read before mutating.
     */
    public async PasteClipboard(): Promise<void>
    {
        const text = await DiagramDocument.Clipboard.Read();
        const payload = decodeClipboard(text);
        if (payload === undefined || payload.nodes.length === 0) return;

        if (text === this._pasteCascadeText) this._pasteCascade += 1;
        else { this._pasteCascadeText = text; this._pasteCascade = 1; }
        const delta = 16 * this._pasteCascade;

        // Pass 1: build each node with a fresh id, recording old→new so ParentId
        // and connector endpoints can remap.
        const idMap = new Map<string, string>();
        const byNewId = new Map<string, Figure | NodeViewModel>();
        const created: { node: Figure | NodeViewModel; oldId: string }[] = [];
        for (const raw of payload.nodes as SerializedNode[])
        {
            const s = serializerByType(raw.type);
            if (s === undefined) continue;
            const node = s.deserialize(raw.data ?? {}) as Figure | NodeViewModel;
            const newId = 'n' + this._nextId++;
            idMap.set(raw.id, newId);
            node.Id = newId;
            byNewId.set(newId, node);
            created.push({ node, oldId: raw.id });
        }

        // Pass 2: apply geometry (offset + remapped ParentId), then add.
        const visuals = payload.visuals as Record<string, NodeVisual>;
        for (const { node, oldId } of created)
        {
            const v = visuals[oldId];
            if (v !== undefined && node instanceof Figure)
            {
                const remapped: NodeVisual = { ...v, left: v.left + delta, top: v.top + delta };
                if (v.parentId !== undefined)
                {
                    const np = idMap.get(v.parentId);
                    if (np !== undefined) remapped.parentId = np; else delete remapped.parentId;
                }
                this._visuals.Apply(remapped, node);
            }
            this.Nodes.Add(node);
        }

        // Pass 3: connectors — remap endpoints to the pasted nodes; drop any
        // whose node fell outside the paste set.
        for (const raw of payload.connectors as SerializedConnector[])
        {
            const src = remapEndpoint(raw.source, idMap, delta);
            const tgt = remapEndpoint(raw.target, idMap, delta);
            if (src === undefined || tgt === undefined) continue;
            const c = new Connector();
            if (typeof raw.routingMode === 'string') c.RoutingMode = raw.routingMode;
            c.Source = rehydrateEndpoint(src, byNewId);
            c.Target = rehydrateEndpoint(tgt, byNewId);
            if (raw.waypoints !== undefined && raw.waypoints.length > 0)
            {
                c.Waypoints = raw.waypoints.map(p => waypoint(new Point(p.x + delta, p.y + delta), p.userAltered ?? true));
            }
            if (raw.text !== undefined) applySerializedText(c.Text, raw.text);
            if (typeof raw.labelPos === 'number') c.LabelPosition = raw.labelPos;
            this.Connectors.Add(c);
        }

        this._markDirty();
    }

    // Figure ids to copy: the selected figures plus every descendant nested
    // inside a copied container (transitive via ParentId), so copying a
    // container brings its contents.
    private _copiedIdSet(items: readonly unknown[]): Set<string>
    {
        const copied = new Set<string>();
        for (const it of items)
        {
            if (it instanceof Figure && it.Id !== undefined && it.Id !== '') copied.add(it.Id);
        }
        let changed = true;
        while (changed)
        {
            changed = false;
            for (let i = 0; i < this.Nodes.Count; i++)
            {
                const n = this.Nodes.Get(i)!;
                if (!(n instanceof Figure)) continue;
                const id = n.Id;
                if (id === undefined || id === '' || copied.has(id)) continue;
                if (n.ParentId !== undefined && copied.has(n.ParentId)) { copied.add(id); changed = true; }
            }
        }
        return copied;
    }

    public DeleteNodes(items: readonly unknown[]): void
    {
        if (items.length === 0) return;
        let removed = 0;
        for (const item of items)
        {
            if (!(item instanceof Figure || item instanceof Group || item instanceof NodeViewModel)) continue;
            // A container's children are re-homed to root (or its own parent) BEFORE
            // the box is removed, so they survive rather than being torn down with
            // the ChildHost (data-loss guard). Needs the live view (children are
            // realized visual descendants); the headless sweep below covers the rest.
            if (item instanceof ContainerFigure) this._boundView?.ContainerPlacement.reHome(item);
            // Detach from parent group bookkeeping first if any.
            if ((item instanceof Figure || item instanceof Group) && item.Parent !== undefined) item.Parent._removeMember(item);
            const idx = this.Nodes.IndexOf(item);
            if (idx < 0) continue;
            this.Nodes.RemoveAt(idx);
            removed++;
        }
        // Headless / unrealized safety net: clear the membership tag on any node
        // still naming a just-removed container, so no child dangles at a dead
        // parentId. reHome already cleared realized children via reparent; this is
        // idempotent for them.
        const removedContainerIds = new Set<string>();
        for (const item of items)
            if (item instanceof ContainerFigure && item.Id !== undefined) removedContainerIds.add(item.Id);
        if (removedContainerIds.size > 0)
            for (let i = 0; i < this.Nodes.Count; i++)
            {
                const n = this.Nodes.Get(i);
                if (n instanceof Figure && n.ParentId !== undefined && removedContainerIds.has(n.ParentId))
                    n.ParentId = undefined;
            }
        // Cascade: drop any connector whose endpoint references a
        // removed node. Without this, a Figure deletion leaves the
        // connector pointing at a detached Visual.
        if (removed > 0)
        {
            const orphanedCount = this._cascadeRemoveConnectorsFor(items);
            // Callout cleanup: detach any removed callout from its target, and
            // clear the leader on any surviving callout whose target was removed
            // (mirrors the connector DetachFromHosts cascade above).
            for (const item of items)
            {
                if (item instanceof Callout) item.DetachLeader();
            }
            for (let i = 0; i < this.Nodes.Count; i++)
            {
                const n = this.Nodes.Get(i);
                if (n instanceof Callout
                    && n.LeaderTargetNode !== undefined
                    && items.includes(n.LeaderTargetNode as unknown))
                {
                    n.LeaderTargetNode = undefined;
                }
            }
            const orphanSuffix = orphanedCount > 0
                ? ` + ${orphanedCount} orphaned connector${orphanedCount === 1 ? '' : 's'}`
                : '';
            this.Status = `Deleted ${removed} node${removed === 1 ? '' : 's'}${orphanSuffix}. `
                        + `${this.Nodes.Count} remain.`;
            this._markDirty();
        }
    }

    // Remove every connector whose endpoint references one of `removed`,
    // matched by node IDENTITY *or* by Id — so a connector pointing at a STALE
    // node object (e.g. a re-created node that carries the same Id) is caught,
    // not just an exact-object match. Detaches each removed connector from its
    // host side-registries so the survivors rebalance. Returns the count.
    //
    // Shared by every node-removal path (DeleteNodes / CombineSelection /
    // Ungroup): a connector left behind after its node is gone can't route, so
    // it vanishes from the canvas yet lingers in doc.Connectors and gets saved
    // as a ghost at the origin. Routing all removals through here closes that.
    private _cascadeRemoveConnectorsFor(removed: readonly unknown[]): number
    {
        if (removed.length === 0) return 0;
        const objs = new Set<unknown>(removed);
        const ids  = new Set<string>();
        for (const n of removed)
        {
            const id = nodeIdOf(n);
            if (id !== undefined && id !== '') ids.add(id);
        }
        const hits = (ep: ConnectorEndpoint | undefined): boolean =>
        {
            const node = ep?.Node;
            if (node === undefined) return false;
            if (objs.has(node)) return true;
            const id = nodeIdOf(node);
            return id !== undefined && id !== '' && ids.has(id);
        };
        const orphaned: Connector[] = [];
        for (let i = 0; i < this.Connectors.Count; i++)
        {
            const c = this.Connectors.Get(i)!;
            if (hits(c.Source) || hits(c.Target)) orphaned.push(c);
        }
        for (const o of orphaned)
        {
            const idx = this.Connectors.IndexOf(o);
            if (idx >= 0) this.Connectors.RemoveAt(idx);
            // Release the connector's host subscriptions so the siblings that
            // share a side rebalance to the smaller slot count.
            o.DetachFromHosts();
        }
        return orphaned.length;
    }

    public CreateConnector(source: ConnectorEndpoint, target: ConnectorEndpoint): Connector | null
    {
        // items-are-Connectors convention. The materializer in
        // [collaborators/diagram-connectors-materializer.ts] recognizes
        // a Connector entry as already-a-Visual and skips template
        // application, so the freshly-constructed instance below IS
        // what renders on the diagram.
        const c = new Connector();
        // Geometry lives on the container Figure, never on the content VM
        // (container-owned-geometry). A caller that hands us a VM endpoint —
        // e.g. the Plexus arch binding projecting a model edge AFTER the
        // containers already bound — must be re-homed onto the container, or
        // the connector routes against a geometry-less VM and never draws.
        c.Source = this._hostEndpoint(source);
        c.Target = this._hostEndpoint(target);
        this.Connectors.Add(c);
        this.Status = `Added connector. ${this.Connectors.Count} connectors total.`;
        this._markDirty();
        return c;
    }

    public DeleteConnectors(connectors: readonly Connector[]): void
    {
        if (connectors.length === 0) return;
        let removed = 0;
        for (const c of connectors)
        {
            const idx = this.Connectors.IndexOf(c);
            if (idx < 0) continue;
            this.Connectors.RemoveAt(idx);
            // Release the connector's host subscriptions so the siblings
            // that share a side rebalance to the smaller slot count.
            c.DetachFromHosts();
            removed++;
        }
        if (removed > 0)
        {
            this.Status = `Deleted ${removed} connector${removed === 1 ? '' : 's'}. ${this.Connectors.Count} remain.`;
            this._markDirty();
        }
    }

    /** Wrap the top-level entries of `items` in a new Group.
     *  The new Group is inserted at the LOWEST index of any selected
     *  member so its bbox renders BEHIND its members in z-order. */
    public Group(items: readonly unknown[]): void
    {
        // Only geometry-bearing nodes (Figures + nested Groups) are groupable;
        // content VMs delegate geometry to their container and can't be group
        // members (see Group.GroupMember).
        const selection = this._topLevel(items).filter(
            (m): m is Figure | Group => m instanceof Figure || m instanceof Group);
        if (selection.length < 2) return;
        const grp = new Group();
        let minIdx = this.Nodes.Count;
        for (const m of selection)
        {
            const idx = this.Nodes.IndexOf(m);
            if (idx >= 0 && idx < minIdx) minIdx = idx;
        }
        for (const m of selection)
        {
            if (m.Parent !== undefined) m.Parent._removeMember(m);
            m.Parent = grp;
            grp.Members.Add(m);
        }
        this.Nodes.Insert(minIdx, grp);
        grp.IsSelected = true;
        for (const leaf of grp.EnumerateLeaves())
        {
            if (leaf instanceof Figure) leaf.IsSelected = false;
        }
        for (const sub  of grp.EnumerateSubGroups()) sub.IsSelected = false;
        this.Status = `Grouped ${selection.length} items.`;
        this._markDirty();
    }

    /** Wrap the current top-level selection in a new ContainerFigure. Data
     *  mutation only: create the container sized to enclose the selection, claim
     *  each node via ParentId, and convert each node's Left/Top to container-local
     *  so its on-screen position is preserved when the RESTORE pass (placeAll,
     *  driven by the container's ContainerBound on realize) re-parents it into the
     *  container's ChildHost. No-op below one target. */
    public WrapInContainer(items: readonly unknown[]): void
    {
        const targets = wrapTargets(items);
        if (targets.length < 1) return;
        const box = containerGeometryFor(targets);
        const container = Figure.fromKind('container', box.left, box.top,
                                          { width: box.width, height: box.height }) as ContainerFigure;
        container.Id = 'n' + this._nextId++;

        // Insert behind its future children (min index), like Group.
        let minIdx = this.Nodes.Count;
        for (const t of targets) { const i = this.Nodes.IndexOf(t); if (i >= 0 && i < minIdx) minIdx = i; }
        this.Nodes.Insert(minIdx, container);

        for (const t of targets)
        {
            const abs   = diagramSpaceRect(t);                       // current diagram-space top-left
            const local = toParentSpace(new Point(abs.X, abs.Y), container);
            t.ParentId = container.Id;
            t.Left = local.X;
            t.Top  = local.Y;
        }
        container.IsSelected = true;
        this.Status = `Wrapped ${targets.length} item${targets.length === 1 ? '' : 's'}.`;
        this._markDirty();
        // Re-parent now if the container is already realized; otherwise its
        // ContainerBound (fired on realize) re-runs placeAll and attaches them.
        this._boundView?.ContainerPlacement.placeAll();
    }

    /** Dissolve every selected ContainerFigure: re-home each container's children
     *  out to its own parent/root (preserving screen position — the reHome
     *  primitive), then remove the container node. Symmetric with Ungroup.
     *  Children (and their connectors) survive; the container's own connectors
     *  cascade away with it. No-op when no container is selected. */
    public UnwrapContainer(items: readonly unknown[]): void
    {
        const containers = selectedContainers(items);
        if (containers.length === 0) return;
        for (const container of containers)
        {
            this._boundView?.ContainerPlacement.reHome(container);
            const idx = this.Nodes.IndexOf(container);
            if (idx >= 0) this.Nodes.RemoveAt(idx);
        }
        // Headless / unrealized safety net (reHome needs the live view): clear any
        // child still naming a removed container so no parentId dangles.
        const removedIds = new Set<string>();
        for (const c of containers) if (c.Id !== undefined) removedIds.add(c.Id);
        for (let i = 0; i < this.Nodes.Count; i++)
        {
            const n = this.Nodes.Get(i);
            if (n instanceof Figure && n.ParentId !== undefined && removedIds.has(n.ParentId))
                n.ParentId = undefined;
        }
        this._cascadeRemoveConnectorsFor(containers);
        this.Status = `Unwrapped ${containers.length} container${containers.length === 1 ? '' : 's'}.`;
        this._markDirty();
    }

    /** Dissolve every Group-shaped entry in `items`. Members lift to
     *  the dissolved group's parent (or to no-parent if top-level). */
    public Ungroup(items: readonly unknown[]): void
    {
        const groups: Group[] = [];
        for (const item of this._topLevel(items))
        {
            if (item instanceof Group) groups.push(item);
        }
        if (groups.length === 0) return;
        for (const g of groups)
        {
            const parent = g.Parent;
            const members: (Figure | Group)[] = [];
            for (let i = 0; i < g.Members.Count; i++) members.push(g.Members.Get(i)!);
            for (const m of members)
            {
                g._removeMember(m);
                m.Parent = parent;
                if (parent !== undefined) parent.Members.Add(m);
            }
            if (parent !== undefined) parent._removeMember(g);
            const idx = this.Nodes.IndexOf(g);
            if (idx >= 0) this.Nodes.RemoveAt(idx);
        }
        // Members lift out and survive, so normally nothing is orphaned; the
        // cascade runs for uniformity (and to catch any connector that pinned
        // the group container itself). Keeps every removal path funnelled
        // through one cleanup so none can leave a ghost.
        this._cascadeRemoveConnectorsFor(groups);
        this.Status = `Ungrouped ${groups.length} group${groups.length === 1 ? '' : 's'}.`;
        this._markDirty();
    }

    /** PowerPoint Merge-Shapes counterpart. Folds the geometric subset
     *  of `items` via `mergeShapes` and replaces the inputs with a single
     *  combined-source shape Figure. Figure-based Groups are skipped. */
    public CombineSelection(items: readonly unknown[], mode: GeometryCombineMode): void
    {
        const leaves: Figure[] = [];
        for (const item of items)
        {
            // A shape Figure is a Figure that carries a silhouette source; skip
            // Group containers and content nodes.
            if (item instanceof Figure && item._getSource() !== undefined) leaves.push(item);
        }
        if (leaves.length < 2) return;
        const merged = mergeShapes(leaves, mode);
        if (merged === undefined)
        {
            this.Status = 'Combine produced an empty geometry.';
            return;
        }
        const template = leaves[0]!;
        const result = Figure.fromSource(merged.source, merged.x, merged.y, {
            width:  merged.w,
            height: merged.h,
        });
        result.Id   = 'n' + this._nextId++;
        result.Fill = template.Fill;
        if (template.Stroke !== undefined)
        {
            const PenCtor = template.Stroke.constructor as new (...args: unknown[]) => typeof template.Stroke;
            result.Stroke = new PenCtor(template.Stroke.Brush, template.Stroke.Thickness);
        }
        for (const leaf of leaves)
        {
            const idx = this.Nodes.IndexOf(leaf);
            if (idx >= 0) this.Nodes.RemoveAt(idx);
        }
        this.Nodes.Add(result);
        // The combined-away leaves are gone from the scene; drop any connector
        // that was attached to them so none lingers pointing at a removed node
        // (which would vanish from the canvas but persist as a ghost).
        const orphaned = this._cascadeRemoveConnectorsFor(leaves);
        const orphanSuffix = orphaned > 0
            ? ` (${orphaned} attached connector${orphaned === 1 ? '' : 's'} removed)`
            : '';
        this.Status = `Combined ${leaves.length} shapes (${combineModeName(mode)})${orphanSuffix}.`;
        this._markDirty();
    }

    // ── Node geometry store (the durable geometry truth) ──────────────
    //
    // Write a node's geometry by id. Applies to the node's live container Figure
    // immediately when it is already realized; otherwise the record waits in the
    // store and ContainerBound seeds the container when it binds. This is the
    // path for callers that set geometry BEFORE the container exists — a toolbox
    // drop (the container realizes on the next measure) or a layout pass over a
    // not-yet-realized node. Geometry lives here + on the container, never on the
    // content view-model.
    public SetNodeVisual(id: string, v: NodeVisual): void
    {
        this._visuals.Set(id, v);
        const view = this.ActiveView;
        if (view === undefined) return;
        for (let i = 0; i < this.Nodes.Count; i++)
        {
            const n = this.Nodes.Get(i)!;
            if ((n as { Id?: string }).Id !== id) continue;
            const fig = n instanceof Figure ? n : view.Generator.ContainerFromItem(n) as Figure | undefined;
            if (fig !== undefined) this._visuals.Apply(v, fig);
            break;
        }
    }

    public GetNodeVisual(id: string): NodeVisual | undefined { return this._visuals.Get(id); }

    // ── Save / Load ──────────────────────────────────────────────────

    public Save(): void
    {
        const storage = this.Storage;
        if (storage === undefined) return;
        try
        {
            storage.SetItem(STORAGE_KEY, JSON.stringify(this._serialize()));
            this.set_property_value(DiagramDocument.IsDirtyKey, false);
            this.Status = `Saved ${this.Nodes.Count} nodes.`;
        }
        catch (e)
        {
            this.Status = `Save failed: ${e instanceof Error ? e.message : String(e)}`;
        }
    }

    public Load(): void
    {
        const storage = this.Storage;
        if (storage === undefined) return;
        try
        {
            const json = storage.GetItem(STORAGE_KEY);
            if (json === null)
            {
                this.Status = 'Nothing saved yet — try Save first.';
                return;
            }
            this._deserialize(JSON.parse(json) as SerializedDiagram);
            this.set_property_value(DiagramDocument.IsDirtyKey, false);
            // A freshly loaded document has no undoable past, and its loaded
            // content is the baseline — not a phantom "added every node" edit the
            // deserialize's adds would otherwise leave on the safety net (whose
            // "before" is the empty constructor state until now).
            this._history.Reset();
            // Open a settle window over the post-load LAYOUT pass: once the view
            // mounts, containers size to content and connectors route for the first
            // time, firing the safety net asynchronously. Those derived-geometry
            // writes are not edits — swallow them so opening a file leaves a clean,
            // empty undo stack.
            this._history.BeginSettle();
            this.Status = `Loaded ${this.Nodes.Count} nodes.`;
        }
        catch (e)
        {
            this.Status = `Load failed: ${e instanceof Error ? e.message : String(e)}`;
        }
    }

    private _serialize(): SerializedDiagram
    {
        const nodes: SerializedNode[] = [];
        // Refresh the visual store from the live nodes WITHOUT dropping geometry we
        // can't currently read. A Clear-then-rebuild loses the stored geometry of a
        // live-but-unrealized node — one whose container has not bound yet, e.g. a
        // Capture right after Load, before the view mounts. Instead: a node with a
        // realized figure updates its stored geometry; a live node with no figure
        // keeps its pending geometry; and only ids no longer present are evicted.
        const liveIds = new Set<string>();
        for (let i = 0; i < this.Nodes.Count; i++)
        {
            const node = this.Nodes.Get(i)!;
            // Groups not persisted — skip them (and anything without a serializer).
            const s = serializerFor(node);
            if (s === undefined) continue;
            const id = (node as { Id?: string }).Id ?? '';
            nodes.push({ id, type: s.type, data: s.serialize(node) });
            if (id !== '') liveIds.add(id);
            // Geometry owner: the node itself when it's a self-painting Figure,
            // else its container Figure (content VMs host geometry on the
            // container). No container (headless VM edit, no live view, or a
            // pre-mount Capture) → keep whatever geometry is already stored.
            const fig = node instanceof Figure
                ? node
                : this.ActiveView?.Generator.ContainerFromItem(node) as Figure | undefined;
            if (fig !== undefined && id !== '') this._visuals.Set(id, this._visuals.Read(fig));
        }
        // Evict geometry for ids no longer on the canvas (a delete), keeping the
        // pending geometry of live-but-unrealized nodes.
        for (const id of Object.keys(this._visuals.Snapshot()))
            if (!liveIds.has(id)) this._visuals.Remove(id);
        const connectors: SerializedConnector[] = [];
        for (let i = 0; i < this.Connectors.Count; i++)
        {
            const c = this.Connectors.Get(i)!;
            if (c.IsDerived) continue;                                        // system-projected — re-derived, never persisted/recorded
            if (c.Source === undefined || c.Target === undefined) continue;   // half-set connectors are not persisted
            connectors.push(serializeConnectorRecord(c));
        }
        const hasMetadata = Object.keys(this._metadata).length > 0;
        return {
            version: 3,
            nodes,
            visuals: this._visuals.Snapshot(),
            connectors,
            nextId: this._nextId,
            ...(hasMetadata ? { metadata: { ...this._metadata } } : {}),
        };
    }

    private _deserialize(payload: SerializedDiagram): void
    {
        this.Nodes.Clear();
        this.Connectors.Clear();

        // Round-trip nodes first so connectors can resolve their endpoint
        // nodeIds against the freshly-rehydrated Nodes set. byId holds Figure
        // shapes (incl. TextNode/Callout, which extend Figure) AND content VMs;
        // ConnectorEndpoint.Node is typed MuralBase so all are accepted. Endpoints
        // to a Figure bind directly; endpoints to a VM defer to the VM's
        // container (see rehydrateEndpoint).
        const byId = new Map<string, Figure | NodeViewModel>();
        // Callout leader targets resolve in a second pass (the target node may
        // be deserialized after the callout).
        const pendingLeaders: { callout: Callout; targetId: string }[] = [];

        // Ids already claimed by explicit records (or generated below) — the
        // fallback generator must skip these so an empty-id node never collides
        // with an inbound 'nN' and overwrites it in byId.
        const claimedIds = new Set<string>();
        for (const n of payload.nodes ?? [])
        {
            if (n.id !== '') claimedIds.add(n.id);
        }
        const nextFreeId = (): string => {
            let candidate = 'n' + this._nextId++;
            while (claimedIds.has(candidate)) candidate = 'n' + this._nextId++;
            claimedIds.add(candidate);
            return candidate;
        };

        // Seed the visual store from the presentation section, then apply each
        // record onto its (geometry-free-built) node by id.
        this._visuals.Clear();
        this._visuals.Seed(payload.visuals ?? {});

        for (const n of payload.nodes ?? [])
        {
            const s = serializerByType(n.type);
            if (s === undefined) continue;   // unknown serializer type — skip
            const node = s.deserialize(n.data ?? {}) as Figure | NodeViewModel;

            // Geometry: apply the visual record keyed by the SAVED record id
            // (before any '' → fresh-id reassignment below). Self-painting Figure
            // nodes own their geometry directly, so apply here. Content VM nodes
            // host geometry on their container instead — the store stays seeded
            // (below) and ContainerBound applies it when the container realizes.
            const v = this._visuals.Get(n.id);
            if (v !== undefined && node instanceof Figure) this._visuals.Apply(v, node);

            const id = n.id !== '' ? n.id : nextFreeId();
            node.Id = id;

            // Register callout leaders for second pass.
            if (node instanceof Callout)
            {
                const targetId = typeof n.data?.leaderTargetId === 'string' ? n.data.leaderTargetId : undefined;
                if (targetId !== undefined) pendingLeaders.push({ callout: node, targetId });
            }

            this.Nodes.Add(node);
            byId.set(id, node);
        }

        // Wire callout leaders now that every node id resolves.
        // The target may be any rehydrated node type (Figure shape, TextNode,
        // or Callout) — all satisfy ILeaderTarget at runtime
        // (Left/Top/Width/Height + DPs).
        for (const { callout, targetId } of pendingLeaders)
        {
            const target = byId.get(targetId);
            if (target !== undefined)
            {
                // ILeaderTarget is satisfied by all node types (duck-typed).
                callout.LeaderTargetNode = target as import('./callout.js').ILeaderTarget;
            }
        }
        for (const sc of payload.connectors ?? [])
        {
            const c = new Connector();
            if (typeof sc.routingMode === 'string') c.RoutingMode = sc.routingMode;
            c.Source = rehydrateEndpoint(sc.source, byId);
            c.Target = rehydrateEndpoint(sc.target, byId);
            if (sc.waypoints !== undefined && sc.waypoints.length > 0)
            {
                // Legacy entries (no userAltered) were all hand-routed intent → pin them.
                c.Waypoints = sc.waypoints.map(p => waypoint(new Point(p.x, p.y), p.userAltered ?? true));
            }
            if (sc.text !== undefined) applySerializedText(c.Text, sc.text);
            if (typeof sc.labelPos === 'number') c.LabelPosition = sc.labelPos;
            this.Connectors.Add(c);
        }
        if (typeof payload.nextId === 'number') this._nextId = Math.max(this._nextId, payload.nextId);
        this._metadata = payload.metadata !== undefined ? { ...payload.metadata } : {};
    }

    // Reduce items to the unique set of outermost ancestors (walks
    // Parent chains, dedupes). Match the framework's `selectedTopLevel`
    // semantics so Group / Ungroup respect Visio-style "selecting a
    // member ≡ selecting its outermost group" elevation.
    private _topLevel(items: readonly unknown[]): (Figure | Group | NodeViewModel)[]
    {
        const out = new Set<Figure | Group | NodeViewModel>();
        for (const item of items)
        {
            if (item instanceof Figure || item instanceof Group || item instanceof NodeViewModel)
            {
                let cur: Figure | Group | NodeViewModel = item;
                while (cur.Parent !== undefined) cur = cur.Parent;
                out.add(cur);
            }
        }
        return [...out];
    }
}

// A node's stable Id for cascade matching. Figure and NodeViewModel both carry
// an Id; other MuralBase kinds (e.g. a Group container) have none → undefined, so
// they match by object identity only. Kept in sync with serializeEndpoint's
// node-kind test.
function nodeIdOf(n: unknown): string | undefined
{
    if (n instanceof Figure)        return n.Id;
    if (n instanceof NodeViewModel) return n.Id;
    return undefined;
}

function serializeEndpoint(ep: ConnectorEndpoint): SerializedConnectorEndpoint
{
    const node = ep.Node;
    if ((node instanceof Figure || node instanceof NodeViewModel) && node.Id !== undefined && node.Id !== '')
    {
        return nodeEndpoint(node.Id, ep);
    }
    // A reference whose node wasn't present at the last load: preserve the id
    // (and any port) so the endpoint re-binds on a later, correct load rather
    // than being silently rewritten to a free point (which destroys it).
    if (ep.UnresolvedNodeId !== undefined)
    {
        return nodeEndpoint(ep.UnresolvedNodeId, ep);
    }
    const fp = ep.FreePoint;
    if (fp !== undefined) return { freeX: fp.X, freeY: fp.Y };
    // An endpoint with NO usable anchor — no persistable node, no
    // UnresolvedNodeId to preserve, no FreePoint. There is nothing to write
    // that could round-trip; the old behaviour serialized `{}`, which reloads
    // as FreePoint(0,0) and self-perpetuates a ghost connector at the origin.
    // This is an unexpected, unpredictable state (a connector whose end is
    // wired to a node that has no id / isn't in the scene), so fail loudly at
    // the source instead of silently corrupting the file. The caller
    // (_serialize) is responsible for never persisting such a connector.
    const nodeDesc = node === undefined
        ? 'undefined'
        : `${(node as { constructor: { name: string } }).constructor.name}(Id=${JSON.stringify((node as { Id?: string }).Id)})`;
    throw new Error(
        `serializeEndpoint: connector endpoint has no persistable anchor `
        + `(node=${nodeDesc}, FreePoint=undefined, UnresolvedNodeId=undefined). `
        + `A connected endpoint must reference a node with a non-empty Id, or be a free point.`,
    );
}

// A node-anchored serialized endpoint, carrying the port addressing the user
// pinned: PortName, or the PortSide (+ slot PortIndex) chosen by dragging the
// endpoint onto a side. PortSide.Auto is the "derive from geometry" sentinel —
// not a user choice — so it is omitted, letting the side re-derive on load.
function nodeEndpoint(nodeId: string, ep: ConnectorEndpoint): SerializedConnectorEndpoint
{
    const out: {
        nodeId: string; portName?: string; portSide?: PortSide; portIndex?: number;
    } = { nodeId };
    if (ep.PortName !== undefined) out.portName = ep.PortName;
    if (ep.PortSide !== undefined && ep.PortSide !== PortSide.Auto)
    {
        out.portSide = ep.PortSide;
        if (ep.PortIndex !== undefined) out.portIndex = ep.PortIndex;
    }
    return out;
}

function rehydrateEndpoint(
    s: SerializedConnectorEndpoint,
    byId: ReadonlyMap<string, Figure | NodeViewModel>,
): ConnectorEndpoint
{
    if (s.nodeId !== undefined)
    {
        const node = byId.get(s.nodeId);
        // A self-painting Figure IS the geometry owner — bind directly.
        if (node instanceof Figure)
        {
            return new ConnectorEndpoint({
                Node:      node,
                PortName:  s.portName,
                PortSide:  s.portSide,
                PortIndex: s.portIndex,
            });
        }
        // Either the node is absent from THIS load (a serializer not registered
        // when Load ran, so its record was skipped) OR it is a content VM whose
        // geometry + side-endpoint host live on its container Figure, which is
        // not realized yet. Both cases PRESERVE the id: a later load with the
        // Figure present, or ContainerBound when the VM's container binds
        // (_repointEndpointsToContainer), re-binds the endpoint at the geometry
        // owner. The old behaviour fell through to FreePoint(0,0), which
        // permanently destroyed the reference. Connector treats an
        // UnresolvedNodeId endpoint as un-routable, so it stays hidden rather
        // than snapping to the origin.
        return new ConnectorEndpoint({
            UnresolvedNodeId: s.nodeId,
            PortName:         s.portName,
            PortSide:         s.portSide,
            PortIndex:        s.portIndex,
        });
    }
    if (typeof s.freeX === 'number' && typeof s.freeY === 'number')
    {
        return new ConnectorEndpoint({ FreePoint: new Point(s.freeX, s.freeY) });
    }
    // The origin fallback: the serialized endpoint had NO nodeId and NO
    // freeX/freeY → it deserializes to (0,0).
    return new ConnectorEndpoint({ FreePoint: new Point(0, 0) });
}

// Snapshot one connector to its serialized record. Shared by full-document
// save (_serialize) and clipboard copy so the two never drift. Caller
// guarantees Source / Target are set.
function serializeConnectorRecord(c: Connector): SerializedConnector
{
    return {
        source:      serializeEndpoint(c.Source!),
        target:      serializeEndpoint(c.Target!),
        waypoints:   c.Waypoints !== undefined && c.Waypoints.length > 0
            ? c.Waypoints.map(w => ({ x: w.point.X, y: w.point.Y, userAltered: w.userAltered }))
            : undefined,
        routingMode: c.RoutingMode,
        text:        serializeShapeText(c.Text),
        labelPos:    c.LabelPosition !== 0.5 ? c.LabelPosition : undefined,
    };
}

// The node id an endpoint anchors to (a live node's Id, or a preserved
// UnresolvedNodeId), or undefined for a free-point endpoint. Used by clipboard
// copy to test whether a connector lies wholly within the copied set.
function endpointNodeId(ep: ConnectorEndpoint | undefined): string | undefined
{
    if (ep === undefined) return undefined;
    return nodeIdOf(ep.Node) ?? ep.UnresolvedNodeId;
}

// Remap a serialized endpoint for paste: a node-anchored endpoint re-points to
// the pasted node's fresh id (undefined → drop the connector, its node wasn't
// copied); a free-point endpoint shifts by the paste offset.
function remapEndpoint(
    ep: SerializedConnectorEndpoint,
    idMap: ReadonlyMap<string, string>,
    delta: number,
): SerializedConnectorEndpoint | undefined
{
    if (ep.nodeId !== undefined)
    {
        const mapped = idMap.get(ep.nodeId);
        return mapped === undefined ? undefined : { ...ep, nodeId: mapped };
    }
    if (typeof ep.freeX === 'number' && typeof ep.freeY === 'number')
    {
        return { ...ep, freeX: ep.freeX + delta, freeY: ep.freeY + delta };
    }
    return ep;
}

function combineModeName(mode: GeometryCombineMode): string
{
    switch (mode)
    {
        case GeometryCombineMode.Union:     return 'Union';
        case GeometryCombineMode.Intersect: return 'Intersect';
        case GeometryCombineMode.Xor:       return 'Exclude';
        case GeometryCombineMode.Exclude:   return 'Subtract';
        default: return String(mode);
    }
}
